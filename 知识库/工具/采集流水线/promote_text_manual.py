#!/usr/bin/env python3
"""把已下载、文字层可核对的手册概述写入索引。

证据句必须能在对应 PDF 页的文字层里找到。不保存手册全文，不补造对不齐的表格数值。
"""
import argparse
import json
import re
from pathlib import Path

from common import model_id, sha256_file, unique

REPO = Path(__file__).resolve().parents[3]
INDEX = REPO / '知识库/整理后的知识库/农用拖拉机知识库'
HIERARCHY_PARTS = None

SKIP_PAGE_RATIO = 0.45
CN = re.compile(r'[\u4e00-\u9fff]')


def chinese_count(text):
    return len(CN.findall(text))


def norm(text):
    return re.sub(r'\s+', '', text or '')


def contains(page, quote):
    return bool(quote) and norm(quote) in norm(page)


def printed_page(text):
    for raw in text.splitlines()[:6]:
        line = raw.strip()
        if re.fullmatch(r'\d{1,3}', line):
            return int(line)
        match = re.search(r'使用说明书\s+(\d{1,3})\s*$', line)
        if match:
            return int(match.group(1))
    return None


def content_lines(text):
    lines = []
    for raw in text.splitlines():
        line = re.sub(r'\s+', ' ', raw).strip()
        if not line or re.fullmatch(r'\d{1,3}', line):
            continue
        if '系列轮式拖拉机使用说明书' in line and len(line) < 40:
            continue
        if re.fullmatch(r'第[一二三四五六七八九十]+章(?:\s+\S+){0,6}', line) and len(line) < 24:
            continue
        if line in {'故障现象', '故障原因', '排除方法', '目 录', '目录'}:
            continue
        lines.append(line)
    return lines


def is_fault_page(text):
    compact = norm(text)
    return '故障现象' in compact and '故障原因' in compact and '排除方法' in compact


def short_ratio(lines):
    if not lines:
        return 1
    return sum(len(line) < 12 for line in lines) / len(lines)


def parse_fault_rows(lines):
    rows, current = [], None

    def close():
        nonlocal current
        if current and chinese_count(current['symptom']) >= 2 and current['chunks']:
            rows.append(current)
        current = None

    for line in lines:
        if re.search(r'表\s*\d', line) and '故障' in line and len(line) < 40:
            close()
            continue
        match = re.match(r'^(\d+)[\.、]\s*(.+)$', line)
        if match and not line.startswith('（'):
            close()
            current = {'symptom': match.group(2), 'chunks': []}
            continue
        if current is None:
            continue
        if re.match(r'^（\d+）', line):
            current['chunks'].append(line)
        elif current['chunks']:
            current['chunks'][-1] += line
        else:
            current['symptom'] += line
    close()
    parsed = []
    for row in rows:
        symptom = re.sub(r'\s+', '', row['symptom'])
        if '见表' in symptom or '排除方法' in symptom and '表' in symptom:
            continue
        chunks = [re.sub(r'\s+', '', chunk) for chunk in row['chunks']]
        starts = [index for index, chunk in enumerate(chunks) if chunk.startswith('（1）')]
        if len(starts) < 1:
            continue
        causes = chunks[starts[0]:starts[1]] if len(starts) >= 2 else chunks[starts[0]:]
        actions = chunks[starts[1]:] if len(starts) >= 2 else []
        if not causes:
            continue
        parsed.append({'symptom': symptom, 'causes': causes, 'actions': actions})
    return parsed


SENTENCE_START = re.compile(
    r'^(?:\d+[\.、]|（\d+）|请|必须|严禁|不要|不得|不允许|禁止|若|当|为了|本|该系列|在使用|使用|拖拉机|发动机|柴油机|柴油|驾驶员|'
    r'注意|警告|重要|新购置|定期|正确|任何|操作|维修|保养|液压|离合器|变速|制动|转向|轮胎|蓄电池|燃油|机油|冷却|空气|'
    r'滤清|国三|国四|国五|玉柴|添加|检查|更换|清洗|安装|打开|关闭|起动|启动|停车|磨合|钥匙|故障|选择|劣质|添蓝|'
    r'尿素|计量|温度传感器|喷嘴|后处理|车辆|用户|为了提高|随着)'
)


