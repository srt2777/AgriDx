# 开发站知识条核对

清单依据 [4.1.50 分支提交](https://github.com/srt2777/AgriDx/commit/e32d11c33e896b0dfc79e09508bade8d30e8eb28) 的目录生成。包含相对开发站 4.1.43 新增的 304 个编号和 1,104 个机型对应关系。后续对正文的正常修改也会触发差异，需按提交重新核对。

在此目录安装 playwright-core 并通过 Playwright 安装 Chromium，或将 BROWSER_EXECUTABLE 设为已有 Chromium 内核浏览器的路径。运行以下命令核验开发站，也可在命令末尾传入本机开发构建的网址。

```sh
node verify-catalog.cjs
```

脚本通过网页的知识库入口加载实际构建，在每个匹配型号下核对条目、来源、标题、原文位置和完整正文 SHA-256，并检索八个下架编号。输出包括实际版本、提交、成功数和差异清单，存在差异会返回非零退出码。

4.1.49 的[公开开发站实测回执](public-4.1.49.json)对应提交 3ee8599f69f26954368652c7bd65923cbcaea351。复验该版时，网址后再传入 catalog-4.1.49.json。

运行 `node verify-questions.cjs` 可复验两条完整手册问答，包括首条引用的知识编号、印刷页码、答复中的技术条件及数值。网址可作为第一个参数传入。

4.1.50 已在用户指定的开发站复验，网页提交为 `a83ad980b20dd9fd1aa16bee967a1a337d5f2374`。[目录核验](public-4.1.50.json)覆盖 304 个新增编号、1,104 个机型对应关系及八个下架编号。[问答核验](public-4.1.50-questions.json)记录 8R 冷却液辅助加热器和 5E 前大灯对光的回答、首条引用及印刷页码。

[4.1.52 本批清单](catalog-4.1.52-delta.json)覆盖 56 条国行 7M 手册知识和 16 条东方红 LF1504 电气知识。用同一目录脚本传入该清单，可对比 128 个机型对应关系。运行 `node verify-7m-lf1504.cjs [网址]` 核验九个问题，包括较早序列号、零件号、国四与错机型排除。[本地构建目录核对](local-4.1.52-delta.json)及[本地问答实测](local-4.1.52-questions.json)对应分支提交 cac85f9。LF1504 电气提问返回手册页引用和安全停机提示，7M 进气提问直接返回手册参数。

4.1.54 的[待上线核对清单](catalog-4.1.54-delta.json)覆盖四批共 141 个新增编号和 430 个条目与机型组合。用仓库两个版本的 Markdown 正文独立计算摘要，已与此前 4.1.52 的 72 条目录清单逐字段比对一致。此清单用于开发站部署后的验收。

```sh
python3 build-catalog-delta.py /path/to/AgriDx a83ad98 8951fd7 > catalog-4.1.54-delta.json
node verify-catalog.cjs https://agridx-v4-development.orangeglade33.chatgpt.site/ catalog-4.1.54-delta.json
```

开发站 4.1.54 已用浏览器核对主库提交 970afec。四批 141 条、430 个机型组合全部匹配，八个下架编号均未出现。[完整目录](public-4.1.54-delta.json)、[7M 与 LF1504 九种问法](public-4.1.54-7m-lf.json)、[宁波和奔野五种问法](public-4.1.54-ningbo-benye.json)。问答记录包含实际返回的正文和引用，可区分直接答复、资料引用与停机提示。

4.1.55 东风六机型的本地构建按 [89 条正文](catalog-4.1.55-delta.json) 核验，266 个机型组合匹配。[六道真实提问](local-4.1.55-questions.json) 直接检查答复中的两对尺寸、停机时间、原页及错品牌排除。4.1.56 东方红与时风的 [83 条验收清单](catalog-4.1.56-delta.json) 用于新版开发站复验。
