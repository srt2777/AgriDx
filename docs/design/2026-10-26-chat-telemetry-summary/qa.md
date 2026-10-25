# 仿真监测摘要可选发送

日期：2026-10-26（上海）；版本4.1.2；批次`ui-chat-telemetry-summary-20261026`。

- ChatPage新增“携带仿真监测摘要”复选框，默认关闭且不保存；勾选后展示当前已收到样本预览和“将发送给所选模型服务”提示。摘要只使用source=simulated的hook数据。
- 共享请求/服务端严格接受simulated来源和1600字符上限，拒绝device及超长输入；服务端提示词与本地回复保留仿真免责声明，摘要不进入知识检索、覆盖统计、质量统计或设备档案。
- `node --import tsx --test tests/chat-telemetry-summary.test.ts`：2/2通过；`npm run verify`：673项、657通过、16平台跳过、0失败，类型/知识哈希/Lint/完整构建通过。既有Fast Refresh警告和大包提示保留，日志`work/pr-chat-summary-verify.log`。
- 实际Express构建（外部AI关闭）1440英文深色及375中文浅色诊断页回归：默认关闭复选框、原导航和车型上下文保留，桌面scrollWidth1440、手机375，浏览器error空。截图`desktop-dark-summary.png`、`mobile-light-summary.png`。
- 未调用真实模型服务；没有真实设备数据、故障码、参数、力矩或阈值。勾选状态仅当前会话内存，不跨刷新保存。
