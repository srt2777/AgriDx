"""从多个已复核的资料包合成一个待发布批次。默认只预检。"""

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import unicodedata


KNOWLEDGE = Path('知识库')
ORIGINALS = KNOWLEDGE / '原始农机说明书'
INDEX = KNOWLEDGE / '整理后的知识库/农用拖拉机知识库'
TECHNICAL_TYPES = {'维护/故障知识', '操作/维护知识', '安全操作'}
SECTION = re.compile(r'^## ([^\n｜]+)｜([^\n]+)\n', re.MULTILINE)


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def read_rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]


def by_key(rows, field):
    result = {}
    for row in rows:
        if not isinstance(row.get(field), str) or not row[field] or row[field] in result:
            raise ValueError(f'无效或重复的 {field}: {row.get(field)}')
        result[row[field]] = row
    return result


def normalize(value):
    return re.sub(r'\W+', '', unicodedata.normalize('NFKC', value).casefold())


def title_keys(entry):
    for model in entry.get('models') or [entry.get('model', '')]:
        exact_model = unicodedata.normalize('NFKC', model).strip().casefold()
        yield (normalize(entry['brand']), exact_model, normalize(entry['title']))


def checked_path(root, raw, parent):
    path = Path(raw)
    if path.is_absolute() or not path.is_relative_to(parent) or '..' in path.parts or path.suffix != '.md':
        raise ValueError(f'无效知识路径: {raw}')
    target = (root / path).resolve()
    if not target.is_relative_to((root / parent).resolve()):
        raise ValueError(f'越界知识路径: {raw}')
    return target


def card_parts(text):
    matches = list(SECTION.finditer(text))
    if not matches:
        raise ValueError('知识卡缺少可定位的条目段落')
    header = text[:matches[0].start()]
    sections = {}
    for offset, match in enumerate(matches):
        end = matches[offset + 1].start() if offset + 1 < len(matches) else len(text)
        entry_id, title = match.groups()
        if entry_id in sections:
            raise ValueError(f'知识卡编号重复: {entry_id}')
        sections[entry_id] = (title, text[match.end():end], text[match.start():end])
    return header, sections


def prepare(repo, packages):
    sources_path = repo / INDEX / 'sources.json'
    entries_path = repo / INDEX / 'entries.jsonl'
    hierarchy_path = repo / INDEX / 'hierarchy.json'
    sources = by_key(read_json(sources_path), 'source_id')
    prior_entries = by_key(read_rows(entries_path), 'entry_id')
    hierarchy = read_json(hierarchy_path)
    original_hashes = {row[field] for row in sources.values()
                       for field in ('manual_sha256', 'original_media_sha256', 'sha256') if row.get(field)}
    titles = {key: entry_id for entry_id, row in prior_entries.items() for key in title_keys(row)}
    new_entries, new_links, output_files = [], [], {}
    for package in packages:
        incoming = by_key(read_rows(package / 'entries.jsonl'), 'entry_id')
        links = by_key(read_json(package / 'hierarchy-links.json'), 'entry_id')
        new_sources = by_key(read_json(package / 'sources.json'), 'source_id')
        if not incoming or set(incoming) != set(links) or {x['source_id'] for x in incoming.values()} != set(new_sources):
            raise ValueError(f'{package} 的条目、来源与层级不一致')

        by_card = defaultdict(list)
        for entry_id, entry in incoming.items():
            if entry_id in prior_entries or entry['entry_type'] not in TECHNICAL_TYPES:
                raise ValueError(f'条目编号重复或缺少技术内容类型: {entry_id}')
            for key in title_keys(entry):
                if previous := titles.get(key):
                    if previous != entry_id:
                        raise ValueError(f'同品牌型号重复标题: {entry_id} 与 {previous}')
                titles[key] = entry_id
            if not links[entry_id]['components'] or not entry.get('locator'):
                raise ValueError(f'缺少来源定位或组件: {entry_id}')
            prior_entries[entry_id] = entry
            by_card[entry['knowledge_path']].append(entry)
            new_entries.append(entry)
            new_links.append(links[entry_id])

        for source_id, source in new_sources.items():
            if source_id in sources or not source.get('url', '').startswith(('https://', 'http://')):
                raise ValueError(f'来源重复或链接无效: {source_id}')
            original = source.get('manual_sha256') or source.get('original_media_sha256')
            if not re.fullmatch(r'[a-f0-9]{64}', original or '') or original in original_hashes:
                raise ValueError(f'缺少原件哈希或重复原件: {source_id}')
            source_record = checked_path(package, source['path'], ORIGINALS).read_bytes()
            if len(source_record) != source['bytes'] or hashlib.sha256(source_record).hexdigest() != source['sha256']:
                raise ValueError(f'来源记录与哈希不一致: {source_id}')
            target = checked_path(repo, source['path'], ORIGINALS)
            if target.exists() or target in output_files:
                raise ValueError(f'来源记录路径已存在: {target}')
            output_files[target] = source_record
            original_hashes.add(original)
            sources[source_id] = source

        for rel, entries in by_card.items():
            target = checked_path(repo, rel, INDEX)
            if target.exists() or target in output_files:
                raise ValueError(f'知识卡已存在，续增需单独审查: {rel}')
            header, sections = card_parts(checked_path(package, rel, INDEX).read_text(encoding='utf-8'))
            for entry in entries:
                entry_id = entry['entry_id']
                title, body, _ = sections[entry_id]
                source_id = entry['source_id']
                if (entry['title'] != title or entry['locator'] not in body or source_id not in body
                        or entry['brand'] != new_sources[source_id]['brand']):
                    raise ValueError(f'正文与来源、标题或证据定位不一致: {entry_id}')
            card = header + ''.join(sections[entry['entry_id']][2] for entry in entries)
            output_files[target] = (card.rstrip() + '\n').encode('utf-8')

    hierarchy['entries'].extend(new_links)
    output_files[entries_path] = (entries_path.read_bytes().rstrip(b'\r\n') + b'\n'
                                  + ''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in new_entries).encode())
    for path, value in [(sources_path, list(sources.values())), (hierarchy_path, hierarchy)]:
        output_files[path] = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    return output_files, {
        'entries': len(new_entries), 'sources': len({entry['source_id'] for entry in new_entries}),
        'archive_total': len(prior_entries), 'entry_ids': [entry['entry_id'] for entry in new_entries],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('packages', nargs='+', type=lambda value: Path(value).resolve())
    parser.add_argument('--repo', type=lambda value: Path(value).resolve(), default=Path.cwd().resolve())
    parser.add_argument('--write', action='store_true', help='将预检通过的资料写入当前独立工作树')
    args = parser.parse_args()
    files, report = prepare(args.repo, args.packages)
    if args.write:
        for path, content in files.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
    print(json.dumps({**report, 'written': args.write}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
