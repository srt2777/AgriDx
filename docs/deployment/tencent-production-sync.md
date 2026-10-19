# GitHub、开发版与腾讯正式版自动同步

2026-10-14（上海）。用户要求 GitHub、开发版、腾讯正式版实时同步，并要求 PR 自动部署。执行约定为：个人分支通过 PR 检查、审阅并合入 main 后，开发版和正式版自动更新。此最新授权覆盖此前腾讯自动发布暂停；原 Sites 生产站继续暂停。任务成果保存到 `srt2777/AgriDx-v3`。

## 后续默认执行约定（2026-10-15）

用户明确授权“合并并且部署，以后都是”。后续本项目授权修改完成必要验证和PR审阅后，默认主动合入main并部署开发站及腾讯正式站，不重复征求合并/部署确认。仍以成功CI、实际运行提交、健康接口和网页资源验收为完成依据；部署请求、控制器安装与正式站上线分别记录。原Sites继续暂停，用户后续指令优先。

## 历史核查结果（2026-10-14）

- 核查时 GitHub main 和匿名开发网址均为 **3.4.7**，提交 `7a94ebf807b7dc7dd27b3707cdd6de3885eef33b`；开发构建记录实际返回该完整提交。
- 正式域名 `https://agridx.xyz` 首页 HTTP 200，健康返回 **3.1.1**、412 条归档、421 个片段；用户确认可正常打开。两边尚未同步。
- 用户补充服务器系统 Ubuntu Server 24.04 LTS 64bit、登录用户 `ubuntu`。现有服务器 IP / 应用部署结构见[历史记录](2026-10-11-tencent-existing-server.md)：`43.128.40.157`、`agridx.service`、`/opt/agridx/current`、API 8787。域名目前经过 CDN，SSH 不使用 CDN 节点 IP。
- 本次 Codex 云环境没有可用 SSH/TCP 通路，GitHub Secrets 接口返回 403。最终方案由服务器读取公开仓库的部署请求，**不需要 GitHub 保存服务器密码、SSH 私钥或云 API 密钥**。用户登录密码不写入源码、命令或记录。
- 本次尚未在腾讯服务器执行接入。GitHub 保存、发布请求、安装控制器和实际公网更新分别记录，不把准备流程当成正式站已经升级。

## 自动同步流程

