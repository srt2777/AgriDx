# 仿真监测协议与后端生成器

仿真是正式功能，始终明示来源。当前没有真实传感器输入。共享协议、配置与后端纯生成器已接入有上限的内存运行时及SSE/history；前端迁移仍是下一批工作，现有监测页面尚未消费新接口。

## 来源与隔离

- `shared/telemetry.ts` 定义设备、通道、采样点、告警、目录与帧。`source`预留`simulated | device`；当前配置和生成结果只允许`simulated`。
- 固定水印为`仿真数据 / Simulated data`。目录与帧携带水印；每条采样含来源，告警固定叫“仿真告警”。前端监测区必须另有固定徽章和色带，不能只依赖导出字段。
- 同一`partId`由`deviceId`划定范围；通道ID全局唯一。设备对应`diesel`/`t70`两个现有结构示意，部件ID来自各自`public/models/*/parts.json`，不宣称绑定实车或实车CAD。
- 仿真模块不导入诊断、检索、知识目录或统计模块；数值不进入知识查询、覆盖率、质量统计或设备档案。未来携带摘要必须由每次会话默认关闭的独立选项授权，并在模型提示与回答保留仿真声明。

## 字段约定

| 对象 | 主要字段与语义 |
| --- | --- |
| 设备 | `id`、`modelId`、中英`name`、`source` |
| 通道 | `id`、`deviceId`、实际`partId`、中英`name`、`unit`、`kind`、`range`、`precision`、`source`、`threshold`；状态通道用`valueLabels`解释枚举数值 |
| 采样点 | `channelId`、`deviceId`、`source`、`at`（Unix毫秒）、`elapsedMs`（仿真相对时间）、有限`value` |
| 告警 | `id`、通道/设备/部件关联、时间与值、`severity=attention|alarm`、双语仿真告警名、完整演示阈值出处；不是故障结论 |
| 目录 | `schemaVersion=1`、水印与来源、种子、采样/心跳/延迟时长、设备/通道/场景描述；不向前端提供基线、噪声或场景脚本 |
| 帧 | `schemaVersion=1`、水印与来源、`runId`、递增`sequence`、时间、场景相对时钟/循环标记、采样点及当前仿真告警；序号由后续运行时分配 |

## 演示配置

[config/telemetry-demo.json](../config/telemetry-demo.json)是唯一量程、曲线参数、场景脚本与阈值来源。默认种子为 **2777**（无符号32位整数），当前21路通道覆盖柴油发动机/散热器/蓄电池/变速箱/液压提升/前后桥/油箱，以及电动模型电池舱/GPS/两侧顶传感器/四轮毂。电池压差和定位偏移量分别用于对应演示场景。

所有基线和量程都是通用演示设定，未经厂家核对，不能作为机型标准、维修参数或设备读数。配置根及每个非空阈值均要求`source: "demo"`、`note: "仿真演示阈值,非厂家标准"`。没有演示阈值的通道显式`threshold: null`：仅画趋势、显示“未配置阈值”，不输出正常/异常或告警结论。

阈值使用显式`above`/`below`，严格越界触发；同一值满足两级时取`alarm`优先。告警只从此配置计算，配置没有的阈值不补造；真实设备来源、未知通道、跨设备、非有限或超量程点不进入演示告警。`normal`是场景名称，不能当作真实设备正常判定。

配置加载校验来源、种子、时长、缓冲上限、唯一ID、设备引用、双语名称、有限量程/精度、状态枚举、阈值出处及场景关键帧。错误配置拒绝加载，不悄悄替换成厂家参数。实际部件绑定在测试中对照两个模型清单。

## 确定性与场景

`server/telemetry/simulator.ts`不在导入时启动计时器或监听端口，也不修改环境变量。`simulateTelemetry(config, options)`按调用方提供的种子、相对时间和起点生成：

`基线 + 以通道/时间结点散列的平滑噪声 + 日周期 + 场景偏移`

