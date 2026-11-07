# 早间搜索记录 2026-11-01

范围：AgriDx 四部分 LLM / Memory / Planner / Tool Use；方向：农业机械故障诊断 Agent、LLM+本地知识库诊断、拖拉机知识图谱与维修知识、开源 Agent 框架、Planner 与工具调用。

## GitHub（连接器 search_repositories，已验证 connected）
- motazalqaoud/agentic-ai-framework — 2026-09-28 更新，0 星；ReAct + 任务规划器 + 工具注册 + 有界记忆，离线可测。https://github.com/motazalqaoud/agentic-ai-framework
- hydang99/opentools — 2026-10-26 更新，4 星；社区驱动的工具使用框架，标准化工具 schema、持续评估/回归监测。https://github.com/hydang99/opentools
- ScorpioPxg/IndustryGraphRAG — 2026-10-13 更新，5 星；Neo4j 因果知识图谱 + LLM 路径排序的可解释工业故障诊断。https://github.com/ScorpioPxg/IndustryGraphRAG
- evgeniimatveev/agent-memory — 2026-10-30 更新，1 星；mem0 风格自托管长期记忆层。https://github.com/evgeniimatveev/agent-memory
- Koradji77/heropen — 2026-10-28 更新，1 星；面向本地 Agent 的长期记忆，100% 本地、MCP。https://github.com/Koradji77/heropen
- 1zZhiYuan/qwen-agent-backend — 2026-10-11 更新；Qwen + FastAPI + 工具调用 + 会话记忆 + SQLite 持久化。https://github.com/1zZhiYuan/qwen-agent-backend
- 直接查询“agricultural machinery fault diagnosis”返回 total 0，农业机械方向无直接命中。

## 公开网络资料（browser.search，非 X 原帖）
- Langfuse《Comparing Open-Source AI Agent Frameworks》2026-07-13：LangGraph、DeepAgents、OpenAI Agents SDK、CrewAI、Strands 等对比，DeepAgents 为“带子 Agent 与文件记忆的 Planner”最快路径。https://langfuse.com/blog/2025-03-19-ai-agent-comparison
- TrueFoundry《What Are LangGraph Deep Agents?》：DeepAgents 的 TodoListMiddleware 规划、FilesystemMiddleware、SubAgentMiddleware、SummarizationMiddleware、MemoryMiddleware。https://www.truefoundry.com/blog/what-are-langgraph-deep-agents-the-harness-explained
- Medium《Why Are AI Agents Starting to Use Filesystems as Memory?》2026-10：文件系统作外部工作记忆、工具结果卸载、上下文压缩。https://aaryan126.medium.com/why-are-ai-agents-starting-to-use-filesystems-as-memory-13a258b789fe
- arXiv《From Detection to Action: Using LLM Agents for Fault-Tolerant Control》：多 Agent（监测/规划/动作合成/仿真/验证）+ Graph RAG（CPSMod 本体）。https://arxiv.org/html/2606.28011
- arXiv《Open, Reliable, and Collective: A Community-Driven Framework for Tool-Using AI Agents》：即 OpenTools 论文，Planner-执行器、Verifier 只把验证后结果写入共享记忆。https://arxiv.org/html/2604.00137v1
- Unite.AI《xAI Adds Cross-Session Memory to Grok Build Coding Agent》2026-09-16：跨会话记忆以 Markdown 笔记持久化决策与项目事实。https://www.unite.ai/xai-adds-cross-session-memory-to-grok-build-coding-agent/
- explainx.ai《AI Agent Memory vs Documentation》2026-10：主张 Markdown 文档优于向量片段记忆，Operator Memory 插件。https://explainx.ai/blog/agents-dont-need-memory-they-need-documentation-operator-memory-2026

## X 检索缺口
- browser.search 的 site:x.com 查询返回 0 条。
- browser.open x.com 搜索页被策略拦截（Domain x.com is blocked by policy），已按恢复指引改用 browser.browse 只读任务 browser-task:b6393b0c-df66-5e8f-be2d-10a591923bb6。
- browser.browse 结果（运行 8:42-8:43 CST）：X 搜索页重定向至登录页，仅显示登录入口，未显示任何帖子；按只读/不登录限制已停止，未登录、未发帖、未关注、未点赞。
- 结论：本期无可验证的 X 原帖链接，不编造 X 帖子链接；X 部分如实说明缺口。
