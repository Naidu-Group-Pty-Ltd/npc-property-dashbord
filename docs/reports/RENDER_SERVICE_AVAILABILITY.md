# The render service, and what a 503 from it means

**Read this before touching `weasyprintClient.ts`, `render-template-pdf`,
`render-cash-flow-pdf`, `routeReportThroughTemplate.ts`,
`renderFailure.pure.ts` or the WeasyPrint deploy workflow.**

## What happened on 15 September 2026

Every report generated for 291 Stone Mason Drive, Kellyville that morning
came out in the standard (pdf-lib) layout, with a toast reading *"Your chosen
template was not used for this document … The renderer could not produce the
document."* The 10 Year Cash Flow — which has no standard-layout fallback —
failed outright, and its toast printed 400 characters of an HTML page:

```
WeasyPrint render failed (503): <html><head>…<title>503 Server Error</title>
…The service you requested is not available yet. Please try again in 30
seconds.…
```

That page is Cloud Run's own front door, not WeasyPrint's. It is what Cloud
Run serves when a request reaches the service and **no instance is ready to
take it** — a container still starting, a revision whose container failed its
health check, or a service with no serving revision at all.

Three things were true at once and each was invisible from the product:

1. **The failure was the same on every format.** Every template route and the
   cash-flow route call the same service; nothing in the product said so.
   The template path swallowed the status into one generic sentence, and the
   cash-flow path printed the raw body.
2. **The service has never been deployed by its workflow.**
   `deploy-weasyprint-service.yml` has run three times and every run skipped
   build, stage, verify and promote, because its gate requires three
   repository variables (`GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`,
   `GCP_DEPLOY_SERVICE_ACCOUNT`) that have never been set. Whatever revision
   is serving was deployed by hand. `CONTAINER_RELEASE.md` records the manual
   path.
3. **The service scales to zero** (`--min-instances 0`) and declares **no
   startup probe**, so the first request after idle is a cold start, and a
   revision whose container cannot boot answers every request 503 rather
   than being refused promotion.

The metered ledger shows the last successful WeasyPrint calls on
8 September 2026 (128 calls, all successful). Nothing in the repository
records what changed between then and the 15th.

## What the code does now

`_shared/renderFailure.pure.ts` classifies a service answer once, and both
render functions and both browser clients read it:

| Upstream | `code` | HTTP from the function | Retried |
| --- | --- | --- | --- |
| 502, 503, 504, network failure | `engine_unavailable` | 503 | once, after 5 s |
| 4xx / other 5xx from the engine | `render_failed` | 502 | no |
| Storage or signing after the render | `store_failed` | 502 | no |

- `weasyprintClient.ts` retries an unavailable answer once and throws a
  `WeasyPrintServiceError` carrying the kind, the upstream status and a
  one-line summary of the body (the `<title>` and headings of an HTML page,
  never the page itself).
- `render-template-pdf` and `render-cash-flow-pdf` answer
  `{ error, code, upstreamStatus, retriable }` with the classified status.
- `routeReportThroughTemplate.ts` records `engine_unavailable` as its own
  refusal, and `templateDocument.ts` relays the engine's status and words in
  the fallback notice: *"The print engine did not answer. HTTP 503 from the
  render service: 503 Server Error — The service you requested is not
  available yet."*
- `requestCashFlowPdf.ts` throws the operator's sentence rather than the
  service's body.

None of that makes the service answer. It makes the product say what
happened.

## Runbook: the render service answers 503

Run from a machine with `gcloud` authenticated to the production project.

```bash
REGION=australia-southeast1
SERVICE=weasyprint-service

# 1. Is there a serving revision, and is it ready?
gcloud run services describe "$SERVICE" --region "$REGION" \
  --format='yaml(status.conditions,status.traffic,status.latestReadyRevisionName,status.latestCreatedRevisionName)'

# 2. Does the container boot? (unauthenticated on purpose — see app.py)
URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
curl -sS -o /dev/null -w '%{http_code}\n' "$URL/healthz"

# 3. What did the last requests see?
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'" AND httpRequest.status>=500' \
  --limit 20 --format='value(timestamp,httpRequest.status,textPayload)'
```

Read the answers in this order:

- **No ready revision / `latestReadyRevisionName` behind `latestCreated`** —
  the last deploy's container did not become healthy. Roll traffic back to
  the previous ready revision (`gcloud run services update-traffic
  "$SERVICE" --to-revisions <prev>=100`), then fix the image.
- **`/healthz` answers 503 for more than a minute** — the container is
  crash-looping; the revision's logs (step 3) say why. A missing font
  package, a WeasyPrint import error or an engine pin the image lacks all
  present this way.
- **`/healthz` answers 200 and the product still fails** — the product's
  token or URL is wrong: `WEASYPRINT_SERVICE_URL` / `WEASYPRINT_SERVICE_TOKEN`
  in the Supabase project's secrets must match the service and its
  `RENDER_TOKEN`. A 401/403 from the engine is `render_failed`, not
  `engine_unavailable`; a 503 is never an auth problem.
- **Only the first request after idle fails** — a cold start. The one retry
  in `weasyprintClient.ts` covers a boot that finishes within five seconds;
  a slower boot needs the change below.

## Two changes that need a decision

Neither is made on this branch, because both change what production runs.

1. **Set the three repository variables and let the workflow deploy.** Until
   then every revision is hand-built and nothing verifies a revision before
   traffic reaches it. The workflow already stages with `--no-traffic` and
   verifies on a tagged URL; it only needs credentials.
2. **Give the service a startup probe and, if cold starts are the cause, a
   floor of one instance.** `--startup-probe httpGet.path=/healthz` makes
   Cloud Run refuse to route to a container that has not booted, so a broken
   image fails the deploy instead of every report. `--min-instances 1` costs
   money continuously and removes the cold start; it is a spend decision.

## Verifying after the fix

The purge rule applies here too: **assert by effect, never by
configuration.** A green deploy is not a rendered report. After any change:

1. `curl "$URL/healthz"` answers 200.
2. Generate one report with a chosen template and confirm the toast does
   NOT appear and the download is the templated document (its Producer is
   the WeasyPrint engine, not "NPC Command Centre").
3. Generate one 10 Year Cash Flow and confirm a PDF downloads.
4. `api_usage` shows the three `weasyprint` rows with `success = true`.
