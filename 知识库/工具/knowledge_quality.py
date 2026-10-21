"""Reporting, conservative card adapters and incremental cache for 校验索引.py.

No network, model, database or application imports. Findings are review requests,
not corrections or estimates of diagnostic accuracy.
"""
import collections
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

SCHEMA_VERSION = 1
RULES_VERSION = '1.1.0'
STATES = ('verified', 'pending', 'unverified', 'failed', 'unspecified')

# id: category, severity, suggested next action. Keep IDs stable across reports.
RULES = {
    'index.json': ('index', 'error', '修正索引JSON语法或顶层结构后重新检查。'),
    'record.required': ('completeness', 'error', '根据原件补齐非空字段，不推测未知值。'),
    'record.whitespace': ('field_format', 'warning', '人工核对多余首尾空白；本工具不自动规范化。'),
    'record.optional': ('field_format', 'error', '按字段类型修正；未知的可选条件应省略。'),
    'record.placeholder': ('completeness', 'warning', '用证据支持的实际内容替换占位符，或明确标记资料缺口。'),
    'source.id': ('source', 'error', '使用唯一的ASCII大写来源编号，并同步真实引用。'),
    'source.url': ('source', 'error', '补充可追溯的完整HTTP(S)入口。'),
    'source.title': ('source', 'error', '按封面或已存网页标题登记书名并写明出处；无法核对时标明title_status=待核实，不编造书名。'),
    'source.brand': ('source', 'error', '品牌用统一主品牌，子品牌/产品线写入sub_brand或product_line。'),
    'source.model_ids': ('applicability', 'error', '由models机械派生规范型号编号，非空且不重复，不新增型号。'),
    'source.file': ('source', 'error', '核对原件路径、哈希、字节数与页数；不要覆盖原件。'),
    'source.pages': ('source', 'error', '对照原件检查已核对页记录与实际物理页范围。'),
    'source.level': ('source', 'info', '补充发布方与取得渠道；缺失不等于来源不可靠。'),
    'source.external': ('source', 'info', '如需重新证明PDF完整性，提供已取得的临时原件；本工具不下载。'),
    'scope.models': ('applicability', 'error', '精确型号必须有原件支持，条目列表须为来源型号的非空无重复子集。'),
    'scope.condition': ('applicability', 'error', '核对配置或排放条件，不跨型号补造适用范围。'),
    'entry.id': ('index', 'error', '使用唯一的ASCII大写条目编号，避免复用编号。'),
    'entry.type': ('field_format', 'error', '选择整理规范允许的条目类别。'),
    'entry.roles': ('field_format', 'error', '按原文字段标记或人工核对结果填写roles/role_basis、risk_level/risk_basis；无法确定时省略并留待审核。'),
    'entry.summary': ('body_format', 'error', '事实正文仅维护在Markdown，不在索引保留summary副本。'),
    'entry.source': ('source_consistency', 'error', '核对条目来源编号与品牌，不把不同品牌资料混用。'),
    'entry.path': ('body_format', 'error', '将索引指向整理后的知识库内正式Markdown知识卡。'),
    'entry.section': ('body_format', 'error', '核对唯一编号章节、标题与非空正文。'),
    'entry.evidence': ('source_consistency', 'error', '核对正文中的来源编号及索引证据页。'),
    'body.source': ('source_consistency', 'warning', '核对明确标注的来源行，确认是否引用了未登记的其他来源。'),
    'body.field': ('body_format', 'warning', '人工检查该格式中明确出现但为空或重复的字段；不要求统一步骤模板。'),
    'body.placeholder': ('body_format', 'warning', '对照证据补充占位正文；资料缺口类可保留明确待补说明。'),
    'body.encoding': ('body_format', 'warning', '核对替换字符或异常控制字符，必要时回看扫描图像。'),
    'body.length': ('body_format', 'warning', '核对1200字符截断是否损失条件；不要自动删减事实。'),
    'body.status': ('verification', 'warning', '人工核对正文与索引核验状态，保留原文本及未完成事项。'),
    'status.unspecified': ('verification', 'info', '现有严格解析器无法分类；保留原状态，人工核对后再考虑结构化映射。'),
    'snapshot.changed': ('execution', 'error', '输入在扫描期间变化；暂停使用本报告并重新运行。'),
}


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode()).hexdigest()