噪声按相邻时间结点平滑插值，不依赖`Math.random()`、调用顺序、其他通道数量或系统当前时钟。按配置精度舍入并限于配置量程，状态通道只返回有标签的整数。相同种子与输入时钟得到相同曲线；更换绝对起点只改变时间戳。

五个场景为正常运行、冷却液温度缓慢爬升、电池压差扩大、定位漂移、液压提升缓慢。每个场景由`durationMs`和按通道配置的`[相对毫秒, 偏移量]`关键帧描述；偏移按平滑步进连接，首尾归零，未涉及通道继续同一条基线曲线。默认120秒场景在20秒后开始偏离（散热器轨道25秒后），80秒附近达到演示偏移，结束恢复基线。所有时间以JSON为准。

调用方可以独立传`scenarioElapsedMs`触发场景，同时保留总采样时钟；`loop=true`按配置周期循环，默认不循环。切回`normal`不重置噪声序列。UI场景选择与授权的场景控制留到后续PR，不在当前批新增操作接口。

## 读取接口与运行时

`server/telemetry/runtime.ts`由服务器运行时创建，每个应用共用一个生产者。默认`TELEMETRY_MODE=simulated`；`off`或未知模式均关闭读取且不加载仿真配置。可通过`TELEMETRY_SEED`指定无符号32位十进制种子，默认2777，非法种子拒绝初始化。配置示例见根目录`.env.example`，不增加真实设备令牌或ingest路由。

导入模块和构造生产者不启动计时器。首次读取/订阅时生成采样并启动可清理的后台计时器；帧由所有SSE客户端与history共用，不按连接重新造数。内存环形缓冲默认3600帧，配置硬上限3600，每帧含21路当前采样；长时间暂停后的补帧同样最多保留一圈，时钟回退不产生倒序点。无数据库或磁盘遥测文件。重启会丢弃历史并生成新`runId`。

### GET /api/telemetry/history

必须传单个`channel`（全局通道ID）。`window`仅支持`5m`、`15m`、`1h`，省略默认`5m`；空值、重复/数组值、非法通道格式或未知参数为400，未知通道为404。只返回所选通道及窗口中缓冲现有的点，不补造启动前的历史。

响应为`TelemetryHistory`，含`schemaVersion`、`source=simulated`、`watermark`、`runId`、公开通道描述、`window`、`from/to`和`points`；设置`Cache-Control: no-store`。采样含来源，导出此响应须保留水印或来源字段；前端自行生成图片仍须另加可见水印。

### GET /api/telemetry/stream

SSE不接受查询参数；HEAD明确返回405/Allow: GET，避免被Express自动转到持续GET连接。`Content-Type: text/event-stream`，禁缓存/变换，`X-Accel-Buffering: no`。首个`catalog`事件附`retry: 3000`（原生EventSource的重试间隔），提供公开通道、种子、时长与固定仿真水印，不提供噪声或脚本。

| SSE事件 | 内容及游标 |
| --- | --- |
| `catalog` | 每次连接的`TelemetryCatalog`，无id |
| `telemetry` | `TelemetryFrame`，id为`runId:sequence`，同一run递增，含固定水印和仅simulated采样/仿真告警 |
| `heartbeat` | 按目录`heartbeatMs`发送（默认15秒），含schemaVersion/source/watermark/当前Unix毫秒，无id，不前移采样游标或刷新采样新鲜度 |
| `reset` | 含schemaVersion/source/watermark/runId及reason：`server_restart`、`history_expired`、`cursor_ahead`；客户端应清理旧run并重新读history，无id |

首次连接发送最新一帧。断线重连使用标准`Last-Event-ID`：只接受有上限的`runId:正整数sequence`，不回显非法输入；游标仍在缓冲且落后不超过30帧时只重放后续帧。更早游标、不同run或超前游标先发送reset，再发送最新帧；大缺口由history补读，不无限重放。相同最新游标可只接收心跳，直到新采样产生。

