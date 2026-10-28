# Agent 改造摸底与实施计划

此为初始摸底快照；当前实现、验证与剩余范围以 [PROGRESS.md](PROGRESS.md) 为准。

基线：2026-10-28，`srt2777/AgriDx` 的 `origin/main`，提交 `2f206e9`。本清单是代码摸底，不代表新能力已上线。现有产品为 React 19 / Vite / Three.js 前端与 Express / TypeScript 服务端，Node >=22.19；`npm test`、`npm run typecheck`、`npm run build` 为现有验证入口。

## 知识来源初盘

| 来源 | 格式与数量 | 覆盖 / 入口 |
| --- | --- | --- |
| 原始手册、网页及来源记录 | 原始目录 15 PDF、4 HTML、15 Markdown（按文件扩展名统计，不等于文档种类） | 多品牌拖拉机，见 `知识库/原始农机说明书` 与 `sources.json` |
| 来源索引 | JSON，28 条来源记录 | `知识库/整理后的知识库/农用拖拉机知识库/sources.json`，逐条以适用范围为准 |
| 整理归档 | JSONL 4877 条，正文 Markdown | `entries.jsonl`、`server/knowledge/archive.ts`；包含多机型、资料缺口与非诊断条目，不能视为 4877 个独立故障 |
| 通识 | 总览记录 6000 条 | `server/knowledge/learning.ts`；无手册页码，不可冒充原厂证据 |
| 故障码表、维修、保养、零件、案例 | 各类型散布于来源和整理条目；数量与覆盖尚未逐源核验 | `server/knowledge/snapshot.ts`、`retriever.ts`；不能推断均有完整结构化表 |
| 关系图谱 | 本地关系及语义关系数据 | `server/knowledge/relations.ts`、`relations-semantic.ts`，目录和关系 API；关系不等于已证实的因果路径 |

现有资料并非空库，不生成 40 条样例替代真实资料。各机型、系统和资料类型的可用覆盖需通过后续 doctor 做可复现统计；扫描表格不能仅凭文本提取宣称核验。

## 入口与能力

`/api/chat` 经 `server/routes/chat.ts`、`server/diagnosis/service.ts` 调用本地检索、规则路由、记忆及可配置 LLM（DeepSeek、Gemini、OpenAI-compatible）；前端聊天及开发站网关分别由聊天页面与 `src/dev-preview/ai-gateway.ts` 调用。`/api/knowledge/catalog` 和 `/api/knowledge/relations` 提供目录与图谱；`/api/memory` 路由管理会话记忆；`/api/telemetry/*` 是仿真数据；`/api/modeling/*` 是建模服务；`/api/health` 给出状态。开发站另有 `/api/dev-ai/*`、`/api/dev-admin/*` 和 `/api/dev-events/*`，其部署适配在 `integrations/`；不应混成诊断证据。

现有 LLM 可调用工具定义于 `agent/tools.ts`，目前未接入 `/api/chat`；单位耗时是性质估计，非实测。所有默认工具均只读：

| 名称 | 输入 → 输出 | 耗时量级 / 位置 |
| --- | --- | --- |
| `calculator` | expression → 算术结果 | 本地，通常毫秒；`agent/tools.ts` |
| `get_current_time` | 空 → 当前时间 | 本地，通常毫秒；同上 |
| `search_knowledge` | query、limit、context → 片段和来源 | 本地检索，随数据量变化；同上 / `server/knowledge/retriever.ts` |
| `browse_knowledge` | 品牌、型号、部件、关键词、分页 → 目录 | 本地目录查询；同上 / `server/knowledge/catalog.ts` |
| `knowledge_stats` | 空 → 快照统计 | 首次加载取决于数据量；同上 |
| `resolve_machine_scope` | query、context → 范围和冲突 | 本地规则；同上 / `server/knowledge/scope.ts` |

另有离线规则规划器 `agent/planner/`，尚非模型工具循环。现有 API、内部函数和前端事件不自动视作已注册模型工具。待继续逐路审计完整输入、输出、权限及前端调用；本表不能作为“全部入口已审计”的验收证明。

## 优先风险

1. **高**：用户要求未知机型先追问；现有主线支持无机型通识检索，不能直接改动既有路径。新功能需默认关闭并在新入口严格限制。
2. **高**：来源、页码、版本、发动机和故障码元数据并非对所有条目齐全；候选资料、图谱关系、通识、仿真及用户陈述不能升级成原厂结论。
3. **高**：现有工具执行器默认允许 write，危险工具默认拒绝；未接入可信确认交互，不可据此启用写工具。超时不取消底层操作。
4. **高**：提示词和输出过滤不能证明每个结论都有引用或防止所有注入；故障码与机型精确共匹配尚需独立测试。
5. **中**：检索是关键词加范围过滤，不是 BM25 / embedding / rerank；尚无本次要求的检索质量指标与 60 条评测。
6. **中**：`codex/agent-tool-loop` 已有未合并 PR #161，新增循环前应审阅其接口及并行变动，避免重复实现。其分支不是当前 main 的已发布功能。

## 阶段路线与文件范围

按用户阶段 0–13 推进：先补齐来源和入口审计、方案/进度/决策；以真实索引为输入设计增量入库和体检；新增默认关闭的严格检索适配及评测；扩展工具契约和安全执行；接规划器、循环、记忆、提示词；再做前端交互、权限、配置、可观测和端到端评测。预期涉及 `agent/`、`server/knowledge/`、`server/diagnosis/`、`server/memory/`、`shared/`、`src/`、`scripts/`、`tests/`、`docs/agent/`。原始资料、未相关的 UI 和部署配置保持现状；新增配置及公开接口须单独审阅。具体文件以每阶段进度为准。

验证分别包括知识索引校验、针对性单元/集成测试、`npm test`、类型检查、构建，以及开关关闭时行为回归；用户要求的质量指标只能基于有人工标注的真实评测集报告。写操作须服务端可信授权、审计及确认；缺失后端只可明确标记 mock，不能冒充完成。
