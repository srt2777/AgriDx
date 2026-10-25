# 新版界面收敛整理 · 方案 A（3.19.2）

基线：`2021416`（3.19.1）。本批仅调整新版外观与外壳布局；路由、接口、知识数据、诊断逻辑、版本规则及三维模型几何不变。

## 问题与处理

| 问题 | 修改 |
| --- | --- |
| 字号、圆角、颜色和动效缺少收口 | 独立 `src/new-version-unify.css` 最后引入；规则限定 `.new-version-shell[data-ui-version="new"]`；12/14/16/20/32px、6/10/16/999px、两档阴影；正文 14px，辅助 12px；过渡沿用 motion-tokens。 |
| 版心不一致、诊断贴边 | 顶栏、导航和内容共用 1360px 版心；桌面最少 24px、手机 16px；导航成为同宽横向栏，窄屏换行；诊断容器圆角完整。404 保留既有独立页面，只统一版心。 |
| 顶栏与状态条重复 | 搜索、版本、主题、语言保留；演示说明与快捷键帮助放进一个图标入口，支持 Escape/外部点击关闭；底部只保留版本记录，当前位置保留读屏文本。 |
| 强调色、角标、短线和发光叠加 | 新版强调色统一青蓝，金色限于品牌与版本切换；语义色复用既有 success/warning/destructive。去角标和卡片顶端短线，麦穗仅保留主标题一处并改为青蓝；发光限选中或聚焦。 |
| 内容区玻璃太多 | 卡片、诊断面板、表单、列表使用实色和细边框，禁用折射/磨砂装饰；顶栏、抽屉及浮层保留玻璃；阴影只用两档令牌。 |
| 知识统计层级与旧绿色 | 统计数字统一 32px、辅助说明 12px；taxonomy/knowledge-engine 将旧色改为新版令牌，旧色作为原值回退，因此旧版保持不变；taxonomy 排版恢复为可读多行。`catalog-distributions.css` 当前已使用变量，无须再次改写。 |
| 诊断控件粗糙 | 发送按钮 48px，启用时为主色、禁用时为实色边框；select 统一高度、边框、背景与字号；输入框只保留单边框，聚焦改边框色且无阴影；清除嵌套玻璃框与角标，右侧标题留出空间。 |
| 园区过曝及标签压模型 | 仅将新版 renderer 曝光设为 0.8，将装备分区标签移入现有详情浮层标题区，去掉模型上方的重复标签；不改灯光逻辑、模型顶点、尺寸或业务数据。 |
| 模型工坊加载和说明 | 现代工坊两层加载入口共用静态骨架，有状态文本；旧版 SceneLoading 不动。正文 14px/1.5，按钮组对齐，工坊 HUD 白字与金色标签改为主题令牌；部件抽屉及无 WebGL 列表继续可用。 |
| 安全清理 | 删除重复深色诊断背景和冗余规则；移除新版外壳和园区非必要的字体 `!important`；新文件无 `!important`、无十六进制色。共享的强制色彩、减少透明及指针穿透保护保持。 |

## 文件范围

- 外壳与令牌：`src/index.tsx`、`src/new-version-unify.css`、`src/components/NewVersionShell.tsx`、`src/components/new-version-shell.css`。
- 帮助与状态：`src/components/DemoNote.tsx`、`src/components/NewVersionDelight.tsx`、`src/components/SiteStatusBar.tsx`。
- 工坊：`src/components/ModelLoading.tsx`、`src/components/parts-tractor/PartsStudio.tsx`、`src/pages/ModelPage/ModelPage.tsx`。
- 园区：`src/pages/ExhibitionPage/ExhibitionWorld.tsx`、`src/pages/ExhibitionPage/exhibition.css`、`src/features/campus-equipment/CampusEquipment.tsx`。
- 知识样式：`src/pages/KnowledgePage/knowledge-taxonomy.css`、`src/pages/KnowledgePage/knowledge-engine.css`。
- 版本和记录：`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md`、`version-batches.json`、本报告及截图总览。

## 验证

- `npm run verify` 通过：598 项测试，596 通过、2 跳过、0 失败；版本/知识库一致性、前后端类型、lint、完整构建通过。已有 `src/components/ui/button.tsx` 的 Fast Refresh 警告保留。
- 最后调整后，园区/导航相关 9 项测试、类型检查、lint 和再次 `npm run build` 均通过；工坊正文在深浅底上的对比度分别约 13.70:1 / 12.94:1。`git diff --check` 通过。
- 中文改前 56 张；改后中英文分别覆盖 4 宽度（1440/1920/1024/390）× 2 主题 × 7 页面：园区、既有展厅入口、知识、工坊、诊断、404、版本记录。
- 自动记录文档宽度、版心坐标和可见正文/辅助字号，并按主题/宽度截图自检；另有诊断发送启用态、上下文面板及无 WebGL 截图。
- 旧版 40 个组合（4 宽度 × 2 主题 × 5 页面）对照新样式文件启用/禁用，计算样式 0 差异。两份共享知识 CSS 解开新版变量回退后，与原始声明完全一致。
- 390px 英文、明暗主题、减少动态且禁用 WebGL：园区静态平面和导航可见，工坊静态部件入口可用，诊断可编辑；发送禁用/启用态、单层聚焦色与帮助/快捷键入口通过。
- 验证环境为 Linux Chromium，三维使用软件 WebGL；未执行真实 LLM 请求、发布或硬件浏览器验收。

## 截图

[改前总览](assets/unify-a-before.jpg) · [改后中文总览](assets/unify-a-after.jpg) · [改后英文总览](assets/unify-a-en.jpg)

[完整截图与机器记录压缩包](assets/unify-a-screenshots.zip) 内含离线交互对比页；截图采用无损 WebP，不缩放原始宽度。版本记录的总览仅展示首屏，避免全历史长图缩小后不可读。

## 未处理项及原因

1. 当前 3.19.1 已无独立数字展厅页面，`/hall` 沿既有规则进入园区装备视图；当前挂载页面也没有“底部七卡片”。因此保留路由和页面结构，调整现有园区曝光与标签，不重新引入或删除展示数据。
2. 不全量重写 40 个 CSS 文件，也不删除共享的旧版回退和无障碍规则。否则会扩大到旧版、强制色彩和透明度降级的回归范围。
3. 本批只创建分支与 PR；未合并、未部署，截图为本地验证结果。

## 分批回退

本批按令牌 → 版心 → 顶栏 → 装饰/图谱 → 实色内容 → 细节 → 清理/验收分步提交。提交仅包含对应任务文件；回退时保留相关步骤之间的令牌/组件引用依赖。