def page_sentences(text):
    """完整句必须本身在文字层中连续，并且要么接在句号后，要么从一行行首的完整说法开始。"""
    cleaned = [re.sub(r'\s+', '', line) for line in content_lines(text)]
    blob = ''.join(cleaned)
    starts, offset = set(), 0
    for line in cleaned:
        starts.add(offset)
        offset += len(line)
    pieces = [piece for piece in re.split(r'(?<=[。！？])', blob) if piece]
    kept, cursor = [], 0
    for piece in pieces:
        index = blob.find(piece, cursor)
        if index < 0:
            continue
        cursor = index + len(piece)
        if not re.search(r'[。！？]$', piece):
            continue
        if chinese_count(piece) < 18 or len(piece) > 360:
            continue
        if sum(character.isdigit() for character in piece) / len(piece) > 0.35:
            continue
        after_stop = index > 0 and blob[index - 1] in '。！？'
        at_start = index in starts and bool(SENTENCE_START.match(piece))
        if not after_stop and not at_start:
            continue
        if piece.startswith('图') or '用户姓名' in piece or '身份证' in piece:
            continue
        if '使用说明书' in piece[8:] or re.search(r'第[一二三四五六七八九十]+章', piece):
            continue
        if '\ufffd' in piece or not contains(text, piece):
            continue
        kept.append(piece)
    return kept


def title_of(text):
    head = re.sub(r'^(?:\d+[\.、]|（\d+）|●)+', '', text)
    head = re.split(r'[。！？]', head, maxsplit=1)[0]
    head = head.strip(' ：:，,；;')
    if len(head) > 28:
        head = head[:28].rstrip('，,、；;')
    return head or '手册语句'


def component_ids(text):
    rules = [
        ('fuel', ('燃油', '柴油滤', '柴滤', '喷油', '油箱', '供油')),
        ('cooling', ('冷却', '水温', '散热器', '风扇', '防冻液')),
        ('lubrication', ('机油', '润滑')),
        ('electrical', ('蓄电池', '发电机', '起动机', '线束', '保险', 'ECU', '电控')),
        ('transmission', ('变速', '离合器', '换挡', '挂档', '脱档')),
        ('hydraulics', ('液压', '提升器', '悬挂', '分配器')),
        ('steering', ('转向',)),
        ('brakes', ('制动', '刹车', '气刹')),
        ('pto', ('动力输出',)),
        ('engine', ('发动机', '柴油机', '空气滤', '空滤', '增压', '气门')),
        ('cab', ('驾驶室', '座椅', '暖风')),
        ('chassis', ('轮胎', '轮距', '前束', '前桥', '配重')),
    ]
    found = [name for name, words in rules if any(word in text for word in words)]
    return found[:4] or ['machine']


def part_ids(component, text):
    matched = []
    for part in HIERARCHY_PARTS.get(component, []):
        if any(term and term in text for term in part['evidence_terms'] if len(term) >= 2):
            matched.append(part['id'])
    return unique(matched)


def load_parts():
    global HIERARCHY_PARTS
    data = json.loads((INDEX / 'hierarchy.json').read_text(encoding='utf-8'))
    HIERARCHY_PARTS = {item['id']: item['parts'] for item in data['components']}
    return data


def links_for(text):
    return [{
        'component_id': component,
        'part_ids': part_ids(component, text),
    } for component in component_ids(text)]


WZ_MODELS = [
    'TS800Ⅲ', 'TS804Ⅲ', 'TS850Ⅲ', 'TS854Ⅲ', 'TS900Ⅲ', 'TS904Ⅲ', 'TS950Ⅲ', 'TS954Ⅲ',
    'TS1000Ⅲ', 'TS1004Ⅲ', 'TS1100Ⅲ', 'TS1104Ⅲ', 'TS1200Ⅲ', 'TS1204Ⅲ',
    'ME1100A', 'ME1104A', 'ME1200A', 'ME1204A', 'ME1300', 'ME1300-A',
    'ME1304', 'ME1354', 'ME1400', 'ME1404', 'ME1504', 'ME1604',
]
WZ_LIMIT = (
    '仅《TS/ME系列轮式拖拉机使用说明书》编号TS/ME-18.3、2018年3月第一版封面所列'
    'TS800Ⅲ至TS1204Ⅲ与ME1100A至ME1604。封面文字层另有一处“S954Ⅲ”，与封面TS954Ⅲ不一致，不另立型号。'
    '本册有“国三发动机注意事项”，不用于国四整机。发动机故障与参数见随车发动机说明书。'
)


