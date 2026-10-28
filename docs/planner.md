# Planner 规则内核 · 第一阶段

基线：`main@0437372`，项目版本4.4.1。遵照本轮用户要求，不修改项目版本号。此模块是离线、可调用的纯规则内核，**没有接入 `/api/chat`、网页、Memory、LLM或ToolExecutor**，没有部署或实车验证。

## 范围与接口

- `agent/planner/types.ts`：结构化计划、设备范围、稳定步骤ID、观察、来源、事件、停止原因、预算和决策。
- `reducer.ts`：创建计划、事件去重、纠正链、依赖失效、状态转换和审计。
- `policy.ts`：复用 `DiagnosisRouter` 与 `assessSuggestedAction`，筛选并排序下一步。
- `ports.ts`：未来宿主的检查点和观察归一化接口声明，不包含执行实现。
- `index.ts`：导出 `createPlan`、`reducePlan`、`decideNextAction`、`advancePlan`。

现有Router、回答安全门、检索、供应商调用与回退、三种模式、Memory结构及ToolExecutor未修改。`tsconfig.server.json`原本就包含`agent/**/*.ts`，因此类型和构建检查覆盖本内核；编译模块不等于应用已调用它。

Planner只返回 `ask_user` 或 `review_evidence` **提案**，不发出工具/模型/数据库请求，也不执行实车操作。规则由可信宿主提供，不把任意用户JSON、模型自由文本或工具输出直接作为规则定义。

## 最小用法

```ts
import { createPlan, advancePlan } from '../agent/planner';

const scope = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
let state = createPlan({
  planId: 'cooling-plan', episodeId: 'cooling-episode-1', scope,
  steps: [{
    key: 'load', title: '记录已有工况', kind: 'ask_user',
    dependsOn: [], preconditions: [], evidenceIds: [],
    expectedObservation: { slot: 'load', label: '水温异常发生时的已有工况' },
    discriminationValue: 10, cost: 1,
  }],
});
const context = {
  routerInput: {
    query: '东方红LF1504旋耕时水温过高', currentQuery: '旋耕时水温过高', scope,
    retrieved: [], clarificationNeeded: false,
    requestedMode: 'knowledge_only' as const, llmConfigured: false,
  },
};
let result = advancePlan(state, context);
state = result.state; // 必须传递返回状态，不能每轮重建计划或丢弃已发出提案。
result = advancePlan(state, context, {
  id: 'user-report-1', episodeId: state.episodeId,
  type: 'observation', stepKey: 'load', value: '冷车正常，旋耕后升温', source: 'user_report',
});
```

上下文复用宿主已经检索出的资料，支持现有Router配置，不读取环境变量。`conditions`可保存排放/配置等约束，并追加给现有Router范围解析；身份标识不删除重要标点。需要资料支持的步骤必须引用计划中登记的条目，并通过本次Router的来源、适用性和核验判断；只保存条目ID不能成为授权。

## 状态与确定性

- `planId / episodeId / planVersion`由输入和状态转换决定；步骤ID为`planId/episodeId/key`，没有时间、随机数或模型参与。
- 相同状态、上下文、事件得到相同结果；不修改传入对象。`planVersion`按实际事件/决策转换递增，不保证等于聊天轮数。
- 重复事件返回原状态；同一事件ID携带不同内容会拒绝。用户纠正必须指向该槽位的最新观察事件，旧审计不被重写。
- 纠正前提会使依赖观察失效，包含传递依赖；需要时只在新的前提上下文中重新询问。
- `false`、`0`等有效观察可以满足条件；`null`表示未知，不代表正常。用户/工具报告始终携带`verification: unverified`；`simulated`记录不能完成真实诊断步骤或满足依赖。
- 改变设备范围会暂停并使旧步骤失效，旧观察保留原范围。第一阶段不自动生成新车型计划；宿主必须提供新计划/故障episode。
- 来源更新由宿主提供新Router上下文，失效或不适用证据不能支持待办步骤；本阶段没有知识缓存、快照监听或自动重建规则。

正常决策依次检查安全限制、范围和Router澄清门、已知观察/依赖、诊断区分价值、检查成本及预算。分数是宿主编写规则的1–100整数排序，不是故障概率。排序同分时使用稳定步骤ID。每次至多一个主要提案、至多一个Planner追问（满足“不超过两个”的上限）。身份/证据冲突澄清交给现有Router，Planner暂停，不额外生成绕过预算的临时问题。

## 等待、停止与预算

