# Chat roleFlow证据路径与配置追问

日期：2026-10-26（上海）；版本4.1.1；批次`ui-chat-evidence-20261026`。

- ChatPage新增路径徽章：来源回答、需补充信息、AI辅助、安全降级；降级原因以文字呈现。roleFlow按“现象→原因→检查→处理→复检”五栏展示，条目通过entryId关联来源，显示书名、页码和适用范围；空栏（包括当前未标注的复检）显示“暂无资料”，不从回答文字推造证据。
- 追问区增加可点选的驾驶室/防翻架、驱动形式、排放阶段/市场选项，沿现有60秒、中止、重试和上下文状态。高风险安全提示继续要求核对手册与专业人员；本PR未实现监测摘要发送，默认关闭协议留给下一PR。
- `node --import tsx --test tests/chat-evidence.test.ts`：2/2通过；`npm run verify`：671项、655通过、16平台跳过、0失败，类型/知识哈希/Lint/完整构建通过。既有Fast Refresh警告和大包提示保留，日志`work/pr-chat-evidence-verify.log`。
- 实际Express构建（外部AI关闭）1440英文深色及375中文浅色诊断页回归：原导航、车型上下文和空状态保留；桌面scrollWidth1440、手机375，浏览器error空。空状态不能凭空展示证据；截图`desktop-dark-chat.png`、`mobile-light-chat.png`。
- 不改变ChatResponse协议、检索、记忆、AI网关、知识统计或设备档案；没有真实设备数据、参数、力矩或故障码。后续PR实现每会话默认关闭的仿真摘要预览与发送声明。