def wz_entries(pages):
    seen, rows = set(), []
    for page in pages:
        if page['page'] in {1, 2, 6, 7, 8, 46, 52} or page['page'] >= 91:
            continue
        lines = content_lines(page['text'])
        if is_fault_page(page['text']):
            for fault in parse_fault_rows(lines):
                blob = fault['symptom'] + ''.join(fault['causes'] + fault['actions'])
                if not contains(page['text'], fault['symptom']) or norm(blob) in seen:
                    continue
                if not all(contains(page['text'], piece) for piece in fault['causes'] + fault['actions']):
                    continue
                seen.add(norm(blob))
                rows.append(fault_entry('WZ', page, fault, WZ_LIMIT))
            continue
        if short_ratio(lines) > SKIP_PAGE_RATIO:
            continue
        for item in page_sentences(page['text']):
            if norm(item) in seen:
                continue
            seen.add(norm(item))
            kind = '安全操作' if page['page'] <= 19 and re.search(r'严禁|禁止|不得|不允许|必须|警告', item) else (
                '维护/故障知识' if '故障' in item else '操作/维护知识')
            rows.append(prose_entry('WZ', page, item, kind, WZ_LIMIT))
    return rows


def fault_entry(prefix, page, fault, limit):
    causes = ' '.join(fault['causes'])
    actions = ' '.join(fault['actions'])
    lines = [
        f"- 故障现象：{fault['symptom']}",
        f"- 可能原因：下列为手册列出的候选，不是确诊。{causes}",
    ]
    roles = ['symptom', 'cause']
    lines.append('- 诊断步骤：按原编号逐项核对零件、油液和操纵状态；未对应到某一编号前，不更换零件。')
    roles.append('check')
    cause_n = len(re.findall(r'（\d+）', causes))
    action_n = len(re.findall(r'（\d+）', actions))
    if actions and cause_n == action_n:
        lines.append(f'- 维修建议：与候选原因按原编号对应。{actions}')
        roles.append('action')
    elif actions:
        lines.append(f'- 维修建议：原文原因与排除的编号数量不一致，不按序号强行配对，也不补造。排除方法原文为：{actions}')
        roles.append('action')
    else:
        lines.append('- 维修建议：原文未单独列出排除方法，不补造处理步骤。')
    lines += [
        f'- 适用限制：{limit}',
        '- 整理边界：文字层故障表。原因不是确诊。诊断步骤是按原编号核对的整理要求，不是手册另列的流程。',
        f"- 证据：SRC-WZ-TSME-201803；PDF第{page['page']}页" + (f"；印刷第{page['printed']}页" if page['printed'] else '') + '。',
    ]
    body = '\n'.join(lines)
    return {
        'title': title_of(fault['symptom']),
        'body': body,
        'entry_type': '维护/故障知识',
        'roles': roles,
        'page': page['page'],
        'text': fault['symptom'] + causes + actions,
    }


def prose_entry(prefix, page, item, kind, limit):
    locator = f"PDF第{page['page']}页" + (f"；印刷第{page['printed']}页" if page['printed'] else '')
    source = 'SRC-WZ-TSME-201803' if prefix == 'WZ' else prefix
    body = '\n'.join([
        f'- 手册事实：{item}',
        f'- 适用限制：{limit}',
        '- 整理边界：取自该页文字层中已经结束的句子，未改数值。短行参数表整页跳过。未逐页图像审校全书。',
        f'- 证据：{source}；{locator}。',
    ])
    return {'title': title_of(item), 'body': body, 'entry_type': kind, 'roles': [], 'page': page['page'], 'text': item}


YC_CN3_LIMIT = (
    '仅广西玉柴机器股份有限公司客户服务中心公开《玉柴国3柴油机维护保养-v1.1》。'
    '适用其所述国三电控柴油机，不是某一拖拉机整机手册。'
    '公里周期按车用口径保留，不换算成拖拉机工作小时；原文另行写出的小时数只在该句内有效。'
    '封面机型矩阵是举例，不把每一条保养写成全部举例机型的随车参数。机油等级原文要求以发动机说明书为准。'
)
YC_SCR_LIMIT = (
    '仅广西玉柴机器股份有限公司客户服务中心公开《玉柴SCR国4、国5发动机维护保养-v1.1》。'
    '同时写明国四与国五SCR，不单独标成其中一级，也不套用到非SCR或未点名的拖拉机。'
    '正文有汽车尾气、车用柴油和车辆公里表述。公里数不换算；小时数、扭矩只按该句原文。'
    'BOSCH与格兰富、有无压缩空气滤清器的差别按原文脚注保留。'
)


