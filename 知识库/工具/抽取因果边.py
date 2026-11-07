# -*- coding: utf-8 -*-
"""从已有知识卡故障表半自动抽取因果边（第 1 步）。

只做确定性文本抽取，不调用 LLM，不自由生成：
- 症状：条目标题，或卡片「故障现象」字段；
- 候选原因：卡片原因字段（原表可能原因 / 可能原因选摘 / 可能原因 /
  离合器打滑的可能原因 / 此页列出）按顿号、分号、逗号、句号切分；
- 措施：卡片处理字段（针对处理 / 手册处理方向 / 原文处理方向 /
  原文方向 / 维修建议 / 该手册的特定流程）全文原样保留；
- 阈值：仅当措施文本里出现「数字 + 单位」（分钟/小时/秒/℃/MPa/kPa/
  bar/r/min/mm/cm/V/A/% 等）时取第一处原文短语，否则留空，不猜；
- 每条边带 source_id + 页码 + evidence_kind，页码与 entries.jsonl 的
  locator 用同一规则解析（见 server/knowledge/archive.ts parsePages）。

抽不出的留空、不猜：没有原因字段或没有处理字段的条目不产生边；
原因子句含待核实/待补等不确定措辞、或整句是否定安全提示时丢弃该子句。
输出：知识库/整理后的知识库/农用拖拉机知识库/causal-edges.json
用法：python3 知识库/工具/抽取因果边.py [--check]（--check 只统计不写文件）
"""
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
INDEX = REPO / "知识库/整理后的知识库/农用拖拉机知识库"
ENTRIES = INDEX / "entries.jsonl"
OUT = INDEX / "causal-edges.json"

CAUSE_LABELS = ["原表可能原因", "故障表可能原因", "可能原因选摘", "可能原因", "离合器打滑的可能原因", "此页列出"]
REMEDY_LABELS = ["针对处理", "手册处理方向", "原文处理方向", "原文方向", "维修建议", "该手册的特定流程"]
SYMPTOM_LABELS = ["故障现象"]

# 原因子句里不作候选的前缀/措辞。
DROP_PREFIX = re.compile(r"^(待核实|待补|尚待|暂无|未知|未提供|不提供|没有(?:提供|给出|列出|记录|说明)|不作|不适用|手册表列候选|手册列明的候选)")
STRIP_PREFIX = re.compile(r"^(也可能涉及|也可能为|也可能|可能为|包括|如|原表所称|该行候选为|候选为|表列|原表列)")
DROP_SUBSTR = ("不能把", "不得", "禁止", "待核实", "不据此", "表中原文", "原表列", "处理列写",
               "不将该原因当作", "不凭", "不直接判断", "不推改", "疑点保留", "不是确诊", "不等于确诊",
               "手册表列候选", "再按原因处理", "尚非确诊", "原表另在故障列写", "该行故障栏实际写",
               "故障栏实际写", "操作性措辞", "未明确给出", "需结合排除栏核对", "相应处理概述")

# 原因字段里的编辑性限定括号，如“（原表候选，尚非确诊）”：括号内含逗号，
# 通用切分会把它切开并造出“尚非确诊）”这种假原因；这类字段本身就是单条候选。
QUALIFIER_PAREN = re.compile(r"（[^）]*?(?:尚非确诊|不是确诊|未确诊)[^）]*?）")


def unbalanced(text):
    """引号/括号不成对的碎片（切分时切断的半句），不是完整原因，丢弃。"""
    return text.count("（") != text.count("）") or text.count("“") != text.count("”")

THRESHOLD_RE = re.compile(
    r"(约|至少|不超过|不得超过|不低于|高于|低于|最长|最短)?\s*"
    r"(\d+(?:\.\d+)?)\s*(分钟|小时|秒|℃|°C|MPa|kPa|bar|r/min|mm|cm|m|V|A|%|L|N·m)"
)
PDF_RE = re.compile(r"PDF\s*(?:物理)?\s*第?\s*(\d[\d、，,～~\-\–\s]*?)\s*页")
PRINTED_RE = re.compile(r"印刷(?:页码)?\s*第?\s*(\d[\d、，,～~\-\–]*)")


def parse_pages(locator):
    pdf = PDF_RE.search(locator or "")
    printed = PRINTED_RE.search(locator or "")
    pages = {}
    if pdf:
        pages["pdf"] = pdf.group(1).strip()
    if printed:
        pages["printed"] = printed.group(1).strip()
    return pages


def field_value(section, label):
    """取形如 '- 标签：内容' 的字段值；多行续行拼到下一条目为止。"""
    lines = section.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^[-*]\s+" + re.escape(label) + r"[：:]\s*(.*)$", line)
        if not m:
            continue
        parts = [m.group(1).strip()]
        for nxt in lines[i + 1:]:
            if re.match(r"^[-*]\s+", nxt) or nxt.startswith("## "):
                break
            if nxt.strip():
                parts.append(nxt.strip())
        return " ".join(parts).strip()
    return ""


NUM_RE = re.compile(r"（(\d+)）")


