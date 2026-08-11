# The 20-item checklist → control → gate → live test

One row per item. **Control** is what stops it, **Gate** is what stops the
control rotting, **Live test** is what proves the control is in production and
not only in git.

The third column is the one that matters and the one that is mostly empty. Every
other row in this table is source, and source is not deployment: a function that
was never redeployed passes every static gate in this repository. See
[`runbooks/live-negative-tests.md`](./runbooks/live-negative-tests.md).

| # | Item | Control | Gate | Live test |
|---|------|---------|------|-----------|
| 1 | `.env` in GitHub | `.gitignore` (SECR-001); no env file tracked | gitleaks in `ci.yml` + `codex-security-scan.yml`, full history (`fetch-depth: 0`) | — |
| 2 | API keys in front end | Only the publishable anon key ships; no service-role key in `src/` | `check-client-bundle-secrets.mjs` | — |
| 3 | No RLS | ~575 of ~634 tables have RLS; service-role-only is the default posture | `check-migration-security.mjs` (`table_rls`) — **WP-17** | — |
| 4 | Front-end permissions | `_shared/authz.ts` deny-by-default; the browser never decides | `check-admin-authorization-server-side.mjs`, `check-client-portfolio-authz.mjs`, `check-solicitor-intelligence-authz.mjs` | NT-11, NT-38 |
| 5 | No rate limiting | `_shared/authRateLimit.ts` (IP before identifier, unforgeable address header), `publicAbuseControls.ts` | `check-auth-rate-limit-coverage.mjs`, both portal checks | NT-29 *(unimplemented)* |
| 6 | SQL string concatenation | No `exec_sql` RPC exists; 401 `.rpc()` calls are named and typed; `EXECUTE format(` is migration-time DDL | — *(no gate; nothing to hold)* | — |
| 7 | No input validation | `_shared/validate.ts` (zod + size bound in one call) — **WP-20** | — *(adoption is the open work, not enforcement)* | — |
| 8 | User content as raw HTML | `dangerouslySetInnerHTML` in 2 files: one DOMPurify'd with a post-pass, one shadcn's typed CSS vars | — | — |
| 9 | Plain-text passwords | `_shared/password.ts`; no plaintext column anywhere | — | — |
| 10 | Auth in local storage | HttpOnly `__Host-session_token` only; `persistSession: false`; `AUTH_VERSION` scrubs legacy mirrors | `check-portal-session-client-storage.mjs`, `check-totp-enrollment-client-storage.mjs` | NT-30 *(unimplemented)* |
| 11 | Admin panel with no auth | `requireSuperadmin` above 17 named privileged actions | `check-admin-authorization-server-side.mjs` | NT-11 |
| 12 | CORS set to `*` | `createCorsHeaders` allowlist / `withRequestOrigin`; unset `ALLOWED_ORIGINS` fails closed — **WP-19** | `check-cors-contract.mjs` (transport tracing **and** registry exposure class) | **NT-37** |
| 13 | No email verification | `*-verify` flows on all four portals | — | — |
| 14 | Predictable IDs, no ownership check | ~726 UUID PKs; ownership checked before the read | `check-client-portfolio-authz.mjs` | **NT-38** |
| 15 | Saving the whole request body | `pickAllowed` + declared columns (`_shared/amlWritableColumns.ts`) — **WP-20** | `check-mass-assignment.mjs` (ratcheted at 51) | **NT-39** |
| 16 | Webhooks with no signature | HMAC or `clientState` on **every** webhook; each hardened away from "if configured" | `scan-auth-patterns.mjs`, `check-internal-call-signing.mjs` | NT-26, NT-27 *(unimplemented)* |
| 17 | Stack traces in production | `_shared/errorResponse.ts` — opaque body, correlation id, detail to the log — **WP-18** | `check-error-disclosure.mjs` (zero tolerance at 5xx) | **NT-40** |
| 18 | Outdated dependencies | Vendor-patched `xlsx` 0.20.3; Dependabot opens the PRs — **WP-21** | `dependency-audit.mjs` + `check-dependency-gate-level.mjs`, SBOM, osv-scanner | — |
| 19 | No password strength / breach check | 12 chars + 2-of-4 classes + HIBP k-anonymity — **WP-22** | `check-password-leak-coverage.mjs` | — |
| 20 | File uploads with no validation | `_shared/storageAuthz.ts` fail-closed, empty legacy allowlist; uploads backend-mediated | `check-storage-upload-hardening.mjs` | NT-20, NT-21 *(unimplemented)* |

## Where this stands

**Closed and gated:** 1, 2, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20.

**Closed, no gate:** 6 (there is no plausible regression to hold — adding an
`exec_sql` RPC would be a deliberate act), 8, 9, 13. Item 3 is gated for *new*
migrations only; the existing corpus is grandfathered.

**Open:** 7. `_shared/validate.ts` exists and nothing uses it yet. The count of
schema-validated edge functions is still **2 of 419**, and a helper with no call
sites is a plan, not a control.

## Two things this table cannot show

**Five migrations are authored and unapplied.** WP-17 and WP-22 ship SQL that
has deliberately not been run — the live database still has 2 ERROR-level
SECURITY DEFINER views, ~96 over-broad EXECUTE grants, and an
`email_copilot_emails` policy that accepts an anonymous insert. Those rows read
"closed" above because the control is written; they are not closed in
production.

**Nothing here has been proven live.** `live_negative_test` is `false` on 29 of
30 tracker findings. Ten matrix rows are implemented and the workflow is wired;
it has never been run, because it needs deployed-environment credentials. Until
it is, every claim in this document is a claim about a repository.

## Reading this next time

Start with the third column, not the first. If a row has a live test and it has
passed recently, believe it. If it has a gate and no live test, the control is
in the source and CI is keeping it there — which is worth a lot, and is not the
same as the control being in front of your users.

And check the dates on the notes. Twice during this programme a document said an
item was open when it had been closed weeks earlier — the staged RLS-W2
migration and the `investment-reports` bucket. Both cost an afternoon, and both
made the notes that *were* still accurate harder to trust.
