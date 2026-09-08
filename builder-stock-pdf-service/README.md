# Builder Stock PDF election worker

One endpoint that runs `electFromPdfBytes` — the same module the Edge settler
imports — where there is CPU to run it.

## Why it exists

Measured 8 September 2026 from the platform's own per-execution telemetry: a
13-property cold start killed the settler 13 times and **every kill was
`reason: CPUTime`**. Successful executions ended at ≤1,828 ms of CPU, killed
ones at ≥2,031 ms, against a 2,000 ms limit. Memory peaked at 108 MB of a
256 MB ceiling, so memory was never the constraint.

Reading one brochure and electing its image costs ~1.7 s of CPU on fast
hardware. No scheduling rule fits an indivisible 2.4 s task into a 2.0 s
budget, so the work moved rather than shrank.

## What it is not

It is **not a new extractor**. There is no Python reimplementation and no
Docling substitution. Which image wins is decided by `pdfElection.ts` in both
places, at the same thresholds, because there is one implementation of it.

It touches **no database**, mints no credential and writes no state. Branch
attempts, provenance, the image pointer and upload settlement all remain in
the Supabase path.

## Endpoints

| method | path | purpose |
|---|---|---|
| `GET` | `/health` | `{ok, service, version, protocol, max_document_bytes}`; 503 while the token is unset |
| `POST` | `/v1/elect` | elect this property's image from this document |

`/v1/elect` takes the PDF as the **raw request body** — base64 of a 14 MB
brochure is ~19 MB and real CPU spent in the isolate that has none — with the
context in the `x-election-context` header. The answer is JSON with the
elected image base64-encoded, which is small.

## Security

- `Authorization: Bearer $BUILDER_STOCK_PDF_SERVICE_TOKEN` on every request
- the token is read from the environment, never from source
- an unset token means **503 on everything**, never open processing
- bounded body (32 MB), bounded time, non-root user

## Idempotency

The election is a pure function of the bytes and the context, so the same
request always yields the same winner; and because the worker writes nothing,
a retry cannot produce a duplicate image or a duplicate provenance row.
