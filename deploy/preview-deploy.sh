#!/usr/bin/env bash
# Deploy a PR-scoped Cloud Run service. Never updates production `floor-tape`.
#
# Usage:
#   PROJECT=j-proj-310112 REGION=europe-west2 \
#     ./deploy/preview-deploy.sh <pr_number> <image_uri>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREVIEW_PY="${ROOT}/deploy/preview.py"
PR="${1:?usage: preview-deploy.sh <pr_number> <image_uri>}"
IMAGE="${2:?usage: preview-deploy.sh <pr_number> <image_uri>}"
PROJECT="${PROJECT:-${PROJECT_ID:-j-proj-310112}}"
REGION="${REGION:-europe-west2}"

python3 "${PREVIEW_PY}" assert-safe "$(python3 "${PREVIEW_PY}" service-name "${PR}")" >/dev/null
NAME="$(python3 "${PREVIEW_PY}" service-name "${PR}")"

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

python3 "${PREVIEW_PY}" deploy-args \
  --pr "${PR}" \
  --image "${IMAGE}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --format=lines > "${TMP}/deploy.argv"

echo "==> Deploy preview service ${NAME}"
run_lines_cmd "${TMP}/deploy.argv"

URL="$(gcloud run services describe "${NAME}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format='value(status.url)')"

if [[ -z "${URL}" ]]; then
  echo "error: preview service ${NAME} has no status.url" >&2
  exit 1
fi

echo "Preview URL: ${URL}"
if [[ -n "${PREVIEW_URL_FILE:-}" ]]; then
  printf '%s\n' "${URL}" > "${PREVIEW_URL_FILE}"
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "url=${URL}" >> "${GITHUB_OUTPUT}"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "Preview: ${URL}" >> "${GITHUB_STEP_SUMMARY}"
fi
