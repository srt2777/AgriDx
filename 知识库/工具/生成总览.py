#!/usr/bin/env python3
"""从现有索引生成导航与统计，不下载资料、不修改来源或条目、不复制事实正文。

默认只需Python标准库；--visuals额外需要matplotlib及Noto Sans CJK字体。
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

REPO = Path(__file__).resolve().parents[2]
KB = REPO / '知识库'
INDEX = KB / '整理后的知识库/农用拖拉机知识库'
INFO_TYPES = {'机型资料', '资料缺口', '资料索引', '资料核验', '系统适用边界'}


def content_group(source):
    description = source.get('document_type', '') + source.get('role', '')
    if '培训' in description:
        return '交机培训PDF'
    if '配套' in description or '辅助转向' in description:
        return '配套导航PDF'
    if '报道' in description:
        return '报道背景'
    if Path(source['path']).suffix.lower() == '.html' or '网页' in description:
        return '维护网页'
    if '发动机' in description:
        return '发动机维护PDF'
    if '整机' in description or source.get('document_type') == '既有完整PDF' or '拖拉机安全与日常维护' in description:
        return '整机／维保PDF'
    return '未分类资料'


def storage_group(source):
    if source.get('storage_type') == 'link_and_source_record':
        return 'PDF链接＋来源记录'
    if Path(source['path']).suffix.lower() == '.pdf':
        return '仓库PDF原件'
    if Path(source['path']).suffix.lower() == '.html':
        return '仓库网页快照'
    if Path(source['path']).suffix.lower() == '.md' and '网页' in (source.get('document_type', '') + source.get('role', '')):
        return '网页链接＋来源记录'
    return '其他存放方式'


def link(path):
    return path.removeprefix('知识库/').replace(' ', '%20')


def table(headers, rows):
    def clean(value):
        return str(value).replace('|', '／').replace('\n', ' ')
    return '\n'.join(['| ' + ' | '.join(headers) + ' |', '| ' + ' | '.join(['---'] * len(headers)) + ' |'] +
                     ['| ' + ' | '.join(clean(v) for v in row) + ' |' for row in rows])


def generate(date, visuals):
    sources_path, entries_path = INDEX / 'sources.json', INDEX / 'entries.jsonl'
    sources = json.loads(sources_path.read_text('utf8'))
    entries = [json.loads(line) for line in entries_path.read_text('utf8').splitlines() if line.strip()]
    source_map = {s['source_id']: s for s in sources}
    assert len(source_map) == len(sources)
    assert len({e['entry_id'] for e in entries}) == len(entries)
    assert all(e['source_id'] in source_map for e in entries)
    source_brand = {s['source_id']: s['brand'] for s in sources}
    by_brand = Counter(source_brand[e['source_id']] for e in entries)
    source_brands = Counter(s['brand'] for s in sources)
    by_type = Counter(e['entry_type'] for e in entries)
    purposes = Counter(content_group(s) for s in sources)
    purpose_entries = Counter(content_group(source_map[e['source_id']]) for e in entries)
    storage = Counter(storage_group(s) for s in sources)
    storage_entries = Counter(storage_group(source_map[e['source_id']]) for e in entries)
    research = json.loads((INDEX / '采集优先级/证据索引.json').read_text('utf8'))
    candidate_lines = (INDEX / '采集优先级/型号清单.jsonl').read_text('utf8').splitlines()
    candidate_count = sum(bool(line.strip()) for line in candidate_lines)
    # Generic chunks follow the same ## section split as the existing retriever.
    generic_count = 0
    for file in (REPO / 'server/knowledge').rglob('*.md'):
        if file.relative_to(REPO / 'server/knowledge').parts[0] == '00_说明':
            continue
        text = file.read_text('utf8')
        generic_count += sum(bool(part.strip()) for part in re.split(r'^##\s+.*$', text, flags=re.M))
    learning_paths = [REPO / 'docs/tractor-knowledge/index.jsonl',
                      REPO / 'docs/tractor-knowledge/expansion-5000/index.jsonl']
    learning_entries = [json.loads(line) for file in learning_paths
                        for line in file.read_text('utf8').splitlines() if line.strip()]
    assert len({entry['entry_id'] for entry in learning_entries}) == len(learning_entries)
    assert not ({entry['entry_id'] for entry in learning_entries} & {entry['entry_id'] for entry in entries})
    totals = {'sources': len(sources), 'archived_entries': len(entries),
              'learning_entries': len(learning_entries),
              'total_library_entries': len(entries) + len(learning_entries),
              'knowledge_documents': len({e['knowledge_path'] for e in entries}),
              'brand_labels': len(by_brand), 'generic_chunks': generic_count,
              'retrieval_chunks': len(entries) + len(learning_entries) + generic_count,
              'information_or_scope_entries': sum(by_type[t] for t in INFO_TYPES)}
    catalog = []
    for source in sources:
        related = [e for e in entries if e['source_id'] == source['source_id']]
        catalog.append({**{k: source.get(k) for k in ['source_id', 'brand', 'model', 'version', 'version_date', 'pdf_metadata_date', 'scope_boundary', 'status']},
                        'content_group': content_group(source), 'storage_group': storage_group(source),
                        'source_path': source['path'], 'source_url': source['url'],
                        'entry_count': len(related), 'entry_ids': [e['entry_id'] for e in related],
                        'knowledge_paths': sorted({e['knowledge_path'] for e in related})})
    payload = {'schema_version': 1, 'snapshot_date_shanghai': date,
               'repository_version': json.loads((REPO / 'package.json').read_text('utf8'))['version'],
               'scope': '仅由现有索引派生的统计与导航，不是新增维修事实，不加入检索',
               'input_sha256': {p.relative_to(REPO).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                                for p in [sources_path, entries_path, *learning_paths]},
               'totals': totals, 'brands': [{'label': b, 'sources': source_brands[b], 'entries': n}
                                         for b, n in sorted(by_brand.items(), key=lambda x: (-x[1], x[0]))],
               'entry_types': dict(by_type), 'source_purposes': dict(purposes),
               'entries_by_source_purpose': dict(purpose_entries), 'storage': dict(storage),
               'entries_by_storage': dict(storage_entries),
               'verification_status_raw': dict(Counter(e['status'] for e in entries)),
               'research': {'reports': len(research['sources']), 'evidence_records': len(research['records']),
                            'candidate_spellings': candidate_count, 'included_in_repair_retrieval': False},
               'source_catalog': catalog}
    (KB / '总览数据.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', 'utf8')
    brand_rows = [[x['label'], x['sources'], x['entries']] for x in payload['brands']]
    purpose_rows = [[g, n, purpose_entries[g]] for g, n in purposes.items()]
    catalog_rows = []
    for s in catalog:
        cards = '、'.join(f'[知识卡{n+1}]({link(p)})' for n, p in enumerate(s['knowledge_paths']))
        catalog_rows.append([s['source_id'], s['brand'], s['model'], s['entry_count'],
                             s['content_group'], f"[原件／记录]({link(s['source_path'])}) · {cards}"])
    text = f'''# 现有知识库概要

整理日期：{date}（上海）。概要按当前来源及条目索引生成；新增与修正记录见采集记录。图表表示库内整理量，不表示市场保有量、质量评分或诊断准确率。

## 一眼看懂

**{totals['sources']}个来源 → {totals['knowledge_documents']}个人读归档知识正文文件 → {totals['archived_entries']}条归档索引。** 另有{totals['learning_entries']}条通识学习资料，共{totals['total_library_entries']}条统一知识目录记录；加{generic_count}个通用信息收集片段，当前预期加载{totals['retrieval_chunks']}个片段。通识保留原核验状态与diagnostic_evidence=false，不作为本机维修操作或参数依据；来源、正文文件、条目和片段是不同单位。

存放形式为**{storage['仓库PDF原件']}份PDF原件＋{storage['PDF链接＋来源记录']}份外链PDF来源记录＋{storage['仓库网页快照']}份网页快照＋{storage.get('网页链接＋来源记录', 0)}份网页链接及来源记录**；{storage['仓库PDF原件'] + storage['PDF链接＋来源记录']}个PDF资料来源包含{storage['PDF链接＋来源记录']}个仅链接记录，不能将PDF资料来源数当作仓库PDF全文数。

{totals['archived_entries']}条中有**{totals['information_or_scope_entries']}条资料信息或系统适用边界**（资料索引、资料核验、机型资料、资料缺口、系统适用边界），不能全部作为维修步骤或已验证结论。

[下载两页概要PDF](可视化/现有知识库概要.pdf) · [图表PNG](可视化/知识库概览.png) · [矢量图SVG](可视化/知识库概览.svg) · [机器总览JSON](总览数据.json)

{'![现有知识库数量与结构](可视化/知识库概览.png)' if visuals else '本次仅更新Markdown与机器JSON；上述PDF/PNG/SVG未重新生成，可能保留历史规模，当前数量以上文及机器JSON为准。'}

## 资料性质与存放

{table(['资料用途', '来源数', '归档条目数'], purpose_rows)}

{table(['仓库存放方式', '来源数', '条目数'], [[g, n, storage_entries[g]] for g, n in storage.items()])}

两个表按不同维度统计同一批{len(sources)}来源，不应相加。{purposes['整机／维保PDF']}份整机／维保PDF包括海外版本和资料范围待核实的旧册，不等于同样数量的适用于国内当前车型的完整维修手册。

## 条目分布

{table(['条目类别', '数量'], sorted(by_type.items(), key=lambda x: -x[1]))}

## 品牌／发布方入口

{table(['索引原始品牌／发布方标签', '来源数', '条目数'], brand_rows)}

这是{len(by_brand)}个统一主品牌／发布方标签（3.5.10起雷沃欧豹、雷沃阿波斯归入雷沃并以`sub_brand`保留子品牌，千寻位置/千耘以`product_line`保留产品线），包含导航系统发布方，不表述为同样数量的独立拖拉机品牌。

## 人与AI如何读同一份资料

```mermaid
flowchart LR
  A[原件或来源记录] --> B[sources.json：版本与范围]
  B --> C[知识卡：编号、事实、证据页]
  C --> D[entries.jsonl：定位同一编号]
  D --> E[按机型及范围检索]
  E --> F[答复保留来源与限制]
  R[采集报告与型号候选] -.仅研究线索，未接入维修检索.-> X[待补与采集记录]
```

人先看品牌目录和知识卡；AI按entry_id定位同一个Markdown段落，再读取source_id对应的版本、原网址和范围。事实正文只维护在知识卡，不复制到这份概要或机器总览。

| 阅读目的 | 固定入口 |
| --- | --- |
| 按品牌／机型读知识 | [品牌目录](整理后的知识库/农用拖拉机知识库/README.md) |
| 追溯原件和来源 | [原始资料目录](原始农机说明书/README.md)、下方来源导航 |
| 供AI定位正文与证据 | [条目索引](整理后的知识库/农用拖拉机知识库/entries.jsonl)、[来源索引](整理后的知识库/农用拖拉机知识库/sources.json) |
| 查未知项、冲突和缺口 | [待补资料](整理后的知识库/农用拖拉机知识库/待补资料.md) |
| 查看使用证据与型号候选 | [采集优先级](整理后的知识库/农用拖拉机知识库/采集优先级/README.md) |
| 后续维护 | [整理规范](条目整理规范.md)、[新资料模板](模板/新资料模板.md) |

## 使用前必须保留的边界

- 国三／旧版／培训资料不能替代近期国四整机手册；具体排放、发动机、市场、版次和序列号需匹配。
- 久保田和纽荷兰的美国／北美版不自动适用于国内近似型号；CAB／ROPS、驱动和变速配置分别核对。
- 千寻与华测是配套辅助转向资料，不等于无人整机的急停、避障、失联或高压电池手册。鸿鹄目前仅背景和资料缺口。
- 约翰迪尔5E／6B的PDF元数据日期不是出版日期；原件未明确排放，不据年份推定国三，不按国四使用。
- 全库保留选页核对范围和原始核验状态，未完成全书审校、厂家复核、实车验证或诊断准确率评测。故障表原因是候选，不能据单一现象直接确诊。

研究区另有{len(research['sources'])}篇第三方报告、{len(research['records'])}条型号证据、{candidate_count}种型号／排放写法候选，均不进入维修检索；不能换算成全国保有量排名或同样数量的独立实车。

## {len(sources)}来源导航

{table(['来源编号', '品牌／发布方', '原件型号范围', '条目数', '资料性质', '阅读入口'], catalog_rows)}

## 更新与核验

概要及图表由[生成脚本](工具/生成总览.py)从sources.json与entries.jsonl派生；机器JSON记录输入SHA256，后续索引变化后重新生成。汇总文件不加入维修检索，不构成新事实来源。

```bash
python3 知识库/工具/生成总览.py --date {date} --visuals
python3 知识库/工具/校验索引.py
```

生成Markdown／JSON只需要Python标准库，绘图另需matplotlib和Noto Sans CJK字体。历史整理核验见[整理验收](整理后的知识库/农用拖拉机知识库/采集记录/20261008_现有知识库整理验收.md)，后续更新见[采集记录](整理后的知识库/农用拖拉机知识库/采集记录/)。GitHub保存、本地加载和线上部署分别确认。
'''
    (KB / '现有知识库概要.md').write_text(text, 'utf8')
    if visuals:
        render(payload, date)
    return totals


def render(data, date):
    import os
    import tempfile
    cache_root = Path(tempfile.gettempdir()) / 'agridx-overview-cache'
    cache_root.mkdir(exist_ok=True)
    os.environ.setdefault('MPLCONFIGDIR', str(cache_root / 'matplotlib'))
    os.environ.setdefault('XDG_CACHE_HOME', str(cache_root))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.font_manager import FontProperties
    from matplotlib.backends.backend_pdf import PdfPages
    font_path = Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
    if not font_path.exists():
        raise RuntimeError('绘图需Noto Sans CJK字体；请安装字体后使用--visuals')
    font = FontProperties(fname=str(font_path))
    # This Noto collection contains CFF outlines; Type3 avoids invalid Type42 embedding.
    plt.rcParams.update({'font.family': font.get_name(), 'pdf.fonttype': 3,
                         'svg.fonttype': 'path', 'axes.unicode_minus': False})
    out = KB / '可视化'
    out.mkdir(exist_ok=True)
    green, muted, ink = '#277453', '#708c7d', '#243b31'
    fig = plt.figure(figsize=(13, 10), facecolor='#f8faf7')
    fig.text(.06, .95, '现有知识库 · 结构与数量', fontsize=25, color=ink)
    fig.text(.06, .916, f'{date}  |  统计当前已入库资料，图表不表示市场保有量', fontsize=12, color=muted)
    t = data['totals']
    fig.text(.06, .866, f"{t['sources']} 来源     {t['archived_entries']} 归档条目     {t['knowledge_documents']} 正文文件     {t['retrieval_chunks']} 检索片段", fontsize=20, color=green)
    ax = fig.add_axes([.18, .21, .30, .58])
    brands = list(reversed(data['brands']))
    bars = ax.barh([b['label'] for b in brands], [b['entries'] for b in brands], color=green, height=.66)
    ax.bar_label(bars, padding=5, fontsize=10)
    ax.set_xlim(0, max(b['entries'] for b in brands) * 1.2)
    ax.set_title('品牌／发布方标签：条目数', loc='left', fontsize=14, color=ink, pad=14)
    ax.tick_params(axis='y', labelsize=10, length=0)
    ax.tick_params(axis='x', labelsize=9, colors=muted)
    ax.grid(axis='x', alpha=.12)
    ax.set_axisbelow(True)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax = fig.add_axes([.66, .58, .28, .21])
    groups = list(reversed(sorted(data['source_purposes'].items(), key=lambda item: -item[1])))
    bars = ax.barh([g for g, _ in groups], [n for _, n in groups], color=muted, height=.6)
    ax.bar_label(bars, padding=4, fontsize=11)
    ax.set_xlim(0, max(n for _, n in groups) * 1.22)
    ax.set_title('资料用途：来源数', loc='left', fontsize=14, color=ink, pad=14)
    ax.tick_params(length=0, labelsize=10)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax = fig.add_axes([.66, .21, .28, .29])
    kinds = list(reversed(sorted(data['entry_types'].items(), key=lambda x: -x[1])))
    bars = ax.barh([g for g, _ in kinds], [n for _, n in kinds],
                   color=[muted if g in INFO_TYPES else green for g, _ in kinds], height=.63)
    ax.bar_label(bars, padding=4, fontsize=10)
    ax.set_xlim(0, max(n for _, n in kinds) * 1.22)
    ax.set_title('条目类别：数量', loc='left', fontsize=14, color=ink, pad=14)
    ax.tick_params(length=0, labelsize=10)
    for spine in ax.spines.values():
        spine.set_visible(False)
    store = data['storage']
    fig.text(.06, .115, f"存放：{store['仓库PDF原件']}份PDF原件  ＋  {store['PDF链接＋来源记录']}份外链PDF来源记录  ＋  {store['仓库网页快照']}份网页快照", fontsize=14, color=ink)
    fig.text(.06, .075, f"{t['information_or_scope_entries']}条属于资料信息或系统边界；条目数量不是维修结论或诊断准确率。", fontsize=12, color=muted)
    fig.text(.06, .042, '统计依据：sources.json、entries.jsonl；原始品牌标签不合并，研究候选不计入维修检索。', fontsize=10, color=muted)
    fig.savefig(out / '知识库概览.png', dpi=170, facecolor=fig.get_facecolor())
    fig.savefig(out / '知识库概览.svg', facecolor=fig.get_facecolor())
    svg = out / '知识库概览.svg'
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text('utf8').splitlines()) + '\n', 'utf8')
    summary = plt.figure(figsize=(13, 10), facecolor='white')
    summary.text(.07, .91, '知识库概要 · 阅读与使用边界', fontsize=25, color=ink)
    summary.text(.07, .865, f'整理日期 {date}  |  数量与导航来自当前索引', fontsize=12, color=muted)
    blocks = [
        ('怎么读', ['从知识库README进入品牌目录，再看知识卡编号段落与证据页。',
                  '机器索引只定位同一个Markdown正文，sources.json保存版本和适用限制。',
                  '原件、来源记录、知识卡、条目索引、采集研究分别存放；概要不进入维修检索。']),
        ('数量口径', [f"{t['sources']}来源、{t['knowledge_documents']}个人读正文、{t['archived_entries']}条归档索引；另有{t['generic_chunks']}个信息收集片段，共{t['retrieval_chunks']}片段。",
                    f"{store['仓库PDF原件']+store['PDF链接＋来源记录']}个PDF资料来源包含{store['仓库PDF原件']}份仓库原件和{store['PDF链接＋来源记录']}份链接记录；另有{store['仓库网页快照']}份网页。",
                    f"{t['information_or_scope_entries']}条为资料信息或适用边界，不把所有条目当作维修事实。"]),
        ('不能省略的条件', ['国三、旧版和培训资料不能替代近期国四随车整机手册。',
                         '美国／北美手册须核对市场、CAB／ROPS、驱动、变速和机型后缀。',
                         '配套导航是辅助转向系统资料，不能替代无人整机安全运行手册。',
                         'PDF元数据日期不是出版日期；未知排放、版次和配置保持未知。',
                         '只核对选定证据页；未完成全书审校、厂家复核、实车验证或准确率评测。']),
        ('研究与后续', [f"{data['research']['reports']}篇第三方报告、{data['research']['evidence_records']}条型号证据、{data['research']['candidate_spellings']}种型号／排放写法候选仅作采集线索。",
                    '不从这些数量推断全国保有量、使用排名或同样数量的独立实车。',
                    '维护入口：知识库/现有知识库概要.md、总览数据.json、条目整理规范.md。'])]
    y = .79
    for heading, lines in blocks:
        summary.text(.07, y, heading, fontsize=17, color=green)
        y -= .042
        for line in lines:
            summary.text(.08, y, '• ' + line, fontsize=13, color=ink)
            y -= .033
        y -= .027
    summary.text(.07, .04, 'GitHub：srt2777/AgriDx-v3  |  事实与证据仍以原知识卡、来源记录为准。', fontsize=10, color=muted)
    with PdfPages(out / '现有知识库概要.pdf', metadata={'Title': '现有知识库概要', 'Author': 'AgriDx'}) as pdf:
        pdf.savefig(summary)
        pdf.savefig(fig)
    plt.close(summary)
    plt.close(fig)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', required=True, help='概要日期，YYYY-MM-DD，按上海日期记录')
    parser.add_argument('--visuals', action='store_true', help='生成PNG、SVG与两页PDF')
    args = parser.parse_args()
    from datetime import date as date_type
    date_type.fromisoformat(args.date)
    print(json.dumps(generate(args.date, args.visuals), ensure_ascii=False))
