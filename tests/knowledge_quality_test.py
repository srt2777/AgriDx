"""Synthetic archive regressions; no production knowledge or database is written."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1] / '知识库/工具'
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('archive_validator', TOOLS / '校验索引.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
from knowledge_quality import RULES, body_checks, fingerprint, markdown_report, reference_verification, safe_output


class QualityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='agridx-quality-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.index = self.root / validator.INDEX_PATH
        self.index.mkdir(parents=True)
        self.sources, self.entries = [], []
        for number in range(2):
            sid, eid = f'SRC-TEST-{number}', f'TEST-{number}'
            raw = self.root / f'知识库/原始农机说明书/{number}.html'
            raw.parent.mkdir(parents=True, exist_ok=True)
            raw.write_text('test manual ' + str(number), encoding='utf8')
            source = {'source_id': sid, 'brand': '测试品牌', 'model': 'M1', 'models': ['M1'], 'title': '合成资料手册',
                      'path': raw.relative_to(self.root).as_posix(), 'url': 'https://example.invalid/manual',
                      'version': 'fixture-v1', 'scope_boundary': '仅测试M1', 'sha256': validator.digest(raw),
                      'bytes': raw.stat().st_size, 'source_level': '合成测试资料'}
            card = self.root / f'知识库/整理后的知识库/card-{number}.md'
            entry = {'entry_id': eid, 'source_id': sid, 'brand': source['brand'], 'model': 'M1',
                     'title': '测试章节', 'knowledge_path': card.relative_to(self.root).as_posix(),
                     'locator': '测试章节1', 'status': '已核验；未厂家复核/实车验证', 'entry_type': '维护/故障知识'}
            self.sources.append(source)
            self.entries.append(entry)
            self.card(number, f'自由正文，条件仍需核对。\n- 证据：{sid}；测试章节1。')
        self.cache = self.root / 'server/data/knowledge-quality/cache.json'
        self.write()

    def card(self, number, body):
        entry = self.entries[number]
        (self.root / entry['knowledge_path']).write_text(
            f"# 合成资料\n\n## {entry['entry_id']}｜{entry['title']}\n\n{body}\n", encoding='utf8')

    def write(self):
        (self.index / 'sources.json').write_text(json.dumps(self.sources, ensure_ascii=False), encoding='utf8')
        (self.index / 'entries.jsonl').write_text('\n'.join(json.dumps(e, ensure_ascii=False) for e in self.entries) + '\n', encoding='utf8')

    def scan(self, incremental=False, **kwargs):
        return validator.validate(self.root, cache_path=self.cache if incremental else None, **kwargs)

    def rules(self, report):
        return {x['rule_id'] for x in report['findings']}

    def test_default_is_read_only_and_accepts_legacy_cards(self):
        before = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        report = self.scan()
        self.assertEqual(report['summary']['findings'], 0)
        self.assertEqual(report['body_formats'], {'legacy': 2})
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_legacy_cli_without_B_does_not_create_bytecode_or_reports(self):
        tools = self.root / '知识库/工具'
        tools.mkdir()
        for name in ['校验索引.py', 'knowledge_quality.py']:
            (tools / name).write_bytes((TOOLS / name).read_bytes())
        before = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = subprocess.run([sys.executable, str(tools / '校验索引.py')], capture_output=True, timeout=15,
                                env={**os.environ, 'PYTHONUTF8': '0', 'PYTHONIOENCODING': 'cp1252'})
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf8'))
        self.assertEqual(json.loads(result.stdout.decode('utf8'))['entries'], 2)
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_cli_help_and_error_are_utf8_under_legacy_pipe_encoding(self):
        environment = {**os.environ, 'PYTHONUTF8': '0', 'PYTHONIOENCODING': 'cp1252'}
        command = [sys.executable, str(TOOLS / '校验索引.py')]
        help_result = subprocess.run(command + ['--help'], env=environment, capture_output=True, timeout=15)
        self.assertEqual(help_result.returncode, 0)
        self.assertIn('只读索引', help_result.stdout.decode('utf8'))
        error_result = subprocess.run(command + ['--report', str(TOOLS / 'knowledge_quality.py')],
                                      env=environment, capture_output=True, timeout=15)
        self.assertEqual(error_result.returncode, 1)
        self.assertIn('校验失败', error_result.stderr.decode('utf8'))
        self.assertIn('报告/缓存', error_result.stderr.decode('utf8'))

    def test_all_missing_required_fields_reported_without_crash(self):
        self.entries[0].update(status=None, locator='', title=4)
        self.sources[0]['url'] = None
        self.write()
        report = self.scan()
        missing = [x for x in report['findings'] if x['rule_id'] == 'record.required']
        self.assertEqual(len(missing), 4)
        self.assertTrue(all(x['severity'] == 'error' and x['evidence']['field'] for x in missing))

    def test_optional_roles_and_risk_are_backward_compatible_and_validated(self):
        base = self.scan()
        self.assertEqual(base['summary']['role_schema']['entries_with_roles'], 0)
        self.assertEqual(base['summary']['role_schema']['entries_with_risk_level'], 0)
        self.card(0, '- 故障现象：合成现象。\n- 可能原因：合成原因。\n- 针对处理：合成处理。\n- 证据：SRC-TEST-0；测试章节1。')
        self.entries[0].update(roles=['symptom', 'cause', 'action'], role_basis='原文标记',
                               risk_level='medium', risk_basis='合成测试依据')
        self.entries[1].update(roles=['check'], role_basis='人工核对')
        self.write()
        report = self.scan()
        self.assertEqual(report['summary']['errors'], 0)
        summary = report['summary']['role_schema']
        self.assertEqual((summary['entries_with_roles'], summary['entries_with_risk_level']), (2, 1))
        self.assertEqual(summary['roles'], {'symptom': 1, 'cause': 1, 'check': 1, 'action': 1, 'retest': 0})
        self.assertEqual(summary['risk_levels'], {'medium': 1})
        bad = [
            {'roles': ['cause', 'symptom'], 'role_basis': '人工核对'},          # order
            {'roles': ['symptom', 'symptom'], 'role_basis': '人工核对'},        # duplicate
            {'roles': [], 'role_basis': '人工核对'},                            # empty
            {'roles': ['diagnosis'], 'role_basis': '人工核对'},                 # unknown role
            {'roles': ['symptom']},                                             # missing basis
            {'role_basis': '人工核对'},                                         # basis without roles
            {'roles': ['retest'], 'role_basis': '原文标记'},                    # no explicit marker
            {'risk_level': 'critical', 'risk_basis': '依据'},                   # unknown level
            {'risk_level': 'high'},                                             # missing basis
            {'risk_basis': '依据'},                                             # basis without level
        ]
        for fields in bad:
            with self.subTest(fields=fields):
                entry = {k: v for k, v in self.entries[0].items()
                         if k not in ('roles', 'role_basis', 'risk_level', 'risk_basis')}
                self.entries[0] = {**entry, **fields}
                self.write()
                self.assertIn('entry.roles', self.rules(self.scan()))
        entry = {k: v for k, v in self.entries[0].items() if k not in ('roles', 'role_basis', 'risk_level', 'risk_basis')}
        self.entries[0] = {**entry, 'entry_type': '资料索引', 'risk_level': 'low', 'risk_basis': '依据'}
        self.write()
        self.assertIn('entry.roles', self.rules(self.scan()))

    def test_bad_json_line_does_not_hide_later_valid_records(self):
        path = self.index / 'entries.jsonl'
        path.write_text('{bad json}\n' + path.read_text('utf8'), encoding='utf8')
        report = self.scan()
        self.assertEqual(report['summary']['entries'], 2)
        self.assertIn('index.json', self.rules(report))
        self.assertEqual(report['verification_counts']['verified'], 2)

    def test_nonobjects_and_wrong_source_container_are_findings(self):
        self.sources = [None]
        self.entries = [[], 4]
        self.write()
        report = self.scan()
        self.assertEqual(report['summary']['errors'], 3)
        self.assertEqual(len({x['finding_id'] for x in report['findings']}), 3)
        (self.index / 'sources.json').write_text('{}', encoding='utf8')
        self.assertIn('index.json', self.rules(self.scan()))

    def test_duplicate_ids_checked_even_when_records_are_cached(self):
        self.scan(True)
        self.entries.append(copy.deepcopy(self.entries[0]))
        self.sources.append(copy.deepcopy(self.sources[0]))
        self.write()
        report = self.scan(True)
        self.assertTrue({'source.id', 'entry.id'} <= self.rules(report))
        self.assertEqual(report['incremental']['entries_reused'], 2)

    def test_models_and_source_conditions_are_conservative(self):
        for changes, rule in [({'models': ['M2']}, 'scope.models'),
                              ({'models': [{'bad': 'type'}]}, 'scope.models'),
                              ({'configuration': 'INVALID'}, 'scope.condition'),
                              ({'emission_stage': None}, 'scope.condition')]:
            with self.subTest(changes=changes):
                previous = copy.deepcopy(self.entries[0])
                self.entries[0].update(changes)
                self.write()
                self.assertIn(rule, self.rules(self.scan()))
                self.entries[0] = previous
        self.sources[0]['configuration'] = 'CAB'
        self.entries[0]['configuration'] = 'ROPS'
        self.write()
        self.assertIn('scope.condition', self.rules(self.scan()))

    def test_source_reference_brand_id_and_exact_body_identifier(self):
        for field, value, rule in [('source_id', 'SRC-MISSING', 'entry.source'),
                                   ('brand', '其他品牌', 'entry.source'),
                                   ('entry_id', 'TEST--BAD', 'entry.id')]:
            with self.subTest(field=field):
                original = self.entries[0][field]
                self.entries[0][field] = value
                self.write()
                self.assertIn(rule, self.rules(self.scan()))
                self.entries[0][field] = original
        self.write()
        self.card(0, '- 证据：SRC-TEST-00')
        self.assertIn('entry.evidence', self.rules(self.scan()))

    def test_source_title_brand_and_model_ids(self):
        cases = [({'title': None}, 'source.title'),
                 ({'title': '合成资料手册', 'title_status': '已核对'}, 'source.title'),
                 ({'brand': '雷沃欧豹'}, 'source.brand'),
                 ({'model_ids': ['M1', 'M1']}, 'source.model_ids')]
        for change, rule in cases:
            with self.subTest(rule=rule, change=change):
                original = dict(self.sources[0])
                self.sources[0].update(change)
                if self.sources[0].get('title') is None:
                    self.sources[0].pop('title')
                self.write()
                self.assertIn(rule, self.rules(self.scan()))
                self.sources[0] = original
        self.sources[0].pop('title')
        self.sources[0]['title_status'] = '待核实'
        self.write()
        self.assertNotIn('source.title', self.rules(self.scan()))

    def test_source_hash_bytes_url_and_duplicate_models(self):
        for field, value, rule in [('sha256', '0' * 64, 'source.file'),
                                   ('bytes', True, 'source.file'),
                                   ('url', 'file:///fake', 'source.url'),
                                   ('models', ['M1', 'M1'], 'scope.models')]:
            with self.subTest(field=field):
                original = self.sources[0][field]
                self.sources[0][field] = value
                self.write()
                self.assertIn(rule, self.rules(self.scan()))
                self.sources[0][field] = original

    def test_path_escape_and_symlink_do_not_read_external_knowledge(self):
        original = self.entries[0]['knowledge_path']
        self.entries[0]['knowledge_path'] = '../outside.md'
        self.write()
        self.assertIn('entry.path', self.rules(self.scan()))
        self.entries[0]['knowledge_path'] = original
        card = self.root / original
        card.unlink()
        try:
            card.symlink_to(TOOLS / '校验索引.py')
        except OSError:
            return  # Windows runners may not allow symlink creation.
        self.write()
        self.assertIn('entry.path', self.rules(self.scan()))

    def test_card_adapters_do_not_require_uniform_steps(self):
        bodies = [
            ('- 故障现象：异响\n- 原表可能原因：待检原因\n- 针对处理：联系维修人员', 'fault_case'),
            ('- 故障现象：异响\n- 可能原因：待检原因\n- 诊断步骤：观察\n- 维修建议：送修', 'repair_fields'),
            ('- 手册事实：规定条件下的事实', 'manual_fact'),
            ('|条件|事实|\n|---|---|\n|测试|仅测试|', 'legacy'),
        ]
        for body, expected in bodies:
            with self.subTest(style=expected):
                self.card(0, body + '\n- 证据：SRC-TEST-0')
                report = self.scan()
                self.assertEqual(report['summary']['errors'], 0)
                self.assertGreaterEqual(report['body_formats'][expected], 1)

    def test_body_findings_have_real_line_and_keep_uncertainty(self):
        self.card(0, '- 故障现象：\n- 故障现象：异响\n- 资料来源：SRC-TEST-0 与 SRC-OTHER\n- 针对处理：TODO\n乱码\ufffd')
        report = self.scan()
        self.assertTrue({'body.field', 'body.source', 'body.placeholder', 'body.encoding'} <= self.rules(report))
        empty = next(x for x in report['findings'] if x['message'] == '已标注字段为空：故障现象')
        self.assertEqual(empty['evidence']['line'], 5)
        self.assertEqual(empty['evidence']['path'], self.entries[0]['knowledge_path'])

    def test_status_classification_never_rewrites_status(self):
        self.entries[0]['status'] = '已核对引用页原文文字；未实车验证'
        self.card(1, '- 验证状态：未核验\n- 证据：SRC-TEST-1')
        self.write()
        before = (self.index / 'entries.jsonl').read_bytes()
        report = self.scan()
        self.assertEqual(report['verification_counts']['verified'], 2)
        self.assertIn('body.status', self.rules(report))
        self.assertNotIn('status.unspecified', self.rules(report))
        self.assertEqual(before, (self.index / 'entries.jsonl').read_bytes())

    def test_source_location_is_json_pointer_not_fake_line(self):
        del self.sources[1]['source_level']
        self.write()
        item = next(x for x in self.scan()['findings'] if x['rule_id'] == 'source.level')
        self.assertIsNone(item['evidence']['line'])
        self.assertEqual(item['evidence']['field'], '/1/source_level')

    def test_incremental_reuses_rules_and_returns_full_findings(self):
        self.entries[0]['status'] = '沿用既有核对记录'
        self.write()
        first = self.scan(True)
        second = self.scan(True)
        self.assertEqual(second['incremental']['entries_checked'], 0)
        self.assertEqual(second['incremental']['sources_checked'], 0)
        self.assertEqual(second['findings'], first['findings'])
        self.assertEqual(first['snapshot'], second['snapshot'])
        full = self.scan(True, full=True)
        self.assertEqual(full['incremental']['entries_checked'], 2)

    def test_card_change_invalidates_only_its_dependents(self):
        self.scan(True)
        self.card(0, '- 证据：SRC-TEST-0\n- 故障现象：')
        changed = self.scan(True)
        self.assertEqual(changed['incremental']['entries_checked'], 1)
        self.assertEqual(changed['incremental']['entries_reused'], 1)
        self.assertIn('body.field', self.rules(changed))

    def test_source_scope_change_invalidates_only_its_entries(self):
        self.scan(True)
        self.sources[0]['scope_boundary'] = '测试范围改变'
        self.write()
        changed = self.scan(True)
        self.assertEqual(changed['incremental']['sources_checked'], 1)
        self.assertEqual(changed['incremental']['entries_checked'], 1)

    def test_content_change_with_same_size_and_mtime_is_not_missed(self):
        self.scan(True)
        raw = self.root / self.sources[0]['path']
        stat = raw.stat()
        raw.write_bytes(b'x' * stat.st_size)
        os.utime(raw, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        report = self.scan(True)
        self.assertEqual(report['incremental']['sources_checked'], 1)
        self.assertIn('source.file', self.rules(report))

    def test_removed_records_and_findings_do_not_survive_cache(self):
        self.entries[1]['status'] = '旧状态'
        self.write()
        self.scan(True)
        self.entries.pop()
        self.write()
        report = self.scan(True)
        self.assertEqual(report['summary']['entries'], 1)
        self.assertNotIn('status.unspecified', self.rules(report))
        self.assertNotIn('entry:2', json.loads(self.cache.read_text('utf8'))['records'])

    def test_invalid_and_outdated_cache_are_safe_misses(self):
        self.cache.parent.mkdir(parents=True)
        self.cache.write_text('{broken', encoding='utf8')
        self.assertEqual(self.scan(True)['incremental']['entries_checked'], 2)
        state = json.loads(self.cache.read_text('utf8'))
        state['engine'] = 'outdated'
        self.cache.write_text(json.dumps(state), encoding='utf8')
        self.assertEqual(self.scan(True)['incremental']['sources_checked'], 2)

    def test_cache_checksum_mismatch_forces_recheck(self):
        self.scan(True)
        state = json.loads(self.cache.read_text('utf8'))
        state['records']['entry:1']['result']['findings'] = []
        state['records']['entry:1']['checksum'] = 'broken'
        self.cache.write_text(json.dumps(state), encoding='utf8')
        self.assertEqual(self.scan(True)['incremental']['entries_checked'], 1)

    def test_multiple_duplicate_occurrences_have_distinct_finding_ids(self):
        self.entries += [copy.deepcopy(self.entries[0]), copy.deepcopy(self.entries[0])]
        self.write()
        report = self.scan()
        duplicates = [x for x in report['findings'] if x['message'] == '条目编号重复']
        self.assertEqual(len(duplicates), 2)
        self.assertEqual(len({x['finding_id'] for x in duplicates}), 2)

    def test_removed_source_invalidates_its_cached_dependents(self):
        self.scan(True)
        self.sources.pop()
        self.write()
        report = self.scan(True)
        self.assertIn('entry.source', self.rules(report))
        self.assertEqual(report['incremental']['entries_checked'], 1)

    def test_optional_batch_fields_are_checked_without_recomputing_case_keys(self):
        self.entries[0]['case_key'] = 'INVALID'
        self.entries[0]['collection_id'] = []
        self.write()
        report = self.scan()
        self.assertEqual(sum(x['rule_id'] == 'record.optional' for x in report['findings']), 2)

    def test_legacy_case_locator_requires_matching_source_and_cause_action_numbers(self):
        source = self.entries[0]['source_id']
        for value in [f'{source}/2-4/现象1/原因(2)→排除(2)', 'a' * 64]:
            self.entries[0]['case_key'] = value
            self.write()
            self.assertNotIn('record.optional', self.rules(self.scan()))
        for value in [f'{source}/2-4/现象1/原因(2)→排除(3)',
                      'SRC-OTHER/2-4/现象1/原因(2)→排除(2)',
                      f'{source}/2-4/现象0/原因(2)→排除(2)']:
            self.entries[0]['case_key'] = value
            self.write()
            self.assertIn('record.optional', self.rules(self.scan()))

    def test_unknown_emission_marker_cannot_conflict_with_declared_stage(self):
        self.sources[0]['emission_stage_unknown'] = True
        self.sources[0]['emission_stage'] = '国四'
        self.write()
        self.assertIn('scope.condition', self.rules(self.scan()))
        del self.sources[0]['emission_stage']
        self.write()
        self.assertNotIn('scope.condition', self.rules(self.scan()))
        self.sources[0]['emission_stage_unknown'] = 'true'
        self.write()
        self.assertIn('scope.condition', self.rules(self.scan()))

    def test_broken_common_framework_is_an_error_in_the_same_snapshot(self):
        framework = self.index / '通用框架.json'
        framework.write_text('{broken', encoding='utf8')
        (self.index / 'hierarchy.json').write_text('{}', encoding='utf8')
        report = self.scan()
        self.assertIn('index.json', self.rules(report))
        self.assertIn(framework.relative_to(self.root).as_posix(), report['snapshot']['files'])

    def test_pdf_pages_and_external_proofs_reuse_existing_checker(self):
        source = self.sources[0]
        source.update(storage_type='link_and_source_record', manual_sha256='a' * 64,
                      manual_bytes=3, manual_pdf_pages=2, verified_pdf_pages={'1': '合成选页'})
        old = self.root / source['path']
        renamed = old.with_suffix('.md')
        old.rename(renamed)
        source['path'] = renamed.relative_to(self.root).as_posix()
        self.entries[0]['locator'] = 'PDF第3页'
        self.write()
        report = self.scan(True)
        self.assertTrue({'source.external', 'entry.evidence'} <= self.rules(report))
        proof = self.root / 'external.pdf'
        proof.write_bytes(b'pdf')
        source['manual_sha256'] = validator.digest(proof)
        self.entries[0]['locator'] = 'PDF第1页'
        self.write()
        with patch.object(validator, 'page_count', return_value=2) as pages:
            report = self.scan(True, proofs={source['source_id']: proof})
            self.assertTrue(report['sources'][0]['external_pdf_verified'])
            self.assertEqual(pages.call_count, 1)
        self.assertNotIn('source.external', self.rules(report))

    def test_snapshot_change_is_error_and_does_not_publish_cache(self):
        original = validator.ArchiveAudit.entry_checks
        changed = False
        def mutate(audit, *args):
            nonlocal changed
            result = original(audit, *args)
            if not changed:
                changed = True
                with (self.index / 'entries.jsonl').open('a', encoding='utf8') as handle:
                    handle.write('\n')
            return result
        with patch.object(validator.ArchiveAudit, 'entry_checks', mutate):
            report = self.scan(True)
        self.assertIn('snapshot.changed', self.rules(report))
        self.assertFalse(self.cache.exists())

    def test_reports_escape_markdown_and_have_explainable_findings(self):
        self.entries[0]['status'] = '旧状态 | <tag>\n换行'
        self.write()
        report = self.scan()
        text = markdown_report(report)
        self.assertIn('处理建议', text)
        self.assertIn('unspecified不等于', text)
        for item in report['findings']:
            self.assertTrue({'finding_id', 'rule_id', 'entry_id', 'source_id', 'severity', 'evidence', 'suggestion'} <= item.keys())
            self.assertIn(item['rule_id'], RULES)
        self.assertEqual(len({x['finding_id'] for x in report['findings']}), len(report['findings']))

    def test_output_cannot_overwrite_knowledge_code_or_external_proof(self):
        for path in [self.root / self.entries[0]['knowledge_path'], self.root / 'README.md', self.root / '.git/config']:
            with self.assertRaises(ValueError):
                safe_output(path, self.root)
        proof = self.root / 'server/data/knowledge-quality/proof.pdf'
        with self.assertRaises(ValueError):
            validator.validate(self.root, proofs={'SRC-TEST-0': proof}, cache_path=proof)

    def test_cli_refuses_output_aliases_before_touching_inputs(self):
        result = subprocess.run([sys.executable, '-B', str(TOOLS / '校验索引.py'),
                                 '--report', str(TOOLS / 'knowledge_quality.py')], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        path = self.root / 'report.json'
        result = subprocess.run([sys.executable, '-B', str(TOOLS / '校验索引.py'),
                                 '--report', str(path), '--cache', str(path)], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(path.exists())


if __name__ == '__main__':
    unittest.main()
