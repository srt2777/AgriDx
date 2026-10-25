# 旧工作台遥测回放边界

日期：2026-10-25（上海）；版本4.0.2；批次`ui-fault-telemetry-replay-20261025`。

- 本PR只新增`telemetry-replay.ts`和3个单元测试，并同步遥测协议说明与版本记录；旧`FaultDetectionPage`仍未接线，不改变导航、路由、场景选择或诊断草稿。没有LLM、Memory、Planner、Tool Use、知识库或服务端行为变化。
- 适配器只接受hook已经收到的同通道`TelemetryPoint`，按采样时间排序、去重并返回有界前缀；游标不能越过末点、插值或生成未来值。播放/暂停语义留给后续页面视图，不暂停SSE仿真服务；run重置是显式的历史视图重置，不冒充网络中断。相对秒演示记录和Unix采样时间保持不同来源。
- `node --import tsx --test tests/fault-telemetry-replay.test.ts`：3/3通过，覆盖排序/精确去重、历史游标边界、空游标和run重置。
- `npm run verify`：665项、649通过、16平台跳过、0失败；版本、知识哈希、前后端类型、Lint、完整构建通过。既有button Fast Refresh警告和大包提示保留。外置日志`work/pr-fault-replay-verify.log`。
- 实际Express开发构建（外部AI关闭）1440×1000英文深色和375×900中文浅色回归故障工作台：原场景、仿真标识、参数说明、资料边界、导航保留；手机scrollWidth360≤375，浏览器error为空。截图`desktop-dark-regression.png`、`mobile-light-regression.png`。未声称真实设备、物理触屏或新页面功能已接线。
- 版本脚本maintenance先dry-run再执行4.0.2，知识库2026.10.3不变，无新依赖。GitHub保存、CI、开发网页发布待PR完成；不操作腾讯、工作流、密钥、服务器配置、权限或archive。
