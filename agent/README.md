# Tool Use 执行层

仓库使用 TypeScript，对应交付为 `agent/tools.ts`、`agent/config.ts`、`tests/tools.test.ts` 和 `tests/tool_selection_cases.json`。Ajv 校验 JSON Schema；不需要 Python、网络或 API key。

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

以上为 Anthropic 风格主循环示例，并未接入现有 `/api/chat`。max_steps、取消任务、强制收尾和重规划属于主循环；Executor 不自动重试。每个有效 tool_use 保留原 id 并产出对应 tool_result，失败时才包含 is_error:true。

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

默认 write 放行，dangerous 拒绝；传入 confirm 后两者都由该回调决定。回调必须由可信宿主实现，不能把模型声称的“已确认”作为授权。重复调用采用键排序后的参数比较，第三次相同调用拒绝（包括此前失败）。超时默认30秒，read 最多4个异步并发，write/dangerous 串行且作为前后读取的屏障。超时仅停止等待，不能中止已启动操作；同步阻塞函数会阻塞 Node 事件循环，需要 Worker/子进程适配器，本层没有宣称对其硬抢占。未加入取消或事务回滚。

输出默认保留前4000个 Unicode 字符，再追加原长提示；工具可指定 max_output。非字符串转 JSON，BigInt 转字符串；循环引用返回 TOOL_ERROR。错误包含异常类型与信息，生产工具应避免把凭据放入异常；trace 参数递归遮蔽 password/token/secret/key，结果摘要只保留前200字符（结果本身仍须工具保证不含秘密）。

运行 `node --import tsx --test tests/tools.test.ts` 和 `npm test`。选择用例仅为真实模型回归的输入，尚未声称模型选择准确率。
