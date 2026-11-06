# 早间搜索记录 2026-11-05

范围：AgriDx 四部分 LLM / Memory / Planner / Tool Use；方向：农业机械故障诊断 Agent、LLM+本地知识库诊断、拖拉机知识图谱与维修知识、开源 Agent 框架、Planner 与工具调用。

## GitHub（连接器 search_repositories，已验证 connected；README 已读回核查）
- deepseek-ai/dsh-superagent-prototype — 2026-10-31 发布，README 已直接读回验证；研究原型、非正式产品，MIT；Router + 隔离 Worker 会话、触发器、Watchdog、异步工具、Chain of Recall，长期记忆列为开放问题。https://github.com/deepseek-ai/dsh-superagent-prototype
- oceanbase/powercontext — 更新 2026-11-05T00:29:03Z，1472 星；跨会话/跨 Agent/跨人的长期记忆与记忆交接，Apache 2.0。https://github.com/oceanbase/powercontext
- kitfunso/hippo-memory — 更新 2026-11-05T00:38:21Z，790 星；面向编码 Agent 的长期记忆层，数据本地、跨工具（Cursor/Claude Code/Codex），随时间学习。https://github.com/kitfunso/hippo-memory
- wangwnejie/fault-agents-ai4i — 更新 2026-11-04，0 星；论文配套代码：多智能体 LLM 协同工业设备故障诊断与运维决策，AI4I 2020 数据集，CPU 可复现，LLM 实验需 Anthropic 或兼容接口。https://github.com/wangwnejie/fault-agents-ai4i
- Wan-Razaq/GraphRAG-Industrial-Fault-Analysis — 更新 2026-11-02，2 星；学位论文项目：LLM 抽取 + Neo4j 知识图谱 + 混合图检索 + Streamlit 问答，面向离子束机维护数据，可查看答案背后的图上下文。https://github.com/Wan-Razaq/GraphRAG-Industrial-Fault-Analysis
- ScorpioPxg/IndustryGraphRAG — 更新 2026-10-13，5 星；面向工业设备的可解释故障诊断 GraphRAG：手册/故障报告/维修记录/标准 → 因果知识图谱，LLM 辅助路径排序，FastAPI + Vue。https://github.com/ScorpioPxg/IndustryGraphRAG
- LTJ002/dsh-eval-harness — 更新 2026-11-04，0 星；DeepSeek Harness 的 Agent 应用评测工具：离线/在线套件、按审计副作用评判、安全回归零容忍基线对比、变异测试评测器，中文文档。https://github.com/LTJ002/dsh-eval-harness
- 直接查询“agricultural machinery fault diagnosis agent”“tractor knowledge graph repair”仍返回 total 0；农业机械方向仍无直接命中。
- 已过滤：dsh-superagent 的第三方仿制/镜像仓库（如 LofiSu/deepseek-super-agent 及一批 2026-11-04 镜像，0 星为主，不作为官方原型推荐）；旅行/学习类 Planner、0 星个人配置类仓库；与主题无关的 fork。

## 公开网络资料（browser.search，非 X 原帖；仅作 X 缺口的补充背景，不冒充 X 链接）
- AWS VEMA 语音制造助手（AgentCore + Strands）：维护模式做设备排障/维修步骤/根因分析，安全模式分流；会话可跨时段续接、不用重复说明问题。https://aws.amazon.com/blogs/industries/build-a-voice-enabled-automotive-and-manufacturing-assistant-using-amazon-nova-sonic-and-amazon-bedrock-agentcore/
- AWS 多智能体工程助手（AgentCore + Strands + Nova 多模态嵌入）：Planner 路由 Catalog/Evaluation/Knowledge 三个专家，Supervisor 仅在多专家参与时综合，确定性容差规则 + 审计轨迹，工程师做最终决策。https://aws.amazon.com/blogs/machine-learning/agentic-engineering-intelligence-with-amazon-nova-multimodal-embeddings-and-amazon-bedrock-agentcore/
- Medium《How to Build an AI Agent That Doesn't Go Off the Rails》（2026-11）：Agent 循环、Plan-and-execute、工具调用、记忆、护栏全链路实战，含工具幻觉、成本上限、可验证结果等生产化要点。https://medium.com/@randhir.jassal/how-to-build-an-ai-agent-that-doesnt-go-off-the-rails-the-agent-loop-planning-tool-use-memory-fc3818b9e3ca
- 已过滤：freederia.com 的农机知识图谱文章（与 11-03 相同来源，85%/92% 等说法未经核实，不作为推荐）；AWS 农机维修助手一文仅见代理镜像链接，未用其链接。

## X 检索缺口
- browser.search 的 site:x.com 查询（Planner/工具调用/记忆方向）再次返回 0 条。
- 按 2026-11-01 的用户决定（“登不上 算了”），不重试 X 登录；本期仍无可验证的 X 原帖链接，不编造 X 帖子链接。DeepSeek Super-agent 设计据二手报道称 11-01 发于 X，但本期未以 X 链接形式收录，仅收录其已验证的 GitHub 原型仓库。
