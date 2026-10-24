#!/usr/bin/env bash
# Update the existing Tencent Ubuntu server; never install a fresh stack.
set -Eeuo pipefail
umask 077

readonly APP_ROOT=/opt/agridx
readonly CURRENT="$APP_ROOT/current"
readonly RELEASES="$APP_ROOT/releases"
readonly SERVICE=agridx.service
readonly APP_USER=agridx
readonly APP_PORT=8787
readonly STAGE_PORT=8788
readonly NGINX_HOST=43.128.40.157
readonly REPOSITORY=https://github.com/${GITHUB_REPOSITORY:-srt2777/AgriDx}.git
readonly DEFAULT_COMMIT=9be3056878c6519851ea2f9f7b4924c62601fa3e
readonly DROPIN_DIR=/etc/systemd/system/agridx.service.d
readonly DROPIN="$DROPIN_DIR/90-agridx-manual-release.conf"
readonly DROPIN_MARKER='# Managed by scripts/tencent-deploy/update-existing.sh'

usage() {
  printf '%s\n' '用法：sudo bash update-existing.sh --check' \
    '      sudo bash update-existing.sh --deploy [40位 Git commit SHA]' \
    '只适用于现有 /opt/agridx/current 软链接、agridx.service 和 8787 API。' \
    '保留 Nginx、证书、DNS、防火墙、定时任务及既有 EnvironmentFile。'
}
fail() { printf '[update] %s\n' "$*" >&2; exit 1; }
info() { printf '[update] %s\n' "$*"; }

