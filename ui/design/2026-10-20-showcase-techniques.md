# 展示站点手法摘记 · 2026-10-20

只记录公开页面上能核对到的手法，供新版园区和展厅取用。不复制对方代码、模型或品牌素材。

| 来源 | 能核对到的手法 | 本轮是否采用 |
| --- | --- | --- |
| [Oryzo AI](https://www.awwwards.com/sites/oryzo-ai)（Lusion，Awwwards Site of the Day，2026-04-13） | WebGL / Three.js 入场与 3D 到 2D 的过渡，动效可被内容打断 | 采用缩短版：园区总览镜头从高处落入，可跳过 |
| [Vertex3D](https://www.awwwards.com/sites/vertex3d)（Awwwards Honorable Mention） | 片头式 WebGL 预加载；磁吸光标靠近玻璃按钮 | 采用轻量磁吸：细指针 78px 内按钮轻移，并加一层不拦截点击的跟随光晕，不替换系统光标 |
| [OceanX 2025](https://www.awwwards.com/inspiration/intro-transition-webgl-oceanx-2025)（Unseen Studio） | WebGL 入场过渡，镜头先建立空间再交给操作 | 与片头合并，不另做转场遮罩 |
| [DES](https://www.red-dot.org/project/des-55138)（Red Dot，Demodern） | 建筑网格上的 WebGL 场景，导航不挡住内容 | 采用一次扫过的地面网格，扫完停住 |
| [Hansgrohe Bathroom Inspirator](https://www.red-dot.org/project/hansgrohe-b2c-bathroom-inspirator-in-webgl-67004)（Red Dot，Demodern） | 产品 WebGL 依赖环境反射和材质，而不是持续粒子 | 展厅补一间程序化环境反射；园区原有环境贴图保留 |

同仓库已引用的 [pmndrs/drei](https://github.com/pmndrs/drei) `RoomEnvironment` 与 `MeshReflectorMaterial` 继续沿用，不新增依赖。

本轮不做的部分：无限粒子、自定义光标替换系统指针、长页滚动绑定镜头。那些要么会让按需渲染停不下来，要么会挡住键盘和读屏。
