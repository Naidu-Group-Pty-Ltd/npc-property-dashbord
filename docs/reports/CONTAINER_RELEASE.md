# Releasing the render container

How a change in `weasyprint-service/` reaches a client's document.

`weasyprint-service/README.md` is the reference for *what the service is* — its
endpoints, its font contract, its first deploy. This is the reference for
*shipping a change to it*, and it exists because the gap between those two is
where the silence lives: **there is no deploy workflow for this image anywhere
in the repository.** `ci.yml` builds it to test it and publishes nothing. There
is no `docker push`, no `gcloud`, no `cloudbuild.yaml`. Every line in
`weasyprint-service/` is inert in production until a person runs the commands
below.

The other half of the report system does not work like that. The stylesheet, the
document structure and what the render routes ask for all live in
`supabase/functions/`, and those ship with the edge functions. So a release is
two deploys, in an order that matters.

---

## The ordering constraint, first

The nine render routes send `pdf_variant: "pdf/ua-1"`.

`weasyprint.pdf.VARIANTS` is a dictionary and the engine indexes it directly. An
engine that does not have that key raises `KeyError` inside `Document._render`,
which the service returns as a **500 on every report**. This service ran 62.3 for
part of its life while the stylesheet was written against 69, so an older
deployed image is not hypothetical.

**Therefore: the container goes first, always.** Step 0 exists to find out
whether it needs to.

The reverse pairing is safe. A *new* container with *old* functions renders
normally — `custom_metadata` defaults on and finds no `<meta>` tags to carry,
`output_intent` defaults to unset. You lose the new behaviour, not the service.

| | old functions | new functions |
| --- | --- | --- |
| **old container** | today | **every report 500s** |
| **new container** | safe — no provenance, no output intent | the release |

---

## Step 0 — Find out what is actually deployed

Nothing else is safe until this is known.

```bash
gcloud auth login
gcloud config set project "$PROJECT_ID"
gcloud run services list --region australia-southeast1
```

```bash
URL=$(gcloud run services describe weasyprint-service \
       --region australia-southeast1 --format='value(status.url)')

# The same value as the WEASYPRINT_SERVICE_TOKEN secret in Supabase.
TOKEN=<paste it>

curl -sf "$URL/healthz"
curl -sf -H "Authorization: Bearer $TOKEN" "$URL/version"
```

**Read the `weasyprint` field of that last response.** If it is not `69.0`, do
not deploy the edge functions until Step 2 has completed and cut over.

Record what you are rolling back to, before anything moves:

```bash
gcloud run revisions list --service weasyprint-service \
  --region australia-southeast1 \
  --format='table(name,active,creationTimestamp)'
```

Write down the name of the revision currently serving traffic. Step 2's rollback
needs it and nothing else will tell you.

---

## Step 1 — Build the image, and let it check itself

Cloud Build runs the build remotely, so no local Docker is required.

```bash
gcloud builds submit \
  --tag "gcr.io/$PROJECT_ID/weasyprint-service:ua1" \
  --timeout=1800s \
  ./weasyprint-service
```

Two flags earn their place:

- **`--timeout=1800s`.** The default is ten minutes. The veraPDF layer alone
  fetches a 33 MB installer, installs a JRE and runs an IzPack install; `pip
  install` of the engine is the other long pole.
- **`--machine-type=e2-highcpu-8`**, if the build is slow enough to annoy you.
  Optional; the default finishes.

**The build is the first gate, and it is a real one.** It fails, by design, if:

| The build stops when | Where |
| --- | --- |
| Cinzel, Playfair Display, Inter or IBM Plex Mono fails to resolve | `Dockerfile:116-121` |
| Playfair Display italic is missing | `Dockerfile:120-121` |
| veraPDF does not install, or `--version` does not run | `Dockerfile:161` |
| the specimen renders with a substituted face | `selfcheck.py`, via `Dockerfile:178` |
| `pdf_tags` produces no structure tree | same |
| a construct in `UNSUPPORTED` / `LOAD_BEARING` has changed behaviour | same |
| **the specimen does not validate as PDF/UA-1** | same |

