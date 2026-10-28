# Tool Use 执行层

仓库使用 TypeScript，`agent/tools.ts` 保留兼容导出；注册、执行、计算器和默认工具分别位于 `tool-registry.ts`、`tool-executor.ts`、`calculator.ts` 和 `default-tools.ts`。Ajv 校验 JSON Schema；不需要 Python、网络或 API key。

```ts
import { registry, ToolExecutor } from './agent/tools';
// 每个任务创建一个 executor，跨轮保留以检测重复调用。
const executor = new ToolExecutor(registry, async (name, args) => {
  return await askUserToConfirm(name, args); // 由宿主 UI 实现
});
for (let step = 0; step < max_steps; step++) {
  const resp = await llm.chat(messages, { tools: registry.schemas() });
  messages.push({ role: 'assistant', content: resp.content });
  if (resp.stop_reason !== 'tool_use') break;
  messages.push({ role: 'user', content: await executor.execute_tool_uses(resp.content) });
}
// 达到预算且需要总结时，由主循环调用 tool_choice: { type: 'none' } 强制收尾。
```

以上为 Anthropic 风格的接口示例，并非项目实际的影子循环实现。现有 `/api/chat` 的主答复不由该示例生成；实际影子循环见 `agent/runner.ts`。Executor 不自动重试。每个有效 tool_use 保留原 id 并产出对应 tool_result，失败时才包含 is_error:true。

| 工具 | 用途 | 参数 | risk |
| --- | --- | --- | --- |
| calculator | 安全算术解析 | expression，支持 + - * / % 与括号 | read |
| get_current_time | ISO 与上海当前时间 | 无 | read |
| search_knowledge | 按症状检索来源与适用范围 | query；limit 1–5 默认1；context | read |
| browse_knowledge | 浏览精简资料目录 | brand/model/component/part/q；collection；page；limit 1–20 默认10 | read |
| knowledge_stats | 已加载知识快照统计 | 无 | read |
| resolve_machine_scope | 品牌型号解析及冲突检测 | query；context | read |

context 可含 machineType/brand/model/engineModel/faultCodes。数量和机型匹配不等于维修结论，检索继续沿用现有来源和配置边界。

`register(tool)` 或兼容的 `register(name, description, schema, fn, options)` 注册；`registry.tool(name, description, schema, options)(fn)` 为函数装饰器。schemas(allowed)、names、get、describe 提供模型及 Planner 所需信息。导出 registry 为默认共享实例，build_default_registry 可用于隔离测试；每任务 Executor 独立维护重复计数和 trace。旧 call 接口保留，但每次创建临时 Executor，不适用于多轮任务的重复保护。

默认 write 放行，dangerous 拒绝；传入 confirm 后两者都由该回调决定。回调必须由可信宿主实现，不能把模型声称的“已确认”作为授权。重复调用采用键排序后的参数比较，第三次相同调用拒绝（包括此前失败）。超时默认30秒，read 最多4个异步并发，write/dangerous 串行且作为前后读取的屏障。超时仅停止等待，不能中止已启动操作；同步阻塞函数会阻塞 Node 事件循环，需要 Worker/子进程适配器，本层没有宣称对其硬抢占。执行接口可传入 AbortSignal；取消或超时时向工具回调的第二个参数提供协作式取消信号，同时停止等待并返回 CANCELLED 或 TIMEOUT。同步函数不能被抢占，不响应信号的异步操作也可能继续；取消不表示事务回滚。

输出默认保留前4000个 Unicode 字符，再追加原长提示；工具可指定 max_output。非字符串转 JSON，BigInt 转字符串；循环引用返回 TOOL_ERROR。错误包含异常类型与信息，生产工具应避免把凭据放入异常；trace 参数递归遮蔽 password/token/secret/key，结果摘要只保留前200字符（结果本身仍须工具保证不含秘密）。

运行 `node --import tsx --test tests/tools.test.ts` 和 `npm test`。选择用例仅为真实模型回归的输入，尚未声称模型选择准确率。

