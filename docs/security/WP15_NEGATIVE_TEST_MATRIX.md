# WP-15 — Runtime Negative-Test Matrix

Source: the restricted security program's approved negative-test work package.

Every row below must be executed against the **deployed** environment (not
localhost, not staging-of-staging). Each test produces one JSON line:

```json
{"id":"NT-01","target":"market-ai","input":"alg=none JWT","expected":"401","observed":"401","result":"expected_denial"}
```

Store results at `docs/security/wp15-evidence/<date>/negative-tests.jsonl`.
`result` must be `expected_denial` on every row. Anything else blocks launch.

| ID | Target | Attack | Expected result |
|----|--------|--------|-----------------|
| NT-01 | any `verify_jwt=true` function | Forged HS256 JWT signed with wrong secret | 401 `invalid_jwt` |
| NT-02 | any `verify_jwt=true` function | Expired JWT (`exp` in past) | 401 `expired` |
| NT-03 | any `verify_jwt=true` function | JWT with `alg=none` header | 401 |
| NT-04 | `market-ai-*`, `report-qa`, `ai-dashboard-agent` | Anon key with no user JWT | 401 |
| NT-05 | Market AI orchestrator | Arbitrary `Authorization: Bearer <random>` | 401 |
| NT-06 | Any cron-worker function | Missing `X-Cron-Secret` | 401 |
| NT-07 | Any cron-worker function | Wrong `X-Cron-Secret` | 401 |
| NT-08 | Any cron-worker function | Replayed cron secret past `X-Cron-Timestamp` window | 401 `stale_or_replayed` |
| NT-09 | Any internal-service function | Missing `X-Internal-Signature` | 401 |
| NT-10 | Any internal-service function | Signature computed with previous key + `INTERNAL_STRICT_SIGNED=true` after rotation window | 401 |
| NT-11 | `admin-*` functions | Authenticated non-superadmin JWT | 403 `superadmin_required` |
| NT-12 | `finance-portal-*` (any) | Portal token issued to Client A → request for Client B's purchase file | 403 `not_authorized` |
| NT-13 | `client-portal-*` (any) | Portal session for Client A used against Client B endpoints | 403 |
| NT-14 | `report-qa` | Conversation ID belonging to another user | 403 `not_owner` |
| NT-15 | `email-copilot` | `mailbox` param not owned by session | 403 `mailbox_forbidden` |
| NT-16 | `ai-dashboard-agent` low-priv role | Attempt destructive tool (`delete_*`, bulk write) | 403 `step_up_required` or `not_permitted` |
| NT-17 | Step-up gated endpoint | Reuse of consumed step-up token | 401 `step_up_replayed` |
| NT-18 | Commission ledger writer | Duplicate commit for same (payout_id, milestone) | 409 `duplicate_commit` |
| NT-19 | Any external send fn (email/SMS/WhatsApp) | Send twice with same idempotency key within window | 409 `duplicate_send` |
| NT-20 | Storage — direct URL to sensitive bucket object | GET without signed URL | 403 |
| NT-21 | Storage — signed URL from Client A rebound to Client B path | 403 `binding_mismatch` |
| NT-22 | Public forms (`request-lead-magnet`, marketing) | CSRF: POST without Origin / Referer | 403 |
| NT-23 | Public forms | Missing/failed Turnstile token | 403 `human_verification_failed` |
| NT-24 | `render-source` | ZIP payload > 15 MB base64 | 413 |
| NT-25 | `render-source` | URL host `127.0.0.1`, `2130706433`, `[::1]`, `0x7f.0.0.1`, `169.254.169.254` | 400 `ssrf_denied` |
| NT-26 | `outlook-email-webhook` | Replay identical Graph notification | second call responds 200 with `skipped:true`, no side effect |
| NT-27 | `outlook-email-webhook` | `clientState` mismatch | 401 |
| NT-28 | Metering (Mission Control token spend) | Force Mission Control 5xx → verify graceful degradation, no unpaid generation | 503 with `metering_unavailable` |
| NT-29 | Public quota boundary | Exceed sliding-window quota on `google-places-autocomplete` | 429 `quota_exhausted` |
| NT-30 | Cookie theft / session fixation | Reuse portal cookie from another IP after idle timeout | 401 `session_expired` |
| NT-31 | Oversized attachment on ingest endpoints | > declared cap | 413 |
| NT-32 | Enumerate cross-user IDs on finance / clients / reports | UUID from another tenant | 403/404 (never leak existence) |
| NT-33 | `security-step-up` enrolled TOTP user | Missing, malformed, or incorrect `mfa_code` | 401 `mfa_verification_required`; no proof minted |
| NT-34 | `security-step-up` enrolled TOTP user | Reuse a previously accepted 30-second TOTP code | 401 `mfa_code_replayed`; no proof minted |
| NT-35 | Step-up gated endpoint | Present a valid proof with a different/revoked staff session | 401 `step_up_required` |
| NT-36 | `security-step-up` TOTP enrollment confirmation | Use another staff session's enrollment token or an expired token | 401 `invalid_enrollment_confirmation`; no MFA activation |

## Automation hooks

The negative-test runner lives at `scripts/security/wp15-negative-tests.mjs`
(to be added by the QA owner). It reads `WP15_NEGATIVE_TEST_MATRIX.md` inline
IDs and posts each request via `fetch()` with expected status codes.