def yuchai_pages(pdf):
    import pymupdf
    document = pymupdf.open(pdf)
    pages = []
    for index, page in enumerate(document, 1):
        text = page.get_text('text') or ''
        pages.append({'page': index, 'printed': None, 'text': text})
    return pages


def bullet_entries(pages, source_id, limit, skip_pages):
    seen, rows = set(), []
    for page in pages:
        if page['page'] in skip_pages:
            continue
        for item in page_sentences(page['text']):
            item = item.lstrip('Î').strip()
            if norm(item) in seen:
                continue
            if item.startswith(('动力更强', '品质更高', '燃油更省', '排放更低', '噪音更小', '以养代修')):
                continue
            seen.add(norm(item))
            kind = '安全操作' if re.search(r'严禁|不要用水|危及人身', item) else (
                '维护/故障知识' if re.search(r'故障|劣质|堵塞|磨损|卡死', item) else '操作/维护知识')
            body = '\n'.join([
                f'- 手册事实：{item}',
                f'- 适用限制：{limit}',
                '- 整理边界：取自该页文字层中已经结束的句子。机型矩阵和未逐格核对的保养总表不在本条。',
                f'- 证据：{source_id}；PDF第{page["page"]}页。',
            ])
            rows.append({
                'title': title_of(item), 'body': body, 'entry_type': kind, 'roles': [],
                'page': page['page'], 'text': item, 'source_id': source_id,
            })
    return rows


CN3_TABLE = [
    (8, '日常维护', '每日进行', '检查油箱油量'),
    (8, '日常维护', '每日进行', '检查冷却水量'),
    (8, '日常维护', '每日进行', '检查油底壳及喷油泵内的机油量'),
    (8, '日常维护', '每日进行', '检查“三漏”情况'),
    (8, '一级保养', '每1500～2000km(或每50小时)', '所有日常维护项目'),
    (8, '一级保养', '每1500～2000km(或每50小时)', '清洗机油滤清器及输油泵进油滤网'),
    (8, '一级保养', '每1500～2000km(或每50小时)', '检查风扇皮带的松紧度'),
    (8, '一级保养', '每1500～2000km(或每50小时)', '检查缸盖螺母的拧紧情况'),
    (8, '一级保养', '每1500～2000km(或每50小时)', '检查并调整气门间隙'),
    (8, '一级保养', '每1500～2000km(或每50小时)', '检查喷油器的工作压力（若柴油机性能出现异常时）'),
    (8, '一级保养', '每1500～2000km(或每50小时)', '对新机或刚大修好的机更换机油'),
    (8, '二级保养', '每5000～6000km(或每150小时)', '所有一级保养项目'),
    (8, '二级保养', '每5000～6000km(或每150小时)', '检查供油提前角'),
    (8, '二级保养', '每5000～6000km(或每150小时)', '每隔一次二级保养(每10000km)更换机油滤清器'),
    (8, '二级保养', '每5000～6000km(或每150小时)', '每隔三次二级保养(每20000km)更换柴油滤清器'),
    (8, '二级保养', '每5000～6000km(或每150小时)', '清洁空气滤清器'),
    (8, '二级保养', '每5000～6000km(或每150小时)', '检查气门密封情况'),
    (8, '二级保养', '每5000～6000km(或每150小时)', '给水泵加注润滑脂'),
    (8, '二级保养', '每5000～6000km(或每150小时)', '检查电器线路各连接点的接触情况'),
    (8, '二级保养', '每5000～6000km(或每150小时)', '检查所有重要螺栓螺母的拧紧情况'),
    (8, '二级保养', '每5000～6000km(或每150小时)', '若水套结垢严重应清除'),
    (8, '二级保养', '每5000～6000km(或每150小时)', '清洗呼吸器滤芯'),
    (8, '二级保养', '每5000～6000km(或每150小时)', '更换机油'),
    (8, '三级保养', '每30000～40000km(或每800～1000小时)', '解体整机清除油污、积炭、结焦等'),
    (8, '三级保养', '每30000～40000km(或每800～1000小时)', '检查各摩擦副、运动件的磨损变形情况'),
    (8, '三级保养', '每30000～40000km(或每800～1000小时)', '检查喷油泵的工作情况'),
    (8, '三级保养', '每30000～40000km(或每800～1000小时)', '检查喷油器的工作情况'),
    (8, '三级保养', '每30000～40000km(或每800～1000小时)', '检查机油泵的工作情况'),
    (8, '三级保养', '每30000～40000km(或每800～1000小时)', '检查发电机及起动马达的使用情况，清洗轴承及其它机件，加注润滑脂'),
    (8, '三级保养', '每30000～40000km(或每800～1000小时)', '检查气缸垫及其它垫片的使用情况'),
    (8, '三级保养', '每30000～40000km(或每800～1000小时)', '排除各种隐患'),
    (8, '三级保养', '每30000～40000km(或每800～1000小时)', '更换机油'),
]


