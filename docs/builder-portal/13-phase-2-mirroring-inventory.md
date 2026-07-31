# Phase 2 — Solicitor Portal mirroring inventory

**Baseline:** `0551d77dbd84d28c80c84ea32ee234ff89f0ed8e` (merge of PR #1749, Phase 1)

The Solicitor Portal is the direct implementation blueprint. This is the exact
file-by-file mapping, produced before any Builder code was written.

## 1. Shared authentication layer

| Solicitor | Builder | Notes |
| --- | --- | --- |
| `_shared/solicitorSessionToken.ts` | `_shared/builderSessionToken.ts` | Cookie-first credential extraction, portal discriminator, origin allow-list. **Legacy header/body carriers are not mirrored** — Builder is cookie-only (Phase 0 NOCOPY-02). |
| `_shared/solicitorSessions.ts` | `_shared/builderSessions.ts` | Issue / resolve / revoke / audit. Builder is a **TypeScript adapter over the Phase 1 SQL functions** (`builder_issue_session`, `builder_resolve_session`, `builder_revoke_session`, `builder_revoke_user_sessions`) rather than direct table writes. |
| `_shared/solicitorPortalAuth.ts` | `_shared/builderPortalAuth.ts` | Single session resolver + governance gate + server-side permission resolution. Builder adds organisation resolution and the rollout gate. |
| `createSolicitorSessionCookie` / `createClearSolicitorSessionCookie` in `_shared/auth.ts` | `createBuilderSessionCookie` / `createClearBuilderSessionCookie` in `_shared/auth.ts` | Same attributes, different cookie name. |

Reused unchanged: `_shared/sessionHash.ts` (HMAC-SHA256 with `SESSION_TOKEN_PEPPER`,
fails closed), `_shared/password.ts`, `_shared/passwordValidation.ts`,
`_shared/csrfGuard.ts`, `_shared/auth.ts` CORS, `_shared/brand-config.ts`.

## 2. Edge Functions

| Solicitor | Builder | Mirrors |
| --- | --- | --- |
| `solicitor-portal-login` | `builder-portal-login` | Credentials, lockout, rate limit, cookie issue |
| `solicitor-portal-logout` | `builder-portal-logout` | Revoke + clear cookie |
| `solicitor-portal-verify` | `builder-portal-verify` | Session restore, `get_governance`, `accept_current_terms`, `complete_onboarding`, `list_sessions`, `revoke_session`, `revoke_other_sessions` — **plus** `select_organisation` |
| `solicitor-portal-accept-invite` | `builder-portal-accept-invite` | `validate` and accept, password creation, session issue |
| `solicitor-portal-forgot-password` | `builder-portal-forgot-password` | Generic response, OTP, rate limits |
| `solicitor-portal-reset-password` | `builder-portal-reset-password` | `verify_otp` and reset, session revocation |
| `solicitor-portal-invite` | `builder-portal-invite` | Command Centre issuance, module-gated, CSRF |

The Solicitor Portal deliberately groups terms, onboarding and session
management inside `verify` rather than splitting them into separate functions.
Builder mirrors that grouping rather than inventing a different split.

## 3. Frontend

| Solicitor | Builder |
| --- | --- |
| `src/lib/solicitorPortal.ts` | `src/lib/builderPortal.ts` |
| `src/hooks/useSolicitorPortalAuth.tsx` | `src/hooks/useBuilderPortalAuth.tsx` |
| `src/components/solicitor-portal/SolicitorPortalProtectedRoute.tsx` | `src/components/builder-portal/BuilderPortalProtectedRoute.tsx` |
| `src/components/solicitor-portal/SolicitorPortalLayout.tsx` | `src/components/builder-portal/BuilderPortalLayout.tsx` |
| `src/components/solicitor-portal/SolicitorAuthShell.tsx` | `src/components/builder-portal/BuilderAuthShell.tsx` |
| `src/pages/solicitor/SolicitorLogin.tsx` | `src/pages/builder/BuilderLogin.tsx` |
| `src/pages/solicitor/SolicitorAcceptInvite.tsx` | `src/pages/builder/BuilderAcceptInvite.tsx` |
| `src/pages/solicitor/SolicitorForgotPassword.tsx` | `src/pages/builder/BuilderForgotPassword.tsx` + `BuilderResetPassword.tsx` |
| `src/pages/solicitor/SolicitorTerms.tsx` | `src/pages/builder/BuilderTerms.tsx` |
| `src/pages/solicitor/SolicitorOnboarding.tsx` | `src/pages/builder/BuilderOnboarding.tsx` |
| `src/pages/solicitor/SolicitorDashboard.tsx` | `src/pages/builder/BuilderDashboard.tsx` |
| `/solicitor/*` block in `src/App.tsx` | `/builder/*` block in `src/App.tsx` |

Builder-only additions with no Solicitor counterpart, required because Phase 1
permits multi-organisation membership:
`src/components/builder-portal/BuilderOrganisationSwitcher.tsx` and
`src/pages/builder/BuilderSelectOrganisation.tsx`.

## 4. Documented Solicitor defects NOT mirrored

Each was read in the source and deliberately diverged from.

| Solicitor behaviour | Builder behaviour |
| --- | --- |
| `DUMMY_PASSWORD_HASH` is declared in `solicitor-portal-login` but **never used** — a missing account returns before bcrypt runs, leaving a timing oracle | Builder always runs `verifyPassword` against the dummy hash when the account is missing or has no password, then evaluates account state |
| Account state (inactive, locked, firm inactive) is checked **before** password verification | Builder verifies the password first, then evaluates account state, so no state is observable without valid credentials |
| `invite_token` stored in plaintext | Builder stores `invite_token_hash` only (Phase 1 column) |
| `reset_token` (OTP) stored in plaintext | Builder stores `reset_token_hash` only; `consume_builder_portal_reset_attempt` compares hashes |
| Legacy `x-solicitor-session-token` header and `solicitor_session_token` body carriers still resolve sessions | Builder reads the cookie only; there is no legacy carrier to accept |
| Plaintext `session_token` / `session_expires_at` columns on the user row | Builder has no such column |
| `solicitor-portal-accept-invite` references an undeclared `updatedUser`, a latent `ReferenceError` on the success path | Builder captures the updated row and checks it |
| Activity logging is best-effort and swallowed | Builder access-control mutations use the Phase 1 fail-closed guarded commands |
| `mergePermissions` defaults missing keys to allow and OR-merges | Builder uses the Phase 1 deny-by-default `builder_resolve_permission()` |

## 5. Cookie parity

`__Host-builder_session_token`, `HttpOnly; Secure; SameSite=None; Path=/`, no
`Domain`, `Max-Age` from the session's absolute expiry — attribute-for-attribute
the Solicitor shape. `SameSite=None` is required because the Edge Functions are
served from a different origin than the SPA; the compensating control is the
central CSRF guard plus an exact-origin allow-list, which is exactly the
arrangement `_shared/csrfGuard.ts` documents for the existing portals.

## 6. Phase 1 gaps this phase must close

Read from the Phase 1 schema; each needs an additive migration:

| Need | Phase 1 state |
| --- | --- |
| `failed_login_attempts`, `locked_until`, `last_login_at` | absent from `builder_portal_users` |
| `terms_accepted_at` | absent |
| Onboarding steps | no `builder_onboarding_steps` table |
| Active organisation context | no server-held selection on the session |
| Atomic reset-attempt consumption | no `consume_builder_portal_reset_attempt` |

Reused from Phase 1 without change: `builder_portal_sessions` and its issue /
resolve / revoke functions, `builder_resolve_permission`,
`builder_accessible_organisations`, `builder_active_membership`,
`builder_portal_activity_log` and the six guarded commands, `portal_terms_*`,
`cross_portal_firm_rollouts` and `resolve_cross_portal_feature_mode_for`.
