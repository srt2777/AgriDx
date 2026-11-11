# GitHub Agent 学习与可靠性改进

整理日期：2026-11-11（上海）。本批从 `main@cae1d91c` 核对实际实现，沿用“LLM + Memory + Planner + Tool Use”的项目口径。学习资料用于改进已有 TypeScript 模块；本批没有安装新框架、接入外部观测平台或训练模型。代码、测试替身、真实供应商、网站部署和实车验证分别记录。

## 学习资料与取舍

以下链接于整理日读取项目正文或官方文档。优先级是结合 AgriDx 当前缺口作出的工程判断，并非这些课程对 AgriDx 的实测结论。外部项目后续可能更新，具体 API 应在实施时重新核对。

| 顺序 | 一手资料与建议章节 | 本批实际迁移 | 保留为后续学习 |
| --- | --- | --- | --- |
| 1 | [Microsoft AI Agents for Beginners](https://github.com/microsoft/ai-agents-for-beginners)：[04 工具使用](https://github.com/microsoft/ai-agents-for-beginners/blob/main/04-tool-use/README.md)、[10 生产运行](https://github.com/microsoft/ai-agents-for-beginners/blob/main/10-ai-agents-production/README.md) | 将工具的输入校验、业务失败、执行状态和状态管理作为契约；失败必须进入真实失败结果及事件，不能继续作为成功结果复用。 | 完整的任务/步骤观测与成本分析；没有迁移其 Python 或 Microsoft 服务栈。 |
| 2 | [Datawhale Hello-Agents](https://github.com/datawhalechina/hello-agents)：第 4 章执行范式、第 8 章记忆与检索、第 9 章上下文工程、第 12 章评估 | 借鉴有界执行、记忆与检索职责分离、上下文预算；保留来源和适用元数据，长正文按完整 JSON 的预算裁剪。取消也必须贯穿执行与结果采用阶段。 | 长期事实记忆、语义召回、上下文选择与独立标注评估；没有引入教程中的向量库、图数据库或自动记忆整合。 |
| 3 | [Hugging Face Agents Course](https://github.com/huggingface/agents-course)：[Bonus Unit 2 观测与评估](https://huggingface.co/learn/agents-course/bonus-unit2/what-is-agent-observability-and-evaluation) | 在已有工具事件和离线回归中核对成功/失败、错误类型与停止行为，使用失败、取消、越界参数和合成长文用例检查边界。 | 真实流量的错误率、成本、延迟和人工结果标注；没有新增遥测采集或上传私人对话。 |
| 4 | [LangGraphJS](https://github.com/langchain-ai/langgraphjs) 与[持久化文档](https://docs.langchain.com/oss/javascript/langgraph/persistence) | 用于审视现有会话状态与长期记忆边界；本批不增加持久化运行器。 | 检查点、跨会话存储、事件唤醒与恢复。内存检查点不等于重启可恢复；只有实际需要长任务时再评估引入。 |

这些资料提供通用工程方法，不提供农机手册证据。教程中的模型评分、检索相似度、规划链和演示结果都不能升级为具体设备的故障概率或维修结论。

## 本批实现范围

### 1. 普通答复与流式答复的取消

涉及 LLM 与 Memory：`server/llm/types.ts`、供应商适配和 HTTP 请求沿用同一个 `AbortSignal`；`server/llm/router.ts` 在取消后停止供应商回退；`server/diagnosis/service.ts` 不采用取消后的迟到结果，也不继续输出流式增量。`server/routes/chat.ts` 在记忆保存的异步重试等待后再次核对断开状态，取消后不开始下一次保存。

取消与超时分开：普通服务错误仍沿用既有回退策略，用户取消不触发新的供应商调用。这里提供协作取消和迟到结果保护，不承诺抢占同步函数、撤回已经发送的数据、回滚已经完成的事务，或证明外部服务立刻停止计算与计费。

### 2. 机型目录工具绑定宿主范围

涉及 Tool Use 与 Planner 输入边界：`agent/runner.ts` 对 `model_fault_index`、`maintenance_schedule` 使用可信宿主提供的品牌/型号覆盖模型参数；宿主只有部分身份信息时，同时移除模型自行补出的另一项，由 schema 报告缺少字段。完全没有宿主品牌和型号时，保留独立目录查询的原有用途。

绑定在去重与缓存键生成之前完成，模型不能靠另填品牌/型号查询与当前宿主范围冲突的目录。目录仍只是资料线索，不能证明适用性；`maintenance_schedule` 也不是厂家发布的完整保养计划。本批不启用新的主答复循环：`AGENT_LOOP` 继续默认 `off`，显式 `shadow` 的结果仍不替换普通答复。

### 3. 条目正文预算保留来源与可解析结构

涉及 Tool Use 与上下文：`agent/context-tools.ts` 的 `get_knowledge_entry` 先保留条目编号、来源、页码、品牌型号、范围、核验状态与适用性说明，再按序列化后的总长度缩短 `content`；输出提供 `contentTruncated` 和原始正文 Unicode 字符数 `contentLength`，保持 JSON 可解析。来源与适用元数据本身超过预算时，以 `OUTPUT_TOO_LARGE` 失败，不返回缺少来源的正文。

来源元数据包括原文链接、定位/版本；适用范围包括已有单型号或型号列表、发动机/故障码及配置/排放限制，并保留条目类别、非诊断证据与风险标记。只透传实际字段，不从标题或正文补猜。网页与手册统一使用准确的上位标签“归档资料”，AGROVOC 仍标为术语参考、无手册页码。

本批基线快照检查的正文最大长度为 1200 字符，未复现真实条目来源被截断；此项是用合成长文和超大元数据验证的边界保护，不能写成已修复线上真实来源丢失。通用 executor 的截断约定仍适用于其他工具，本批没有宣称所有工具输出都已经具备完整 JSON 的预算管理。

### 4. 显式业务失败与成功缓存分离

涉及 Tool Use 与观察：可信适配器抛出 `ToolExecutionError`，可用业务错误码为 `NOT_FOUND`、`SESSION_UNAVAILABLE`、`TOPIC_NOT_IDENTIFIED`、`OUTPUT_TOO_LARGE`。Executor 返回 `ok=false`、对应 `error_type`，工具协议结果包含 `is_error=true`；运行器不把这些失败加入跨步骤成功缓存。原有参数校验、超时、取消及重复调用预算继续生效。

不能根据任意结果对象中存在 `error` 字段就猜测失败；这类普通数据仍按成功数据处理。空目录结果也可表示一次成功但没有匹配资料的查询，与工具执行失败不同。上述业务错误由已知适配器显式标记，错误信息应适合交给模型读取，不包含凭据或私人记录。

## 验收与交付记录

本批验收关注可复核行为，不能将通过的工程测试数量换算为诊断准确率。

| 场景 | 验收条件 |
| --- | --- |
| 普通与流式请求取消 | 请求收到同一取消信号；取消后不回退、不采用迟到结果、不追加增量 |
| 记忆保存重试期间断开 | 等待结束后不再执行下一次保存 |
| 机型目录越界参数 | 当前宿主品牌/型号生效；部分身份不被模型补齐；缓存按绑定后参数复用 |
| 合成长条目 | JSON 可解析，来源与适用元数据完整，正文截断显式标记 |
| 超大来源元数据 | 返回 `OUTPUT_TOO_LARGE`，无正文、无成功事件 |
| 缺条目、缺会话、主题不明 | 对应业务错误进入失败结果；重复请求不能命中成功缓存 |
| 普通含 `error` 字段的数据 | 不被误判成工具失败 |

本地验证：最终定向回归 32 项全部通过，覆盖上述取消、身份绑定、来源预算与失败缓存行为；前后端类型检查、lint 与完整构建通过（lint 保留 2 项既有 Fast Refresh 警告）。对当前 13,236 个知识条目逐一序列化核对，全部是有效 JSON，0 项失败、0 项截断，最长结果为 2,605 个 Unicode 字符；知识版本与学习资料检查通过。

首次全量测试为 1,159 项：1,128 通过、26 跳过、5 项语音测试因本机缺少 ffmpeg 失败；随后在 `/tmp` 安装临时 ffmpeg，复跑 `tests/voice.test.ts` 与 `tests/transcode.test.ts`，15 项全部通过、无跳过，不修改项目依赖或全局环境。首次全量结果包含的环境失败单独保留，最终提交的双平台全量 CI 结果见本批 PR。真实模型调用采用测试替身，未请求外部供应商。GitHub 保存、CI、合并和开发站验收以本批 PR 的交付记录为准；本文提交时未部署，腾讯服务器未操作。真实模型工具选择、线上诊断效果、实车诊断准确率：本批未验证。

## 后续顺序

先用本批失败用例保护执行、停止和来源边界，再按真实失败样例完善上下文选择与评估集。跨会话事实提取、长期任务恢复、独立模型评审、多 Agent 或 MCP 属于可单独评估的后续范围，不因完成本批而自动视为已实现。继续参见 [Agent 参与路线](../agent-development.md)、[工具执行层说明](../../agent/README.md) 和 [Planner 说明](../planner.md)。
