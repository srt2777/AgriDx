# 旧版液态玻璃优化 · AgriDx 3.2.1

本轮优化 v3 中通过“新版 / 旧版”切换进入的旧版 UI，以最新 3.2.0 三维园区为基线。导航、首页模型入口与模型工坊控制栏增强玻璃效果；知识筛选和诊断文字区保持静态雾面，便于阅读和输入。

## 形状与材质

参考 Apple [WWDC25 · Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/?time=214) 对同心几何的说明：胶囊半径是容器高度的一半，内部形状与外侧轮廓通过间距对齐。顶部导航采用自适应胶囊轮廓，内部选中项和工具按钮也采用胶囊 / 圆形，避免固定圆角与栏高不协调。

639px 以下，将版本切换移到主栏右下方的独立小胶囊，保持主栏单行。主题、语言、菜单和版本按钮至少 44px；版本切换的选中底色在两个等宽按钮之间平移，减少动态时直接切换。

采用 MIT 许可的 [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react)，锁定 npm `1.1.1`，替换原 `@sohumsuthar/liquid-glass`。使用上游标准 SVG 位移模式，没有复制演示图片；作者署名见 [ATTRIBUTIONS](../../src/ATTRIBUTIONS)，完整许可随构建分发在 [ui/public/licenses/liquid-glass-react.txt](../../public/licenses/liquid-glass-react.txt)。这是网页上的近似材质。

| 位置 | 背景模糊 | 位移强度 | 材质 |
| --- | --- | --- | --- |
| 顶部导航 | 8px | 28 | 边缘折射、薄亮边、局部指针光照 |
| 首页模型入口 | 6px | 40 | 小面积胶囊折射 |
| 模型控制栏 | 8px | 36 | 背景折射、实色选中项 |
| 手机版本切换 | 8px | 无 | 独立雾面胶囊 |
| 知识筛选、诊断工具栏和输入区 | 12–14px | 无 | 高遮盖雾面，文字独立显示 |

## 实现与回退

- 应用组件管理正常文档流，文字、链接和按钮处于独立内容层。上游组件只绘制背景，不将控件放进位移滤镜，也不启用整栏弹性位移。
- 折射引擎按需加载。仅 Chromium 精细指针设备且无减少动态偏好时，在明确指定的三个位置启用；新版首页与静态雾面区无需加载引擎。
- 容器尺寸通过 `ResizeObserver` 测量，半径限制为较短边的一半；父容器尺寸变化更新装饰层，保留控件 DOM 与焦点。离屏后卸载折射层。
- 鼠标 / 笔指针在局部玻璃面上按动画帧合并更新 CSS 变量，不通过鼠标事件更新 React 状态；离开及卸载时清理局部样式。
- 触摸设备、其他浏览器、减少动态和 `html.lg-blur-only` 使用背景模糊。减少透明度、强制颜色、`html.glass-off` 或缺少背景滤镜支持时使用实底；强制颜色采用系统颜色。媒体偏好和根节点开关实时生效。

## 本地验证

`npm ci` 和完整 `verify` 通过：127 项测试通过、2 项 Windows 专用测试在 Linux 跳过，版本一致性、三个 TypeScript 项目、Lint 和前后端生产构建通过。保留已有 Fast Refresh 与 Three.js 包体积提示；本地健康接口返回 3.2.1。详见 [项目检查记录](project-validation.json)。

[生产浏览器检查](browser-results.json) 共 62 项通过，无页面脚本错误。使用 Linux Chromium，覆盖版本切换及跨标签页同步、双语 / 主题、320 / 375 / 768px 触控布局、模型控制、四级知识目录、诊断草稿、尺寸变化与焦点、偏好回退。另以 DOM 布局检查核对 1024 / 1280px 英文导航没有裁切。

预览：

- [桌面亮色](home-desktop-light.png)、[桌面暗色](home-desktop-dark.png)
- [375px 中文亮色](home-375-zh-light.png)、[375px 英文暗色](home-375-en-dark.png)
- [320px 中文亮色](home-320-zh-light.png)、[320px 英文暗色](home-320-en-dark.png)
- [模型工坊桌面](model-desktop.png)、[模型工坊手机](model-mobile-light.png)

Safari 用户代理和背景滤镜缺失是模拟回退检查，不代表真实 Safari 验收；未测真实设备帧率，也未调用外部 LLM。

完整 `verify` 的本机 HTTP 测试使用临时 loopback Undici 调度，避免环境代理将 localhost 请求转发后返回 403；外部请求保留环境代理，仓库后端配置未调整。

## GitHub 保存

目标仓库 [srt2777/AgriDx-v3](https://github.com/srt2777/AgriDx-v3)，任务分支 `codex/classic-liquid-glass-20261011`。实现提交 [6b24fbc](https://github.com/srt2777/AgriDx-v3/commit/6b24fbc2c4a456ff028902b2f00b30f655dca984) 已推送，审阅入口为 [PR #16](https://github.com/srt2777/AgriDx-v3/pull/16)。CI 与合入状态以 PR 为准；本轮未合并主线或部署网站。
