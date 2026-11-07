# 早间搜索记录 2026-11-06

范围：AgriDx 四部分 LLM / Memory / Planner / Tool Use；方向：农业机械故障诊断 Agent、LLM+本地知识库诊断、拖拉机知识图谱与维修知识、开源 Agent 框架、Planner 与工具调用。

## GitHub（连接器 search_repositories，已验证 connected；重点仓库 README 已读回核查）
- openJiuwen-ai/agent-memory — 更新 2026-11-05，81 星，Apache 2.0；框架无关的分层长期记忆：提取→抽象→关联，事实/事件/画像三层，BM25+向量混合召回+重排，冲突解决与遗忘闭环，SDK/HTTP/CLI 多形态接入。https://github.com/openJiuwen-ai/agent-memory
- kiazh/Machina-Harness — 更新 2026-11-05，3 星；自托管多智能体编排框架，PostgreSQL+pgvector 持久上下文/RAG/长期记忆，流式终端 UI，后台命令与可中断执行。https://github.com/kiazh/Machina-Harness
- actrone/actrone-memory-py — 更新 2026-11-05，3 星，MIT；短期+长期持久记忆，本地优先零服务，Redis+Qdrant 可扩展，16 个框架适配器（LangChain/LangGraph/CrewAI 等）。https://github.com/actrone/actrone-memory-py
- AegeanWorks/NeuroCore — 更新 2026-11-05，8 星，AL-1.1（个人免费/商业另议）；自托管 Agent 框架，可视化流程编辑、持久记忆、RAG、工具插件、支持本地 LLM。https://github.com/AegeanWorks/NeuroCore
- Yiinzenh/AegisCore-PostgreSQL-Database-O-M-Agent-Based-on-LLM-and-RAG — 更新 2026-09-07，0 星；LLM+RAG 运维 Agent，感知-分析-决策-执行闭环，知识检索+工具调用+两阶段风险确认，数据库故障诊断场景，模式可借鉴。https://github.com/Yiinzenh/AegisCore-PostgreSQL-Database-O-M-Agent-Based-on-LLM-and-RAG
- 直接查询“agricultural machinery fault diagnosis agent”“tractor knowledge graph repair”仍返回 total 0；农业机械方向仍无直接命中。GraphRAG 工业故障方向仅有已收录过的 Wan-Razaq/GraphRAG-Industrial-Fault-Analysis（更新 2026-11-02，2 星），无新项。
- 已过滤：个人配置/个人助手类 0 星仓库（zinebnadak/zizo、landonmclain/paf、chuongtran01/personal-agent）；面向编码 Agent 的 archgraph、.NET 通用框架 Ananke、0 星新库 hyori-agent（与诊断场景关联弱）。

## 公开网络资料（browser.search，非 X 原帖；仅作 X 缺口的补充背景，不冒充 X 链接）
- TinySuite《How to Add Long-Term Memory to an AI Agent》（2026-11-02）：记忆即工具——保存/召回两个工具 + 系统提示约定使用时机，TinyContext 开源记忆服务器，单 SQLite 文件本地部署。https://tinysuite.dev/blog/how-to-add-memory-to-ai-agent/
- MemRole 论文（arXiv:2611.01778，2026-11-01）：记忆到决策的显式框架 Long-Horizon Memory Thinking，角色扮演长程一致决策 +15.2 分。https://arcXiv.org/abs/2611.01778
- Salesforce《Double recall: Inside the Agentforce Memory update》（2026-11-04）：记忆策略更新后事实召回提升 1.8 倍、变化事实召回 2.2 倍，更新按“纠正旧记忆”而非“新增一条”处理。https://www.salesforce.com/blog/agentforce-memory-update/?bc=OTH
- Medium《Letta Alternatives in 2026: 9 AI Agent Memory Tools Compared》（2026-11）：Mem0 / Zep-Graphiti / LangMem / Membase 等 9 个记忆工具对比；注意作者为 Membase 团队，存在厂商立场。https://medium.com/@unibase/letta-alternatives-in-2026-7-ai-agent-memory-tools-compared-45eeb93b08b4
- 已过滤：昨日已收录的 Medium《How to Build an AI Agent That Doesn't Go Off the Rails》（同一链接，重复）；Pieces LTM-2.7 产品文档（与诊断 Agent 关联弱）。

## X 检索缺口
- browser.search 的 site:x.com 查询再次返回 0 条。
- 按 2026-11-01 的用户决定（“登不上 算了”），不重试 X 登录；本期仍无可验证的 X 原帖链接，不编造 X 帖子链接。