限流沿用既有每IP每分钟30次中间件，history与SSE握手共用该配额；SSE同时限制每IP4条、应用共32条连接。每条SSE遵守drain背压，待写事件最多64条，待写数据及Node写缓冲合计最多256KiB；超限直接销毁慢连接并释放订阅/心跳/连接名额，不能把待刷新响应无限留在内存。正常断开同样清理。

两端点关闭时返回503/`telemetry_disabled`；限流429/`rate_limited`，连接上限429/`telemetry_connection_limit`，未知通道404/`telemetry_channel_not_found`，无效输入400/`bad_request`。意外错误复用既有脱敏500响应，不把内部路径、异常或配置传给客户端。`POST /api/telemetry/ingest`仍为未实现的404。

前端基础位于`src/features/telemetry/`与`src/hooks/useTelemetry.ts`，生产监测组件尚待下一批接入。一个标签页共用一个按订阅计数的原生EventSource，原生重连保留Last-Event-ID，手动retry会丢弃旧连接与缓存；最后观察者离开后关闭连接、计时器与未完成历史请求，同一tick内重订阅复用连接以兼容Strict Mode。卸载后再进入会创建新EventSource，旧原生游标不再存在，因此主动重新读取选中通道历史，避免把未观察期间的缺口当连续数据。

目录/帧/history都先校验schema、固定水印、simulated来源、设备/通道范围、有限数值与演示阈值出处；目前拒绝device数据，不能借预留类型伪造来源。无阈值通道不能接收告警。迟到的旧run历史、重复帧、重置前请求不会进入新run；数据不写localStorage、设备档案或统计。

`useTelemetry({modelId, partId})`按部件自动选择通道，或通过`channelIds`选择最多4路。选中通道共用一次1h历史读取，前端可在本地切时间窗；每通道最多3600点，不按时间窗重复下载，避免消耗握手/历史共用限流配额。合并历史保留较新的流采样，图表用最多240点的分桶最小/最大值降采样，保留首尾及峰值，返回原采样而非插值/平均造数。文字表或数据导出仍可用原始有界点列，导出必须保留仿真标记。

共享`telemetryConnectionState`只按新采样收到时间判断新鲜度，心跳不重置它：连接断开为离线，超过目录N秒无新点为延迟，simulated新点为仿真；仅未来device来源允许实时标签。hook同时提供loading/ready/empty/error及各通道历史状态和重试，图表需单独显示加载/失败/无数据及文字替代。纯静态开发预览明确不可用，不开流、不调用本地知识预览代替监测，也不在前端自产数。

既有`FaultDetectionPage/demo.ts`仍有独立前端仿真，必须在监测组件/场景阶段迁移到同一流并保留功能，不能长期保留第二条造数路径。指标卡、趋势图、固定徽章/色带与图像导出等UI验收尚未完成。

## 未来真实设备接入（本阶段不实现）

`POST /api/telemetry/ingest`仅保留设计约定，没有路由或令牌配置。将来接入须先确认真实数据来源和设备注册范围，使用服务器环境令牌、鉴权、限流、严格字段白名单、请求体与批次上限。

建议批次字段为`schemaVersion`、已注册`deviceId`、`source: "device"`、唯一批次/序号及`samples[]`；每个样本含已注册`channelId`、Unix毫秒`at`、有限`value`。单位与所属部件来自注册通道，客户端不得自行指定来源、阈值或跨设备部件。应拒绝未知设备/通道、重复/倒序批次、超时戳、非有限数值和未授权来源。真实阈值必须有对应手册/厂家出处，不得复用演示阈值或把模拟帧改一个source字段当作设备数据。

## 验证

运行 `node --import tsx --test tests/telemetry-simulator.test.ts tests/telemetry-runtime.test.ts tests/telemetry-api.test.ts`。测试覆盖实际部件引用、确定性/场景/有限量程/阈值/源隔离，以及环形缓冲上限、窗口校验、重放/重置、定时采样、心跳、新鲜度、背压/断开清理、限流、关闭模式及脱敏。完整项目仍须`npm run verify`通过，GitHub CI、合并与未部署证据分别记于PR。
