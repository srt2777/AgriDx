# 知识图谱、检索与覆盖缺口

日期：2026-10-26（上海）；版本4.2.0；批次 `ui-knowledge-graph-20261026`。

- 保留全部知识/来源归档/通识学习/知识图谱/按机型与部件浏览五个入口及原有 URL 参数。图谱增加已核对资料类型与诊断角色过滤，搜索结果保留节点路径；缺少角色或类型不会用颜色推断。
- 节点详情增加目录节点入口和既有诊断入口；原始资料展示来源、页码（若有）、定位、适用范围与核验状态。远景隐藏零件细节，完整键盘/列表目录保持可操作。
- 目录统计增加节点级已索引资料类型元数据，未知旧响应可继续读取；通识与来源归档继续分开，通识不显示为维修证据。
- 定向测试：`node --import tsx --test tests/knowledge-taxonomy.test.ts tests/knowledge-catalog.test.ts tests/knowledge-engine-model.test.ts tests/knowledge-engine-catalog.test.ts`，16/16通过。
- 完整 `npm run verify`：674项，658通过、16平台跳过、0失败；类型、Lint、完整构建通过。既有 Fast Refresh 警告和大包提示保留，日志 `work/pr8-knowledge-graph-verify.log`。
- 实际本地服务回归：1440px深色与375px浅色 HashRouter 知识图谱页；筛选控件44px、手机 `scrollWidth=375`、浏览器 pageerror 为空；角色筛选从3,984节点收敛到2,789节点。截图：`desktop-dark-graph.png`、`mobile-light-graph.png`。
