# 开发站一览（按开发者）

整理时间：2026-11-01。来源：仓库登记 `.openai/development-sites.json` 与
`docs/deployment/development-sites.md`，团队名单见 `CONTRIBUTING.md`，
在线版本为 2026-11-01 对两站 `/api/health` 的实测结果。
详细登记与同步规则仍以 `docs/deployment/development-sites.md` 为准，
本表只是它的按开发者一览，不取代原登记。

## 登记要求

每位开发者的 AgriDx 开发站都必须记录下来并归到本表，不得只留在个人
Sites 账号里不登记。新站上线、访问方式变更或下线时，站主须在同一轮
PR 里同步更新登记表、`.openai/development-sites.json` 和本表三处，
必填网址、GitHub 账号、Sites 所有者显示名、建立时间、初始版本与提交、
访问方式、项目 ID 和 `/api/health` 实测的当前在线版本；缺少证据写
“未核实”，不补猜，不把公开站默认算到某人名下。未登记的站不计入本表。

## 已登记的开发站（共 2 个）

| 开发站 | 开发者 / 所有者 | 访问方式 | 建立时间（上海） | 初始版本 | 2026-11-01 实测在线版本 |
| --- | --- | --- | --- | --- | --- |
| [AgriDx v4 开发版](https://agridx-v4-development.orangeglade33.chatgpt.site) | Changjie29（Sites 所有者显示名 changjie；用户委托 Codex 通过 Sites 创建） | 仅所有者（owner-private） | 2026-10-26 19:36:28（Sites create_site 原生回执） | 4.4.0 / `783b565e8b2ff7733d7246ff733287e80f2245dc` | 4.0.28 / `9912d4d`，网关 1.1.0，LLM 已配置（DeepSeek / deepseek-flash），默认 auto、允许外部 AI |
| [原公开开发站](https://agridx-dev-preview.z3464715478.chatgpt.site) | 创建者未核实；当前账户无法读取旧站管理信息，不能确认当前平台所有者 | 公开，任何链接持有者可匿名访问 | 2026-10-12 为历史首次发布记录，平台准确创建时间未核实 | 初期版本与历史提交见 `docs/deployment/dev-preview.md` | 4.0.28 / `9912d4d`，网关 1.2.0，LLM 未配置，默认 knowledge_only、外部 AI 关闭 |

两个开发入口都读取 `srt2777/AgriDx` 的 `dev-preview-built` 完整构建，
main 每次 push 触发 `Development preview` 工作流验证、构建后发布，
所以两站的在线源码版本会一起跟随 main 变化；上面两站的网关版本与
AI 配置不同（V4 站网关 1.1.0 且已配 DeepSeek，公开站网关 1.2.0 且未配 LLM），
不能把两站的配置当成同一个。

项目 ID：V4 站 `appgprj_6adf3b38eac48191a7139d92f2e1a357`；
公开站 `appgprj_6accea9518e08191ba29e1f8b0f8725e`。
两站存储与设置独立。

## 开发者分别有没有开发站

团队名单按 `CONTRIBUTING.md` 2026-10-12 的确认，四人仓库权限均为 admin。
“未找到”只表示仓库登记里没有该人名下的开发站，不等于该人私下一定没有
未登记的个人站点。

| 开发者（GitHub 账号） | 仓库权限 | 仓库登记中的开发站 |
| --- | --- | --- |
| Changjie29 | admin | 有：AgriDx v4 开发版（已确认，见上表） |
| jianshiting920-web | admin | 未找到 |
| jingxinnie0414-dev | admin | 未找到 |
| bai1022 | admin | 未找到 |

## 不计入的站点

- 腾讯正式站：是正式生产环境，不是开发站，不计入本表。
- 原公开开发站的创建者未核实，因此不能把它算到上述任何一位开发者名下，
  也不能因为它公开就默认它是某位协作者的个人开发站。
