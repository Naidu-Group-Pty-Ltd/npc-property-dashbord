# The isolated S5 validation environment

**Authorised:** 17 Sep 2026, bounded non-production validation, ceiling **A$25**.
**Spent so far: A$0.00 / US$0.00.**

## 1. Currencies and the ceiling

Both chargeable currencies are **USD**:

| Charge | Unit | Currency | Source |
|---|---|---|---|
| Supabase preview branch | $0.01344 / hour | USD | `get_cost(branch, mrfuwtroeeczontuqwsz)` |
| Model usage | per call | USD | `api_usage_log.cost_estimate_usd` |

A$25 is converted at a deliberately **pessimistic** A$1 = US$0.62, giving a
working ceiling of **US$15.50**. A better rate only adds headroom. **Hard stop
on model runs at US$13.00**, leaving US$2.50 for pending and unreported charges
and for shutdown.

### Per-generation cost, measured two ways

| Method | Result |
|---|---|
| Burst clustering of `sonar-pro` `/chat/completions` calls carrying `metadata.section`, 20-minute gaps | most recent run (17 Sep, 14 distinct sections, 15 calls) = **US$0.895**; the four other single-report runs 0.84–1.15 |
| 30-day total over reports created | US$32.24 across 505 section calls ÷ 42 reports = **US$0.768** |

Budgeted at **US$1.50 per Compass generation** (67% above the measured
figure), covering the extra pinned context and one section retry. Fork is
deterministic and costs nothing. Condense is one model call per document.

| Line | Qty | US$ |
|---|---|---|
| Compass generation (2 properties × 2 rounds) | 4 | 6.00 |
| Condense (Briefing + Snapshot, 2 properties × 2 rounds) | 8 | 2.40 |
| Fork (Financial + Strategic) | 8 | 0.00 |
| Environment | — | 0.00 |
| **Expected** | | **8.40** |

## 2. What was provisioned, and why not a Supabase branch

A Supabase preview branch was the plan. Two calls to `create_branch` timed out
at 60s with no branch row appearing, and probing the one branch that already
exists (`aml-staging-validation`, `yncczbrmicjebjepfave`) showed it carries
**10 edge functions** against production's 425 — so a branch does **not**
inherit the function set, and `generate-investment-report` would have to be
deployed to it along with its callees.

What was provisioned instead is **a native PostgreSQL 16.13 cluster inside the
session sandbox**, and it is *more* isolated than a branch would have been:

| Property | Reading |
|---|---|
| outbound-capable extensions **installed** | **NONE** |
| outbound-capable extensions **available to install** | `postgres_fdw`, `dblink` only — no `pg_net`, no `http`, no `pg_cron` |
| scheduled jobs | 0 (no `cron` schema exists) |
| `listen_addresses` | `127.0.0.1` |
| port | 55432 |
| cost | $0.00 |

**The database has no mechanism to make an outbound HTTP request or to run a
scheduled job.** That is a stronger guarantee than a branch, where isolation
depends on the vault being empty rather than on the capability being absent.

### What a branch would have done, measured

Worth recording, because it is the hazard the instruction asked about. A fresh
branch applies main's migrations, which create **66 active pg_cron jobs** —
among them `process-scheduled-emails-every-minute`, three finance-portal
notification jobs, seven market-update digests, and eight register refreshes.
Four of them **hardcode the production URL**
(`https://dduzbchuswwbefdunfct.supabase.co/functions/v1/...`).

They fail closed, and by construction rather than configuration:

- `cron_invoke_signed_function` (28 jobs) — `raise exception` when
  `vault.decrypted_secrets` has no `supabase_url`.
- `market_sales_refresh` (8 jobs) — same.
- `cron_signed_internal_headers` — `raise exception` unless
  `internal_edge_secret` or `..._v2` is present and ≥16 chars. The four
  hardcoded-URL jobs compute headers *before* `net.http_post` is evaluated, so
  the statement aborts and **no request reaches production**.

## 3. Disposable records

Two rows, carrying the two subjects' real ids, inserted into a local table
built from production's own `information_schema` definition of
`investment_reports` (41 columns, read-only query). The fork then wrote four
children. **Production is untouched** — verified after the run: 1,230 reports,
**0** carrying either subject as `derived_from_report_id`, most recent write
`2026-09-17 09:10:30Z` (the original generation, hours before this session).

## 4. What ran, and what could not

### Ran for real
`scripts/reports/s5IsolatedFork.mts` — the production modules, unmodified, in
the handler's own order: `loadSplitRegistry` (code-default branch) →
`readPropertyFacts` → `scoreFinancial` / `scorePropertyFundamentals` →
`variantScoreUnderPolicy` → `composeForkDocuments`, then the insert with the
handler's own `sharedFields` shape against the real schema.

Result: four child rows. Annabelle financial 23,838 chars / strategic 51,403;
Pallas financial 20,534 / strategic 30,679. **Both children of each parent
carry the parent's grade under `authority: v2`** (Annabelle F, Pallas C) — the
fork minted none, which is `variantScorePolicy` proven through persistence
rather than in memory.

`scripts/reports/s5Preservation.mts` re-reads the **persisted** children and
compares 16 protected inputs against the parent. **PASS on all 16, both
properties, both children** — including `purchasePrice` (1,490,000 /
575,000), the accepted CGR override (6.2 / 9.7), the loan triple, `lvr` 80 and
the year-10 projection. Both linkage columns written on 4 of 4 children.

### Could not run
**Anything that calls a model.** Two independent blockers:

1. **No credential.** `generate-investment-report` reads
   `Deno.env.get('PERPLEXITY_API_KEY')`. It is not in this sandbox, and
   Supabase Edge Function secret *values* are write-only — there is no read
   path for me to copy it onto an isolated environment.
2. **No egress.** The sandbox gateway answers **403 to CONNECT** for
   `api.perplexity.ai` and `api.openai.com` (and for `esm.sh` and
   `deno.land`, which is separately why the edge handler cannot be loaded
   verbatim — it imports `https://esm.sh/@supabase/supabase-js@2`).

So the HTTP wrapper (`Deno.serve`, `verifyAuth`, `createCorsHeaders`,
`enforceCsrf`, `requireModulePermission`) was **not** exercised, and is stated
as such rather than worked around.

## 5. The one operation that needs the owner

To run the Compass generation and the Briefing/Snapshot condensation for real,
**one** of the following is required:

- **(a)** `PERPLEXITY_API_KEY` set as an Edge Function secret on a
  non-production Supabase project, with `generate-investment-report`,
  `condense-investment-report` and their callees deployed to it; or
- **(b)** a **test** Perplexity key supplied to this session **together with**
  `api.perplexity.ai` added to the sandbox's egress allow-list — both are
  needed, neither alone is sufficient.

Everything else in S5 proceeds without it.