def table_entries(pages, rows, source_id, limit):
    by_page = {page['page']: page['text'] for page in pages}
    made = []
    for page_no, level, interval, task in rows:
        page = by_page[page_no]
        if not contains(page, task):
            raise SystemExit(f'保养表任务不在文字层：{task}')
        # 周期数字必须整段出现，避免把被拆开的栏重新拼错。
        if not contains(page, interval.replace('(', '').replace(')', '').split('或')[0].strip('每')):
            raise SystemExit(f'保养周期不在文字层：{interval}')
        fact = f'{level}（{interval}）包括：{task}。'
        body = '\n'.join([
            f'- 手册事实：{fact}',
            f'- 适用限制：{limit}同页还有按滤清器种类给出的另一套公里/小时周期，两套都按所在段落保留，不互相改写。',
            '- 整理边界：保养总表按文字层的级别、周期和项目对应。项目本身能在该页文字层找到；周期取该级别标题下的原文，不把别的级别的周期套过来。',
            f'- 证据：{source_id}；PDF第{page_no}页；保养表格。',
        ])
        made.append({
            'title': title_of(f'{level}{task}'), 'body': body, 'entry_type': '操作/维护知识',
            'roles': [], 'page': page_no, 'text': task, 'source_id': source_id,
        })
    return made


def number_rows(rows, prefix, source_id):
    used = set()
    for index, row in enumerate(rows, 1):
        title = row['title']
        base = title
        suffix = 2
        while title in used:
            title = f'{base[:24]}{suffix}'
            suffix += 1
        used.add(title)
        row['title'] = title
        row['entry_id'] = f'{prefix}-{index:04d}'
        row['source_id'] = source_id
        if len(row['body'].encode('utf-16-le')) // 2 > 1200:
            raise SystemExit(f'正文超过1200：{row["entry_id"]}')
    return rows


def open_pages(pdf):
    import pymupdf
    document = pymupdf.open(pdf)
    pages = []
    for index, page in enumerate(document, 1):
        text = page.get_text('text') or ''
        pages.append({'page': index, 'printed': printed_page(text), 'text': text, 'count': document.page_count})
    return pages


def write_card(path, heading, meta, rows):
    lines = [f'# {heading}', '', '## 来源与适用范围', '']
    lines.extend(f'- {item}' for item in meta)
    lines.append('')
    for row in rows:
        lines.append(f"## {row['entry_id']}｜{row['title']}")
        lines.append('')
        lines.append(row['body'])
        lines.append('')
    path.write_text('\n'.join(lines).rstrip() + '\n', encoding='utf-8')


def append_jsonl(path, records):
    with path.open('a', encoding='utf-8') as handle:
        if path.stat().st_size and not path.read_bytes().endswith(b'\n'):
            handle.write('\n')
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + '\n')


def append_hierarchy(records):
    path = INDEX / 'hierarchy.json'
    block = ',\n'.join(
        '\n'.join('    ' + line if line else '    ' for line in json.dumps({
            'entry_id': row['entry_id'],
            'components': links_for(row['text'] + row['body']),
        }, ensure_ascii=False, indent=2).splitlines())
        for row in records
    )
    text = path.read_text(encoding='utf-8')
    marker = '\n  ]\n}\n'
    if not text.endswith(marker):
        raise SystemExit('hierarchy.json 结尾与预期不符，拒绝写入')
    text = text[:-len(marker)] + ',\n' + block + marker
    text = text.replace('"updated_at": "2026-10-28"', '"updated_at": "2026-10-29"', 1)
    path.write_text(text, encoding='utf-8')
    json.loads(path.read_text(encoding='utf-8'))


