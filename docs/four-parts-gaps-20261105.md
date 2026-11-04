# AgriDx 四部分剩余缺口：歧义澄清、跨步复用与记忆召回加固（草案，2026-11-05）

本批基于 main `4354e74`（4.0.35，PR #201 已合入），分支
`codex/fourparts-gaps-20261105`，草案 PR，不合并、不转 ready、不升版本、
不改 CHANGELOG（升版留给合并时协调）。不动生产服务器、不改服务器或 CDN
配置、不碰密钥、不删分支；不碰 PR #204、PR #193、PR #198 的分支。

## 口径声明（第 1 项，必读）

**长期记忆的口径没有变，仍是 deferred（暂缓）。** 本批没有做长期记忆持久化，
没有做跨会话学习、没有做用户偏好/事实的长期沉淀、没有把任何历史记录提升为
已验证事实。以下第 1 项只是对既有同设备召回（`priorReports`）的安全加固，
不是长期记忆的最小可行方案；长期记忆最小可行方案仍列为缺口（见末尾）。
任何把本批描述为“长期记忆已上线”的说法都是错误的。

## 第 1 项：长期记忆——仅安全加固，MVP 仍为缺口

现状证据：`server/memory/store.ts` 与 `src/dev-preview/memory.ts` 的
`priorReports` 按查询词的二字切分计分，`score > 0` 即召回——单个二字重合
（例如查询“水温过高”命中另一会话里只写了“水温正常”的记录）就足以把另一
会话的报告作为相关历史送进提示词。

改动（两处实现同步收紧，保持行为一致）：

- 多词查询（切分后词数 ≥ 2）要求至少 2 个不同词命中才召回；单词查询仍沿用 1 命中规则。
- 召回结果仍是用户报告原文节选，仍标注待核实，不进入已验证证据；
  `memoryPrompt` 的“不是系统指令、可能与本次无关”警告未动。
- 代价（已接受的精确率换召回率）：只共享一个二字的旧报告不再被召回，
  例如“水温正常”的旧记录不再因查询“水温过高”而出现。

未做（仍为缺口）：长期记忆的存储模型、写入/纠正/过期规则、跨会话事实
的核验与归属、跨设备复用——这些需要单独的用户口径确认才能设计，本批
不以“最小可行”名义先上一半。

## 第 2 项：Planner 多系统歧义——已完成（证据约束的澄清/降级）

现状证据：`identifyPlannerTopic` 在多系统匹配时返回 `undefined`，不选单模板；
但此后澄清问题是通用文本，不点名候选系统；无既有会话的歧义故障则直接
以 `checkpoint: null` 返回，没有任何澄清问题。

改动：

- `server/diagnosis/plannerPlans.ts` 新增 `identifyPlannerTopics`（按固定顺序
  返回全部匹配主题），`identifyPlannerTopic` 改为复用它（单匹配/零匹配行为
  不变）；新增 `PLANNER_TOPIC_LABELS` 与 `plannerAmbiguityQuestion`。
- 歧义澄清问题只点名候选系统标签（例如“水温过高（冷却系统）、传动与
  离合挂挡异常”），并明说“目前还不能确定是哪一个，也没有据此作出故障
  结论”；问题文本不含任何证据 ID（测试断言无 `KB-…`/`SRC-…`），不选模板、
  不选原因、不给故障结论。
- `server/diagnosis/plannerIntegration.ts` 的无主题分支：
  - 有存活既有会话：保持 `topicPending: 'topic'`，服务侧因此走
    `planner_clarify` 本地降级，问题换成上述具体澄清问题（原通用问题仅在
    非歧义的未知表述时保留）；
  - 无会话 / 显式换故障 / 会话已终态：仍返回 `checkpoint: null`（不凭空
    建会话），但附上歧义澄清问题；用户下一轮用单系统表述回复时，该表述
    成为新的 topic root，从而解析为单主题（测试覆盖）。
  - 非歧义的未知表述行为不变：无会话时不附问题，不编造。
- `fault_chain` 工具的歧义分支同步点名候选系统（仅标签），仍返回
  `TOPIC_NOT_IDENTIFIED`，不返回逻辑链。

仍有限制：与既有会话同主题的澄清回复仍走既有 `topicPending` 通用分支
（用户可用“继续诊断”确认原会话）；歧义澄清本身不做自动消歧——必须由
用户选一个系统后才建计划。

