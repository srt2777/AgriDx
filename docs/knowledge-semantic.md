# 维修知识库增量语义去重

2026-10-17 整合验收：3.5.0 对 4,853 条执行真实规则模式全量与增量扫描，共 41,119 对候选（互补 909、范围变体 1,171、不确定 39,039），增量复用 4,853 条且记录、关系与快照一致。未自动删除或合并，未加载真实模型权重；候选数不是重复结论或准确率。下文 2,213 条及当时版本为工具初次交付的历史范围，详见[整合记录](integration/20261016-all-open-prs.md)。

这是离线、待人工审核的清洗工具，复用3.4.9索引校验、正文定位、输入快照及报告路径保护。原始维修知识、来源索引和验证状态始终只读；候选关系不是事实错误或合并决定。工具不接入诊断请求，不改变诊断检索或三种AI协调模式，不使用生产向量数据库，也不调用DeepSeek、Gemini或其他外部AI。

## 架构与模型选型

执行顺序为现有规则校验、只读特征提取、候选召回、保守关系分类、报告及人工审核。来源编号、知识编号、精确车型、配置、排放、来源边界、条目边界、正文适用条件和原文位置保留在结果中。Markdown仍是事实正文的唯一副本，不向`entries.jsonl`新增正文或向量字段。

候选召回先使用规范化文本、内容哈希、已有`case_key`及本地词项。规范化保留数值、小数点、单位、否定和安全限制，不把同一症状或相同`case_key`当成重复证明。有本地模型时增加向量候选；没有本地模型时保留规则模式。候选比较不按车型预先过滤，避免漏掉需要分别保留的适用范围变体。

规范化正文、`case_key`和相同症状各自组成桶，桶内候选完整枚举；倒排词项仅使用出现在2～128条记录中的词，按稀有词权重选各条top-k，避免常见模板词造成全部两两比较。向量候选按余弦阈值选各条top-k，与规则候选取并集；分块矩阵乘积避免保留完整N×N相似度矩阵，但向量候选计算仍有平方级计算成本。本阶段面向2213条语料，不宣称该方式可直接满足百万级知识库的成本要求。

本地模型选择比较如下。参数来自官方模型卡或配置，不是本仓库的维修语料评测结果；权重大小指单份模型文件，不是完整依赖、模型目录或峰值内存。

| 模型 | 官方结构及权重 | 中文维修语料适配判断 | CPU与离线部署取舍 |
|---|---|---|---|
| `BAAI/bge-small-zh-v1.5`，推荐可选模型 | 24M参数，4层，512维，512 token；单份safetensors约95.8MB；MIT | 训练语言与当前中文知识卡匹配，仍需用人工标注的维修术语样本验证同义、单位及安全限制 | 层数和单份权重较小，适合作为首个CPU验证对象；本环境尚无真实吞吐或准确率结论 |
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`，多语言备选 | 12层，384维，SentenceTransformer默认128 token；单份safetensors约471MB；50种语言；Apache-2.0 | 后续混合语言资料有价值，尚未证明其中文维修术语效果优于前者 | 共享Sentence Transformers及CPU PyTorch依赖；模型文件更大、默认窗口更短，长知识卡需要分块 |
| 规则模式 | Python标准库和现有规则校验依赖，不加载模型 | 可解释的有限同义映射与字面候选，不等价于通用语义理解 | 无需下载模型；用于缺模型回退、离线基线及增量一致性验证 |

官方来源：[BGE模型卡](https://huggingface.co/BAAI/bge-small-zh-v1.5)、[BGE配置](https://huggingface.co/BAAI/bge-small-zh-v1.5/blob/main/config.json)、[BGE文件](https://huggingface.co/BAAI/bge-small-zh-v1.5/tree/main)；[MiniLM模型卡](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)、[MiniLM配置](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/blob/main/config.json)、[MiniLM文件](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/tree/main)；[Sentence Transformers加载参数](https://www.sbert.net/docs/package_reference/sentence_transformer/model.html)。

本实现使用可选的Sentence Transformers本地CPU适配器。运行时只接受调用者已准备好的本地模型目录，不发现或下载远端模型；不以模型名称隐式联网。模型须有标准`modules.json`和safetensors权重，拒绝自定义模块、远程代码、符号链接及pickle类旧权重。加载使用`local_files_only=True`、`trust_remote_code=False`及离线环境设置。完整模型文件内容、依赖版本和适配器身份参与缓存失效。

长正文按模型token窗口连续分块，不静默截断。每块向量归一化后按token数加权汇总，再作L2归一化；分块、池化及归一化策略版本进入模型身份。不能解码或无效向量必须触发明确失败或规则回退，不能用零向量冒充语义结果。BGE在此执行文本相似度任务，不添加检索query前缀。

可选依赖不进入现有Node应用或诊断服务的运行依赖。CPU PyTorch、Sentence Transformers和tokenizer的安装体积随平台及版本变化；离线部署应在目标机器验证依赖锁定、完整模型文件和磁盘预算。ONNX及量化是后续可独立评估的适配方案，本次未声称已支持或评测。

## 运行与后台隔离

要求Python 3.10+，现有索引校验的PDF依赖要求继续适用。使用可选模型前，调用者需自行在独立环境准备CPU版PyTorch轮子、[可选依赖约束](../知识库/工具/requirements-semantic.txt)及标准本地模型目录；不要把GPU/CUDA依赖默认带入CPU部署。该约束是兼容范围，尚不是已验证部署锁；在目标平台通过真实模型验收后冻结完整版本和轮子哈希。离线机使用预备wheelhouse执行 `pip install --no-index --find-links /path/to/wheels -r 知识库/工具/requirements-semantic.txt`。本命令不安装依赖或下载权重。`PYTHON`可指定解释器。

```bash
# 默认不保存任何报告或缓存；auto在没有本地模型时明确回退规则模式
npm run knowledge:dedup

