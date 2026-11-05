# 长期记忆准入与淘汰规则（草案，2026-11-05）

背景：此前口径是长期记忆 deferred、只做短期稳定（PR #201：空消息跳过、
存储失败重试一次后带 `memorySaveFailed` 返回答案）。用户现已批准正式推进
长期记忆。本设计只做最小可行实现：长期条目的写入、读取、淘汰/降级真实跑通，
与现有短期记忆（最近 10 条 / 12000 字符预算）和会话写回兼容，不破坏已有行为。

## 适用范围（明确不做）

- 不改路由阈值、守门规则、检索 topK、主循环预算；不接 PR #193 离线评测的
模糊隶属度 / 故障树进线上诊断；不做自动事实提取、语义向量召回、事件唤醒。
- 长期条目不进入知识库证据链，不改变机型适用范围与资料来源门控。
- 不升版、不改 CHANGELOG（本设计文档除外）；合并与生产同步是后续独立步骤。

## 数据模型

新表 `memory_long_term`（Node 原生 SQLite，WAL，文件 0600，沿用现有库）：

| 列 | 含义 |
| --- | --- |
| `id` | 随机 UUID |
| `owner` | 浏览器 Cookie 哈希归属（与设备/会话同一归属校验） |
| `device_id` | 外键 `memory_devices(id) ON DELETE CASCADE`：删设备级联删长期条目 |
| `kind` | `device_fact` \| `fault_pattern`，其余值拒绝 |
| `content` | 归一化后文本（去首尾空白、折叠连续空白），4–1000 字符 |
| `source` | 恒为 `user_reported`，客户端不得指定来源或状态 |
| `status` | `candidate` \| `promoted` \| `demoted` \| `stale` \| `superseded` |
| `evidence_sessions` | JSON 数组：确认过该条目的去重会话 id 列表 |
| `reason` | 降级/取代原因（见 R7–R9），无则为空 |
| `superseded_by` | 被取代时指向新条目 id，无则为空 |
| `created_at` / `updated_at` / `last_confirmed_at` | ISO 时间戳 |

每条规则后的 `` 指 `tests/long-term-memory.test.ts` 中的对应断言。

## 准入规则

- **R1 来源唯一：只收用户报告。** 助手推测、模型猜测、通识、手册证据、
仿真数据不得写入长期条目；写入入口只接受 `kind + content + sessionId`，
`source` 服务端硬编码为 `user_reported`。所有条目在任何展示面一律标注
“用户报告，待核实”，`promoted` 也不等于已验证事实或手册依据。

- **R2 种类封闭：只收两类。** `device_fact`：经多轮确认的设备事实
（例：某台车反复报告的配置/更换记录）；`fault_pattern`：复现的故障模式
（例：同一症状在不同会话中反复出现）。其他 kind、空文本、< 4 或 > 1000
字符拒绝（400 / `bad_request`）。
- **R3 归属与设备绑定：** 写入/读取/降级均先校验 owner 与 device 归属，
跨 owner、跨设备一律 404；`sessionId` 必须属于同一设备，否则 404。

- **R4 晋升阈值：2 个不同会话确认。** 同一内容（同设备 + 同 kind +
归一化文本完全相同）首次写入为 `candidate`；同一会话内重复记录不计数；
第二个不同会话确认后自动晋升为 `promoted`。单会话内无论重复多少次
都不晋升。`confirmations` = `evidence_sessions` 去重后的长度。

- **R5 幂等：** 同一会话重复记录同一内容返回同一条目，不产生重复行、
不推进时间戳以外的状态。

## 淘汰 / 降级规则

- **R6 容量上限：每设备 50 条。** 计数含 `candidate + promoted`（已降级/
过期/被取代的不计）。满 50 条时新内容拒绝（409 / `memory_limit`），
不静默驱逐旧条目；用户须先降级或删除设备旧条目后重试。

