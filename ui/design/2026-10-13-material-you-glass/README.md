# Material You 风格实时玻璃

2026-10-13（上海），3.4.3。根据用户确认，将 v3 新旧两版换为 Material You 配色、圆润控件和涟漪反馈，继续保留实时折射。已同步主干的全局主题与开发网关修复；本轮属于界面与光学实现优化，按补丁版本递进，并遵循主干最新的 3.4.9 上限。浏览器报告中的 3.5.3 是版本归并前实际执行的本地工作构建；编号调整后的光学、配色、输入与诊断源码相同，原始报告和图片保留当时编号。

## 来源与设计

检索没有确认一个可唯一对应“Material You Liquid Glass”的 React 项目。用户随后确认采用 Material You 视觉与液态折射结合的方案。

- [Google Material Color Utilities](https://github.com/material-foundation/material-color-utilities) 是实际使用的官方配色工具，锁定 Apache-2.0 的 `0.4.0`。使用 HCT 与 `SchemeTonalSpot` 生成 `surface`、`primary`、`secondaryContainer` 及对应文字角色。绿色与蓝色各有浅/深主题；金色选中容器也采用生成的容器/文字色对。
- [Material 3 色彩](https://m3.material.io/styles/color/overview) 与 [动效](https://m3.material.io/styles/motion/overview/how-it-works) 是视觉参考。旧版保持绿色，新版与内部控制台保持蓝色；保留主干金色点缀和全局主题选择、刷新、跨标签页同步。
- 搜索到的 [Expressive Glass](https://github.com/Aarav90-cpu/Expressive-Glass) 是 Android Jetpack Compose 项目，没有移植或安装；本轮没有将它或其他独立组件库称为 Google 的 Liquid Glass 实现。

浅/深色角色由 `npm run design:palette` 生成并提交到 `ui/src/styles/material-you-tokens.css`。官方工具仅为开发依赖，网页直接读取 CSS，不增加运行时配色计算或外部字体请求。锁文件中的 `gainmap-js`、`lie` 版本恢复为原已锁定包的实际版本 3.4.0、3.3.0，下载地址与完整性校验未改变。

## 接入与实时效果

新旧导航、版本切换、首页模型入口、模型操作、展区导览、说明面板和目录沿用共用玻璃组件。选中态改为柔和容器色，去掉强白色锥形边光，圆角与阴影更柔和；鼠标、触摸与键盘操作产生裁切在控件内部的有限涟漪。修正同一导航内焦点转移提前清除新控件按压的问题。

用项目内原生 SVG 管线替换 `liquid-glass-react` 运行依赖，直接在公共玻璃边界采样当前 DOM 与 WebGL 背景。RGB 位移、轻微色散和边缘遮罩保持实时，文字与点击区域独立。沿用既有圆角法线图和弹簧算法；几何改变才重建贴图，每张贴图桌面最多 98,304 像素，触摸最多 49,152 像素。按压与光学中心回弹结束后停止帧循环，相同属性值不重复写入；离屏、偏好切换和卸载释放增强层。

Chromium 启用增强折射；其他引擎与减少动态采用雾面，减少透明度、高对比、关闭玻璃和不支持背景滤镜时采用实底。触摸布局及系统偏好在 Chromium 中模拟，不作为 Apple 设备帧率或 Safari 引擎验收。

本地完整生产构建中，玻璃延后加载模块为 **4.57 KB / 2.19 KB gzip**，之前为 **57.62 KB / 34.98 KB gzip**，该模块压缩体积减少约 94%。此数值只对应光学模块；没有将它称为全站体积、线上响应时间或硬件帧率改善。

## 验证与复现

完整 `npm ci`、`npm run verify` 与开发预览构建通过：223 项测试成功、2 项 Windows 专用检查在 Linux 跳过，类型、Lint 和前后端构建通过。75 项浏览器断言通过（实时/手机 32、主题/对比度 19、StrictMode 5、知识/诊断记忆 19），无页面脚本错误。项目检查见 [project-checks.json](project-checks.json)。实际浏览器报告分别记录 [实时玻璃与手机](browser-report.json)、[主题和文字对比](theme-report.json)、[React StrictMode](strict-mode-checks.json) 及 [知识/诊断记忆回归](regression/report.json)。各报告的版本与范围按执行时记录。

光学探针在真实 React 导航下绘制实际 WebGL 条纹，比较原生折射与等量雾面，并只改变 WebGL 帧检查玻璃更新。断言使用实际滤镜参数、像素差异与 DOM 事件；输入释放后还检查滤镜属性停止变化。像素结果用于验证实时采样，没有推算设备帧率。

功能回归使用本机生产服务和静态开发预览，检查知识目录、两版跳转、本地诊断、设备档案、对话与检查进度恢复。测试车辆与问题均为合成验收输入，没有调用外部 LLM 或读取线上用户记录。对比度检查覆盖两版、两种主题的实际选中背景与主操作文字；透明背景不当作不透明背景计算。

预览图：旧版 [浅色](classic-light.png) / [深色](classic-dark.png)，新版 [实际三维园区](new-campus.png)、[设备目录](new-catalog.png)、[浅色知识页](new-knowledge-light.png)，[320px 旧版](old-mobile-320.png) / [320px 新版](new-mobile-320.png)。静态页面截图完成有限 CSS 过渡后保存；WebGL 和光学采样没有替换成图片。

需 Python Playwright、Pillow 和 Chromium。在 3115 启动本机生产服务、3116 启动实际 Vite 开发服务，并将 `dist-preview` 静态服务放在 3117，然后执行：

```bash
python3 ui/design/2026-10-13-material-you-glass/browser-checks.py
python3 ui/design/2026-10-13-material-you-glass/theme-checks.py
python3 ui/design/2026-10-13-material-you-glass/strict-mode-checks.py
python3 ui/design/2026-10-13-material-you-glass/regression-checks.py
```

可用 `AGRIDX_PREVIEW_URL`、`AGRIDX_STRICT_URL`、`AGRIDX_STATIC_URL` 与 `AGRIDX_CHROMIUM` 指定本地服务和浏览器。StrictMode 检查关闭 WebGL 以单独检查重复挂载/尺寸变化；其余光学与真实园区检查使用 WebGL。

## GitHub 与网站

源码通过独立任务分支和 PR 保存；CI 状态以对应 GitHub 检查为准。个人分支不发布，合入 main 后由现有工作流更新固定开发站。腾讯服务器本轮未连接或部署，不能以本地检查或 GitHub 保存称腾讯网站已更新。