# 可重复的规则基线；质量缓存和语义缓存使用不同文件
npm run knowledge:dedup -- --mode rules --quality-cache server/data/knowledge-quality/quality-cache.json --cache server/data/knowledge-quality/semantic-cache.json --report server/data/knowledge-quality/semantic-report.json --markdown server/data/knowledge-quality/semantic-report.md

# 强制本地模型；缺模型、缺依赖或推理失败时报错
npm run knowledge:dedup -- --mode local --model-dir /absolute/path/to/bge-small-zh-v1.5 --cache server/data/knowledge-quality/semantic-cache.json --report server/data/knowledge-quality/semantic-report.json --markdown server/data/knowledge-quality/semantic-report.md

# 绕过已存特征和关系进行全量重算，用于核对增量结果
python3 -B 知识库/工具/语义去重.py --mode rules --full --cache server/data/knowledge-quality/semantic-full-cache.json --report server/data/knowledge-quality/semantic-full.json
```

`--mode auto|rules|local`默认`auto`；`--top-k`默认12，`--threshold`默认0.75，`--checkpoint-every`默认100。top-k和阈值控制召回预算，不是合并阈值，也不是经过人工评测证明适用于全部维修知识的固定标准。语义分数仅在实际使用本地模型时存在，规则回退不会把字面分数冒充向量相似度。

独立Node包装器异步启动Python子进程，退出码及终止信号向调用者传播；为该子进程设置OMP/MKL/OpenBLAS单线程预算并禁用tokenizer线程池。直接运行Python时由管理员设置等价环境限制。Express启动、HTTP诊断和聊天请求均不触发清洗。终端命令等待完成；管理员可用已有作业调度器，或在Unix shell后台运行：

```bash
mkdir -p server/data/knowledge-quality
npm run knowledge:dedup -- --mode rules --cache server/data/knowledge-quality/semantic-cache.json --report server/data/knowledge-quality/semantic-report.json --markdown server/data/knowledge-quality/semantic-report.md > server/data/knowledge-quality/semantic-run.log 2>&1 &
```

这是离线任务入口，不是网页任务API或持久队列。共享CPU、内存和磁盘仍可能竞争，应在低负载时段调度并使用操作系统资源限制；不依据离线运行时间承诺诊断请求在任意负载下零影响。

## 六类关系与人工审核

每条关系都为`review_state: pending`，附双方证据、判断依据及建议动作。没有自动合并、删除、状态升级或索引回写路径。

| 关系 | 判断边界 | 推荐审核动作 |
|---|---|---|
| `exact_duplicate` | 剔除来源和核验元数据后的规范化事实及关键适用条件一致 | 回看双方原文和来源，决定是否整理重复引用 |
| `semantic_duplicate` | 故障、原因和措施在有限、显式同义映射后均一致，额外限制与适用条件一致 | 人工确认语义及所有限制，不能仅凭分数合并 |
| `partial_overlap` | 故障、原因和措施存在同向文本包含，较长记录还有额外内容 | 保留独有步骤、限制及安全要求 |
| `complementary` | 故障现象相同，而原因或维修措施不同 | 作为并列排查知识保留，核对差异是否合理 |
| `scope_variant` | 车型、配置、排放、来源边界或工况不同，或一侧适用范围未知 | 按原范围分别保留，不扩展适用车型 |
| `uncertain` | 数值、单位、否定、安全要求不同，结构证据缺失，或现有规则不足以证明关系 | 保留原文并请人工逐项核对 |

数值、单位、否定和安全限制差异优先阻止重复判断。同症状不等于同原因，同原因不等于相同维修措施。对自由段落和旧知识卡不补造缺失字段；向量找到的近义表述若超出可解释证据，保留为`uncertain`。本实现追求可审核线索，不能把有限分类规则的覆盖率称为通用中文语义理解准确率。

重复候选组仅用于审核导航。图中的候选链不证明全部成员两两重复，也不证明这些知识可传递合并。报告中的互补、范围变体和不确定关系同样需要保留原记录。

## 增量、失效与断点恢复

首先调用现有`校验索引.py`，消费同一质量报告、快照和正文定位，不重写一套来源完整性校验器。质量报告存在`error`时，语义报告标为`blocked: true`，关系列表为空且CLI以1退出；不会把损坏输入交给模型。`warning/info`不自动等同于阻断。`--quality-cache`是可选的3.4.9规则缓存；`--cache`是语义特征及关系缓存，必须使用不同路径。缓存是派生计算结果，不是知识权威。

每次重新读取当前索引并验证输入哈希。新增条目仅计算新增特征，但与旧条目和同批次新条目共同召回；修改条目重算受影响关系；已撤回条目和关系不进入当前报告。相同内容的行号移动需要刷新证据位置，不能沿用陈旧引用。稀有词分数按排序后的词项累加，并以条目编号打破并列，避免Python哈希种子或索引顺序影响浮点并列候选。特征缓存使用条目正文而非整张Markdown文件作依赖，同文件追加知识卡不会迫使未变条目重新推理。

候选集合每次重新构建，保证新增记录能进入旧记录的近邻、同批新增相互比较及删除后的top-k变化。可复用未变向量，以及双方特征和计算身份均未变化的关系分类。增量不等于完全省去旧记录检索或相似度计算；报告分别记录特征重用、实际编码和关系重用。全量模式用于比较相同输入、配置和模型下的当前关系结果，报告生成时间和执行计数不要求相同。

失效依赖包括正文和条目元数据、关联来源及适用边界、质量快照及其规则、候选/分类实现、质量校验器实现和版本、候选参数、模型文件内容、依赖与适配器版本、分块及池化方式。模型不可用后切换为规则模式时不得混入此前模型的向量或关系。只看文件mtime或模型目录名称不足以保证有效性。

显式指定语义缓存才保存断点。阶段性检查点只保存可验证的派生结果；重新运行先核对当前输入和计算身份，再复用匹配内容。输入变化、损坏缓存、规则或模型变化应重算，不能把未完成检查点当完整报告。每次发布检查点前以及最终发布前检查知识输入和模型文件稳定性。扫描期间知识输入或模型文件变化时不能发布可信的完成缓存，应重跑稳定快照。

## 报告与输出路径

JSON报告的`schema_version: 1`、`rules_version: 1.0.0`。`summary`含`entries/new/modified/reused/removed/candidates/by_relation`；`incremental`区分特征检查、特征复用、向量实际编码和关系分类复用；`performance.elapsed_ms`计量扫描耗时。`snapshot`及完整`quality`沿用3.4.9规则报告，`model`明确实际规则回退或本地模型身份。

`records`按条目编号集中保存来源、完整范围、原始状态和完整证据位置，避免在成千上万关系中重复这些长字段。`relations.left/right`引用记录编号与来源；关系仍内联正文路径和行号。`relations`逐对记录稳定`relation_id`、双方条目及来源、适用范围、原始与分类核验状态、正文和JSONL真实行号、语义分数、候选生成器、判断依据、推荐动作及`review_state: pending`。规则模式的`semantic_similarity`为`null`。`duplicate_groups`只收录完全重复、语义重复和部分包含的直接双边，不把范围变体或互补知识包装为待合并组。Markdown呈现同一结果，表格内容转义后输出。完整报告与缓存放在忽略目录，仓库中的示例明确标为示例，不把节选当全量扫描。

默认无输出文件。显式JSON、Markdown及缓存路径沿用现有路径保护：仓库内仅允许`server/data/knowledge-quality/`或`work/knowledge-quality/`；禁止覆盖知识原件、索引、模型和源码，且不同输出不能共用同一缓存路径，输出文件也不能相互覆盖。路径检查同时考虑词法路径和符号链接解析后的路径。仓库外的显式目标由调用者选择，具有替换目标文件的语义，应使用专用报告目录。

文件以UTF-8读写，标准输出和错误输出也明确UTF-8，兼容Windows管道。报告和缓存分别以同目录临时文件加原子替换写入，替换前关闭临时文件，避免Windows占用问题。多个输出文件不是跨文件事务；下游读取时核对快照和计算身份。

## 人工标注、验证及性能边界

人工标注样本使用[JSON样本协议](../tests/fixtures/semantic-pairs.json)：顶层`schema_version`、`provenance`与`pairs`；每对含`id/category/left/right/expected_relation/candidate_expected/rationale`。`provenance`记录标注来源、流程与复审状态，`left/right`记录事实、车型及适用范围；实际维修样本还应保留原始证据标识和标注版本。覆盖同义表达，同症状不同原因，同原因不同措施，不同车型及排放，数值、单位、否定、安全禁令，不同来源引用相同事实，以及新增、修改、撤回后的更新。样本应同时包含应召回与不应召回的负例。

没有人工标注的样本只能用于流程测试；模型自己的分类不能作为评估真值。本次20对样本由助手依据关系定义编写，`label_source: assistant_authored_synthetic`，明确待人类独立标注/复核；属于合成期望回归，不能替代领域人员独立标注的真实维修评测集。候选召回率应以人工指定的应召回关系为分母，分类精确率和误报率必须说明类别、分母及候选生成范围；未标注的2213条全库不能据模型输出推算准确率。

验收同时比较全量和增量当前结果，测试新增/修改/删除、来源和范围变更、规则/模型身份变化、坏缓存、恢复断点、相同大小及恢复mtime的内容变更、输出别名、知识只读、旧代码页和缺模型回退。真实本地模型尚未取得时，以受控适配器测试离线、分块和缓存协议，明确不将其称为真实模型效果或吞吐测试。

本轮基于PR #41已合并后的main `5311109`，未改2213条原知识。真实规则扫描得到19,406条候选关系：882条`complementary`、210条`scope_variant`、18,314条`uncertain`，`exact_duplicate/semantic_duplicate/partial_overlap`均为0。这里的0表示当前保守规则没有证明完整重复或包含，不表示知识库不存在语义重复。原质量报告仍为0 error、0 warning、1219 info，状态分类未修改。

[JSON节选](knowledge-semantic-example.json)与[Markdown节选](knowledge-semantic-example.md)只展示3条真实关系，完整报告保存在忽略目录；节选保留全库统计并明确省略数量。`records.scope_original`保留原始车型、配置、边界和use文本；规范化比较字段单列，不覆盖原文。

20对助手编写的合成期望样本：应召回19/19；关系与声明期望一致20/20；重复误报0/16个非重复样本。一个无关负例仍被字面候选召回（1/1），说明召回预算需要用真实人工集校准，不能因分类保守就宣称没有候选噪声。各类别精确率、召回率、完整混淆表和计量分母见[合成回归评估结果](knowledge-semantic-evaluation.json)。这些是对合成期望的回归指标，不是人工金标准或真实维修准确率。评估命令：

```bash
python3 -B tests/evaluate_semantic.py --report server/data/knowledge-quality/evaluation.json
# 独立人工标注并复审后，按相同schema提供新集；必须保留标注者、版本和原始证据
python3 -B tests/evaluate_semantic.py --dataset /path/to/reviewed-pairs.json --mode local --model-dir /path/to/local-model
```

Linux x86_64、Python3.12.14、2 vCPU/8GiB限制；完成项目验证后独立测量，各3次：全量重算6446.904～9708.031ms，中位8420.951ms；无变化增量4163.244～5242.988ms，中位4614.235ms。增量复用2213条特征及19,406条关系，真实embedding编码数为0。六次扫描的快照、记录、关系及直接重复组内容哈希一致。每次仍执行质量输入哈希和重建候选集合，增量不承诺只读取新增磁盘文件。

进程峰值RSS约306.6MiB，包含六次扫描及最后一次报告序列化；全量/增量耗时包含规则、哈希、候选及缓存写入，不含最终报告输出。JSON 33,265,013字节，额外写出909.499ms；Markdown 23,160,639字节，额外写出790.918ms。记录元数据集中保存，完整报告仍较大，建议按关系类型离线筛选审核。保守验收预算：当前2213条规则模式全量30秒内、无变化增量15秒内、峰值512MiB内；这不是诊断响应SLA，也不是冷磁盘、生产负载或真实模型性能。

本地47项新增Python语义/安全回归和4个Node入口回归通过，既有30项规则回归保留；完整项目验证256项中254通过、2项平台跳过，类型检查、Lint及前后端构建通过。既有Fast Refresh和Three.js包大小提示仍存在。

尚未取得实际模型权重，也没有领域人员独立标注集。因此真实embedding候选召回、维修分类精确率、CPU推理吞吐、模型依赖安装体积及模型峰值内存仍待验收，不能用规则或模拟向量指标替代。PR用于审查实现与规则基线，不自动启用模型或部署。

## 模板折叠、AI 预审与人工审核（3.7.3）

`知识库/工具/语义预审.py` 复用上文 `scan()` 的候选，不另起召回，也不改上文六类关系。新增三步：

1. **模板折叠**：同一来源中，把机型名、编号、Section/Group 号换成占位符后正文相同、且机型不同的条目归为一个 `scope_variant` 簇（`TG-…`），整簇只看一次，只加标签。2026-10-21 全量：110 簇、500 条（主要是 `KB-JD-TM901519` 目录条目）。
2. **分级**：其余候选按字符 3-gram Jaccard（默认 ≥0.8）筛选。跨来源的记为 `dup_candidate`；现有规则理由里有数值、单位、否定或安全差异的记为 `conflict_candidate`；同来源高相似（多为同手册不同主题）记为 `same_source_similar`，只写报告、不送审。同日结果：dup 3 对、conflict 2 对、同来源 1835 对。
3. **AI 预审（默认关闭）**：`--reviewer none` 是默认值，不调用 AI，也不生成结论。`--reviewer command` 从环境变量 `AGRIDX_DEDUP_REVIEWER_CMD` 读一个维护者自备的命令：每对候选通过 stdin 以 JSON 传入（含提示词、双方正文与元数据），命令在 stdout 返回 `{relation: duplicate|complementary|scope_variant|conflict|unrelated|uncertain, keep_both, reason, evidence_spans}`。字段不合规就记为错误，不写结论。`AGRIDX_DEDUP_REVIEWER_MODEL` 记录模型名。仓库目前没有可用的 AI 密钥，也没有附带调用模型的适配器，所以这一步还没真实运行过，提交的审核文件里 `ai_verdict` 全部为空。只在离线批处理里运行，不接入诊断请求，`--limit` 限制每次送审的对数。

人工审核文件 `知识库/整理后的知识库/农用拖拉机知识库/dedup-review.jsonl` 每行一对，字段为 `pair_id, a, b, jaccard, cosine, tier, ai_verdict, ai_model, reviewer, decision(pending|keep|merge|supersede|conflict), decided_at, kb_version`。`--write-review` 按 `pair_id` 增量合并：新候选追加为 `pending`；已决定的行不变，也不再送审；已经消失的候选保留原行。审核人直接编辑 `decision`、`reviewer`、`decided_at`。

工具**永不删除、永不修改条目或正文**。`merge`/`supersede` 由维护者在知识整理 PR 里手工处理，原条目保留，并按知识更新规则升 `kb_version`。

```bash
python3 -B 知识库/工具/语义预审.py --report server/data/knowledge-quality/prereview.json   # 只看
python3 -B 知识库/工具/语义预审.py --write-review                                          # 合并到审核文件
python3 -B 知识库/工具/语义预审.py --check                                                 # CI：未审数量只作警告
```

CI 在 Ubuntu 上运行 `--check`，设为 `continue-on-error`：未审的 dup/conflict 候选以 GitHub 警告显示，不阻断合入，也不影响 `ci-verify`。
