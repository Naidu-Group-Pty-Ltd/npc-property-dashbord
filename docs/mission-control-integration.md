# Mission Control Integration

Aurixa **Mission Control** owns billing for this clone. It provisions a long-lived
clone API key, meters every report/job we generate, and lets us rotate the key
from this dashboard at any time.

## Where the key lives

- Stored as the **`MISSION_CONTROL_CLONE_API_KEY` Supabase secret** (project-level,
  encrypted at rest). The key is never written to the database, never returned to
  the browser, and never logged.
- Only `supabase/functions/_shared/missionControl.ts` reads it via
  `Deno.env.get("MISSION_CONTROL_CLONE_API_KEY")`. Every other code path goes
  through that shared module.
- Companion secrets:
  - `MISSION_CONTROL_URL` — base URL of the Mission Control public API.
  - `MISSION_CONTROL_WEBHOOK_SECRET` — HMAC-SHA256 secret for inbound webhooks.
  - `SUPABASE_ACCESS_TOKEN` — required for the rotation flow (writes the new
    secret via the Supabase Management API).

## Metering flow

```
reserveTokens(estimate) → run generator ─┬─ finished OK ──→ commitTokens(actual)
                                         ├─ chunk done ───→ hold (reservation stays open)
                                         └─ failed ───────→ releaseTokens()  (cancel, or refund
                                                                              if already committed)
```

- Wrapper: `withReportMetering()` in `_shared/reportMetering.ts` (the older
  `withTokenReservation()` in `_shared/missionControl.ts` is the same
  reserve/commit/cancel shape for non-HTTP callers).
- The commit/hold/release decision is pure and unit-tested:
  `_shared/reportMeteringOutcome.pure.ts` (spec:
  `src/lib/tokens/__tests__/reportMeteringOutcome.pure.spec.ts`).
- Every reservation includes a stable client-generated `idempotency_key` so
  retries don't double-spend.
- Errors are typed: `InsufficientTokensError` (402), `RateLimitedError` (429),
  generic `MissionControlError`.

### Billing invariant: a failed report costs nothing

Report generation is **chunked** — the browser calls
`generate-investment-report` / `regenerate-report-qualitative` once per section
(`singleSection: true`), and each intermediate call answers HTTP 200 with
`isComplete: false`. Three rules keep a run that never finishes free:

1. **Hold, don't commit.** Intermediate chunk responses leave the Mission
   Control job `reserved`. Committing on them closed the job after section 1,
   after which a failure in any later section could no longer be canceled —
   `cancel_token_reservation` is a no-op on a `completed` job — so the report
   ended up `failed` with the tokens spent.
2. **Release on any failure.** Non-2xx, a `success: false` body (even with a
   2xx status), or a thrown handler all call `releaseTokens()`, which cancels a
   live reservation *or* refunds one an earlier call already committed
   (`refund_if_committed` on `POST /api/public/tokens/cancel` → Mission
   Control's `release_token_job` RPC).
3. **Reservations outlive the run.** `MC_RESERVATION_TTL_SECONDS` (default
   7200s, clamped to MC's 30…86 400s) is passed on reserve so a held
   reservation can't expire mid-generation. Only the call that *creates* the
   job sets the TTL — later chunks reserve idempotently against the same key.

Failures that happen **between** edge calls (a section exhausted its retries,
the tab closed, the operator hit *Stop generation*) never reach the wrapper.
`manage-investment-reports` therefore calls
`releaseInvestmentReportRunTokens()` whenever a report is updated to
`status: 'failed'`. That helper is scoped to the report's **current version** —
`investment_reports.current_version` only advances when a report *completes*,
so a previously finished and legitimately paid version can never be refunded by
a later failure. Qualitative-regen (`regen-qual:…`) keys carry no version and
are deliberately out of scope for the out-of-band path; their held reservations
simply expire, having never been debited.

Setting: **`MC_RESERVATION_TTL_SECONDS`** (optional Supabase secret, default
`7200`).

## Manual rotation

UI lives under **Settings → Mission Control Key** (superadmin only).

1. Admin clicks **Rotate key**, picks grace period (0–168 h, default 1 h) and an
   optional reason.
2. `mission-control-rotate-key` edge function POSTs to
   `${MISSION_CONTROL_URL}/api/public/clones/rotate-key` with the current key.
3. Mission Control returns `{ key, key_prefix, revoke_at }` once.
4. The function writes the new key into the `MISSION_CONTROL_CLONE_API_KEY`
   secret via `POST https://api.supabase.com/v1/projects/{ref}/secrets` and
   records an audit row (`event = "key.rotated.manual"`) — without ever logging
   the raw secret.
5. The previous key continues to work for the full grace period; warm edge
   workers pick up the new value on next cold start. After `revoke_at`,
   Mission Control disables the old key automatically.

The dialog deliberately does **not** echo the new secret to the UI — it is
already persisted to the secret store, and the prefix is enough for operators.

## Webhook events

All events arrive at the public `mission-control-webhook` edge function. Each
request must include the `x-mc-signature` header (HMAC-SHA256 of the raw body
using `MISSION_CONTROL_WEBHOOK_SECRET`); mismatched signatures get a `401`. The
function de-dupes on `x-mc-idempotency-key` via `token_webhook_events`.

| Event | What we do |
|------|-----------|
| `tokens.test` | No-op success (used by the MC "Send test webhook" button). |
| `tokens.balance.updated` | Upsert into `token_balance_cache` so the header pill is fresh between polls. |
| `tokens.key.rotated` | If the payload contains a new key (`new_key` / `key` / `secret`), update the `MISSION_CONTROL_CLONE_API_KEY` secret automatically and write an audit row. This is what allows MC-initiated rotations to take effect with zero manual cleanup. |
| `tokens.key.revoked` | Audit row with `status = "error"` so it surfaces on `/admin/token-audit`. |
| `tokens.alert` | Audit row (`event = "webhook:tokens.alert"`) for ops review. |

## Edge functions

| Function | Purpose |
|----------|---------|
| `mission-control-balance` | Auth'd proxy for `getBalance()` — used by the header pill and `useTokenBalance`. |
| `mission-control-packs` | Auth'd proxy for top-up packs + paginated listing. |
| `mission-control-key-info` | Superadmin-only. Returns key prefix, base URL, last successful call, last rotation. Never returns the raw secret. |
| `mission-control-rotate-key` | Superadmin-only. Performs the rotation flow above. |
| `mission-control-webhook` | Public (HMAC-verified). Handles all `tokens.*` events. |

## Operational notes

- Rotations within the grace period are **safe to repeat** — MC honours the
  previous key until its scheduled revoke time even if a newer rotation has
  already run.
- If `mission-control-balance` starts returning `401` after a rotation, force a
  cold start (deploy a no-op change to the function) so workers re-read the
  secret immediately instead of waiting for natural recycling.
- The header `TokenBalancePill` polls every 3 minutes and refreshes on focus +
  on `onTokensUsed` / `onOutOfTokens` events.
