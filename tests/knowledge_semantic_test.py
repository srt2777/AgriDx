"""Offline semantic-cleaning regressions over assistant-authored provisional synthetic cards.

The pair labels await independent domain review. These tests do not establish
real-world repair accuracy, and never change the production knowledge archive.
"""
import copy
import importlib.util
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1] / '知识库/工具'
sys.path.insert(0, str(TOOLS))
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('semantic_fixture_validator', TOOLS / '校验索引.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
import knowledge_semantic as semantic
from semantic_relations import classify, extract_features

FIXTURES = json.loads((Path(__file__).parent / 'fixtures/semantic-pairs.json').read_text('utf8'))
BASE = {'title': '启动困难', 'model': 'M1', 'body':
        '- 故障现象：发动机启动困难\n- 原表可能原因：蓄电池电量不足\n- 针对处理：给蓄电池充电'}


class FakeEmbedder:
    """Deterministic test double; its vectors are never treated as true labels."""
    def __init__(self, version='fixture-v1', fail_at=None):
        self.identity = {'provider': 'synthetic_test_double', 'version': version}
        self.calls, self.texts, self.fail_at = 0, [], fail_at

    def encode(self, texts):
        self.calls += 1
        if self.fail_at is not None and self.calls == self.fail_at:
            raise KeyboardInterrupt('synthetic checkpoint interruption')
        self.texts.extend(texts)
        # Same cosine intentionally exercises conservative cause/scope guards.
        return [[1.0, 0.0, 0.0] for _ in texts]


class ArchiveFixture:
    """Use the 3.4.9 validator's real inputs without inheriting its test suite."""
    def __init__(self, root):
        self.root = Path(root)
        self.index = self.root / validator.INDEX_PATH
        self.index.mkdir(parents=True)
        self.sources, self.entries, self.bodies = [], [], {}
        self.cache = self.root / 'server/data/knowledge-quality/semantic-cache.json'
        self.quality_cache = self.root / 'server/data/knowledge-quality/quality-cache.json'

    def add(self, value=None):
        value = copy.deepcopy(value or BASE)
        number = len(self.entries)
        sid, eid = f'SRC-SYNTH-{number}', f'SYNTH-{number}'
        model = value.get('model', 'M1')
        raw = self.root / f'知识库/原始农机说明书/{number}.html'
        raw.parent.mkdir(parents=True, exist_ok=True)
        raw.write_text(f'synthetic manual {number}', encoding='utf8')
        source = {'source_id': sid, 'brand': '测试品牌', 'model': model, 'title': '合成资料手册',
                  'models': value.get('models', [model]), 'path': raw.relative_to(self.root).as_posix(),
                  'url': 'https://example.invalid/synthetic', 'version': 'fixture-v1',
                  'scope_boundary': value.get('source_boundary', f'仅测试{model}'),
                  'sha256': validator.digest(raw), 'bytes': raw.stat().st_size,
                  'source_level': '开发者编写合成测试资料，非维修指导'}
        card = self.root / f'知识库/整理后的知识库/card-{number}.md'
        entry = {'entry_id': eid, 'source_id': sid, 'brand': source['brand'],
                 'model': model, 'title': value['title'],
                 'knowledge_path': card.relative_to(self.root).as_posix(),
                 'locator': '合成测试章节1', 'status': '已核验；未厂家复核/实车验证',
                 'entry_type': '维护/故障知识'}
        for key in ['models', 'emission_stage', 'configuration', 'drive_configuration', 'case_key', 'use']:
            if key in value:
                entry[key] = value[key]
                if key in ['emission_stage', 'configuration', 'drive_configuration']:
                    source[key] = value[key]
        self.sources.append(source)
        self.entries.append(entry)
        self.body(number, value['body'])
        self.write()
        return eid

    def body(self, number, body):
        entry = self.entries[number]
        self.bodies[entry['entry_id']] = body
        path = self.root / entry['knowledge_path']
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# 开发者合成测试\n\n## {entry['entry_id']}｜{entry['title']}\n\n{body}\n"
                        f"- 证据：{entry['source_id']}；合成测试章节1。\n", encoding='utf8')

    def write(self):
        (self.index / 'sources.json').write_text(json.dumps(self.sources, ensure_ascii=False), encoding='utf8')
        (self.index / 'entries.jsonl').write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n'
                                                       for x in self.entries), encoding='utf8')

    def feature(self, number):
        entry = self.entries[number]
        source = next(x for x in self.sources if x['source_id'] == entry['source_id'])
        return extract_features(entry, source, {'body': self.bodies[entry['entry_id']], 'line': 4,
                                                'heading': f"{entry['entry_id']}｜{entry['title']}"})

    def scan(self, cached=False, **kwargs):
        return semantic.scan(self.root, cache_path=self.cache if cached else None,
                             quality_cache_path=self.quality_cache if cached else None, **kwargs)


