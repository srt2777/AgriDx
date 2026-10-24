# 液态玻璃界面参考与采用范围

研究日期：2026-10-09；交付日期：2026-10-10（上海时区）。对应本轮项目版本 **2.4.5**，保持低于2.5.0。视觉规范以Apple官方WWDC和设计指南为依据，GitHub项目用于网页实现参考。

## Apple官方视频与实际观察

| 来源 | 官方章节入口 | 本轮实际查看的图帧与内容 |
| --- | --- | --- |
| [Meet Liquid Glass · WWDC25 / 219](https://developer.apple.com/videos/play/wwdc2025/219/) | [1:29 Dynamics](https://developer.apple.com/videos/play/wwdc2025/219/?time=89)、[6:00 Adaptivity](https://developer.apple.com/videos/play/wwdc2025/219/?time=360)、[10:31 Principles](https://developer.apple.com/videos/play/wwdc2025/219/?time=631) | 2:34圆形透镜与底缘高光；2:45蓝黄背景透过三图标胶囊，边缘放大、弯曲；3:38播放控件显形；3:39触点产生内部光；7:10材质分层；7:14照片底部工具条；7:40侧栏与顶栏浮于内容上方；10:50工具条覆盖文字时变白、更实；11:01光学分层；13:33多层玻璃重叠示例。 |
| [Get to know the new design system · WWDC25 / 356](https://developer.apple.com/videos/play/wwdc2025/356/) | [2:06 Design Language](https://developer.apple.com/videos/play/wwdc2025/356/?time=126)、[6:16 Structure](https://developer.apple.com/videos/play/wwdc2025/356/?time=376) | 2:15设计语言开场；2:35系统色；2:59提示文案左对齐、加粗；3:34同心圆角；3:47固定圆角、胶囊、同心形状三类示例；4:34小、中桌面控件继续使用紧凑圆角矩形。 |

两段视频均在Apple官方播放器成功加载并播放，结合实际图帧与官方转录核对。初次缓冲随后恢复；观察的是上述关键片段及图帧，未逐秒完整观看全片。章节入口时间与实际观察时间分列，不将转录内容冒充已经观看的图帧。Apple画面仅作研究参考，未作为本产品素材保存或使用。

[Apple材质规范](https://developer.apple.com/design/human-interface-guidelines/materials)将Liquid Glass用于导航和控制层，要求节制使用、保持内容层清晰并避免玻璃叠玻璃。普通材质优先保证读字；透明的Clear材质只适合丰富媒体背景，并需补偿前景对比。控件运动、高光和阴影共同表达层级，不能只追求透明度。

## GitHub实现参考

四个仓库均核对了MIT许可，并实际打开演示观察可见界面与下列交互。许可适用于各仓库代码，不能据此扩大到Apple视频、商标或其他第三方素材；本轮未引入这些演示的产品素材。

| 仓库、演示与许可 | 本轮实际观察 | 参考价值与已知限制 |
| --- | --- | --- |
| [sohumsuthar/liquid-glass](https://github.com/sohumsuthar/liquid-glass) · [演示](https://sohumsuthar.github.io/liquid-glass/demo/) · [MIT](https://github.com/sohumsuthar/liquid-glass/blob/main/LICENSE) | 暗色界面的四种材质和交互胶囊；切换浅色后背景仍暗，页头黑字对比不足。 | 沿用项目现有库。[3.1.0对应CSS实现](https://github.com/sohumsuthar/liquid-glass/blob/main/css/liquid-glass-core.css)以CSS滤镜近似折射，不应套用README旧的Chrome限定或模糊参数说明。本地3.1.0的模糊为6/10px，触摸模式关闭位移。 |
| [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react) · [演示](https://liquid-glass.maxrovensky.com/) · [MIT](https://github.com/rdev/liquid-glass-react/blob/master/LICENSE) | 切换用户信息卡和退出按钮，查看卡片及胶囊形状；演示远程背景图未显示。 | 可参考边缘高光与控件形态，未由该演示验证强折射。仓库说明Safari/Firefox缺少边缘折射，这是作者说明，未经本轮跨浏览器实测。 |
| [hwyuanzi/LiquidGlass-UI](https://github.com/hwyuanzi/LiquidGlass-UI) · [演示](https://hwyuanzi.github.io/LiquidGlass-UI/examples/) · [MIT](https://github.com/hwyuanzi/LiquidGlass-UI/blob/main/LICENSE) | 切换Aurora和Dawn背景，观察导航与卡片的薄亮边、渐变和明暗适配。 | 可参考轻边缘与清楚的导航分组。仓库采用无依赖Web Components，并声明Chromium增强折射、其他环境回退模糊，支持减少透明度和动画；这些能力未做本轮跨浏览器验证。 |
| [hungduong-projects/LiquidGlassUI](https://github.com/hungduong-projects/LiquidGlassUI) · [演示](https://hungduong-projects.github.io/LiquidGlassUI/) · [MIT](https://github.com/hungduong-projects/LiquidGlassUI/blob/main/LICENSE) | 查看中央厚折射卡和CSS参数控制卡，页面布局紧凑。 | 作为光学外观参考。源码取得WebGL上下文后直接调用，未见空上下文降级；可见性变化时暂停。本轮不引入其渲染引擎，也未测真实设备帧率。 |

演示的打开、切换和截图观察仅证明上述可见状态，不代表Safari/Firefox兼容、GPU消耗、帧率或完整交互验收通过。

## 本轮采用范围

- **导航**：一个浮动玻璃面承载导航；选中项采用清晰胶囊、薄边高光与柔和阴影，避免多层背景模糊。
- **首页模型小入口**：玻璃集中在模型台边缘的小控件和入口，模型与标题保持清楚。
- **模型工坊dock**：以玻璃工具条组织暂停自转、四视角与复位操作，部件选择保留原侧栏，突出当前选择，限制效果面积。
- **品牌→型号→组件→零部件筛选**：使用紧凑圆角控件，保留四级关系及可读的中文标签；故障表现、对应策略、出处与资料缺口使用实色内容底。

绿色着色集中于主操作和选中态，正文不做透色、折射或连续光流。按压反馈采用轻微形变及局部高光；减少动态时关闭弹性和光流，高对比或不支持背景模糊时回退清晰实色。这些是面向网页的实现取舍，不是Apple公布的CSS参数。

本轮沿用现有`@sohumsuthar/liquid-glass`，锁定依赖仍为 **3.1.0**（声明范围`^3.1.0`），不新增依赖。网页实现是视觉近似，不宣称具备Apple原生实时光学系统。跨浏览器兼容、真实设备帧率和光学效果等价性尚未测试，不能据演示或静态截图作出结论。

## 本轮验证与保存状态

- 本地90项回归测试、前端类型检查、lint、前后端构建与差异检查通过；保留既有button Fast Refresh和Three.js块体积警告。最终合入院徽2.4.4更新后重新构建、核验版本及主题。
- 实际浏览器验证：桌面首页、导航选中胶囊、模型暂停/四视角/复位、Tab焦点与Enter操作通过；东方红LF804S→启动与电气→起动机四级筛选联动通过。375px知识页与模型页无横向溢出，中文浅色和英文暗色可读。
- 320px英文原先菜单右缘超出边界，现隐藏副标题并收紧品牌组，头部scrollWidth=clientWidth=298px，全部工具按钮完整显示。320px模型六个操作均为44×44px，375px亦可操作。
- 首页省去完整dock时默认保持静止，避免失去暂停入口后的持续自转；仍支持拖拽查看。减少动态、减少透明度、无背景滤镜及关闭玻璃的回退经过源码检查，本轮未通过系统设置分别现场触发，未做Safari/Firefox或真实设备FPS测试。
- Figma知识卡修正见[协同记录](2026-10-09-figma-handoff.md)，为2.4.3基线的修复；当前2.4.5网页效果尚未同步到Figma。截图记录不代表完整Figma长页验收。
- 实现已保存到GitHub：[8a50900](https://github.com/Changjie29/AgriDx-v2/commit/8a50900dd33391d5a600fa156cd84fa63cdd7056)。用户最新要求v2仅存GitHub、v3再部署；已停止后续发布。此前发出的请求返回Sites版本19成功，未另做线上HTTP/浏览器验收，详情见[真实状态记录](../../docs/deployment/2026-10-10-liquid-glass-status.md)。本地截图仍仅证明本地浏览器状态。

本地浏览器截图：[桌面首页](2026-10-09-liquid-glass/home-desktop.png) · [桌面模型控件](2026-10-09-liquid-glass/model-desktop.jpg) · [375px知识页](2026-10-09-liquid-glass/knowledge-mobile.jpg) · [320px英文暗色](2026-10-09-liquid-glass/model-320-dark-en.png) · [375px英文模型](2026-10-09-liquid-glass/model-mobile-dark-en.png) · [375px首页](2026-10-09-liquid-glass/home-mobile.png)
