# 早间搜索记录 2026-11-03

范围：AgriDx 四部分 LLM / Memory / Planner / Tool Use；方向：农业机械故障诊断 Agent、LLM+本地知识库诊断、拖拉机知识图谱与维修知识、开源 Agent 框架、Planner 与工具调用。

## GitHub（连接器 search_repositories，已验证 connected）
- vectorize-io/hindsight — 更新 2026-11-03T00:32:20Z，58083 星 / 7131 fork；Agent Memory That Learns，Retain/Recall/Reflect。https://github.com/vectorize-io/hindsight
- thedotmack/claude-mem — 更新 2026-11-03T00:36:16Z，110740 星 / 9653 fork；跨会话持久上下文，会话压缩 + 按需注入；注意公开报道指出其遥测默认开启、隐私说明存在争议，借鉴时需先核对默认配置。https://github.com/thedotmack/claude-mem
- yu123-tqy/equipdoc-agent — 更新 2026-10-18，47 星 / 12 fork；机电维修可审计 AI Agent：LangGraph + RAG + 故障诊断 + 人工复核。https://github.com/yu123-tqy/equipdoc-agent
- zjz0810/industrial-fan-diagnosis-agent — 更新 2026-10-13，19 星；多源时序分类 + 确定性诊断 + LoRA Qwen + RAG + guardrails。https://github.com/zjz0810/industrial-fan-diagnosis-agent
- glassy0605/fault-diagnosis-agent — 更新 2026-10-14，2 星；面向维修人员的助手：查资料、查历史工单、按故障现象给排查步骤、调用工具。https://github.com/glassy0605/fault-diagnosis-agent
- Tongyi-MAI/Qwen-Planner-Agent — 更新 2026-10-24，112 星 / 10 fork；面向真实移动端 Planner Agent 的闭环 AI-for-AI 框架。https://github.com/Tongyi-MAI/Qwen-Planner-Agent
- fr0ster/llm-agent — 更新 2026-11-02，12 星；TypeScript LLM Agent 框架：多供应商、MCP、RAG、Planner/控制器、工具驱动编排。https://github.com/fr0ster/llm-agent
- wangle1218/KBQA-for-Diagnosis — 更新 2026-11-01，1489 星 / 386 fork；知识图谱 + 向量检索的诊断问答（医疗场景，图谱问答结构可迁移）。https://github.com/wangle1218/KBQA-for-Diagnosis
- 直接查询“agricultural machinery fault diagnosis agent”“tractor knowledge graph repair”仍返回 total 0；农业机械方向仍无直接命中。
- 已过滤：本地 RAG 维修助手类较旧项目（2026-04 至 08 月更新、0 星为主）、医疗图谱问答的重复 fork、与主题无关的 Planner 项目（如轨迹规划、旅行规划）。

## 公开网络资料（browser.search，非 X 原帖）
- 农业电机故障诊断知识图谱论文（Transactions of the Chinese Society for Agricultural Engineering）：维修日志、技术手册、故障记录 → 实体/关系抽取 → Neo4j + GPT 问答转 Cypher；可解释、可更新。http://www.tcsae.org/en/article/doi/10.11975/j.issn.1002-6819.202409065
- DeepSeek Super-agent 设计解析（explainx.ai，2026-11-01 发布的设计文章）：Router 只分发不执行 + 隔离 Worker + 触发器 + Watchdog；长期记忆被列为长期运行后的主要瓶颈。https://explainx.ai/blog/deepseek-super-agent-architecture-router-worker-triggers-watchdog-2026
- 已过滤：freederia.com 的农机知识图谱文章（来源与评估口径不明，85%/92% 等说法未经核实，不作为推荐）。

## X 检索缺口
- browser.search 的 site:x.com 查询（农机诊断、Planner/工具调用/记忆方向）再次返回 0 条。
- 按 2026-11-01 的用户决定（“登不上 算了”），不重试 X 登录；本期仍无可验证的 X 原帖链接，不编造 X 帖子链接。

## README 核查说明（后台返回后补记）
- 5 个项目 README 已实际读回：equipdoc-agent 明确为公开工程作品/作品集性质，默认无模型 Demo 模式为固定案例回放，Full 模式需另配 Qwen 服务、CNN 权重和可选向量库；industrial-fan-diagnosis-agent 明确为离线研究原型而非已部署工厂系统，分类器定状态标签、语言模型只解释输出与证据边界；glassy0605/fault-diagnosis-agent 为个人试做学习项目，需配置 DeepSeek API；fr0ster/llm-agent（SmartAgent）为可组合框架，支持从 ReAct 工具循环到带持久可恢复状态的 plan-first 控制器；Qwen-Planner-Agent 为阿里 MAI 团队的闭环框架及技术报告项目页。
- 因此上述 3 个诊断类项目应按“架构与护栏思路可借鉴、非开箱即用的生产系统”理解，入选结论不变，成熟度提示已补入本记录。
