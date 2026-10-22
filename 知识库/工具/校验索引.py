#!/usr/bin/env python3
"""Single read-only archive validator: integrity checks plus quality reports."""
import argparse
import collections
import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.parse import urlparse

# The legacy command without -B must also leave the knowledge tree untouched.
sys.dont_write_bytecode = True

from knowledge_quality import (IncrementalCache, RULES_VERSION, SCHEMA_VERSION, STATES,
                               atomic_write, body_checks, finding, fingerprint,
                               markdown_report, reference_verification, safe_output)

ENTRY_TYPES = {'维护/故障知识', '操作/维护知识', '安全操作', '系统安装/调试',
               '系统适用边界', '资料索引', '资料核验', '机型资料', '资料缺口'}
REPO = Path(__file__).resolve().parents[2]
INDEX_PATH = Path('知识库/整理后的知识库/农用拖拉机知识库')
IDENTIFIER = re.compile(r'[A-Z0-9]+(?:-[A-Z0-9]+)*')
LEGACY_BRAND_LABELS = {'雷沃欧豹': '雷沃', '雷沃阿波斯': '雷沃', '千寻位置 / 千耘': '千寻位置'}
MODEL_ID = re.compile(r'[0-9A-Z\u4e00-\u9fff()][0-9A-Z\u4e00-\u9fff()\-]*')
SOURCE_FIELDS = ['source_id', 'brand', 'model', 'path', 'url', 'version', 'scope_boundary', 'sha256']
ENTRY_FIELDS = ['entry_id', 'source_id', 'brand', 'model', 'title', 'knowledge_path', 'locator', 'status', 'entry_type']
# Optional per-entry roles/risk (schema 2026-10-21). Absent fields mean "not yet tagged",
# never "no symptom" or "low risk"; existing entries stay valid without them.
ENTRY_ROLES = ('symptom', 'cause', 'check', 'action', 'retest')
ROLE_BASES = ('原文标记', '人工核对')
ROLE_SIDECAR = 'entry-roles.jsonl'
ROLE_REVIEW_QUEUE = 'role-review-queue.jsonl'
RISK_LEVELS = ('high', 'medium', 'low')
# Information-only categories are never presented as repair judgement, so they carry no roles/risk.
NON_DIAGNOSTIC_ENTRY_TYPES = {'系统适用边界', '资料索引', '资料核验', '机型资料', '资料缺口'}
# Explicit field labels in the Markdown section that justify role_basis=原文标记.
ROLE_MARKERS = {
    'symptom': r'故障现象|适用现象|现象|故障症状|症状|故障证据',
    'cause': r'(?:原表|故障表)?(?:列出的)?可能原因(?:选摘)?|故障原因|故障表可能原因',
    'check': r'诊断步骤|检查方法|检查步骤|排查步骤|故障排查|初步核对|(?:原文)?核对方向|初步方向',
    'action': r'维修建议|维修方法|维修步骤|针对处理|处理建议|处理方法|(?:对应|原文|手册)处理方向|排除方法',
    'retest': r'复检|复查|复测|验收|恢复验收|试运转检查|故障排除确认',
}


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def page_count(path):
    if shutil.which('pdfinfo'):
        result = subprocess.run(['pdfinfo', str(path)], check=True,
                                capture_output=True, text=True, timeout=30)
        match = re.search(r'^Pages:\s*(\d+)\s*$', result.stdout, re.M)
        if not match:
            raise ValueError('pdfinfo未返回页数')
        return int(match[1])
    try:
        import fitz
    except ImportError as error:
        raise RuntimeError('核对PDF页数需要pdfinfo（Poppler）或PyMuPDF') from error
    with fitz.open(path) as document:
        document.load_page(document.page_count - 1)
        return document.page_count


def cited_pages(text):
    pages = set()
    for match in re.finditer(r'PDF\s*(?:物理)?\s*第?\s*([0-9][0-9\s、,，～~至\-–—/]*)\s*页', text, re.I):
        for part in re.split(r'[、,，/]', match[1]):
            values = [int(value) for value in re.findall(r'\d+', part)]
            if len(values) == 2 and re.search(r'[～~至\-–—]', part):
                if not 0 <= values[1] - values[0] <= 1000:
                    raise ValueError('证据页范围无效')
                pages.update(range(values[0], values[1] + 1))
            else:
                pages.update(values)
    return sorted(pages)


