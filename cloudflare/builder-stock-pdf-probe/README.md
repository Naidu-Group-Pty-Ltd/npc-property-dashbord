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
the Edge CPU limit, `run-probe.mjs` against `wrangler dev --local`:

| lot | status | winner | image bytes | sha-256 | worker time |
|---|---|---|---|---|---|
| 516 | `recovered` | `l516.pdf#page2:Im0` | 2,027,024 | `41b8f9b9…` | 1197–1302 ms |
| 6706 | `recovered` | `l6706.pdf#page2:Im0` | 2,637,765 | `81391038…` | 1224–1338 ms |

Every run **hash-identical** to the deterministic in-process output, one winner
each, all eight served by **one isolate**.

**The 128 MB limit: NOT answered.** `wrangler dev --local` does not enforce it
— `/v1/alloc?mb=900` allocated 900 MB and returned 200. A pass under a runtime
that is not applying the cap proves nothing about the cap, so this needs a
**deployed** Worker and Cloudflare credentials, which this environment does not
have.

## Before deploying: two preconditions from Cloudflare's own limits page

1. **A Workers PAID account is required.** CPU time per request is **10 ms on
   Workers Free** and 30 s (raisable to 5 min) on Workers Paid. The election
   needs ~1.2 s. On a free account every run dies `exceededCpu` — a refusal
   that says nothing whatever about memory, and would be a false negative.

2. **The ceiling is per ISOLATE, not per invocation**, and exceeding it does
   not necessarily fail: *"the Workers runtime lets in-flight requests complete
   and creates a new isolate for subsequent requests."* So four sequential
   200s can hide four silent isolate recycles. That is why every answer carries
   `isolate` and `invocation`: **one isolate across all runs is a real pass;
   several is the ceiling biting quietly.**

## The reader, and two traps worth recording

**The reader.** A first version passed its own `extractText` wrapper and got
`not_identified` on **both** documents where production gets `recovered` —
because `readPdfPageTextResult` also appends each page's **AcroForm field
text**, which the cover-page identification for these brochures depends on. The
shared reader is imported now, and `wrangler.jsonc` aliases the
`https://esm.sh/unpdf@0.12.1` specifier to the same pinned npm package — a
packaging alias, not a substitute reader.

**The context.** The same failure recurred in the *driver*: a plausible
hand-written label with no `design` and no `identityHints` produced
`not_identified` on both documents in ~300 ms rather than `recovered` in
~1,200 ms. With no estate name to corroborate by, no cover page is recognised,
nothing is decoded, and the CPU-heavy half never runs — a result that would
have been written down as a fact about Cloudflare. `contexts.json` is therefore
derived from the live rows by the real `stockRecordLabel` /
`stockIdentityHints` / `designOfRecordOrRow`, and the runner refuses to guess a
context it does not have.

**Also found:** workerd refuses `crypto.randomUUID()` at module scope —
*"generating random values are not allowed within global scope"* — where Deno
allows it. The first genuine runtime difference this exercise has turned up,
and not one a local Deno run could show.

## How it is validated in CI

The probe is excluded from `tsconfig.worker.json` — that gate exists for
`builder-stock-image-worker`, whose stated premise is that it imports nothing,
and relaxing it to accept this directory's Deno-style `.ts` specifiers and
remote `esm.sh` import would weaken it for the worker it was written for. **The
probe is not exempt from validation; it is validated by the toolchains that
actually compile it**, in one temporary step in `ci.yml`'s `security` job:

```sh
deno check cloudflare/builder-stock-pdf-probe/src/index.ts
npm ci --prefix cloudflare/builder-stock-pdf-probe --no-audit --no-fund
npx --yes wrangler@4.129.1 deploy --dry-run \
  -c cloudflare/builder-stock-pdf-probe/wrangler.jsonc
```

`deno check` walks the probe entry and every `_shared` module behind it —
verified by mutation to fail on a type error in either. The wrangler build is
the half that resolves the `esm.sh` → npm alias and produces the bundle a
deploy would upload.

**The install is load-bearing, not incidental.** With no `node_modules` under
the probe the build FAILS (exit 1). It had only ever appeared to pass locally
because a stray **extraneous** `unpdf@0.12.1` was sitting in the repo root —
declared by neither root manifest, and deleted by the `npm ci` every CI job
runs. The lockfile is committed so `npm ci` gets a pinned tree.

## Running it

```sh
cd cloudflare/builder-stock-pdf-probe
npm ci
printf 'BUILDER_STOCK_PDF_PROBE_TOKEN=probe-local-only\n' > .dev.vars
npx wrangler dev --port 8788 --local
```

Then, from the repository root:

```sh
node cloudflare/builder-stock-pdf-probe/run-probe.mjs \
  --base http://127.0.0.1:8788 --token probe-local-only \
  --doc 516=/path/l516.pdf   --expect 516=/path/elected_l516.pdf.jpg \
  --doc 6706=/path/l6706.pdf --expect 6706=/path/elected_l6706.pdf.jpg \
  --runs 4 --rounds 4
```

### Three phases, and the order is the argument

1. **Calibration** (`/v1/alloc`) — asked first, always. If a 900 MB allocation
   succeeds, that runtime is not enforcing the cap and its verdict on memory is
   worthless.
2. **Sequential**, `--runs` each, one document in flight. Does the election run
   at all, and does it elect the same picture every time?
3. **Concurrent**, `--rounds` of both documents at once. **This is the phase
   the 128 MB question turns on**, because the ceiling is per-isolate and a
   single request never reaches it. It runs only if the sequential phase
   passed — concurrency after a sequential failure measures nothing new and
   would let a second failure read as a concurrency finding.

`elect()` is the only place a request is made, so both phases are the same
measurement rather than two that could disagree.

## To answer the real question

```sh
npx wrangler deploy -c cloudflare/builder-stock-pdf-probe/wrangler.jsonc
npx wrangler secret put BUILDER_STOCK_PDF_PROBE_TOKEN \
  -c cloudflare/builder-stock-pdf-probe/wrangler.jsonc
node cloudflare/builder-stock-pdf-probe/run-probe.mjs \
  --base https://<worker>.<subdomain>.workers.dev --token <the secret> \
  --doc 516=… --expect 516=… --doc 6706=… --expect 6706=… --runs 4 --rounds 4
```

Read the calibration block first. If `/v1/alloc?mb=200` still succeeds there,
stop — the instrument is uncalibrated.

**Sequential acceptance:** every run `recovered`, one winner each,
hash-identical to the deterministic output, one isolate.

**Concurrent acceptance:** both requests `recovered` every round, both
`#page2:Im0`, both hashes matching, **zero** resource kills or transport
failures, and — the reading that matters — **no isolate appearing that the
sequential phase did not see**. A fresh isolate under load means the ceiling
was reached even though every request returned 200, because the runtime "lets
in-flight requests complete and creates a new isolate for subsequent requests".

**Then read Workers Logs.** A kill returns no body of ours, so the invocation
outcome (`exceededMemory` / `exceededCpu` / `ok`) exists only there. The runner
prints the UTC window of each phase. `observability` is on in `wrangler.jsonc`:

```sh
npx wrangler tail builder-stock-pdf-probe \
  -c cloudflare/builder-stock-pdf-probe/wrangler.jsonc --format pretty
```

or Workers & Pages → builder-stock-pdf-probe → Metrics → Errors → Invocation
Statuses.
