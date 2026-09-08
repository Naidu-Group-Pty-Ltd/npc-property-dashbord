# Builder Stock PDF probe — TEMPORARY, NOT PRODUCTION

Delete this directory once the question below has an answer.

## The question

An Edge Function allows **2,000 ms of CPU** and one builder-stock election
costs more, so the work must run elsewhere. A Cloudflare Worker isolate allows
**128 MB** — *less* than the Edge Function's 256 MB — while the same election
was measured at 107–252 MB peak under Deno.

**Can the real Workers runtime run it inside 128 MB?**

Nothing here is wired to the settler. No database, no Supabase secret, no
storage. The bearer follows the pattern `builder-stock-image-worker` uses.

## What has been answered

**Execution: yes.** The shared `electFromPdfBytes` and `readPdfPageTextResult`
bundle and run in workerd. Four runs of each of the two documents that exceed
the Edge CPU limit:

| lot | status | reference | image bytes | elapsed |
|---|---|---|---|---|
| 516 | `recovered` | `#page2:Im0` | 2,027,024 | 1141–1308 ms |
| 6706 | `recovered` | `#page2:Im0` | 2,637,765 | 1155–1592 ms |

Same winners as the Deno path, byte-identical images, stable across repeats.

**The 128 MB limit: NOT answered.** `wrangler dev --local` does not enforce it
— `/v1/alloc?mb=900` allocated 900 MB and returned 200. A pass under a runtime
that is not applying the cap proves nothing about the cap, so this needs a
**deployed** Worker and Cloudflare credentials, which this environment does not
have.

## The reader, and a trap worth recording

A first version passed its own `extractText` wrapper and got `not_identified`
on **both** documents where production gets `recovered` — because
`readPdfPageTextResult` also appends each page's **AcroForm field text**, which
the cover-page identification for these brochures depends on.

That is the reimplementation trap in miniature. The shared reader is imported
now, and `wrangler.jsonc` aliases the `https://esm.sh/unpdf@0.12.1` specifier
to the same pinned npm package — a packaging alias, not a substitute reader.

## Running it

```sh
cd cloudflare/builder-stock-pdf-probe
npm install
printf 'BUILDER_STOCK_PDF_PROBE_TOKEN=probe-local-only\n' > .dev.vars
npx wrangler dev --port 8788 --local
```

`/v1/alloc?mb=N` is the calibration control: run it **first** on any runtime
before believing a memory result from it. If a 900 MB allocation succeeds, that
runtime is not enforcing the cap and its verdict on memory is worthless.

To answer the real question: `wrangler deploy`, set
`BUILDER_STOCK_PDF_PROBE_TOKEN` as a Worker secret, and repeat the elections
against the deployed URL. A `exceededMemory` there is the decisive answer.
