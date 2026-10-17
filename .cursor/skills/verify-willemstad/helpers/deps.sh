#!/usr/bin/env bash
# Restore or report verify-willemstad tools. --check is read-only (just ci).
# Default may fetch theme.css from this checkout. It never apt-installs Chromium.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib.sh"

CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
fi

missing=0

need_cmd() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "error  ${name} is not installed" >&2
    if [[ "${CHECK_ONLY}" -eq 1 ]]; then
      echo "try: just deps" >&2
    else
      echo "try: install ${name}, then rerun just deps" >&2
    fi
    missing=1
  fi
}

need_cmd python3
need_cmd curl
need_cmd node

if [[ ! -f "${REPO_ROOT}/theme.css" ]]; then
  if [[ "${CHECK_ONLY}" -eq 1 ]]; then
    echo "error  theme.css is not checked out" >&2
    echo "try: just deps" >&2
    missing=1
  else
    echo "verify-willemstad: checking out theme.css" >&2
    if git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      if git -C "${REPO_ROOT}" sparse-checkout add --skip-checks theme.css 2>/dev/null; then
        :
      fi
      git -C "${REPO_ROOT}" checkout HEAD -- theme.css
    fi
    if [[ ! -f "${REPO_ROOT}/theme.css" ]]; then
      echo "error  theme.css is not checked out" >&2
      echo "try: git checkout HEAD -- theme.css" >&2
      missing=1
    fi
  fi
fi

if [[ "${CHECK_ONLY}" -eq 0 ]] && ! find_chrome >/dev/null; then
  echo "error  chromium is not installed" >&2
  echo "try: install google-chrome-stable or chromium, then rerun just deps" >&2
  missing=1
fi

if [[ "${missing}" -ne 0 ]]; then
  exit 2
fi

if [[ "${CHECK_ONLY}" -eq 1 ]]; then
  echo "verify-willemstad: python3 curl node theme.css ok"
else
  echo "verify-willemstad: python3 curl node theme.css chromium ok"
fi
