#!/usr/bin/env bash
# Start an isolated Willemstad preview server. Prints BASE_URL when ready.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib.sh"

require_cmd python3
require_cmd curl
require_theme_css

if [[ "${VERIFY_BIND}" != "127.0.0.1" && "${VERIFY_BIND}" != "localhost" && "${VERIFY_BIND}" != "::1" ]]; then
  echo "verify-willemstad: refuse non-loopback bind ${VERIFY_BIND}" >&2
  exit 2
fi

mkdir -p "${VERIFY_RUN_DIR}" "${VERIFY_EVIDENCE_DIR}"

if [[ -f "${RUN_PID_FILE}" ]]; then
  old_pid="$(cat "${RUN_PID_FILE}")"
  if pid_is_alive "${old_pid}"; then
    if ! load_run_meta; then
      echo "verify-willemstad: live pid ${old_pid} has invalid metadata; refuse to reuse" >&2
      exit 3
    fi
    if [[ "${VERIFY_PID}" != "${old_pid}" ]] || ! pid_matches_verify_server "${old_pid}" "${VERIFY_PID_START}"; then
      echo "verify-willemstad: live pid ${old_pid} does not match recorded verifier identity; refuse to reuse" >&2
      exit 3
    fi
    if curl -fsS --max-time 2 "$(base_url)/healthz" >/dev/null; then
      echo "verify-willemstad: reusing pid ${old_pid} at $(base_url)"
      echo "BASE_URL=$(base_url)"
      exit 0
    fi
    echo "verify-willemstad: stale pid ${old_pid} is alive but /healthz failed; refuse to hijack" >&2
    exit 3
  fi
  rm -f "${RUN_PID_FILE}" "${RUN_META_FILE}"
fi

if port_pid >/dev/null 2>&1; then
  echo "verify-willemstad: ${VERIFY_BIND}:${VERIFY_PORT} is already taken by something else." >&2
  echo "Set VERIFY_PORT and VERIFY_RUN_DIR to start a second isolated instance." >&2
  echo "Do not attach to a running Obsidian vault." >&2
  exit 3
fi

export VERIFY_REPO_ROOT="${REPO_ROOT}"
export VERIFY_SKILL_DIR="${SKILL_DIR}"
export VERIFY_BIND VERIFY_PORT

: > "${RUN_LOG_FILE}"
python3 "${SCRIPT_DIR}/serve.py" >> "${RUN_LOG_FILE}" 2>&1 &
server_pid=$!
echo "${server_pid}" > "${RUN_PID_FILE}"

ready=0
for _ in $(seq 1 50); do
  if ! pid_is_alive "${server_pid}"; then
    echo "verify-willemstad: server exited during startup. Log: ${RUN_LOG_FILE}" >&2
    tail -n 40 "${RUN_LOG_FILE}" >&2 || true
    rm -f "${RUN_PID_FILE}"
    exit 4
  fi
  if curl -fsS --max-time 1 "$(base_url)/healthz" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done

if [[ "${ready}" -ne 1 ]]; then
  echo "verify-willemstad: /healthz never answered. Killing pid ${server_pid}." >&2
  kill "${server_pid}" 2>/dev/null || true
  wait "${server_pid}" 2>/dev/null || true
  rm -f "${RUN_PID_FILE}"
  tail -n 40 "${RUN_LOG_FILE}" >&2 || true
  exit 4
fi

server_start="$(process_start "${server_pid}")"
if [[ -z "${server_start}" ]]; then
  echo "verify-willemstad: could not record process identity for pid ${server_pid}" >&2
  kill "${server_pid}" 2>/dev/null || true
  wait "${server_pid}" 2>/dev/null || true
  rm -f "${RUN_PID_FILE}"
  exit 4
fi

{
  echo "VERIFY_BIND=${VERIFY_BIND}"
  echo "VERIFY_PORT=${VERIFY_PORT}"
  echo "VERIFY_PID=${server_pid}"
  echo "VERIFY_PID_START=${server_start}"
  echo "VERIFY_BASE_URL=$(base_url)"
  echo "VERIFY_REPO_ROOT=${REPO_ROOT}"
  echo "VERIFY_SKILL_DIR=${SKILL_DIR}"
  echo "VERIFY_MANIFEST_VERSION=$(manifest_version)"
  echo "VERIFY_THEME_CSS_VERSION=$(theme_css_version)"
} > "${RUN_META_FILE}"

echo "verify-willemstad: launched pid ${server_pid} at $(base_url)"
echo "BASE_URL=$(base_url)"
echo "RUN_DIR=${VERIFY_RUN_DIR}"
echo "LOG=${RUN_LOG_FILE}"
