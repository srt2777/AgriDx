# 研究日志：故障树、布尔逻辑与模糊隶属度

- 日期：2026-10-28（上海时间）
- 范围：方法资料初步研究；本文是研究记录，不是已实现功能、维修手册或经实车验证的诊断规则。
- 阅读范围：NASA 手册的相关章节，以及下列论文公开摘要和资料页面；未声称完整研读付费论文全文。

## 一、故障树与布尔逻辑

故障树分析（FTA）从明确的顶事件出发，按照系统结构和工作条件向下分解，寻找足以产生该事件的基本事件或组合。或门表示至少一个输入事件发生，与门表示输入事件同时发生。建树时需先确定设备、工况、边界和事件定义；逻辑关系应来自可靠资料，而不是仅因两个症状同时出现就认定为因果关系。[1]

抽象例子：令 `T = A ∨ (B ∧ C)`，则最小割集为 `{A}` 和 `{B, C}`。最小割集是足以引起顶事件且不能再删去其中任何事件的最小组合。这里的字母只是数学示例，未代表特定机型的故障结论。

定量分析时，若 A、B 相互独立：`P(A ∧ B) = P(A)P(B)`，`P(A ∨ B) = 1 − (1 − P(A))(1 − P(B))`。独立性和同一观察时间范围必须有依据；共因故障、重复基本事件或其他依赖关系会使简单逐门计算失效。[1][2] 静态故障树也不能直接表达所有顺序或时间依赖。

## 二、模糊集合与隶属度

隶属度函数 `μ_A(x) ∈ [0, 1]` 描述观测值 x 与语言概念 A 的匹配程度，例如某个振动指标对“中等”的隶属度。**隶属度不是该设备故障的概率**，也不是单独足以确诊的证据。

一种常见选择是三角形函数，参数 `a < b < c`：

```text
μ(x) = 0                 x ≤ a 或 x ≥ c
       (x − a)/(b − a)   a < x ≤ b
       (c − x)/(c − b)   b < x < c
```

例如仅为演示，`(a,b,c)=(2,4,6)`，`x=3` 时隶属度为 `0.5`。梯形函数适合表达具有一段典型区间的概念，高斯函数则提供平滑曲线。实际参数需要结合具体机型、单位、传感器、工况、数据分布和手册或专家依据确定；缺失数据不能自动补成精确阈值。[3][4]

模糊规则中可以使用 `min` 表示一种“与”、`max` 表示一种“或”，但它们只是选定的模糊集合运算，不是概率乘法。规则、聚合和输出解释均需明确；不同运算可能产生不同结果。

## 三、结合方式与边界

1. **症状匹配**：将测量值映射为“偏高”等隶属度，结合可追溯规则形成候选原因及下一步检查建议。匹配分数不等于故障概率。
2. **模糊故障树定量分析**：用模糊数表示基本事件估计的不确定性，并按所选方法传播；Liang 和 Wang 的论文摘要采用三角模糊数表征失效可能性，并通过扩展原理计算顶事件。[5] 失效可能性、模糊隶属度和概率含义不同，转换必须说明假设和依据。
3. **运算精度**：三角模糊数运算的结果一般不必然仍为三角形；简单用三个端点计算可能只是近似。若做定量分析，应明确运算方法、近似误差及依赖关系。[6]

## 四、对 AgriDx 的初步启发

现有 `docs/diagnosis-coordination.md` 明确不将关键词分数或模型自信当作诊断概率；`docs/knowledge-graph.md` 也明确关系强度不是概率或因果。研究方向应保持这些边界：

- 先从可追溯的手册、系统结构和已核验案例中整理候选事件、逻辑关系及适用机型；无法确认与门/或门关系时标记待核验。
- 对可测症状记录单位、工况和数据来源，区分“未知”与正常；函数参数先作为待验证假设，避免将缺失数据当作零。
- 如后续开展试验，比较规则输出与人工标注/维修检查结果，并评估不同机型、工况下的误报、漏报与参数敏感性。输出应保留来源、假设和不确定性。
- 故障树可用于解释结构，症状匹配可辅助排序；二者不能自动证明具体原因，也不应替代现场检查。本文没有实现、接入知识库或验证准确率。

## 参考资料

1. NASA, [Fault Tree Handbook with Aerospace Applications](https://extapps.ksc.nasa.gov/reliability/Documents/Fault_Tree_Handbook_with_Aerospace_Applications_August_2002.pdf)，第 6 章及附录 A：逻辑门、概率和最小割集。
2. NASA, [System Engineering Tools and Techniques](https://extapps.ksc.nasa.gov/Reliability/Documents/SystemEngineeringTools_and_Techniques.pdf)：可靠性分析与共因等相关问题。
3. [Fuzzy-Based Failure Modes, Effects, and Criticality Analysis Applied to Cyber-Power Grids](https://www.mdpi.com/1996-1073/16/8/3346)：隶属函数和三角模糊数示例；应用领域不是农机。
4. Chen & Toyota, [Sequential Fuzzy Diagnosis for Plant Machinery](https://www.jstage.jst.go.jp/article/jsmec/46/3/46_3_1121/_article)，2003：机械状态诊断与症状参数隶属函数；依据公开摘要。
5. Liang & Wang, [Fuzzy fault-tree analysis using failure possibility](https://www.sciencedirect.com/science/article/pii/002627149390326T)，1993，DOI: 10.1016/0026-2714(93)90326-T；依据公开摘要，全文可能需要付费。
6. NIST, [Parametric Representation of Fuzzy Numbers and Their Arithmetic Operators](https://www.nist.gov/publications/parametric-representation-fuzzy-numbers-and-their-arithmetic-operators)：模糊数运算与近似问题。
