# AgriDx UI

此目录是 GitHub 上的界面设计与验收入口。当前迭代以简洁工作空间为方向：完整文字侧边栏、轻量选中态、清楚的内容层级与克制的色彩。项目继续保留农业品牌、学院署名、经典版切换以及现有知识/模型/诊断功能。

## 文件导航

- [界面实现](../src/ui/WorkspaceShell.tsx)：新版所有主路由的共享侧边栏、工具栏及移动抽屉。
- [样式与令牌](../src/ui/workspace.css)：浅/深色、中性画布、农业绿强调色、响应式和减少动态。
- [本轮验证记录](VALIDATION.md)：检查结果、复跑原因与未验收范围。
- [验证截图](screenshots/)：本轮本地浏览器实看结果。
- [项目日志](../CHANGELOG.md)：版本、实际检查与 GitHub 保存状态。

现有业务页面继续放在 `src/pages/`；公共界面改动优先放入 `src/ui/`，不复制后端、知识库或整个应用。参考产品名只用于本目录的来源说明，不进入用户使用流程。

## 本轮参考

1. [Michael Filipiuk — Cleaning up a slop sidebar](https://x.com/michaelfilipiuk/status/2113239967006855524)：已打开并查看视频部分画面；用于导航整理方向，不宣称逐帧复刻。
2. [Fluid Functionalism Sidebar · 用户指定 preset](https://www.fluidfunctionalism.com/docs/sidebar?preset=sa1FQfCxG4)：已查看页面、布局与 API 说明。借鉴分组、文字标签、淡选中态和手机抽屉；未移植其组件源码，也不宣称已包含该组件所有功能（如拖动调整宽度、悬停预览）。
3. [Open Claude UI](https://openclaudeui.com/)：已查看社区设计分析手册入口；借鉴中性底色、8/12/14px圆角层级与内容优先的节奏。保留农业绿，不使用 Claude 品牌或专有字体/图标，不宣称官方合作。

本轮组件与 CSS 为项目内原创实现，复用现有 React、React Router、Lucide 和主题/语言状态，无新增 UI 依赖。

## 验收范围

- 新版首页、诊断、知识、模型、展厅与历史页共用同一导航；经典版继续通过原入口切换。
- 桌面侧栏可收起并保存偏好，分组可折叠；搜索沿用现有命令菜单。
- 手机使用原生模态抽屉，支持 Escape、焦点限制与关闭后焦点返回；进入页面后关闭抽屉。
- 主题与语言切换沿用原状态；正文、资料出处、适用边界不改动。
- 本轮不合入主线、不发布网站、不连接腾讯或修改 DNS。测试与截图以最终 CHANGELOG 为准。

## 本地界面截图

桌面知识页（浅色）：

![桌面知识页](screenshots/knowledge-light.png)

手机导航与诊断输入：

![手机导航](screenshots/mobile-navigation.png)

![手机诊断](screenshots/chat-mobile.png)
