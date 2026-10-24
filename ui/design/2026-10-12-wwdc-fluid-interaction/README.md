# WWDC 交互反馈 · 3.1.2

2026-10-12（上海）。基于已合入的加载优化，根据用户“更灵动，学习 WWDC”的反馈调整控件与面板；保留最新主线的 412 条归档知识、421 个片段和团队权限记录。

## 官方参考与本项目的应用

阅读 [WWDC25 · Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) 的 Dynamics 与 Principles 章节：输入反馈、形态变化与光照应协同，控件保持与操作位置的关系，导航材质层服务于内容。另核对 [Apple Motion 指南](https://developer.apple.com/design/human-interface-guidelines/motion) 和 [Materials 指南](https://developer.apple.com/design/human-interface-guidelines/materials)。本项目以 React/CSS 实现这些交互原则，弹簧参数自行调校，不宣称与 Apple 原生材质或私有物理参数等同。

- 导航、界面版本、模型视角及展区导航共用移动选中胶囊。标签与点击区域保留正常布局，选中填充连续移动并在按下时轻微形变；各组独立，桌面与手机版本切换不会互相抢占胶囊。
- 玻璃导航、模型控制和手机版本胶囊响应鼠标、触摸与键盘按压。高光从输入位置出现，控件位移限制为横向 ±1.5px、纵向 ±1px；抬手、取消、离开或失焦清理状态。光照更新按帧合并，不通过 React 状态处理鼠标移动。
- 手机菜单、新版展区说明及设备目录短弹簧展开，退场控件立即设置 `inert` 与隐藏语义，视觉退场结束后卸载；保留目录搜索焦点与关闭后的焦点恢复。
- 页面内容短暂入场，导航与加载占位持续可用；动效结束后恢复普通合成状态。静止时不增加计时循环，不改变三维按需绘制、可见区域加载、目录缓存或节省流量预热规则。
- 减少动态时取消选中态运动、按压形变及面板过渡；高对比下使用系统选中色，透明度回退继续由已有玻璃模式控制。

## 验证与预览

动效浏览器检查与录屏在升版前的 3.1.1 构建执行；3.1.2 只追加版本元数据，动效源码一致。生产 Chromium 的 [38 项动效检查](browser-checks.json) 与 [32 项导航/模型/园区回归](regression/browser-checks.json) 均通过，无页面脚本错误，覆盖按压位置、键盘反馈、触控取消、选中胶囊连续移动、退场 `inert`、搜索及返回焦点、320px 中文与 375px 英文、减少动态与高对比。实际 WebGL 模型的四种视角仍可操作，暂停后选中态结束运动；真实园区驾驶、Esc、重置及展区进入通过。界面与按需三维均保持可用。

静止的文字界面在 600ms 观察区间内新增 rAF 回调为 0，暂停模型在 500ms 内也为 0，说明本次交互结束后没有增加持续动画循环；这些区间检查不是设备帧率或线上性能测试。`npm ci`、完整 `npm run verify` 和 `git diff --check` 通过，138 项测试通过、2 项 Windows 专用测试在 Linux 跳过，类型、Lint 与前后端构建通过。记录见 [项目检查](project-checks.json)。保留既有 Fast Refresh 和 Three.js 包体积提示，无真实外部 LLM 调用。

动效预览：[导航胶囊与按压](navigation-preview.mp4)、[完整导航操作录屏](desktop-controls.webm)、[手机菜单](mobile-menu.webm)、[新版面板](campus-panels.webm)。导航/面板录屏关闭 WebGL 以隔离文字交互，园区显示的是已有三维不可用回退；实际三维功能由模型检查及园区回归验证。手机、系统偏好和触摸输入在 Chromium 中模拟，未用这些结果宣称真实手机或 Apple 原生系统帧率。

截图：[桌面按压](desktop-pressed.png)、[375px 英文菜单](mobile-375-en.png)、[320px 中文菜单](mobile-320-zh.png)、[模型控件](model-controls.png)、[真实三维园区](regression/campus-ready.png)。

## GitHub 与线上状态

目标为 `srt2777/AgriDx-v3`，加载优化 [PR #17](https://github.com/srt2777/AgriDx-v3/pull/17) 已合入，本次动效在独立分支 `codex/wwdc-fluid-interaction-20261012` 保存为 3.1.2，实现提交为 [7f83921](https://github.com/srt2777/AgriDx-v3/commit/7f839219d7c0e3c232d2841d2a4261dd6858fd00)，审阅入口为 [PR #21](https://github.com/srt2777/AgriDx-v3/pull/21)，CI 与合入状态以 PR 为准。服务器当前无法登录，本轮先保存代码与审阅材料，不进行线上部署。

用户继续要求两版实时玻璃后，同步最新 3.2.1 main 并将这轮 UI 成果协调为 3.2.2；本页保留先前动效与测试当时的版本，最新光学实现、真实三维录屏与验收见[两版实时液态玻璃](../2026-10-13-live-liquid-glass/README.md)。
