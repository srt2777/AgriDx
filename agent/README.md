# Tool Use 执行层

本仓库使用 TypeScript，因此 `agent/tools.ts`、`agent/config.ts`、`tests/tools.test.ts` 对应任务中的 Python 文件。无需 Python 运行时或新增依赖。

```ts
import { build_default_registry } from './agent/tools';
const registry = build_default_registry();
const tools = registry.schemas(); // Anthropic messages API 的 tools 字段
const result = await registry.call('search_knowledge', {
  query: '久保田LX2620启动困难', limit: 1,
  context: { brand: '久保田', model: 'LX2620' },
});
```

| 名称 | 何时使用 | 参数 |
| --- | --- | --- |
| `search_knowledge` | 检索症状对应的知识与来源，复用现有适用范围过滤 | `query` 必填；`limit` 1–5，默认1；可选 `context` |
| `browse_knowledge` | 浏览目录与资料定位，正文请使用检索工具 | 可选 `brand`、`model`、`component`、`part`、`q`、`collection`（all/archive/learning）、`page`（整数） |
| `knowledge_stats` | 获取当前加载快照的知识统计 | 无 |
| `resolve_machine_scope` | 解析品牌、型号及输入冲突；不证明手册适用 | `query` 必填；可选 `context` |
| `get_current_time` | 记录当前时间，含 ISO 和上海本地时间 | 无 |

`context` 接受 `machineType`、`brand`、`model`、`engineModel`、`faultCodes`（字符串数组）。每个 schema 与 description 都含明确输入或使用边界。

注册方式：`register(name, description, input_schema, func)`，函数接收一个参数对象。函数装饰器为 `registry.tool(name, description, input_schema)(fn)`；保留原函数。`names()`、`describe()` 用于清单，`schemas()` 返回不含函数且与内部隔离的 schema 副本。

`call()` 为异步接口，必须 `await`。未知工具、参数校验、同步异常、Promise 拒绝、序列化失败和超时均返回 `ERROR: ...` 文本；不输出原始异常，避免密钥或私人数据泄漏。JSON Schema 校验支持此模块声明的 object/string/number/integer/boolean/array/null、required、additionalProperties、enum、上下限和长度；未支持的关键字在注册时拒绝。

输出最多 `MAX_TOOL_OUTPUT = 4000` 个 Unicode 字符；超限时包含 `[TRUNCATED]` 标记，截断结果可能不是完整 JSON，应作为工具文本读取，不可将缺失正文视为否定证据。目录返回来源与适用边界等元数据，不重复返回大段正文；检索优先返回来源元数据，正文排在后面。

默认工具只读，权限仅限现有公开知识快照和时钟；不开放 shell、外部模型、私有记忆或仿真遥测。一次 `call()` 只调用一次函数，不自动重试。异步等待上限10秒，超时后返回错误；不会终止底层任务或中断同步CPU函数，注册扩展异步工具时需自行实现取消。本批没有多步规划循环或聊天接线，不改变现有诊断请求的一次检索与风险门控。调用结果仍是待上层判读的数据，不能替代维修授权或实车核验。

验证：`node --import tsx --test tests/tools.test.ts`；现有 `npm test` 自动发现该测试。新增目录不在现有 tsconfig 的 include 内，独立类型检查命令：

```sh
npx tsc --noEmit --target ES2022 --lib ES2023 --module ESNext --moduleResolution bundler --strict --skipLibCheck --esModuleInterop agent/config.ts agent/tools.ts tests/tools.test.ts
```