def content(root):
    return {path.relative_to(root).as_posix(): path.read_bytes()
            for path in root.rglob('*') if path.is_file()}


def relation_signature(report):
    return sorted(json.dumps(item, ensure_ascii=False, sort_keys=True)
                  for item in report['relations'])


class SemanticTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='agridx-semantic-')
        self.addCleanup(self.temporary.cleanup)
        self.fixture = ArchiveFixture(self.temporary.name)
        self.root = self.fixture.root

    def pair(self, left=None, right=None):
        self.fixture.add(left or BASE)
        self.fixture.add(right or BASE)

    def test_label_provenance_does_not_claim_real_world_accuracy(self):
        self.assertEqual(FIXTURES['provenance']['label_source'], 'assistant_authored_synthetic')
        self.assertEqual(FIXTURES['provenance']['review_state'], 'pending_domain_review')
        self.assertGreaterEqual(len(FIXTURES['pairs']), 15)
        self.assertEqual(len({x['id'] for x in FIXTURES['pairs']}), len(FIXTURES['pairs']))
        self.assertEqual({x['expected_relation'] for x in FIXTURES['pairs']}, {
            'exact_duplicate', 'semantic_duplicate', 'partial_overlap', 'complementary', 'scope_variant', 'uncertain'})

    def test_developer_labelled_pair_relations_with_adversarial_high_similarity(self):
        for pair in FIXTURES['pairs']:
            with self.subTest(pair=pair['id']), tempfile.TemporaryDirectory(prefix='agridx-pair-') as temporary:
                fixture = ArchiveFixture(temporary)
                fixture.add(pair['left'])
                fixture.add(pair['right'])
                result = classify(fixture.feature(0), fixture.feature(1), similarity=0.9999)
                self.assertEqual(result['relation'], pair['expected_relation'], result)
                self.assertEqual(result['review_state'], 'pending')
                self.assertTrue(result['reasons'])
                self.assertTrue(result['recommended_action'])

    def test_default_run_writes_nothing_and_embeds_no_external_calls(self):
        self.pair()
        before = content(self.root)
        report = self.fixture.scan()
        self.assertEqual(before, content(self.root))
        self.assertEqual(report['summary']['entries'], 2)
        self.assertEqual(report['quality']['summary']['errors'], 0)
        self.assertEqual(report['snapshot'], report['quality']['snapshot'])
        self.assertEqual(report['relations'][0]['relation'], 'exact_duplicate')

    def test_report_keeps_both_ids_sources_scope_and_real_evidence(self):
        self.pair()
        report = self.fixture.scan(embedder=FakeEmbedder())
        item = report['relations'][0]
        self.assertEqual({item['left_entry_id'], item['right_entry_id']}, {'SYNTH-0', 'SYNTH-1'})
        self.assertEqual(item['review_state'], 'pending')
        self.assertTrue(item['reasons'])
        self.assertTrue(item['recommended_action'])
        for side in ['left', 'right']:
            self.assertTrue(item['evidence'][side])
            self.assertIn('card-', json.dumps(item['evidence'][side]))
        self.assertTrue(math.isfinite(item['semantic_similarity']))
        text = json.dumps(report, ensure_ascii=False)
        for token in ['SRC-SYNTH-0', 'SRC-SYNTH-1', 'M1', '合成测试章节1']:
            self.assertIn(token, text)

    def test_new_entries_compare_with_old_and_each_other(self):
        self.fixture.add()
        self.fixture.scan(cached=True, embedder=FakeEmbedder())
        self.fixture.add()
        self.fixture.add()
        report = self.fixture.scan(cached=True, embedder=FakeEmbedder())
        self.assertEqual(report['summary']['new'], 2)
        self.assertEqual(report['summary']['reused'], 1)
        self.assertEqual({tuple(sorted([x['left_entry_id'], x['right_entry_id']])) for x in report['relations']}, {
            ('SYNTH-0', 'SYNTH-1'), ('SYNTH-0', 'SYNTH-2'), ('SYNTH-1', 'SYNTH-2')})
        self.assertEqual(relation_signature(report), relation_signature(self.fixture.scan(full=True, embedder=FakeEmbedder())))

    def test_unchanged_scan_reuses_all_embeddings_and_relations(self):
        self.pair()
        self.fixture.scan(cached=True, embedder=FakeEmbedder())
        embedder = FakeEmbedder()
        report = self.fixture.scan(cached=True, embedder=embedder)
        self.assertEqual(embedder.texts, [])
        self.assertEqual(report['summary']['reused'], 2)
        self.assertEqual(report['summary']['new'], 0)
        self.assertEqual(report['summary']['modified'], 0)
        self.assertEqual(relation_signature(report), relation_signature(self.fixture.scan(full=True, embedder=FakeEmbedder())))

    def test_same_size_and_restored_mtime_body_edit_recomputes_relations(self):
        self.pair()
        self.fixture.scan(cached=True, embedder=FakeEmbedder())
        card = self.root / self.fixture.entries[1]['knowledge_path']
        before = card.stat()
        self.fixture.body(1, BASE['body'].replace('给蓄电池充电', '将蓄电池更换'))
        self.assertEqual(card.stat().st_size, before.st_size)
        os.utime(card, ns=(before.st_atime_ns, before.st_mtime_ns))
        report = self.fixture.scan(cached=True, embedder=FakeEmbedder())
        self.assertEqual(report['summary']['modified'], 1)
        self.assertEqual(report['summary']['reused'], 1)
        self.assertNotEqual(report['relations'][0]['relation'], 'exact_duplicate')
        self.assertEqual(relation_signature(report), relation_signature(self.fixture.scan(full=True, embedder=FakeEmbedder())))

    def test_removal_prunes_old_relationships_and_cached_features(self):
        self.pair()
        self.fixture.add()
        self.fixture.scan(cached=True, embedder=FakeEmbedder())
        self.fixture.entries.pop(1)
        self.fixture.write()
        report = self.fixture.scan(cached=True, embedder=FakeEmbedder())
        self.assertEqual(report['summary']['removed'], 1)
        self.assertEqual(len(report['relations']), 1)
        self.assertNotIn('SYNTH-1', json.dumps(report['relations']))
        self.assertEqual(relation_signature(report), relation_signature(self.fixture.scan(full=True, embedder=FakeEmbedder())))

    def test_source_scope_edit_invalidates_affected_knowledge(self):
        self.pair()
        self.fixture.scan(cached=True, embedder=FakeEmbedder())
        self.fixture.sources[1]['scope_boundary'] = '仅测试M1的特殊市场配置'
        self.fixture.write()
        report = self.fixture.scan(cached=True, embedder=FakeEmbedder())
        self.assertEqual(report['summary']['modified'], 1)
        self.assertEqual(report['relations'][0]['relation'], 'scope_variant')
        self.assertEqual(relation_signature(report), relation_signature(self.fixture.scan(full=True, embedder=FakeEmbedder())))

    def test_model_identity_change_recomputes_embeddings(self):
        self.pair()
        self.fixture.scan(cached=True, embedder=FakeEmbedder('model-one'))
        embedder = FakeEmbedder('model-two')
        report = self.fixture.scan(cached=True, embedder=embedder)
        self.assertTrue(embedder.texts)
        self.assertEqual(report['summary']['reused'], 0)
        self.assertEqual(relation_signature(report), relation_signature(self.fixture.scan(full=True, embedder=FakeEmbedder('model-two'))))

    def test_rule_version_change_invalidates_feature_and_relation_cache(self):
        self.pair()
        self.fixture.scan(cached=True, embedder=FakeEmbedder())
        embedder = FakeEmbedder()
        with patch.object(semantic, 'RULES_VERSION', 'synthetic-new-rules'):
            report = self.fixture.scan(cached=True, embedder=embedder)
            full = self.fixture.scan(full=True, embedder=FakeEmbedder())
        self.assertEqual(report['summary']['reused'], 0)
        self.assertTrue(embedder.texts)
        self.assertEqual(relation_signature(report), relation_signature(full))

    def test_appending_card_in_same_markdown_keeps_neighbour_feature_cached(self):
        self.fixture.add()
        self.fixture.scan(cached=True, embedder=FakeEmbedder())
        self.fixture.add()
        first = self.root / self.fixture.entries[0]['knowledge_path']
        second = self.root / self.fixture.entries[1]['knowledge_path']
        new_section = second.read_text('utf8').split('## ', 1)[1]
        first.write_text(first.read_text('utf8') + '\n## ' + new_section, encoding='utf8')
        self.fixture.entries[1]['knowledge_path'] = self.fixture.entries[0]['knowledge_path']
        self.fixture.write()
        embedder = FakeEmbedder()
        report = self.fixture.scan(cached=True, embedder=embedder)
        self.assertEqual(report['summary']['new'], 1)
        self.assertEqual(report['summary']['reused'], 1)
        self.assertEqual(len(embedder.texts), 1)
        self.assertEqual(relation_signature(report), relation_signature(self.fixture.scan(full=True, embedder=FakeEmbedder())))

    def test_reordering_index_keeps_features_and_refreshes_evidence_locations(self):
        self.pair()
        self.fixture.scan(cached=True, embedder=FakeEmbedder())
        self.fixture.entries.reverse()
        self.fixture.sources.reverse()
        self.fixture.write()
        embedder = FakeEmbedder()
        report = self.fixture.scan(cached=True, embedder=embedder)
        self.assertEqual(report['summary']['reused'], 2)
        self.assertEqual(embedder.texts, [])
        self.assertEqual(relation_signature(report), relation_signature(self.fixture.scan(full=True, embedder=FakeEmbedder())))

    def test_corrupt_cache_is_a_safe_miss(self):
        self.pair()
        self.fixture.cache.parent.mkdir(parents=True)
        self.fixture.cache.write_text('{bad json', encoding='utf8')
        report = self.fixture.scan(cached=True, embedder=FakeEmbedder())
        self.assertEqual(report['summary']['reused'], 0)
        self.assertEqual(relation_signature(report), relation_signature(self.fixture.scan(full=True, embedder=FakeEmbedder())))

    def test_bad_indexes_fail_closed_and_do_not_publish_semantic_cache(self):
        self.pair()
        (self.fixture.index / 'entries.jsonl').write_text('{broken\n', encoding='utf8')
        report = self.fixture.scan(cached=True, embedder=FakeEmbedder())
        self.assertTrue(report['blocked'])
        self.assertGreater(report['quality']['summary']['errors'], 0)
        self.assertEqual(report['relations'], [])
        self.assertFalse(self.fixture.cache.exists())

    def test_missing_source_fails_closed(self):
        self.pair()
        self.fixture.sources.pop()
        self.fixture.write()
        report = self.fixture.scan(cached=True, embedder=FakeEmbedder())
        self.assertTrue(report['blocked'])
        self.assertGreater(report['quality']['summary']['errors'], 0)
        self.assertEqual(report['relations'], [])
        self.assertFalse(self.fixture.cache.exists())

    def test_cache_cannot_overwrite_cards_code_or_quality_cache(self):
        self.pair()
        before = content(self.root)
        for target in [self.root / self.fixture.entries[0]['knowledge_path'], self.root / 'README.md']:
            with self.subTest(path=str(target)), self.assertRaises(ValueError):
                semantic.scan(self.root, cache_path=target)
        self.assertEqual(before, content(self.root))
        with self.assertRaises(ValueError):
            semantic.scan(self.root, cache_path=self.fixture.cache, quality_cache_path=self.fixture.cache)

    def test_output_symlink_cannot_escape_allowed_directory_into_knowledge(self):
        self.pair()
        self.fixture.cache.parent.mkdir(parents=True)
        card = self.root / self.fixture.entries[0]['knowledge_path']
        try:
            self.fixture.cache.symlink_to(card)
        except OSError:
            self.skipTest('This Windows runner does not allow symlink creation')
        before = card.read_bytes()
        with self.assertRaises(ValueError):
            self.fixture.scan(cached=True)
        self.assertEqual(card.read_bytes(), before)

    def test_cache_outputs_cannot_overwrite_local_model_directory(self):
        self.pair()
        with tempfile.TemporaryDirectory(prefix='agridx-synthetic-model-') as temporary:
            model = Path(temporary)
            target = model / 'weights.safetensors'
            target.write_bytes(b'synthetic weights must remain unchanged')
            embedder = FakeEmbedder()
            embedder.identity['path'] = str(model)
            before = target.read_bytes()
            for options in [{'cache_path': target}, {'quality_cache_path': target}]:
                with self.subTest(options=options), self.assertRaises(ValueError):
                    semantic.scan(self.root, embedder=embedder, **options)
            self.assertEqual(target.read_bytes(), before)

    def test_input_change_during_encoding_prevents_publishing_complete_cache(self):
        self.pair()
        card = self.root / self.fixture.entries[0]['knowledge_path']
        embedder = FakeEmbedder()
        original = embedder.encode

        def mutate(texts):
            output = original(texts)
            card.write_text(card.read_text('utf8') + '\n合成扫描期间修改\n', encoding='utf8')
            return output

        embedder.encode = mutate
        with self.assertRaisesRegex(ValueError, 'snapshot.changed'):
            self.fixture.scan(cached=True, embedder=embedder, checkpoint_every=1)
        self.assertFalse(self.fixture.cache.exists())

    def test_auto_fallback_restarts_without_mixing_cached_model_vectors(self):
        for _ in range(3):
            self.fixture.add()

        class FallbackEmbedder(FakeEmbedder):
            def encode(self, texts):
                if self.identity.get('mode') == 'rules':
                    return None
                output = super().encode(texts)
                if self.calls == 2:
                    self.identity = {'mode': 'rules', 'version': 'fallback-v1',
                                     'reason': 'Synthetic model failure, rule fallback'}
                    return None
                return output

        embedder = FallbackEmbedder()
        report = self.fixture.scan(cached=True, embedder=embedder, checkpoint_every=1)
        self.assertEqual(report['model']['mode'], 'rules')
        self.assertTrue(report['incremental']['full'])
        self.assertEqual(report['summary']['reused'], 0)
        self.assertTrue(all(x['semantic_similarity'] is None for x in report['relations']))
        state = json.loads(self.fixture.cache.read_text('utf8'))
        self.assertTrue(state['complete'])
        for key, value in state['records'].items():
            if key.startswith('feature:'):
                self.assertIsNone(value['result']['vector'])
        self.assertEqual(relation_signature(report), relation_signature(self.fixture.scan(full=True)))

    def test_nonfinite_zero_or_mismatched_embedding_vectors_are_rejected(self):
        self.pair()
        for output in [[[float('nan')], [1.0]], [[0.0], [1.0]], [[1.0]]]:
            with self.subTest(output=output):
                embedder = FakeEmbedder()
                embedder.encode = lambda texts, values=output: values
                with self.assertRaises(ValueError):
                    self.fixture.scan(cached=True, embedder=embedder)
                self.assertFalse(self.fixture.cache.exists())

    def test_high_embedding_similarity_never_overrides_unknown_scope(self):
        self.pair(BASE, {**BASE, 'configuration': 'CAB'})
        result = classify(self.fixture.feature(0), self.fixture.feature(1), similarity=1.0)
        self.assertEqual(result['relation'], 'scope_variant')

    def test_markdown_report_escapes_untrusted_cell_values(self):
        self.pair({**BASE, 'title': '<script>|知识'}, {**BASE, 'title': '<script>|知识'})
        report = self.fixture.scan()
        report['relations'][0]['reasons'].append('<script>|换行\n合成')
        text = semantic.markdown_report(report)
        self.assertNotIn('<script>', text)
        self.assertIn('&lt;script&gt;', text)
        self.assertIn('\\|', text)
        self.assertIn('pending', text)

    def test_checkpoint_resume_reuses_finished_feature_batches(self):
        for _ in range(3):
            self.fixture.add()
        interrupted = FakeEmbedder(fail_at=2)
        with self.assertRaises(KeyboardInterrupt):
            self.fixture.scan(cached=True, embedder=interrupted, checkpoint_every=1)
        self.assertTrue(self.fixture.cache.exists())
        resumed = FakeEmbedder()
        report = self.fixture.scan(cached=True, embedder=resumed, checkpoint_every=1)
        self.assertLess(len(resumed.texts), 3)
        self.assertEqual(relation_signature(report), relation_signature(self.fixture.scan(full=True, embedder=FakeEmbedder())))

    def test_identical_case_key_never_overrides_different_repair_action(self):
        left = {**BASE, 'case_key': 'a' * 64}
        right = {**BASE, 'case_key': 'a' * 64, 'body': BASE['body'].replace('给蓄电池充电', '检查并更换失效蓄电池')}
        self.pair(left, right)
        report = self.fixture.scan(embedder=FakeEmbedder())
        self.assertNotIn(report['relations'][0]['relation'], ['exact_duplicate', 'semantic_duplicate'])


if __name__ == '__main__':
    unittest.main()