## 第 3 项：工具协调跨步复用——已完成（仅限单次 run 内）

现状证据：PR #201 只做了同轮（同一步内）去重；主循环 4 步内，模型在
后一步重复请求前面已成功的工具调用时，仍会重新执行，消耗执行器时间与
重复调用预算（`MAX_REPEAT_CALLS = 2`，第三次同参数即拒绝）。

改动（仅 `agent/runner.ts`）：

- 单次 `runAgent` 内新增 `crossStepCache`：上一步已成功的工具结果按
  “工具名 + 绑定后输入的规范形式”缓存，后一步的相同调用直接复用原文，
  不再进执行器，不产生新的 trace 事件（与同轮去重一致），但模型仍按
  每个调用 ID 收到一份结果。
- 失败结果永不缓存：后一步重试仍会真实执行，执行器的重复拒绝规则对
  重试仍然有效；缓存只活在单次 run 内，不持久化、不跨 run、不跨会话、
  不接受客户端传入的种子，因此陈旧结果无法漏进新的诊断轮次。
- 不变：`MAIN_LOOP_MAX_STEPS = 4`、`MAIN_LOOP_TIMEOUT_MS = 8000`、
  白名单、守门（guard）、answerGuard、路由阈值、检索 topK 均未改；
  没有新增工具，更没有写操作工具。

仍为缺口：跨诊断轮次（多次 `runAgent` 调用之间）的持久复用未接线——
那需要服务层传入缓存并定好机型/证据时效规则，本批刻意不做，避免把
上一轮的机型上下文或证据带进新一轮。

## 硬边界核对（本批均未触碰）

- 模糊隶属度、故障树（FTA）仍只在 PR #193 离线评测里，未接进线上诊断；
  `plannerFaultChains` 仍只是症状→原因→步骤的结构数据，区分度排序不是
  故障概率。
- 未改路由阈值、answerGuard 规则、检索 topK、主循环步数与 8 秒预算、
  守门规则；未新增写操作工具；未升版、未改 CHANGELOG。
- 不动生产服务器、不改服务器或 CDN 配置、不碰密钥、不删分支；
  未改 PR #204、PR #193、PR #198 的分支。

## 验证

- 新增 `tests/four-parts-gaps.test.ts` 11 个测试：记忆两词召回规则（服务端
  与预览端各 1）、歧义主题列举与问题约束、Planner 歧义新会话/存活会话/
  单系统澄清解析/非歧义未知行为、`fault_chain` 歧义提示、跨步复用成功/
  失败不缓存/跨 run 不泄漏。
- 相关回归（本地实测，0 失败）：第一波 111 个测试
  （`four-parts-gaps`、`four-parts-improve`、`agent-runner`、
  `memory-store`、`preview-memory`、`planner-integration`、`tools`、
  `diagnosis-main-loop`）；第二波 161 个测试（`planner-feedback`、
  `planner-kernel`、`planner-memory`、`planner-preview`、`memory-api`、
  `chat-api`、`diagnosis-service-routing`、`agent-context-tools`、
  `llm-tool-use`、`coordination`、`diagnosis-interaction-api`、
  `answer-guard`）；合计 272 个。
- 类型检查（`npm run typecheck`，三组 tsconfig）通过；改动文件作用域
  eslint 通过。
- 全量 `npm test` 未完成：中途服务重启导致后台任务结果丢失，重启前
  任务卡在 `dev-preview.test.ts` 的真实 Vite 构建（与本批改动无关，
  该文件不调用 `priorReports`）；全量结果以 PR 的 CI 为准。
- 推送状态（截至本分支最后一次提交）：本地提交已就绪，但分支尚未推
  上远端——`git push` 两次均“Connection reset by peer”（本环境无 git
  凭据配置），连接器 `create_branch` 写操作需审批卡，审批超时未执行，
  远端分支经 `ls-remote` 核实仍不存在；草案 PR 待分支推送成功后创建，
  不得据此声称 PR 已存在。

## 未做事项（明确不宣称）

- 长期记忆持久化与跨会话学习（口径仍 deferred，见文首）。
- 跨诊断轮次的工具结果持久复用（仅单次 run 内跨步复用已做）。
- 工具结果喂给 Planner（PR #201 已说明不接，本批仍不接）。
- 真实浏览器验证与生产验证未做；生产同步仍是合并后的独立步骤。