MODE=${1:-}
COMMIT=${2:-$DEFAULT_COMMIT}
if [[ "$MODE" == --help ]]; then usage; exit 0; fi
if [[ "$MODE" != --check && "$MODE" != --deploy ]] || (( $# > 2 )) ||
   { [[ "$MODE" == --check ]] && (( $# != 1 )); }; then usage; exit 2; fi
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail '必须指定完整的40位小写 Git commit SHA。'
[[ "$(id -u)" == 0 ]] || fail '请使用 sudo 运行；诊断不会修改或重启服务。'

for command in systemctl runuser readlink curl node npm nginx git awk sha256sum; do
  command -v "$command" >/dev/null || fail "缺少命令：$command；本脚本不会安装系统软件。"
done
NODE_BIN=$(readlink -f "$(command -v node)")
NPM_BIN=$(readlink -f "$(command -v npm)")
# These paths go into a systemd command. Refuse ambiguous quoting and specifiers.
[[ "$NODE_BIN" =~ ^/[A-Za-z0-9_./+-]+$ && "$NPM_BIN" =~ ^/[A-Za-z0-9_./+-]+$ ]] ||
  fail 'Node/npm 路径包含不支持的字符，请先配置公共可执行路径。'
readonly NODE_BIN NPM_BIN
readonly APP_PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"

as_app() {
  runuser -u "$APP_USER" -- env PATH="$APP_PATH" bash -c 'umask 022; cd /; exec "$@"' _ "$@"
}
service_property() { systemctl show "$SERVICE" --property="$1" --value; }
unit_signature() {
  systemctl show "$SERVICE" --no-pager \
    --property=Type,User,WorkingDirectory,EnvironmentFiles,FragmentPath,DropInPaths,ExecStartPre,ExecStartPost |
    sha256sum | awk '{ print $1 }'
}

# Parse only public health metadata, never display provider configuration or keys.
validate_health() {
  "$NODE_BIN" -e '
    let body = "";
    process.stdin.on("data", part => { body += part; });
    process.stdin.on("end", () => {
      try {
        const value = JSON.parse(body);
        const expected = process.argv[1];
        const chunks = value.knowledge?.chunks;
        const entries = value.knowledge?.archivedEntries;
        const expectedChunks = Number(process.argv[2] || 0);
        const expectedEntries = Number(process.argv[3] || 0);
        if (value.ok !== true || typeof value.version !== "string" ||
            !/^\d+\.\d+\.\d+$/.test(value.version) ||
            (expected && value.version !== expected) ||
            !Number.isSafeInteger(chunks) || !Number.isSafeInteger(entries) ||
            entries <= 0 || chunks < entries ||
            (expectedChunks && chunks !== expectedChunks) ||
            (expectedEntries && entries !== expectedEntries)) process.exit(1);
        console.log(`version=${value.version} chunks=${chunks} archivedEntries=${entries}`);
      } catch { process.exit(1); }
    });
  ' "${1:-}" "${2:-0}" "${3:-0}"
}

check_existing() {
  local os_version current_path
  os_version=$(awk -F= '$1 == "VERSION_ID" { gsub(/"/, "", $2); print $2 }' /etc/os-release)
  [[ "$os_version" == 24.04 && "$(uname -m)" == x86_64 ]] ||
    fail '仅支持已确认的 Ubuntu 24.04 x86_64 实例。'
  [[ "$(awk -F= '$1 == "ID" { gsub(/"/, "", $2); print $2 }' /etc/os-release)" == ubuntu ]] ||
    fail '仅支持 Ubuntu。'
  [[ "$(service_property LoadState)" == loaded && "$(service_property ActiveState)" == active ]] ||
    fail 'agridx.service 必须已加载且运行；本脚本不初始化新服务器。'
  [[ "$(service_property User)" == "$APP_USER" && "$(service_property WorkingDirectory)" == "$CURRENT" ]] ||
    fail '现有服务运行用户或 WorkingDirectory 不匹配，未进行更新。'
  [[ "$(service_property Type)" == simple || "$(service_property Type)" == exec ]] ||
    fail '现有服务 Type 必须为 simple 或 exec，请先人工核对。'
  [[ -z "$(service_property ExecStartPre)" && -z "$(service_property ExecStartPost)" ]] ||
    fail '现有服务包含启动前后钩子，需先核实其作用；本脚本不会清空钩子。'
  [[ -L "$CURRENT" ]] || fail 'current 不是软链接；请先人工规划迁移，禁止原地 git pull。'
  current_path=$(readlink -f "$CURRENT")
  [[ "$current_path" == "$RELEASES/"* && -d "$current_path" && -f "$current_path/package.json" ]] ||
    fail 'current 必须指向 /opt/agridx/releases/ 内的完整版本目录。'
  [[ ! -L "$RELEASES" && ! -L "$DROPIN_DIR" && ! -L "$DROPIN" ]] ||
    fail 'releases 或专用 drop-in 路径存在额外软链接，请人工核对。'
  if [[ -e "$DROPIN" ]]; then
    [[ -f "$DROPIN" && "$(head -n 1 "$DROPIN")" == "$DROPIN_MARKER" ]] ||
      fail '专用 drop-in 文件已有其他内容；不会覆盖。'
  fi
  as_app "$NODE_BIN" -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 19)) process.exit(1);
  ' || fail 'agridx 用户不能执行 Node，或 Node 低于22.19.0。'
  NPM_VERSION=$(as_app "$NODE_BIN" "$NPM_BIN" --version)
  [[ "$NPM_VERSION" =~ ^([0-9]+)\.[0-9]+\.[0-9]+$ && "${BASH_REMATCH[1]}" -ge 10 ]] ||
    fail 'agridx 用户不能执行 npm，或 npm 低于10。'
  # No output from nginx -T is published: inspect only the known root/proxy pair.
  nginx -T 2>/dev/null | awk '
    $1 == "root" && $2 == "/opt/agridx/current/dist;" { root = 1 }
    $1 == "proxy_pass" && $2 == "http://127.0.0.1:8787;" { proxy = 1 }
    END { exit !(root && proxy) }
  ' || fail 'Nginx 配置不通过，或现有静态目录/API端口不匹配。'
  NGINX_USER=$(nginx -T 2>/dev/null | awk '
    $1 == "user" { value = $2; sub(/;$/, "", value) }
    END { print value }
  ')
  [[ "$NGINX_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail '无法确认 Nginx worker 运行用户。'
  info "system=Ubuntu $os_version x86_64"
  info "service=$SERVICE user=$APP_USER workingDirectory=$CURRENT"
  info "current=$current_path"
  info "node=$NODE_BIN $(as_app "$NODE_BIN" --version) npm=$NPM_VERSION"
  info "environmentFiles=$(service_property EnvironmentFiles)"
  BASELINE_HEALTH=$(curl --noproxy 127.0.0.1 --fail --silent --show-error --max-time 5 \
    "http://127.0.0.1:$APP_PORT/api/health" | validate_health) ||
    fail '现有8787健康检查未通过，停止更新以保留当前服务。'
  ORIGINAL_VERSION=${BASELINE_HEALTH%% *}
  ORIGINAL_VERSION=${ORIGINAL_VERSION#version=}
  ORIGINAL_CHUNKS=${BASELINE_HEALTH#*chunks=}
  ORIGINAL_CHUNKS=${ORIGINAL_CHUNKS%% *}
  ORIGINAL_ENTRIES=${BASELINE_HEALTH##*archivedEntries=}
  UNIT_SIGNATURE=$(unit_signature)
  info "$BASELINE_HEALTH"
}

if [[ "$MODE" == --check ]]; then
  check_existing
  info '只读检查通过；没有修改文件、拉取代码或重启服务。'
  exit 0
fi

for command in flock systemd-run nsenter install mv mktemp cmp find; do
  command -v "$command" >/dev/null || fail "缺少命令：$command；本脚本不会安装系统软件。"
done
exec 9>/run/lock/agridx-deploy.lock
flock -n 9 || fail '已有手动部署正在执行。'
check_existing

ORIGINAL_TARGET=$(readlink "$CURRENT")
ORIGINAL_RELEASE=$(readlink -f "$CURRENT")
readonly ORIGINAL_TARGET ORIGINAL_RELEASE ORIGINAL_VERSION
WORK_DIR=$(mktemp -d "$APP_ROOT/.manual-deploy.XXXXXXXX")
RELEASE="$RELEASES/$(date -u +%Y%m%dT%H%M%SZ)-${COMMIT:0:12}-$$"
STAGE_UNIT="agridx-stage-${WORK_DIR##*.}.service"
STAGE_PID=
DROPIN_EXISTED=false
CHANGED=false
SUCCESS=false
if [[ -f "$DROPIN" ]]; then
  cp -a "$DROPIN" "$WORK_DIR/previous-dropin.conf"
  DROPIN_EXISTED=true
fi

stop_stage() {
  systemctl stop "$STAGE_UNIT" >/dev/null 2>&1 || true
  systemctl reset-failed "$STAGE_UNIT" >/dev/null 2>&1 || true
}
restore_current() {
  ln -s "$ORIGINAL_TARGET" "$WORK_DIR/restore-current"
  mv -Tf "$WORK_DIR/restore-current" "$CURRENT"
}
finish() {
  local status=$? restored=true keep_backup=false
  trap - EXIT INT TERM
  stop_stage
  if [[ "$SUCCESS" != true && "$CHANGED" == true ]]; then
    info '更新未通过，正在恢复上一版本和原有专用 drop-in。' >&2
    if [[ "$DROPIN_EXISTED" == true ]]; then
      cp -a "$WORK_DIR/previous-dropin.conf" "$DROPIN" || restored=false
      cmp -s "$DROPIN" "$WORK_DIR/previous-dropin.conf" || restored=false
    else
      rm -f "$DROPIN" || restored=false
      [[ ! -e "$DROPIN" && ! -L "$DROPIN" ]] || restored=false
    fi
    restore_current || restored=false
    systemctl daemon-reload || restored=false
    if ! systemctl restart "$SERVICE" || ! wait_health "$APP_PORT" "$ORIGINAL_VERSION" '' "$ORIGINAL_CHUNKS" "$ORIGINAL_ENTRIES"; then
      restored=false
    fi
    [[ "$(readlink -f "$CURRENT")" == "$ORIGINAL_RELEASE" &&
       "$(service_property ActiveState)" == active ]] || restored=false
    if [[ "$restored" == true ]]; then
      info "已恢复上一目录：$ORIGINAL_RELEASE" >&2
    else
      info '自动回退未通过健康检查，请在腾讯云终端检查 agridx.service。' >&2
      info "恢复材料已保留：$WORK_DIR" >&2
      keep_backup=true
      status=1
    fi
  fi
  if [[ "$keep_backup" != true ]]; then rm -rf "$WORK_DIR"; fi
  if [[ "$SUCCESS" != true ]]; then
    info "本次未完成部署；新目录若已创建则保留：$RELEASE" >&2
    (( status != 0 )) || status=1
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

wait_health() {
  local port=$1 expected=$2 namespace_pid=${3:-} attempt
  for (( attempt=0; attempt<40; attempt++ )); do
    if [[ -n "$namespace_pid" ]]; then
      if ! kill -0 "$namespace_pid" 2>/dev/null; then return 1; fi
      if nsenter --target "$namespace_pid" --net curl --noproxy 127.0.0.1 \
          --fail --silent --max-time 2 "http://127.0.0.1:$port/api/health" \
          >"$WORK_DIR/health.json" 2>/dev/null &&
          validate_health "$expected" "${4:-0}" "${5:-0}" <"$WORK_DIR/health.json" >"$WORK_DIR/health-summary"; then
        cat "$WORK_DIR/health-summary"
        return 0
      fi
    elif curl --noproxy 127.0.0.1 --fail --silent --max-time 2 \
        "http://127.0.0.1:$port/api/health" >"$WORK_DIR/health.json" 2>/dev/null &&
        validate_health "$expected" "${4:-0}" "${5:-0}" <"$WORK_DIR/health.json" >"$WORK_DIR/health-summary"; then
      cat "$WORK_DIR/health-summary"
      return 0
    fi
    sleep 1
  done
  return 1
}

check_nginx_release() {
  local script_path
  curl --noproxy 127.0.0.1 --fail --silent --show-error --max-time 5 \
    --header "Host: $NGINX_HOST" http://127.0.0.1/ >"$WORK_DIR/nginx-index.html" || return 1
  cmp -s "$RELEASE/dist/index.html" "$WORK_DIR/nginx-index.html" || return 1
  script_path=$("$NODE_BIN" -e '
    const fs = require("node:fs");
    const html = fs.readFileSync(process.argv[1], "utf8");
    const path = html.match(/<script\b[^>]*\bsrc="(\/assets\/[^"]+\.js)"/)?.[1];
    if (!path || !/^\/assets\/[A-Za-z0-9._/-]+\.js$/.test(path) || path.includes("..")) process.exit(1);
    process.stdout.write(path);
  ' "$RELEASE/dist/index.html") || return 1
  curl --noproxy 127.0.0.1 --fail --silent --show-error --max-time 5 \
    --header "Host: $NGINX_HOST" "http://127.0.0.1$script_path" >"$WORK_DIR/nginx-script.js" || return 1
  cmp -s "$RELEASE/dist$script_path" "$WORK_DIR/nginx-script.js" || return 1
  if [[ -s "$RELEASE/dist/theme-init.js" ]]; then
    curl --noproxy 127.0.0.1 --fail --silent --show-error --max-time 5 \
      --header "Host: $NGINX_HOST" http://127.0.0.1/theme-init.js >"$WORK_DIR/nginx-theme.js" || return 1
    cmp -s "$RELEASE/dist/theme-init.js" "$WORK_DIR/nginx-theme.js" || return 1
  fi
  curl --noproxy 127.0.0.1 --fail --silent --show-error --max-time 5 \
    --header "Host: $NGINX_HOST" http://127.0.0.1/deployment.json >"$WORK_DIR/nginx-deployment.json" || return 1
  cmp -s "$RELEASE/dist/deployment.json" "$WORK_DIR/nginx-deployment.json" || return 1
  curl --noproxy 127.0.0.1 --fail --silent --show-error --max-time 5 \
    --header "Host: $NGINX_HOST" http://127.0.0.1/api/health | validate_health "$EXPECTED_VERSION" "$EXPECTED_CHUNKS" "$EXPECTED_ENTRIES"
}

info "准备独立版本目录：$RELEASE；现有服务继续运行。"
install -d -m 0755 -o "$APP_USER" -g "$APP_USER" "$RELEASE"
as_app git clone --depth=1 --no-checkout "$REPOSITORY" "$RELEASE"
as_app git -C "$RELEASE" fetch --depth=1 origin "$COMMIT"
as_app git -C "$RELEASE" checkout --detach "$COMMIT"
[[ "$(as_app git -C "$RELEASE" rev-parse HEAD)" == "$COMMIT" ]] || fail '检出的提交不匹配。'
EXPECTED_VERSION=$(as_app "$NODE_BIN" -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version;
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) process.exit(1);
  process.stdout.write(value);
' "$RELEASE/package.json")
[[ -n "$EXPECTED_VERSION" ]] || fail '源码中没有有效的项目版本号。'
EXPECTED_ENTRIES=$(as_app "$NODE_BIN" -e '
  const fs = require("node:fs");
  const lines = fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/).filter(line => line.trim());
  lines.forEach(line => JSON.parse(line));
  if (!lines.length) process.exit(1);
  process.stdout.write(String(lines.length));
' "$RELEASE/知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl")

# Existing dotenv files may hold credentials. Copy without reading or logging them.
# Unit EnvironmentFile paths and contents are not touched or used during staging.
for relative in .env server/.env; do
  if [[ -e "$ORIGINAL_RELEASE/$relative" || -L "$ORIGINAL_RELEASE/$relative" ]]; then
    [[ -f "$ORIGINAL_RELEASE/$relative" ]] || fail "既有 $relative 不是普通文件。"
    install -m 0600 -o "$APP_USER" -g "$APP_USER" \
      "$ORIGINAL_RELEASE/$relative" "$RELEASE/$relative"
  fi
done
# A prior sudo npm invocation may have left the service user's default cache
# owned by root. Keep this release's cache private and explicitly select it for
# every npm phase, without changing the existing home/global npm configuration.
NPM_CACHE="$RELEASE/.npm-cache"
install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "$NPM_CACHE"
as_app env npm_config_cache="$NPM_CACHE" NPM_CONFIG_CACHE="$NPM_CACHE" bash -c \
  'cd "$1" && "$2" "$3" ci --cache "$4" --include=dev --no-audit --no-fund && "$2" "$3" run build --cache "$4" && "$2" "$3" prune --cache "$4" --omit=dev --no-audit --no-fund' \
  _ "$RELEASE" "$NODE_BIN" "$NPM_BIN" "$NPM_CACHE"
[[ -s "$RELEASE/dist/index.html" && -s "$RELEASE/server.ts" &&
   -s "$RELEASE/ui/public/models/tractor-detailed-v1.glb" ]] || fail '构建或静态模型文件不完整。'
# Public metadata ties both backend and CDN-served frontend to this exact commit.
# Only public file hashes are included; environment and credentials stay private.
as_app "$NODE_BIN" -e '
  const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
  const [release, commit, version] = process.argv.slice(1);
  const dist = path.join(release, "dist");
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[A-Za-z0-9._/-]+\.(?:js|css))"/g)].map(match => match[1]);
  const paths = [...new Set(["/index.html", "/theme-init.js", ...assets])];
  if (!assets.some(value => value.endsWith(".js")) || paths.some(value => value.includes(".."))) process.exit(1);
  const files = paths.map(value => ({ path: value, sha256: crypto.createHash("sha256")
    .update(fs.readFileSync(path.join(dist, value))).digest("hex") }));
  fs.writeFileSync(path.join(dist, "deployment.json"), JSON.stringify({ commit, version, files }) + "\n", { mode: 0o644 });
' "$RELEASE" "$COMMIT" "$EXPECTED_VERSION"
if [[ -f /var/lib/agridx-github-sync/controller.json ]]; then
  install -m 0644 -o "$APP_USER" -g "$APP_USER" \
    /var/lib/agridx-github-sync/controller.json "$RELEASE/dist/deployment-automation.json"
fi
runuser -u "$NGINX_USER" -- test -r "$RELEASE/dist/index.html" ||
  fail 'Nginx worker 无法读取新网页；未切换 current。'
find "$RELEASE/dist" -type f -print0 | runuser -u "$NGINX_USER" -- bash -c '
  while IFS= read -r -d "" file; do [[ -r "$file" ]] || exit 1; done
' || fail 'Nginx worker 无法读取新静态资源；未切换 current。'

# A private network namespace prevents a temporary 0.0.0.0 listener being public.
# Stage does not load the real unit's EnvironmentFile or call external LLM APIs.
systemd-run --quiet --unit="$STAGE_UNIT" --property=Type=exec \
  --property="User=$APP_USER" --property="Group=$APP_USER" \
  --property="WorkingDirectory=$RELEASE" --property=PrivateNetwork=yes \
  --property=TimeoutStopSec=10 --setenv=NODE_ENV=production \
  --setenv="PORT=$STAGE_PORT" --setenv="PATH=$APP_PATH" \
  "$NODE_BIN" --import tsx "$RELEASE/server.ts"
STAGE_PID=$(systemctl show "$STAGE_UNIT" --property=MainPID --value)
[[ "$STAGE_PID" =~ ^[1-9][0-9]*$ ]] || fail '临时服务未启动。'
wait_health "$STAGE_PORT" "$EXPECTED_VERSION" "$STAGE_PID" 0 "$EXPECTED_ENTRIES" ||
  fail '独立版本健康检查未通过；current 和原服务未切换。'
nsenter --target "$STAGE_PID" --net curl --noproxy 127.0.0.1 --fail \
  --silent --show-error --max-time 5 "http://127.0.0.1:$STAGE_PORT/" >/dev/null ||
  fail '独立版本静态网页检查未通过。'
EXPECTED_CHUNKS=$("$NODE_BIN" -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).knowledge.chunks))' "$WORK_DIR/health.json")
stop_stage

[[ "$(readlink "$CURRENT")" == "$ORIGINAL_TARGET" &&
   "$(service_property User)" == "$APP_USER" &&
   "$(service_property WorkingDirectory)" == "$CURRENT" &&
   "$(unit_signature)" == "$UNIT_SIGNATURE" ]] ||
  fail '构建期间现有部署配置发生变化，停止切换。'
if [[ "$DROPIN_EXISTED" == true ]]; then
  [[ ! -L "$DROPIN" ]] && cmp -s "$DROPIN" "$WORK_DIR/previous-dropin.conf" ||
    fail '构建期间专用 drop-in 发生变化，停止切换。'
else
  [[ ! -e "$DROPIN" && ! -L "$DROPIN" ]] || fail '构建期间出现新的专用 drop-in，停止切换。'
fi
cat >"$WORK_DIR/new-dropin.conf" <<EOF
$DROPIN_MARKER
[Service]
Environment=NODE_ENV=production
Environment=PORT=$APP_PORT
ExecStart=
ExecStart=/usr/bin/env NODE_ENV=production PORT=$APP_PORT $NODE_BIN --import tsx server.ts
EOF
install -d -m 0755 "$DROPIN_DIR"
CHANGED=true
install -m 0644 "$WORK_DIR/new-dropin.conf" "$DROPIN"
systemctl daemon-reload
ln -s "$RELEASE" "$WORK_DIR/new-current"
mv -Tf "$WORK_DIR/new-current" "$CURRENT"
systemctl restart "$SERVICE"
wait_health "$APP_PORT" "$EXPECTED_VERSION" '' "$EXPECTED_CHUNKS" "$EXPECTED_ENTRIES" || fail '正式服务健康检查未通过。'
check_nginx_release || fail 'Nginx 网页、脚本或 API 检查未通过。'
[[ "$(service_property ActiveState)" == active && "$(readlink -f "$CURRENT")" == "$RELEASE" ]] ||
  fail '正式服务或 current 状态不匹配。'
SUCCESS=true
info "部署完成：version=$EXPECTED_VERSION commit=$COMMIT"
info "上一版本保留：$ORIGINAL_RELEASE"
info 'Nginx、证书、DNS、防火墙、cron 和现有 EnvironmentFile 未修改。'
