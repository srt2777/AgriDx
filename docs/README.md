# AgriDx 仓库地图

新参与者从[贡献指南](../CONTRIBUTING.md)了解启动、验证和提交流程；想看模块怎么协作，从[架构说明](architecture.md)开始。下表按任务给出实际入口。

| 要找什么 | 代码或资料在哪里 | 配套说明 |
| --- | --- | --- |
| 页面路由与新旧界面 | [路由入口](../src/app.tsx)、[页面](../src/pages/)、[旧版公共界面](../src/ui/) | [UI 专区](../ui/README.md)、[新版导航](modern-navigation.md) |
| 三维农田展场、园区和模型工坊 | [农田展场](../src/pages/ShowroomPage/)、[新版园区](../src/pages/ExhibitionPage/)、[模型工坊](../src/pages/ModelPage/)、[三维能力模块](../src/features/modeling/)、[静态资源](../public/) | [农田展场笔记](../src/pages/ShowroomPage/SHOWROOM-NOTES.md)、[园区装备陈列](campus-equipment-merge.md) |
| 聊天、诊断和证据 | [聊天前端](../src/features/chat/)、[聊天路由](../server/routes/chat.ts)、[诊断编排](../server/diagnosis/service.ts)、[共享协议](../shared/chat.ts) | [诊断路由](diagnosis-router.md)、[诊断交互](diagnosis-interaction.md) |
| 模型、记忆、规划和工具 | [模型供应商](../server/llm/)、[记忆](../server/memory/)、[规划接入](../server/diagnosis/plannerIntegration.ts)、[Agent 内核](../agent/) | [Agent 参与路线](agent-development.md)、[诊断记忆](diagnostic-memory.md)、[Planner](planner.md)、[工具执行](../agent/README.md) |
| 知识库原件、索引和检索 | [知识库](../知识库/README.md)、[服务端知识模块](../server/knowledge/)、[前端知识模块](../src/features/knowledge/) | [统一知识目录](knowledge-library.md)、[入库规则](../知识库/AGENTS.md)、[通识资料](tractor-knowledge/README.md) |
| 语音与设备固件 | [语音服务](../server/voice/)、[固件](../robot/firmware/) | [语音服务说明](../server/voice/README.md)、[机器人入口](../robot/README.md)、[独立固件版本](../robot/VERSIONS.md) |
| 仿真监测与故障演示 | [后端遥测](../server/telemetry/)、[前端遥测](../src/features/telemetry/)、[故障检测页](../src/pages/FaultDetectionPage/) | [遥测协议](telemetry.md)、[故障检测工作台](fault-detection-workbench.md) |
| CI、构建和部署 | [工作流](../.github/workflows/)、[检查脚本](../scripts/)、[回归测试](../tests/) | [开发预览](deployment/dev-preview.md)、[腾讯正式站](deployment/tencent-production-sync.md)、[版本规则](version-policy.md) |

常见跨模块入口：

- 本地开发和生产服务都从 [server.ts](../server.ts) 启动；[运行依赖](../server/runtime.ts) 初始化后，由 [Express 应用](../server/app.ts) 装配 API。
- 前端请求集中在 [API 客户端](../src/lib/api-client.ts)；[shared/](../shared/) 存放跨前后端的数据约定。改接口时同时核对请求校验、响应解析和回归测试。
- 知识检索、网页目录与统计共用 [知识快照](../server/knowledge/snapshot.ts)。新增知识资料从[入库规则](../知识库/AGENTS.md)开始，原件、来源、适用范围与索引一起核对。
- GitHub 合入、开发预览和正式部署是不同状态。验收正式站时核对 [deployment.json](https://agridx.xyz/deployment.json) 的提交，再检查相关页面。

研究、旧方案及变更记录分别看 [research/](research/)、[design/](design/)、[iterations/](iterations/)、[history/](history/) 和[更新日志](../CHANGELOG.md)。研究记录及 PR 中的提案不能作为主线已实现的依据；历史代码按[主 README 的版本入口](../README.md#版本说明参与者先看)查阅。
