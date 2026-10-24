# PartsStudio 交互与二维降级验收

2026-10-25，版本3.18.1。基于main `df4d546e48fdf69880418d4da54b10f1b6859f4b`，本批修复既有聚焦、选择与降级体验，未改导航、路由、来源范围或知识条目。

## 本地验证

- Node24.22.1；`npm run verify`通过：568项、552通过、16项Linux专用测试在Windows跳过、0失败。版本、知识库哈希、前后端类型、Lint及完整构建通过；保留既有button.tsx Fast Refresh与大chunk警告。
- 定向 `node --import tsx --test tests/parts-interaction.test.ts tests/parts-tractor.test.ts tests/studio-rendering.test.ts`：21/21通过。覆盖移动/粗指针描边策略、实体/透视/隔离一致性、拖动与主指针判断、取消手势、横竖视野、手动中断及监听清理、方向键和焦点恢复。
- 首次最终验证发现hooks/use-memo lint错误，修为内联工厂后完整重跑通过。最终日志保存在任务工作目录 `pr3b-verify-final.log`，日志不包含密钥或用户数据。
- 没有新增依赖。模型及场景保持延迟加载；PartsStudio产物26.74kB/gzip10.48kB，PartsTractorScene16.65kB/gzip6.17kB，不改变首屏入口。

## 生产构建浏览器

通过本地服务在后台IAB验收，未调用外部模型或上传照片。

| 条件 | 实际结果 | 截图 |
| --- | --- | --- |
| 1440×1000，新版中文深色，T70三维 | 原生鼠标点击车身打开详情；Esc关闭并回到部件按钮。选择电池舱后聚焦，拖动改变视角而保持选择。T70缺口不借用其他机型资料 | [三维与知识缺口](desktop-3d-dark-zh.jpg) |
| 375×1000，新版中文浅色 | 默认描边关闭，部件选择及详情可达，无横向溢出 | [移动三维默认](mobile-3d-light-zh.jpg) |
| 375×1000，新版英文浅色 | 手动开启描边，隔离选中部件，双语状态和来源说明保留 | [移动手动描边](mobile-3d-light-en.jpg) |
| 1440×1000，新版中文深色，柴油二维 | 无canvas，复用完整部件列表；手动选择纽荷兰/WORKMASTER25后散热器为3条，链接保留brand/model/component/part | [二维知识计数](desktop-2d-dark-zh.jpg) |
| 375×1000，新版英文浅色，柴油二维 | 同样3条；关闭详情返回radiator按钮。列表按钮最小44px，页面scrollWidth360≤375 | [移动二维详情](mobile-2d-light-en.jpg) |
| 375×1000，旧版英文浅色 | 原模型页发动机选择、聚焦与知识入口保持可操作 | [旧版兼容](mobile-classic-light-en.jpg) |

桌面列表按钮均44px；键盘方向键/Home/End移动、Enter选择、Esc关闭及恢复焦点已操作核对。二维模式不渲染模型canvas；回到三维仍用既有资源与加载路径。故障演示页仍用原调用方式，共用场景成功加载，选择散热器后名称同步，控制台无error。没有改写其既有监测数据逻辑，该数据流迁移留到遥测阶段。

## 受控分支验收

当前浏览器工具不能覆盖操作系统减少动态偏好或物理禁用GPU。使用 `tests/browser/parts-studio-fixture.mjs` 的构建前变换运行原组件分支，源文件、浏览器设置与正常dist均不修改。夹具在HTML标记模式并校验变换生效，只监听127.0.0.1，禁用外部AI，输出位于工作目录；不参与生产构建。

```sh
node --import tsx tests/browser/parts-studio-fixture.mjs unsupported
node --import tsx tests/browser/parts-studio-fixture.mjs reduced
```

| 夹具 | 实际结果 | 截图 |
| --- | --- | --- |
| unsupported：probeWebGL返回false，375×1000 | 自动进入静态降级，0canvas，14个T70部件加整机全可达；End/Enter选择右后轮毂，知识待补与来源入口保留，Esc恢复焦点；按钮≥44px，无溢出 | [无WebGL等价列表](mobile-no-webgl-dark-zh.jpg) |
| reduced：PartsStudio减少动态分支为true，1440×1000 | 发动机联动禁用，选部件后详情可读；组件所有后代计算样式animationName为none、transitionDuration为0s，抽屉无过渡；相机走既有直接定位分支 | [减少动态](desktop-reduced-dark-en.jpg) |

夹具证明组件分支行为，不代表物理GPU中断或真实手机触屏硬件测试。主指针/触控移动阈值由纯逻辑测试覆盖，移动布局与控件尺寸由浏览器核对。所有监测/状态仍是现有明确标注的示例，本批没有引入传感器值或维修阈值。

## GitHub与部署

本地验收、GitHub保存与线上部署分开记录。PR当前head的Ubuntu、Windows和汇总CI均通过后才合并；实际SHA及CI链接写在PR描述与续做记录。合并提交使用`[skip ci]`阻止main自动发布，本批不执行部署。
