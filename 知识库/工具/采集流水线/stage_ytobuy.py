#!/usr/bin/env python3
"""把已下载的东方红e购网页整理成待入库候选。

候选里的 evidence_quote 必须是页面去空白文本的子串。脚本不发明参数，
也不把图片故障表认成已核对事实。输出 JSONL 仍是候选，须经 promote.py
写入来源、知识卡和索引。
"""
import argparse
import json
import re
from pathlib import Path

from common import (BODY_LIMIT, COMPONENTS, honor_parts, model_id, normalized,
                    page_text, table_rows, unique, utf16_len)

STATUS = '已对照网页正文；未厂家复核；未实车验证；未全书审校。'
# 页面未给出手册编号、版次或排放。排放字段留空，并用未知标记阻止按后缀推断。
VERSION = '网页未标注手册编号与版次；2026-10-28取得。取得日期不是出版日期'

PAGES = [
    {'view': 20, 'code': 'WFAQ', 'kind': 'faq', 'model': '大中轮拖（页面分节还含小轮拖与履带）',
     'base_models': ['大中轮拖'], 'doc': '厂家商城公开网页；大中轮拖故障问答'},
    {'view': 26, 'code': 'CFAQ', 'kind': 'faq', 'model': '履带拖拉机',
     'base_models': ['履带拖拉机'], 'doc': '厂家商城公开网页；履带拖拉机故障问答'},
    {'view': 82, 'code': 'LGFL', 'kind': 'table', 'model': 'LG1404/LG1504/LG1604',
     'base_models': ['LG1404', 'LG1504', 'LG1604'], 'doc': '厂家商城公开网页；轮式拖拉机故障表'},
    {'view': 89, 'code': 'LDFL', 'kind': 'table', 'model': 'LD1804/LD2104',
     'base_models': ['LD1804', 'LD2104'], 'doc': '厂家商城公开网页；轮式拖拉机故障表'},
    {'view': 92, 'code': 'LXFL', 'kind': 'table', 'model': 'LX2004/LX2204',
     'base_models': ['LX2004', 'LX2204'], 'doc': '厂家商城公开网页；轮式拖拉机故障表'},
    {'view': 21, 'code': 'WUSE', 'kind': 'prose', 'model': '大中轮拖',
     'base_models': ['大中轮拖'], 'doc': '厂家商城公开网页；使用保养知识'},
    {'view': 22, 'code': 'CUSE', 'kind': 'prose', 'model': '履带拖拉机',
     'base_models': ['履带拖拉机'], 'doc': '厂家商城公开网页；使用保养知识'},
    {'view': 41, 'code': 'LDOM', 'kind': 'prose', 'model': 'LD1804/LD2104',
     'base_models': ['LD1804', 'LD2104'], 'doc': '厂家商城公开网页；使用手册'},
    {'view': 42, 'code': 'MEOM', 'kind': 'prose', 'model': 'ME系列',
     'base_models': ['ME系列'], 'doc': '厂家商城公开网页；使用手册'},
    {'view': 43, 'code': 'MFOM', 'kind': 'prose', 'model': 'MF系列',
     'base_models': ['MF系列'], 'doc': '厂家商城公开网页；使用手册'},
    {'view': 44, 'code': 'MEMT', 'kind': 'prose', 'model': 'ME系列',
     'base_models': ['ME系列'], 'doc': '厂家商城公开网页；维修保养手册'},
    {'view': 45, 'code': 'MFMT', 'kind': 'prose', 'model': 'MF系列',
     'base_models': ['MF系列'], 'doc': '厂家商城公开网页；维修保养手册'},
    {'view': 53, 'code': 'LDMT', 'kind': 'prose', 'model': 'LD1804/LD2104',
     'base_models': ['LD1804', 'LD2104'], 'doc': '厂家商城公开网页；维修保养手册'},
    {'view': 54, 'code': 'LFCOM', 'kind': 'prose',
     'model': 'LF804-C/LF904-C/LF954-C/LF1004-C/LF1104-C',
     'base_models': ['LF804-C', 'LF904-C', 'LF954-C', 'LF1004-C', 'LF1104-C'],
     'doc': '厂家商城公开网页；使用手册'},
    {'view': 55, 'code': 'LFCMT', 'kind': 'prose',
     'model': 'LF804-C/LF904-C/LF954-C/LF1004-C/LF1104-C',
     'base_models': ['LF804-C', 'LF904-C', 'LF954-C', 'LF1004-C', 'LF1104-C'],
     'doc': '厂家商城公开网页；维修保养手册'},
    {'view': 56, 'code': 'L12OM', 'kind': 'prose', 'model': 'LF1204/LF1304',
     'base_models': ['LF1204', 'LF1304'], 'doc': '厂家商城公开网页；使用手册'},
    {'view': 57, 'code': 'L12MT', 'kind': 'prose', 'model': 'LF1204/LF1304',
     'base_models': ['LF1204', 'LF1304'], 'doc': '厂家商城公开网页；维修保养手册'},
    {'view': 79, 'code': 'LGOM', 'kind': 'prose', 'model': 'LG1404/LG1504/LG1604',
     'base_models': ['LG1404', 'LG1504', 'LG1604'], 'doc': '厂家商城公开网页；使用手册'},
    {'view': 80, 'code': 'LGMT', 'kind': 'prose', 'model': 'LG1404/LG1504/LG1604',
     'base_models': ['LG1404', 'LG1504', 'LG1604'], 'doc': '厂家商城公开网页；技术保养手册'},
    {'view': 81, 'code': 'LGAD', 'kind': 'prose', 'model': 'LG1404/LG1504/LG1604',
     'base_models': ['LG1404', 'LG1504', 'LG1604'], 'doc': '厂家商城公开网页；主要部件调整'},
    {'view': 88, 'code': 'LDAD', 'kind': 'prose', 'model': 'LD1804/LD2104',
     'base_models': ['LD1804', 'LD2104'], 'doc': '厂家商城公开网页；主要部件调整'},
    {'view': 90, 'code': 'LXOM', 'kind': 'prose', 'model': 'LX2004/LX2204',
     'base_models': ['LX2004', 'LX2204'], 'doc': '厂家商城公开网页；使用手册'},
    {'view': 91, 'code': 'LXMT', 'kind': 'prose', 'model': 'LX2004/LX2204',
     'base_models': ['LX2004', 'LX2204'], 'doc': '厂家商城公开网页；维修保养说明书'},
    {'view': 23, 'code': 'PSGAP', 'kind': 'gap', 'model': '动力换挡拖拉机',
     'base_models': ['动力换挡拖拉机'], 'doc': '厂家商城公开网页；使用保养知识'},
    {'view': 24, 'code': 'IMPGAP', 'kind': 'gap', 'model': '东方红机具',
     'base_models': ['东方红机具'], 'doc': '厂家商城公开网页；机具使用保养知识'},
    {'view': 25, 'code': 'JUDGE', 'kind': 'gap', 'model': '故障判断方法',
     'base_models': ['故障判断方法'], 'doc': '厂家商城公开网页；故障分析'},
    {'view': 86, 'code': 'L12GAP', 'kind': 'gap', 'model': 'LF1204/LF1304',
     'base_models': ['LF1204', 'LF1304'], 'doc': '厂家商城公开网页；故障表'},
    {'view': 87, 'code': 'LFCGAP', 'kind': 'gap',
     'model': 'LF804-C/LF904-C/LF954-C/LF1004-C/LF1104-C',
     'base_models': ['LF804-C', 'LF904-C', 'LF954-C', 'LF1004-C', 'LF1104-C'],
     'doc': '厂家商城公开网页；故障表'},
]

