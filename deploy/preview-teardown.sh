#!/usr/bin/env bash
# Delete the PR-scoped Cloud Run preview. Never touches production `floor-tape`.
#
# Usage:
#   PROJECT=j-proj-310112 REGION=europe-west2 \
#     ./deploy/preview-teardown.sh <pr_number>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREVIEW_PY="${ROOT}/deploy/preview.py"
PR="${1:?usage: preview-teardown.sh <pr_number>}"
PROJECT="${PROJECT:-${PROJECT_ID:-j-proj-310112}}"
REGION="${REGION:-europe-west2}"

NAME="$(python3 "${PREVIEW_PY}" service-name "${PR}")"
python3 "${PREVIEW_PY}" assert-safe "${NAME}" >/dev/null

run_lines_cmd() {
  local cmd=()
  local line
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    cmd+=("$line")
  done < "$1"
  if [[ "${#cmd[@]}" -lt 4 || "${cmd[0]}" != "gcloud" ]]; then
    echo "error: refusing to run non-gcloud command from $1" >&2
    return 2
  fi
  local tok
  for tok in "${cmd[@]}"; do
    if [[ "$tok" == "floor-tape" ]]; then
      echo "error: refusing production Cloud Run name in argv: $tok" >&2
      return 2
    fi
  done
  printf '+' >&2
  printf ' %q' "${cmd[@]}" >&2
  echo >&2
  "${cmd[@]}"
}

TMP="$(mktemp -d "${TMPDIR:-/tmp}/floor-tape-preview.XXXXXX")"
cleanup() { rm -rf "${TMP}"; }
trap cleanup EXIT

python3 "${PREVIEW_PY}" describe-args \
  --pr "${PR}" --project "${PROJECT}" --region "${REGION}" --format=lines \
  > "${TMP}/describe.argv"

if ! run_lines_cmd "${TMP}/describe.argv" >/dev/null; then
  echo "preview service ${NAME} does not exist; nothing to delete"
  exit 0
fi

python3 "${PREVIEW_PY}" delete-args \
  --pr "${PR}" --project "${PROJECT}" --region "${REGION}" --format=lines \
  > "${TMP}/delete.argv"

echo "==> Delete preview service ${NAME}"
run_lines_cmd "${TMP}/delete.argv"
echo "Deleted ${NAME}"