class CheckFailure(ValueError):
    def __init__(self, rule, message, field=''):
        super().__init__(message)
        self.rule, self.field = rule, field


def require(condition, rule, message, field=''):
    if not condition:
        raise CheckFailure(rule, message, field)


def check_conditions(record):
    if 'emission_stage_unknown' in record:
        require(isinstance(record['emission_stage_unknown'], bool) and
                not (record['emission_stage_unknown'] and record.get('emission_stage') is not None),
                'scope.condition', '未知排放标记须为布尔值，且不能与来源明确阶段同时成立', 'emission_stage_unknown')
    for field, allowed in [('emission_stage', ['国三', '国四']),
                           ('configuration', ['CAB', 'ROPS']),
                           ('drive_configuration', ['2WD', '4WD'])]:
        require(field not in record or record[field] in allowed,
                'scope.condition', f'{field}条件无效', field)


def role_marker(role, body):
    return bool(re.search(r'^\s*(?:[-*]\s*)?\**(?:' + ROLE_MARKERS[role] + r')\**\s*[：:]', body, re.M))


def check_roles(entry, body):
    """Validate optional roles/risk fields; body is the entry's Markdown section text."""
    tagged = [field for field in ['roles', 'role_basis', 'risk_level', 'risk_basis'] if field in entry]
    if not tagged:
        return
    require(entry['entry_type'] not in NON_DIAGNOSTIC_ENTRY_TYPES, 'entry.roles',
            '资料信息类条目不标注角色或风险等级', tagged[0])
    if 'roles' in entry or 'role_basis' in entry:
        roles = entry.get('roles')
        require(isinstance(roles, list) and bool(roles) and len(set(roles)) == len(roles) and
                all(role in ENTRY_ROLES for role in roles) and
                roles == sorted(roles, key=ENTRY_ROLES.index),
                'entry.roles', 'roles须为symptom/cause/check/action/retest的非空、无重复子集并按此顺序', 'roles')
        require(entry.get('role_basis') in ROLE_BASES, 'entry.roles', 'roles须同时填写role_basis（原文标记或人工核对）', 'role_basis')
        if entry['role_basis'] == '原文标记':
            missing = [role for role in roles if not role_marker(role, body)]
            require(not missing, 'entry.roles', f"role_basis=原文标记，但正文缺少对应字段标记：{'、'.join(missing)}", 'roles')
    if 'risk_level' in entry or 'risk_basis' in entry:
        require(entry.get('risk_level') in RISK_LEVELS, 'entry.roles', 'risk_level只能为high、medium或low', 'risk_level')
        basis = entry.get('risk_basis')
        require(isinstance(basis, str) and bool(basis.strip()) and basis == basis.strip(), 'entry.roles',
                'risk_level须同时填写非空risk_basis（原文警示或人工核对依据）', 'risk_basis')


def check_models(models):
    return (isinstance(models, list) and bool(models) and
            all(isinstance(model, str) and model.strip() for model in models) and
            len(set(models)) == len(models))