That last one is the release. Look for this line in the build log:

```
the specimen validates as PDF/UA-1
```

If it says anything else, **stop**. A conformance claim that fails validation is
worse than no claim — it tells a procurement officer, a screen-reader user and an
accessibility auditor that the document is navigable, and none of them finds out
otherwise until they try.

### If you have Docker locally

Same checks, no registry round-trip, and you can read the failures faster:

```bash
docker build -t weasyprint-service:ua1 ./weasyprint-service

docker run --rm --entrypoint python weasyprint-service:ua1 selfcheck.py

docker run --rm -v "$PWD/weasyprint-service:/tests:ro" -w /tests \
  -e WEASYPRINT_SERVICE_TOKEN=dev-token -e PYTHONDONTWRITEBYTECODE=1 \
  weasyprint-service:ua1 python -m unittest test_app -v
```

The test file is mounted rather than COPY-ed: tests do not belong in the image.

---

## Step 2 — Deploy with no traffic, verify, then cut over

Never straight to 100%. Cloud Run makes the canary a flag.

```bash
gcloud run deploy weasyprint-service \
  --image "gcr.io/$PROJECT_ID/weasyprint-service:ua1" \
  --region australia-southeast1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi --cpu 2 \
  --concurrency 4 --timeout 600 \
  --min-instances 0 --max-instances 10 \
  --no-traffic --tag ua1
```

Two settings that look wrong and are not:

- **`--allow-unauthenticated`** is deliberate. The service does its own bearer
  check in `app.py` and refuses every request when no token is set — it fails
  closed. Cloud Run IAM in front of it would mean a second credential for the
  edge functions to hold and rotate.
- **`--memory 2Gi` is unchanged by the veraPDF layer.** veraPDF is a JVM, but
  **the service never invokes it at runtime** — it runs at build time inside
  `selfcheck.py`, and by hand when you point it at a file. What the layer costs
  is image size, and therefore cold-start pull time, not RAM.

`--timeout 600` matches `WEASYPRINT_TIMEOUT_MS` in `weasyprintClient.ts`. A
forty-page report with inlined assets is minutes; a shorter timeout turns a slow
render into a killed worker.

### Verify the canary, which serves no production traffic

```bash
CANARY=$(gcloud run services describe weasyprint-service \
          --region australia-southeast1 \
          --format='value(status.traffic.filter(tag=ua1).url)')

curl -sf -H "Authorization: Bearer $TOKEN" "$CANARY/version"
```

Expect `weasyprint 69.0`. Then the check that matters — a **real report**,
through the canary, reconciled against the repo's own capability list:

```bash
# Writes reports/html/borrowing-capacity.html as a side effect.
npx vitest run src/lib/reports/borrowingCapacity/__tests__/render.spec.ts

npx tsx scripts/reports/engineCheck.mts \
  --service "$CANARY" --token "$TOKEN" --capabilities \
  reports/html/borrowing-capacity.html
```

This is the step that proves the new options are live. `--capabilities` asks the
service which `write_pdf` options the engine reports and reconciles them against
`REQUIRED_OPTIONS` in `engineSupport.pure.ts` — which now includes
`output_intent` and `custom_metadata`. An image without them fails here.

| exit | meaning |
| --- | --- |
| `0` | the engine drops what the repo says it drops, and reports every required option |
| `1` | a disagreement, or the document produced an engine warning |
| `2` | transport or usage — a non-2xx from the service, a missing file, a bad flag |

### Cut over

Only once the above passes:

```bash
gcloud run services update-traffic weasyprint-service \
  --region australia-southeast1 --to-latest
```

### Rollback

One command, no rebuild, using the revision you recorded in Step 0:

