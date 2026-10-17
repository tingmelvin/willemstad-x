#!/usr/bin/env bash
# Drive one mapped feature through Chrome. Usage: drive.sh <feature> [extra-query]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib.sh"

FEATURE="${1:-reading}"
EXTRA_QUERY="${2:-}"

case "${FEATURE}" in
  reading|callouts|cssclasses|checkboxes|focused-mode) ;;
  *)
    echo "verify-willemstad: unknown feature '${FEATURE}'" >&2
    echo "Known: reading callouts cssclasses checkboxes focused-mode" >&2
    exit 2
    ;;
esac

require_cmd node
require_theme_css
load_run_meta || exit 1
"${SCRIPT_DIR}/doctor.sh" >/dev/null
require_chrome
chrome="$(find_chrome)"

out_dir="$(new_evidence_dir "${FEATURE}")"

VERIFY_CHROME="${chrome}" \
VERIFY_BASE_URL="${VERIFY_BASE_URL}" \
VERIFY_EVIDENCE_DIR="${out_dir}" \
VERIFY_FEATURE="${FEATURE}" \
VERIFY_EXTRA_QUERY="${EXTRA_QUERY}" \
node "${SCRIPT_DIR}/capture.mjs"

echo "EVIDENCE_DIR=${out_dir}"
echo "FEATURE=${FEATURE}"
ls -la "${out_dir}"