def reference_verification(status):
    """Mirror evidence.ts; the Node/Python corpus regression guards parity."""
    if not isinstance(status, str) or not status.strip():
        return 'unspecified'
    if re.search(r'核验失败|核对失败|验证失败|证据不符|与原文不符|来源错误|资料不实|资料伪造|(?:^|[；;。])\s*(?:failed|(?:verification|review)[ _-]+failed|invalid source|rejected)\b', status, re.I):
        return 'failed'
    if re.search(r'未核验|未核对|未经核验|未经验证|未验证|未完成.*核验|核验未完成|核对未完成|未全部核验', status):
        return 'unverified'
    if re.search(r'待核验|待核对|待核实|待确认|部分核验|部分核对|尚未完成', status):
        return 'pending'
    complete = r'(?:^|[；;。])\s*(?:原文(?:文本及页面图像|文本|图像)?|证据页(?:文本及图像)?)?已核验\s*(?:$|[；;。])'
    cited = r'(?:^|[；;。])\s*(?:已(?:核对|目视核对|目视对照)(?:引用页原文|原文|文本|证据页|所列|扫描证据页)|已对照网页正文|已同时阅读可提取文字和对应PDF图像|原件图像目视核验|新增证据页已核对条目|指定正文已完成文本及图像核对|(?:所列证据页|指定正文页文本及图像|证据选页文本\/原图及实际印刷页|证据页渲染\+OCR|证据页\d+dpi完整渲染目视核对|引用选页)[^；;。？?]*已(?:核验|核对|复核)|\d{4}-\d{2}-\d{2}按对应PDF页文本及图像逐条核对)(?:[^；;。？?]*)(?:$|[；;。])'
    return 'verified' if re.search(complete, status) or re.search(cited, status) else 'unspecified'


def finding(rule, message, *, entry_id=None, source_id=None, path='', line=None,
            field='', locator='', observed=None):
    category, severity, suggestion = RULES[rule]
    location = {'path': path, 'line': line, 'field': field, 'locator': locator}
    # Line numbers are relocatable evidence, not finding identity.
    identity = [rule, entry_id, source_id, path, field, message]
    if (message in ('条目编号重复', '来源编号重复') or rule.startswith('body.') or
            (entry_id is None and source_id is None)):
        identity.append(line)
    return {'finding_id': 'KQ-' + fingerprint(identity)[:20], 'rule_id': rule,
            'entry_id': entry_id, 'source_id': source_id, 'category': category,
            'severity': severity, 'message': message, 'evidence': location,
            'observed': observed, 'suggestion': suggestion}


def body_checks(entry, body, path, line):
    """Recognize labelled fields, but accept legacy prose, lists and tables."""
    out = []
    def add(rule, message, field='', offset=0, observed=None):
        out.append(finding(rule, message, entry_id=entry['entry_id'],
                           source_id=entry['source_id'], path=path,
                           line=line + offset, field=field,
                           locator=entry['locator'], observed=observed))
    labels = {'故障现象', '可能原因', '原表可能原因', '诊断步骤', '维修建议',
              '针对处理', '适用条件', '适用限制', '整理边界', '手册事实',
              '证据', '资料来源', '来源', '来源编号', '验证状态', '状态'}
    seen = set()
    for offset, text in enumerate(body.splitlines(), 1):
        match = re.match(r'^\s*(?:-\s+)?([^：:\n]{1,20})[：:]\s*(.*)$', text)
        if not match or match[1] not in labels:
            continue
        name, value = match.groups()
        if name in seen:
            add('body.field', f'字段重复：{name}', name, offset)
        if not value.strip():
            add('body.field', f'已标注字段为空：{name}', name, offset)
        seen.add(name)
        if name in {'证据', '资料来源', '来源', '来源编号'}:
            ids = re.findall(r'(?<![A-Z0-9-])SRC-[A-Z0-9]+(?:-[A-Z0-9]+)*', value)
            unexpected = sorted(set(ids) - {entry['source_id']})
            if unexpected:
                add('body.source', '来源行包含与索引不同的来源编号', name, offset, unexpected)
        if name in {'验证状态', '状态'} and value.strip():
            actual, indexed = reference_verification(value), reference_verification(entry['status'])
            if actual != indexed and 'unspecified' not in (actual, indexed):
                add('body.status', '正文与索引可识别的核验分类不同', name, offset,
                    {'body': actual, 'index': indexed})
    if '\ufffd' in body or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', body):
        add('body.encoding', '正文含替换字符或异常控制字符')
    if len(body.encode('utf-16-le')) // 2 > 1200:
        add('body.length', '正文超过现有诊断提示词的1200字符上限')
    if entry['entry_type'] != '资料缺口' and re.search(
            r'(?im)^\s*(?:-\s*)?(?:(?:' + '|'.join(labels) + r')[：:]\s*)?(?:TODO|TBD|N/A|待补|待整理|暂无)\s*[。.]?\s*$', body):
        add('body.placeholder', '正文或已标注字段仍为占位内容')
    if {'故障现象', '原表可能原因', '针对处理'} <= seen:
        style = 'fault_case'
    elif {'故障现象', '可能原因', '诊断步骤', '维修建议'} <= seen:
        style = 'repair_fields'
    elif '手册事实' in seen:
        style = 'manual_fact'
    else:
        style = 'legacy'
    return out, style


