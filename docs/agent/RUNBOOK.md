# 本地运行与验证

要求 Node >=22.19、npm >=10。从仓库根目录运行：

1. `npm ci`
2. 复制 `.env.example` 为 `.env`，将 `AGENT_WORKFLOW_ENABLED` 设为 `true`；无需 LLM 密钥。
3. `npm run dev`，打开控制台显示的本地地址，再进入 `/#/chat`。

在车型处填写品牌和完整型号，在故障描述中填写现象，展开“严格资料定位”点击“查找本机依据”。空机型会追问；无依据不生成维修结论；引用可展开。停止中断本次请求；失败可重试。执行记录下载只包含状态 trace，资料定位结果暂不写入长期记忆。

功能开关默认为 false。关闭时 API 状态为 enabled:false、运行入口返回 404、前端不显示新面板；旧聊天入口保持既有行为。该入口在本地 Node 服务中接入，开发站 Worker 尚未实现对应 API，不能将本地接通写成开发站上线。

验证命令：

```sh
npm run agent:doctor
npm run agent:kb-doctor
npm run agent:test
npm run agent:eval
npm run typecheck
npm test
npm run build
npm run check:version
```

`agent:doctor` 检查运行时、开关、固定提示词文件、快照与无机型追问。`agent:kb-doctor` 仅体检现有归档索引。`agent:eval` 重跑 60 条真实标题定位基准和策略抽查，将结果写入 `docs/agent/EVAL_REPORT.md` 与 JSON；此基准具有词面优势，不能用于宣传真实故障诊断准确率。

`GET /api/agent/status` 仅报告开关和能力；`POST /api/agent/run` 接受 `query`、`machine` 与可选 `faultCode`，支持 JSON 与 `Accept: text/event-stream`。不接受客户端角色、工具名、确认或路径。并发繁忙返回 429；非法参数返回 400；同源校验失败返回 403。

提示词缺失会给出降级结果，执行失败返回错误状态或降级结果；不得通过返回正常 HTTP 200 来推断已完成诊断。修改词典或知识来源后重跑定位评测。先复制 EVAL_REPORT.json 为基线，再运行 `npm run agent:eval -- --baseline 基线报告.json`，同一基准和同一条目集合才输出指标差值。

若要引入真实 LLM 工具循环、长期记忆、写操作、向量与重排服务，需要补齐对应适配、所有权、可信确认和独立评测，再通过 PR 审阅启用。不要为演示填入虚构原厂参数。
