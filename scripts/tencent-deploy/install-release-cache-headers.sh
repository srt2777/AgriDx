#!/usr/bin/env bash
# Give /deployment.json and the controller flag a no-store response.
# Hashed /assets/ files are left on the existing long-cache rule.
# A failed nginx -t restores the site file. This script never changes certificates,
# DNS, or unrelated server blocks, and a skip does not fail the deployment.
set -euo pipefail
umask 022

readonly MARKER='agridx-release-cache.conf'
readonly SNIPPET_DIR=${AGRIDX_NGINX_SNIPPET_DIR:-/etc/nginx/snippets}
readonly SNIPPET="$SNIPPET_DIR/$MARKER"
readonly CONF_ROOT=${AGRIDX_NGINX_CONF_ROOT:-/etc/nginx}

say() { printf '[cache-headers] %s\n' "$*" >&2; }

dump=$(nginx -T 2>/dev/null) || { say '无法读取 Nginx 配置，跳过。'; exit 0; }
file=$(awk '
  /^# configuration file / {
    current = $4
    sub(/:$/, "", current)
  }
  $1 == "root" && $2 == "/opt/agridx/current/dist;" && current != "" { print current; exit }
' <<< "$dump")
[[ -n "$file" && -f "$file" && ! -L "$file" ]] || { say '未定位到静态目录所在的普通配置文件，跳过。'; exit 0; }
case "$file" in
  "$CONF_ROOT"/*) ;;
  *) say '配置文件不在允许目录内，跳过。'; exit 0 ;;
esac
if grep -q "$MARKER" "$file"; then exit 0; fi

mkdir -p "$SNIPPET_DIR" || { say '无法创建片段目录，跳过。'; exit 0; }
tmp=$(mktemp "$SNIPPET_DIR/.agridx-release-cache.XXXXXX")
cat > "$tmp" <<'EOF'
# Managed by scripts/tencent-deploy/install-release-cache-headers.sh
# Release identity must not sit in a shared cache. Hashed build files keep their own rule.
location = /deployment.json {
    add_header Cache-Control "no-store" always;
}
location = /deployment-automation.json {
    add_header Cache-Control "no-store" always;
}
EOF
mv -f "$tmp" "$SNIPPET"

backup=$(mktemp)
cp -a "$file" "$backup"
awk -v include="    include $SNIPPET;" '
  $1 == "root" && $2 == "/opt/agridx/current/dist;" && !inserted {
    print
    print include
    inserted = 1
    next
  }
  { print }
' "$backup" > "$file"

if ! nginx -t >/dev/null 2>&1; then
  cp -a "$backup" "$file"
  rm -f "$backup"
  say 'nginx -t 未通过，已恢复原配置。'
  exit 0
fi
rm -f "$backup"
if ! nginx -s reload >/dev/null 2>&1; then
  say '配置已通过检查，但 reload 未成功。'
  exit 0
fi
say '已为 /deployment.json 与 /deployment-automation.json 加上 Cache-Control: no-store。'
