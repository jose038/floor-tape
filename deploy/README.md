# Host Floor Tape on Cloud Run

Same project and region as CardFlow, same cost shape: one Cloud Run service that
scales to zero, public `*.run.app` URL, no load balancer.

## Decision: no reserved static IP

A static IP in front of Cloud Run needs a global forwarding rule. That SKU is
about £15–20 per month even with no traffic. CardFlow already dropped it for
that reason.

Each pull request instead gets its own Cloud Run service, `floor-tape-pr-<number>`.
That service’s HTTPS URL does not change when new commits are deployed. It is
the stable address for the life of the PR, then it is deleted on close or merge.

Production is a second service, `floor-tape`, with its own stable `run.app` URL.

## What runs

| Piece | Choice |
|---|---|
| Project | `j-proj-310112` |
| Region | `europe-west2` |
| Production | Cloud Run service `floor-tape` |
| PR preview | Cloud Run service `floor-tape-pr-<n>` |
| Image | Artifact Registry `floor-tape/app` |
| Runtime identity | `floor-tape-run@j-proj-310112.iam.gserviceaccount.com` (no Secret Manager access) |
| Database | Ephemeral PGLite inside the instance. First request ingests Hillscore. No Neon bill. |
| Auth | Off. The tape is public disclosure data. |
| Scale | min instances 0, max 1, 1 vCPU, 1 GiB |
| Probe | `GET /health` returns `ok` and does not touch the database |

Idle cost is zero. You pay only for the seconds a request is being served, and
Cloud Run’s monthly free tier covers a personal tape. Do not add a load balancer,
a serverless NEG, or a reserved external IP.

## Workflows

The workflow files are in `deploy/github/workflows/`. GitHub only runs them from `.github/workflows/`. The `gh` login on this machine is an OAuth token without the `workflow` scope, so those files cannot be pushed into `.github/workflows` until that scope is granted:

```bash
gh auth refresh -h github.com -s workflow
mkdir -p .github/workflows
cp deploy/github/workflows/*.yml .github/workflows/
git add .github/workflows
git commit -m "ci: enable Cloud Run deploy and PR preview workflows"
git push
```

| Workflow | When |
|---|---|
| `Deploy to Cloud Run` | Push to `main`, or manual dispatch. Builds an immutable tag and deploys `floor-tape`. |
| `PR Cloud Run preview` | PR opened, updated, or reopened. Comments the preview URL. Deletes the service when the PR closes. Fork PRs are skipped. |

GitHub secret `GCP_SA_KEY` is the JSON key for
`cardflow-github-deploy@j-proj-310112.iam.gserviceaccount.com`, the same deploy
identity CardFlow uses. It is not stored in this repo.

## Manual production deploy

```bash
PROJECT=j-proj-310112 REGION=europe-west2
TAG="$(git rev-parse --short=7 HEAD)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/floor-tape/app:${TAG}"
gcloud builds submit --project "${PROJECT}" --tag "${IMAGE}" .
./deploy/deploy-service.sh "${IMAGE}"
```

The image tag must not be `latest`.

## Local container

```bash
docker build -t floor-tape .
docker run --rm -p 8080:8080 -e HOST=0.0.0.0 -e PORT=8080 floor-tape
curl -fsS http://127.0.0.1:8080/health
```
