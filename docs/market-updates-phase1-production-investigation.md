# Market Updates Phase 1 production investigation

Date: 2026-07-25. Scope: Phase 1 only.

## Connected project and evidence boundary

The repository and generated frontend client both identify Supabase project `dduzbchuswwbefdunfct`. The local Supabase link file identifies the same project. No deployment split is visible in tracked configuration.

This execution environment has no Supabase CLI, access token, database password, service-role credential, application login, or Market Updates secrets. Outbound requests to the linked Supabase host are blocked by the environment proxy (`CONNECT ... 403`). Consequently, production SQL, migration history, secrets, function versions/logs, cron history, authenticated RLS behavior, browser network traffic, and source responses could not be truthfully inspected or mutated from this run. No production migration or function deployment is claimed.

## Confirmed repository root causes

1. The frontend service converted database, RLS, auth, deployment, and network failures into empty arrays/null values. This made a failed runtime indistinguishable from a genuinely empty registry/feed.
2. The page-open path accepted an active single-flight run but did not follow it to completion, so the UI could remain on “Checking…” without reloading completed results.
3. AI output used segment names as database categories (`property`, `economic`, `rental`, `social`) and allowed unsupported audience values (`buyers`, `brokers`, `advisers`, `policy`). These values do not match the persisted/frontend contracts and could cause insert failures or invisible filters.
4. Ingestion treated zero enabled sources as a successful empty run and did not distinguish an unseeded registry from an all-disabled registry.
5. The ingestion function did not create `market_source_fetch_runs`, preventing the requested source-level audit trail and health diagnosis.
6. The original seed migration existed only as a newly added migration and therefore could not repair an environment where deployment stopped before it. Its cron statement could schedule a broken URL/secret when settings were unset. The recovery migration is additive and idempotent, seeds by stable `source_key`, preserves operational health fields during safe configuration upserts, and schedules only when prerequisites are configured.
7. The Federal Register adapter deliberately reports that documented API resource configuration is unavailable, while its seed was enabled. It is now disabled with an explicit reason until configuration exists.
8. Post-ingestion digest invocation sent a service-role credential between Edge Functions, contrary to the repository security boundary. It now uses the dedicated cron credential already accepted by the digest function and does nothing when that credential is absent.

## Remediation delivered in Phase 1

- Typed operational errors with stage, safe message, HTTP status, function name, remediation, retryability, and an actionable page alert. Cached state is not cleared when a refresh fails.
- Authoritative active-run polling with terminal failure and timeout behavior.
- Explicit segment-to-category mapping and strict audience validation for AI and heuristic classification.
- Explicit unseeded/all-disabled failures; ingestion/source fetch run completion records; per-source published counts and safe fallback/failure details.
- Additive production-recovery migration for the complete runtime contract, stable 20-key upsert, protected health history, RLS/grants, lock RPC, and guarded hourly scheduling.
- Focused seed and classification contract tests.

## Production owner verification still required

With authorised production tooling, apply `20260725130000_market_updates_phase1_production_recovery.sql`, deploy the five Market Updates functions, verify secret presence by name (never value), and execute the 20-step live acceptance sequence in the task. In particular, capture all 20 source adapter outcomes, SQL counts, completed run/fetch-run records, published citations, digest result, cron history, authenticated RLS reads, and browser console/network evidence. Those results cannot be fabricated from a credential-less, network-blocked environment.