def safe_output(path, repo):
    """Reports/cache may not overwrite knowledge, source code or Git metadata."""
    repo = Path(repo).resolve()
    lexical = Path(os.path.abspath(path))
    target = lexical.resolve()
    allowed = (repo / 'server/data/knowledge-quality', repo / 'work/knowledge-quality')
    for candidate in (lexical, target):
        if candidate.is_relative_to(repo) and not any(candidate.is_relative_to(area) for area in allowed):
            raise ValueError('仓库内报告/缓存仅可写入server/data/knowledge-quality或work/knowledge-quality')
    return target


def atomic_write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf8', dir=path.parent,
                                         delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(text)
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


class IncrementalCache:
    """Only rule results are reused; input hashes and global uniqueness are fresh."""
    def __init__(self, path, engine, full=False):
        self.path, self.engine, self.previous, self.current = path, engine, {}, {}
        self.stats = collections.Counter()
        self.note = None
        if path and Path(path).exists() and not full:
            try:
                value = json.loads(Path(path).read_text('utf8'))
                if value['schema_version'] == SCHEMA_VERSION and value['engine'] == engine:
                    if not isinstance(value['records'], dict):
                        raise ValueError('records必须为对象')
                    self.previous = value['records']
            except (ValueError, OSError, KeyError, TypeError):
                self.note = '缓存损坏或格式不兼容，已完整重检；缓存不是权威证据。'

    def run(self, kind, key, dependency, callback):
        token = fingerprint([self.engine, dependency])
        previous = self.previous.get(key)
        if (isinstance(previous, dict) and previous.get('fingerprint') == token and
                isinstance(previous.get('result'), dict) and
                previous.get('checksum') == fingerprint(previous['result'])):
            result = copy.deepcopy(previous['result'])
            self.stats[kind + '_reused'] += 1
        else:
            result = callback()
            self.stats[kind + '_checked'] += 1
        self.current[key] = {'fingerprint': token, 'result': result, 'checksum': fingerprint(result)}
        return result

    def save(self):
        if self.path:
            atomic_write(self.path, json.dumps({'schema_version': SCHEMA_VERSION,
                         'engine': self.engine, 'records': self.current}, ensure_ascii=False) + '\n')


def markdown_report(report):
    def cell(value):
        return str(value if value is not None else '—').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('|', '\\|').replace('\r', ' ').replace('\n', '<br>')
    summary = report['summary']
    lines = ['# 维修知识库规则清洗报告', '', report['scope'], '',
             f"生成时间（UTC）：{report['generated_at_utc']}",
             f"快照：`{report['snapshot']['sha256']}`；规则版本：{report['rules_version']}", '',
             f"来源 {summary['sources']}；条目 {summary['entries']}；错误 {summary['errors']}；警告 {summary['warnings']}；提示 {summary['info']}。", '',
             '状态分类仅描述现有严格解析器结果；unspecified不等于未经人工核对。', '',
             '| verified | pending | unverified | unspecified |',
             '|---|---|---|---|',
             '| ' + ' | '.join(str(report['verification_counts'][s]) for s in STATES) + ' |', '',
             '## 按规则统计', '', '| 规则 | 数量 |', '|---|---|',
             *[f'| {cell(rule)} | {count} |' for rule, count in report['summary']['by_rule'].items()], '',
             '## 规则问题', '',
             '| 问题编号／规则 | 条目／来源 | 严重程度 | 具体问题 | 原始值 | 证据位置 | 处理建议 |',
             '|---|---|---|---|---|---|---|']
    for item in report['findings']:
        evidence = item['evidence']
        location = f"{evidence['path']}:{evidence['line'] or '—'} {evidence['field']} {evidence['locator']}"
        lines.append('| ' + ' | '.join(cell(x) for x in [item['finding_id'] + ' / ' + item['rule_id'],
                     f"{item['entry_id'] or '—'} / {item['source_id'] or '—'}", item['severity'],
                     item['message'], item['observed'], location, item['suggestion']]) + ' |')
    if not report['findings']:
        lines.append('| — | — | — | 本次规则未发现问题；不等于事实均已验证 | — | — | — |')
    lines += ['', '## 执行与限制', '', '```json',
              json.dumps({'incremental': report['incremental'], 'performance': report['performance']},
                         ensure_ascii=False, indent=2), '```', '',
              '只读检查，不修改验证状态，不证明全文事实、厂家确认或实车验证。未执行语义去重或AI冲突检测。', '']
    return '\n'.join(lines)
