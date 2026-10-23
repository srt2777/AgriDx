# V3 工作成果迁移核对记录

## 基础与保护

- 目标：`https://github.com/srt2777/AgriDx`，基线 `main@69c95770a0837c1ca871b01659e58cd85f659d2c`，独立分支 `codex/migrate-v3-work-20261023`。
- 用户指定 main 为后续 V4 开发主线；实际拉取的 package 版本为 3.11.1，仓库 ID 为 `1411797388`。旧 `srt2777/AgriDx-v3` 地址重定向至同一仓库。本轮沿用此前已明确批准的 3.11.2 维护补丁，不自行改为 4.x，不重建系统。
- 原始语义开发工作区 `/workspace/AgriDx-v3`：`codex/knowledge-semantic-dedup@ef7573a`，检查时干净，保持原样。
- 诊断工作区原分支 `codex/diagnosis-interaction-20261022@00b054b` 及此前检查点 `7e2adfd` 保留。17 个未提交文件先保存清单、SHA-256、二进制补丁及压缩备份，再提交到恢复分支 `codex/safety-v3-before-v4-20261023@ec364b8395e14b24e5d839bf140b935f059de288`；该工作区已干净。
- 另生成并通过 `git bundle verify` 的增量恢复包，存于本地 `/workspace/work/agridx-migration-evidence/v3-preserved-work.bundle`。该包要求 main 历史中的 `69c9577` 与 `fc98a25` 两个前置提交；它不是无前置依赖的完整仓库包。所有本地恢复资料均未提交为产品文件。
- 未执行 `reset --hard`、`clean -fd`、强制推送、数据库迁移或部署。旧 origin 保留，新增 canonical `team` remote 用于本轮独立分支。

## 已在 main 的成果

`git merge-base --is-ancestor ef7573a team/main` 退出 0，`git cherry team/main ef7573a` 为空；旧语义分支全部已包含。下列核心文件在备份 `ec364b8` 与目标 main 的 blob 完全一致，因此没有重复搬运或回退主线更新。

| 成果 | 实际代码与结论 |
| --- | --- |
| 规则清洗与 JSON/Markdown 质量报告 | `知识库/工具/校验索引.py`、`knowledge_quality.py`；已在 main |
| 增量快照、来源/条目缓存、只读输出保护 | 同上；已在 main，迁移后实际全量与增量运行核验 |
| 语义候选、关系分类、断点恢复、缓存失效 | `knowledge_semantic.py`、`semantic_relations.py`；已在 main |
| 本地 embedding 与规则回退接口 | `semantic_embedding.py`；已在 main，本轮不下载模型或把模拟判断当真实准确率 |
| 来源哈希、大小、PDF 页数、车型/配置与审核状态 | 既有校验器、归档加载与运行时 evidence 逻辑；保持 main 版本 |
| 语义预审、人工审核账本、DeepSeek 预审适配器及相关测试/文档 | 已在 main，不重复迁移，不外调模型 |
| 三模式、会话记忆、高风险路由、失败来源排除和供应商回退 | 保留 main 的现有实现；完整回归覆盖 |
| 不可变快照及同代知识库版本 | 保留 PR #84 的主线实现，不以旧 V3 快照文件覆盖 |

原知识正文、`entries.jsonl`、`sources.json`、通识正文和知识库工具在 main 与备份之间没有内容差异。备份仅多出三个本地提交：`7e2adfd`、`00b054b`（合并主线）及 `ec364b8`；非合并差异主要是诊断/交互 WIP，合计 47 文件、1942 行新增、220 行删除。

## 本次成功迁移的独立改动

没有直接 cherry-pick 整个 WIP 提交，因为这些提交把可用修复与未完成功能混在一起。先审查实际 diff，再按片段迁移；完整机型/会话补丁使用 `git apply --3way --index` 干净应用，其余片段与备份原实现逐项核对。

| 改动 | 来源与目标文件 | 迁移边界 |
| --- | --- | --- |
| 核验失败来源在 top-k 前过滤 | `ec364b8` → `server/knowledge/retriever.ts` | 复用既有 `referenceVerification`；协调层及上下文的二次排除仍保留，不重写校验器 |
| 补充完整型号/铭牌待核对信息时保留故障主题 | `ec364b8` → `server/knowledge/conversation.ts` 与原回归测试 | LF1504 机型补充不丢水温症状；明确新症状仍切换主题 |
| 来源适用信息完整返回 | `ec364b8` → `shared/chat.ts`、`server/diagnosis/service.ts` 与原测试断言 | 新增可选 `scopeBoundary/models/engineModel/faultCodes`，数组拷贝；不改变审核状态或授予诊断权限 |
| 对应来源过滤回归 | 备份 `tests/retrieval-tiers.test.ts` 中的独立用例 → `tests/migrated-source-filter.test.ts` | 模拟只读加载与恢复快照；不写真实知识文件，不带入整组四层检索测试 |

