#!/usr/bin/env bash
# Install only the new controller on the already running Tencent server.
set -euo pipefail
umask 077
readonly TOOL_DIR=/usr/local/lib/agridx-github-sync
readonly STATE_DIR=/var/lib/agridx-github-sync
readonly SYSTEMD_DIR=/etc/systemd/system
readonly CURRENT=/opt/agridx/current
readonly MARKER='# Managed by scripts/tencent-deploy/install-auto-pull.sh'
fail() { printf '[install-sync] %s\n' "$*" >&2; exit 1; }
[[ $# == 2 && "$1" == --install && "$2" =~ ^[0-9a-f]{40}$ ]] ||
  fail '用法：sudo bash install-auto-pull.sh --install <已审阅的40位工具提交SHA>'
readonly COMMIT=$2
[[ "$(id -u)" == 0 ]] || fail '请使用 sudo 运行。'
for location in "$TOOL_DIR" "$STATE_DIR" "$SYSTEMD_DIR"; do
  [[ ! -L "$location" ]] || fail "安装路径存在软链接：$location"
done
for unit in agridx-github-sync.service agridx-github-sync.timer; do
  target="$SYSTEMD_DIR/$unit"
  [[ ! -L "$target" ]] || fail '已有systemd路径存在软链接，停止安装。'
  if [[ -e "$target" ]]; then
    [[ -f "$target" && "$(head -n 1 "$target")" == "$MARKER" ]] ||
      fail '已有同名systemd配置不属于本工具，停止安装。'
  fi
done

workdir=$(mktemp -d)
trap 'rm -rf -- "$workdir"' EXIT
for script in update-existing.sh sync-main.sh; do
  curl --fail --silent --show-error --location --max-time 60 \
    "https://raw.githubusercontent.com/${GITHUB_REPOSITORY:-srt2777/AgriDx}/$COMMIT/scripts/tencent-deploy/$script" \
    --output "$workdir/$script"
  bash -n "$workdir/$script"
done
# Read-only checks precede any installed file or timer. The existing service,
# Ubuntu/Node/Nginx layout and healthy old version must already be present.
/bin/bash "$workdir/update-existing.sh" --check
install -d -m 0755 -o root -g root "$TOOL_DIR"
install -d -m 0700 -o root -g root "$STATE_DIR"
install -m 0700 -o root -g root "$workdir/update-existing.sh" "$workdir/sync-main.sh" "$TOOL_DIR/"
cat > "$workdir/agridx-github-sync.service" <<EOF
$MARKER
[Unit]
Description=Deploy verified AgriDx GitHub main
After=network-online.target agridx.service
Wants=network-online.target
[Service]
Type=oneshot
User=root
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/bin/bash $TOOL_DIR/sync-main.sh
TimeoutStartSec=25min
EOF
cat > "$workdir/agridx-github-sync.timer" <<EOF
$MARKER
[Unit]
Description=Check verified AgriDx main every twenty seconds
[Timer]
OnBootSec=30s
OnUnitInactiveSec=20s
AccuracySec=1s
Unit=agridx-github-sync.service
[Install]
WantedBy=timers.target
EOF
install -m 0644 -o root -g root "$workdir/agridx-github-sync.service" "$workdir/agridx-github-sync.timer" "$SYSTEMD_DIR/"
printf '%s\n' '{"controller":"agridx-github-sync","repository":"srt2777/AgriDx","configured":true}' > "$workdir/controller.json"
install -m 0600 -o root -g root "$workdir/controller.json" "$STATE_DIR/controller.json"
install -m 0644 -o root -g root "$workdir/controller.json" "$CURRENT/dist/deployment-automation.json"
systemctl daemon-reload
if ! systemctl enable --now agridx-github-sync.timer; then
  systemctl disable --now agridx-github-sync.timer || true
  rm -f -- "$STATE_DIR/controller.json" "$CURRENT/dist/deployment-automation.json"
  fail '定时器未启动，未完成接入；原应用仍保持原部署。'
fi
printf '%s\n' '自动同步控制器已安装。等待main的CI成功请求；安装回执不等于网站已升级。' \
  '查看：sudo journalctl -u agridx-github-sync.service -n 80 --no-pager' \
  '暂停：sudo systemctl disable --now agridx-github-sync.timer'
