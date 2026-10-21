#!/usr/bin/env python3
"""离线语义去重预审：在 3.4.10 语义候选（语义去重.py / knowledge_semantic.scan）之上
1) 折叠同来源、只差机型的模板条目为范围变体簇（只加标签）；
2) 对其余高相似候选分级：跨来源为 dup_candidate / conflict_candidate（送审），同来源为 same_source_similar（只报告）；
3) 可选调用外部 AI 预审器（默认关闭），写 JSON 结论；
4) 按 pair_id 增量合并到人工审核文件 dedup-review.jsonl。
永不删除、永不修改条目或正文；不接入诊断服务。"""
import argparse
import collections
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import unicodedata

sys.dont_write_bytecode = True
from knowledge_quality import atomic_write, safe_output
from knowledge_semantic import scan, validator

KB_ROOT = Path('知识库/整理后的知识库/农用拖拉机知识库')
REVIEW_FILE = KB_ROOT / 'dedup-review.jsonl'
DECISIONS = ('pending', 'keep', 'merge', 'supersede', 'conflict')
AI_RELATIONS = ('duplicate', 'complementary', 'scope_variant', 'conflict', 'unrelated', 'uncertain')
REVIEW_TIERS = ('dup_candidate', 'conflict_candidate')
PROMPT = """你是农机维修知识库审核助手。比较下面两条知识（正文与元数据），只依据给出的文字判断关系。
relation 取 duplicate|complementary|scope_variant|conflict|unrelated|uncertain；不确定时必须判 uncertain。
机型、配置、排放、Section/页码、数值、单位、否定或安全限制不同，不能判 duplicate。
只输出 JSON：{"relation":..., "keep_both": true|false, "reason": "...", "evidence_spans": ["原文片段", ...]}"""


def norm(text):
    text = unicodedata.normalize('NFKC', text).lower()
    text = re.sub(r'(src|kb)[-\w]+', '', text)
    return re.sub(r'[\s\W_]+', '', text)


def shingles(text, n=3):
    return {text[i:i + n] for i in range(max(1, len(text) - n + 1))}


def jaccard(a, b):
    return len(a & b) / len(a | b) if a and b else 0.0


def load_entries(repo):
    cache, entries = {}, {}
    for line in (repo / KB_ROOT / 'entries.jsonl').read_text(encoding='utf8').splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        path = e['knowledge_path']
        if path not in cache:
            cache[path] = (repo / path).read_text(encoding='utf8').replace('\r\n', '\n')
        m = re.search(r'^##+ ' + re.escape(e['entry_id']) + r'[^\n]*\n(.*?)(?=^##+ |\Z)', cache[path], re.S | re.M)
        entries[e['entry_id']] = {**e, 'body': m.group(1).strip() if m else ''}
    return entries


def template_key(entry):
    """机型名、编号、Section/Group 号换成占位符后的正文骨架。"""
    text = entry['title'] + '\n' + entry['body']
    models = {entry.get('model', '')} | set(re.findall(r'[“"]([^”"]{2,40})[”"]', text))
    for model in sorted((m for m in models if m and re.search(r'\d', m)), key=len, reverse=True):
        text = text.replace(model, '<M>')
    text = re.sub(r'(?i)\b(section|group)\s*\d+', r'\1#', text)
    return norm(re.sub(r'\d+', '#', text))


def fold_templates(entries):
    groups = collections.defaultdict(list)
    for eid, e in entries.items():
        groups[(e['source_id'], template_key(e))].append(eid)
    clusters, member_of = [], {}
    for (source, _), ids in groups.items():
        if len(ids) > 1 and len({entries[i].get('model') for i in ids}) > 1:
            cid = 'TG-' + hashlib.sha256('\n'.join(sorted(ids)).encode()).hexdigest()[:16]
            clusters.append({'cluster_id': cid, 'tier': 'scope_variant', 'source_id': source,
                             'members': sorted(ids), 'models': sorted({entries[i].get('model', '') for i in ids})})
            for i in ids:
                member_of[i] = cid
    return clusters, member_of


