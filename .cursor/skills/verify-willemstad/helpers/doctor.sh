#!/usr/bin/env bash
# Read-only: is this preview instance worth driving?

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib.sh"

fail() {
  echo "DOCTOR FAIL: $*" >&2
  exit 1
}

ok() {
  echo "DOCTOR OK: $*"
}

require_cmd python3
require_cmd curl
require_theme_css
load_run_meta || fail "no launch metadata"

pid_is_alive "${VERIFY_PID}" || fail "pid ${VERIFY_PID} is not running"
pid_matches_verify_server "${VERIFY_PID}" "${VERIFY_PID_START}" || fail "pid ${VERIFY_PID} identity does not match this verifier server"

health="$(curl -fsS --max-time 3 "${VERIFY_BASE_URL}/healthz")" || fail "/healthz not reachable at ${VERIFY_BASE_URL}"

python3 - "${health}" "$(manifest_version)" "$(theme_css_version)" "${VERIFY_PID}" "${VERIFY_BIND}" "${VERIFY_PORT}" <<'PY' || fail "healthz payload mismatch"
import json, sys
health = json.loads(sys.argv[1])
manifest_v, css_v, pid, bind, port = sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5], int(sys.argv[6])
assert health.get("ok") is True, health
assert health.get("version") == manifest_v, (health.get("version"), manifest_v)
assert health.get("themeCssVersion") == css_v == manifest_v, (health.get("themeCssVersion"), css_v, manifest_v)
assert int(health.get("pid")) == pid, (health.get("pid"), pid)
assert health.get("bind") == bind
assert int(health.get("port")) == port
assert int(health.get("themeCssBytes", 0)) > 100000
PY

python3 - "${VERIFY_BASE_URL}/theme.css" "$(manifest_version)" <<'PY' || fail "/theme.css header is not this checkout's theme"
import sys, urllib.request
url, version = sys.argv[1], sys.argv[2]
with urllib.request.urlopen(url, timeout=30) as resp:
    if resp.status != 200:
        raise SystemExit(f"status {resp.status}")
    banner = resp.read(4000).decode("utf-8", "replace")
needle = f"Willemstad | v{version}"
if needle not in banner:
    raise SystemExit("banner missing")
PY

curl -fsS --max-time 3 "${VERIFY_BASE_URL}/preview/reading.html" >/dev/null || fail "/preview/reading.html missing"
curl -fsS --max-time 3 "${VERIFY_BASE_URL}/preview/callouts.html" >/dev/null || fail "/preview/callouts.html missing"

if owner="$(ss -ltnp "sport = :${VERIFY_PORT}" 2>/dev/null | tr -d '\n')"; then
  if [[ -n "${owner}" && "${owner}" != *"${VERIFY_PID}"* ]]; then
    fail "port ${VERIFY_PORT} is not owned by pid ${VERIFY_PID}: ${owner}"
  fi
fi

if chrome="$(find_chrome)"; then
  ok "chrome=${chrome}"
else
  echo "DOCTOR WARN: no Chrome/Chromium on PATH; drive.sh will fail" >&2
fi

ok "pid=${VERIFY_PID} url=${VERIFY_BASE_URL} version=$(manifest_version)"
echo "${health}"
