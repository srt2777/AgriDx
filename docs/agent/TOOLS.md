# 工具与权限

当前 `/api/agent/run` 的工具被可信宿主绑定到已经过 schema 校验的本次问题，参数 schema 为不接受额外字段的空对象。模型或请求不能通过工具参数替换机器、角色或确认。以下四个工具已接入规则流程：

| 工具 | 使用时机 / 区别 | 返回 |
| --- | --- | --- |
| extract_fault_entities | 检索前摘录本次机型与候选代码；不推断原因 | 机器档案、代码、用户陈述标记 |
| ask_user_clarification | 品牌或完整型号缺失时；不检索跨机型资料 | 三个关键信息问题 |
| search_knowledge_base | 身份明确且无代码时；现象归一后 BM25/关键词融合 | 引用、渠道、证据级别、适用范围 |
| lookup_fault_code | 身份明确且有代码时；全快照精确共匹配 | 同上；缺失代码元数据则不猜含义 |

实际例子：

```json
{"query":"发动机启动困难","machine":{"brand":"久保田","model":"LX2620"}}
{"query":"P001是什么意思","machine":{"brand":"久保田","model":"LX2620"},"faultCode":"P001"}
```

故障码示例仅演示请求格式，不表示该机型真的支持该代码或库里存在其含义。

`Registry` 自定义工具定义包括 `name / description / parameters / returns / side_effect / timeout_ms / retryable / requires_confirmation / cache_ttl / tags / version / execute`。`cache_ttl` 单位为毫秒，仅在可信宿主提供 `cacheScope` 的只读调用中启用；每个工作流使用独立实例。缓存上限 64 项，分页上限 32 项、60 秒有效；游标按任务归属校验且单次消费。

写入或危险工具必须同时满足角色权限、参数 schema、宿主确认和审计。审计启动失败时不执行；完成审计失败时报告状态不确定，不自动重试。HTTP 入口没有这些工具，也不接受 `confirmed`、角色或任意工具名。

返回统一为 `{ok,data,error,meta}`；错误不返回异常原文。当前支持 NOT_FOUND、INVALID_ARGS、PERMISSION_DENIED、NEEDS_CONFIRMATION、CANCELLED、TIMEOUT、INTERNAL。尚未实现原始工具清单中的其余检索、图谱、写入和管理工具；不注册伪成功的空实现。