def classify(relations, entries, member_of, threshold):
    shingle = {}

    def sh(eid):
        if eid not in shingle:
            shingle[eid] = shingles(norm(entries[eid]['body']))
        return shingle[eid]

    pairs = {}
    candidates = [(r['left_entry_id'], r['right_entry_id'], r.get('reasons', []), r.get('semantic_similarity'))
                  for r in relations]
    exact = collections.defaultdict(list)
    for eid, e in entries.items():
        if e['body']:
            exact[norm(e['body'])].append(eid)
    candidates += [(a, b, [], None) for ids in exact.values() for i, a in enumerate(ids) for b in ids[i + 1:]]
    for a, b, reasons, cosine in candidates:
        a, b = sorted((a, b))
        if (a, b) in pairs or a not in entries or b not in entries:
            continue
        if member_of.get(a) and member_of.get(a) == member_of.get(b):
            continue  # 同模板簇：范围变体，整簇只审一次
        score = jaccard(sh(a), sh(b))
        if score < threshold:
            continue
        risky = any(re.search('数值|单位|否定|安全', reason) for reason in reasons)
        cross = entries[a]['source_id'] != entries[b]['source_id']
        # 同来源高相似多为同一手册模板下的不同主题（如不同 Section），只入报告不送审
        tier = ('conflict_candidate' if risky else 'dup_candidate') if cross else 'same_source_similar'
        pairs[(a, b)] = {
            'pair_id': 'DP-' + hashlib.sha256(f'{a}\n{b}'.encode()).hexdigest()[:16], 'a': a, 'b': b,
            'jaccard': round(score, 4), 'cosine': cosine,
            'cross_source': cross, 'tier': tier}
    return sorted(pairs.values(), key=lambda p: p['pair_id'])


class NoReviewer:
    """默认：不调用 AI，不生成结论。"""
    identity = None

    def review(self, payload):
        return None


class CommandReviewer:
    """外部预审器：命令从 stdin 读一对 JSON，向 stdout 写结论 JSON。由维护者显式配置、离线运行。"""

    def __init__(self, command, timeout=120):
        self.argv = shlex.split(command)
        self.timeout = timeout
        self.identity = os.environ.get('AGRIDX_DEDUP_REVIEWER_MODEL') or self.argv[0]

    def review(self, payload):
        done = subprocess.run(self.argv, input=json.dumps(payload, ensure_ascii=False), capture_output=True,
                              text=True, encoding='utf8', timeout=self.timeout, check=False)
        if done.returncode != 0:
            raise RuntimeError(f'预审器退出码 {done.returncode}')
        return validate_verdict(json.loads(done.stdout))


def validate_verdict(verdict):
    if not isinstance(verdict, dict) or verdict.get('relation') not in AI_RELATIONS \
            or not isinstance(verdict.get('keep_both'), bool) or not isinstance(verdict.get('reason'), str) \
            or not isinstance(verdict.get('evidence_spans', []), list):
        raise ValueError('预审结论 JSON 字段不合规')
    return {k: verdict[k] for k in ('relation', 'keep_both', 'reason')} | {
        'evidence_spans': [str(s) for s in verdict.get('evidence_spans', [])][:8]}


def payload_for(pair, entries):
    side = lambda eid: {k: entries[eid].get(k) for k in ('entry_id', 'brand', 'model', 'title', 'source_id', 'locator', 'body')}
    return {'prompt': PROMPT, 'pair_id': pair['pair_id'], 'tier': pair['tier'], 'a': side(pair['a']), 'b': side(pair['b'])}


def read_review(path):
    rows = {}
    if path.exists():
        for line in path.read_text(encoding='utf8').splitlines():
            if line.strip():
                row = json.loads(line)
                if row.get('decision') not in DECISIONS:
                    raise ValueError(f"{row.get('pair_id')} 的 decision 须为 {'|'.join(DECISIONS)}")
                rows[row['pair_id']] = row
    return rows


def merge_review(existing, pairs, verdicts, kb_version, ai_model):
    """新候选追加为 pending；已有行只补 AI 结论，人工决定字段不变；消失的候选保留原行。"""
    rows = dict(existing)
    for p in pairs:
        if p['tier'] not in REVIEW_TIERS:
            continue
        row = rows.get(p['pair_id']) or {
            'pair_id': p['pair_id'], 'a': p['a'], 'b': p['b'], 'jaccard': p['jaccard'], 'cosine': p['cosine'],
            'tier': p['tier'], 'ai_verdict': None, 'ai_model': None, 'reviewer': None,
            'decision': 'pending', 'decided_at': None, 'kb_version': kb_version}
        if p['pair_id'] in verdicts and row['decision'] == 'pending':
            row = {**row, 'ai_verdict': verdicts[p['pair_id']], 'ai_model': ai_model}
        rows[p['pair_id']] = row
    return [rows[k] for k in sorted(rows)]