class ArchiveAudit:
    def __init__(self, repo, proofs, cache_path, full):
        self.repo = Path(repo).resolve()
        self.index = self.repo / INDEX_PATH
        self.proofs = proofs
        self.files, self.file_stats, self.documents = {}, {}, {}
        self.findings = []
        self.hash_bytes = 0
        engine = [RULES_VERSION, sys.version, digest(Path(__file__)),
                  digest(Path(__file__).with_name('knowledge_quality.py')),
                  shutil.which('pdfinfo')]
        backend = shutil.which('pdfinfo')
        if backend:
            engine.append(self.stat(Path(backend)))
        else:
            from importlib.metadata import PackageNotFoundError, version
            try:
                engine.append(version('PyMuPDF'))
            except PackageNotFoundError:
                engine.append(None)
        self.cache = IncrementalCache(cache_path, fingerprint(engine), full)

    @staticmethod
    def stat(path):
        value = path.stat()
        return [value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_ino]

    def track(self, path):
        path = path.resolve()
        if path not in self.files:
            before = self.stat(path)
            self.files[path] = digest(path)
            self.hash_bytes += before[0]
            self.file_stats[path] = before
            require(before == self.stat(path), 'snapshot.changed', '文件在哈希期间变化')
        return self.files[path]

    def relative(self, path):
        return path.relative_to(self.repo).as_posix() if path.is_relative_to(self.repo) else str(path)

    def resolved(self, relative, area):
        rule = 'source.file' if area == '知识库/原始农机说明书' else 'entry.path'
        require(isinstance(relative, str) and not Path(relative).is_absolute(),
                rule, '索引路径须为仓库相对路径')
        path = (self.repo / relative).resolve()
        require(path.is_relative_to((self.repo / area).resolve()) and path.is_file(),
                rule, f'路径不存在或超出资料目录：{relative}')
        return path

    def dependency(self, relative, area):
        try:
            return self.track(self.resolved(relative, area))
        except (ValueError, OSError) as error:
            return {'unavailable': str(error)}

    def emit(self, rule, message, record=None, path='', line=None, field='', observed=None):
        record = record if isinstance(record, dict) else {}
        # sources.json is an array, so its record ordinal is a JSON pointer,
        # never a fabricated physical line number.
        if path.endswith('/sources.json') and line is not None:
            field = f'/{line - 1}' + (f'/{field}' if field else '')
            line = None
        self.findings.append(finding(rule, message,
                             entry_id=record.get('entry_id') if isinstance(record.get('entry_id'), str) else None,
                             source_id=record.get('source_id') if isinstance(record.get('source_id'), str) else None,
                             path=path, line=line, field=field,
                             locator=record.get('locator', '') if isinstance(record.get('locator', ''), str) else '', observed=observed))

    def record_fields(self, record, required, path, line):
        if not isinstance(record, dict):
            self.emit('record.required', '索引记录必须是对象', path=path, line=line)
            return False
        valid = True
        for field in required:
            value = record.get(field)
            if not isinstance(value, str) or not value.strip():
                self.emit('record.required', f'缺少非空字符串：{field}', record, path, line, field)
                valid = False
        return valid

    def supplementary_fields(self, record, path, line):
        for field in set(SOURCE_FIELDS + ENTRY_FIELDS + ['scope_boundary', 'use', 'status', 'source_level', 'collection_id']):
            if field not in record:
                continue
            value = record[field]
            if not isinstance(value, str) or not value.strip():
                if field in ['scope_boundary', 'use', 'status', 'source_level', 'collection_id']:
                    self.emit('record.optional', f'已填写字段须为非空字符串：{field}', record, path, line, field)
                continue
            if value != value.strip():
                self.emit('record.whitespace', f'字段含首尾空白：{field}', record, path, line, field)
            if re.fullmatch(r'TODO|TBD|N/A|[-—]+', value, re.I):
                self.emit('record.placeholder', f'字段仍为占位符：{field}', record, path, line, field)
        if 'case_key' in record:
            key = record['case_key']
            source = record.get('source_id')
            legacy_pattern = (re.escape(source) + r'/[1-9]\d*-[1-9]\d*/现象[1-9]\d*/原因\(([1-9]\d*)\)→排除\(\1\)'
                              if isinstance(source, str) else None)
            valid = isinstance(key, str) and (re.fullmatch(r'[a-f0-9]{64}', key) or
                    legacy_pattern is not None and re.fullmatch(legacy_pattern, key))
            if not valid:
                self.emit('record.optional', 'case_key须为64位摘要或带本来源、表号及对应原因/排除项的定位键', record, path, line, 'case_key')

    def source_checks(self, source, position):
        start = len(self.findings)
        location = (INDEX_PATH / 'sources.json').as_posix()
        result = {'checked': None, 'page_count': None}
        if not self.record_fields(source, SOURCE_FIELDS, location, position):
            return {**result, 'findings': self.findings[start:]}
        self.supplementary_fields(source, location, position)
        try:
            require(bool(IDENTIFIER.fullmatch(source['source_id'])), 'source.id', '来源编号格式无效', 'source_id')
            url = urlparse(source['url'])
            require(url.scheme in ['http', 'https'] and bool(url.netloc), 'source.url', '来源网址须为完整HTTP(S)链接', 'url')
            check_conditions(source)
            title_status = source.get('title_status')
            require(title_status in [None, '已核对', '待核实'], 'source.title', 'title_status只能为已核对或待核实', 'title_status')
            require((isinstance(source.get('title'), str) and bool(source['title'].strip())) or title_status == '待核实',
                    'source.title', '来源须登记书名/标题，未核实时须标明title_status=待核实', 'title')
            require(title_status != '已核对' or (isinstance(source.get('title_evidence'), str) and bool(source['title_evidence'].strip())),
                    'source.title', '已核对书名须记录title_evidence（封面页或网页标题位置）', 'title_evidence')
            for field in ['sub_brand', 'product_line', 'brand_label']:
                require(field not in source or (isinstance(source[field], str) and bool(source[field].strip())),
                        'source.brand', f'{field}须为非空字符串', field)
            require(source.get('brand') not in LEGACY_BRAND_LABELS, 'source.brand', '品牌须用统一主品牌，子品牌写入sub_brand/product_line', 'brand')
            ids = source.get('model_ids')
            require(ids is None or isinstance(ids, list) and bool(ids) and len(set(ids)) == len(ids) and
                    all(isinstance(x, str) and bool(MODEL_ID.fullmatch(x)) for x in ids),
                    'source.model_ids', 'model_ids须为非空、无重复的规范型号编号列表', 'model_ids')
            if 'models' in source:
                require(check_models(source['models']), 'scope.models', '精确型号列表无效或重复', 'models')
            path = self.resolved(source['path'], '知识库/原始农机说明书')
            require(bool(re.fullmatch(r'[a-f0-9]{64}', source['sha256'])) and self.track(path) == source['sha256'],
                    'source.file', '本地文件SHA256不符', 'sha256')
            require(type(source.get('bytes')) is int and path.stat().st_size == source['bytes'],
                    'source.file', '本地文件字节数不符', 'bytes')
            checked = {'source_id': source['source_id'], 'path': source['path'], 'sha256_matches': True,
                       'bytes_matches': True, 'actual_bytes': path.stat().st_size}
            require('storage_type' not in source or source['storage_type'] == 'link_and_source_record',
                    'source.file', '未知的原件存储模式', 'storage_type')
            if source.get('storage_type') == 'link_and_source_record':
                require(path.suffix == '.md', 'source.file', '来源记录模式须指向Markdown记录', 'path')
                for field in ['manual_bytes', 'manual_pdf_pages']:
                    require(type(source.get(field)) is int and source[field] > 0, 'source.file', f'{field}缺少原件完整性记录', field)
                require(isinstance(source.get('manual_sha256'), str) and bool(re.fullmatch(r'[a-f0-9]{64}', source['manual_sha256'])),
                        'source.file', '缺少PDF原件哈希', 'manual_sha256')
                result['page_count'] = source['manual_pdf_pages']
                checked.update(referenced_pdf_pages=source['manual_pdf_pages'], manual_sha256=source['manual_sha256'])
                proof = self.proofs.get(source['source_id'])
                if proof:
                    require(self.track(proof) == source['manual_sha256'] and proof.stat().st_size == source['manual_bytes'],
                            'source.file', '临时PDF原件哈希或字节数不符', 'manual_sha256')
                    require(page_count(proof) == source['manual_pdf_pages'], 'source.file', '临时PDF原件页数不符', 'manual_pdf_pages')
                checked['external_pdf_verified'] = bool(proof)
                if not proof:
                    self.emit('source.external', '本次只核对本地来源记录，未重新取得外链PDF；采用取得时登记的原件哈希/页数',
                              source, location, position, 'manual_sha256')
            elif path.suffix.lower() == '.pdf':
                actual = page_count(path)
                require(source.get('pdf_pages') == actual, 'source.file', 'PDF页数不符', 'pdf_pages')
                result['page_count'] = actual
                checked['pdf_pages'] = actual
            pages = source.get('verified_pdf_pages', {})
            require(isinstance(pages, dict) and all(isinstance(value, str) and value.strip() for value in pages.values()),
                    'source.pages', '已核对证据页须为页号到说明的对象', 'verified_pdf_pages')
            if result['page_count']:
                for key in pages:
                    numbers = cited_pages(f'PDF第{key}页')
                    require(numbers and all(1 <= number <= result['page_count'] for number in numbers),
                            'source.pages', f'已核对页越界：{key}', 'verified_pdf_pages')
            result['checked'] = checked
            if not source.get('source_level'):
                self.emit('source.level', '来源未记录source_level，不能据此判定不可信', source, location, position, 'source_level')
        except (ValueError, TypeError, OSError, RuntimeError, subprocess.SubprocessError) as error:
            self.emit(getattr(error, 'rule', 'source.file'), str(error), source, location, position, getattr(error, 'field', ''))
        return {**result, 'findings': self.findings[start:]}

    def document(self, relative):
        path = self.resolved(relative, '知识库/整理后的知识库')
        require(path.suffix == '.md' and path.name not in ['README.md', '待补资料.md'] and '采集记录' not in path.parts,
                'entry.path', '条目须指向正式知识卡', 'knowledge_path')
        if path not in self.documents:
            self.track(path)
            text = path.read_text('utf8')
            sections = {}
            for match in re.finditer(r'^##\s+([^\r\n]+)\r?\n([\s\S]*?)(?=^##\s+|\Z)', text, re.M):
                key = match[1].split('｜')[0].strip()
                require(key not in sections, 'entry.section', f'Markdown标题键重复：{key}', 'heading')
                body_start = match.start(2) + len(match[2]) - len(match[2].lstrip())
                sections[key] = {'heading': match[1].strip(), 'body': match[2].strip(),
                                 'line': text.count('\n', 0, body_start)}
            self.documents[path] = sections
        return self.documents[path]

    def entry_checks(self, entry, position, source, source_result, document):
        start = len(self.findings)
        location = (INDEX_PATH / 'entries.jsonl').as_posix()
        result = {'verification': reference_verification(entry.get('status')), 'body_format': None}
        if not self.record_fields(entry, ENTRY_FIELDS, location, position):
            return {**result, 'findings': self.findings[start:]}
        self.supplementary_fields(entry, location, position)
        if result['verification'] == 'unspecified':
            self.emit('status.unspecified', '原状态未被现有严格核验解析器识别，不等于未人工核对', entry, location, position, 'status', entry['status'])
        try:
            require(bool(IDENTIFIER.fullmatch(entry['entry_id'])), 'entry.id', '条目编号格式无效', 'entry_id')
            require(bool(IDENTIFIER.fullmatch(entry['source_id'])), 'source.id', '条目来源编号格式无效', 'source_id')
            require('summary' not in entry, 'entry.summary', '事实正文仅在Markdown知识卡维护，条目索引不得保留summary副本', 'summary')
            require(entry['entry_type'] in ENTRY_TYPES, 'entry.type', '条目类别无效', 'entry_type')
            require(source and entry['brand'] in [source.get('brand'), source.get('brand_label')], 'entry.source', '来源不存在或品牌不一致', 'source_id')
            if 'models' in entry:
                models = entry['models']
                require(check_models(models) and isinstance(source.get('models'), list) and all(model in source['models'] for model in models),
                        'scope.models', '条目精确型号须为来源型号列表的非空、无重复子集', 'models')
            check_conditions(entry)
            for field in ['configuration', 'drive_configuration', 'emission_stage']:
                require(not entry.get(field) or not source.get(field) or entry[field] == source[field],
                        'scope.condition', f'条目与来源的{field}条件冲突', field)
            document = document()
            section = document.get(entry['entry_id'], {})
            body = section.get('body', '')
            require(section.get('heading') == f"{entry['entry_id']}｜{entry['title']}" and bool(body),
                    'entry.section', 'Markdown编号/标题/正文缺失或不一致', 'heading')
            require(bool(re.search(r'(?<![A-Za-z0-9_-])' + re.escape(entry['source_id']) + r'(?![A-Za-z0-9_-])', body)),
                    'entry.evidence', '正文没有确切来源编号', 'source_id')
            count = source_result.get('page_count') if source_result else None
            if count:
                pages = cited_pages(entry['locator'])
                require(pages and all(1 <= page <= count for page in pages), 'entry.evidence', 'PDF证据页缺失或越界', 'locator')
            check_roles(entry, body)
            additions, style = body_checks(entry, body, entry['knowledge_path'], section['line'])
            self.findings.extend(additions)
            result['body_format'] = style
        except (ValueError, TypeError, OSError) as error:
            self.emit(getattr(error, 'rule', 'entry.path'), str(error), entry, location, position, getattr(error, 'field', ''))
        return {**result, 'findings': self.findings[start:]}

    def read_indices(self):
        sources, entries = [], []
        path = self.index / 'sources.json'
        try:
            self.track(path)
            sources = json.loads(path.read_text('utf8'))
            require(isinstance(sources, list), 'index.json', 'sources.json必须是数组')
        except (ValueError, OSError) as error:
            self.emit('index.json', str(error), path=self.relative(path))
            sources = []
        path = self.index / 'entries.jsonl'
        try:
            self.track(path)
            for line, text in enumerate(path.read_text('utf8').splitlines(), 1):
                if text.strip():
                    try:
                        entries.append((line, json.loads(text)))
                    except ValueError as error:
                        self.emit('index.json', str(error), path=self.relative(path), line=line)
        except (ValueError, OSError) as error:
            self.emit('index.json', str(error), path=self.relative(path))
        self.merge_role_sidecar(entries)
        return sources, entries

    def merge_role_sidecar(self, entries):
        """entries.jsonl 有字节锁定的基线测试，角色/风险字段改存旁路文件 entry-roles.jsonl（字段与 PR #63 架构相同），
        加载时并入内存条目，再按同一 check_roles 规则校验；role-review-queue.jsonl 为待人工核对队列。"""
        by_id = {e.get('entry_id'): e for _, e in entries if isinstance(e, dict)}
        tagged = set()
        for name, allowed in [(ROLE_SIDECAR, {'entry_id', 'roles', 'role_basis', 'risk_level', 'risk_basis'}),
                              (ROLE_REVIEW_QUEUE, None)]:
            path = self.index / name
            if not path.exists():
                continue
            self.track(path)
            seen = set()
            for line, text in enumerate(path.read_text('utf8').splitlines(), 1):
                if not text.strip():
                    continue
                try:
                    record = json.loads(text)
                    identity = record.get('entry_id') if isinstance(record, dict) else None
                    require(identity in by_id, 'entry.roles', f'{name}引用的条目不存在', 'entry_id')
                    require(identity not in seen, 'entry.roles', f'{name}条目编号重复', 'entry_id')
                    seen.add(identity)
                    entry = by_id[identity]
                    if allowed is not None:
                        extra = set(record) - allowed
                        require(not extra, 'entry.roles', f"{name}含未知字段：{'、'.join(sorted(extra))}", 'entry_id')
                        clash = [k for k in record if k != 'entry_id' and k in entry]
                        require(not clash, 'entry.roles', f"{name}与entries.jsonl重复填写：{'、'.join(clash)}", 'entry_id')
                        entry.update({k: v for k, v in record.items() if k != 'entry_id'})
                        tagged.add(identity)
                    else:
                        require(identity not in tagged and 'roles' not in entry, 'entry.roles',
                                '已标注角色的条目不得仍在人工核对队列', 'entry_id')
                        require(record.get('status') in ('pending', 'reviewed'), 'entry.roles',
                                '人工核对队列status须为pending或reviewed', 'status')
                except (ValueError, TypeError) as error:
                    self.emit(getattr(error, 'rule', 'index.json'), str(error), path=self.relative(path), line=line,
                              field=getattr(error, 'field', ''))

    def run(self):
        started = time.perf_counter()
        sources, entries = self.read_indices()
        source_map, source_results, checked, seen_sources, seen_entries = {}, {}, [], set(), set()
        kinds, states, formats = collections.Counter(), collections.Counter(), collections.Counter()
        role_counts, risk_counts, role_bases = collections.Counter(), collections.Counter(), collections.Counter()
        tagged_roles = tagged_risk = 0
        document_paths = set()
        for position, source in enumerate(sources, 1):
            identity = source.get('source_id') if isinstance(source, dict) else None
            identity = identity if isinstance(identity, str) else None
            if identity in seen_sources:
                self.emit('source.id', '来源编号重复', source, (INDEX_PATH / 'sources.json').as_posix(), position, 'source_id')
            if identity:
                seen_sources.add(identity)
                source_map.setdefault(identity, source)
            dependency = self.dependency(source.get('path'), '知识库/原始农机说明书') if isinstance(source, dict) else None
            proof = self.proofs.get(identity)
            try:
                proof_dependency = self.track(proof) if proof else None
            except OSError as error:
                proof_dependency = str(error)
            start = len(self.findings)
            result = self.cache.run('sources', f'source:{position}', [source, dependency, proof_dependency],
                                    lambda: self.source_checks(source, position))
            self.findings[start:] = result['findings']
            if identity and identity not in source_results:
                source_results[identity] = result
            if result['checked']:
                checked.append(result['checked'])
        for identity in self.proofs:
            if identity not in source_map or source_map[identity].get('storage_type') != 'link_and_source_record':
                self.emit('source.file', '临时PDF没有对应的链接来源', {'source_id': identity}, field='external_pdf')
        for position, entry in entries:
            if not isinstance(entry, dict):
                self.record_fields(entry, ENTRY_FIELDS, (INDEX_PATH / 'entries.jsonl').as_posix(), position)
                continue
            identity = entry.get('entry_id')
            identity = identity if isinstance(identity, str) else None
            if identity in seen_entries:
                self.emit('entry.id', '条目编号重复', entry, (INDEX_PATH / 'entries.jsonl').as_posix(), position, 'entry_id')
            if identity:
                seen_entries.add(identity)
            source_id = entry.get('source_id')
            source = source_map.get(source_id) if isinstance(source_id, str) else None
            source_result = source_results.get(source_id) if isinstance(source_id, str) else None
            dependency = self.dependency(entry.get('knowledge_path'), '知识库/整理后的知识库')
            start = len(self.findings)
            result = self.cache.run('entries', f'entry:{position}', [entry, dependency, source, source_result],
                                    lambda: self.entry_checks(entry, position, source, source_result,
                                                             lambda: self.document(entry.get('knowledge_path'))))
            self.findings[start:] = result['findings']
            states[result['verification']] += 1
            if isinstance(entry.get('entry_type'), str):
                kinds[entry['entry_type']] += 1
            if isinstance(entry.get('roles'), list):
                tagged_roles += 1
                role_counts.update(role for role in entry['roles'] if isinstance(role, str))
                role_bases[str(entry.get('role_basis'))] += 1
            if 'risk_level' in entry:
                tagged_risk += 1
                risk_counts[str(entry['risk_level'])] += 1
            if result['body_format']:
                formats[result['body_format']] += 1
                document_paths.add(entry['knowledge_path'])
        common_summary = None
        common_path = self.index / '通用框架.json'
        if common_path.exists():
            try:
                from 校验通用框架 import validate_common_framework
                self.track(common_path)
                self.track(self.index / 'hierarchy.json')
                common_summary = validate_common_framework(self.repo)
            except (ValueError, OSError, KeyError, TypeError) as error:
                self.emit('index.json', f'通用框架：{error}', path=self.relative(common_path))
        for path, before in self.file_stats.items():
            try:
                unchanged = before == self.stat(path)
            except OSError:
                unchanged = False
            if not unchanged:
                self.emit('snapshot.changed', '文件在扫描期间变化', path=self.relative(path))
        findings = sorted(self.findings, key=lambda x: (x['evidence']['path'], x['evidence']['line'] or 0, x['rule_id'], x['finding_id']))
        severity = collections.Counter(x['severity'] for x in findings)
        errors = [f"{x['entry_id'] or x['source_id'] or x['evidence']['path']}：{x['message']}" for x in findings if x['severity'] == 'error']
        notes = [f"{x['source_id']}：{x['message']}" for x in findings if x['rule_id'] == 'source.external']
        if self.cache.note:
            notes.append(self.cache.note)
        inputs = {self.relative(path): value for path, value in self.files.items()}
        if self.cache.path in self.files:
            raise ValueError('缓存不得覆盖被检查的输入文件')
        if not any(x['rule_id'] == 'snapshot.changed' for x in findings):
            self.cache.save()
        return {
            'schema_version': SCHEMA_VERSION, 'rules_version': RULES_VERSION,
            'generated_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'scope': '文件/来源/编号/标题/适用条件/正文格式规则校验；不等于全文事实审校、厂家确认或实车验证',
            'snapshot': {'sha256': fingerprint(inputs), 'files': inputs},
            'summary': {'sources': len(sources), 'entries': len(entries), 'knowledge_documents': len(document_paths),
                        'retained_pdf_files': sum('pdf_pages' in x for x in checked),
                        'link_only_pdf_sources': sum('referenced_pdf_pages' in x for x in checked),
                        'entry_types': dict(kinds), 'errors': severity['error'], 'warnings': severity['warning'],
                        'info': severity['info'], 'findings': len(findings),
                        'affected_entries': len({x['entry_id'] for x in findings if x['entry_id']}),
                        'by_rule': dict(collections.Counter(x['rule_id'] for x in findings)),
                        'by_category': dict(collections.Counter(x['category'] for x in findings)),
                        'role_schema': {'entries_with_roles': tagged_roles, 'entries_with_risk_level': tagged_risk,
                                        'roles': {role: role_counts[role] for role in ENTRY_ROLES},
                                        'role_basis': dict(role_bases), 'risk_levels': dict(risk_counts),
                                        'note': '未标注表示尚未整理，不表示无该角色或低风险'}},
            'verification_counts': {state: states[state] for state in STATES},
            'body_formats': dict(formats), 'sources': checked, 'errors': errors, 'notes': notes, 'findings': findings,
            'common_framework': common_summary,
            'incremental': {'enabled': bool(self.cache.path), **{key: self.cache.stats[key] for key in
                            ['sources_checked', 'sources_reused', 'entries_checked', 'entries_reused']},
                            'global_checks': '索引解析、编号唯一性、内容哈希与输入稳定性每次重检'},
            'performance': {'elapsed_ms': round((time.perf_counter() - started) * 1000, 3),
                            'hashed_files': len(inputs), 'hashed_bytes': self.hash_bytes,
                            'parsed_documents': len(self.documents)},
        }


