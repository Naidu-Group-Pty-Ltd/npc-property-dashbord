# WeasyPrint PDF Microservice

Self-hosted Python service that renders the premium investment-report HTML to
PDF using WeasyPrint. Replaces the Api2PDF (Headless Chrome) path so we keep
full control over typography, page layout, and engine version.

## Fonts

The font list in the `Dockerfile` is a **contract** with
`supabase/functions/_shared/reportDesign/typography.pure.ts`, asserted by
`src/lib/reportDesign/__tests__/reportTypography.spec.ts` and by a Docker build
in CI. A face a report names must be installed here, or WeasyPrint substitutes
silently: the PDF renders, the tests pass, and the defect is visible only to
whoever opens the document.

Two routes in:

- **Debian packages** — Inter, IBM Plex, Roboto, Lato and the
  DejaVu/Liberation/Noto fallbacks. Every one is verified present in bookworm
  and trixie.
- **`fonts/*.ttf`, COPY-ed and `fc-cache`-d** — Cinzel and Playfair Display
  (upright and italic), the two brand faces. No distribution packages them.
  They live in this directory rather than `public/fonts/` because Docker cannot
  `COPY` from outside its build context. SIL OFL 1.1; the licence files ship
  beside them, which redistribution inside an image requires.

The `RUN fc-cache` layer asserts each brand family resolves and fails the build
if one does not — a missing face must break the build, not the document.

> This previously installed `fonts-playfair-display`,
> `fonts-cormorant-garamond` and `fonts-fraunces`. **None of the three exists in
> Debian.** `apt-get install -y` exits non-zero on an unknown package, so the
> image could not be built at all.

## Endpoints

- `GET  /healthz` — liveness probe.
- `POST /render`  — `Authorization: Bearer $WEASYPRINT_SERVICE_TOKEN (or WEASYPRINT_API_KEY)`, JSON
  body `{ "html": "...", "base_url": "https://..." }`, returns
  `application/pdf` bytes.

## Local run

```bash
cd weasyprint-service
docker build -t weasyprint-service .
docker run --rm -p 8080:8080 \
  -e WEASYPRINT_SERVICE_TOKEN (or WEASYPRINT_API_KEY)=dev-token \
  weasyprint-service
curl -X POST http://localhost:8080/render \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Hello</h1>"}' \
  -o out.pdf
```

## Deploy — Google Cloud Run (recommended)

```bash
PROJECT_ID=your-gcp-project
REGION=australia-southeast1
TOKEN=$(openssl rand -hex 32)

gcloud builds submit --tag gcr.io/$PROJECT_ID/weasyprint-service ./weasyprint-service

gcloud run deploy weasyprint-service \
  --image gcr.io/$PROJECT_ID/weasyprint-service \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi --cpu 2 \
  --concurrency 4 --timeout 600 \
  --min-instances 0 --max-instances 10 \
  --set-env-vars WEASYPRINT_SERVICE_TOKEN (or WEASYPRINT_API_KEY)=$TOKEN

# Note the deployed URL, then add these as Supabase Edge Function secrets:
#   WEASYPRINT_SERVICE_URL   = https://weasyprint-service-xxxx.a.run.app
#   WEASYPRINT_SERVICE_TOKEN (or WEASYPRINT_API_KEY) = <the TOKEN you generated>
```

Cloud Run scales to zero — typical cost is a few cents per thousand renders.

## Deploy — Fly.io / Railway / Render alternatives

Any container host that runs the Dockerfile works. Set the same two env vars
(`WEASYPRINT_SERVICE_TOKEN (or WEASYPRINT_API_KEY)` on the service, `WEASYPRINT_SERVICE_URL` +
`WEASYPRINT_SERVICE_TOKEN (or WEASYPRINT_API_KEY)` on Supabase) and you're done.

## Edge function wiring

`supabase/functions/render-investment-report-pdf/index.ts` prefers WeasyPrint
when both secrets are set, uploads the returned bytes to the
`investment-reports` storage bucket, and returns a signed URL to the client.

**There is no fallback once WeasyPrint is configured.** `index.ts:5567` catches a
render failure and re-throws — deliberately, so a failed render cannot silently
return a Chrome-rendered PDF that looks like the old design. Api2PDF is used only
when `WEASYPRINT_SERVICE_URL`/`WEASYPRINT_SERVICE_TOKEN` are absent entirely.

The practical consequence: **this service is critical infrastructure.** If it is
down or the image is broken, report generation returns a user-visible error. An
earlier version of this file claimed the opposite.
