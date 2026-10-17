#!/usr/bin/env bash
# Shared paths and helpers for verify-willemstad. Source this file; do not execute it.

set -euo pipefail

_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${_LIB_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SKILL_DIR}/../../.." && pwd)"

# Walk up until manifest.json is at the repo root. theme.css is required
# separately so a sparse/partial checkout can still print a next step.
_probe="${REPO_ROOT}"
for _ in 1 2 3 4; do
  if [[ -f "${_probe}/manifest.json" ]]; then
    REPO_ROOT="${_probe}"
    break
  fi
  _probe="$(cd "${_probe}/.." && pwd)"
done

if [[ ! -f "${REPO_ROOT}/manifest.json" ]]; then
  echo "error  manifest.json is not checked out" >&2
  echo "try: just deps" >&2
  exit 2
fi

VERIFY_BIND="${VERIFY_BIND:-127.0.0.1}"
VERIFY_PORT="${VERIFY_PORT:-47821}"
VERIFY_RUN_DIR="${VERIFY_RUN_DIR:-/tmp/verify-willemstad}"
VERIFY_EVIDENCE_DIR="${VERIFY_EVIDENCE_DIR:-/tmp/verify-willemstad/evidence}"

RUN_PID_FILE="${VERIFY_RUN_DIR}/server.pid"
RUN_META_FILE="${VERIFY_RUN_DIR}/meta.env"
RUN_LOG_FILE="${VERIFY_RUN_DIR}/server.log"

require_cmd() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "error  ${name} is not installed" >&2
    echo "try: just deps" >&2
    exit 2
  fi
}

require_theme_css() {
  if [[ ! -f "${REPO_ROOT}/theme.css" ]]; then
    echo "error  theme.css is not checked out" >&2
    echo "try: just deps" >&2
    exit 2
  fi
}

require_chrome() {
  if ! find_chrome >/dev/null; then
    echo "error  chromium is not installed" >&2
    echo "try: just deps" >&2
    exit 2
  fi
}

find_chrome() {
  local candidate
  for candidate in \
    "${VERIFY_CHROME:-}" \
    google-chrome-stable \
    google-chrome \
    chromium \
    chromium-browser \
    /usr/bin/google-chrome-stable \
    /usr/bin/google-chrome \
    /usr/local/bin/google-chrome
  do
    if [[ -n "${candidate}" ]] && command -v "${candidate}" >/dev/null 2>&1; then
      command -v "${candidate}"
      return 0
    fi
    if [[ -n "${candidate}" && -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

manifest_version() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "${REPO_ROOT}/manifest.json"
}

theme_css_version() {
  python3 - "${REPO_ROOT}/theme.css" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read(8000)
m = re.search(r"Willemstad \| v([0-9]+(?:\.[0-9]+)*)", text)
if not m:
    sys.exit("verify-willemstad: version banner missing from theme.css header")
print(m.group(1))
PY
}

base_url() {
  printf 'http://%s:%s' "${VERIFY_BIND}" "${VERIFY_PORT}"
}

load_run_meta() {
  if [[ ! -f "${RUN_META_FILE}" ]]; then
    echo "verify-willemstad: no run metadata at ${RUN_META_FILE} — launch first" >&2
    return 1
  fi

  local line key value
  local seen="|"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ -z "${line}" || "${line}" != *=* ]]; then
      echo "verify-willemstad: malformed metadata line in ${RUN_META_FILE}" >&2
      return 1
    fi
    key="${line%%=*}"
    value="${line#*=}"
    case "${key}" in
      VERIFY_BIND|VERIFY_PORT|VERIFY_PID|VERIFY_PID_START|VERIFY_BASE_URL|VERIFY_REPO_ROOT|VERIFY_SKILL_DIR|VERIFY_MANIFEST_VERSION|VERIFY_THEME_CSS_VERSION) ;;
      *)
        echo "verify-willemstad: unknown metadata key ${key}" >&2
        return 1
        ;;
    esac
    if [[ "${seen}" == *"|${key}|"* ]]; then
      echo "verify-willemstad: duplicate metadata key ${key}" >&2
      return 1
    fi
    seen="${seen}${key}|"
    printf -v "${key}" '%s' "${value}"
  done < "${RUN_META_FILE}"

  for key in VERIFY_BIND VERIFY_PORT VERIFY_PID VERIFY_PID_START VERIFY_BASE_URL VERIFY_REPO_ROOT VERIFY_SKILL_DIR VERIFY_MANIFEST_VERSION VERIFY_THEME_CSS_VERSION; do
    if [[ "${seen}" != *"|${key}|"* ]]; then
      echo "verify-willemstad: missing metadata key ${key}" >&2
      return 1
    fi
  done
  case "${VERIFY_PID}" in ''|*[!0-9]*) echo "verify-willemstad: invalid metadata pid" >&2; return 1 ;; esac
  case "${VERIFY_PORT}" in ''|*[!0-9]*) echo "verify-willemstad: invalid metadata port" >&2; return 1 ;; esac
  if (( VERIFY_PID <= 0 )); then
    echo "verify-willemstad: invalid metadata pid" >&2
    return 1
  fi
  if (( VERIFY_PORT <= 0 || VERIFY_PORT > 65535 )); then
    echo "verify-willemstad: invalid metadata port" >&2
    return 1
  fi
  case "${VERIFY_BIND}" in 127.0.0.1|localhost|::1) ;; *) echo "verify-willemstad: invalid metadata bind" >&2; return 1 ;; esac
  if [[ "${VERIFY_BASE_URL}" != "$(base_url)" ]]; then
    echo "verify-willemstad: metadata base URL does not match bind and port" >&2
    return 1
  fi
  if [[ "${VERIFY_REPO_ROOT}" != "${REPO_ROOT}" || "${VERIFY_SKILL_DIR}" != "${SKILL_DIR}" ]]; then
    echo "verify-willemstad: metadata paths do not match this checkout" >&2
    return 1
  fi
}

pid_is_alive() {
  local pid="$1"
  [[ "${pid}" =~ ^[0-9]+$ ]] && kill -0 "${pid}" 2>/dev/null
}

process_start() {
  local pid="$1"
  ps -p "${pid}" -o lstart= 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

process_command() {
  local pid="$1"
  ps -p "${pid}" -o command= 2>/dev/null
}

pid_matches_verify_server() {
  local pid="$1"
  local expected_start="$2"
  local actual_start command
  pid_is_alive "${pid}" || return 1
  actual_start="$(process_start "${pid}")" || return 1
  [[ -n "${expected_start}" && "${actual_start}" == "${expected_start}" ]] || return 1
  command="$(process_command "${pid}")" || return 1
  [[ "${command}" == *"${_LIB_DIR}/serve.py"* ]]
}

new_evidence_dir() {
  local feature="$1"
  local stamp="${2:-$(date -u +%Y%m%dT%H%M%SZ)}"
  if [[ ! "${feature}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "verify-willemstad: invalid evidence feature ${feature}" >&2
    return 2
  fi
  mkdir -p "${VERIFY_EVIDENCE_DIR}"
  mktemp -d "${VERIFY_EVIDENCE_DIR}/${stamp}-${feature}.XXXXXX"
}

port_pid() {
  python3 - "${VERIFY_BIND}" "${VERIFY_PORT}" <<'PY'
import socket, sys
bind, port = sys.argv[1], int(sys.argv[2])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(0.4)
try:
    s.connect((bind, port))
except OSError:
    sys.exit(1)
finally:
    s.close()
print("open")
PY
}
