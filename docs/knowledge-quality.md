# 维修知识库规则清洗与质量报告

2026-10-17 整合说明：下文保留 3.4.9 工具初次交付的范围与历史计数。3.5.0 全库为 4,853 条，校验器另纳入通用框架输入快照与条件冲突检查；`case_key` 兼容严格的来源/表号/对应原因与处置定位键。状态分类同步本轮在线 `evidence.ts` 的失败优先级和明确引用页核对表述，逐项跨语言回归保证一致；原始核验状态没有批量改写。见[整合验收](integration/20261016-all-open-prs.md)。

本阶段兼容扩展原有离线索引校验工具，不新增网页系统功能，不修改检索、诊断服务或三种AI协调模式。版本按兼容工具维护记录为3.4.9；没有修改版本上限。原始知识、来源、2213条索引和导航保持不变，没有数据库迁移。

借鉴[GIDCL](https://doi.org/10.1145/3698811)的可解释规则检测思想：每条发现有稳定规则编号、原始证据及处理建议，以反例测试约束误报。本阶段没有生成或执行模型代码、训练模型、embedding、语义去重或外部AI调用，规则发现不是事实错误的自动裁决。

## 运行与后台隔离

要求Python 3.10+。原有PDF校验继续使用`pdfinfo`或PyMuPDF；缺少时明确报错，不静默跳过。`PYTHON`可以指定Python解释器。原命令及`--report`、`--external-pdf`继续可用，原JSON中的`summary/sources/errors/notes`保留。

```bash
# 不保存报告或缓存；退出码只由error决定，warning/info不导致失败
python3 -B 知识库/工具/校验索引.py

# 一次检查同时生成两种报告，缓存为可选项
npm run knowledge:quality -- --report server/data/knowledge-quality/report.json --markdown server/data/knowledge-quality/report.md --cache server/data/knowledge-quality/cache.json

# 忽略旧缓存，重新证明所有现有规则结果
npm run knowledge:quality -- --full --cache server/data/knowledge-quality/cache.json

# 只核对调用者已取得的临时外链PDF，不发起下载
python3 -B 知识库/工具/校验索引.py --external-pdf SRC-实际来源编号=/tmp/已取得原件.pdf
```

CLI的标准输出和错误输出明确使用UTF-8，包括Windows重定向到管道的场景；导入校验模块不会重配宿主进程的流。跨语言状态测试也明确以UTF-8读取Node发送的JSON，不依赖系统代码页。

`scripts/knowledge-quality.mjs`通过`spawn`异步启动独立Python进程，转发退出码与终止信号。Express启动和`/api/chat`都不引用此脚本。终端默认等待结果；需要后台执行时可由作业调度器运行，或在Unix shell执行：

```bash
mkdir -p server/data/knowledge-quality
npm run knowledge:quality -- --report server/data/knowledge-quality/report.json --markdown server/data/knowledge-quality/report.md --cache server/data/knowledge-quality/cache.json > server/data/knowledge-quality/run.log 2>&1 &
```

本阶段不提供网页任务API或持久任务队列；进程中断后重新执行，缓存仅在完整扫描且输入稳定时原子发布。报告也采用临时文件加原子替换。报告和缓存不得互相覆盖或覆盖原件；仓库内仅允许输出到忽略的`server/data/knowledge-quality/`或`work/knowledge-quality/`。JSON与Markdown使用相同扫描结果，但两个文件不是跨文件事务；消费时应比较快照哈希。

显式指定输出具有替换目标文件的语义；仓库外路径仍由调用者选择，包括符号链接解析后的外部目标。运行前应选择专用报告目录，不指向其他已有文件。本轮复审保持此输出契约，不扩大路径权限。

## 单一校验器与兼容规则

原有来源哈希、字节数、页数、唯一编号、来源引用、章节标题、配置、排放及证据页检查仍只在`校验索引.py`实现。该文件提供`validate(repo, proofs=None, cache_path=None, full=False)`供测试或后续离线工具复用；不是另建校验器。

`knowledge_quality.py`提供规则编号、结构化问题、状态分类、正文适配、缓存和报告渲染，不另做原件完整性验证。现有运行时`evidence.ts`没有改动；测试逐一比较所有既有状态及对抗文本，防止Python状态解析与诊断服务偏离。

| 规则组 | 检测内容 | 处理边界 |
|---|---|---|
| `index.*`、`entry.id`、`entry.type` | JSON/JSONL、编号、重复、分类 | 坏JSONL逐行报告，不掩盖后续有效行；全局重复每次检查 |
| `record.*` | 所有必填字段、首尾空白、占位符、可选字段类型及批次摘要格式 | 不自动规范化，不把未知型号/日期补成猜测 |
| `source.*` | 真实原件路径、哈希、字节、页数、网址格式、已核对页范围 | URL格式通过不代表远端可访问或发布方已确认 |
| `scope.*` | 精确型号非空无重复子集、CAB/ROPS、2WD/4WD、国三/国四及来源条件一致性 | 不根据型号后缀推断配置，不要求描述性model字符串完全相等 |
| `entry.section`、`entry.evidence` | 正式知识卡路径、确切编号/标题/正文、确切来源ID及页码范围 | `SRC-A-0010`不能冒充`SRC-A-001`；不复制正文到索引 |
| `entry.roles` | 可选`roles`/`role_basis`、`risk_level`/`risk_basis`的取值、顺序与成对填写；`原文标记`须在本条正文找到对应字段标记；资料信息类不得标注 | 不自动标注；未标注不表示无该角色或低风险，风险等级不是确诊或安全结论 |
| `body.*` | 明确出现的空/重复字段、不同来源ID、状态分类分歧、占位、异常字符、1200字符截断风险 | 接受旧式段落、列表和表格；不要求统一维修步骤；不同来源引用仅警告待审 |
| `status.unspecified`、`source.level`、`source.external` | 无法分类状态、来源等级记录缺口、外链原件本次未重新取得 | 全部为info，不等于事实错误、未经人工核对或来源不可靠 |

正文分类是格式识别，不是质量高低：`fault_case`为故障现象/原表可能原因/针对处理；`repair_fields`为现象/原因/诊断步骤/维修建议；`manual_fact`包含手册事实；其他为`legacy`。缺少某种格式的字段不会触发要求补齐该模板。只有明确出现但为空或重复的已知标签才提示检查。必填字段逐项报告；后续有依赖的基础校验在该记录第一个阻断错误处停止，修正后重跑可暴露后续问题。

## JSON与Markdown报告契约

`schema_version: 1`、`rules_version: 1.1.0`（2026-10-21增加`entry.roles`及`summary.role_schema`统计；此前示例报告保留1.0.0原值）。快照包含输入文件内容SHA256，报告时间为UTC。报告包含完整当前发现，不只是本次变更；增量执行也不会丢失缓存中未解决的问题。

每项finding包含`finding_id`、`rule_id`、`entry_id`、`source_id`、`category`、`severity`、`message`、`evidence`、`observed`、`suggestion`。`severity`为`error/warning/info`。编号由规则、记录身份、证据位置和问题文本确定；重复编号的各次出现分别编号。

`evidence.path`为仓库相对路径；知识卡和JSONL用真实行号，`sources.json`使用数组JSON指针，例如`/3/source_level`，不把第4个来源冒充为第4行。`locator`保留原证据定位。Markdown报告提供原始值并转义表格及HTML字符。

顶层`summary`按严重程度、规则、类别统计，`role_schema`分别统计已标注角色与风险等级的条目数；`affected_entries`是独立条目数，不能与来源问题数相加当作错误知识数量。`verification_counts`仅统计现有严格解析结果，`verified`不表示全书、厂家或实车验证。无效JSON行和非对象记录另有finding，不能用有效状态计数代替原始输入行数。

来源完整性、人工核验、适用性和来源渠道是不同维度。本阶段不提供一个可能误导诊断的总质量分，也不修改任何状态。

## 增量失效与正确性

显式`--cache`才持久化增量结果。每次仍解析两个索引并对全部依赖文件重新计算内容SHA256、检查全局唯一性；同大小并恢复mtime的篡改也会被发现。缓存只省略未变化记录的规则执行、知识卡解析及PDF页数解析，不承诺零磁盘读取。

缓存键依赖：规则实现与版本、Python及PDF后端、记录元数据、原件实际哈希、显式PDF证明、知识卡文件哈希、关联来源及其校验结果。改变知识卡只影响引用该卡的条目；改变来源/适用范围影响该来源的条目；移除来源会重查其引用。新增/重复编号不依赖缓存。删除记录的旧发现不会残留。缓存损坏、校验和错误或实现变更按miss重检；`--full`始终可绕过缓存。缓存不是可对抗恶意伪造的权威证据。

扫描前后检查输入文件大小、mtime、ctime和inode。扫描期间变化产生`（snapshot.changed）`错误，不发布新缓存；本次报告不能用于后续知识发布。JSONL插入行可能使后续记录缓存失效，因为证据行号也必须准确。

## 本轮真实发现与性能

2026-10-15，基于主线`3fc42179d44afb0591f5ae951ad13072cd5fe770`的知识内容：26来源、2213条、40正文、15份留存PDF、7份外链PDF记录。没有新增或修正任何知识事实。

| 分类 | 实际数量 |
|---|---:|
| error | 0 |
| warning | 0 |
| info总数 | 1219 |
| `status.unspecified` | 1199 |
| `source.level` | 13 |
| `source.external` | 7 |
| verified / pending / unverified / unspecified | 1014 / 0 / 0 / 1199 |
| fault_case / repair_fields / manual_fact / legacy | 1000 / 900 / 100 / 213 |

这些是明确规则的扫描结果，不代表不存在语义重复或知识冲突。完整报告在本地忽略目录生成；[JSON节选](knowledge-quality-example.json)和[Markdown节选](knowledge-quality-example.md)明确标为示例，不伪装成全量报告。

Linux，Python3.12.14，执行环境上限2vCPU/8GiB。相同进程各运行3次，完整规则重检中位数1407.607ms（1204.799～1429.339），无变化增量中位数720.019ms（562.504～776.476），约1.95倍。增量复用26来源/2213条，重检0条、解析0张知识卡；每次仍哈希68文件/140591055字节。六次扫描进程峰值RSS37360KiB，约36.5MiB。

此测量包括规则、哈希及缓存读写，不含JSON/Markdown报告写入；全规则重检不是冷磁盘缓存测试，也不是线上诊断p95测试。清洗没有进入HTTP请求链，但共享CPU/磁盘仍可能竞争；大规模任务应由管理员调度并限制进程资源，不能据此保证任意负载下零影响。

## 测试与下一阶段接口

`npm test`自动运行30项Python合成档案测试，并比较Python/TypeScript状态分类。覆盖坏数据、四种格式、来源/配置冲突、真实行号、只读输出（包括旧命令不加-B）、文件/来源变更失效、同大小mtime变化、删除/新增重复、坏缓存、PDF证明及扫描中输入变化。编码回归显式设置`PYTHONUTF8=0`与`PYTHONIOENCODING=cp1252`，验证中文CLI、帮助/错误输出及跨语言状态保持正确，不以跳过Windows测试掩盖问题。完整项目验证记录见CHANGELOG；现有Fast Refresh与大包提示未因此修改。

下一阶段建议消费同一个校验结果及快照，不另建解析器。接口草案：

```ts
interface SemanticInputV1 {
  schemaVersion: 1;
  snapshotHash: string;       // 当前report.snapshot.sha256
  rulesVersion: string;
  entryId: string;
  sourceId: string;
  knowledgePath: string;
  sectionId: string;          // 与entryId一致，按现有document解析定位
  documentHash: string;       // report.snapshot.files[knowledgePath]
  bodyHash: string;           // 对解析出的正文计算，不写回知识索引
  effectiveScope: {
    brand: string; model: string; models?: string[];
    configuration?: 'CAB' | 'ROPS'; driveConfiguration?: '2WD' | '4WD';
    emissionStage?: '国三' | '国四'; sourceBoundary: string; entryBoundary?: string;
  };
  verification: 'verified' | 'pending' | 'unverified' | 'unspecified';
  findingIds: string[];
}
interface DuplicateCandidateV1 {
  snapshotHash: string;
  leftEntryId: string; rightEntryId: string;
  relation: 'exact' | 'near' | 'contains' | 'complementary' | 'different_scope';
  evidence: string[];         // 证据位置，不能只有相似度
  reviewState: 'pending';
}
```

这是下一阶段设计，尚未实现embedding或候选比较。消费者先核对快照及文档哈希；error条目仅进入待修清单。正文临时读取，事实仍只有Markdown一个权威副本。来源范围和条目限制一同保留；相似不等于重复，不自动合并、删除或改变诊断路由。
