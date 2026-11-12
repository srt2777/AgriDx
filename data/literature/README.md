# 农业文献记录

这里保存从 Crossref 官方接口取得的农业相关期刊书目元数据，不是论文全文、手册、已核验研究结论或实车诊断案例。原有来源归档与通识索引独立保留。

- 本批已实际取得并逐条核对 486,764 条文献元数据，与原有 13,236 条合计 500,000 条索引记录。机器统计读取 `manifest.json` 的 `records`；`target` 仅表示目标，不代替实际计数。完整来源对照结果见 `verification.json`，分类与期刊统计见 `statistics.json`。
- `journals.json` 保存人工选择的农业相关期刊、实际接口返回的 ISSN、期刊注册信息入口与领域。相关性在期刊层面筛选，未逐篇评估科学质量；候选期刊涵盖农机、作物、土壤、园艺、食品、养殖和林业，实际已取得的领域以 `manifest.json` 为准（包含历史文献，不宣称全部为近期研究），不代表全部是农机故障知识。
- 每条保存原始标题、作者、期刊、出版日期字段、DOI、出版方、Crossref 原记录入口、取得时间、对应下载响应 SHA-256。日期保留原始精度，不补造月份或日期；不自动翻译、生成摘要或补写结论。
- 按小写 DOI 去重，并以 NFKC 规范化标题、发表年份和期刊复核重复；缺少合法 DOI、有效标题或发表年份、类型/期刊不匹配及明显封面目录等记录不入库。保留的更正类记录仍是文献记录，不计为独立故障或实车案例。不同 DOI 的关联版本仍可能存在，不能将索引数解释为独立科学发现数量。
- `diagnosticEvidence=false`、`fullTextVerified=false` 是强制边界。文献不进入维修检索器、不附加伪造的品牌/机型/页码，不从题目推断参数或故障原因。更正、撤稿、全文可访问性与结论尚未逐篇独立核实。
- `provenance.json` 保留实际分页请求、下载时间、响应哈希与原始条数。临时完整响应缓存留在采集机器，用于全量逐字段对照，不提交庞大抓取缓存。长期逐条溯源入口是 DOI 和 Crossref URL；接口内容可能随后更新。

## 许可与署名

来源：Crossref 及各记录中标明的出版方/作者。采用可复用的事实性书目元数据；不收录论文摘要、论文正文或来源响应中的其他受限制内容。Crossref 官方说明：[Metadata retrieval](https://www.crossref.org/documentation/retrieve-metadata/)、[REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)。Crossref 的元数据复用说明不等于论文全文的开放许可，Crossref 与出版方均未为司稼背书。

FAO AGRIS 曾作为候选来源，本次官方 ODS 入口和目录返回 403，未取得的数据没有加入本集合，也不将 Crossref 数据标成 AGRIS 数据。

## 采集、复核与检索

```bash
python3 scripts/collect-literature.py --cache /绝对路径/公开来源缓存 --skip-failed
node --import tsx scripts/build-literature-index.ts
python3 scripts/verify-literature-source.py --cache /绝对路径/公开来源缓存 --output /绝对路径/校验结果.json
node --import tsx --test tests/literature.test.ts
```

低并发采集（一个请求），每页上限 1000 条，有限超时与重试，失败记录在缓存目录。记录和分页检查点保存在本地 SQLite，恢复时不会重复计数。失败不能被当成零条或采集完成。`--export-only` 可从已取得记录导出真实进度快照；导出后重新构建检索分片，不能直接发布未构建的快照。

`records-*.jsonl.gz` 为唯一书目正文，按 DOI 排序、每片最多 1000 条；`terms-*.json.gz` 只存词语到行号的索引，不再保存第二份正文。前后端共用分词与交集搜索规则，按原文词语进行 AND 检索；不声称具备跨语种语义检索。客户端按需取得词项和结果分片，不一次加载全部文献，每片下载后校验哈希。总量不由文案硬编码。

网页版：`/#/knowledge?view=literature`。服务器接口：`GET /api/knowledge/literature?q=tractor&page=1`，每页 20 条，可按 `topic` 选择领域。静态开发预览使用同一组分片；文献未进入诊断问答，原知识目录与健康接口的原有知识计数含义不变。
