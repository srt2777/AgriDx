# 模型部件交互 · AgriDx 3.4.4

上海 2026-10-13。从最新 main 的 `e997175` 创建 `codex/model-hotspots-20261013`，保留已合入的开发控制台修正；后续合入最新 `aa6f3db` 的全局亮暗主题与金色点缀（3.5.1），两批功能共同保留。用户授权按 Three.js 选型建议完成模型工坊交互并推送合并。

## 实现

- 七个部件采用原创 GLB 的已知 `userData.component` 分组。Drei Html 将 DOM 热点锚定到真实部件边界，随展开移动；支持鼠标、触屏和键盘，模型几何直接点击与侧栏选择同步。拖拽不触发点选。
- 中文/英文说明描述示意结构位置，不提供实机尺寸、维修事实或诊断映射。浮层与侧栏共享轻量 metadata，不下载三维字体。手机浮层缩短，完整说明与重新聚焦保留在侧栏。
- Drei Bounds 根据选中 mesh 的世界坐标包围盒定位，支持已有总览/正面/侧面/俯视。加载、视角、窗口变化和明确选择才触发 framing；材质淡入淡出不会重新聚焦，手动控制取消待执行的布局聚焦。
- 描边通过延迟加载的 `@react-three/postprocessing@3.2.0` 与 `postprocessing@6.39.5` 实现，ACES_FILMIC 与原渲染色调保持一致。仅指定原始模型部件启用，手机默认关闭且可手动开启；返回整机后卸载效果。保留按需渲染，无额外常驻 Canvas。
- 导入 GLB 不开放部件标注、点选或展开，即使未知模型带有同名 extras。导入校验与内嵌资源限制沿用原实现。

## 依赖与来源

使用既有 [Drei](https://github.com/pmndrs/drei) 的 Html/Bounds/OrbitControls。新增 [React Three Postprocessing](https://github.com/pmndrs/react-postprocessing)（MIT）和 [Postprocessing](https://github.com/pmndrs/postprocessing)（Zlib），许可证随 `ui/public/licenses/` 分发，署名保存在 `ui/src/ATTRIBUTIONS`。

锁文件原有 `registry.npmmirror.com` 地址在选定环境返回 HTTP 403，因此改为同路径的官方 `registry.npmjs.org` 下载地址；既有包版本与完整性字段保持不变，仅新增描边依赖及其依赖项。

本轮没有引入 UIKit、React Bits 或物理引擎；当前网页操作继续使用既有 DOM、液态玻璃与侧栏。

## 先期验证与交付

`npm ci` 与完整 `npm run verify` 通过：225 项测试中 223 项成功、2 项 Windows 专用检查在 Linux 跳过，版本、前后端类型、Lint 与前后端生产构建通过。保留既有 Fast Refresh 与 Three.js 引擎分块体积提示；描边单独分块约 94.13 KB / gzip 25.94 KB。

本地开发模式 129 项检查通过，涵盖桌面、390px 中文触屏、320px 英文触屏、减少动态、WebGL 降级、旧版首页、真实热点/mesh 拾取、键盘、导入恢复、立即拖拽中断与 ACES 色调对比。合入主题后稳定生产构建再通过 41 项桌面/触屏检查，核对实际按需分块下载、主题切换同一 Canvas/同一相机、控件层叠、旧 GLB 原件校验和静止收敛。合计 170 项，生产无页面/应用控制台/着色器错误及重复 Three.js 警告，见 [验证记录](validation.json)。

先期 Vite 依赖重优化期间曾出现一次重复 Three.js 警告，稳定生产未复现；库自身 Clock/ShadowMap 弃用提示保留。生产 QA 初始误用旧暗色值，按已合入主干的 #18232e 修正后通过；软件 GPU 的静止判断等待实际动画完成，而非固定延时。

实现提交：[5bd2b8f](https://github.com/srt2777/AgriDx-v3/commit/5bd2b8fcad359e9b5b0b2e17f08e049ca2e91f24)。GitHub 双平台 CI 与合入结果以对应 PR 为准。浏览器基于本机 Chromium/WebGL，软件 GPU 的结果不能当作真实手机硬件帧率；腾讯服务器与原 Sites 未在本轮执行部署，main 合入后的独立开发预览由既有工作流自动构建。

## 最新主干协调

后续保留 `f203d0b` 的 Material You 光学层、开发网关修复及用户版本上限规则。依照最新 3.4.x 约定，本次交付编号为 3.4.4；既有提交及上方原始验证的 3.6.0 保留当时含义。最终 `npm ci` 和完整 verify 通过：227 项中 225 项成功、2 项 Windows 专用检查在 Linux 跳过，版本、类型、Lint 与前后端构建通过。生产构建再通过 36 项 1280px/390px/320px 检查，确认 Material You 控件与浮层可达、主题不重建 Canvas/重置相机、描边按需加载及暂停后的实际绘制收敛，无页面/应用/着色器错误或重复 Three.js 警告；三阶段合计 206 项浏览器检查。最终结果保存在 `validation.json` 的 `finalIntegration`，GitHub 双平台 CI 与合入以 PR 为准。
