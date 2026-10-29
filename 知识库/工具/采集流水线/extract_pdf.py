#!/usr/bin/env python3
"""提取 PDF 文本层。没有文本层时只报告，不把 OCR 猜测写成事实。"""
import argparse
import json
from pathlib import Path


def extract(path):
    import fitz
    document = fitz.open(path)
    pages = []
    for index, page in enumerate(document, 1):
        text = page.get_text('text') or ''
        pages.append({'page': index, 'chars': len(text.strip()), 'text': text})
    return {'pages': document.page_count, 'text_pages': sum(page['chars'] > 30 for page in pages), 'items': pages}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    result = extract(args.pdf)
    Path(args.out).write_text(json.dumps({
        'pdf': args.pdf,
        'pages': result['pages'],
        'text_pages': result['text_pages'],
        'page_text': [{'page': item['page'], 'chars': item['chars'], 'text': item['text']} for item in result['items']],
    }, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'pages': result['pages'], 'text_pages': result['text_pages']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
