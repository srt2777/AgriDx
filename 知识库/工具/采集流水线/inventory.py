#!/usr/bin/env python3
"""统计现有归档索引，不修改文件。"""
import json
from collections import Counter
from pathlib import Path

INDEX = Path(__file__).resolve().parents[3] / '知识库/整理后的知识库/农用拖拉机知识库'


def main():
    entries = [json.loads(line) for line in (INDEX / 'entries.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    sources = json.loads((INDEX / 'sources.json').read_text(encoding='utf-8'))
    learning = 0
    for relative in ('docs/tractor-knowledge/index.jsonl', 'docs/tractor-knowledge/expansion-5000/index.jsonl'):
        path = Path(__file__).resolve().parents[3] / relative
        learning += sum(bool(line.strip()) for line in path.read_text(encoding='utf-8').splitlines())
    print(json.dumps({
        'sources': len(sources),
        'archive_entries': len(entries),
        'learning_entries': learning,
        'library_entries': len(entries) + learning,
        'by_type': Counter(entry['entry_type'] for entry in entries),
        'by_brand': Counter(entry['brand'] for entry in entries),
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
