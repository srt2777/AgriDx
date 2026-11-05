# Agent 学习：轨迹、奖励、SFT 数据集（离线）

来源：CMU 11-768 第 8/9/11/12 讲（SFT、RL 基础、高级 RL 算法、RL 系统），按
`~/workspace/goals/cmu-11-768-ai-agents-course-study/files/sft-rl-agridx-checklist.md`
清单 1–10 条实现。清单 11–13 条（真正的 RL 权重训练、稳定更新、扩展部署）
不在本模块里：AgriDx 用的是 DeepSeek API 模型（deepseek-flash），仓库里
没有训练管线，做不了对 DeepSeek 权重的 SFT/RL 梯度训练。

## 边界（先读这段）

- **这不是权重训练。** 本模块做的是离线三件事：记录诊断轨迹、按写死的
  规则给轨迹打分、把好轨迹导出成 SFT 格式并做示例选择。没有任何一步会
  更新模型权重，也不要在任何地方声称“已微调/已训练模型”。
- **没有真实用户轨迹。** 提交的数据集（`data/sft-good-trajectories.jsonl`）
  是离线合成的：只用仓库已有的 6 个 Planner 主题、逻辑链和已核验证据 ID
  生成，每条都过了奖励器才算“好轨迹”。机型、症状措辞和读数是合成夹具值，
  不是手册数据，不得当作维修事实引用。
- **不改变线上诊断行为。** 轨迹记录接进诊断服务时只多一个可选回调
  `onTrajectory`，默认开启构建、默认不写盘、不上传；诊断答案、路由、
  Planner、工具调用都不受它影响。开关：`trajectoryRecording: false`
  可关闭构建；不传 `onTrajectory` 则轨迹只构建不保存。

## 模块

| 文件 | 作用 |
|---|---|
| `trajectory.ts` | 轨迹类型与构建器。token/成本没测到就记 null，不编；正文脱敏（密钥、Bearer、邮箱、手机号、长十六进制）。不写盘、不发网。 |
| `reward.ts` | 纯函数奖励器 + GRPO 式分组打分。规则与权重写死在文件头：Planner 对错、工具是否绕过、数值是否只引用工具返回、缺信息是否先问、证据冲突是否提示、分步信用分配。`total >= 6 且无 bypass_tools / fabricated_number` 才算好轨迹。 |
| `sft.ts` | SFT 导出器。工具返回不进导出文件：工具回合只留工具名和证据 ID，`train: false`（mask，不计 loss）；只训模型自己的话。导出时校验该约定，违规直接抛错。 |
| `exemplars.ts` | 只读示例加载器（离线/脚本用）。按主题挑奖励分最高的 1–3 条，拼成标明“仅作格式参考、不作故障证据”的提示段。**没有接进线上诊断**，想用必须显式调用。 |
| `synthetic.ts` | 合成数据集构建器：6 主题 × 3 症状 × 3 工具方案 = 54 候选，每条过奖励器，达标才留。 |
| `fileSink.ts` | 可选的本地文件落盘（`createFileTrajectorySink(path)`，JSONL 追加）。只有显式传入时才用；本 PR 没有在生产路径启用它。 |
| `data/` | 提交的 SFT 数据集与说明。生成命令见 `data/README.md`。 |

## 用法

```ts
import { buildDiagnosticTrajectory, scoreTrajectory, trajectoryToSftExample } from './agent/learning';

// 1. 记录（诊断服务里已接好，见 server/diagnosis/service.ts 的 onTrajectory）
const trajectory = buildDiagnosticTrajectory({ question, plannerTopic, toolCalls, answer, ... });

// 2. 打分（离线，需要 ground truth 才有意义）
const breakdown = scoreTrajectory(trajectory, { expectedTopic: 'fuel', expectedTools: ['search_knowledge', 'fault_chain'], expectedCauseText: '...', infoMissing: true });

// 3. 导出（只导出好轨迹）
import { exportSftDataset } from './agent/learning';
const jsonl = exportSftDataset([trajectoryToSftExample(trajectory, breakdown.total)!]);

// 4. 示例（离线脚本用，不接线上）
import { loadSftDataset, selectExemplars, buildExemplarPromptSection } from './agent/learning';
const section = buildExemplarPromptSection(selectExemplars(loadSftDataset('agent/learning/data/sft-good-trajectories.jsonl'), { topic: 'fuel' }));
```

生成数据集：`node --import tsx scripts/generate-sft-dataset.ts`

测试：`tests/agent-learning.test.ts`（轨迹、奖励、分组、导出、示例、服务集成）。
