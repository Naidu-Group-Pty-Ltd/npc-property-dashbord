# Deploying builder-stock-pdf-service

Every push to `main` that touches this directory or the shared builder-stock
modules **builds and stages a revision that serves nobody**, verifies it on its
own tagged URL, and stops. Promotion is a `workflow_dispatch` with
`promote: true` — a person's decision, because this worker decides which
photograph a client sees.

## What the workflow needs

| repository variable | required | purpose |
|---|---|---|
| `GCP_PROJECT_ID` | yes | project to build and deploy in |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | yes | keyless auth |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | yes | the identity that auth assumes |
| `BUILDER_STOCK_PDF_IMAGE` | no | image path; defaults to `gcr.io/$PROJECT/builder-stock-pdf-service` |
| `BUILDER_STOCK_PDF_SECRET` | no | Secret Manager secret holding the bearer token |

The gate requires **all three** of the first group. Missing any of them, nothing
is built and the Edge settler keeps running the election in-process — which
works, and is what it did before this service existed.

## The token, and why the first deploy is two passes

The service reads `BUILDER_STOCK_PDF_SERVICE_TOKEN` from its environment and
**refuses every request with 503 while it is unset**. It never processes a
document for an unauthenticated caller.

`gcloud run deploy` cannot set that variable safely in this workflow, because
`--set-env-vars` and `--set-secrets` REPLACE the whole environment: naming one
variable silently drops every other one somebody configured. Only the merging
forms (`--update-secrets`, `--update-env-vars`) are used here.

That leaves a genuine bootstrap problem: **a brand-new Cloud Run service has no
environment to merge into.** There are two ways through it, and neither
promotes an unverified revision.

### Option A — Secret Manager (preferred, one pass thereafter)

1. Create the secret and grant the deploy service account access:

   ```
   printf '%s' "$(openssl rand -hex 32)" \
     | gcloud secrets create builder-stock-pdf-token --data-file=- --project "$PROJECT"

   gcloud secrets add-iam-policy-binding builder-stock-pdf-token \
     --project "$PROJECT" \
     --member "serviceAccount:$DEPLOY_SA" \
     --role roles/secretmanager.secretAccessor
   ```

2. Set the repository variable `BUILDER_STOCK_PDF_SECRET=builder-stock-pdf-token`.

3. Run the workflow. Every staged revision now carries the token via
   `--update-secrets`, so `/health` reports `token_configured: true` on the
   first pass and verification completes.

### Option B — two-pass bootstrap (no Secret Manager)

1. **First pass.** Run the workflow. It builds the image and deploys a
   `--no-traffic` revision, which CREATES the service. Verification then fails
   deliberately, with the exact command to run — the revision serves nobody and
   nothing is promoted.

2. **Set the token once**, by hand, on the service:

   ```
   gcloud run services update builder-stock-pdf-service \
     --region australia-southeast1 --project "$PROJECT" \
     --update-env-vars "BUILDER_STOCK_PDF_SERVICE_TOKEN=$(openssl rand -hex 32)"
   ```

   `--update-env-vars` merges, so this adds the token without disturbing
   anything else.

3. **Second pass.** Rerun the workflow. It stages a NEW revision, which
   inherits the environment from the service, and verification passes.

A failing first pass is the designed outcome, not a broken deployment. The
service exists, serves no traffic, and holds no credential until you give it
one.

## Promotion

```
gh workflow run deploy-builder-stock-pdf-service.yml -f promote=true
```

`promote` runs only after `verify` succeeds, and `verify` cannot succeed while
the token is unset — so an unverified revision can never take traffic.

## Pointing the settler at it

Two Supabase secrets, on the project the Edge functions run in:

- `BUILDER_STOCK_PDF_SERVICE_URL` — the service's production URL
- `BUILDER_STOCK_PDF_SERVICE_TOKEN` — the same bearer

Until **both** are set, `pdfElectionServiceConfigured()` is false and the
election runs in-process exactly as it always has. That is the fallback, and it
is why this is safe to deploy before the service is reachable.