OpenAI 兼容 provider 的 `chatWithTools` 是可选能力：接受工具 schema 与 `auto`/`none`，返回工具调用的结构化对象，并将 AbortSignal 传给请求；上游无效参数或格式会被拒绝。Gemini 当前明确不暴露该能力。该适配器尚未连接聊天诊断路径，也未通过真实模型验证；原有单次检索与路由不受影响。

影子实验使用 `AGENT_LOOP=shadow` 显式开启，默认 `off`；只在既有协调器允许 AI 且普通回答通过安全门控之后运行，结果不会替换回复。模型仅能选择服务端允许的只读工具，设备范围由服务端绑定；最多 4 步（硬上限 6），到最后一步要求不再调用工具，整体 8 秒预算，相同参数最多两次、只读并发最多四个。取消和超时是协作式，不能抢占同步代码。影子循环在普通答复确定后于后台运行、不被等待，因此不增加答复延迟；同一服务最多 4 个影子运行并发，超出即跳过，异常被捕获并只记录一行脱敏服务端日志（`[agent-shadow]`，含状态、原因、工具名与耗时），工具事件不再返回给前端。额外调用可能产生模型费用。影子循环优先使用普通主选供应商，主选不支持工具调用（如 Gemini）时改用已配置的 DeepSeek，不影响普通答复的供应商选择；均不可用时只警告一次并跳过。网关及无密钥时保留原路径。事件不保存问题、设备名称或工具正文；结果和适用性仍需既有 answerGuard 校验。此功能尚未测真实供应商工具选择准确率。

| 只读或控制工具 | 输入 | 输出与来源 | 风险 / 超时 / 错误 |
| --- | --- | --- | --- |
| get_knowledge_entry | entryId | 正文、来源、页码、范围、核验状态；通识明确无手册页码，适用性待核实 | 只读，30 秒；NOT_FOUND、INVALID_ARGS、TIMEOUT、CANCELLED |
| get_session_state | 无 | 服务端当前设备会话症状和进度，用户报告待核实 | 只读，30 秒；SESSION_UNAVAILABLE、INVALID_ARGS、TIMEOUT、CANCELLED |
| list_prior_reports | 无 | 服务端当前设备的历史用户报告，待核实 | 只读，30 秒；SESSION_UNAVAILABLE、INVALID_ARGS、TIMEOUT、CANCELLED |
| explore_relations | nodeId | 最多 20 条启发式目录/待审关系与限制，不代表因果或适用性 | 只读，30 秒；NOT_FOUND、INVALID_ARGS、TIMEOUT、CANCELLED |
| ask_user_for_info | question | 结束循环并给出待确认问题，属于助手推断 | 控制，30 秒；INVALID_ARGS、TIMEOUT、CANCELLED；影子模式不改变原答复 |

以上工具结果还可能有 REPEATED_CALL 或 TOOL_ERROR。不存在写入工具，仿真遥测不进入工具；登录及设备归属由服务端已有会话层决定，模型不能选择设备或用户。原有工具的参数和只读限制见上表，来源仍以每条原始证据为准。

Node 请求在答复前断开会向影子循环传递 AbortSignal（答复发出后由 8 秒整体期限约束）；支持协作取消的工具与供应商会收到信号。既有普通生成路径不因此获得硬取消能力，同步工具仍不可抢占。

既有六个工具均为只读、默认 30 秒，可能返回 INVALID_ARGS、TIMEOUT、CANCELLED、REPEATED_CALL 或 TOOL_ERROR；查无工具时返回 UNKNOWN_TOOL。`calculator` 的来源为通用计算；`get_current_time` 为系统时间；`knowledge_stats` 为知识快照统计，均不提供手册页码。`search_knowledge` 返回来源、范围、核验与正文，可能混合手册和通识（后者标“通识（无手册页码）”）；`browse_knowledge` 返回带范围的目录摘要，不证明适用性；`resolve_machine_scope` 返回助手范围解析及冲突，不能作为实车核验。它们的具体输入及输出限制见上方工具表。错误结果须供后续模型步骤读取，禁止盲目重复。
