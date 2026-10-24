# 两版实时液态玻璃 · 3.2.2

2026-10-13（上海）。根据用户“新旧版都配置液态玻璃，最好实时渲染、接近 WWDC”的要求，将现有 React 光学适配器扩展到两版。同步最新 3.2.1 main，保留公开开发预览、子目录资源路径、412 条归档知识与 421 个片段；与此前 WWDC 交互改动一起通过 PR #21 审阅，最终版本协调为 3.2.2。

参考 [WWDC25 · Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) 与 [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials)：导航浮在内容上，厚度和边缘光随输入变化，内容与操作保持清晰。本项目使用网页原生背景采样与 SVG 折射实现这些原则。

## 接入范围

| 旧版与二级页 | 新版三维园区 |
| --- | --- |
| 顶部导航、手机版本胶囊 | 顶部工具胶囊 |
| 首页模型入口 | 展区导览、底部空间控制栏 |
| 模型视角与旋转控制栏 | 展区说明、可搜索设备目录 |

导航选中胶囊、按压高光和局部形变、弹簧面板延续[之前的 WWDC 交互](../2026-10-12-wwdc-fluid-interaction/README.md)。在较矮桌面窗口中缩短小地图，避免玻璃导览遮挡地图操作。设备目录使用较厚的着色，保持长文本和筛选的可读性。

## 实时光学与性能

- 沿用锁定的 MIT `liquid-glass-react@1.1.1`。适配器将其 SVG 光学管线绑定到玻璃最外层的原生 `backdrop-filter`，修正 Chromium 在嵌套裁切容器中漏采样背景的情况。浏览器直接采样当前页面与 WebGL 场景；背景绘制、滚动和相机变化会更新玻璃。
- 按控件实际尺寸与圆角生成法线和边缘遮罩，避免把固定贴图拉成不同形状。Canvas 只在几何变化时生成这两张小贴图，背景由浏览器直接采样。中心保留干净的雾面，边缘产生折射和轻微色散，文字与点击区域独立。
- 鼠标、触摸和键盘按压改变实际 SVG 位移强度与光学中心，释放后短弹簧回到常态。指针事件合并到帧内，直接更新滤镜参数和 CSS 变量；每次移动不触发整栏 React 渲染。
- 弹簧到位后停止 rAF；失焦、触摸取消、隐藏和卸载清理输入或帧。离屏卸载 SVG 增强，保留轻量基础玻璃；普通页面与暂停三维继续按需绘制。
- 桌面贴图最多 98,304 像素，触摸模式最多 49,152 像素。光学代码与现有库共用一个延后加载的约 35 KB gzip 模块；基础界面先显示，未增加字体下载、建模依赖或第二套 WebGL 渲染器。

Chromium 桌面与触摸模式启用增强折射。Safari、Firefox与“减少动态”使用实时背景雾面；减少透明度、高对比、关闭玻璃或缺少背景滤镜时使用实底。手机、Safari 标识和系统偏好在 Chromium 中模拟；这些验证不代表真实 Apple 设备帧率或 Apple 原生渲染器。

## 验证与复现

完整项目、生产浏览器和 React StrictMode 检查记录分别见 `project-checks.json`、`browser-checks.json`、`strict-mode-checks.json`；导航、知识、模型和园区回归见 `regression/browser-checks.json`。

最新 3.2.2 完整 verify 通过：146 项测试通过，2 项 Windows 专用检查在 Linux 跳过，类型、Lint 与前后端构建通过。56 项实时界面断言、32 项功能回归与 7 项本地开发预览检查全部通过，无页面脚本错误；5 项实际 React StrictMode 重复挂载/缩放检查通过，光学源码与主线同步后的版本一致。模型四种视角、暂停后的组件选择与结构展开、恢复旋转、真实园区驾驶与实际入口均保留可用。

56 项界面断言结束后，报告收尾因版本变量被复用为 Locator 而序列化失败。报告函数及变量已修正，记录由同轮全部 PASS 输出和保存图片导出，并独立验证序列化；`browser-checks.json` 保留此来源说明。像素比较平均 RGB 差值：雾面与折射 14.91、按压前后 6.49、背景更新 50.62，真实园区控制栏与等量雾面对比也通过。静止页面和停驻园区在 600ms 观察区间内新增 rAF 回调不超过 2；这是循环停止检查，未用于宣称硬件帧率或线上提速。

像素探针用实际 WebGL 绘制斜向条纹，关闭文字和高光后分别捕获相同背景上的雾面、静止折射、按压折射。随后只更新 WebGL 背景，检查玻璃同步变化。探针图片用于隔离光学验证；产品预览来自真实三维园区录屏。

- [WebGL 雾面](optics-webgl-blur.png) / [静止折射](optics-webgl-rest.png) / [按压折射](optics-webgl-pressed.png) / [背景更新](optics-webgl-updated.png)。
- [新版真实园区](new-campus.png)、[设备目录](new-catalog.png)、[旧版首页](classic-desktop.png)。
- [新版真实三维操作选段](new-campus-preview.mp4)：从本地真实园区录屏截取 34 秒，保留原播放速度；完整原始录屏留在本机临时目录。

生产浏览器脚本保存在 [browser-checks.py](browser-checks.py)。本地完成生产构建并在 3105 端口启动服务，安装 Python Playwright、Pillow 与 Chromium 后执行：

```bash
python ui/design/2026-10-13-live-liquid-glass/browser-checks.py
```

可用 `AGRIDX_PREVIEW_URL` 与 `AGRIDX_CHROMIUM` 指定服务和浏览器。WebGL 仅在手机布局、偏好回退检查中关闭以隔离界面；像素探针、真实园区与功能回归使用实际 WebGL。没有调用外部 LLM。

## GitHub 与上线

实时光学实现提交 [c42f6eb](https://github.com/srt2777/AgriDx-v3/commit/c42f6eb6b2cdbf7005ddfc6f34ed2d5dd512629d)，成果保存到 [PR #21](https://github.com/srt2777/AgriDx-v3/pull/21)，分支 `codex/wwdc-fluid-interaction-20261012`。个人分支不发布；合入 main 后，已有开发预览工作流按主线更新独立开发站。腾讯服务器本轮未部署，生产域名耗时仍需恢复服务器访问后验收。
