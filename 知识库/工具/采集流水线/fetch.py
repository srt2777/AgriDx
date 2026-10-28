#!/usr/bin/env python3
"""低并发下载公开 URL，只写工作目录里的响应和清单。不写入维修索引。"""
import argparse
import hashlib
import json
import time
import urllib.request
from pathlib import Path


def fetch(url, dest, timeout):
    request = urllib.request.Request(url, headers={'User-Agent': 'AgriDx-kb-research/1.0'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = response.read()
        content_type = response.headers.get('Content-Type', '')
        status = getattr(response, 'status', 200)
    dest.write_bytes(data)
    return {
        'url': url,
        'status': status,
        'content_type': content_type.split(';')[0].strip(),
        'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
        'path': str(dest),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--targets', required=True, help='JSON 数组，元素含 url，可选 name')
    parser.add_argument('--workdir', required=True)
    parser.add_argument('--delay', type=float, default=0.4)
    parser.add_argument('--timeout', type=float, default=60)
    args = parser.parse_args()
    work = Path(args.workdir)
    work.mkdir(parents=True, exist_ok=True)
    targets = json.loads(Path(args.targets).read_text(encoding='utf-8'))
    manifest = []
    for index, target in enumerate(targets, 1):
        name = target.get('name') or f'fetch-{index}'
        dest = work / name
        try:
            record = fetch(target['url'], dest, args.timeout)
            record['ok'] = True
        except Exception as error:  # 网络失败留在清单，不当成“全网没有”。
            record = {'url': target['url'], 'ok': False, 'error': f'{type(error).__name__}: {error}'}
        manifest.append(record)
        print(json.dumps(record, ensure_ascii=False))
        time.sleep(args.delay)
    (work / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