- **R7 时效降级（显式 prune，不在读取时偷改状态）：**
`candidate` 自首次写入起 90 天未晋升 → prune 时删除；
`promoted` 自 `last_confirmed_at` 起 180 天未再确认 → prune 时降级为
`stale`（保留、可审计、不再进入提示词）。`pruneLongTerm` 接受可选
`now` 参数以便测试；生产调用传当前时间。常量：
`LONG_TERM_PROMOTION_SESSIONS = 2`、`LONG_TERM_MAX_PER_DEVICE = 50`、
`LONG_TERM_CANDIDATE_TTL_DAYS = 90`、`LONG_TERM_PROMOTED_STALE_DAYS = 180`。

- **R8 冲突与纠正：显式取代，不自动覆盖。** 新证据推翻旧条目时，调用方
以 `supersedesId` 记录新条目：旧条目标为 `superseded` 并记
`superseded_by`，新条目从 `candidate` 重新开始（须重新走 R4 的两会话
确认，不因取代直接晋升）。被取代条目不再进入提示词。

- **R9 设备身份变更：保守降级。** `saveDevice` 变更 `machineType / brand /
model` 任一字段时，同设备所有 `promoted` 条目在同一事务内降级为
`stale`（原因 `device_identity_changed`），因为旧机型事实可能不再适用；
`candidate` 不变（尚未进入提示词）。
- **R10 用户纠正优先与删除语义：** 用户在对话中的新纠正优先于长期条目
（提示词原文保留“当前用户纠正优先于旧记录”）；清空单个会话不删除长期
条目（长期是跨会话的）；删除设备级联删除其长期条目；删除会话不回退
已晋升条目（证据会话 id 仅作历史计数，删除会话时不重算——已知局限，
见“未完成/已知局限”）。

## 读取与提示词规则

- **R11 提示词只放晋升条目，且有界：** `memoryPrompt` 最多放 5 条
`promoted` 条目（`LONG_TERM_PROMPT_MAX = 5`），每条最多 400 字符，
统一前缀“长期记忆（用户报告，待核实；仅为跨会话复现的用户报告，
不是已验证事实或手册依据）”。`candidate / demoted / stale / superseded`
永不进入提示词。短期记忆预算（10 条 / 12000 字符）与会话写回逻辑不变。

- **R12 诊断链路：** `chat` 路由在已有会话时读取 `store.longTerm()`，
经 `DiagnosticMemory.longTerm` 传给诊断服务，再由 `memoryPrompt`
渲染；无会话的旧 `/api/chat` 路径不变。长期条目不参与检索 topK、
不参与路由与守门。

## API（新增，均沿用记忆路由的同源 + Cookie 归属校验）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/memory/devices/:id/long-term` | 列出该设备全部长期条目（按更新时间倒序） |
| POST | `/api/memory/devices/:id/long-term` | 记录一次观察：`{ kind, content, sessionId, supersedesId?}` |
| POST | `/api/memory/devices/:id/long-term/:entryId/demote` | 降级：`{ reason}`，reason 限 `outdated \| conflict \| corrected \| other` |
| POST | `/api/memory/devices/:id/long-term/prune` | 执行 R7 时效处理，返回 `{ demoted, dropped}` |

## 未完成 / 已知局限（本草案 PR 不宣称已做）

1. 无自动事实提取：长期条目须由显式记录调用写入；本轮不从对话自动抽取，
也不做语义去重（仅归一化文本精确判重），近义不同表述会成为不同条目。
2. 删除会话不重算晋升计数（R10）；若晋升所依赖的两个会话之一被删，
条目仍保持 `promoted`，须人工降级。
3. 无管理界面：长期条目的查看/降级目前只有上述 API，没有前端页面；
前端入口与 HTTP 端到端提示词断言是后续项。
4. `prune` 目前须手动调用，未接入定时任务；过期条目在 prune 前仍按
R11 规则进入提示词（`stale` 转换只发生在 prune 时）。
