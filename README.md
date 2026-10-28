# 耕知·耘诊 · 农业机械智能诊断平台

面向农业机械的故障诊断与资料检索平台，结合有来源的知识资料、对话式排查和三维结构示意。当前持续开发主线为 **V4**，具体版本以 `package.json` 为准。

[开发站](https://agridx-dev-preview.z3464715478.chatgpt.site/) · [快速开始](#快速开始) · [项目结构](#项目结构) · [贡献指南](CONTRIBUTING.md) · [更新日志](CHANGELOG.md)

开发版清单、建立者、建立时间、初始版本与自动同步方式见[开发站登记](docs/deployment/development-sites.md)。[V4 独立开发站](https://agridx-v4-development.orangeglade33.chatgpt.site)默认仅所有者可访问；原公开开发站继续保留。

版本历史功能：新旧界面页脚的“更新记录”进入 `/#/version-history`；详细内容由 `CHANGELOG.md` 在构建时自动生成，当前构建版本读取 `package.json`，提交沿用构建标识。缺失历史证据显示“未记录”，不把日志日期当作上线日期。维护流程见[版本历史记录说明](docs/version-history.md)。功能随本批3.11.0交付；实际发布状态以对应PR和部署验收为准。

## 功能入口与使用范围

| 功能 | 页面路径 | 当前能力与边界 |
| --- | --- | --- |
| 大厅 | `/#/` | 三维园区与装备陈列；8个结构示意、12条设备记录均为示例，不是在线实车机队 |
| 农机知识 | `/#/knowledge` | 按品牌、型号、组件和零部件查阅资料，保留来源、页码、核验状态与适用范围 |
| 智能诊断 | `/#/chat` | 根据现象追问、检索和组织排查建议；外部模型是否可用取决于运行环境配置与实际调用 |
| 模型工坊 | `/#/models` | 柴油拖拉机、鸿鹄T70和本地GLB交互；模型表示结构示意，不等于精确实车或数字孪生 |
| 故障检测演示 | `/#/fault-detection` | 模拟参数、趋势及检查记录联动，明确标注未连接实车 |
| 版本历史 | `/#/version-history` | 从CHANGELOG生成版本记录；日志日期与构建提交不等于正式站已部署 |

页面路径中的 `#` 必须保留。开发站使用现有公开入口；本地服务默认地址为 `http://localhost:3000`。

模型工坊的仿真监测依赖对应后端服务。静态开发预览未提供该服务时显示不可用，不生成替代读数；仿真不作为实车证据进入诊断记忆，详见[遥测协议](docs/telemetry.md)。大厅装备的原始示例范围见[装备陈列说明](docs/campus-equipment-merge.md)。

## Agent 设计与参与入口

项目采用 **LLM + Memory（长期/短期记忆）+ Planner（规划）+ Tool Use（工具调用）= AI Agent** 的共同设计口径。现有诊断Agent使用规则协调、知识检索、模型补充和设备/会话记忆；后续围绕执行反馈、记忆分层、状态恢复与结果验证逐步完善。

参与者先读[贡献指南](CONTRIBUTING.md)与[Agent设计与参与路线](docs/agent-development.md)，再按任务进入[架构](docs/architecture.md)、[诊断规划](docs/diagnosis-router.md)或[记忆](docs/diagnostic-memory.md)。指南区分已有能力与后续要求；ADK、MCP和多Agent是可选实现方式。提交时按[PR模板](.github/pull_request_template.md)说明对应要素、完成条件和真实验证。

## 版本说明（参与者先看）

本仓库已由 AgriDx-v3 改名为 **AgriDx**，统一存放所有版本。旧地址会自动跳转，建议更新本地远程地址：
`git remote set-url origin https://github.com/srt2777/AgriDx.git`

| 版本 | 位置 | 状态 |
|---|---|---|
| **V4（持续迭代）** | `main` 分支 | 当前开发主线；版本以 `package.json` 为准，通过 PR 审阅与检查后更新 |
| V3 归档快照 | 分支 `archive/v3` | 历史归档，只读 |
| V2 | 分支 `archive/v2` | 原 Changjie29/AgriDx-v2 的完整代码与历史，只读 |
| V1 | 分支 `archive/v1` | 原 Changjie29/AgriDx-v1 的完整代码与历史，只读 |

查看旧版本：`git checkout archive/v3`、`git checkout archive/v2`、`git checkout archive/v1`
旧版本只做查阅，不要在 `archive/*` 分支上提交改动；如需修复旧版本，请先在 Issue 中说明。


知识资料累计[11460条](docs/knowledge-library.md)：5460条来源归档与[6000条通识学习资料](docs/tractor-knowledge/overview.md)已放进网页同一个知识目录，可共同搜索正文、按类型筛选和分页浏览。两批原编号、唯一Markdown正文、来源和核验状态保留；全部条目已接入检索问答。通识资料用于原理解释与待验证分析，仍保留学习用途及核验状态；具体机型维修操作与参数遵守原有手册证据规则。

当前项目版本：**4.0.12**。开发版与正式版共用全局深浅主题，首次跟随系统；导航中的主题按钮可手动切换，跨页面、新旧版、刷新与同源标签页保持一致。开发网关支持首屏主题初始化脚本，避免最新主干页面及控制台因脚本被拦截而空白。v3初始版本同步自AgriDx-v2的2.4.5已提交基线，继续采用现有React/Vite/Express架构。每次更新的版本、改动和验证结果见[版本日志](CHANGELOG.md)。网站页脚展示构建版本，`/api/health`返回运行服务版本；线上是否更新以部署及实际验收为准。

界面设计、参考与验收截图统一见 **[UI 专区](ui/README.md)**；旧版公共界面实现位于 [`src/ui/`](src/ui/)。

知识库新增[图谱工作台](docs/knowledge-graph.md)：按品牌、机型、系统和零件探索现有归档，联动原始知识卡、来源与核验状态。入口 `/#/knowledge?view=graph`。


开发与正式网页现在会自动检测并安全加载main已发布的新版本，保留知识筛选；有未保存输入、正在诊断或本地模型文件时延期，安全后自动继续，无需再次向助手发话。机制及首次旧页面载入边界见[自动加载说明](docs/deployment/automatic-client-update.md)。

历史记录：[ 3.5.0历史整合规模（保留当时记录） ](docs/history/readme-background.md#历史记录-1)。

知识目录的kbVersion现随共享快照整体切换，成功重载更新、失败保留旧版，开发预览与服务端共用同一版本元数据；详情与回归边界见[快照版次架构维护](docs/architecture-snapshot-version.md)。

诊断路由复用一次检索并按风险与证据选择回答；检索、目录和健康统计共享可整体切换的只读快照，重载失败保留旧数据。知识页新增通用运行表现入口；离线`npm run knowledge:quality`和`npm run knowledge:dedup`生成规则及语义候选报告，候选保持待人工复核，不自动改写知识或进入在线诊断请求。整合说明和验收见[本轮记录](docs/integration/20261016-all-open-prs.md)。

历史编号曾按2026-10-13约定协调：两批累计800条知识扩充合并为3.3.0，功能整合由原3.5.0调整为3.4.0；主题修复与开发网关修复由原3.5.1、3.5.2对应协调为3.4.1、3.4.2。用户2026-10-25已明确授权沿当前4.x主线继续，后续按最终改动规模及[自动版本规则](docs/version-policy.md)在 **4.x.x** 内递进；5.0.0及更高主版本仍需用户明确授权，具体递进和同批去重见版本规则。此前上限与历史验证输出保留当时含义。

v3由Changjie29与另外三位协作者共同改进，协作流程见[贡献指南](CONTRIBUTING.md)。初始化来源为v2提交[`38f5bbb`](https://github.com/Changjie29/AgriDx-v2/commit/38f5bbba0f484505525a69ebbe394cc6c8601ee0)，将v3原基线之后的液态玻璃界面改动与最终验证记录同步到本仓库。保留v2的历史、资源署名和知识来源；未合并的[PR #1](https://github.com/Changjie29/AgriDx-v3/pull/1)独立改动不纳入本次初始化。

国内资料新增按“使用/购机证据 → 报告所列型号 → 精确说明书 → 审校与检索”整理，见[型号采集优先级](知识库/整理后的知识库/农用拖拉机知识库/采集优先级/README.md)。现有3篇第三方报告、21条证据、20种型号/排放写法候选，均完成定向查找；新增6M-1654(G4)/1854(G4)/2104(G4)中国版手册，报告裸6M-2104与本册后缀及实车版本的关系仍待核实，不能据此给出全国保有量排名。部分省厅正文与吉林公开搜索现已可读；总量背景、历史/展示实例和当前仍失败入口分别归档，研究资料不参与维修检索。

面向农业机械装备的智能故障诊断 Agent。基于本地 Markdown 知识库 + 大语言模型，为拖拉机、联合收割机等农机提供结构化的故障原因分析、排查步骤与安全维修建议。

> 当前版本支持**本地知识库 + LLM 对话、四级资料浏览与三维结构示意**。未接入传感器/麦克风/故障视觉识别/CAN 总线；照片可在本地整理与预览；新增[开源 img2threejs 建模桥接](docs/integrations/img2threejs.md)，配置独立建模进程后可上传生成与自动预览，真实生成与线上 worker 尚未验收。尚未接入结构仿真或数字孪生。

现有资料的结构、数量、适用限制与来源导航见[知识库概要](知识库/现有知识库概要.md)与[机器总览](知识库/总览数据.json)。[两页PDF](知识库/可视化/现有知识库概要.pdf)及PNG/SVG保留2026-10-13的历史规模，不作为本轮数量依据。

## 新版可漫游三维园区

默认首页以原创三维园区连接农机知识、智能诊断与模型工坊。点击“开始漫游”后，用 WASD / 方向键驾驶拖拉机，空格刹车，Esc 返回总览；手机提供方向触控。总览可拖动环视、滚轮缩放，展区与小地图支持自动驶向目标，也可直接进入对应功能。

园区使用现有 Three.js / React Three Fiber，不新增建模插件或依赖。地面反射、金属材质、阴影、悬浮标识和跟随镜头构成空间层次；静止时按需渲染，减少动态偏好下关闭镜头过渡。保留新旧版切换、双语、工学院官网徽章入口及现有知识、诊断和模型路由。WebGL 不可用时仍可使用直接功能入口。

资料概览与设备目录读取 `/api/knowledge/catalog`，可按品牌 / 型号搜索并跳转；加载或失败时不填入推测数量，保留型号 / 系列 / 待核实的范围。模型和园区均为结构示意。GitHub 案例、分层可编辑 SVG、预览与验证见 [三维园区设计说明](docs/design/2026-10-11-spatial-campus/README.md)；此前 3.0.2 大屏设计保留在 [历史设计记录](docs/design/2026-10-11-digital-exhibition/README.md)。该设计记录保存时仅提交 GitHub PR、未部署服务器；当前发布状态另以实际构建与验收为准。

新版与旧版共用 **Material You 风格液态玻璃**：采用 [Google Material Color Utilities](https://github.com/material-foundation/material-color-utilities) 生成的浅/深色语义色阶，使用柔和选中容器、圆润控件和有边界的涟漪反馈。项目内原生 SVG 光学层直接采样页面与 WebGL 背景，保留按压折射与回弹，文字独立保持清晰；已移除原 liquid-glass-react 运行依赖。Chromium 使用实时折射，其他浏览器及减少动态采用雾面，减少透明度/高对比采用实色；配色工具只在维护时运行。此前实现与三维光学验证保留在[历史实时玻璃记录](docs/design/2026-10-13-live-liquid-glass/README.md)，当前改动见[Material You 设计记录](docs/design/2026-10-13-material-you-glass/README.md)。

首屏不再等待外部字体服务，导航和功能入口先显示，三维视图随后按需加载。二级页面在意图明确时预热，内容加载期间保留导航；短期复用已验证的目录数据，资料展开或答复显示时才加载正文解析器。性能对比和线上 CDN 排查见 [加载与导航优化记录](docs/performance/2026-10-12-loading-navigation.md)。

导航、版本切换、模型视角和展区选中态采用连续移动的胶囊，按压时有局部高光与回弹；菜单及说明面板从操作侧展开，减少动态设置下直接切换。实现参考及动效预览见 [WWDC 交互记录](docs/design/2026-10-12-wwdc-fluid-interaction/README.md)。

## 模型工坊部件交互

示意拖拉机提供七组可键盘/触屏选择的部件热点；点击模型或侧栏同步选中部件、显示中英文结构说明并聚焦。再次聚焦、四个视角、返回整机与展开视图共享基于实际几何包围盒的镜头控制；拖拽可中断过渡，布局动画完成后不抢回用户视角。

选中描边仅在需要时延迟加载，保持原有 ACES 色调。手机默认关闭描边，可手动开启；关闭热点仍能点选模型及使用侧栏。暂停/减少动态时按需渲染，中文说明采用 DOM，不下载三维字体。导入 GLB 保持整机预览，不推断部件名称、尺寸或真实维修关系。实现与验证范围见 [模型部件交互记录](docs/design/2026-10-13-model-interactions/README.md)。

## 拖拉机通用知识框架

知识页可先按37类运行表现浏览15个系统、36项性能目标及六阶段资料矩阵，再选择品牌、完整型号、组件和零部件读取匹配的原证据。显式驾驶室/驱动/排放条件仅召回登记了相同元数据的条目；无资料的格子保留待补。46条通用关联复用原知识卡，不额外增加归档；该历史整合批次当时为27来源、4853条；矩阵表示资料线索，不代表整机性能已验证全覆盖。详见[通用框架说明](知识库/整理后的知识库/农用拖拉机知识库/通用框架说明.md)。

## 诊断模式与记忆

诊断工作台可选自动协调、仅本地知识库和 AI 辅助，服务端 `ALLOW_EXTERNAL_AI=false` 或 `DIAGNOSIS_MODE=knowledge_only` 优先。3.5.0 在一次检索后用本地规则评估原始相关性、问题覆盖、机型适用、文献核对及维修风险；充分依据直接回答，其他安全问题按需调用一次 AI 生成。高风险限制具体操作，必要信息缺失先追问；外部模型失败保留来源回退。本地摘要可展开原文、来源和适用限制，待核验或适用不明资料只作参考。配置、评分边界、性能对比和实际请求链路见[诊断路由说明](docs/diagnosis-router.md)。该历史迭代在记录时未部署网站；当前发布状态以实际构建与验收为准。

设备档案、对话及用户检查进度可恢复、新建、清空和删除。同一浏览器使用匿名身份，Express 数据默认保存在运行用户的 `~/.agridx/memory.sqlite`；可用 `MEMORY_DB_PATH` 指向独立持久目录。开发预览只在当前浏览器保存，清除网站数据会删除预览记录。使用与限制见[诊断记忆说明](docs/diagnostic-memory.md)。

## 开发版内部数据

独立开发站新增[开发控制台](https://agridx-dev-preview.z3464715478.chatgpt.site/#/developer)，查看匿名访问、当前提问及诊断结果、GitHub 主干和构建状态。内部接口须验证 GitHub 仓库管理员/维护者身份；普通访问继续公开，腾讯记录未接入。数据从功能上线后采集，保存最近30天；入口存储迁移与线上验证独立于前端自动构建，见[控制台说明](docs/deployment/dev-console.md)。3.20.0 增加 DeepSeek、Gemini 和 OpenAI 兼容接口配置、连接测试、管理员调试及公开诊断调用控制，使用和部署边界见[API 接入说明](docs/deployment/dev-ai-console.md)。

## 腾讯云现有服务器更新

以下为历史方案；本轮不操作腾讯服务器，当前实际部署状态须另行核实。

历史记录：[ 历史部署与知识扩充记录（2026年10月） ](docs/history/readme-background.md#历史记录-2)。

## 技术栈

- **前端**：React 19 + Vite + TypeScript + Tailwind CSS + React Router + React Three Fiber
- **后端**：Node.js + Express + tsx（ESM）
- **LLM**：Gemini（默认 `gemini-3.8-flash`，可配置）/ DeepSeek（默认 `deepseek-v4-flash`，可配置），OpenAI 兼容协议
- **知识库**：5460 条来源归档 + 6000 条通识学习资料，共11460条；另有信息收集提示。按章节提取与关键词检索，资料类型、适用范围及核验状态分别保留。
- **3D**：Three.js / React Three Fiber，程序化 RoomEnvironment 光照，零 HDR 网络请求

## 快速开始

### 环境要求

- Node.js ≥ 22.19.0（建议24 LTS）
- npm ≥ 10；本地推荐与 CI 使用 `.node-version` 中的 Node 24

在包含 `package.json` 的项目根目录执行下列命令。尚未取得代码时，先运行：

```bash
git clone https://github.com/srt2777/AgriDx.git
cd AgriDx
```

### 1. 安装依赖

```bash
npm ci
```

若本机 npm 镜像缺少平台包，可仅对本次安装使用 `npm ci --registry=https://registry.npmjs.org`；无需修改全局 npm 配置。

### 2. 可选：配置外部模型

编辑 `server/.env`（**该文件永不提交到 Git**，已在 `.gitignore` 中排除）：

```env
# Gemini（服务端 API Key；auto 模式配置后优先使用）
GEMINI_API_KEY=your_gemini_api_key

# DeepSeek（服务端 API Key；Gemini 不可用时回退）
DEEPSEEK_API_KEY=your_deepseek_api_key

# 沿用双模型；显式优先可选 deepseek / gemini
LLM_PROVIDER=auto
# GEMINI_MODEL=gemini-3.8-flash
# DEEPSEEK_MODEL=deepseek-v4-flash

# 服务端口（默认 3000，前后端共用）
PORT=3000

# 可选：代理（写在这里也能被识别；服务启动时先加载本文件再读代理变量）
# HTTPS_PROXY=http://127.0.0.1:7890
# HTTP_PROXY=http://127.0.0.1:7890
```

> 两个 Key 都配可保留双模型回退；只配一个也能运行。auto 模式沿用现有 Gemini 优先策略。
> 不配置 key 也可运行本地知识检索；外部模型未配置或调用失败时使用本地知识库回复。
> Node 服务先加载根目录 `.env` 和 `server/.env`，再创建模型实例；Sites 生产密钥需在对应项目的运行环境中配置，不能依赖本地文件。健康接口的已配置状态只表示 Key 已设置，调用结果才证明模型可用。

### 3. 启动开发服务

```bash
npm run dev
```

- 网站及 API：http://localhost:3000
- 对话页：http://localhost:3000/#/chat
- 四级农机知识：http://localhost:3000/#/knowledge
- 模型工坊：http://localhost:3000/#/models
- 健康检查：http://localhost:3000/api/health

### Windows PowerShell

在同一个项目根目录依次运行：

```powershell
npm.cmd ci
npm.cmd run dev
```

提交改动前，另开终端运行 `npm.cmd run verify` 完成检查。

启动后打开 `http://localhost:3000`，保持服务终端运行。未配置模型密钥时仍可先浏览资料与使用本地检索。

### 4. 检索测试 / 类型检查 / Lint / 构建

```bash
npm run verify       # 版本、前后端类型、测试、Lint 与完整构建
# 可按需单独运行：
npm test             # 知识、诊断、API、会话与维护脚本回归
npm run typecheck    # 前端、Vite 配置与后端类型
npm run lint
npm run build        # 前端与后端完整构建
npm run build:client # 单独构建前端
npm run build:server # 单独编译后端
```

### 离线知识质量检查

复用既有`知识库/工具/校验索引.py`生成只读规则报告；Python 3.10+，PDF页数检查仍需Poppler的`pdfinfo`或PyMuPDF。默认不保存文件，不修改知识正文、索引或核验状态，也不调用外部AI。JSON与Markdown报告、增量缓存均需显式指定：

```bash
npm run knowledge:quality -- --report server/data/knowledge-quality/report.json --markdown server/data/knowledge-quality/report.md --cache server/data/knowledge-quality/cache.json
```

重复执行会复用未变化记录的规则结果；`--full`强制重检。任务在独立Python进程中运行，不接入诊断请求。状态`unspecified`表示现有严格解析器无法分类，不等于未人工核对。规则、后台运行、真实统计及语义去重接口见[知识质量检查说明](docs/knowledge-quality.md)。

3.4.10增量去重入口：`npm run knowledge:dedup`。默认只读且无模型时保留规则模式；需要持久化时显式指定报告/缓存路径。候选全部待审，不自动合并、删除或改验证状态；不进入诊断请求。模型比较、离线部署、断点恢复和评估限制见[增量语义去重说明](docs/knowledge-semantic.md)。

新版大厅与功能页使用统一导航，位置、顺序和返回路径保持一致；研究依据页面及入口已移除。见[新版页面导航与层级](docs/modern-navigation.md)。

## 独立开发预览

独立开发网址：[打开开发预览](https://agridx-dev-preview.z3464715478.chatgpt.site)。用户2026-10-12最新确认：任何链接持有者可匿名访问，使用现有 GitHub 账号管理；跟随 `main` 主干自动验证、构建并更新，通常约需2分钟，个人分支不发布。与腾讯和原 Sites 发布独立。支持首页、模型、资料和本地知识诊断。3.20.0 新增[控制台 API 接入](docs/deployment/dev-ai-console.md)，网关迁移及加密配置部署后，可由管理员开启全体访客的 AI 辅助；实际发布状态见该说明。管理、更新和验证方式见[开发预览说明](docs/deployment/dev-preview.md)。

## 生产部署与验收

以下是生产环境运行方法，不代表已执行部署。后端编译产物用于编译验证，生产入口仍为 `tsx server.ts`。当前本线程仅跟进开发站；腾讯服务器和正式站不操作，历史发布授权与验收记录保留原日期。

在仓库根目录使用Node.js ≥ 22.19.0（建议24 LTS）。先安装完整依赖并构建前端，再仅保留运行依赖：

```bash
npm install --include=dev
npm run build
npm prune --omit=dev
NODE_ENV=production PORT=3000 npm start
```

`npm start`使用运行依赖中的`tsx`执行TypeScript服务入口。启动时必须设置`NODE_ENV=production`，否则会进入需要Vite的开发模式；若主机已固定生产模式，可在进程管理器配置该变量。配置API Key请使用服务器环境变量或既有`server/.env`，不要写入前端或Git。

部署须包含`dist/`、`server.ts`、`server/`、`shared/`、`package.json`、完整`知识库/`及`public/`，并从仓库根启动；仅上传`dist/`不能提供API和归档检索。按现有主机/平台配置进程管理、端口与反向代理。

发布后实际检查`/api/health`的版本和归档条目数，以及`/`、`/#/chat`、JS/CSS资源和模型接口；再核对有资料机型的来源回答、未知/冲突型号的资料不足行为。GitHub推送、本地生产运行、线上发布分别验收。历史隔离生产验收见[部署前记录](docs/deployment/2026-10-04-production-validation.md)。2026-10-04的历史线上核验确认2.2.2、20来源/165条/174片段及型号过滤；2.2.3起改用HashRouter，对话页地址为`/#/chat`，静态托管无需SPA重写即可直接打开/刷新。干净路径`/chat`仍依赖托管层重定向，见[线上验收记录](docs/deployment/2026-10-04-live-validation.md)。

## LLM 选择策略

后端 `server/llm/router.ts` 保留双模型顺序回退，并可通过 `LLM_PROVIDER` 指定优先顺序：

| 配置 | 主选 | 回退 |
| --- | --- | --- |
| `auto`（默认），Gemini Key 已设置 | Gemini | DeepSeek |
| `auto`，仅 DeepSeek Key 已设置 | DeepSeek | Gemini（需已设置 Key） |
| `deepseek` / `gemini` | 指定模型；缺 Key 时改用另一家 | 另一家已配置模型 |

主选网络、超时、鉴权、限流或无效响应失败时尝试备用。两家均不可用时返回本地资料，并在回答和界面标明降级；模型未配置与调用失败分别标明。Gemini 20 秒、DeepSeek 20 秒超时包含响应正文读取，前端等待上限 60 秒。`.env.example` 提供模型及 DeepSeek 兼容服务地址选项。无效优先配置在健康接口显示 `configValid=false`，不会静默选择另一种策略。

## RAG 工作流

1. 启动时扫描 `server/knowledge/` 下的通用 `.md` 文件（跳过 `00_说明/`），按 `## ` 二级标题切块；同时读取 `知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl`，按条目编号提取对应 Markdown 章节。目前为 9 个信息收集片段 + 5460 条归档条目，另加载6000条通识正文，共11469个检索片段（11460条知识与9个信息收集片段）。通识用于原理解释与待验证分析；信息收集片段只帮助补充机型与现象。机型维修操作与参数仍需匹配手册证据。
2. 从最近用户消息重建故障与补充信息，短品牌／型号／工况追问保留原问题，明确换机清理旧身份与配置；独立新问题替换旧症状。检索结合 `machineType`、`brand`、`model`，也识别问题中可辨认的品牌与型号，过滤不相关品牌／型号及非拖拉机的归档条目；再对问题做中文 2-gram + 英文 token 化，扩展启动、无力、提升、异响、过热、制动、定位等常见口语同义症状，按关键词重叠打分，标题命中权重 ×3。说明概述不参与诊断召回，同义扩展仍须覆盖实际症状。配置专用条目使用`entries.models`限定来源型号子集，并要求精确型号；未填该字段的条目沿用整册范围。明确CAB/ROPS或两驱/四驱与已登记范围冲突时排除条目。品牌或型号匹配不代表市场、排放、其他配置及版本已经确认。
3. 按配置取相关片段（问答默认top-5，检索函数默认top-6），匹配手册优先并保留相关通识；在字符预算内选择完整正文与适用边界，不截断片段，拼入后端独占的system prompt。
4. system prompt 硬性要求：
   - 禁止编造压力/温度/电压/扭矩/故障码/零件号/油液型号等参数；
   - 资料不足时是否调用已配置的 LLM，由服务端配置、证据与风险路由共同决定；允许补充时提供明确标注的【通用分析（待验证）】、低风险观察与重点追问，不能凭空补机型参数或专用维修步骤；
   - 归档事实放在【手册依据】，模型一般原理分析另列；通用信息收集清单不作为手册证据；
   - 已填写身份与用户描述冲突时先确认对象，不能继续套用任一机型资料；
   - 用户用什么语言问，就用什么语言答。
5. 前端只发 user/assistant 历史（保留最近 20 条消息，再附加当前问题），不发 system message——system prompt 由后端独占。
6. 归档条目保留来源编号、原文定位、来源链接、文档适用范围及核对状态，供外部模型和本地回复引用。仅索引中的编号条目参与检索；归档 README、待补资料、原始 HTML/PDF 不作为诊断知识自动加载。

例如：填写「拖拉机／久保田／LX2620」，询问「发动机启动困难」，可检索 `KB-LX2620-003`。问题改为「东方红LF1504启动困难」而仍保留久保田字段时，停止召回并要求确认咨询对象；问题中的明确品牌、完整型号或农机类型不能被旧字段覆盖。命中归档条目时优先使用对应资料；仅命中通用内容时说明资料不足，不把信息收集清单当维修依据。LLM 可另列通用待验证分析并主动追问，具体参数和专用操作仍须匹配手册；没有配置 Key 时只能提供本地资料和信息收集。填写 `WORKMASTER25S` 时，不会套用仅适用于 `WORKMASTER25` 的条目。未确认市场或配置时仍需依据条目的适用限制核实。

## 知识库目录

```
server/knowledge/
├── 00_说明/              # 目录约定与维护说明（不参与检索）
├── 01_通用原理/          # 发动机/冷却/润滑/液压/电气/传动/制动/转向
├── 02_农机类型/          # 拖拉机/收割机/插秧机/植保机...
├── 03_新能源农机/        # 电动/混动农机
├── 04_智能农机/          # 无人化/自动驾驶
├── 05_故障代码/          # 各品牌故障码表
├── 06_品牌资料/          # 东方红/雷沃/中联/久保田/约翰迪尔...
├── 07_具体型号/          # 具体型号维修手册
└── 99_待整理/            # 未分类资料
```

归档知识通过 `知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl` 指向对应编号章节，无需复制到上述目录。修改索引或知识文档后需重启服务重新加载；新增条目需保留原文定位、来源编号及适用限制。人读入口见[知识库总览](知识库/README.md)，后续新增遵守[整理规范](知识库/条目整理规范.md)，使用[模板](知识库/模板/新资料模板.md)并运行`python3 知识库/工具/校验索引.py`。明确排放阶段与用户问题冲突时不套用旧手册，未取得正文的候选只保留采集记录。未来自动解析 PDF/Word/Excel/TXT 时，再在 `server/knowledge/retriever.ts` 之上增加解析层。

## 项目结构

```text
AgriDx/
├── src/                 # React 页面、组件与样式
│   ├── pages/           # 页面布局与路由视图
│   ├── features/chat/   # 会话、历史存储、请求与健康状态
│   ├── hooks/           # 语言、响应式与知识目录 hooks
│   └── lib/             # 共用 API 客户端与界面工具
├── server/              # HTTP 装配、路由、诊断用例、知识与 LLM
├── shared/              # 前后端协议类型、知识目录与能力声明
├── 知识库/              # 归档原文、索引、来源与整理工具
├── public/              # 模型与静态资源，保留原署名
├── scripts/             # 跨平台检查、构建、测试与工作分支同步
├── tests/               # 诊断、知识边界、API、会话与维护脚本回归
├── docs/architecture.md # 模块职责、请求链路与维护规则
├── .github/workflows/ci.yml # Ubuntu / Windows 完整检查，不部署
├── .node-version        # 本地推荐与 CI 的 Node 24
├── server.ts            # 统一开发/生产入口；生产仍使用 tsx
└── CONTRIBUTING.md      # 四人协作、版本与 PR 流程
```

模块职责与开发入口见[架构说明](docs/architecture.md)。单个检查仍可独立执行；合入前推荐使用 `npm run verify`，统一验证版本元数据、前后端与 Vite 配置类型、回归测试、Lint 和完整构建。Windows PowerShell 使用 `npm.cmd`。

`npm run sync` 只推送当前工作分支中已经提交的内容；先自行提交本轮相关文件，保持工作区干净。它拒绝 `main`、`master`、远端默认分支与 detached HEAD，不附带标签、不自动提交或部署。


## Git 分支

- **`main`**：共同维护的稳定主线。协作者从最新`main`创建自己的功能或修复分支，通过PR说明改动与验证结果，审阅后合入。
- 人工开发可使用`feature/<用户名>/<主题>`或`fix/<用户名>/<主题>`，Codex任务默认使用`codex/`前缀。提交前刷新远端并检查差异，按新旧版本与任务意图进行更新性覆盖或合并，保留无关成果；合并完成后可删除对应任务分支。
- 修改从最新 `main` 创建任务分支，通过 PR 审阅与检查后合入。个人分支与 PR 不发布开发站；`main` 合入后由 `Development preview` 自动验证、构建和更新。开发站与正式站分别验收，详见[开发预览说明](docs/deployment/dev-preview.md)。

## API

### `GET /api/health`

以下保留历史响应示例用于说明字段结构；当前版本、提交与知识统计以实际接口结果为准。

```json
{ "ok": true, "version": "3.4.12", "timestamp": "...", "knowledge": { "chunks": 4262, "archivedEntries": 4253 } }
```

### `POST /api/chat`

请求体（前端只发 user/assistant；system 由后端拼）：

```json
{
  "messages": [
    { "role": "user", "content": "拖拉机水温过高怎么办？" }
  ],
  "machineType": "拖拉机",
  "brand": "",
  "model": ""
}
```

响应（OpenAI 兼容 + 附加字段）：

```json
{
  "choices": [{ "message": { "role": "assistant", "content": "..." } }],
  "model": "deepseek-v4-flash",
  "provider": "deepseek",
  "fellBack": false,
  "knowledgeChunks": 2,
  "answerMode": "knowledge-grounded",
  "knowledgeSources": [{ "entryId": "...", "sourceId": "...", "locator": "..." }]
}
```

本地知识库回复沿用相同的 `choices` 结构，`provider` 为 `knowledge-base`、`model` 为 `kb-rag-engine (本地知识引擎)`、`fellBack` 为 `true`；`knowledgeChunks` 为本次命中的片段数；`knowledgeSources` 返回来源编号、章节、版本与定位。`answerMode` 区分 `knowledge-grounded`（有归档技术资料）、`general-guidance`（无归档技术依据的模型通用建议）、`local-evidence`（本地资料）；该标记不等于自动验证了模型每句话。`fallbackReason` 区分 `not_configured` 与 `provider_unavailable`。`/api/health.llm` 返回供应商、模型和 Key 是否已设置，不返回密钥或宣称连接已通过。

服务无法生成回复时返回 HTTP 502：

```json
{ "error": "智能诊断服务暂时无法连接，请稍后重试。", "code": "llm_unavailable" }
```

## 安全

- 本地API Key保存在服务端环境变量、根目录 `.env` 或 `server/.env`；不得写入前端代码、构建产物或Git。开发控制台的独立配置与存储边界见[API接入说明](docs/deployment/dev-ai-console.md)。
- 当前 CORS 沿用开放源配置；来源限制须结合实际部署环境另行配置。
- 检测到代理变量时，外部 LLM 请求经 `undici` 的 `ProxyAgent`；未配置代理时使用直连。
- `/api/chat` 每 IP 每分钟 30 次限流。
- 错误日志只打印 provider 名与错误类别，绝不打印 key。
- Markdown 渲染使用 `react-markdown`（默认不执行 HTML/JS）。

## 当前已实现 vs 规划中

**已实现**

- 本地 Markdown 知识库：4877条来源归档、6000条通识学习资料，支持品牌／型号过滤与关键词检索 RAG
- Gemini / DeepSeek 双 Provider，可选优先顺序 + 失败回退 + 安全配置状态
- 后端独占 system prompt，强制结构化输出与禁止编造参数
- 四级农机知识浏览、组件资料缺口、原文/版次/页码/适用范围；可将机型及问题预填到诊断页
- 原创分组件拖拉机结构示意（拖拽/缩放/自转/暂停/四种视角/结构展开），不代表实车CAD
- 模型工坊保留鸿鹄 T70 / 柴油部件机与本地 GLB 导入，新增 img2threejs 异步建模桥接；选择照片时不上传，点击生成才发送到已配置的独立 worker，成功后自动预览，未配置时明确禁用。见[运行条件与验收边界](docs/integrations/img2threejs.md)
- 中英双语界面、跟随系统的明暗主题
- 对话历史本地持久化、Markdown 渲染、快捷提问
- 农机类型/品牌/型号可选选择器，用于增强检索
- 安全头、限流、优雅退出与错误脱敏；当前Express CORS为开放来源配置，来源限制需结合实际部署环境配置

### 本阶段九项重点与第一轮进展

历史记录：[ 展开九项建设目标与第一轮历史进展 ](docs/history/readme-background.md#历史记录-3)。

## GitHub保存与部署约定

当前代码主线为 [srt2777/AgriDx](https://github.com/srt2777/AgriDx) 的 `main`。分支与 PR 用于开发和审阅，合入后由现有流程更新开发站；本线程不操作腾讯服务器或正式站。GitHub 合入、构建发布和线上验收分别记录。

历史记录：[ 历史保存与部署约定（保留当时日期与原始出处） ](docs/history/readme-background.md#历史记录-4)。

---

© 2026 耕知·耘诊 · 南京农业大学

## 历史记录

[2026-09-26 对话体验优化](docs/history/readme-background.md#历史记录-5)。
