"""Build browser expectations from two Git revisions of the official archive."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

INDEX = '知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl'


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True, encoding='utf-8')


def rows(repo, revision):
    return [json.loads(line) for line in git(repo, 'show', f'{revision}:{INDEX}').splitlines()]


def manifest(repo, baseline, revision):
    before = {row['entry_id'] for row in rows(repo, baseline)}
    by_file = {}
    expected = []
    for row in rows(repo, revision):
        if row['entry_id'] in before:
            continue
        path = row['knowledge_path']
        if path not in by_file:
            sections = {}
            contents = git(repo, 'show', f'{revision}:{path}')
            for section in re.split(r'^##[ \t]+', contents, flags=re.MULTILINE)[1:]:
                label, _, body = section.partition('\n')
                if label in sections:
                    raise ValueError(f'重复章节 {label}')
                sections[label] = body.strip()
            by_file[path] = sections
        label = row['entry_id'] + '｜' + row['title']
        content = by_file[path][label]
        if not content or row['locator'] not in content:
            raise ValueError('缺少正文或原页 ' + row['entry_id'])
        item = {key: row[key] for key in ('brand', 'entry_id', 'source_id', 'title', 'locator')}
        item['models'] = row.get('models') or [row['model']]
        item['bodyHash'] = hashlib.sha256(content.encode('utf-8')).hexdigest()
        expected.append(item)
    return expected


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', type=Path)
    parser.add_argument('baseline')
    parser.add_argument('revision')
    args = parser.parse_args()
    refs = [git(args.repo, 'rev-parse', '--verify', '--end-of-options', ref + '^{commit}').strip()
            for ref in (args.baseline, args.revision)]
    print(json.dumps(manifest(args.repo, *refs), ensure_ascii=False, indent=2))