| 状态 | 含义 |
| --- | --- |
| active | 可评估下一步 |
| awaiting_user | 已提出请求，等待已有观察/记录；不代表实际执行 |
| paused | 用户暂停、无新信息、资料不足、前提缺失、范围改变或步骤已报告完成等待审阅 |
| resolved_reported | 用户明确报告已解决，不代表已确诊或维修验证 |
| escalated | Router安全限制或规则文本未过安全门，转专业人员 |
| cancelled | 用户取消，拒绝迟到观察及恢复事件推进 |
| exhausted | 提案预算或事件上限耗尽，停止新增提案 |

默认提案预算8、连续无进展上限2；可显式配置至64个提案及10次无进展。计划最多32步、64个来源引用，最多256个外部事件；ID、文本、约束和Router输入都有范围限制。取消仍可终止已经耗尽事件预算的计划。

预算计的是**发出的提案**，不是工具调用、真实检查或维修次数。同一前提下已问过的问题不再发出；无事件轮询返回稳定等待状态；新的“继续”/未知反馈最终暂停。恢复不会重置预算或无进展计数。高风险安全门优先于用户报告解决等结论；已安全转交的计划不会因普通恢复重新放行。

全部步骤有观察后，只能暂停为 `plan_review_complete`，不能据此宣布已修复。终结状态需新建episode才能启动新的诊断。审计含事件/步骤/证据引用与停止原因；状态中的观察及事件签名可能包含私人报告，不应把完整状态写入公开日志或GitHub。

## 下一阶段需要的宿主协作（未实现）

- **Memory**：提供请求归属绑定的检查点读写、`deviceId/sessionId/episodeId`校验，计划版本与原Memory revision的原子比较保存；清空/删除/换车失效和并发保护。当前聊天白名单不会自动保存Planner状态，本阶段不改数据库或保存链路。
- **Tool Use**：未来将实际结果归一化为带事件ID、槽位、来源的观察；明确调用关联、错误、截断、时间与取消语义。执行器仍负责参数/权限/重复预算。当前内核只消费模拟的标准化观察，未接入执行器。
- **LLM**：第一阶段无需新接口、调用次数为0。未来如授权辅助规划，由LLM同学提供有界、可校验的提案接口，并沿用三种模式与现有回退；模型提案不能自行变更安全、来源或计划完成状态。

当前输入是可信宿主构造的类型对象，状态从本内核创建/转换得到。没有公共HTTP解析器、任意检查点迁移/验证器、持久恢复、自然语言事实抽取、异步执行/取消底层操作、超时重试循环、维修效果验证或在线UI。未来持久化恢复时需验证schema及归属，不能直接信任客户端回传的完整状态。

## 验证与性能

```bash
node --import tsx --test tests/planner-kernel.test.ts
node --import tsx scripts/benchmark-planner.ts
npm run verify
```

新增测试使用合成资料/标准化事件，不读取真实LLM、Memory数据库或外部工具；现有项目完整回归仍按原有测试方式运行。性能脚本只测内核（包含复用Router），不测检索、模型、数据库、HTTP或实际维修效果。每场景预热200次、测量2000次，报告p50/p95/p99和最大值；p95≤10ms是当前测试机的评估目标，不是实时硬上限或线上SLA。

实际结果见同PR的性能JSON和PR验证记录；不能把合成数据或已有测试源码当作真实模型/实车验收。

### 本轮实际验证

- 新增Planner专项：32项全部通过；均为合成规则/资料和标准化事件。
- 完整 `npm run verify`：718项，716通过、2项平台跳过、0失败；Python回归、三份TypeScript检查、Lint、前后端构建通过。
- 现有按钮Fast Refresh警告和大分包提示保留。项目版本文件、锁文件与现有CHANGELOG未修改。
- 性能复测在完整回归结束后执行，环境为 v24.19.0 / linux x64，INTEL(R) XEON(R) PLATINUM 8573C。

| 场景 | 样本 | p95（ms） | 最大值（ms） |
| --- | --- | --- | --- |
| initial-proposal | 2000 | 0.2767 | 3.8584 |
| waiting-no-repeat | 2000 | 0.1899 | 4.2986 |
| 32-step-dense-DAG-20-candidates | 2000 | 3.1987 | 7.5134 |
| near-event-limit-large-signatures | 2000 | 2.7025 | 32.6834 |
| high-risk-stop | 2000 | 0.2265 | 6.7454 |

五个场景的p95均达到≤10ms目标；最大单次耗时高于10ms，因此不宣称硬实时保证。完整测量见[性能JSON](performance/planner-phase1-20261026.json)，进程RSS为整个Node/tsx基准进程值，不是Planner独占内存。
