#!/usr/bin/env python3
"""把已核对候选写入来源记录、知识卡、entries.jsonl 和 hierarchy.json。

不保存网页全文。每条 evidence_quote 必须仍能在当次下载的 HTML 中找到。
"""
import argparse
import json
from pathlib import Path

from common import model_id, normalized, page_text, sha256_file, unique

REPO = Path(__file__).resolve().parents[3]
INDEX = REPO / '知识库/整理后的知识库/农用拖拉机知识库'
ORIGIN = REPO / '知识库/原始农机说明书/东方红/e购网页'
CARDS = INDEX / '机型知识卡'


def load_rows(path):
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]


def grouped(rows):
    groups = {}
    for row in rows:
        groups.setdefault(row['source_id'], []).append(row)
    return groups


def source_record(row, code):
    return f"""# {row['h1']}来源记录

核验日期：2026-10-28。本文件是自行编写的来源与完整性记录，不是网页全文，也不是说明书原件。

- 公开页：<{row['url']}>
- 页面 `<h1>`：{row['h1']}
- 取得日期：2026-10-28。该日期不是手册出版日期，页面未标注手册编号与版次。
- 响应 HTML SHA256：`{row['html_sha256']}`
- 响应 HTML 字节：{row['html_bytes']}
- 上述哈希属于当次下载的 HTML，不是本记录文件的哈希。
- 商城页未另行取得再分发许可，仓库不保存正文全文，只保留链接、哈希和知识卡中的自行概述。
- 图片、未逐格读取的表格不作为已核对参数。排放阶段页面未明确，不按型号后缀推断国三或国四。
- 知识卡：[东方红_e购_{code}.md](../../../整理后的知识库/农用拖拉机知识库/机型知识卡/东方红_e购_{code}.md)
"""


def knowledge_card(code, row, entries):
    lines = [
        f"# 东方红／{row['h1']}",
        '',
        '## 来源与适用范围',
        '',
        f"- 来源编号：`{row['source_id']}`",
        f"- 公开原网址：{row['url']}",
        '- 已审范围：2026-10-28对照该页文字层。图片和未解析表格未逐张目视，未全书以外的纸质手册审校，未厂家复核，未实车验证。',
        '- 版本：网页未标注手册编号与版次。取得日期不是出版日期。',
        '',
    ]
    for entry in entries:
        lines.append(f"## {entry['entry_id']}｜{entry['title']}")
        lines.append('')
        lines.append(entry['body'].rstrip())
        lines.append('')
    return '\n'.join(lines).rstrip() + '\n'


