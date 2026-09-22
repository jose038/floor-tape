#!/usr/bin/env bash
# Create or update the production Cloud Run service `floor-tape`.
#
# Usage:
#   ./deploy/deploy-service.sh <image_uri>
#
# Does not deploy PR previews. Those are floor-tape-pr-<n>.
set -euo pipefail

IMAGE="${1:?usage: deploy-service.sh <image_uri>}"
PROJECT="${PROJECT:-${PROJECT_ID:-j-proj-310112}}"
REGION="${REGION:-europe-west2}"
SERVICE="floor-tape"

if [[ "${IMAGE}" == *":latest" || "${IMAGE}" != *":"* ]]; then
  echo "error: image must be an immutable tag, not latest" >&2
  exit 2
fi
if [[ -z "${PROJECT}" || "${PROJECT}" == "(unset)" ]]; then
  echo "error: PROJECT is required" >&2
  exit 2
fi

echo "Project: ${PROJECT}"
echo "Region:  ${REGION}"
echo "Service: ${SERVICE}"
echo "Image:   ${IMAGE}"

gcloud run deploy "${SERVICE}" \
  --project="${PROJECT}" \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=1 \
  --concurrency=8 \
  --timeout=300 \
  --service-account="floor-tape-run@${PROJECT}.iam.gserviceaccount.com" \
  --set-env-vars=HOST=0.0.0.0 \
  --quiet

URL="$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format='value(status.url)')"
echo "Service URL: ${URL}"
echo "Health: ${URL}/health"