1. PR 通过项目检查、审阅并合入 main。现有 `Development preview` 自动验证、构建并发布固定[开发网址](https://agridx-dev-preview.z3464715478.chatgpt.site)，构建记录 `/dev-preview.json` 包含版本和源码完整提交。
2. main 的跨平台 `CI` 成功后，[`Tencent production`](../../.github/workflows/tencent-production.yml) 为同一提交更新 `tencent-production-ready` 分支指针。只接受本仓库 main 的 push / 手动 CI；PR、个人分支、失败 CI 和过期提交不产生请求。请求指针仅快进，不强推；手动运行正式工作流必须选择 main，连接发布请求前再次执行完整验证。
3. 腾讯服务器新安装的 systemd timer 每 20 秒检查公开 Git refs。只有请求 SHA 等于当时最新 main，且尚未部署时，才调用[现有分目录更新脚本](../../scripts/tencent-deploy/update-existing.sh)。不恢复旧 `cloud-pull.sh`、旧 cron 或香港初始化脚本。
4. 现有脚本继续完成独立目录构建、临时私网健康检查、current 原子切换、本机 Nginx/健康验收及失败回退；旧版本、EnvironmentFile、证书、DNS、防火墙和其他服务保留。同一失败提交五分钟内不会反复构建，新 main 可立即尝试。systemd 与 flock 串行执行部署，GitHub 等待任务被取消不会中断服务器部署。
5. 公开 `deployment.json` 只记录版本、完整提交和首页/主题脚本/入口 JS、CSS 摘要。Actions 等待服务器更新，并从正式 HTTPS 域名核对后端版本、知识条数、提交和资源 SHA-256，识别 CDN 旧文件。先用独立参数确认目标源站资源已就绪，再检查无查询参数、无强制回源头的普通首页、发布清单、健康和知识目录。普通首页必须匹配同一HTML摘要，接口版本/计数及清单必须一致；只要普通入口仍旧就以`cdn_cache_stale`失败，不把防缓存请求成功写成用户访问已同步。main 已前进时，旧验收任务停止等待，交由新任务发布最新请求。

若服务器尚未接入，Actions 只发布请求，明确记录待接入，不宣称网站更新完成。接入后的公网最终验收失败会使 Actions 报错；不擅自回滚本机已经健康的新版本。验收范围不包括全部页面交互或真实外部模型问答。

## 仅需一次服务器安装

先合入并核对本 PR 的实际完整提交 SHA。在腾讯云网页终端用 `ubuntu` 登录，复制执行下列命令，把 `INSTALL_SHA` 替换为本 PR 已审阅的40位提交 SHA：

```bash
INSTALL_SHA=填入已审阅的40位提交SHA
[[ "$INSTALL_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
curl -fsSL "https://raw.githubusercontent.com/srt2777/AgriDx-v3/$INSTALL_SHA/scripts/tencent-deploy/install-auto-pull.sh" -o /tmp/agridx-install-sync.sh && sudo bash /tmp/agridx-install-sync.sh --install "$INSTALL_SHA"
```

安装器从固定 SHA 下载两份工具，先只读检查实际服务器的 Ubuntu/Node/Nginx/current/service 和旧版健康。检查失败不创建控制器；成功才安装 root 所有、不可被应用用户修改的工具、私有状态目录和新 systemd 单元。已有同名未知单元或软链接会拒绝覆盖。

| 安装项目 | 路径 |
| --- | --- |
| 更新脚本 / 同步控制器 | `/usr/local/lib/agridx-github-sync/` |
| 私有控制器状态 | `/var/lib/agridx-github-sync/` |
| 单次部署服务 | `agridx-github-sync.service` |
| 20 秒检查 timer | `agridx-github-sync.timer` |
| 公开接入标志 | `/deployment-automation.json` |

安装后 timer 等待最新 main 的成功 CI 请求；请求已存在时会自动更新。构建和验证有实际耗时，整体是**检查通过后的分钟级同步**，不是每次提交瞬间发布。工具由固定已审阅 SHA 安装，网站源码随最新成功 main 自动更新；后续维护部署工具时重新运行已审阅安装器。

## 查看、验收与暂停

3.5.1起，正式网页也会自动检查同源`/deployment.json`并安全加载新版；不再只有服务端更新、已打开页面仍停留旧脚本。频率、输入保护、网络失败和防循环边界见[网页自动加载](automatic-client-update.md)。未经过main检查及部署的个人分支仍不会发布。

```bash
sudo systemctl status agridx-github-sync.timer --no-pager
sudo journalctl -u agridx-github-sync.service -n 80 --no-pager
curl -fsS https://agridx.xyz/api/health
curl -fsS https://agridx.xyz/deployment.json
```

首次接入后可手动运行 main 的 `Tencent production` 重新等待公网验收：`gh workflow run tencent-production.yml --repo srt2777/AgriDx-v3 --ref main`。当前 GitHub CLI 不需要服务器 Secrets 权限。

暂停服务器后续自动部署：`sudo systemctl disable --now agridx-github-sync.timer`。不停止已经在运行的部署，让其完成或通过原脚本回退。暂停 GitHub 发布请求可在 Actions 禁用 `Tencent production`，或将可选仓库变量 `TENCENT_DEPLOY_ENABLED` 设置为 `false`；默认发布请求，但只有显式安装了控制器的服务器才会执行。正式网址可通过可选变量 `TENCENT_PUBLIC_URL` 配置，默认 `https://agridx.xyz`。

部署失败先查看上述单元日志与 `agridx.service`，不通过修改 DNS 回退。GitHub CI、公网版本、开发构建记录与页面资源结果以本次实际回执为准。

## CDN入口旧缓存的处理边界

2026-10-19实际核查发现，带独立参数的正式站已是3.5.8/10877条，但普通`/`仍命中10月11日的CDN旧缓存，浏览器显示3.2.0/212条，裸知识目录接口也返回212条。源站新版本和知识正文并未丢失；普通访问仍未完整同步。详见[本次全量核查](2026-10-19-production-sync-audit.md)。

必须在该域名的腾讯云CDN控制台刷新旧入口/接口缓存，并核对节点及浏览器缓存规则。首页、`/index.html`、`/api/`、`/deployment.json`、`/deployment-automation.json`和`/theme-init.js`不应被长期旧缓存遮挡；带内容哈希的`/assets/`静态资源继续按原策略保留。先检查现有规则及优先级，仅更改本域名动态入口，不清全账号、不改DNS/权限/密钥。原服务器部署控制器没有CDN管理权限，代码更新或重启服务不能代替CDN操作。

官方操作依据：[缓存刷新](https://cloud.tencent.com/document/product/228/6299)、[节点缓存规则](https://cloud.tencent.com/document/product/228/47672)。规则变更和刷新请求仍需有权限的控制台执行，并在任务完成后用不带版本参数的原始网址及实际浏览器重新验收；提交刷新请求本身也不等于缓存已清理。