def source_object(record_path, spec, manual):
    return {
        'source_id': spec['source_id'],
        'brand': spec['brand'],
        'model': spec['model'],
        'models': spec['models'],
        'model_ids': unique(model_id(model) for model in spec['models']),
        'title': spec['title'],
        'title_status': '已核对',
        'title_evidence': spec['title_evidence'],
        'document_type': spec['document_type'],
        'role': spec['role'],
        'path': record_path.relative_to(REPO).as_posix(),
        'url': spec['url'],
        'version': spec['version'],
        'version_date': spec.get('version_date'),
        'emission_stage': spec.get('emission_stage'),
        'emission_stage_unknown': spec.get('emission_stage_unknown'),
        'scope_boundary': spec['scope_boundary'],
        'status': spec['status'],
        'source_level': spec['source_level'],
        'collected_at': '2026-10-29',
        'storage_type': 'link_and_source_record',
        'sha256': sha256_file(record_path),
        'bytes': record_path.stat().st_size,
        'manual_sha256': manual['sha256'],
        'manual_bytes': manual['bytes'],
        'manual_pdf_pages': manual['pages'],
        'hash_scope': 'sha256/bytes属于本地来源记录；manual_sha256/manual_bytes/manual_pdf_pages属于下载的PDF',
        'knowledge_path': spec['knowledge_path'],
        'verified_pdf_pages': spec['verified_pdf_pages'],
    }