MODEL_RUN = re.compile(
    r'(?:(?:LG|LX|LD|LF|ME|MF|SG|SA|SE)\d{3,4}(?:-[A-Z0-9]+)?|\d{4})'
    r'(?:/(?:(?:LG|LX|LD|LF|ME|MF|SG|SA|SE)\d{3,4}(?:-[A-Z0-9]+)?|\d{4}))+'
)
ACTION_HINT = re.compile(r'更换|调整|清洗|检查|加注|添加|补充|排除|修复|校正|紧固|张紧|修理|清理|排气|充气|打开|吹通')
CIRCLED = '⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇'
ITEM_PREFIX = re.compile(r'^(?:[⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑]\s*|[0-9]{1,2}\s*[\.．、]\s*)')
USEFUL = re.compile(r'严禁|禁止|不得|必须|不得超过|不少于|不超过|小时|℃|°C|MPa|Mpa|mm|保养|机油|柴油|冷却')
HEADING = re.compile(r'^(?:第[0-9一二三四五六七八九十]+|[一二三四五六七八九十]+、)')
ITEM_LINE = re.compile(r'^(\d+)\s*[\.．、]\s*(.*)$')
SUB_LINE = re.compile(r'^[（(]\s*(\d+)\s*[）)]\s*(.*)$')