def numbered_items(value):
    """潍泰式（1）…（2）…编号列表：返回 {编号: 原文}，编号前引导句丢弃。"""
    parts = NUM_RE.split(value or "")
    if len(parts) < 3:
        return None
    items = {}
    for i in range(1, len(parts) - 1, 2):
        text = parts[i + 1].strip().strip("。；，、").strip()
        if len(text) >= 2:
            items[int(parts[i])] = text
    return items or None


def split_causes(value):
    # 潍泰 TT 式单候选字段：“原因（原表候选，尚非确诊）。”整句就是一条原因，
    # 句内顿号/逗号是同一原因的两个半句，不能按通用分隔符切开。
    if QUALIFIER_PAREN.search(value or ""):
        single = QUALIFIER_PAREN.sub("", value).strip().strip("。；，、").strip()
        cause = clean_clause(single)
        return [cause] if cause else []
    out = []
    for raw in re.split(r"[、；，。，]", value):
        clause = raw.strip().strip("“”\"'").strip()
        clause = STRIP_PREFIX.sub("", clause).strip().strip("“”\"'").strip()
        clause = re.sub(r"(等候选|等)$", "", clause).strip()
        clause = re.sub(r"为候选$", "", clause).strip()
        if len(clause) < 2:
            continue
        if DROP_PREFIX.match(clause):
            continue
        if any(s in clause for s in DROP_SUBSTR):
            continue
        if unbalanced(clause):
            continue
        out.append(clause)
    return out


def clean_clause(clause):
    clause = (clause or "").strip().strip("“”\"'").strip()
    clause = QUALIFIER_PAREN.sub("", clause).strip()
    clause = STRIP_PREFIX.sub("", clause).strip().strip("“”\"'").strip()
    clause = re.sub(r"(等候选|等)$", "", clause).strip()
    clause = re.sub(r"为候选$", "", clause).strip()
    if len(clause) < 2 or DROP_PREFIX.match(clause):
        return ""
    if any(s in clause for s in DROP_SUBSTR):
        return ""
    if unbalanced(clause):
        return ""
    return clause


FUSED_INTRO = re.compile(r"^(?:表\d+[-\d]*列|表列|本表列|本页表列|候选(?:为|含|涉及|包括)|本表指向)")
# 融合字段里没有候选清单、只有处置/提示的开头：抽不出，留空，不硬凑。
# “表\d+将……”是另一写法（“表6-1将A和B列为候选，分别对应……”），
# 原因与措施都嵌在同一句里切不干净，也留空。
FUSED_NO_CAUSE_PREFIX = re.compile(r"^(?:先核|先区分|先检查|按|应|须|需|本册|本表要求|ERROR-|表\d+[-\d]*将)")


def fused_remedy(rest):
    """融合字段措施：取“；”后首句的首分句；边界句不进入边，解析不出返回 None。"""
    first_sentence = re.split(r"[。]", rest, maxsplit=1)[0].strip()
    remedy = re.split(r"[，；]", first_sentence, maxsplit=1)[0].strip()
    if len(remedy) < 2 or DROP_PREFIX.match(remedy) or any(s in remedy for s in DROP_SUBSTR):
        remedy = first_sentence
        if len(remedy) < 2 or DROP_PREFIX.match(remedy) or any(s in remedy for s in DROP_SUBSTR):
            return None
    return remedy


def parse_fused_cause_field(value):
    """6M 等“候选与相应处理概述”融合字段：原因与措施写在同一字段里。

    形如“手册表列候选与相应处理概述：候选为A、B；<措施>，<边界>。”或
    “表列A；<措施>，<边界>。”。返回（原因列表，措施首句首分句），
    措施取首分句才是原文动作，边界句不进入边；解析不出返回 (None, None)。

    引导头（“手册表列候选与相应处理概述：”）先整段去掉，只留候选清单区；
    清单引导词有表列/本表列/候选为/候选含/候选涉及/候选包括/本表指向/
    表N-M列等多种，只认这些，不认“先核/按本册/本表要求/ERROR-”等
    处置性开头——那类字段没有候选清单，留空。
    """
    if "；" not in value and ";" not in value:
        return None, None
    cause_part, rest = re.split(r"[；;]", value, maxsplit=1)
    cause_text = cause_part.rsplit("概述：", 1)[1].strip() if "概述：" in cause_part else cause_part.strip()
    # “先区分X和Y”：X、Y 就是要区分的两个候选。
    if cause_text.startswith("先区分"):
        causes = [clean_clause(c) for c in cause_text[len("先区分"):].split("和")]
        causes = [c for c in causes if c]
        if not causes:
            return None, None
        return causes, fused_remedy(rest)
    # 引导词可能叠加（“表6-1列候选包括……”），从头逐个去掉。
    while True:
        m = FUSED_INTRO.match(cause_text)
        if not m:
            break
        cause_text = cause_text[m.end():].strip()
    if FUSED_NO_CAUSE_PREFIX.match(cause_text):
        return None, None
    # “X为候选”：X 就是候选，尾巴去掉。
    cause_text = re.sub(r"为候选$", "", cause_text).strip()
    # “以及”当分隔符用时先换成顿号，否则会切出“……以”碎片。
    cause_text = cause_text.replace("以及", "、")
    causes = []
    for raw in re.split(r"[、，及]", cause_text):
        clause = clean_clause(raw)
        if not clause:
            continue
        # 处置性措辞（先核/按……/分别……）不是原因。
        if re.match(r"^(先核|先查|先区分|按|应|须|需|分别)", clause):
            continue
        if clause not in causes:
            causes.append(clause)
    if not causes:
        return None, None
    return causes, fused_remedy(rest)


