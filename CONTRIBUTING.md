# AgriDx 贡献指南

从 [仓库地图](docs/README.md) 找到要改的模块，再读 [架构说明](docs/architecture.md) 和对应专题。当前仓库是 [srt2777/AgriDx](https://github.com/srt2777/AgriDx)，开发基于最新 `main`；`archive/*` 用于查阅历史。

## 启动与验证

按 [.node-version](.node-version) 安装 Node，运行：

```bash
npm ci
npm run dev
```

默认访问 `http://localhost:3000`。不用 API Key 也可以检查本地知识检索。外部模型的配置见 [快速开始](README.md#快速开始)，凭据放在本机环境或 Git 忽略的 `.env`、`server/.env`。

提交前按影响范围验证，并运行 `git diff --check`。合入前的统一入口是 `npm run verify`，覆盖版本、类型、测试、Lint 和构建。Windows PowerShell 可用 `npm.cmd`。语音依赖见 [语音服务说明](server/voice/README.md)。

| 改动范围 | 补充检查 |
| --- | --- |
| 页面和交互 | 桌面及移动浏览器；三维页面同时检查加载和降级。新增 QA 截图用 JPG/WebP、每张不超过 150 KB；视频使用已核对的外链。 |
| 诊断、Agent 与记忆 | 检查缺证据、身份纠正、适用范围冲突、失败降级及会话隔离；模型自评不能代替实际调用和来源核对。 |
| 知识内容和索引 | 先读 [知识库规则](知识库/AGENTS.md)，同步原件、条目、来源与目录，再运行 `python3 知识库/工具/校验索引.py` 和实际检索检查。 |

## 从分支到上线

1. 从最新 `main` 创建任务分支。人工开发可用 `feature/your-name/topic` 或 `fix/your-name/topic`，Codex 分支使用 `codex/`。并行工作先核对影响文件和已有 PR。
2. 根据[版本规则](docs/version-policy.md)确认版本与批次，按要求先预演 `npm run version:update`；同批次修正沿用批次 ID。不要把项目版本、界面版本、知识库版本和固件版本混用。
3. 只提交本次相关文件。填好[PR 模板](.github/pull_request_template.md)，写清问题、改后行为、实际检查和待验收事项。草稿适用于未完成工作，完整验证后再标为 Ready。主线通过 PR 合入。
4. 检查最新 `main` 的 CI 和 [开发站](docs/deployment/dev-preview.md)、[正式站](docs/deployment/tencent-production-sync.md) 的实际发布结果。部署工作流启动不代表公网已更新。
5. 整理旧 PR 时，先核对主线是否已包含其功能和验证。确认已替代的 PR 可以关闭，保留分支与讨论以便追溯；仍含独立工作的 PR 继续保留。

`npm run sync` 仅推送当前工作分支中已提交的内容。不要直接推送 `main`，也不要提交密钥、`node_modules/`、`dist/` 或临时输出。

## Agent 任务

先读 [Agent 设计与参与路线](docs/agent-development.md)，定位 LLM、Memory、Planner 或 Tool Use 的现有入口。实现时复用检索、记忆和输出安全门，记录行动、结果、预算和降级条件。提交时区分已实现、计划中和模拟行为；普通文档或 UI 改动可将 Agent 要素标为不适用。

历史协作与发布约定保留在[旧版贡献指南](https://github.com/srt2777/AgriDx/blob/2b3bcd6fa75e29fcb5e0fdd48e452cd38230ec36/CONTRIBUTING.md)，当前流程以本文及链接的规则为准。
