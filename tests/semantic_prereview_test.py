"""语义预审的纯函数回归：不运行 AI、不修改知识库。"""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

TOOLS = Path(__file__).resolve().parents[1] / '知识库/工具'
sys.path.insert(0, str(TOOLS))
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('prereview', TOOLS / '语义预审.py')
pr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pr)


def entry(eid, source, model, body, title='Rear PTO'):
    return {'entry_id': eid, 'source_id': source, 'model': model, 'title': title, 'body': body}


class PrereviewTest(unittest.TestCase):
    def test_template_entries_fold_into_one_scope_variant_cluster(self):
        entries = {e['entry_id']: e for e in [
            entry('A-1', 'S1', '5055E', '目录Section 50列出“Rear PTO”；精确型号“5055E”。'),
            entry('A-2', 'S1', '5065E', '目录Section 51列出“Rear PTO”；精确型号“5065E”。'),
            entry('B-1', 'S2', '5055E', '目录Section 50列出“Rear PTO”；精确型号“5055E”。')]}
        clusters, member_of = pr.fold_templates(entries)
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0]['members'], ['A-1', 'A-2'])
        self.assertEqual(clusters[0]['tier'], 'scope_variant')
        self.assertNotIn('B-1', member_of)

    def test_only_cross_source_pairs_are_queued_and_risky_reasons_become_conflicts(self):
        body = '故障现象：雨刮器不工作。原因：开关损坏。处理：更换开关。'
        entries = {e['entry_id']: e for e in [entry('A', 'S1', 'M1', body), entry('B', 'S2', 'M2', body),
                                               entry('C', 'S1', 'M3', body + '。')]}
        relations = [{'left_entry_id': 'A', 'right_entry_id': 'B', 'reasons': ['数值或单位不同']},
                     {'left_entry_id': 'A', 'right_entry_id': 'C', 'reasons': []}]
        tiers = {(p['a'], p['b']): p['tier'] for p in pr.classify(relations, entries, {}, 0.8)}
        self.assertEqual(tiers[('A', 'B')], 'conflict_candidate')
        self.assertEqual(tiers[('A', 'C')], 'same_source_similar')

    def test_merge_keeps_human_decisions_and_can_backfill_empty_ai_verdict(self):
        pairs = [{'pair_id': 'DP-1', 'a': 'A', 'b': 'B', 'jaccard': 0.9, 'cosine': None, 'tier': 'dup_candidate'},
                 {'pair_id': 'DP-2', 'a': 'A', 'b': 'C', 'jaccard': 0.9, 'cosine': None, 'tier': 'dup_candidate'},
                 {'pair_id': 'DP-3', 'a': 'A', 'b': 'D', 'jaccard': 0.9, 'cosine': None, 'tier': 'same_source_similar'}]
        decided = {'pair_id': 'DP-1', 'a': 'A', 'b': 'B', 'decision': 'keep', 'reviewer': 'x',
                   'decided_at': 't', 'ai_verdict': None}
        already = {'pair_id': 'DP-2', 'a': 'A', 'b': 'C', 'decision': 'pending', 'reviewer': None,
                   'ai_verdict': {'relation': 'uncertain', 'keep_both': True, 'reason': 'old', 'evidence_spans': []},
                   'ai_model': 'old-model'}
        verdict = {'relation': 'duplicate', 'keep_both': False, 'reason': 'r', 'evidence_spans': []}
        rows = pr.merge_review({'DP-1': decided, 'DP-2': already}, pairs,
                               {'DP-1': verdict, 'DP-2': verdict}, '2026.10.1', 'm')
        self.assertEqual([r['pair_id'] for r in rows], ['DP-1', 'DP-2'])
        self.assertEqual(rows[0]['decision'], 'keep')
        self.assertEqual(rows[0]['reviewer'], 'x')
        self.assertEqual(rows[0]['decided_at'], 't')
        self.assertEqual(rows[0]['ai_verdict'], verdict)
        self.assertEqual(rows[0]['ai_model'], 'm')
        self.assertEqual(rows[1]['ai_verdict'], already['ai_verdict'])  # 已有 AI 结论不覆盖
        self.assertEqual(rows[1]['ai_model'], 'old-model')
        self.assertEqual([p['pair_id'] for p in pr.unreviewed(rows, pairs)], ['DP-2'])

    def test_default_reviewer_produces_no_verdicts_and_verdicts_are_validated(self):
        self.assertIsNone(pr.NoReviewer().identity)
        self.assertIsNone(pr.NoReviewer().review({}))
        with self.assertRaises(ValueError):
            pr.validate_verdict({'relation': 'same', 'keep_both': True, 'reason': ''})
        ok = pr.validate_verdict({'relation': 'uncertain', 'keep_both': True, 'reason': 'x', 'extra': 1})
        self.assertNotIn('extra', ok)

    def test_command_reviewer_round_trips_json_over_stdin(self):
        script = 'import json,sys; json.load(sys.stdin); print(json.dumps({"relation":"uncertain","keep_both":True,"reason":"t"}))'
        reviewer = pr.CommandReviewer(f'{sys.executable} -c {json.dumps(script)}')
        self.assertEqual(reviewer.review({'a': 1})['relation'], 'uncertain')

    def test_committed_review_file_is_valid(self):
        rows = pr.read_review(Path(__file__).resolve().parents[1] / pr.REVIEW_FILE)
        self.assertTrue(all(r['tier'] in pr.REVIEW_TIERS for r in rows.values()))


if __name__ == '__main__':
    unittest.main()
