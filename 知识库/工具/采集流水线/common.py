"""采集流水线共用的纯函数。不下载、不改索引。"""
import hashlib
import re
from html import unescape
from pathlib import Path

ENTRY_TYPES = {'维护/故障知识', '操作/维护知识', '安全操作', '系统安装/调试',
               '系统适用边界', '资料索引', '资料核验', '机型资料', '资料缺口'}
COMPONENTS = {
    'machine', 'engine', 'fuel', 'cooling', 'lubrication', 'electrical',
    'transmission', 'hydraulics', 'steering', 'brakes', 'chassis', 'pto', 'cab',
    'navigation', 'documents',
}
BODY_LIMIT = 1200


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def utf16_len(text):
    return len(text.encode('utf-16-le')) // 2


def model_id(name):
    text = name.strip().replace('（', '(').replace('）', ')')
    text = re.sub(r'\s+', '', text).upper()
    text = re.sub(r'[^0-9A-Z\u4e00-\u9fff()\-]', '-', text).strip('-')
    return text


def unique(items):
    seen, result = set(), []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def strip_tags(fragment):
    fragment = re.sub(r'<br\s*/?>', '\n', fragment, flags=re.I)
    fragment = re.sub(r'</p>', '\n', fragment, flags=re.I)
    fragment = re.sub(r'<[^>]+>', '', fragment)
    fragment = unescape(fragment).replace('\xa0', ' ')
    fragment = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', fragment)
    return fragment


def normalized(text):
    return re.sub(r'\s+', '', text or '')


def page_text(html):
    """返回 (h1, 去标签后的全文)。全文用于证据子串核对，不写入知识卡。"""
    title_match = re.search(r'<h1>(.*?)</h1>', html, re.S | re.I)
    title = re.sub(r'\s+', ' ', strip_tags(title_match.group(1))).strip() if title_match else ''
    return title, normalized(strip_tags(html))


def honor_parts(html):
    """拆出商城正文段落，并把表格、图片留成占位。"""
    match = re.search(r'<div class="honor_center">(.*)</div>\s*</div>', html, re.S | re.I)
    body = match.group(1) if match else ''
    # 商城页脚样式和分享栏不是手册正文。
    for marker in ('<style', 'class="service-flow"', 'class="slogen"'):
        cut = body.lower().find(marker.lower()) if marker.startswith('<') else body.find(marker)
        if cut >= 0:
            body = body[:cut]
    tables = []

    def keep_table(found):
        tables.append(found.group(0))
        return f'\n[[TABLE {len(tables) - 1}]]\n'

    body = re.sub(r'<table[\s\S]*?</table>', keep_table, body, flags=re.I)
    body = re.sub(r'<img\b[^>]*>', '\n[[IMAGE]]\n', body, flags=re.I)
    text = strip_tags(body)
    paragraphs = []
    for part in text.split('\n'):
        part = re.sub(r'[ \t\u3000]+', ' ', part).strip()
        part = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', part)
        if part and not re.search(r'service-flow|\{height:|贷款产品|新手指南|正品保障|移动商城', part):
            paragraphs.append(part)
    return paragraphs, tables


def table_rows(table_html):
    rows = []
    for row_html in re.findall(r'<tr[\s\S]*?</tr>', table_html, re.I):
        cells = []
        for cell_html in re.findall(r'<t[dh][^>]*>([\s\S]*?)</t[dh]>', row_html, re.I):
            cell = strip_tags(cell_html)
            lines = [re.sub(r'[ \t\u3000]+', ' ', line).strip() for line in cell.split('\n')]
            cells.append('\n'.join(line for line in lines if line))
        if any(cell.strip() for cell in cells):
            rows.append(cells)
    return rows
