# 入库暂存结构

`agent/ingest/index.ts` 定义 `DocumentMetadata`：`doc_id`、`version`、`doc_type`、`brand`、`model`、`year_range`、`engine_model`、`system`、`component`、`fault_codes`、`section_path`、`page`、`language`、`source`、`updated_at`。暂存器要求 doc_id、version、source 非空；其他缺失不自动补造。`doc_id + version` 识别版本，内容和元数据的 SHA-256 决定是否重建。导入列表为完整快照，未出现的键被报告为 removed。暂存数据不是已核验资料，也不写入现有产品索引。

当前仅接受已取得的 Markdown 文本；按标题拆分，不拆散表格，过长章节拒绝并要求人工处理。尚无 PDF、Word、HTML、表格解析、OCR、步骤和一码一块切分，也没有来源审校或持久索引。不能将该模块当作完整入库管线。
