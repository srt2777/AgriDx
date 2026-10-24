# 新版农机数字展厅

目标仓库：[srt2777/AgriDx-v3](https://github.com/srt2777/AgriDx-v3)。新版参考用户提供的农机展厅截图，采用蓝色科技大屏、两侧信息面板及底部功能入口；按用户后续要求精简为一个原创拖拉机结构示意模型。

## 网页与版本切换

- 默认首页展示新版，右上角提供“新版 / 旧版”。新旧版左上角都沿用南京农业大学工学院徽章，并链接到学院官网。旧版沿用原有首页；子页面的切换按钮返回所选首页。
- 浏览器保存版本选择，并在同源标签页之间同步。存储不可用时，版本、主题和语言仍能在当前标签页切换；这种环境下不保证刷新后记忆。
- 新版模型支持组件选择、展开、总览、俯视、旋转及重置，拖动模型会暂停自动旋转。WebGL 不可用或模型加载失败时显示降级提示，资料入口继续可用。
- 设备资料支持品牌 / 型号搜索、`/` 快捷键及带品牌和型号参数的知识库跳转。研究依据入口返回旧版对应区块。现有诊断、知识库和模型工坊路由保留。
- 概览和设备目录读取现有知识库 API。接口加载或失败时不显示推测的数量；失败时可重试。目录范围保留“具体型号 / 系列 / 待核实”的区分。
- 模型用于理解结构，不是实测 CAD；没有接入真实传感器、设备状态监控或实车数字孪生。

## GitHub UI 调研

调研日期：上海 2026-10-11。以下项目仅提供视觉与布局参考，没有安装其依赖或复制其代码、模型及素材。

| 项目 | 参考用途 | 核对结果 |
| --- | --- | --- |
| [DataV-React](https://github.com/DataV-Team/DataV-React) | 科技边框、标题装饰、状态面板 | MIT；package.json 的 React / React DOM peer 依赖是 `^16.8.0`，本项目使用 React 19，未直接引入 |
| [四川数字孪生大屏](https://github.com/davidsun1234/sichuan-digital-twin-dashboard) | 中央内容、两侧信息、底部入口布局 | MIT；原生 HTML / CSS / JS |
| [Three.js 数字孪生大屏](https://github.com/gavin-hao/threejs-digital-twin) | 三维场景与信息面板的关系 | Apache-2.0；Vue 3 + Three.js；README 说明大模型通过 Git LFS 保存 |
| [Three.js 科技展览馆](https://github.com/yyp92/threejs-technology-exhibition-hall) | 展厅空间与灯光的视觉参考 | GitHub 元数据未返回许可证，不使用其代码或素材 |

## Figma 与设计文件

已通过 Figma 插件创建[设计文件容器](https://www.figma.com/design/WRz19BfqzG7KYLyuWeHa5n)。Starter MCP 工具额度阻止后续画布写入；环境网络策略也阻止 `mcp.figma.com` 的网页捕获 / 上传端点。**该容器尚未写入界面，不能作为完成的 Figma 设计稿。**

提供可直接导入 Figma Design 的设计稿：

- [桌面可编辑 SVG](new-desktop-editable.svg)
- [手机可编辑 SVG](new-mobile-editable.svg)

将 SVG 拖入 Figma 画布即可导入。标题、正文、数字、图标及面板几何保留为 SVG 文字 / 矢量层；图片仅用于现有学院徽章与中央原创拖拉机三维内容，没有将完整界面扁平化为图片。层类型及字体证据见 [editable-layer-evidence.json](editable-layer-evidence.json)。由于服务限制，没有在 Figma 内验收导入效果、建立原生组件或变量绑定。

## 验证与预览

- [新版桌面](new-desktop.png)、[新版手机](new-mobile.png)、[320px 英文布局](new-320-en.png)、[旧版首页](classic-desktop.png)。
- [浏览器验证记录](browser-validation.json)：16 项检查通过，无页面脚本错误；覆盖目录数据、搜索与跳转、模型控制、版本持久化与跨标签同步、研究跳转、320px / 390px 中英文布局、接口失败重试及存储被禁用的降级。
- [徽章及导航补充验证](header-validation.json)：9 项检查通过，覆盖两版工学院徽章、官网链接、主题对应、320px / 390px 中英文顶栏、全屏、保存语言后刷新，以及子页面研究入口；无页面脚本错误。
- [项目基础验证](project-validation.json)：版本一致性、三个 TypeScript 项目、113 项测试、Lint 与前后端构建通过，2 项 Windows 专用测试在 Linux 跳过。保留已有 Fast Refresh 与 Three.js 包体积警告。
- 测试环境的既有后端 `ProxyAgent` 把本机 HTTP 请求也发往网络代理，首次两项目录 API 测试收到 403。最终验证只在测试进程中为 loopback 请求指定本地 Undici fetch；外部请求继续沿用环境代理。后端代码与代理配置没有修改，也没有调用真实外部 LLM。
- SVG 已通过 XML 解析与独立渲染检查；界面文字使用 `Noto Sans SC`，与新版网页的字体声明一致。
- 本轮沿用仓库暂停发布的约定，只做本地验证及 GitHub PR，不恢复 Sites / 腾讯部署。

本地启动：`npm ci` 后执行 `npm run dev`，默认访问 `http://localhost:3000/`。测试环境使用 `PORT=3100`，未验收真实外部 LLM、传感器或实车效果。

实现提交：[c983d3a](https://github.com/srt2777/AgriDx-v3/commit/c983d3a01bfc1412f6be1543d7c387ed852078f3)，版本 3.1.0。

## GitHub 保存与审阅

用户恢复 GitHub 连接权限后，当前账号 `Changjie29` 已将代码、截图、SVG 与验证记录推送到用户指定的 `srt2777/AgriDx-v3`，并创建 [PR #8](https://github.com/srt2777/AgriDx-v3/pull/8)。

保存分支：[codex/digital-exhibition-ui-20261011](https://github.com/srt2777/AgriDx-v3/tree/codex/digital-exhibition-ui-20261011)。审阅和合并状态以 [PR #8](https://github.com/srt2777/AgriDx-v3/pull/8) 为准；GitHub 保存没有恢复网站发布。另提供 Git bundle 与补丁备份，所需原项目基线为 `62cbafa735b2d0cec6db28c760954238dd82dc51`。
