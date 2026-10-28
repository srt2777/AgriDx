# 采集—识别—整理流水线

本目录执行[条目整理规范](../../条目整理规范.md)。它发现和核对公开资料，**不**把未核对文本、图片故障表或搜索摘要写成维修事实，也**不**把整本手册全文提交进仓库。

工作目录里的下载件（HTML/PDF）是临时文件。来源记录只保存公开 URL、取得时的哈希和自行概述。

## 命令

在仓库根目录：

```bash
python3 知识库/工具/采集流水线/inventory.py
python3 知识库/工具/采集流水线/fetch.py \
  --targets 知识库/工具/采集流水线/targets/20261028-ytobuy.json \
  --workdir /tmp/kb-ingest
python3 知识库/工具/采集流水线/stage_ytobuy.py \
  --html-dir /tmp/kb-ingest --out /tmp/kb-ingest/staged.jsonl
python3 知识库/工具/采集流水线/promote.py \
  --staged /tmp/kb-ingest/staged.jsonl --html-dir /tmp/kb-ingest
python3 知识库/工具/采集流水线/extract_pdf.py /tmp/某手册.pdf --out /tmp/某手册.json
```

`fetch.py` 失败只说明当次请求失败，不能写成全网没有该资料。`stage_ytobuy.py` 只处理东方红 e 购这批页面结构；其他网站要先单独核对版式，再增加整理器。`promote.py` 会拒绝证据子串已经不在 HTML 里的候选，并拒绝重复来源编号。

PDF 文本提取依赖 PyMuPDF。扫描页没有文本层时，脚本只报告页数，不生成故障码或扭矩。扫描页和表格仍须按整理规范目视核对后才能入库。

## 每批入库后的合并

用户2026-10-28要求：每批新增在合入 main 前先整理，再和原有知识库合并。

1. 同一来源、同一型号范围内的重复事实只留一条。不同型号的相近内容分别保留。
2. 去掉页脚、样式和被截断后串到别的章节的续条。标题用正文里已有的短句，编号段和 `entries.jsonl` 的标题一致。
3. 更新 `sources.json`、`entries.jsonl`、`hierarchy.json`、角色旁路或待核对队列、品牌目录、采集记录和概要。
4. 先同步最新 main，用 `npm run version:rebase` 把本批版本接到当前主线之后。
5. `python3 知识库/工具/校验索引.py` 和 `npm test` 通过后，再把该批合并进 main。未通过就不合并。

## 本批没有自动入库的资料

- 玉柴非道路国四故障码排查手册在公开转载页标注“密级：保密”，不采集、不概述故障码。
- 潍柴闪码表的非厂家转载、道路国六维修手册，不套用到拖拉机。
- 五征、常发、东风、雷沃近期国四整机手册本批未取得可核对全文。已发现的入口写在采集记录，不记为维修条目。