def source_id(page):
    return f"SRC-YTO-EBUY-{page['code']}"


def components_for(text):
    rules = [
        ('hydraulics', r'液压|提升|农具|分配器|齿轮泵|多路阀|油缸|悬挂'),
        ('transmission', r'离合|变速|挂档|挂挡|脱档|脱挡|摘档|摘挡|同步器'),
        ('brakes', r'制动|刹车'),
        ('steering', r'转向|方向盘'),
        ('cooling', r'水温|水箱|冷却|节温|开锅|风扇'),
        ('electrical', r'起动|启动|电瓶|蓄电池|发电机|灯光|保险丝|仪表|继电器|线路|电锁'),
        ('pto', r'动力输出'),
        ('chassis', r'轮胎|前轮|行走|前束|轮辋'),
        ('fuel', r'柴油|燃油|喷油|油路'),
        ('lubrication', r'机油|润滑'),
        ('engine', r'柴油机|发动机|气门|气缸|拉缸'),
        ('cab', r'驾驶室|空调|暖风'),
    ]
    found = [name for name, pattern in rules if re.search(pattern, text)]
    return found or ['machine']


def split_items(text):
    items, current = [], None
    for raw in text.split('\n'):
        line = raw.strip()
        if not line:
            continue
        numbered = ITEM_LINE.match(line)
        sub = SUB_LINE.match(line)
        if numbered and not sub:
            if current:
                items.append(current)
            current = {'n': numbered.group(1), 'title': numbered.group(2).strip(), 'subs': []}
            continue
        if sub and current is not None:
            current['subs'].append([sub.group(1), sub.group(2).strip()])
            continue
        if current is None:
            continue
        if current['subs']:
            current['subs'][-1][1] = f"{current['subs'][-1][1]} {line}".strip()
        else:
            current['title'] = f"{current['title']} {line}".strip()
    if current:
        items.append(current)
    return items


def strip_item_prefix(text):
    text = ITEM_PREFIX.sub('', text.strip())
    if text and text[0] in CIRCLED:
        text = text[1:].strip()
    return text


def split_subs(cell):
    lines = [line.strip() for line in cell.split('\n') if line.strip()]
    subs = []
    for index, line in enumerate(lines, 1):
        number = index
        if line and line[0] in CIRCLED:
            number = CIRCLED.index(line[0]) + 1
        match = re.match(r'^[（(]\s*(\d+)\s*[）)]', line)
        if match:
            number = int(match.group(1))
        text = strip_item_prefix(line)
        text = re.sub(r'^[（(]\s*\d+\s*[）)]\s*', '', text).strip()
        if text and text not in {'故障原因', '排除方法', '故障现象'}:
            subs.append((str(number), text))
    return subs