```bash
gcloud run services update-traffic weasyprint-service \
  --region australia-southeast1 \
  --to-revisions=<revision-from-step-0>=100
```

If the edge functions have already gone out and you roll the container back
below 69.0, **you must roll the functions back too** — see the matrix at the top.

---

## Step 3 — Deploy the edge functions

Only after Step 2 reports `69.0` on live traffic.

### The workflow, which is currently switched off

`.github/workflows/deploy-supabase-functions.yml` fires on every push to `main`
touching `supabase/functions/**`. It gates on `secrets.SUPABASE_ACCESS_TOKEN`
and, absent it, writes a "would have deployed" job summary and stops — so
merging paints nothing red and ships nothing either.

To turn it on: **Settings → Secrets and variables → Actions → New repository
secret**, `SUPABASE_ACCESS_TOKEN`, a Supabase personal access token.

Then merge, and **open the run and look at the `Deploy` step**. `skipped` means
nothing shipped. That is the exact silent failure the workflow was written for:
PR #1866 merged cleanly and produced no visible change for two days because
merging is not deploying.

**Expect a long run.** A release that touches `supabase/functions/_shared/`
deploys *every* function, not the ten that render PDFs. That is deliberate —
working out which functions a shared module reaches is a dependency-graph
problem the workflow declines to solve, and under-deploying is the bug it
exists to prevent. The operation is idempotent.

### By hand

The ten that import `weasyprintClient.ts`:

```bash
export SUPABASE_ACCESS_TOKEN=<personal access token>

for fn in render-borrowing-capacity-pdf \
          render-cash-flow-pdf \
          render-cash-flow-comparison-pdf \
          render-client-details-pdf \
          render-market-intelligence-pdf \
          render-portfolio-review-pdf \
          render-property-comparison-pdf \
          render-report-qa-pdf \
          render-template-pdf \
          convert-template-document; do
  echo "── $fn"
  supabase functions deploy "$fn" --project-ref dduzbchuswwbefdunfct
done
```

`render-investment-report-pdf` reads `WEASYPRINT_SERVICE_URL` and the token from
the environment directly rather than through the shared client, so it is not in
that list by accident — but redeploy it too whenever `_shared/` has moved
beneath it.

Use the CLI rather than the MCP deploy tool: these routes pull in dozens of
`../_shared/**` modules and the CLI is what resolves them.

**No migration accompanies a container release.** Nothing here touches a table.

---

## Step 4 — Check the two sides still hold the same token

`app.py` and `weasyprintClient.ts` must agree, and
`render-investment-report-pdf` already carries a diagnostic naming this exact
mismatch — *"the `WEASYPRINT_SERVICE_TOKEN` secret in Supabase does not equal the
token deployed on the Cloud Run service"*. If you rotated the token during the
deploy, set the pair together:

```bash
supabase secrets set --project-ref dduzbchuswwbefdunfct \
  WEASYPRINT_SERVICE_URL="$URL" \
  WEASYPRINT_SERVICE_TOKEN="$TOKEN"
```

Both keys are also editable from the app — `src/lib/integrations/registry.ts`
declares them under the `weasyprint` integration, and
`check-integration-secrets` reports on them.

`WEASYPRINT_API_KEY` is a legacy alias accepted on both sides. Nothing writes
it; set `WEASYPRINT_SERVICE_TOKEN`.

---

## Step 5 — Prove it on a real client document

Generate one report from the app — a Borrowing Capacity Snapshot is the shortest
path — download it, and look inside:

```bash
python3 - report.pdf <<'PY'
import sys, pikepdf
pdf = pikepdf.open(sys.argv[1])
info = dict(pdf.docinfo)
print('provenance   :', {str(k): str(v) for k, v in info.items() if str(k).startswith('/npc')})
print('outputintent :', '/OutputIntents' in pdf.Root)
print('outline      :', '/Outlines' in pdf.Root)
print('pages        :', len(pdf.pages))
PY
```

