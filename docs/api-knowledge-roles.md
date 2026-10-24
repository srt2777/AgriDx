# 知识条目角色 API（3.9.0 起）

服务端加载 `知识库/整理后的知识库/农用拖拉机知识库/entry-roles.jsonl`（只含 `原文标记` 或 `人工核对` 依据的角色），在目录、资料库搜索和诊断响应中返回角色字段。`role-review-queue.jsonl` 里的 AI 建议（`ai_suggestion`）**不会**加载或返回。

角色取值与顺序：`symptom`（现象）→ `cause`（可能原因）→ `check`（检查）→ `action`（处理）→ `retest`（复检）。没有 `roles` 表示**尚未标注**，不等于没有该内容。

## 条目字段（`CatalogEntry`、资料库 `library.entries[]`、诊断 `knowledgeSources[]`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `roles` | `KnowledgeRole[]`，可选 | 已核对的角色，按上面的顺序 |
| `roleBasis` | `'原文标记' \| '人工核对'`，可选 | 有 `roles` 时一定有 |
| `riskLevel` | `'high' \| 'medium' \| 'low'`，可选 | 只在已核对风险等级时出现（目前没有条目有） |
| `sourceTitle` | `string`，可选 | 来源书名或网页标题（`sources.json` 的 `title`，原文不翻译） |
| `pages` | `{ pdf?: string; printed?: string }`，可选 | 从 `locator` 原样提取的 PDF 页 / 印刷页，可能是 `"60、130"` 或 `"95～96"` 这类文本 |
| `locator` | `string` | 原有字段，完整原文定位 |

## 层级覆盖计数（`GET /api/knowledge/catalog`）

品牌、型号、组件、零部件每个节点（`CatalogCounts`）新增 `roleCoverage`：

| 字段 | 说明 |
| --- | --- |
| `symptom` / `cause` / `check` / `action` / `retest` | 该节点下标注了这个角色的条目数 |
| `tagged` | 至少有一个角色的条目数 |
| `untagged` | 诊断类但尚未标注的条目数（资料索引类不计） |

和其他计数一样，同一条目可能关联多个组件或零部件，层级之间不能相加。

3.17.0 起，同一节点另提供可选 `riskCoverage`（旧接口响应缺少时显示“待补资料”，不补零推断）：

| 字段 | 说明 |
| --- | --- |
| `high` / `medium` / `low` | 有已核对 `riskLevel` 与非空 `riskBasis` 的归档条目数 |
| `reviewed` | 上述三个互斥风险类别之和 |
| `unreviewed` | 尚无风险标注依据的诊断归档条目数，表示待核实，不等于低风险 |

风险汇总排除通识学习、`diagnosticEvidence=false` 和资料信息类条目，不读取检索时的风险推断。当前没有已核对风险标注、复检角色为零；图表显示中性的“待补资料”，不表示设备正常、低风险或覆盖完成。

知识页统计卡下的分布是全库归档标注总览，与搜索词、机型筛选无关。前端只加总互不重叠的品牌根节点，校验其条数与 `totals.archivedEntries` 一致；不累加重叠的型号、组件或零件。角色计数不是互斥类别，不能作为独立条目相加。点击角色沿既有 `?collection=archive&role=` 筛选，保留搜索词并重置机型、视图与分页。风险标注与角色没有可推断的对应关系；风险缺口只展示文字，不生成角色筛选。

## 资料库搜索按角色筛选

`GET /api/knowledge/catalog?role=check&q=启动`：`role` 可选值同上；只返回 `roles` 中包含该角色的归档条目（通识条目不返回）。非法值返回 400。

## 诊断响应（`POST /api/chat`）

`ChatResponse` 新增 `roleFlow`，把本次展示的证据按 现象 → 原因／检查 → 处理 → 复检 分组：

```ts
type ChatRoleFlow = Record<'symptom'|'cause'|'check'|'action'|'retest', ChatRoleFlowStep[]> & { untaggedEntryIds: string[] };
interface ChatRoleFlowStep { entryId: string; heading: string; sourceId?: string; sourceTitle?: string; pages?: { pdf?: string; printed?: string }; locator?: string }
```

一个条目有几个角色，就出现在几组里。尚未标注的诊断条目放在 `untaggedEntryIds`。通识学习条目不参与分组。本地回复（不调用模型）会在“检索到的知识”后附加一段【按角色整理（现象 → 原因／检查 → 处理）】，列出条目编号、《书名》和页码。

## 示例

`GET /api/knowledge/catalog`（节选，久保田）：

```json
{
  "brands": [{
    "name": "久保田", "entryCount": 720,
    "roleCoverage": { "symptom": 302, "cause": 303, "check": 280, "action": 301, "retest": 0, "tagged": 303, "untagged": 417 },
    "models": [{
      "name": "LX2620",
      "roleCoverage": { "symptom": 98, "cause": 99, "check": 76, "action": 97, "retest": 0, "tagged": 99, "untagged": 70 },
      "components": [{ "id": "machine", "name": "整机与作业安全",
        "roleCoverage": { "symptom": 6, "cause": 6, "check": 6, "action": 6, "retest": 0, "tagged": 6, "untagged": 5 }, "parts": [] }]
    }]
  }]
}
```

（节选，省略了其他已有计数字段。）

条目（`selected.entries[]` 或 `library.entries[]`）：

```json
{
  "entryId": "KB-LX2620-003",
  "title": "发动机启动困难或不能启动",
  "entryType": "维护/故障知识",
  "sourceId": "SRC-KB-LX2620-6C82063118",
  "sourceTitle": "OPERATOR'S MANUAL MODELS LX2620 LX2620SU（English (U.S.A.)，Code No. 6C820-6311-8）",
  "locator": "- 证据：SRC-KB-LX2620-6C82063118，Engine troubleshooting；PDF 第 130 页；印刷第 128 页。",
  "pages": { "pdf": "130", "printed": "128" },
  "roles": ["cause"],
  "roleBasis": "原文标记"
}
```

`POST /api/chat` 的 `roleFlow`（久保田 LX2620，“发动机启动困难”，节选）：

```json
{
  "roleFlow": {
    "symptom": [{ "entryId": "TF1000-KBLX2620-001", "heading": "TF1000-KBLX2620-001｜发动机难起动或不能起动：燃油不流通",
      "sourceId": "SRC-KB-LX2620-6C82063118", "sourceTitle": "OPERATOR'S MANUAL MODELS LX2620 LX2620SU（English (U.S.A.)，Code No. 6C820-6311-8）",
      "pages": { "pdf": "130", "printed": "128" }, "locator": "故障表/发动机与进排气；PDF物理第130页；印刷128" }],
    "cause": [
      { "entryId": "KB-LX2620-003", "heading": "KB-LX2620-003｜发动机启动困难或不能启动", "sourceTitle": "OPERATOR'S MANUAL MODELS LX2620 LX2620SU（English (U.S.A.)，Code No. 6C820-6311-8）", "pages": { "pdf": "130", "printed": "128" } },
      { "entryId": "TF1000-KBLX2620-001", "heading": "TF1000-KBLX2620-001｜发动机难起动或不能起动：燃油不流通", "pages": { "pdf": "130", "printed": "128" } }
    ],
    "check": [],
    "action": [{ "entryId": "TF1000-KBLX2620-001", "heading": "TF1000-KBLX2620-001｜发动机难起动或不能起动：燃油不流通", "pages": { "pdf": "130", "printed": "128" } }],
    "retest": [],
    "untaggedEntryIds": []
  }
}
```
