# 旧故障工作台统一遥测接线

日期：2026-10-25（上海）；版本4.1.0；批次`ui-fault-telemetry-page-20261025`。

- 页面保留`/fault-detection`路由、原场景/记录/资料/聊天预填和柴油结构示意。指标改由`useTelemetry({ modelId: 'diesel', partId: 'engine' })`选择，目录提供名称、单位和量程；趋势使用`telemetry-replay`的已收到点，页面不再调用前端`frame()`、固定`METRICS`或用前端时间造样本。
- 播放/暂停、重新开始和滑块是已收到历史的视图游标；不会暂停SSE、生成未来读数或把回放状态当网络断线。连接离线/延迟仍来自hook，仿真告警只读已收到后端帧。旧LX2620资料仍保留型号、市场、配置和来源边界，仿真不进检索。
- 定向故障与回放测试11/11通过；`npm run verify`：669项、653通过、16平台跳过、0失败，类型、知识哈希、Lint和完整构建通过。既有Fast Refresh警告及大包提示保留，日志`work/pr-fault-page-verify-final.log`。
- 实际Express构建（外部AI关闭、仿真seed2777）1440英文深色及375中文浅色回归：原导航和资料面板保留；桌面`scrollWidth=1425≤1440`，手机`scrollWidth=360≤375`，浏览器error空。截图`desktop-dark-page.png`、`mobile-light-page.png`。
- 接线仍未实现诊断摘要的默认关闭/预览服务隔离；该依赖留给第7步。没有真实设备、实车CAD、物理触屏或厂家阈值验收。