def extract_threshold(remedy):
    m = THRESHOLD_RE.search(remedy or "")
    return m.group(0).strip() if m else None


def extract(entries):
    texts = {}
    edges = []
    skipped = {"no_cause": 0, "no_remedy": 0, "no_pages": 0, "no_section": 0}
    for entry in entries:
        if entry.get("entry_type") != "维护/故障知识":
            continue
        path = REPO / entry["knowledge_path"]
        if path not in texts:
            texts[path] = path.read_text(encoding="utf-8") if path.exists() else ""
        m = re.search(
            r"## " + re.escape(entry["entry_id"]) + r"｜.*?\n(.*?)(?=\n## |\Z)",
            texts[path],
            re.S,
        )
        section = m.group(1) if m else ""
        if not section:
            skipped["no_section"] += 1
            continue
        cause_label = next((l for l in CAUSE_LABELS if field_value(section, l)), None)
        if not cause_label:
            skipped["no_cause"] += 1
            continue
        cause_value = field_value(section, cause_label)
        # 融合字段（6M 等“候选与相应处理概述”）：原因与措施同字段，专案解析；
        # 解析不出留空，不走通用切分（通用切分会把边界句、措施碎片误作原因）。
        fused_causes = fused_remedy = None
        if "概述" in cause_value:
            fused_causes, fused_remedy = parse_fused_cause_field(cause_value)
            if fused_causes is None:
                skipped["no_cause"] += 1
                continue
            if fused_remedy is None:
                skipped["no_remedy"] += 1
                continue
        remedy_label = next((l for l in REMEDY_LABELS if field_value(section, l)), None)
        if fused_causes is None and not remedy_label:
            skipped["no_remedy"] += 1
            continue
        causes = fused_causes if fused_causes is not None else split_causes(cause_value)
        if not causes:
            skipped["no_cause"] += 1
            continue
        pages = parse_pages(entry.get("locator", ""))
        if not pages:
            skipped["no_pages"] += 1
            continue
        remedy = fused_remedy if fused_remedy is not None else field_value(section, remedy_label)
        symptom = field_value(section, "故障现象") or entry["title"]
        evidence_kind = (
            "故障表"
            if cause_label == "原表可能原因" or "故障表" in entry.get("locator", "")
            else "知识卡选摘"
        )
        # 编号列表：原因与措施按原编号一一对应，不把整段措施贴到每条原因上。
        cause_items = None if fused_causes is not None else numbered_items(cause_value)
        remedy_items = None if fused_causes is not None else numbered_items(remedy)
        pairs = []
        if fused_causes is not None:
            pairs = [(cause, fused_remedy) for cause in fused_causes]
        elif cause_items:
            for num in sorted(cause_items):
                cause = clean_clause(cause_items[num])
                if not cause:
                    continue
                pair_remedy = remedy_items.get(num, remedy) if remedy_items else remedy
                pairs.append((cause, pair_remedy))
        else:
            pairs = [(cause, remedy) for cause in causes]
        seen = set()
        for cause, pair_remedy in pairs:
            if cause in seen:
                continue
            seen.add(cause)
            edges.append(
                {
                    "symptom_entry_id": entry["entry_id"],
                    "symptom": symptom,
                    "cause": cause,
                    "remedy": pair_remedy,
                    "threshold": extract_threshold(pair_remedy),
                    "source_id": entry["source_id"],
                    "pages": pages,
                    "evidence_kind": evidence_kind,
                    "strength_basis": "故障表候选",
                    "brand": entry["brand"],
                    "model": entry["model"],
                }
            )
    edges.sort(key=lambda e: (e["symptom_entry_id"], e["cause"]))
    for i, edge in enumerate(edges, 1):
        edge_ordered = {"edge_id": f"CE-{i:06d}"}
        edge_ordered.update(edge)
        edges[i - 1] = edge_ordered
    return edges, skipped


def main():
    check_only = "--check" in sys.argv
    entries = [json.loads(line) for line in open(ENTRIES, encoding="utf-8") if line.strip()]
    edges, skipped = extract(entries)
    print(f"故障条目：{sum(1 for e in entries if e.get('entry_type') == '维护/故障知识')}")
    print(f"抽取边：{len(edges)}（含阈值 {sum(1 for e in edges if e['threshold'])}）")
    print(f"跳过：{skipped}")
    if check_only:
        return 0
    payload = {
        "schema_version": 1,
        "purpose": "只记录已有知识卡故障表中可追溯的症状→候选原因→措施链；"
        "候选原因不是确诊，强度只标故障表候选，不写概率或已验证因果。",
        "edges": edges,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写 {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