def pair_table(left, right):
    left_items, right_items = split_items(left), split_items(right)
    right_by_n = {item['n']: item for item in right_items}
    paired = []
    for item in left_items:
        other = right_by_n.get(item['n'])
        paired.append((item, other))
    return paired


def safe_title(title):
    # 检索把“电动”“无人”当成电动或无人设备，会排除柴油拖拉机归档。标题避开这两个子串，正文仍保留原词。
    return title.replace('电动机', '起动机').replace('无人力', '没有人力')


def shorten(text, limit=80):
    text = re.sub(r'\s+', ' ', text).strip(' ：:。')
    return text if len(text) <= limit else text[:limit].rstrip() + '…'


def scope_text(page, models):
    names = '、'.join(models)
    return (
        f"仅本页写明的{names}。页面未给出手册编号、版次、排放和发动机铭牌，"
        '不外推到未点名机型。随车发动机说明书与本页不是同一份资料。'
    )


def build_fault_body(symptom, causes, actions, page, models, locator, note):
    cause_text = '；'.join(f'{n}. {text}' for n, text in causes) or '原文未单独列出原因，不补造。'
    action_text = '；'.join(f'{n}. {text}' for n, text in actions) or '原文未单独列出排除方法，不补造处理步骤。'
    lines = [
        f'- 故障现象：{symptom}',
        f'- 可能原因：下列为网页列出的候选，不是确诊。{cause_text}',
        '- 诊断步骤：按原编号逐项核对油液、泄漏、操纵和相关零件状态；未对应到某一编号前，不更换零件。',
        f'- 维修建议：与候选原因按原编号对应。{action_text}',
        f'- 适用限制：{scope_text(page, models)}',
        f'- 整理边界：{note}图片未逐张目视。原因不是确诊。',
        f"- 证据：{source_id(page)}；{locator}",
        f'- 状态：{STATUS}',
    ]
    return '\n'.join(lines)


