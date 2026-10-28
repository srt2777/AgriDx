# 来源与静态入口盘点

通过 `node --import tsx scripts/agent-inventory.ts` 从当前代码生成。路由为代码中的局部路径，需结合父级 mount 前缀；动态路由和字符串拼接不能仅靠静态扫描完整还原。此清单不代表权限审计结论。

## 来源分类

来源记录共 28 条；标签沿用 sources.json，不虚构维修手册或技术通报数量。

| 原始 document_type 标签 | 数量 |
| --- | --- |
| 企业店铺维保网页 | 1 |
| 企业店铺维护指导网页 | 1 |
| 厂家维护文章 | 1 |
| 政府网站报道 | 1 |
| 既有完整PDF | 3 |
| 交机培训手册（非完整整机说明书） | 4 |
| 拖拉机整机使用保养说明书 | 2 |
| 拖拉机整机使用说明书 | 1 |
| 整机操作手册 | 2 |
| 拖拉机配套自动导航/辅助转向系统说明书（非整机） | 1 |
| 既有仓库整机操作维护扫描手册；厂家下载来源待补 | 1 |
| 整机使用保养说明书；本地只保存来源记录与自行概述 | 1 |
| 整机操作说明书；本地只保存来源记录与自行概述 | 1 |
| 整机操作/维护说明书 | 2 |
| 整机说明书 | 4 |
| 配套系统手册 | 1 |
| 整机／维保官方预览 | 1 |

## Node 路由与挂载

| 方法 | 局部路径 | 代码位置 |
| --- | --- | --- |
| USE | /api/modeling | server/app.ts:21 |
| USE | /api | server/app.ts:23 |
| USE | /api/chat | server/app.ts:25 |
| USE | /api/agent | server/app.ts:26 |
| USE | /api/memory | server/app.ts:28 |
| USE | /api | server/app.ts:29 |
| USE | /api | server/app.ts:30 |
| GET | / | server/memory/routes.ts:51 |
| POST | /devices | server/memory/routes.ts:52 |
| PATCH | /devices/:id | server/memory/routes.ts:53 |
| DELETE | /devices/:id | server/memory/routes.ts:54 |
| POST | /sessions | server/memory/routes.ts:55 |
| GET | /sessions/:id | server/memory/routes.ts:56 |
| PATCH | /sessions/:id | server/memory/routes.ts:57 |
| POST | /sessions/:id/clear | server/memory/routes.ts:61 |
| DELETE | /sessions/:id | server/memory/routes.ts:66 |
| GET | /status | server/routes/agent.ts:9 |
| POST | /run | server/routes/agent.ts:10 |
| GET | /knowledge/relations | server/routes/catalog.ts:8 |
| GET | /knowledge/catalog | server/routes/catalog.ts:13 |
| POST | /chat | server/routes/chat.ts:11 |
| GET | /capabilities | server/routes/modeling.ts:28 |
| POST | /jobs | server/routes/modeling.ts:35 |
| GET | /jobs/:id | server/routes/modeling.ts:50 |
| GET | /jobs/:id/:artifact | server/routes/modeling.ts:55 |
| GET | /health | server/routes/status.ts:8 |
| GET | /model/tractor | server/routes/status.ts:16 |
| USE | /telemetry | server/routes/telemetry.ts:9 |
| GET | /telemetry/scenario | server/routes/telemetry.ts:12 |
| POST | /telemetry/scenario | server/routes/telemetry.ts:18 |
| GET | /telemetry/history | server/routes/telemetry.ts:46 |
| GET | /telemetry/stream | server/routes/telemetry.ts:59 |

## 前端请求与 API 相关位置

以下为相关源码行索引，包含字符串引用而不只是真实网络调用。

- src/dev-preview/ApiConnections.tsx:14
- src/dev-preview/DeveloperPage.tsx:36
- src/dev-preview/DeveloperPage.tsx:172
- src/dev-preview/ai-gateway.ts:13
- src/dev-preview/ai-gateway.ts:32
- src/dev-preview/api.ts:48
- src/dev-preview/api.ts:57
- src/dev-preview/api.ts:60
- src/dev-preview/api.ts:76
- src/dev-preview/api.ts:79
- src/dev-preview/api.ts:135
- src/dev-preview/memory.ts:96
- src/dev-preview/memory.ts:97
- src/dev-preview/memory.ts:98
- src/dev-preview/telemetry.ts:17
- src/features/chat/AgentWorkflowPanel.tsx:12
- src/features/chat/agent-api.ts:41
- src/features/chat/api.ts:38
- src/features/chat/api.ts:67
- src/features/knowledge/catalog-api.ts:118
- src/features/knowledge/relations-api.ts:40
- src/features/modeling/ModelGeneration.tsx:10
- src/features/modeling/ModelGeneration.tsx:21
- src/features/modeling/ModelGeneration.tsx:83
- src/features/modeling/ModelGeneration.tsx:109
- src/features/telemetry/store.ts:88
- src/features/telemetry/store.ts:159
- src/features/telemetry/store.ts:199
- src/features/updates/release-updater.ts:34
- src/features/updates/release-updater.ts:146
- src/hooks/useDiagnosticMemory.ts:8
- src/pages/VersionHistoryPage/VersionHistoryPage.tsx:37
