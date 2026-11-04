# AgriDx 四部分完善：短期记忆稳定、新 Planner 主题与只读工具（草案，2026-11-04）

本批是四部分完善计划的第 2、3、4 步（第 1 步 LLM 只走 DeepSeek + DSML 翻译已在 main，
不在本批重复）。分支 `codex/four-parts-improve-20261104`，草案 PR，不合并、不升版本、
不改 CHANGELOG，版本协调留待合入时一次处理。

基线说明：代码在 main `585bfcb`（4.0.31）内容上开发与测试；任务执行期间 main 前进到
`2ff9a37`（PR #197，统一农机工作台，4.0.32），分支因此建在当前 main `2ff9a37` 上。
已核对 PR #197 的改动文件与本批 16 个文件零重叠（#197 改的是工作台首页、样式与
`tests/frontend-boundaries.test.ts` 等，本批改的是诊断、记忆、Planner 与工具），
且 #197 版的 frontend-boundaries 测试对聊天解析结果只做逐字段断言，不受本批新增的
可选 `memorySaveFailed` 字段影响；合入前仍以本 PR 的 CI 为准。

## 第 2 步：短期记忆稳定

现状证据：

- `server/memory/context.ts` 的 `recentMessages` 取最后 10 条、总预算 12000 字，遇到空内容会
  `break`，丢掉更早的消息。
- `server/routes/chat.ts` 的 `/chat` 先 `diagnose()` 生成答案，之后才 `appendTurn`；此前
  append 一失败就抛错，整轮答案被丢弃，改发记忆错误（2026-11-04 18:28 前后正式版出现过
  记忆存储操作失败，随后主循环反复回退，正是这类失败路径）。
- `MemoryStore.appendTurn` 本身是 SQLite 事务，失败回滚、版本号不变，下一轮仍可用旧版本号重试。

改动：

- 空内容改为跳过（`continue`）而非截断窗口。
- append 失败时：非 `MemoryError` 的存储类错误重试一次（间隔 200ms），仍失败则照常返回
  已生成的答案，并置 `memorySaveFailed: true`；客户端保留旧版本号，下一轮可按最后已保存
  的版本号重试；本轮未保存的 Planner 检查点也不落盘，下一轮从最后已保存的检查点继续。
  前端在回答下方提示“本轮未能保存到诊断记录”，不改答案正文。
- 确定性 `MemoryError`（版本号冲突、记录上限、无效提交）**不降级**，仍按原有记忆错误返回，
  这样清空调诊、删除诊断中迟到的 AI 回答仍会被作废，不会悄悄复活已删除的诊断。
- 损坏的已存 Planner 检查点仍被拒绝（`plannerCheckpoint` 抛 409），不静默当作不存在：
  这是既有测试 `corrupt checkpoint is rejected rather than treated as absent` 明确规定的
  安全保证，本批评估后决定保留。代价是：已损坏检查点的会话仍需新建诊断才能继续追问，
  该局限见“未做事项”。

## 第 3 步：Planner 新主题、逻辑链与工具映射

现状证据：此前只有 `overheat`、`starting` 两个主题，每主题 2 步，`evidenceIds` 全为空，
证据门实际落空；`plannerIntegration.ts` 的多轮跟进把旧主题硬编码为两个。

改动：

- 新增 `fuel`（燃油）、`electrical`（电气）、`hydraulic`（液压）、`transmission`（传动）
  四个主题，每主题 2 步、区分度 20/10、成本 1、第二步依赖第一步，识别正则互不重叠
  （多系统歧义仍返回 undefined，不选单模板）。
- 每个新步骤带一条真实的已核验、已索引知识条目（快照核对，见下表），并在
  `createDiagnosticPlan` 里同时传入对应的 plan 级 evidence 引用，否则建计划会抛错。
  步骤只有在本轮检索中作为 exact/verified 命中时才会被提出；否则 Planner 以
  `no_evidence` 暂停，诊断本身仍按路由/AI 继续——新主题不对所有机型生效，PR 说明里必须写明。
- `plannerIntegration.ts` 的旧主题硬编码泛化为任意已知主题（`isPlannerTopic`）。
- 故障链以纯数据形式放在 `plannerFaultChains`：顶事件（症状）→ 原因分解 → 步骤 →
  证据 ID；区分度排序是追问价值的代理，不是故障概率；基本事件仍是用户报告或手册证据，
  标待核实。
