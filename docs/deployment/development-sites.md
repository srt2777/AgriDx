# 开发站登记与 GitHub 同步

机器可读记录：[development-sites.json](../../.openai/development-sites.json)。本表区分平台创建时间、首次发布、源码版本和实际在线版本，缺少证据的字段不补猜。

| 开发版 | 建立者与管理者 | 建立时间（上海） | 初始源码版本 | 访问与详情 |
| --- | --- | --- | --- | --- |
| [AgriDx v4 开发版](https://agridx-v4-development.orangeglade33.chatgpt.site) | 用户委托 Codex，通过 Sites 创建；Sites 所有者显示名 changjie；GitHub 操作账户 Changjie29 | 2026-10-26 19:36:28，来自 Sites create_site 原生回执 | 4.4.0 / `783b565e8b2ff7733d7246ff733287e80f2245dc` | 新独立站，默认仅所有者可访问；独立 D1 与密钥配置，保留完整 GitHub 源文件及完整开发构建 |
| [原公开开发站](https://agridx-dev-preview.z3464715478.chatgpt.site) | 历史仓库文档记载由 Codex 使用 Sites 建立；当前账户无法读取旧站管理信息，不能确认当前平台所有者 | 2026-10-12 为历史首次发布记录，平台准确创建时间未核实 | 初期版本和历史提交见[原发布记录](dev-preview.md)，在线版本读取网站 | 保留现有公开入口、数据与配置，本轮不覆盖 |

## 自动更新与验收

两个开发入口均读取 `srt2777/AgriDx` 的 `dev-preview-built` 完整构建。main 每次 push 触发现有 `.github/workflows/dev-preview.yml`，完成 verify、前端知识快照构建后发布产物；Sites 网关读取最新产物。无需每次手动上传网页，没有新增轮询机器人或修改 GitHub 权限。

“实时”是主线检查通过后的自动同步，不是每次编辑立即上线：PR 未合入不发布，CI/构建失败保持上一版。网页每30秒检查更新，在存在未保存草稿、请求或本地模型时等待安全时机加载。详情见[自动加载规则](automatic-client-update.md)。

验收对照 GitHub main SHA、Development preview 工作流 headSha、`/dev-preview.json`、`/api/health` 和 HTML 的 `agridx-build-commit`。初始创建版本是历史固定字段，实际版本持续递增，以这些在线响应为准。私有站需要所有者登录，不能在公开 GitHub Actions 里存放访问令牌来绕过登录。

## 完整源码与运行边界

新站源仓库保留初始提交的全部 Git 跟踪文件，排除继承的 `.openai` 旧站身份并替换为新身份；不复制 `.env`、本机凭据、私人数据库或 Git 历史。Sites Worker 复用现有 `scripts/dev-preview-gateway/worker.js`、`ai.js` 与 schema-only D1 迁移，完整页面、模型与知识快照来自 GitHub 构建。没有重新设计页面或裁剪成宣传页。

Sites 源码快照与运行中的前端构建分别记录：前端自动跟随 main；Worker、数据库迁移等服务端网关变更须通过 Sites 源码保存和部署，不能将前端自动同步描述为 Worker 也已自动升级。

这是仓库现有开发运行方式，不是 Node Express 服务器搬到 Workers：本地知识检索和诊断在浏览器运行；AI 接口、访问采集、受保护控制台由独立 Worker/D1 提供。外部模型需要管理员自行配置 provider key 并开启；遥测、照片建模等依赖独立后端的功能保留原来明确的未连接状态。ToolExecutor 尚未接入多轮聊天，亦不宣称已启用。

## 本次发布记录

首次 Sites 部署状态、saved version、源码提交及线上核对结果记录于机器清单，完成后更新。本轮不操作腾讯、旧正式站、域名或 GitHub 权限。
