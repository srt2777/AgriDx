# UI 专区

本轮仅更新旧版，新版保留原首页、展厅和顶栏。此目录集中保存设计规范、来源、验证记录和截图；业务代码继续沿用现有架构。

## 文件

- [旧版外框](../src/ui/WorkspaceShell.tsx)：侧栏、搜索、主题语言切换、手机抽屉。
- [布局](../src/ui/workspace.css)和[视觉规范](../src/ui/classic-system.css)：仅作用于旧版。
- [Radix 色阶](../src/ui/radix-tokens.css)：来自 `@radix-ui/colors`，用 `node ui/generate-colors.mjs` 重新生成。
- [文案规则](../src/ui/copy.ts)：简化旧版界面文案；共享页面的新版文字不变，原始知识和版本日志不改写。
- [验证记录](VALIDATION.md)与[截图](screenshots/)。

## 设计约定

| 项目 | 本轮约定 |
| --- | --- |
| 文案 | 移除旧版界面中点；使用“农机知识”“设备信息”等常用名称；去掉重复说明 |
| 配色 | Radix Sage 中性色、Grass 强调色；Red 错误、Amber 警告、Blue 链接 |
| 色阶用途 | 1–2 底色、3–5 控件状态、6–8 边线与焦点、9–10 实色操作、11–12 文字 |
| 字号 | 12、14、24px 三档；以字重和间距表达层级 |
| 线条 | 需要时使用 0.5px；不使用卡片左侧彩色竖线 |
| 圆角和阴影 | 容器 8px、常规控件 4px；对齐嵌套间距；移除装饰阴影 |
| 动效 | 关闭旧版装饰性动画和过渡，减少动态设置始终生效；保留用户操作的模型查看 |
| 信息组织 | 常用功能直接进入；设备信息、资料边界、项目研究在相应位置展开，无新增确认步骤 |
| 新旧版隔离 | 旧版外框标记 `data-ui-version="old"`；所有配色与视觉覆盖限定在该外框 |

学院标识、说明书图片和三维模型保留原资源与署名，未把原始资料改写为界面配色或文案。语义色规范见 [Radix 官方用途说明](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)和[配色组合](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette)，许可证见 [MIT](licenses/radix-colors-MIT.txt)。

## 用户指定参考

- [Michael Filipiuk 侧栏整理](https://x.com/michaelfilipiuk/status/2113239967006855524)：已看部分视频画面，参考分组和视觉节奏。
- [Fluid Functionalism Sidebar](https://www.fluidfunctionalism.com/docs/sidebar?preset=sa1FQfCxG4)：参考文字导航、分组、轻选中态和手机抽屉；未移植源码，未加入拖动改宽或悬停预览。
- [Open Claude UI](https://openclaudeui.com/)：参考内容优先和控件层级，未使用其品牌或专有字体。最终色阶按用户后续要求统一为 Radix。

## 截图

旧版知识页：

![旧版知识页](screenshots/knowledge-light.png)

手机导航与诊断：

![手机导航](screenshots/mobile-navigation.png)

![手机诊断](screenshots/chat-mobile.png)

新版保留核对：

![新版原界面](screenshots/new-interface-unchanged.png)
