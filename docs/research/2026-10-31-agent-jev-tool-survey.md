# Agent、Jev 与农机诊断：学习资料和工具目录

整理日期：2026-10-31。面向 AgriDx 团队的研究与讨论材料，不代表项目已经引入或上线所列工具。仓库状态会变化；原帖为 [Jev 项目清单](https://x.com/Pluvio9yte/status/2101831273224311035)。

## 一、什么是 Agent

本项目采用“LLM + Memory + Planner + Tool Use”的四部分口径。它们并不要求四个独立模型，也不要求必须采用 MCP 或向量数据库。

1. **大语言模型 LLM**：理解问题、结合资料解释和生成文字。用户已选择 DeepSeek API 作为本方案的生成和复杂分析模型。模型可以提出假设，但不能把推断变成已确认故障。参见 [DeepSeek API 文档](https://api-docs.deepseek.com/)。
2. **记忆 Memory**：工作记忆保留本轮问题和上下文；持久记录保存设备、检查进度及用户报告。历史报告仍需核对，切换设备时不能混用；助手推测不能自动成为事实。长期事实提取、纠错与语义召回是可单独建设的能力。
3. **规划 Planner**：根据目标、设备和证据选择下一步，如追问、检索、提供可核对的资料或停止。规划可以是规则、模型或组合；应有步骤、预算、停止和降级条件。
4. **工具调用 Tool Use**：让程序执行可验证的操作，例如查询手册、查找资料条目、获取当前设备记录、计算。工具需要输入校验、权限、超时、错误和可追踪来源；工具结果是外部数据，不是授权命令。

一条典型流程：用户描述问题 → 确认品牌型号和当前信息 → 检索适用资料 → 根据证据决定追问或形成答复 → 核对引用与风险 → 用户报告实际检查结果后继续。RAG 是检索并提供参考材料的方法，属于证据支撑，并不自动等于完整 Agent。

## 二、Jev 与 DeepSeek 如何配合

[Jev 官方文档](https://docs.typesafe.ai/introduction)：Jev 是 TypeSafe 提供的结构化判断模型。Choice 从给定选项选择；Score 按有序等级评分；Noul 给出是/否命题的数值。它不负责生成解释性文章。DeepSeek 则负责生成和复杂分析，两者可以组成“现有规则 → Jev 辅助判断 → DeepSeek 解释 → 现有安全检查”的流程。

Jev 输出的数值不是故障概率，也不能证明机型适配或资料真实。明确型号、故障码、来源、版本、计量单位与权限应由代码核验。输入文段不充分时应提示证据不足。批量问题可共享 state 并行判断，但前一个答案筛选出的内容需要再次请求后才能判断。

Jev 需要 TypeSafe 或兼容其接口的服务及对应凭据；DeepSeek 普通聊天 API 不能直接作为 Jev API 使用。第三方数据传输需要先核对隐私和资料使用范围，避免泄露设备用户信息、密钥或未经授权的手册内容。

## 三、相关研究与判断

- [Jev 综合评测（预印本）](https://arxiv.org/abs/2609.37647)：覆盖 37 个数据集，展示分类等能力，也报告细粒度任务和语言差异，二分类阈值需要按任务调整。
- [长文档检索评测（预印本）](https://arxiv.org/abs/2610.28957)：小规模教材集上混合检索加 Jev 获得较高证据覆盖，但覆盖率不等于最终答案准确率；该结果不等同于农机领域实测。
- [事实核验评测（预印本）](https://arxiv.org/abs/2610.20634)：在该研究的 198 条无依据说法中，Jev 放过 23.2%，不能作为唯一安全门。
- [中文排序社区实验](https://github.com/vicfei/jev-rag-zh-benchmark)：100 个问题的实验中 Jev Score 的 nDCG@5 为 0.546，BM25 为 0.413；样本小、不是农机数据，也不能代表实际故障诊断准确率。
- [原帖：Jev 与 RAG](https://x.com/_avichawla/status/2107767245917368751)；[原帖：Jev Engineering 和级联](https://x.com/Mr_Buzzoni/status/2104783226833186920)。文中的成本、速度、阈值是特定条件下的数值，不保证 AgriDx 达到同样效果。

项目已有的其他相关研究，可参阅 [故障树、布尔逻辑与模糊逻辑研究记录](2026-10-28-fault-tree-fuzzy-logic.md)。其中的模型假设与适用范围应单独核对，不能作为本次 Jev 实测结果。

## 四、原帖 20 个项目：地址、用途与注意事项

以下链接按原帖顺序列出。2026-10-31 使用 GitHub 仓库接口核对可访问性，并非代码安全、授权或质量审计。用途以项目描述和原帖为线索，不能视为本项目已验证。

| 序号 | 项目及地址 | 主要用途与定位 |
| --- | --- | --- |
| 1 | [jev-ultrafast](https://github.com/browser-use/jev-ultrafast) | 浏览器 Agent：Jev 选择操作与页面元素，文本由生成模型处理。适合研究受限的网页操作。 |
| 2 | [fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction) | Claude Code 上下文筛选；按相关性保留、截短或移除工具结果。要评估误删和恢复。 |
| 3 | [json-render](https://github.com/vercel-labs/json-render) | Vercel Labs 的生成式界面框架；与 Jev 的组合是特定用法，不代表整个项目依赖 Jev。 |
| 4 | [typesafe-mcp](https://github.com/itsmostafa/typesafe-mcp) | 将结构化判断服务封装成 MCP 工具；需核对支持的服务、客户端和密钥配置。 |
| 5 | [jev-mcp](https://github.com/jkudish/jev-mcp) | 包含相关性重排、说法核验、分类和内容筛查等工具；适合离线实验参考。 |
| 6 | [SemDecide](https://github.com/sharziki/semdecide) | 命令行语义分类、打分和过滤，面向脚本或 CI 流水线。 |
| 7 | [jev-codex-router](https://github.com/0xNatoshi/jev-codex-router) | 按轮判断编程任务并选择模型与推理档位；**核对时仓库已归档**。 |
| 8 | [Winnow](https://github.com/GhalebDweikat/winnow) | 对工具输出做相关性筛选，以减少进入上下文的无关内容。 |
| 9 | [jev-review](https://github.com/devagrawal09/jev-review) | 基于 Jev 的分阶段代码审查和本地看板，适合研究辅助审阅，不替代真实测试。 |
| 10 | [Blink](https://github.com/ellipsis-dev/blink) | 用 Jev 在代码库中寻找与任务相关的目录和文件。 |
| 11 | [agent-desktop](https://github.com/lahfir/agent-desktop) | 使用操作系统无障碍树进行桌面应用自动化；具体模型接法以项目当前实现为准。 |
| 12 | [typesafe-mario](https://github.com/fhshaik/typesafe-mario) | 从模拟器结构化状态选择游戏动作的演示。 |
| 13 | [jev-drone](https://github.com/RomanSlack/jev-drone) | MuJoCo 中结合摄像头与 Jev 的无人机仿真实验；不是实机部署证明。 |
| 14 | [OneVOneJev](https://github.com/emrickgarrett/OneVOneJev) | Three.js 射击游戏中的决策演示。 |
| 15 | [jev-trader](https://github.com/jarrodwatts/jev-trader) | Monad 网络上的交易决策实验，和农机诊断无直接关系。 |
| 16 | [Prism liquidity agent](https://github.com/irfndi/prism-liquidity-agent) | 流动性与交易策略项目；其功能与运行状态须以当前仓库为准。 |
| 17 | [neo4jev](https://github.com/jexp/neo4jev) | Jev 对 Neo4j 邻接关系进行判断、辅助图遍历；图连接不等于已验证因果。 |
| 18 | [jev-curate（原帖地址）](https://github.com/AkashPriyadarshii/jev-curate) | 原帖称其用于训练数据筛选；**核对时 GitHub API 返回 404**，目前不能确认原仓库可用性。 |
| 19 | [Canny](https://github.com/qkal/Canny) | 检查编程 Agent 的完成声明；仓库说明由确定性规则作决定、Jev 提供建议。 |
| 20 | [killmyidea](https://github.com/monteduro/killmyidea) | 对创业想法提供结构化评估的演示。 |

相关入口：[TypeSafe 官网](https://typesafe.ai/)；[Jev 文档](https://docs.typesafe.ai/)；[TypeSafe 控制台](https://console.typesafe.ai/)；[DeepSeek 文档](https://api-docs.deepseek.com/)；[Jev 项目导航](https://logicrw.github.io/awesome-jev-projects/)。目录站只用于发现项目，具体功能和安全性应回到项目原始资料核对。

## 五、结合 AgriDx 的建议

依据 2026-11-01 核对的仓库主线 `672a546`：主线已有 DeepSeek/Gemini 供应商适配、关键词检索、诊断协调、记忆模块和回答安全检查；有默认关闭的有界影子工具循环，影子结果不替换正常答复。其存在不表示线上已启用。更严格的 BM25/关键词融合与资料定位位于当时仍未合并的 [PR #163](https://github.com/srt2777/AgriDx/pull/163)，不能混同于已合并主线。

建议先选“检索候选是否与问题相关”这一项做离线对照。使用同一批候选与机型、来源硬校验，比较现有路径、Jev 重排和可本地运行的中文重排模型；另可测试 Jev 对回答与原文关系的辅助判断。先保留既有输出，仅记录经脱敏的实验结果；阈值在独立标注集上确定。无可靠证据时不能因为模型高分而生成确定维修结论。

评测至少覆盖：用户口语、不同品牌和相近型号、故障码缺失或不匹配、手册版本冲突、无答案、危险操作及中文专业术语。记录证据召回、排序、无依据内容误放行、有效内容误拦截、引用正确率、实际延迟与总费用。按照模型版本、问题模板和数据集记录复现信息。影子运行一段时间并不能替代人工真值和独立测试。

研究、模拟和上线应分别标记：本次资料整理没有安装这些项目，没有进行 Jev 或 DeepSeek API 实测，也没有实现或启用 Jev 集成。文档同步与网站部署以实际仓库记录为准。

## 六、其他参与者从哪里开始

以下链接固定指向 2026-11-01 核对的主线快照 `672a546ed2fe64294493420b871097b191df4c30`，便于大家讨论同一份材料；之后请再以仓库最新 main 为准。

1. 先读 [Agent 设计与参与路线](https://github.com/srt2777/AgriDx/blob/672a546ed2fe64294493420b871097b191df4c30/docs/agent-development.md)：理解四个部分、现有边界和协作约定。
2. 查阅 [工具执行层说明](https://github.com/srt2777/AgriDx/blob/672a546ed2fe64294493420b871097b191df4c30/agent/README.md)：了解现有工具、只读约束、影子循环和运行限制。
3. 查看 [诊断服务](https://github.com/srt2777/AgriDx/blob/672a546ed2fe64294493420b871097b191df4c30/server/diagnosis/service.ts) 和 [模型路由](https://github.com/srt2777/AgriDx/blob/672a546ed2fe64294493420b871097b191df4c30/server/llm/router.ts)：理解请求、模型、证据与回答的衔接。
4. 查阅 [知识检索](https://github.com/srt2777/AgriDx/blob/672a546ed2fe64294493420b871097b191df4c30/server/knowledge/retriever.ts) 与 [回答安全检查](https://github.com/srt2777/AgriDx/blob/672a546ed2fe64294493420b871097b191df4c30/server/diagnosis/answerGuard.ts)：核对来源、适用范围和输出检查的实际实现。
5. 参与改进时，先写明影响的是 LLM、Memory、Planner 还是 Tool Use，说明预期行为、证据、测试和未完成部分；涉及具体设备资料须明确来源与适用范围。

本文是帮助理解和协作的资料，不自动授予安装工具、上传私人数据、合并代码或部署系统的权限。
