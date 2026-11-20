# 开发站知识条核对

清单依据 [4.1.50 分支提交](https://github.com/srt2777/AgriDx/commit/e32d11c33e896b0dfc79e09508bade8d30e8eb28) 的目录生成。包含相对开发站 4.1.43 新增的 304 个编号和 1,104 个机型对应关系。后续对正文的正常修改也会触发差异，需按提交重新核对。

在此目录安装 playwright-core 并通过 Playwright 安装 Chromium，或将 BROWSER_EXECUTABLE 设为已有 Chromium 内核浏览器的路径。运行以下命令核验开发站，也可在命令末尾传入本机开发构建的网址。

```sh
node verify-catalog.cjs
```

脚本通过网页的知识库入口加载实际构建，在每个匹配型号下核对条目、来源、标题、原文位置和完整正文 SHA-256，并检索八个下架编号。输出包括实际版本、提交、成功数和差异清单，存在差异会返回非零退出码。
