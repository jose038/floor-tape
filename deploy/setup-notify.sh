#!/usr/bin/env bash
# Enable Web Push without leaving Cloud Run running.
# First run generates VAPID keys and a poll token, stores them on the service,
# and creates a Scheduler job that POSTs /internal/poll every 15 minutes.
#
#   ./deploy/setup-notify.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

PROJECT="${PROJECT:-j-proj-310112}"
REGION="${REGION:-europe-west2}"
SERVICE="${SERVICE:-floor-tape}"
JOB="${JOB:-floor-tape-poll}"

export PATH="${HOME}/.local/node/bin:${PATH}"

gcloud services enable cloudscheduler.googleapis.com --project="${PROJECT}" >/dev/null

DESC="$(mktemp)"
KEYS="$(mktemp)"
trap 'rm -f "${DESC}" "${KEYS}"' EXIT

gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" --region="${REGION}" --format=json > "${DESC}"

DESC="${DESC}" KEYS="${KEYS}" node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import webpush from 'web-push'

const desc = JSON.parse(readFileSync(process.env.DESC, 'utf8'))
const list = desc?.spec?.template?.spec?.containers?.[0]?.env ?? []
const env = Object.fromEntries(list.filter((item) => item.value != null).map((item) => [item.name, item.value]))
let publicKey = env.VAPID_PUBLIC_KEY || ''
let privateKey = env.VAPID_PRIVATE_KEY || ''
let token = env.PUSH_POLL_TOKEN || ''
if (!publicKey || !privateKey) {
  const keys = webpush.generateVAPIDKeys()
  publicKey = keys.publicKey
  privateKey = keys.privateKey
}
if (!token) token = randomBytes(24).toString('base64url')
writeFileSync(process.env.KEYS, JSON.stringify({
  publicKey,
  privateKey,
  token,
  subject: env.VAPID_SUBJECT || 'mailto:joseph.beeby@gmail.com',
}))
JS

ENV_CSV="$(node --input-type=module -e '
import { readFileSync } from "node:fs"
const keys = JSON.parse(readFileSync(process.argv[1], "utf8"))
process.stdout.write([
  "HOST=0.0.0.0",
  `VAPID_PUBLIC_KEY=${keys.publicKey}`,
  `VAPID_PRIVATE_KEY=${keys.privateKey}`,
  `VAPID_SUBJECT=${keys.subject}`,
  `PUSH_POLL_TOKEN=${keys.token}`,
].join(","))
' "${KEYS}")"

gcloud run services update "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --update-env-vars="${ENV_CSV}" \
  --quiet

URL="$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" --region="${REGION}" --format='value(status.url)')"
TOKEN="$(node --input-type=module -e 'import { readFileSync } from "node:fs"; process.stdout.write(JSON.parse(readFileSync(process.argv[1],"utf8")).token)' "${KEYS}")"

if gcloud scheduler jobs describe "${JOB}" --project="${PROJECT}" --location="${REGION}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${JOB}" \
    --project="${PROJECT}" \
    --location="${REGION}" \
    --schedule="*/15 * * * *" \
    --time-zone="Europe/London" \
    --uri="${URL}/internal/poll" \
    --http-method=POST \
    --update-headers="Content-Type=application/json,X-Floor-Tape-Poll-Token=${TOKEN}" \
    --message-body="{}" \
    --attempt-deadline=180s \
    --quiet
else
  gcloud scheduler jobs create http "${JOB}" \
    --project="${PROJECT}" \
    --location="${REGION}" \
    --schedule="*/15 * * * *" \
    --time-zone="Europe/London" \
    --uri="${URL}/internal/poll" \
    --http-method=POST \
    --headers="Content-Type=application/json,X-Floor-Tape-Poll-Token=${TOKEN}" \
    --message-body="{}" \
    --attempt-deadline=180s \
    --quiet
fi

echo "Poll ${URL}/internal/poll every 15 minutes. Cloud Run still scales to zero."