def unreviewed(rows, pairs):
    decided = {r['pair_id'] for r in rows if r['decision'] != 'pending'}
    return [p for p in pairs if p['tier'] in REVIEW_TIERS and p['pair_id'] not in decided]


def main():
    parser = argparse.ArgumentParser(description='离线语义去重预审；只出标签、结论和待审记录，不修改知识')
    parser.add_argument('--threshold', type=float, default=0.8, help='字符3-gram Jaccard 下限')
    parser.add_argument('--reviewer', choices=['none', 'command'], default='none',
                        help='command 需设置 AGRIDX_DEDUP_REVIEWER_CMD；默认不调用 AI')
    parser.add_argument('--limit', type=int, default=50, help='单次最多送审对数')
    parser.add_argument('--write-review', action='store_true', help='增量合并到 dedup-review.jsonl')
    parser.add_argument('--check', action='store_true', help='只报告未审候选数（警告，退出码 0）')
    parser.add_argument('--report', type=Path, help='簇、分级与预审结论 JSON（写入 server/data/knowledge-quality/）')
    args = parser.parse_args()
    repo = validator.REPO
    result = scan(repo=repo)
    if result['blocked']:
        raise RuntimeError('质量检查存在错误，预审中止')
    entries = load_entries(repo)
    clusters, member_of = fold_templates(entries)
    pairs = classify(result['relations'], entries, member_of, args.threshold)
    review_path = repo / REVIEW_FILE
    existing = read_review(review_path)
    kb_version = json.loads((repo / KB_ROOT / 'kb-version.json').read_text(encoding='utf8'))['kb_version']

    if args.reviewer == 'command':
        command = os.environ.get('AGRIDX_DEDUP_REVIEWER_CMD')
        if not command:
            raise ValueError('--reviewer command 需要环境变量 AGRIDX_DEDUP_REVIEWER_CMD')
        reviewer = CommandReviewer(command)
    else:
        reviewer = NoReviewer()
    verdicts, errors = {}, {}
    if reviewer.identity:
        todo = [p for p in pairs if p['tier'] in REVIEW_TIERS
                and existing.get(p['pair_id'], {}).get('decision', 'pending') == 'pending'
                and not existing.get(p['pair_id'], {}).get('ai_verdict')][:args.limit]
        for p in todo:
            try:
                verdicts[p['pair_id']] = reviewer.review(payload_for(p, entries))
            except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
                errors[p['pair_id']] = str(error)

    rows = merge_review(existing, pairs, verdicts, kb_version, reviewer.identity)
    if args.write_review:
        atomic_write(review_path, ''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows))
    if args.report:
        atomic_write(safe_output(args.report, repo), json.dumps(
            {'generated_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'kb_version': kb_version,
             'clusters': clusters, 'pairs': pairs, 'verdicts': verdicts, 'errors': errors},
            ensure_ascii=False, indent=2) + '\n')
    tiers = collections.Counter(p['tier'] for p in pairs)
    pending = unreviewed(list(existing.values()) if args.check else rows, pairs)
    summary = {'entries': len(entries), 'template_clusters': len(clusters),
               'template_members': sum(len(c['members']) for c in clusters), 'pairs_by_tier': dict(sorted(tiers.items())),
               'unreviewed': len(pending), 'ai_reviewer': reviewer.identity, 'ai_verdicts': len(verdicts),
               'ai_errors': len(errors)}
    print(json.dumps(summary, ensure_ascii=False))
    if args.check and pending:
        print(f'::warning title=知识去重::{len(pending)} 对重复/冲突候选未经人工审核（dedup-review.jsonl），不阻断合入。')
    return 0


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding='utf-8')
    try:
        sys.exit(main())
    except (ValueError, OSError, RuntimeError) as error:
        print(f'语义预审失败：{error}', file=sys.stderr)
        sys.exit(1)
