#!/usr/bin/env bash
# New opt-in systemd controller; never use the historical cloud-pull/cron code.
set -euo pipefail
umask 077
readonly REPOSITORY=https://github.com/${GITHUB_REPOSITORY:-srt2777/AgriDx}.git
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly CURRENT=/opt/agridx/current
readonly STATE_DIR=/var/lib/agridx-github-sync
readonly LOCK=/run/lock/agridx-github-sync.lock
fail() { printf '[github-sync] %s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || fail '同步控制器必须由 root 运行。'
exec 9>"$LOCK"
flock -n 9 || exit 0

# Public Git refs need no GitHub token or server login credential. A request is
# eligible only while it exactly equals main; forks/history cannot select code.
refs=$(git ls-remote --exit-code "$REPOSITORY" refs/heads/main refs/heads/tencent-production-ready)
latest=$(awk '$2 == "refs/heads/main" { print $1 }' <<< "$refs")
ready=$(awk '$2 == "refs/heads/tencent-production-ready" { print $1 }' <<< "$refs")
[[ "$latest" =~ ^[0-9a-f]{40}$ ]] || fail '无法确认最新 main。'
[[ "$ready" =~ ^[0-9a-f]{40}$ && "$ready" == "$latest" ]] || exit 0

if [[ -f "$CURRENT/dist/deployment.json" ]] && node -e '
  try {
    const value = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    process.exit(value.commit === process.argv[2] ? 0 : 1);
  } catch { process.exit(1); }
' "$CURRENT/dist/deployment.json" "$ready"; then exit 0; fi

# Avoid a failing commit allocating another release every twenty seconds.
now=$(date +%s)
if [[ -f "$STATE_DIR/last-failure" ]]; then
  read -r failed_sha failed_at < "$STATE_DIR/last-failure" || true
  if [[ "${failed_sha:-}" == "$ready" && "${failed_at:-}" =~ ^[0-9]{1,12}$ ]] &&
      (( now - 10#$failed_at < 300 )); then exit 0; fi
fi
printf '[github-sync] 更新已通过CI的main：%s\n' "$ready"
if /bin/bash "$SCRIPT_DIR/update-existing.sh" --deploy "$ready"; then
  rm -f -- "$STATE_DIR/last-failure"
else
  printf '%s %s\n' "$ready" "$(date +%s)" > "$STATE_DIR/last-failure"
  fail '更新未通过，保留/恢复旧版；五分钟后重试，新main不受本次等待限制。'
fi
