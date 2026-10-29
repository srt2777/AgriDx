# 农业工程术语关系：1540条

本批以 FAO（联合国粮农组织）AGROVOC 官方 Core N-Triples 数据集为来源，整理 **1540个唯一概念**，编号 `TK-6001`—`TK-7540`。每个概念只计一条，不将别名、英文名、上位词或关联边另计为知识。与既有6000条通识、5460条来源归档累计为13000条目录记录。

| 主题 | 概念数 |
| --- | ---: |
| 农业机械与设备 | 197 |
| 土壤与田间作业 | 520 |
| 水文灌排与作业气象 | 169 |
| 工程材料与物理过程 | 310 |
| 测量数据与农业信息 | 344 |

这是中英文首选词和词表关系知识，可用于术语查找、英文对照及概念导航。没有将词表关系写成科学定义：`skos:broader`表示直接上位概念，`skos:related`表示关联概念，两者都不能证明部件组成、故障因果、实际机型配置或维修步骤。没有导入可能另有来源授权的第三方定义全文。

每条保留 `diagnostic_evidence=false`。目录全文搜索可查全部条目；问答可通过编号或“术语、英文、概念”等明确请求读取，按参考资料展示。普通症状检索和指定品牌／型号的故障问题继续使用既有证据集合，术语不作为通识诊断证据，不占其检索位置。知识总量增长不代表维修故障覆盖增长。

## 来源与核验

- [FAO官方获取说明](https://www.fao.org/agrovoc/index.php/access)、[官方Core下载](https://agrovoc.fao.org/latestAgrovoc/agrovoc_core.nt.zip)、[中英文词表许可说明](https://aims.fao.org/standards/agrovoc/access-agrovoc)。署名：FAO, AGROVOC；官方获取页将中英文词表列为 CC BY IGO 3.0。AgriDx 对概念作选择与中文编排；FAO没有为本应用背书。
- 2026-10-29取得。下载使用`latest`地址，取得日期不作数据集发布版次；未独立确认版本号。
- [source.json](source.json)记录下载网址、ZIP与NT原件字节数/哈希、许可、取得时间和用途。[source-concepts.json](source-concepts.json)是有许可的原始标签与关系子集，属于来源证据；[index.jsonl](index.jsonl)仅存正文定位和用途元数据。阅读正文在16份Markdown中维护。
- [selection.json](selection.json)保留主题根URI、排除范围和本批筛选口径；先选择机械、土壤作业、灌排气象与测量信息，物理材料层按保存的顺序补充。候选范围不等于全部适合农机诊断，未收录项不计数。
- 原始NT逐条核对概念URI、中英文首选标签和每条保存的直接关系；另核对1540个唯一URI、标题、编号、正文定位、目录和实际检索。未逐条完成原厂、专家或实车核验。原5460条归档、6000条通识正文及用途保持原字节。

复核命令（原下载件保留在仓库外）：

```bash
python3 scripts/verify-agrovoc-source.py /tmp/agrovoc_core.nt
node scripts/agrovoc-learning.mjs --check
```

## 阅读分册

- [TK-6001—TK-6100](01.md)
- [TK-6101—TK-6200](02.md)
- [TK-6201—TK-6300](03.md)
- [TK-6301—TK-6400](04.md)
- [TK-6401—TK-6500](05.md)
- [TK-6501—TK-6600](06.md)
- [TK-6601—TK-6700](07.md)
- [TK-6701—TK-6800](08.md)
- [TK-6801—TK-6900](09.md)
- [TK-6901—TK-7000](10.md)
- [TK-7001—TK-7100](11.md)
- [TK-7101—TK-7200](12.md)
- [TK-7201—TK-7300](13.md)
- [TK-7301—TK-7400](14.md)
- [TK-7401—TK-7500](15.md)
- [TK-7501—TK-7540](16.md)