def promote(staged, html_dir):
    rows = load_rows(staged)
    sources = json.loads((INDEX / 'sources.json').read_text(encoding='utf-8'))
    existing = {source['source_id'] for source in sources}
    entries_path = INDEX / 'entries.jsonl'
    roles_path = INDEX / 'entry-roles.jsonl'
    hierarchy = json.loads((INDEX / 'hierarchy.json').read_text(encoding='utf-8'))
    known_entries = {item['entry_id'] for item in hierarchy['entries']}
    new_entries, new_roles, new_links = [], [], []
    ORIGIN.mkdir(parents=True, exist_ok=True)
    for source_id, group in grouped(rows).items():
        if source_id in existing:
            raise SystemExit(f'来源已存在，拒绝重复写入：{source_id}')
        code = source_id.removeprefix('SRC-YTO-EBUY-')
        html_path = Path(html_dir) / f"view-{group[0]['view']}.html"
        html = html_path.read_text(encoding='utf-8', errors='replace')
        _title, page_norm = page_text(html)
        for row in group:
            if row['evidence_quote'] not in page_norm:
                raise SystemExit(f"证据子串不在页面中：{row['entry_id']} {row['evidence_quote'][:40]}")
            if row['entry_id'] in known_entries:
                raise SystemExit(f"条目编号已存在：{row['entry_id']}")
        record_path = ORIGIN / f'来源记录_{code}.md'
        card_rel = f'知识库/整理后的知识库/农用拖拉机知识库/机型知识卡/东方红_e购_{code}.md'
        record_path.write_text(source_record(group[0], code), encoding='utf-8')
        (REPO / card_rel).write_text(knowledge_card(code, group[0], group), encoding='utf-8')
        models = unique([model for row in group for model in row['models']] + group[0]['page_models'])
        source = {
            'source_id': source_id,
            'brand': '东方红',
            'model': group[0]['page_model'],
            'models': models,
            'model_ids': unique(model_id(model) for model in models),
            'title': group[0]['h1'],
            'title_status': '已核对',
            'title_evidence': '页面<h1>',
            'document_type': group[0]['doc'],
            'role': '网页资料',
            'path': record_path.relative_to(REPO).as_posix(),
            'url': group[0]['url'],
            'version': '网页未标注手册编号与版次；2026-10-28取得。取得日期不是出版日期',
            'emission_stage_unknown': True,
            'scope_boundary': '仅该公开页标题和正文写明的型号或范围。未标注手册编号、版次、排放、序列号和发动机铭牌；图片与未解析表格未逐张目视。不外推到未点名机型，也不替代随车发动机说明书。',
            'status': '已取得网页正文并对照文字层整理知识卡；未保存全文；未厂家复核或实车验证',
            'source_level': '东方红e购商城公开售后页（农机360）。不是随车纸质手册扫描件，未另获厂家书面确认。',
            'collected_at': '2026-10-28',
            'sha256': sha256_file(record_path),
            'bytes': record_path.stat().st_size,
            'html_sha256': group[0]['html_sha256'],
            'html_bytes': group[0]['html_bytes'],
            'hash_scope': 'sha256/bytes属于本地来源记录；html_sha256/html_bytes属于当次下载的HTML',
            'knowledge_path': card_rel,
        }
        sources.append(source)
        for row in group:
            entry = {
                'entry_id': row['entry_id'],
                'source_id': source_id,
                'brand': '东方红',
                'model': '/'.join(row['models']),
                'models': row['models'],
                'title': row['title'],
                'knowledge_path': card_rel,
                'locator': row['locator'],
                'entry_type': row['entry_type'],
                'status': row['status'],
                'scope_boundary': f"仅{'、'.join(row['models'])}。页面未标注版次和排放。",
            }
            new_entries.append(entry)
            if row.get('roles'):
                new_roles.append({
                    'entry_id': row['entry_id'],
                    'roles': row['roles'],
                    'role_basis': '原文标记',
                })
            new_links.append({
                'entry_id': row['entry_id'],
                'components': [{'component_id': name, 'part_ids': []} for name in unique(row['components'])],
            })
    (INDEX / 'sources.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    with entries_path.open('a', encoding='utf-8') as handle:
        if entries_path.stat().st_size and not entries_path.read_bytes().endswith(b'\n'):
            handle.write('\n')
        for entry in new_entries:
            handle.write(json.dumps(entry, ensure_ascii=False) + '\n')
    with roles_path.open('a', encoding='utf-8') as handle:
        if roles_path.stat().st_size and not roles_path.read_bytes().endswith(b'\n'):
            handle.write('\n')
        for role in new_roles:
            handle.write(json.dumps(role, ensure_ascii=False) + '\n')
    queue_path = INDEX / 'role-review-queue.jsonl'
    non_diagnostic = {'系统适用边界', '资料索引', '资料核验', '机型资料', '资料缺口'}
    queued = []
    for row in rows:
        if row.get('roles') or row['entry_type'] in non_diagnostic:
            continue
        queued.append({
            'entry_id': row['entry_id'],
            'entry_type': row['entry_type'],
            'knowledge_path': f"知识库/整理后的知识库/农用拖拉机知识库/机型知识卡/东方红_e购_{row['source_id'].removeprefix('SRC-YTO-EBUY-')}.md",
            'status': 'pending',
            'reason': '正文无故障现象等字段标记，需人工核对角色',
        })
    with queue_path.open('a', encoding='utf-8') as handle:
        if queue_path.stat().st_size and not queue_path.read_bytes().endswith(b'\n'):
            handle.write('\n')
        for item in queued:
            handle.write(json.dumps(item, ensure_ascii=False) + '\n')
    hierarchy['updated_at'] = '2026-10-28'
    hierarchy['entries'].extend(new_links)
    (INDEX / 'hierarchy.json').write_text(json.dumps(hierarchy, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'sources': len(grouped(rows)), 'entries': len(new_entries), 'roles': len(new_roles)}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--staged', required=True)
    parser.add_argument('--html-dir', required=True)
    args = parser.parse_args()
    promote(args.staged, args.html_dir)


if __name__ == '__main__':
    main()
