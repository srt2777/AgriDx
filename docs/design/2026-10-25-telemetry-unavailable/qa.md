# 未接入仿真服务的开发网页状态

日期：2026-10-25。版本3.25.1；批次`ui-telemetry-unavailable-20261025`。

## 问题与结果

静态开发网页不支持后端SSE，原面板却仍写自动重连、等待场景信息。现在独立标记`unsupported`，明确监测数据、场景和告警不可用；固定“仿真数据”徽章、演示色带和离线文字仍在。该状态没有重试、场景写入、图表、读数和导出，也不生成替代数据。网络故障仍走原有重连路径。

## 本地验证

- Node24.22.1，定向客户端/面板/场景/告警测试34/34通过。新增双语SSR用例即使传入残留样本也不能显示读数、图表、场景或按钮；客户端用例核对不打开SSE/history且retry不造数。
- `npm run verify`：664项，648通过、16平台跳过、0失败；版本、知识哈希、前后端类型、Lint和完整构建通过。既有button.tsx Fast Refresh警告及构建大包提示保留。外置日志`work/pr6-static-verify.log`。
- `npm run build:dev-preview`通过。使用实际`dist-preview`，通过Vite preview在127.0.0.1:3144验收，没有夹具替换或伪造网络/读数。此本地构建记录的Git SHA为尚未提交的基线59c7e0d，不能作为公开发布SHA。
- 1440×1000，英文深色：电池舱详情中仿真/离线、出处和明确不可用文案可见；监测面板button/figure/article均0，source=simulated。截图`desktop-dark-unavailable.png`。
- 375×900，中文浅色：scrollWidth360≤375；仿真徽章在可见区域、色带和失败文字完整，无效操作仍为0。手机默认选中描边关闭。截图`mobile-light-unavailable.png`。
- DOM有role=alert，离线状态有文字与图标；面板computed animation=none、transition=0s。Esc关闭详情后焦点返回二维部件电池舱按钮，Enter重开，提示仍正确。没有新增触控目标；既有按钮44px规则不变。
- 浏览器error日志为空；标签页及本地静态服务已关闭、viewport恢复。未声称完成物理触屏、真实设备或系统减少动态设置验收；无动画样式及既有reduced-motion测试通过。

## 边界与发布

这是监测展示的能力降级修复，不新增Agent工具、执行循环、记忆或LLM输入；不改变诊断、检索、覆盖统计。保留主线并行API控制台，未操作密钥、外部AI、服务器配置或腾讯。

本地验证、GitHub保存和网页发布分别记录。PR须精确head的Ubuntu/Windows/汇总CI通过再合入，沿现有Development preview发布，并另核对公开version/commit与浏览器；此文档不将本地预览写成已发布。
