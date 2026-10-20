# 照片 → img2threejs → 模型工坊

本轮在现有 React/Vite/Express 模型工坊加入上传、任务状态、自动载入 GLB，以及生成模型、TypeScript 工厂、规格和限制报告的下载。使用官方开源 img2threejs，不使用同名在线转换站、混元或 Tripo 替代。img2threejs 本身没有作为本次依赖使用的托管 HTTP API；本仓库提供私有 worker 桥接。

网页只在访客点击“上传并生成”时上传所选照片；最长边压缩到 1536 像素，每张最多 2 MiB，最多四个不同视角。照片与结果不会提交 Git。任务和文件保留 24 小时，在 worker 下次请求或启动时清理；关闭网页不会取消正在执行的任务，同一标签页刷新可恢复任务查询。任务地址包含 256 位随机标识，知道完整地址者可访问结果，不应分享私有任务链接。

## 数据路径和真实边界

1. 浏览器调用同源 `/api/modeling/capabilities`、`POST /api/modeling/jobs`。
2. Express 使用服务器专用 token 连接 `IMG2THREEJS_SERVICE_URL`。不把 worker 凭据或 Codex 凭据发给浏览器。单 IP 每小时最多一次成功提交，worker 同时最多三项待处理任务、单进程串行运行。
3. 独立 worker 保存图片，为每项任务创建独立工作目录，以文件参数调用仓库内固定 runner，永不把访客标签拼进 shell 命令。
4. runner 使用已登录的专用 Codex CLI，附带真实图片，并要求按固定版本 img2threejs 的状态、规格、分阶段生成和视觉门禁运行。代码返回 `createObjectModel(): THREE.Group`；附带 Vite/Playwright 运行环境用于实际截图及 GLB 导出，GLB 是程序化工厂的静态导出，不代表动态行为全部随文件保留。
5. runner 退出后，worker 独立运行官方 `forge/next.py --state`，只接受 `LOCAL_STATE status=complete`；仍要求非空限制报告、规格、源码及内嵌资源的 GLB。未完成、阻塞、超时或导出无效都标为失败，不能以默认拖拉机充当生成结果。此状态验证依赖智能体留下的真实证据，不是独立的重建精度认证。
6. 浏览器通过同源接口下载 GLB，再使用原有 GLB 校验和 Three.js 预览。生成的 JavaScript/TypeScript 不会直接在主站执行。源码另行作为附件下载。

独立开发站是静态浏览器预览，尚无建模进程连接，明确显示服务不可用。Node 正式站只有配置并通过 worker 环境预检后才开放生成按钮。健康预检只检查已安装依赖和登录状态，不能替代真实图片生成验收。

## 首次安装独立 worker

要求：Node ≥22.19、Python ≥3.10、Git、Codex CLI，以及可运行 Chromium 的环境。请使用独立的低权限系统用户/容器，工作目录挂载独立持久磁盘。worker 不应运行在存放网站生产密钥、诊断记忆或其他业务资料的用户下。服务默认仅监听 `127.0.0.1:3011`，跨机器连接时由管理员配置受保护的私网/TLS 通道。

以独立 worker 用户执行，先把本仓库代码放到该用户可读的目录。以下路径按实际安装位置修改，不能把这些配置写进公开 GitHub：

```sh
git clone https://github.com/img2threejs/img2threejs.git /opt/agridx-modeling/img2threejs
git -C /opt/agridx-modeling/img2threejs checkout d508b596cb221f1509f6e50ab68fce275a5cfb44
cd /opt/agridx-worker/AgriDx-v3/integrations/img2threejs/runtime
npm ci
npx playwright install chromium
```

本桥接固定官方提交 `d508b596cb221f1509f6e50ab68fce275a5cfb44`，runner 拒绝其他或已修改的受跟踪脚本。升级时须重新核对状态输出、生成协议、浏览器运行与导出，不跟随上游 main 自动更新。

为专用 worker 用户配置独立 HOME、独立 CODEX_HOME；在该用户下执行 `codex login` 完成人机登录，再以同样的 HOME/CODEX_HOME 启动服务。不要复制网站 `.env` 或生产密钥到 worker。Codex 使用账号默认模型，不在本次集成中覆盖模型选择；图片分析与建模会消耗该账号额度。

worker 进程的环境示例（值由管理员设置，token 使用随机值，不使用示例占位串）：

```text
IMG2THREEJS_WORKER_TOKEN=<至少32字符的随机共享密钥>
IMG2THREEJS_SKILL_DIR=/opt/agridx-modeling/img2threejs
IMG2THREEJS_DATA_DIR=/var/lib/agridx-modeling/jobs
IMG2THREEJS_AGENT_HOME=/home/agridx-modeling
IMG2THREEJS_CODEX_HOME=/home/agridx-modeling/.codex
IMG2THREEJS_RUNTIME_DIR=/opt/agridx-worker/AgriDx-v3/integrations/img2threejs/runtime
IMG2THREEJS_WORKER_PORT=3011
```

从 worker 仓库根启动：

```sh
node integrations/img2threejs/worker.mjs
```

建议由管理员的 systemd/container 进程管理器设置上述环境与持久目录，而非依赖网站部署目录。本集成不自动安装系统服务、不搬运凭据、不开放公网 worker 端口。

网站 Express 进程另配：

```text
IMG2THREEJS_SERVICE_URL=http://127.0.0.1:3011
IMG2THREEJS_SERVICE_TOKEN=<与worker相同的共享密钥>
```

网站现有的反向代理还需允许 `/api/modeling/jobs` 的 JSON 请求体至少 12 MiB，例如 Nginx 在相应 location 配置 `client_max_body_size 12m`。所有长耗时推理由后台任务承担，提交与查询 HTTP 不等待建模完成；任务最长 30 分钟，超时终止整个进程组。

runner 保持 Codex `workspace-write` 沙箱，允许运行本机 Vite/Playwright 所需网络。专用 worker 的出站访问由运行环境约束；不关闭沙箱、不沿用主站任意命令或访客自定义程序。主站生产 `.env` 不加载到该进程；下游仅收到专用账号目录、工具路径和运行所需配置。

## 验证与交付

```sh
node --import tsx --test tests/modeling.test.mjs
npm run verify
```

自动测试使用明确标为模拟的 runner 验证上传、私有认证、队列状态、官方状态未完成拒收、GLB 外部资源拒收和主站凭据隔离。它不调用 Codex，不消耗模型额度，不证明真实图片的重建质量。

上线验收还必须由实际配置的 worker 处理一张有权使用的农机参考图，检查真实截图、源码、规格、官方门禁记录、GLB 四角度预览与下载；不能把单元测试、按钮出现、PR合入或健康预检当作已生成成功。当前环境没有目标服务器的独立 worker 登录与配置，因此这部分尚未完成，站点应保持“建模进程未就绪”。