def validate(repo=REPO, proofs=None, cache_path=None, full=False):
    cache_path = safe_output(cache_path, repo) if cache_path else None
    proofs = {key: Path(value).resolve() for key, value in (proofs or {}).items()}
    if cache_path in proofs.values():
        raise ValueError('缓存路径不得覆盖临时原件')
    return ArchiveAudit(repo, proofs, cache_path, full).run()


def main():
    parser = argparse.ArgumentParser(description='只读索引与知识质量规则校验；不修改知识、不下载文件')
    parser.add_argument('--report', type=Path, help='结构化JSON报告；保留原有summary/sources/errors/notes字段')
    parser.add_argument('--markdown', type=Path, help='同一次检查的人类可读Markdown报告')
    parser.add_argument('--cache', type=Path, help='可选增量缓存；不指定则不保存缓存')
    parser.add_argument('--full', action='store_true', help='忽略旧缓存，完整重检并更新显式指定的缓存')
    parser.add_argument('--external-pdf', action='append', default=[], metavar='SOURCE_ID=PATH',
                        help='核对仅存链接资料的临时PDF，可重复传入')
    args = parser.parse_args()
    proofs = {}
    for value in args.external_pdf:
        identity, separator, path = value.partition('=')
        if not separator or not identity or not path or identity in proofs:
            parser.error('--external-pdf须为唯一SOURCE_ID=PATH')
        proofs[identity] = Path(path).resolve()
    outputs = [safe_output(path, REPO) for path in [args.report, args.markdown, args.cache] if path]
    if len(set(outputs)) != len(outputs) or any(path in proofs.values() for path in outputs):
        parser.error('报告、缓存和临时原件路径不得互相覆盖')
    report = validate(proofs=proofs, cache_path=args.cache, full=args.full)
    protected = {(REPO / name).resolve() for name in report['snapshot']['files']}
    if any(path in protected for path in outputs):
        parser.error('报告或缓存不得覆盖被检查的输入文件')
    if args.report:
        atomic_write(safe_output(args.report, REPO), json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    if args.markdown:
        atomic_write(safe_output(args.markdown, REPO), markdown_report(report))
    print(json.dumps(report['summary'], ensure_ascii=False))
    for message in report['errors'] + report['notes']:
        print(message)
    return 1 if report['summary']['errors'] else 0


if __name__ == '__main__':
    # Windows pipes can default to a legacy code page even when files are UTF-8.
    # Keep the CLI contract UTF-8 without changing streams when imported as a library.
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding='utf-8')
    try:
        sys.exit(main())
    except (ValueError, OSError) as error:
        print(f'校验失败：{error}', file=sys.stderr)
        sys.exit(1)