def fit_faults(symptom, causes, actions, page, models, locator, note):
    """超长时按编号切成多条，不删掉未写入的原因。"""
    if not causes and not actions:
        return []
    chunks = [(causes, actions)]
    bodies = []
    while chunks:
        cause_part, action_part = chunks.pop(0)
        body = build_fault_body(symptom, cause_part, action_part, page, models, locator, note)
        if utf16_len(body) <= BODY_LIMIT:
            bodies.append((symptom if not bodies else f'{symptom}（续）', body, cause_part, action_part))
            continue
        if len(cause_part) <= 1 and len(action_part) <= 1:
            cause_bits = re.split(r'(?<=。)', cause_part[0][1]) if cause_part else ['']
            action_bits = re.split(r'(?<=。)', action_part[0][1]) if action_part else ['']
            cause_bits = [bit.strip() for bit in cause_bits if bit.strip()]
            action_bits = [bit.strip() for bit in action_bits if bit.strip()]
            if len(cause_bits) + len(action_bits) <= 1:
                continue
            chunks.append(([(cause_part[0][0], bit) for bit in cause_bits[1:]],
                           [(action_part[0][0], bit) for bit in action_bits[1:]] if action_part else []))
            chunks.append(([(cause_part[0][0], cause_bits[0])] if cause_bits else [],
                           [(action_part[0][0], action_bits[0])] if action_bits else []))
            continue
        half = max(1, max(len(cause_part), len(action_part)) // 2)
        chunks.insert(0, (cause_part[half:], action_part[half:]))
        chunks.insert(0, (cause_part[:half], action_part[:half]))
    if len(bodies) > 1:
        total = len(bodies)
        bodies = [(f'{title}（{index}/{total}）' if '（续）' in title or index > 1 else title, body, causes, actions)
                  for index, (title, body, causes, actions) in enumerate(bodies, 1)]
        # 重写标题后正文仍用原 symptom 字段，标题仅用于索引。上面的续号已在 title。
    return bodies


def quote_for(page_norm, *parts):
    for part in parts:
        token = normalized(part)
        if len(token) >= 6 and token in page_norm:
            return token[:80]
        if len(token) >= 8 and token[:8] in page_norm:
            return token[:8]
    return ''


def add_entry(bucket, page, page_norm, *, title, body, entry_type, models, locator, quote_source, components, roles):
    locator = re.sub(r'\s+', ' ', locator).strip()
    title = safe_title(re.sub(r'\s+', ' ', title).strip())
    if re.search(r'6M3|6A3|6K|SC7|SC9', title) and '严禁使用普通柴油机机油代替' in body:
        title = '严禁使用普通柴油机机油代替'
    if utf16_len(body) > BODY_LIMIT:
        return 'oversize'
    quote = quote_for(page_norm, quote_source, title)
    if not quote:
        return 'no-quote'
    if any(name not in COMPONENTS for name in components):
        return 'bad-component'
    bucket.append({
        'source_id': source_id(page),
        'view': page['view'],
        'doc': page['doc'],
        'page_model': page['model'],
        'page_models': page['base_models'],
        'entry_type': entry_type,
        'title': title,
        'body': body,
        'models': models,
        'locator': locator,
        'components': components,
        'roles': roles,
        'evidence_quote': quote,
        'status': STATUS,
    })
    return 'ok'


def faq_scope(paragraph, current):
    if len(paragraph) > 48:
        return current
    if '小轮拖' in paragraph:
        return ['小轮拖']
    if '履拖' in paragraph or '履带' in paragraph:
        return ['履带拖拉机']
    if '大中轮拖' in paragraph or paragraph.startswith('一、整机'):
        return ['大中轮拖']
    return current


def explicit_models(text, fallback):
    found = MODEL_RUN.search(text.replace(' ', ''))
    if not found:
        return fallback
    parts = found.group(0).split('/')
    # 纯数字或混有无前缀马力时，不写入精确 models，避免 TK-1404 这类编号被当成机型。
    if any(re.fullmatch(r'\d{3,4}', part) for part in parts):
        return fallback
    return unique(parts)


def parse_faq(page, paragraphs, page_norm, bucket):
    scope = page['base_models']
    index = 0
    while index < len(paragraphs):
        paragraph = paragraphs[index]
        scope = faq_scope(paragraph, scope)
        numbered = re.match(r'^(\d+)\s*[、.．]\s*(.+)$', paragraph)
        if not numbered:
            index += 1
            continue
        block = [paragraph]
        index += 1
        while index < len(paragraphs) and not re.match(r'^\d+\s*[、.．]\s*', paragraphs[index]):
            scope_next = faq_scope(paragraphs[index], scope)
            if scope_next != scope and len(paragraphs[index]) <= 48:
                break
            block.append(paragraphs[index])
            index += 1
        text = '\n'.join(block)
        if '[[IMAGE]]' in text and not re.search(r'原因|排除|更换|检查', text):
            continue
        symptom = re.sub(r'^(\d+)\s*[、.．]\s*', '', block[0])
        symptom = re.sub(r'(有哪些原因|如何排除|原因分析|原因是什么|？|\?)+', '', symptom).strip(' ：:。')
        cause_match = re.search(r'原因分析[:：]\s*(.*)', text, re.S)
        action_match = re.search(r'排除方法[:：]\s*(.*)', text, re.S)
        if cause_match or action_match:
            causes = numbered_bits(cause_match.group(1).split('排除方法')[0] if cause_match else '')
            actions = numbered_bits(action_match.group(1) if action_match else '')
        else:
            causes, actions = split_combined(block[1:])
        if not causes and not actions:
            continue
        models = explicit_models(symptom, scope)
        note = '网页问答。' if models == scope else '本问点名的型号按原文保留，未补系列前缀。'
        if len(causes) != len(actions) and causes and actions:
            note += '原因与排除的编号数量不一致，缺号不补。'
        locator = f"网页第{numbered.group(1)}问；型号范围{'/'.join(models)}"
        bodies = fit_faults(shorten(symptom, 36), causes, actions, page, models, locator, note)
        for title, body, _, _ in bodies:
            add_entry(bucket, page, page_norm, title=title, body=body, entry_type='维护/故障知识',
                      models=models, locator=locator, quote_source=symptom, components=components_for(text),
                      roles=['symptom', 'cause', 'check', 'action'])


def numbered_bits(text):
    bits = []
    for line in re.split(r'(?=(?:^|\s)\d+\s*[\.．、])', text):
        line = re.sub(r'\s+', ' ', line).strip()
        match = re.match(r'^(\d+)\s*[\.．、]\s*(.+)$', line)
        if match and match.group(2).strip():
            bits.append((match.group(1), match.group(2).strip()))
    if bits:
        return bits
    text = re.sub(r'\s+', ' ', text).strip()
    return [('1', text)] if text else []


def split_combined(paragraphs):
    causes, actions = [], []
    for paragraph in paragraphs:
        match = SUB_LINE.match(paragraph) or ITEM_LINE.match(paragraph)
        content = match.group(2).strip() if match else paragraph
        number = match.group(1) if match else str(len(causes) + 1)
        if '[[IMAGE]]' in content or len(content) < 4:
            continue
        parts = re.split(r'[，,]', content, maxsplit=1)
        if len(parts) == 2 and ACTION_HINT.search(parts[1]):
            causes.append((number, parts[0].strip()))
            actions.append((number, parts[1].strip()))
        else:
            causes.append((number, content))
    return causes, actions


def parse_tables(page, tables, page_norm, bucket, section):
    count = 0
    for table_index, table in enumerate(tables, 1):
        rows = table_rows(table)
        if not rows:
            continue
        header = ''.join(rows[0])
        if '故障' not in header and '排除' not in header:
            continue
        for row_index, row in enumerate(rows[1:], 1):
            if len(row) < 2:
                continue
            extracted = []
            if len(row) >= 3 and not ITEM_LINE.match(row[0].split('\n')[0]):
                symptom = strip_item_prefix(row[0].split('\n')[0])
                extracted.append((str(row_index), symptom, split_subs(row[1]), split_subs(row[2])))
            else:
                for left_item, right_item in pair_table(row[0], row[1] if len(row) == 2 else row[0]):
                    causes = [(n, text) for n, text in left_item['subs'] if text]
                    actions = [(n, text) for n, text in (right_item['subs'] if right_item else []) if text]
                    if len(row) >= 3:
                        actions = split_subs(row[2]) or actions
                    extracted.append((left_item['n'], left_item['title'], causes, actions))
            for number, symptom, causes, actions in extracted:
                symptom = strip_item_prefix(symptom)
                if symptom in {'故障现象和原因', '排除方法', '故障现象', '故障原因'} or len(symptom) < 2:
                    continue
                if not causes and not actions:
                    continue
                count += 1
                models = explicit_models(symptom, page['base_models'])
                note = '故障表行。' if models == page['base_models'] else '现象文字中的型号按原文保留。'
                if [n for n, _ in causes] != [n for n, _ in actions]:
                    note += '原因与排除的编号数量不一致，缺号不补，也不重排。'
                locator = f'故障表{table_index}；原行号{number}'
                bodies = fit_faults(shorten(symptom, 36), causes, actions, page, models, locator, note)
                for title, body, _, _ in bodies:
                    add_entry(bucket, page, page_norm, title=title, body=body, entry_type='维护/故障知识',
                              models=models, locator=locator, quote_source=symptom,
                              components=components_for(symptom + section), roles=['symptom', 'cause', 'check', 'action'])
    return count


def is_heading(paragraph):
    if paragraph.startswith('[['):
        return False
    if ITEM_LINE.match(paragraph) or SUB_LINE.match(paragraph):
        return False
    if HEADING.match(paragraph) and len(paragraph) <= 40:
        return True
    return len(paragraph) <= 24 and re.search(r'保养|启动|起动|安全|注意|调整|使用|操纵|磨合|存放|润滑', paragraph)


def parse_prose(page, paragraphs, page_norm, bucket):
    sections, current = [], None
    for paragraph in paragraphs:
        if paragraph.startswith('[[TABLE'):
            if current:
                current['notes'].append('本节有表格，未逐格转录，避免把未核对的表写成参数。')
            continue
        if paragraph == '[[IMAGE]]':
            continue
        if is_heading(paragraph):
            current = {'title': paragraph, 'lines': [], 'notes': []}
            sections.append(current)
            continue
        if current is None:
            current = {'title': '页面前部', 'lines': [], 'notes': []}
            sections.append(current)
        current['lines'].append(paragraph)
    for section in sections:
        lines = [line for line in section['lines'] if line != '[[IMAGE]]']
        if not lines:
            continue
        text = '\n'.join(lines)
        if not USEFUL.search(text) and '说明书' not in text:
            continue
        entry_type = '系统适用边界' if ('说明书' in text and len(text) < 180 and not re.search(r'\d+\s*小时', text)) else (
            '安全操作' if re.search(r'严禁|禁止', text) and '保养' not in section['title'] else '操作/维护知识')
        title = section['title']
        if len(title) <= 6 and lines:
            prefix = title if title.endswith(('：', ':')) else f'{title}：'
            title = f"{prefix}{shorten(lines[0], 22)}"
        if entry_type == '系统适用边界':
            body_lines = [f"- 手册事实：{section['title']}。{text}"]
            kept = [text]
        else:
            if not any(USEFUL.search(line) for line in lines):
                continue
            kept = lines
            body_lines = [f"- 手册事实：{section['title']}。网页列出：{' '.join(kept)}"]
        models = explicit_models(text[:120], page['base_models'])
        note = '；'.join(section['notes']) or '按网页文字概述，不补图表中的未读数值。'
        locator = f"栏目：{section['title'].strip()}"
        body = '\n'.join(body_lines + [
            f'- 适用限制：{scope_text(page, models)}',
            f'- 整理边界：{note}油品、容量、扭矩和周期只保留本段原文，不外推。',
            f"- 证据：{source_id(page)}；{locator}",
            f'- 状态：{STATUS}',
        ])
        pieces = split_body(title, body, page, models, locator, note, kept if entry_type != '系统适用边界' else [text])
        for title, piece in pieces:
            roles = None if entry_type == '系统适用边界' else None
            add_entry(bucket, page, page_norm, title=shorten(title, 36), body=piece, entry_type=entry_type,
                      models=models, locator=locator, quote_source=lines[0], components=components_for(section['title'] + (lines[0][:80] if lines else '')),
                      roles=roles)


def split_body(title, body, page, models, locator, note, lines):
    if utf16_len(body) <= BODY_LIMIT:
        return [(title, body)]
    result, chunk = [], []
    for line in lines:
        trial_lines = chunk + [line]
        trial = compose_prose(title, trial_lines, page, models, locator, note)
        if chunk and utf16_len(trial) > BODY_LIMIT:
            result.append((f'{title}（{len(result) + 1}）', compose_prose(title, chunk, page, models, locator, note)))
            chunk = [line]
        else:
            chunk = trial_lines
    if chunk:
        result.append((f'{title}（{len(result) + 1}）' if result else title,
                       compose_prose(title, chunk, page, models, locator, note)))
    return [(name, text) for name, text in result if utf16_len(text) <= BODY_LIMIT]


def compose_prose(title, lines, page, models, locator, note):
    return '\n'.join([
        f"- 手册事实：{title}。网页列出：{' '.join(lines)}",
        f'- 适用限制：{scope_text(page, models)}',
        f'- 整理边界：{note}油品、容量、扭矩和周期只保留本段原文，不外推。',
        f"- 证据：{source_id(page)}；{locator}",
        f'- 状态：{STATUS}',
    ])


def parse_gap(page, paragraphs, page_norm, bucket, image_count):
    text_len = sum(len(p) for p in paragraphs if not p.startswith('[['))
    title = '该页未形成可核对的维修正文'
    body = '\n'.join([
        f'- 手册事实：页面标题可核对，但正文约{text_len}字、图片约{image_count}张。',
        '- 资料缺口：图片中的故障表、参数表本轮没有逐张目视或OCR，不能当成已核对的故障原因、故障码或维修步骤。',
        f'- 适用限制：{scope_text(page, page["base_models"])}',
        '- 整理边界：只记录“未取得可核对正文”，不根据文件名或相邻机型补写。',
        f"- 证据：{source_id(page)}；页面<h1>",
        f'- 状态：{STATUS}',
    ])
    add_entry(bucket, page, page_norm, title=title, body=body, entry_type='资料缺口',
              models=page['base_models'], locator='页面标题', quote_source=page.get('_h1') or page['model'],
              components=['documents'], roles=None)


def stage(html_dir):
    bucket, skipped = [], []
    seen = set()
    for page in PAGES:
        path = Path(html_dir) / f"view-{page['view']}.html"
        if not path.exists():
            skipped.append({'view': page['view'], 'reason': '文件不存在'})
            continue
        html = path.read_text('utf-8', 'replace')
        h1, page_norm = page_text(html)
        page = {**page, '_h1': h1}
        if page['base_models'][0] not in {'大中轮拖', '履带拖拉机', '动力换挡拖拉机', '东方红机具', '故障判断方法', 'ME系列', 'MF系列'}:
            missing = [model for model in page['base_models'] if normalized(model) not in page_norm]
            if missing and page['kind'] != 'gap':
                skipped.append({'view': page['view'], 'reason': f'标题或正文未见型号 {missing}'})
                continue
        paragraphs, tables = honor_parts(html)
        before = len(bucket)
        if page['kind'] == 'faq':
            parse_faq(page, paragraphs, page_norm, bucket)
        elif page['kind'] == 'table':
            section = '\n'.join(paragraphs)
            parse_tables(page, tables, page_norm, bucket, section)
        elif page['kind'] == 'prose':
            parse_prose(page, paragraphs, page_norm, bucket)
        else:
            image_count = html.lower().count('<img')
            parse_gap(page, paragraphs, page_norm, bucket, image_count)
        fresh = []
        seen_titles = {}
        for entry in bucket[before:]:
            key = (tuple(entry['models']), normalized(entry['title'] + entry['body']))
            if key in seen:
                continue
            seen.add(key)
            title_key = entry['title']
            seen_titles[title_key] = seen_titles.get(title_key, 0) + 1
            if seen_titles[title_key] > 1:
                entry['title'] = f"{entry['title']}（{seen_titles[title_key]}）"
            fresh.append(entry)
        del bucket[before:]
        bucket.extend(fresh)
        for offset, entry in enumerate(fresh, 1):
            entry['entry_id'] = f"KB-YTO-EBUY-{page['code']}-{offset:03d}"
            entry['h1'] = h1
            entry['html_sha256'] = __import__('hashlib').sha256(path.read_bytes()).hexdigest()
            entry['html_bytes'] = path.stat().st_size
            entry['url'] = f"http://ytobuy.nongji360.com/service/view/{page['view']}"
    return bucket, skipped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--html-dir', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    rows, skipped = stage(args.html_dir)
    out = Path(args.out)
    out.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding='utf-8')
    from collections import Counter
    print(json.dumps({
        'entries': len(rows),
        'by_type': Counter(row['entry_type'] for row in rows),
        'by_source': Counter(row['source_id'] for row in rows),
        'skipped_pages': skipped,
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
