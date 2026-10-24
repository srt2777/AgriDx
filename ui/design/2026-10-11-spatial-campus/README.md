# 可漫游三维园区 · AgriDx 3.2.0

用户选择像 Bruno Simon 网站一样，通过场景探索功能。新版首页从蓝色平面大屏升级为原创三维园区：驾驶一辆拖拉机，穿行知识、诊断、模型工坊与研究四个展区。实际功能沿用原有路由，旧版首页与现有服务器改动保留。

## GitHub 案例核对

上海 2026-10-11，先通过 GitHub 搜索核对仓库、许可证、README 与相关源码，再实现园区。以下项目只作为设计及技术参考，没有复制代码、模型、声音、纹理或品牌素材，也没有安装其依赖。未把 README 截图或链接当作实测外部演示的证明。

| GitHub 案例 | 核对内容 | 本项目采用的方向 |
| --- | --- | --- |
| [Bruno Simon · folio-2019](https://github.com/brunosimon/folio-2019) | MIT；检查 `Camera.js`、`World/Controls.js`、`World/Car.js` 和阴影实现 | 通过载具探索功能、键盘与触控、跟随镜头；本项目使用简单运动与边界，没有引入物理引擎 |
| [14islands · r3f-scroll-rig](https://github.com/14islands/r3f-scroll-rig) | MIT；README 的单 Canvas、DOM/WebGL 组合与按需渲染 | 一个空间场景承载展区；导航、资料与入口保持 DOM 可操作 |
| [pmndrs · drei](https://github.com/pmndrs/drei) | MIT；核对 `MeshReflectorMaterial` 文档与现有安装实现 | 地面反射、局部环境光、空间文字与总览相机；沿用已有依赖 |
| [begmuhommet · car-configurator](https://github.com/begmuhommet/car-configurator) | 仓库存在，核对 README；未声明许可证 | 作为车辆展示的结构与构图参考，不使用其代码或素材 |
| [gorhorvat · product-configurator-3d](https://github.com/gorhorvat/product-configurator-3d) | README 的组件选择、配色和展开结构；未声明许可证 | 将结构操作保留在原有模型工坊；园区专注空间探索与功能导览 |

当前 Three.js、React Three Fiber、drei 与原创拖拉机 GLB 足以完成这一版，**不需要新增建模插件**。未来如需要实物农机的精确外观，可以使用 Blender 制作和优化 GLB；该资产制作不是当前功能的前置依赖。

## 操作与实现

- 总览可拖动环视、滚轮缩放。四个原创雕塑分别对应知识书架、诊断装置、模型部件与研究文献；金属材质、灯带、地面反射、阴影与悬浮标识构成空间层次。
- 点击“开始漫游”，用 WASD / 方向键前进、后退和转向，空格刹车；Esc 返回总览。手机使用方向触控，支持同时前进与转向。点击“回到起点”重置。
- 小地图与“驶向这里”自动规划避开展台的路线；靠近展区显示说明，可进入实际功能。直接功能入口始终保留，不必完成驾驶或等待自动导览。
- 按键释放、指针结束或取消、窗口失焦、页面隐藏、搜索和页面切换清理驾驶输入。键盘驾驶仅作用于聚焦的园区，不影响资料输入框。
- 简单运动、边界与展台避碰用于空间示意，不表示真实车辆动力学。沿用一个现有原创拖拉机 GLB，没有下载参考网站资产。
- 静止时使用按需渲染，只在实际位置变化时回传坐标，避免慢设备由坐标回传引发连续重绘；WebGL 支持探测后释放临时上下文。手机降低反射和阴影分辨率，限制像素倍率。减少动态偏好关闭相机过渡与 CSS 动画，没有持续自动旋转。GPU 性能需在真实目标设备上进一步评估。
- 资料目录继续读取现有 API，显示具体型号 / 系列 / 待核实的适用范围。加载或失败时不猜测数量；失败可重试。没有新增知识事实、设备监测、传感器接入或数字孪生能力。

## Figma 交付

本轮使用 [Figma 插件](https://www.figma.com/) 的设计流程，并尝试读取和编辑已有 [Figma 文件](https://www.figma.com/design/WRz19BfqzG7KYLyuWeHa5n)。`get_metadata` 与 `use_figma` 都返回 Starter MCP 工具调用额度已用完，未能写入画布。该文件容器不能作为完成稿。

可将以下 SVG 直接拖入 Figma Design 继续编辑：

- [桌面分层 SVG](desktop-editable.svg)
- [手机分层 SVG](mobile-editable.svg)

页面标题、正文、数字、导航、图标和面板几何均保留为独立文字 / 矢量层；三维场景与学院徽章是独立图片内容层，没有把完整页面扁平化为截图。层类型与 XML 校验见 [可编辑层证据](editable-layer-evidence.json)。未在 Figma 内验收导入效果，也未完成原生组件或变量绑定。

## 预览与验证

- [桌面总览](desktop.png)、[驾驶与展区](drive.png)、[390px 中文手机](mobile.png)、[手机触控驾驶](mobile-drive.png)、[320px 英文手机](mobile-320-en.png)。
- [生产浏览器检查](browser-validation.json)：22 项检查通过，无页面脚本错误。使用 Linux Chromium / SwiftShader，覆盖驾驶、刹车、重置、自动导览、路由、资料搜索、失败重试、版本持久化、手机双指触控、减少动态与 WebGL 降级。
- [项目检查](project-validation.json)：版本一致性、前后端及 Vite 配置类型、127 项测试、Lint 和完整生产构建通过，2 项 Windows 专用测试在 Linux 跳过。已有 Fast Refresh 与 Three.js 包体积提示保留。
- 测试进程仅为 loopback HTTP 使用本地 Undici 请求调度，避免既有环境代理将本机请求转发后返回 403；外部请求保留环境代理，后端代理配置没有修改。测试服务不配置外部 LLM 密钥。
- 本轮只做本地验收与 GitHub PR 保存，没有部署 Sites 或腾讯服务器。保留原有 3.1.1 手动服务器更新成果。

本地运行：`npm ci`、`npm run dev`，默认访问 `http://localhost:3000/`。生产检查使用本机 3104 端口；这不是线上地址。

## GitHub 保存

代码、预览、SVG 与验证记录已保存到指定仓库 [srt2777/AgriDx-v3](https://github.com/srt2777/AgriDx-v3)，实现提交为 [19e4a07](https://github.com/srt2777/AgriDx-v3/commit/19e4a07f9e197fd66199f29e3923a486ff8f269f)。

独立分支：`codex/spatial-exhibition-ui-20261011`，审阅入口为 [PR #11](https://github.com/srt2777/AgriDx-v3/pull/11)。实现提交的 [CI 运行 15](https://github.com/srt2777/AgriDx-v3/actions/runs/38147891054) 已完成且成功，Ubuntu / Windows 检查及 ci-verify 汇总通过。记录补充提交会重新触发 CI，最新状态以 PR 为准；本轮没有合并主线或部署服务器。
