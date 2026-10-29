#!/usr/bin/env python3
"""Verify the committed concept subset against the original downloaded Core NT file.

Usage: python3 scripts/verify-agrovoc-source.py /tmp/agrovoc_core.nt
The original 1 GB distribution remains outside Git; no network or model calls.
"""
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

root = Path(__file__).resolve().parents[1]
base = root / 'docs/tractor-knowledge/expansion-1540'
source = json.loads((base / 'source.json').read_text())
records = json.loads((base / 'source-concepts.json').read_text())
raw = Path(sys.argv[1])
with raw.open('rb') as handle:
    assert hashlib.file_digest(handle, 'sha256').hexdigest() == source['nt_sha256'], '原始NT摘要不符'
needed = {r['uri'] for r in records}
for record in records:
    needed.update(r['uri'] for field in ['broader', 'related'] for r in record[field])
pref = defaultdict(set)
labels = defaultdict(dict)
edges = defaultdict(lambda: defaultdict(set))
literal = re.compile(r'^"((?:[^"\\]|\\.)*)"@(en|zh) \.$')
for line in raw.open():
    if not line.startswith('<http://aims.fao.org/aos/agrovoc/'):
        continue
    subject, predicate, obj = line.strip().split(' ', 2)
    subject, predicate = subject[1:-1], predicate[1:-1]
    if predicate == 'http://www.w3.org/2008/05/skos-xl#literalForm':
        match = literal.match(obj)
        if match:
            labels[subject][match[2]] = json.loads('"' + match[1] + '"')
    elif subject in needed:
        if predicate == 'http://www.w3.org/2008/05/skos-xl#prefLabel':
            pref[subject].add(obj.split('>')[0][1:])
        elif predicate in ['http://www.w3.org/2004/02/skos/core#broader', 'http://www.w3.org/2004/02/skos/core#related']:
            edges[subject][predicate.rsplit('#', 1)[1]].add(obj.split('>')[0][1:])

def terms(uri):
    return {lang: value for ref in pref[uri] for lang, value in labels[ref].items()}

for record in records:
    assert {k: record[k] for k in ['zh', 'en']} == terms(record['uri']), record['uri']
    for field in ['broader', 'related']:
        for relation in record[field]:
            assert relation['uri'] in edges[record['uri']][field], (record['uri'], field)
            assert {k: v for k, v in relation.items() if k != 'uri'} == terms(relation['uri']), relation['uri']
print(f"[agrovoc-source] {len(records)}个概念的中英文标签及全部保存关系与原始NT逐条一致。")
