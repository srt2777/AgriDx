# SFT 好轨迹数据集（离线合成）

文件：`sft-good-trajectories.jsonl`，每行一条 SFT 示例（JSON）。

## 来源（诚实说明）

- **没有真实生产用户轨迹。** 本数据集全部由 `agent/learning/synthetic.ts`
  离线生成，来源标注为 `synthetic-from-existing-cases`。
- 生成原料只用仓库已有的东西：6 个 Planner 主题、每主题 2 个步骤、
  逻辑链原因、`topicEvidence` 里的已核验证据 ID
  （见 `server/diagnosis/plannerPlans.ts`）。
- 机型、症状措辞、读数（如水温 98°C、电瓶 11.2V）是合成夹具值：读数只
  存在于该条轨迹自己的工具输出里，答案引用的就是那个值；**不是手册
  数据，不得当作维修事实引用**。
- 每条都经过 `agent/learning/reward.ts` 打分，`total >= 6 且无
  bypass_tools / fabricated_number` 才留下；不达标的不充数。

## 格式

每行：`{ id, topic, source, rewardTotal, messages: [...] }`

- `messages[0]` 是用户问题（`train: true`）。
- 中间是工具回合：只留工具名和证据 ID，`train: false`（mask，不计 loss），
  **不含工具返回原文**。
- 最后是助手答案（`train: true`）。

## 重新生成

```sh
node --import tsx scripts/generate-sft-dataset.ts
```

生成器会打印候选数、留下数、每主题条数、被拒条数（及原因）。如果留下
数不足 50 条，不要手动补——先看被拒原因，修生成器或奖励规则，再重新生成。