- `StepDefinition` 增加可选的 `toolName` 字段（数据层，`kind` 校验不变），新步骤均映射到
  `search_knowledge`。**工具结果喂给 Planner 的路径本批不接**：同一轮里 Planner commit
  在主循环之前算出，主循环跑完后没有第二个 Planner pass 和新的 commit 语义，接上去
  风险大于收益，不得谎称已接。

| 主题/步骤 | 证据条目（entryId / 来源） | 条目内容 |
|---|---|---|
| fuel / fuel-filter | KB-JD-5E-D0-025 / SRC-JD-5E-D0-OMSJ34997（约翰迪尔 5E） | 燃油滤清器每日排水和沉淀物 |
| fuel / fuel-injector | TF1000-JD6B-119 / SRC-JD-6B-L1-OMSU54855（约翰迪尔 6B） | 发动机运转不稳或频繁憋熄：喷油器脏污或故障 |
| electrical / electrical-fuse | KB-KB-M6060-006 / SRC-KB-M6060-3C13199724（久保田 M6060/M7060） | 保险丝熔断先查原因再按同容量更换 |
| electrical / electrical-lighting | ZL-PL-015 / SRC-ZL-PL-202011（中联 PL 系列） | 只有照明失效与全车断电的排查区别 |
| hydraulic / hydraulic-lift | KB-YTO-LF-MANUAL-012 / SRC-YTO-LF-MANUAL（东方红 LF 系列） | 农具不能提升或提升缓慢抖动的吸油检查 |
| hydraulic / hydraulic-system | KB-JD-6B-L1-019 / SRC-JD-6B-L1-OMSU54855（约翰迪尔 6B） | 整个液压系统不工作 |
| transmission / clutch | KB-WD-WF-007 / SRC-WD-WF1404-1604-2021（沃得 WF1404/1504/1604） | 离合器打滑与分离不彻底故障表 |
| transmission / gear-shift | KB-JD-5E-D0-070 / SRC-JD-5E-D0-OMSJ34997（约翰迪尔 5E） | 变速箱卡在空挡或换挡困难 |

主题识别互不重叠的核对示例：`液压油过热` → hydraulic（不是 overheat），
`电瓶不充电` → starting（不是 electrical），`发动机熄火后无法启动` → 歧义 undefined。

## 第 4 步：只读工具与工具协调

现状证据：默认 6 工具 + 上下文 5 工具，主循环白名单 `TOOL_LOOP_TOOLS` 共 11 个；
runner 先跑 `resolve_machine_scope`，同一轮 ask_user 与其他证据调用混用判 fallback，
超时/供应商/工具错误/步数超限均 fallback；executor 超时 30 秒、只读最多 4 并发、
同参数第三次拒绝、输出截断 4000 字；主循环墙钟上限 8 秒、最多 4 步。

新增只读工具（全部默认 `risk: 'read'`，无写操作、无外部网络调用、无密钥处理）：

- `fault_chain`：按主题或症状文本返回上述故障链（顶事件、原因、步骤、证据 ID）。
- `model_fault_index`：按品牌 + 完整型号（精确一致，大小写不敏感）列出
  `维护/故障知识` 类条目索引（entryId、标题、来源 ID），不返回全文；来源标题在顶层
  去重一次列出，避免 20 条索引超出 4000 字输出预算导致 JSON 被截断。
- `maintenance_schedule`：同上，列出 `操作/维护知识` 类条目索引；只是知识库条目索引，
  不是厂家发布的保养计划。

三者均已加入 `TOOL_LOOP_TOOLS` 白名单（否则对主循环是死代码），并在 runner 的
`sourceFor` 里标为“混合资料”（返回的是知识库派生数据）。

工具协调改动：

- 同一轮内绑定后的重复工具调用只执行一次，结果映射回每一个重复的调用 ID
  （provider 仍收到每个 ID 的结果；trace 只记录实际执行的一次）。
- 不变：scope 先行、ask_user 混用判 fallback、守门否决即停、多步共享 8 秒墙钟、
  失败按原语义回退单次路径；`MAIN_LOOP_TIMEOUT_MS`、`MAIN_LOOP_MAX_STEPS` 未改。

## 未做事项（明确不宣称）

- 不做长期记忆持久化与跨会话学习（用户明确暂不考虑）。
- 不改路由阈值、检索 topK、answerGuard 的安全/来源否决规则。
- 不恢复 PR #186 影子回流；不把评测结果写回诊断记忆。
- 工具结果不喂给 Planner；损坏的已存 Planner 检查点仍拒绝（见上），该会话需新建诊断。
- 开发测试一律 mock/fake，不调真实模型；未做真实浏览器验证与生产验证。