def build():
    load_parts()
    work = Path('/tmp/kb-ingest-20261029')
    wz_pdf = work / 'wuzheng-ts-me-2018.pdf'
    cn3_pdf = work / 'yuchai-cn3-maint-v11.pdf'
    scr_pdf = work / 'yuchai-scr-g4g5-v11.pdf'
    wz_pages = open_pages(wz_pdf)
    cn3_pages = yuchai_pages(cn3_pdf)
    scr_pages = yuchai_pages(scr_pdf)
    wz = number_rows(wz_entries(wz_pages), 'KB-WZ-TSME', 'SRC-WZ-TSME-201803')
    cn3 = bullet_entries(cn3_pages, 'SRC-YC-CN3-MAINT-V11', YC_CN3_LIMIT, skip_pages={1, 8})
    cn3 += table_entries(cn3_pages, CN3_TABLE, 'SRC-YC-CN3-MAINT-V11', YC_CN3_LIMIT)
    cn3 = number_rows(cn3, 'KB-YC-CN3', 'SRC-YC-CN3-MAINT-V11')
    scr = number_rows(bullet_entries(scr_pages, 'SRC-YC-SCR-G4G5-V11', YC_SCR_LIMIT, skip_pages=set()), 'KB-YC-SCR', 'SRC-YC-SCR-G4G5-V11')
    return {
        'wz': wz, 'cn3': cn3, 'scr': scr,
        'manuals': {
            'wz': {'sha256': sha256_file(wz_pdf), 'bytes': wz_pdf.stat().st_size, 'pages': wz_pages[0]['count']},
            'cn3': {'sha256': sha256_file(cn3_pdf), 'bytes': cn3_pdf.stat().st_size, 'pages': len(cn3_pages)},
            'scr': {'sha256': sha256_file(scr_pdf), 'bytes': scr_pdf.stat().st_size, 'pages': len(scr_pages)},
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    built = build()
    summary = {key: len(built[key]) for key in ('wz', 'cn3', 'scr')}
    print(json.dumps(summary, ensure_ascii=False))
    for key in ('wz', 'cn3', 'scr'):
        for row in built[key][:3]:
            print(row['entry_id'], row['entry_type'], row['title'])
    if not args.write:
        return
    specs = {
        'wz': {
            'source_id': 'SRC-WZ-TSME-201803',
            'brand': '五征',
            'model': 'TS/ME系列',
            'models': WZ_MODELS,
            'title': 'TS/ME系列轮式拖拉机使用说明书',
            'title_evidence': '封面PDF第1页及版权页PDF第2页“使用说明书”“编号：TS/ME-18.3”',
            'document_type': '整机使用说明书',
            'role': '整机使用保养',
            'url': 'http://njztc.oss-cn-shanghai.aliyuncs.com/upload/accept/20180822095158858048104639766528.pdf',
            'version': 'TS/ME-18.3；2018年3月第一版／2018年3月第1次印刷',
            'version_date': '2018-03',
            'emission_stage': '国三',
            'scope_boundary': WZ_LIMIT + '仓库不保存全文，只保留公开链接、取得时的PDF哈希和知识卡概述。',
            'status': '已取得PDF并对照文字层整理；封面与故障表选页对照图像；未逐页图像审校；未厂家复核；未实车验证',
            'source_level': '山拖农机装备有限公司、山东五征集团农业装备事业部印制的使用说明书，由农机鉴定公开附件入口取得。',
            'knowledge_path': '知识库/整理后的知识库/农用拖拉机知识库/机型知识卡/五征_TS_ME_201803.md',
            'verified_pdf_pages': {'1': '封面型号、使用说明书字样', '55': '离合器与变速箱故障表，文字层与该页图像一致'},
            'card_heading': '五征／TS/ME系列轮式拖拉机使用说明书（TS/ME-18.3）',
            'record_dir': REPO / '知识库/原始农机说明书/五征/TS-ME系列',
            'record_name': '来源记录_TS-ME-18.3.md',
            'meta': [
                '来源编号：`SRC-WZ-TSME-201803`',
                '公开原件：<http://njztc.oss-cn-shanghai.aliyuncs.com/upload/accept/20180822095158858048104639766528.pdf>',
                '印制：山拖农机装备有限公司、山东五征集团农业装备事业部。编号TS/ME-18.3，2018年3月第一版。',
                '已审范围：文字层中完整句子和故障表。封面、故障表选页对照过图像。短行参数总表未入库。未逐页图像审校，未厂家复核，未实车验证。',
            ],
        },
        'cn3': {
            'source_id': 'SRC-YC-CN3-MAINT-V11',
            'brand': '玉柴',
            'model': '国三电控柴油机',
            'models': ['国三电控柴油机'],
            'title': '玉柴国3柴油机维护保养-v1.1',
            'title_evidence': '玉柴股份资料下载页栏目名称，对应PDF /upload/file/2014/12/25/b4e19786786c45598272b10977399702.pdf；正文首段为“玉柴国3电控柴油机简介”',
            'document_type': '发动机维护说明',
            'role': '发动机维护',
            'url': 'http://www.ycmp.com.cn/upload/file/2014/12/25/b4e19786786c45598272b10977399702.pdf',
            'version': '官网栏目名v1.1；PDF正文未另印出版日期',
            'emission_stage': '国三',
            'scope_boundary': YC_CN3_LIMIT,
            'status': '已取得官网PDF并对照文字层；未逐页图像审校；未厂家复核；未实车验证',
            'source_level': '广西玉柴机器股份有限公司客户服务中心，官网资料下载栏目公开PDF。',
            'knowledge_path': '知识库/整理后的知识库/农用拖拉机知识库/机型知识卡/玉柴_国三电控维护_v11.md',
            'verified_pdf_pages': {'2': '日常检查与脚注', '8': '保养表格文字层'},
            'card_heading': '玉柴／国三电控柴油机维护保养 v1.1',
            'record_dir': REPO / '知识库/原始农机说明书/玉柴/国三电控维护',
            'record_name': '来源记录_国三维护_v11.md',
            'meta': [
                '来源编号：`SRC-YC-CN3-MAINT-V11`',
                '公开原件：<http://www.ycmp.com.cn/upload/file/2014/12/25/b4e19786786c45598272b10977399702.pdf>',
                '下载页：<http://www.ycmp.com.cn/site/download-list-0.htm>，栏目名《玉柴国3柴油机维护保养-v1.1》。',
                '已审范围：文字层句子和末页保养表中能逐项在文字层找到的项目。封面机型矩阵未逐型扩展。',
            ],
        },
        'scr': {
            'source_id': 'SRC-YC-SCR-G4G5-V11',
            'brand': '玉柴',
            'model': 'SCR国四、国五发动机',
            'models': ['SCR国四、国五发动机'],
            'title': '玉柴SCR国4、国5发动机维护保养-v1.1',
            'title_evidence': '玉柴股份资料下载页栏目名称，对应PDF /upload/file/2014/12/25/0ef71cd9484245a8bef0f0451fe2e3bc.pdf',
            'document_type': '发动机维护说明',
            'role': '发动机维护',
            'url': 'http://www.ycmp.com.cn/upload/file/2014/12/25/0ef71cd9484245a8bef0f0451fe2e3bc.pdf',
            'version': '官网栏目名v1.1；PDF正文未另印出版日期',
            'emission_stage_unknown': True,
            'scope_boundary': YC_SCR_LIMIT,
            'status': '已取得官网PDF并对照文字层；未逐页图像审校；未厂家复核；未实车验证',
            'source_level': '广西玉柴机器股份有限公司客户服务中心，官网资料下载栏目公开PDF。',
            'knowledge_path': '知识库/整理后的知识库/农用拖拉机知识库/机型知识卡/玉柴_SCR国四国五维护_v11.md',
            'verified_pdf_pages': {'3': '柴油、机油与添蓝', '5': '传感器与喷嘴保养'},
            'card_heading': '玉柴／SCR国四、国五发动机维护保养 v1.1',
            'record_dir': REPO / '知识库/原始农机说明书/玉柴/SCR国四国五维护',
            'record_name': '来源记录_SCR维护_v11.md',
            'meta': [
                '来源编号：`SRC-YC-SCR-G4G5-V11`',
                '公开原件：<http://www.ycmp.com.cn/upload/file/2014/12/25/0ef71cd9484245a8bef0f0451fe2e3bc.pdf>',
                '下载页：<http://www.ycmp.com.cn/site/download-list-0.htm>，栏目名《玉柴SCR国4、国5发动机维护保养-v1.1》。',
                '已审范围：文字层句子。示意图未当作参数。国四与国五同时出现，来源不单填一个排放阶段。',
            ],
        },
    }
    sources = json.loads((INDEX / 'sources.json').read_text(encoding='utf-8'))
    existing = {source['source_id'] for source in sources}
    new_entries, new_roles = [], []
    for key in ('wz', 'cn3', 'scr'):
        spec = specs[key]
        if spec['source_id'] in existing:
            raise SystemExit(f'来源已存在：{spec["source_id"]}')
        spec['record_dir'].mkdir(parents=True, exist_ok=True)
        record_path = spec['record_dir'] / spec['record_name']
        manual = built['manuals'][key]
        record_path.write_text(
            f"# {spec['title']}来源记录\n\n"
            '核验日期：2026-10-29。本文件是自行编写的来源与完整性记录，不是说明书全文。\n\n'
            f"- 公开原件：<{spec['url']}>\n"
            f"- PDF SHA256：`{manual['sha256']}`\n"
            f"- PDF字节：{manual['bytes']}\n"
            f"- PDF页数：{manual['pages']}\n"
            '- 上述哈希属于下载的PDF，不是本记录文件的哈希。\n'
            '- 未取得再分发全文的许可，仓库不保存PDF全文。\n'
            f"- 知识卡：[{Path(spec['knowledge_path']).name}](../../../整理后的知识库/农用拖拉机知识库/机型知识卡/{Path(spec['knowledge_path']).name})\n",
            encoding='utf-8',
        )
        card = REPO / spec['knowledge_path']
        write_card(card, spec['card_heading'], spec['meta'], built[key])
        source = source_object(record_path, spec, manual)
        source = {k: v for k, v in source.items() if v is not None}
        sources.append(source)
        for row in built[key]:
            entry = {
                'entry_id': row['entry_id'],
                'source_id': spec['source_id'],
                'brand': spec['brand'],
                'model': spec['model'],
                'title': row['title'],
                'knowledge_path': spec['knowledge_path'],
                'locator': f"PDF第{row['page']}页",
                'entry_type': row['entry_type'],
                'status': '部分核对文字层；未逐页图像审校；未厂家复核；未实车验证',
                'scope_boundary': spec['scope_boundary'],
            }
            new_entries.append(entry)
            if row['roles']:
                new_roles.append({'entry_id': row['entry_id'], 'roles': row['roles'], 'role_basis': '原文标记'})
    (INDEX / 'sources.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    append_jsonl(INDEX / 'entries.jsonl', new_entries)
    if new_roles:
        append_jsonl(INDEX / 'entry-roles.jsonl', new_roles)
    append_hierarchy(built['wz'] + built['cn3'] + built['scr'])
    print('wrote', len(new_entries))


if __name__ == '__main__':
    main()