版本仍以 package.json 为唯一来源；3.11.2 上限和边界测试复用此前已获批准的维护调整，本轮采用新迁移批次 `migration-v3-work-20261023`。不复制备份中尚无验证结果的诊断功能发布说明。

## 未迁移与原因

以下内容全部保留在恢复提交 `ec364b8`，本轮不继续开发补齐：

| 未迁移部分 | 已复现问题或依赖边界 |
| --- | --- |
| `reply.ts`、`answerGuard.ts` 及启用它们的 service/preview 编排 | `DiagnosticReplyInput` 未声明调用方已传入的 `symptomQuery`，源备份类型检查报 TS2353；不能按已完成整链移入 |
| 新外部回答安全门 | “无需停机即可短接启动端子”“不要担心只需绕过安全联锁试车”仍被放行；未写“故障码”的 `P1234表示喷油泵损坏` 仍可绕过代码含义检查。普通测试通过不能证明安全完成 |
| 结构化自然回答、新聊天界面、附件、追问、记忆元数据 | 依赖上述未完成协议；已报告电瓶检查正常仍重复列电量不足、重复问起动机状态，指定机型的通识及安全禁令抽取也未完成 |
| 四层检索、manual availability、retrievalOutcome、新候选缓存元数据 | 独立检索测试曾通过，但完整启用涉及尚未验证完成的提示、回答和前端链。为避免重新开发或猜测兼容整合，本轮整组保持停用，只拆出独立来源过滤修复 |
| 与未迁实现关联的活动测试和设计文档 | 保存在备份中；不把依赖缺失模块的测试放入新分支，不将设计目标写成已交付功能 |

额外发现一个 main 已有的问题：Python 质量分类与 TypeScript 运行时对组合状态“未逐条完成；已核验”的结果不同（分别为 verified/unverified）。两边实现均与备份相同，不是本次迁移引入，本轮未借迁移改写状态规则；需后续专门审查与统一。现有全库状态测试未覆盖这个组合，不应把当前测试通过解释为所有状态边界均已解决。

## 验证与数据边界

- 相关回归：48 项通过，覆盖来源过滤、会话主题、三模式、参数适配及回退等既有约束。
- 实库质量检查：4877 条归档、28 个来源，errors=0、warnings=0、info=2707；文献 verified=2192、unspecified=2685，未修改任何状态。9 个仅外链 PDF 来源仍按现有来源记录检查，未重新下载原件，不声称重新核验所有外链。
- 第二次质量扫描：28 个来源、4877 条条目全部复用，条目解析为 0；全局哈希和稳定性检查照常进行。
- 完整 `npm run verify` 通过：466 项、464 通过、2 项 Windows 平台专用检查跳过、0 失败；前后端类型、项目及知识库版本、Lint 与完整前后端构建通过。Lint 为 0 错误、1 条主线已有 Fast Refresh 警告，保留原 3D 包体提示。
- `npm run build:dev-preview` 通过；只构建，没有执行发布命令。
- 显式 `--mode rules` 实库语义扫描：4877 条知识、41353 条候选（complementary=909、scope_variant=1170、uncertain=39274），全部待审核。第二次 new=0、modified=0、reused=4877；records、relations、duplicate_groups 与首次完全一致。没有把该结果当人工标签或诊断准确率。
- 所有只读输入保护检查通过；原17个未提交文件的保存前后SHA-256一致，知识、索引、通识及archive路径diff为空。现有清洗/语义工具没有重复实现。
- 本地计时仅说明离线工具可运行：规则全量约2.57秒、全复用约2.25秒；规则语义首次约19.74秒、全复用约14.48秒，不在诊断请求路径执行。
- 本轮没有修改原始知识、来源索引或清洗核心，也没有下载 embedding、外调 DeepSeek/Gemini 或把模型预测当人工标签。

## 归档保护与恢复

开始检查时远端引用为：

| 引用 | 提交 |
| --- | --- |
| archive/v1 | `62b4e5a6c36d9568007e3b514f19ecb3243a201b` |
| archive/v2 | `38f5bbba0f484505525a69ebbe394cc6c8601ee0` |
| archive/v3 | `4b8d69ae50ede534ae218933ac29066fcdea5e47` |

只向本轮开发分支推送；不更新以上引用或任何 archive 路径。待迁 WIP 可在已有仓库直接用恢复分支查看，也可在含前述 main 历史的仓库从已校验 bundle 导入恢复分支。恢复时另开工作树，不覆盖正在使用的 main 或工作区。

本轮 PR 只供人工审查，不合并、不部署。目标仍是迁移已有可用改动；未迁部分需要后续明确的开发与安全审查任务。
