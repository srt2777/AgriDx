# 入库暂存结构

`agent/ingest/index.ts` 定义 `DocumentMetadata`：`doc_id`、`version`、`doc_type`、`brand`、`model`、`year_range`、`engine_model`、`system`、`component`、`fault_codes`、`section_path`、`page`、`language`、`source`、`updated_at`。暂存器通过 JSON Schema 要求 doc_id、version、doc_type、brand、model、source 与正文非空；其余缺失不自动补造。`doc_id + version` 识别版本，内容和元数据的 SHA-256 决定是否重建。导入列表为完整快照，未出现的键被报告为 removed。暂存数据不是已核验资料，也不写入现有产品索引。

当前仅接受已取得的 Markdown 文本；按标题拆分，不拆散表格，过长章节拒绝并要求人工处理。尚无 PDF、Word、HTML、表格解析、OCR、步骤和一码一块切分，也没有来源审校或持久索引。不能将该模块当作完整入库管线。

现有归档加载器已支持 `entries.jsonl` 条目级可选 `engine_model` 与 `fault_codes`，在校验字符串、列表、长度和重复值后转换为 `KnowledgeChunk.engineModel / faultCodes`。这些字段必须来自该条目对应的已审校适用范围；不从 source 的整册代码列表继承，也不从标题提取或推断。缺失保持缺失，未核验状态仍会在严格检索中排除。新增或修正真实知识内容时仍需按知识库规则核对原件、引用页、版本、适用范围与索引校验，不以填写元数据代替审校。
