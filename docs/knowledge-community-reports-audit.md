# 社区报告抽查记录（知识库第 4 步）

日期：2026-11-06；基底：main 9ececeb / 4.0.40；kbVersion：2026.10.14；snapshotSha：`9b50989b84946605ca14774a56f78d0cb30c94177fcbabde2fd9fb5215e4fd25`；公式版本：1.0.0。

## 方法

抽查样本为报告按 id 排序后的前 20 条（确定性取样，非随机）。逐条核对每句话的全部来源：条目存在于归档索引、source_id 与条目一致、页码与定位解析一致、定位文字与条目一致；任一不符即记为不通过。另有全量检查（见 `tests/knowledge-community-reports.test.ts`）：全部 1845 份报告、14309 句、232702 个来源逐一核对，无来源句子为 0。

## 全量结果

- 报告：1845 份；覆盖归档条目：6351 条（6361 条归档减去按 2026-11-01 决定不显示的“千寻位置”10 条）。
- 句子：14309 句；来源引用：232702 个；无来源句子：0。

## 20 条抽查表

| # | 报告 id（品牌，型号，系统） | 条目 | 句子 | 来源 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 1 | `["Barbieri","HydroTRAC 4HWD","documents"]` | 1 | 3 | 3 | 全对 |
| 2 | `["Barbieri","HydroTRAC 4HWD","electrical"]` | 2 | 4 | 8 | 全对 |
| 3 | `["Barbieri","HydroTRAC 4HWD","hydraulics"]` | 1 | 4 | 4 | 全对 |
| 4 | `["Barbieri","HydroTRAC 4HWD","lubrication"]` | 1 | 4 | 4 | 全对 |
| 5 | `["Barbieri","HydroTRAC 4HWD","machine"]` | 1 | 4 | 4 | 全对 |
| 6 | `["Barbieri","HydroTRAC 4HWD","pto"]` | 1 | 4 | 4 | 全对 |
| 7 | `["Barbieri","HydroTRAC 4HWD","transmission"]` | 1 | 4 | 4 | 全对 |
| 8 | `["Mahindra","6065","brakes"]` | 4 | 4 | 16 | 全对 |
| 9 | `["Mahindra","6065","chassis"]` | 1 | 4 | 4 | 全对 |
| 10 | `["Mahindra","6065","cooling"]` | 7 | 4 | 28 | 全对 |
| 11 | `["Mahindra","6065","electrical"]` | 5 | 4 | 20 | 全对 |
| 12 | `["Mahindra","6065","engine"]` | 14 | 4 | 56 | 全对 |
| 13 | `["Mahindra","6065","fuel"]` | 10 | 4 | 40 | 全对 |
| 14 | `["Mahindra","6065","hydraulics"]` | 3 | 4 | 12 | 全对 |
| 15 | `["Mahindra","6065","lubrication"]` | 7 | 4 | 28 | 全对 |
| 16 | `["Mahindra","6065","pto"]` | 1 | 4 | 4 | 全对 |
| 17 | `["Mahindra","6065","transmission"]` | 4 | 4 | 16 | 全对 |
| 18 | `["Mahindra","6075","brakes"]` | 4 | 4 | 16 | 全对 |
| 19 | `["Mahindra","6075","chassis"]` | 1 | 4 | 4 | 全对 |
| 20 | `["Mahindra","6075","cooling"]` | 7 | 4 | 28 | 全对 |
