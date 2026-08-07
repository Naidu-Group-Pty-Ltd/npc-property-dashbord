# API usage metering — this deployment may be spending someone else's money

## The situation

A workspace provisioned by **Aurixa Mission Control** is a clone of this repo's
Supabase architecture, and it boots with the prime's own vendor keys forwarded
into its project: `OPENAI_API_KEY`, `RESEND_API_KEY`, `DOMAIN_API_KEY`,
`COTALITY_API_KEY`, `LOVABLE_API_KEY` and the rest. That is what stops every
edge function 500-ing on a secret shell on day one.

It also means every model token, transactional email and property lookup that
workspace makes is billed to the *prime's* vendor accounts. Mission Control
recharges it per tenant. A workspace that supplies its own key for a given
secret costs the prime nothing for that key and is charged nothing for it.

**The prime install itself is never charged** — a tenant with no clone is
Mission Control's own project. Nothing here changes what this repo costs to run
in its home deployment; it makes the same calls attributable when the code is
running somewhere else.

## What this repo contributes

Nothing decides billing here. This repo's job is to say *what was consumed and
on which credential*; Mission Control decides whose key it was, from its own
record of what it forwarded.

| file | role |
|---|---|
| `_shared/logApiUsage.ts` | already writes every metered call to `api_usage_log` — unchanged, and still the only place call sites touch |
| `_shared/apiUsageBilling.pure.ts` | `service_name` → the secret name it spent, and what one unit of it is. Pure, tested |
| `report-api-usage/` | cron worker that drains the queue into Mission Control |
| `_shared/missionControl.ts` | `reportApiUsage()` — the only place that talks to the metering API |
| migration `…_api_usage_mission_control_forwarding.sql` | the queue columns and the claim/mark RPCs |

## Why a worker and not an inline call

Metering on the request path puts a network hop in front of a client's report to
buy a billing nicety, and loses the call outright whenever Mission Control is
slow. Rows queue in `api_usage_log` instead and `report-api-usage` drains them in
batches of 200, so an outage delays revenue rather than destroying it.

The **row id is the idempotency key**. The worker retries; without a stable key
a re-sent batch would meter the same calls twice. Mission Control dedupes on
`(tenant, idempotency_key)` and returns the original rating.

## The queue

`api_usage_log` gained four columns:

- `mc_reported_at` — NULL means still queued
- `mc_attempts` — at 5 the row leaves the partial index and needs an operator
- `mc_last_error`
- `mc_billing_reason` — Mission Control's verdict: `inherited` (billed), `byok`,
  `no_key`, `unknown_secret`, `not_billable`, `error_call`, `rate_missing`

`api_usage_forwarding_status()` gives pending / stuck / reported / billed /
own-key / unbillable counts and the oldest pending row.

`claim_api_usage_for_forwarding()` deliberately narrows what the worker can read
to the fields metering needs — `api_usage_log` carries request metadata that has
no business leaving this project. Rows older than 30 days are skipped: Mission
Control will not accept them, so retrying them forever is pure waste.

Claim and mark are separate RPCs so a partial failure marks only what actually
landed. An all-or-nothing update would either re-bill the accepted rows or
silently drop the rejected ones.

## Adding a vendor

Two rules, both cheap to get wrong:

1. **`service_name` must be in the map.** `apiUsageBilling.pure.ts` resolves
   `service_name` → secret name. It is deliberately explicit — no fuzzy
   matching, no "closest key" fallback. An unmapped service is metered here and
   **never billed**, because guessing bills the wrong tenant, which is worse
   than not billing. Aliases are handled (`ghl` / `gohighlevel`, `lovable-ai` /
   `lovable-ai-gateway`), but a new vendor needs a real entry.

2. **Or name the credential at the call site.** `metadata: { secret_name:
   "OPENROUTER_API_KEY" }` wins over the map. That is how a new vendor gets
   billed before this file learns about it.

Then add a matching row to Mission Control's `api_provider_rates`, or the call
lands as `rate_missing` on its dashboard.

`service_name` is a vendor, not a credential: `google-maps` and `google-ai` are
the same vendor and separate bills. Keep them apart.

## Instrumentation coverage is the real limit

Only calls that reach `logApiUsage` are metered at all. At the time of writing,
27 of this repo's edge functions call it, against ~30 distinct billable
credentials referenced across all 412. Everything else — Resend sends, Domain
and Cotality lookups, DocuSign envelopes, WeasyPrint renders — makes real vendor
calls that no meter sees.

That gap costs money silently and it is not visible from the billing dashboard,
which can only show what it was told about. Instrumenting a function is a
one-line `logApiUsage` call and it is the highest-value work left in this area.

## Deployment

- `verify_jwt = false` in `config.toml`; the function authenticates itself with
  `INTERNAL_EDGE_SECRET` or the cron secret, constant-time compared. It reads a
  billing queue and is never public.
- Registered `cron-worker` in `functions-registry/SECURITY_REGISTRY.json`.
- Schedule it hourly via pg_cron with `x-internal-edge-secret`. Frequency only
  affects how fresh Mission Control's dashboard is; a missed run costs nothing
  because the queue drains on the next one.
- Requires `MISSION_CONTROL_URL` and `MISSION_CONTROL_CLONE_API_KEY`, and that
  key must carry the **`usage:report`** scope. Without the scope the worker
  gets 401s, the retry counter burns out, and nothing is ever billed — silently.

## The other side

Mission Control's contract, the billability rule, the rate catalog and
settlement: `docs/prime-repo-api-usage-metering.md` in `aurixa-mission-control`.