Expect all four `/npc*` keys, an output intent, and an outline. Then the claim
itself, using the validator that travels in the image:

```bash
docker run --rm -v "$PWD:/work:ro" --entrypoint /opt/verapdf/verapdf \
  weasyprint-service:ua1 -f ua1 /work/report.pdf     # exit 0 = conformant
```

Or all ten formats at once, locally, against the pinned engine:

```bash
npx tsx scripts/reports/renderAll.mts
npx tsx scripts/reports/validateUa.mts
```

### What should change in the artefact, and what should not

| | before | after |
| --- | --- | --- |
| Conformance claim | PDF/A-2b | **PDF/UA-1** |
| Info dictionary | Title, Author, Producer | **+ `/npcformat`, `/npcrenderid`, `/npcsourceid`, `/npcrenderedat`** |
| OutputIntent | present (added by PDF/A) | **present** (asked for by name — IEC 61966-2-1) |
| Structure tree | present | present |
| Outline | present | present |
| Crop marks / bleed | absent | **absent** — only when a caller sets `pressMarks` |
| Page count, typography, layout | — | **unchanged**; those ship with the edge functions |

If a delivered PDF has no `/npc*` keys and no output intent, the container half
did not land — the functions are talking to an old image, which is the safe
failure rather than the loud one.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Build fails in the veraPDF layer, missing jar path | Upstream shipped a new version. Bump `ARG VERAPDF_VERSION`; the URL is derived from it |
| Build times out around ten minutes | `--timeout=1800s` was omitted |
| Build fails `FATAL: font family '…' is not installed` | A face left `weasyprint-service/fonts/`, or `fc-cache` did not see it |
| `selfcheck.py`: *does not validate as PDF/UA-1* | **Do not deploy.** Something in the document or the engine broke the claim |
| `selfcheck.py`: *no validator at /opt/verapdf/verapdf* | The veraPDF layer did not run — an image built before this release |
| Every report 500s immediately after an edge deploy | The container is older than 69.0 and `pdf/ua-1` is a `KeyError`. Step 0 was skipped. Roll the functions back or finish Step 2 |
| Reports render, but carry no `/npc*` keys | Old container, new functions. `custom_metadata` is ignored by an image that does not read it |
| Reports render with no OutputIntent | Same cause |
| `engineCheck --capabilities` exits 1 on `missingOptions` | The deployed engine no longer reports an option in `REQUIRED_OPTIONS` |
| `engineCheck` exits 2 | Transport: wrong `--service` URL, wrong token, or the canary URL is empty because the `--tag` was not applied |
| 401 from `/render` | Token drift between the Cloud Run env var and the Supabase secret. Step 4 |
| Gateway 404, reported in the browser as a CORS error | The function was never deployed. A Supabase gateway 404 carries no CORS headers, so the browser blames CORS |
| Cold starts got slower | Expected. The image carries a JRE and the validator now |

---

## What this release contained

For the next person reading this to find out what "the ua1 image" was:

- **veraPDF 1.30.2** installed headlessly at `/opt/verapdf/verapdf`, and
  `selfcheck.py` asserting the build-time specimen validates as PDF/UA-1.
- **`output_intent`** read from the request body. `pdf/ua-1` does not add an
  OutputIntent the way the PDF/A variants do, so without this the switch to UA
  would have taken the colour space out of every report.
- **`custom_metadata`**, which copies the document's own `<meta name=…>` tags
  into the file. The engine lowercases the key and strips everything that is not
  a letter or a digit, so `npc-render-id` arrives as `/npcrenderid`, and the
  entries land in the Info dictionary rather than the XMP packet.
- **`dpi` and `jpeg_quality` still deliberately unset**, with the measurement
  recorded in `app.py` so they are not proposed again from first principles.

The measurements behind all four are in
[`DESIGN_SYSTEM.md` §11.7](./DESIGN_SYSTEM.md).
