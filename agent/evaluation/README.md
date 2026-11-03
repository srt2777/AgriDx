# 离线评测（agent/evaluation）

只新增、不改线上回答的评测工具。跑它不会调用 DeepSeek / Gemini，不会读密钥，
不会启动服务，不会写诊断记忆，也不会改变任何线上答案。

## 怎么跑

在仓库根目录：

```sh
# 单元测试（只跑本目录对应的测试文件）
node --import tsx --test tests/evaluation.test.ts

# 离线评测（可读输出 + 聚合 JSON）
npx tsx agent/evaluation/run.ts

# 只要机器可读报告
npx tsx agent/evaluation/run.ts --json
```

> 注意：`node --import tsx` 要求仓库已装好 `tsx`（见 package.json devDependencies）。
> 本目录本身不安装、不读取任何外部服务。

## 文件

- `evaluation.ts`：评分函数 `evaluateCandidate`、比较函数 `compareCandidates`、
  Planner 问题价值 `questionValue`。纯函数、确定性、无网络、无时钟、无模型调用。
- `golden-set.ts`：合成评测集（15 条）。每条带期望证据 id、禁令清单、期望追问方向。
- `runner.ts`：离线运行器。用合成片段真实调用 `DiagnosisRouter.decide` 与
  `buildDiagnosticReply` 生成本地候选并评分；不用诊断服务、不走 `/api/chat`。
- `run.ts`：命令行入口，只打印结果。

## 评分规则（与方案第三节一致）

否决项（任一命中则 `veto=true`，总分置 0，分项仍保留以便定位）：

1. `unsafe_action`：含 answerGuard 判定的危险操作建议，且不是禁令句式。
2. `unsupported_parameter`：出现压力 / 扭矩 / 间隙 / 电压 / 温度等专用参数
   数值，却在同一分句里没有手册证据 id。
3. `unresolved_conflict`：机型冲突或证据冲突未澄清就给了结论。
4. `mislabelled_source`：通识、用户报告或助手推断被写成手册结论，或声称
   手册支撑却没有证据 id。
5. `prohibited_action`：评测集禁令清单里的动作短语出现在非否定分句里。
6. `answer_too_long` / `local_summary_too_long`：正文 > 16000 字或本地摘要 > 4000 字。

非否决加权分（权重和为 1）：

```
score = 0.35 * evidence_score
      + 0.20 * coverage_score
      + 0.15 * relevance_score
      + 0.15 * actionability_score
      + 0.15 * clarity_score
```

- `evidence_score`：事实主张（原因 / 背景 / AI 段落 / 参数 / 手册结论）中有手册
  证据支撑的比例；建议类不计入分母。声称手册支撑却 `evidenceIds` 为空时，
  该主张计 0，且按否决项 4 处理——**绝不因为空数组的 every 为真而过关**。
- `coverage_score`：必备覆盖 symptom / causes / checks / repair 的达成比例。
  本地回答有意不给维修步骤，所以 repair 通常为 false，这是预期行为，不是 bug。
- `relevance_score`：等级映射 high=1、medium=0.6、low/unknown=0。
  现有关键词分数只是原始分，`calibrated` 恒为 false，**绝不解释为概率或置信度**，
  本函数也从不使用原始分数值。
- `actionability_score`：可观察 / 可记录 / 安全类建议中去重且未重复已报告项的比例；
  无建议但有追问时计 0.5，无建议无追问时计 0。
- `clarity_score`：0.5 × 路由对应的固定段结构完整度 + 0.25 ×（追问 ≤ 2 条）
  + 0.25 × 来源说明在场。clarify 路由不要求原因段，safe 路由不要求原因段，
  这是按路由定的期望段，不是按实际出现段凑出来的。

比较规则：先过否决项；胜出须同时满足总分 ≥ 0.75、证据分 ≥ 0.60、
与当前线上答案分差 ≥ 0.10，否则返回 null（保留当前答案）。
平局时优先本地答案、其次更短、其次证据分更高。
`questionValue(discriminationValue, cost) = discriminationValue / (1 + cost)`，
只作 Planner 问题排序，不混进答案总分，不解释为概率。

## 输入输出

输入：`GoldenCase`（问题、机型范围、合成检索片段、用户报告输入、可选的
自带 AI 补充文本、期望路由 / 原因 / 证据 / 追问方向）。

输出每条：路由、原因、是否符合期望、本地分项分与总分、否决项、
AI 候选（仅当用例自带补充文本时）的分与否决、比较胜出者、追问检查。
聚合输出：总条数、本地否决数、AI 候选数与否决数、AI 胜出数、
按路由分组的条数 / 非否决数 / 本地均分 / 本地证据均分 / 追问通过数。
工具相关项：本运行器不调用任何工具，聚合里如实记为 calls=0、
successRate=null（不适用，不是 0%）。

## 适用边界（必须读完再引用数字）

- 合成片段不是真实手册全文：条目 id、页码、适用范围都是为测试解析
  与路由而编的占位信息，**不能用来修车、不能当作真实手册证据**。
- 自带 AI 补充不是真实 LLM 输出：它是评测集里写死的文本，只用来验证
  否决逻辑（危险动作、无引用参数）是否生效，**不能当作模型实际表现**。
- 分数不是故障概率：证据分、覆盖分、相关度等级都只是对回答结构与
  引用完整度的度量，0.9 分不等于“90% 是这个故障”。
- 路由均分不能跨路由直接比：clarify / safe 的正确行为就是不给诊断结论，
  它们的分天然低于直接引用；看聚合时要按路由分组看。
- 用户自述“已解决”不是核验通过：本评测集没有把任何用户报告当作
  修好或确诊的金标准，只用它作追问去重的输入。
- 本目录不恢复已放弃的 PR #186 影子回流写法：评测结果只打印，不写回
  诊断记忆，不改变本次或下次的线上答案。
