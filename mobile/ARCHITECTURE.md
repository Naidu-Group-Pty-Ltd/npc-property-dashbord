# NPC Mobile — the audited basis

This file records what was **measured in this codebase** before any Dart was
written, and what each measurement forces the mobile architecture to do. It
exists because every expensive mistake available here is the same mistake:
designing the app against how the platform is assumed to work rather than how
it does.

Read this before `plan.md`. `plan.md` says what we will build; this says why it
has that shape, and which of its rules are load-bearing.

Every claim below names the file it came from. If you change one of those
files, change the finding here too — a stale fact in this file is worse than
no file, because the next person will trust it.

---

## A1 · The Command Centre already issues a Bearer credential

`_shared/customAuth/login.ts:268` mints an HS256 JWT and returns it in the
response body:

```ts
accessToken = await generateSupabaseJWT(user.id, 86400, {
  email: user.email, roles, userMetadata: { username, custom_role },
});
// …
access_token: accessToken,
```

`_shared/auth.ts` `verifyAuth` verifies that token cryptographically and maps
`sub` → `custom_users` (the Bearer branch, ~lines 200-250). `_shared/csrfGuard.ts`
states the complementary rule:

> If no cookie is present on the request (auth is header-only), the CSRF check
> is bypassed because the classic CSRF attack vector (ambient cookie authority)
> is absent.

**Consequence.** A native client can authenticate against the Command Centre
**today, with no server change** — `POST custom-auth-login-v2`, take
`access_token`, send `Authorization: Bearer …`. The commonly-assumed blocker
("staff auth is cookie-only, mobile needs a whole new auth stack") is false.
The header-only path is not a workaround; it is the path the backend was
already hardened for.

## A2 · …but that credential cannot be revoked or refreshed

The `access_token` lives **24 hours** and is not bound to the `user_sessions`
row created beside it (`login.ts:231`). Session revocation, idle expiry
(`computeIdleExpiry`), and device release all act on the *cookie* session. None
of them invalidate the JWT.

**Consequence.** The staff server work is not "issue a bearer token" — that
exists. It is **revocability, short lifetime and rotation**:

| Function | Job |
|---|---|
| `mobile-auth-login` | Reuse `handleStaffLogin`'s password check, lockout, rate limiting. Issue a 10-15 minute access JWT carrying a `sid` claim + a rotating opaque refresh token in `user_sessions`. **Set no cookie.** |
| `mobile-auth-refresh` | Validate and rotate the refresh token, re-check `isSessionUsable`, mint a new access JWT. |
| `mobile-auth-logout` | Revoke the session row, release the device seat. |
| `verifyAuth` | Reject a Bearer token whose `sid` names a revoked or idle-expired session. Tokens **without** `sid` must behave exactly as they do now. |

Reuses `_shared/sessionHash.ts` and `_shared/jwt.ts` unchanged.

## A3 · The web cookie is the sole staff carrier — do not touch it

`_shared/auth.ts:379`:

```ts
// WP-11B/C Phase 4: the `__Host-session_token` HttpOnly cookie is the SOLE
// carrier for staff sessions. The legacy `session_token` cookie name and
// every header/body/authorization fallback … has been removed.
```

**Consequence.** Mobile must never be the reason a header or body fallback
returns. A1 means it never needs to be. *(Housekeeping: the JSDoc at
`auth.ts:371-378` still documents the removed priority order and is stale.)*

## A4 · ES256 rules out the obvious Supabase client usage

`authenticated-data/index.ts` records that both Supabase projects moved to
ES256 signing, so the HS256 tokens `_shared/jwt.ts` mints are rejected by
PostgREST — the browser "holds no usable RLS token", and direct queries run as
`anon` against RLS-enabled tables, **silently returning empty instead of
failing**.

**Consequence, and it is the single most important one for Dart authors:**

- `supabase.from('…').select()` against a protected table returns **empty, not
  an error**. A mobile screen built that way looks like it works and shows
  nothing, forever.
- **Realtime is unavailable** for the same reason. Every "live" surface polls.
  Use the pattern the Agreement Centre already proved
  (`syncStamp.pure.ts`): poll four cheap scalars, refetch payloads only when
  the stamp moves.
- All protected data goes through Edge Functions. `authenticated-data`
  authenticates with `verifyAuth`, so it already accepts Bearer and already
  passes `enforceCsrf` for a cookieless caller.

*(Housekeeping: the `// Supabase-compatible JWT for direct RLS/realtime`
comment at `login.ts:294` is stale and actively misleading — it describes a
capability ES256 removed.)*

## A5 · Device seats are Mission Control's, and a phone costs one

`src/lib/deviceSession.ts` wraps the `mission-control-devices` Edge Function
(`register` / `heartbeat` / `release` / `list` / `revoke`) so the clone API key
never reaches a client. **The function is transport-agnostic and is reused
unchanged by mobile** — no server work here at all.

What changes is the identifier. `src/lib/deviceFingerprint.ts` derives one from
`navigator.userAgent`, screen size and timezone plus a random UUID in
`localStorage`. Mobile replaces this with a **UUID generated at first launch and
stored in Keychain/Keystore** — stable, private, and clear of Apple's rules on
deriving identity from device characteristics.

**The commercial consequence must not be discovered by a user.**
`seat_plans.device_limit_per_seat` is *Starter 2 / Growth 3 / Pro 5 /
Enterprise 10*. On Starter, **one browser plus one phone exhausts the cap** and
the next sign-in fails with `device_limit_reached`. Shipping mobile changes what
a seat means. Someone in the business decides this, not the app.

## A6 · Mission Control makes this a fleet product

Mission Control provisions per-tenant **clones**, each reachable at
`<slug>.aurixasystems.com.au` with its own backend
(`aurixa-mission-control/docs/subdomain-fleet-hosting.md`).

**Consequence.** An app with a hardcoded Supabase URL serves exactly one
tenant. Five apps × N tenants of hardcoded binaries is an app factory — a store
relations disaster and an unshippable release process. So **the apps resolve
their backend at runtime**:

```
launch → cached tenant? ──yes──→ boot {supabaseUrl, anonKey, brand}
            │ no
            ▼  workspace slug (typed, or derived from email domain)
     GET https://<slug>.aurixasystems.com.au/.well-known/npc-mobile.json
            ▼  {supabaseUrl, anonKey, minAppVersion, portalsEnabled[]}
     persist in secure storage
```

A static, unauthenticated discovery document per clone. **No Mission Control
credential ever reaches a device** — the device talks to its tenant, and only
the tenant's server talks to Mission Control (the same boundary
`deviceSession.ts` already keeps).

`minAppVersion` doubles as the forced-upgrade gate. Flavors
(`development`/`staging`/`production`) select which *discovery* environment is
consulted — not a hardcoded project — which is what makes a three-environment
model work in a fleet.

## A7 · The generated contracts drift, and did

`mobile/design-tokens.json` and `mobile/api-surface.json` are generated
(`npm run mobile:tokens`, `npm run mobile:api`). Neither check was wired into
CI. At the time of writing, `mobile:api:check` **failed**: the committed
artefact described 412 functions, the registry held **423** (staff 242,
portal 70, public 40, server-only 71).

**Consequence.** Both `:check` modes are now CI gates in `ci.yml`. A contract
nothing enforces is a document, and this one drifted by 11 functions within a
day of being written.

## A8 · Google Play's target-API deadline is imminent

Current policy: **new apps and updates must target Android 16 / API 36 from
31 August 2026**; extensions available to 1 November 2026. (Earlier planning in
this repo said API 35 — stale.)

**Consequence.** `compileSdk`/`targetSdk` **36** from the first commit. There is
no window in which starting lower and migrating is cheaper.

## A9 · Nothing in the cloud dev environment can build Flutter

No `flutter`, `dart`, `sdkmanager`, `adb`; no `ANDROID_HOME`. Java and Gradle
are present.

**Consequence.** `flutter analyze` and `flutter test` need no Android SDK and
are the verification loop here. Release builds are CI. **iOS archives require
macOS** — a macOS runner is unavoidable for any App Store submission, and no
amount of cloud tooling removes that.

## A10 · Push is web-only today

`supabase/functions/send-web-push/` (VAPID) and its contract tests are all that
exist. No FCM, APNs or HMS.

**Consequence.** Native push is genuinely new server work, and it is
**three-transport from the first line** — APNs (iOS), FCM (GMS Android), HMS
Push Kit (Huawei). Retrofitting HMS into a GMS-shaped abstraction later is the
expensive path. Push must never gate a core flow.

## A11 · Branding is already runtime and per-tenant

`src/branding/BrandProvider.tsx` reads `whitelabel_settings.theme_config` and
`logo_config` (typed in `src/branding/brand-types.ts`) and cascades CSS
variables.

**Consequence.** Two layers, and they must not be confused:

| Layer | Source | When |
|---|---|---|
| Design system | `design-tokens.json` (build-time export of `tokens.css`) | Compiled into the app |
| Brand | `whitelabel_settings` of the **resolved tenant** (A6) | Fetched at runtime, overrides the tokens it names |

A hardcoded NPC palette in Dart would be wrong on every tenant but one.

## A12 · Scale, and what it implies for scope

`src/App.tsx` is 736 lines and **243 routes**. 65 staff page components against
92 portal ones (client 29, builder 26, finance 23, solicitor 14).

**Consequence.** The Command Centre is the largest single surface in the
product, and porting it wholesale is neither possible nor desirable. The
feature matrix (stage M1) is what decides the app's size, and the default
answer for heavy authoring tooling — Template Builder, Workflow Playground,
PDF-import diagnostics, AML administration — is **web-only**. A mobile app
should make the things somebody needs away from their desk exceptionally good.

## P1 · Two of the four portals need no server change at all

The four portals were audited the same way the Command Centre was, and the
planning that preceded it was wrong about three of them. It said finance,
solicitor and builder sessions "live only in HttpOnly `__Host-*` cookies —
correct for browsers, wrong for a native client". Here is what the code does:

| Portal | Login returns token in body | Session accepted as header | Origin-gated | Native |
|---|---|---|---|---|
| **Client** | yes, `session_token` (`client-portal-login:232`) | `x-portal-session-token` | no | **works** |
| **Finance** | yes, `session_token` (`finance-portal-login:253`) | `x-finance-session-token`, tried **first** | no | **works** |
| **Solicitor** | no — `session_token: null` (`:169`) | `x-solicitor-session-token` | **yes** | blocked |
| **Builder** | no — cookie only | none | **yes** | blocked |

`financeSessionToken.ts` orders its reads `x-finance-session-token` →
`finance_session_token` → `x-session-token` → `session_token` → cookie, and its
own type comment says the CSRF guard is needed "exactly when the credential is a
cookie, and applying it to header auth would only break non-browser callers for
no gain". The finance portal was already built for a non-browser client.

With the Command Centre (A1), **three of the five apps are native-ready today**
and two are not. That is why `NpcPortalDescriptor.nativeBlockers` is derived
rather than declared: readiness is a consequence of the audited fields, so a
hopeful edit cannot assert it.

## P2 · What blocks solicitor and builder is the front door, not the data

`validateSolicitorPortalHeaders` / `validateBuilderPortalHeaders` require an
`Origin` header that is present **and** allow-listed:

```ts
// builderSessionToken.ts
// A missing Origin is rejected rather than tolerated,
// matching `validateSolicitorPortalHeaders`.
const origin = headers.get('origin');
return !!origin && allowedOrigins().includes(origin);
```

`Origin` is a browser CORS concept; a native app sends none, so it is refused.
The guard is enforced by **four functions each** — `login`, `forgot-password`,
`reset-password`, `accept-invite` — and by no data function. So a native
solicitor or builder client is blocked at sign-in and would work perfectly
afterwards.

**Sending a forged `Origin` is not the fix.** It is trivially possible, and that
is the point: the control only ever constrained browsers, so satisfying it from
Dart buys no security and costs real clarity — native traffic becomes
indistinguishable from web traffic in logs, and the app asserts an origin it
does not have. The right answer is an explicit native admission, and `S-2`
already plans one.

## P3 · The Origin gate and Turnstile are the same kind of control

Both are browser-shaped provenance signals: *this came from our page, driven by
a human*. `S-2` plans platform attestation (App Attest / Play Integrity /
Huawei) as the native replacement for Turnstile. The same attestation is the
correct replacement for the Origin allow-list, so the two blockers collapse into
one server change rather than two.

Turnstile itself is uniform: all four portal logins read `turnstile_token` from
the **body**, never a header, and verify it inline against Cloudflare. Omit the
key entirely when absent — the server treats missing and null identically.

## P4 · Builder's cookie-only login is hardening, not an oversight

`builder-portal-login`'s header states it: *"No raw session token is returned in
JSON. It exists only in the Set-Cookie header"* — one of three named corrections
it makes over the solicitor implementation. `extractBuilderSessionToken` takes no
body parameter at all.

So any native path must be **additive and opt-in**, never a reversal of that for
browsers. This is A3 restated on the portal side: never weaken the web to serve
mobile.

A native client *could* run a cookie jar and replay the cookie. It should not:
that re-arms `enforceCsrf`, requires the forged Origin of P2, and is an app
pretending to be a browser. `NpcCookieOnlyTransport` therefore reports
`isNative == false`, and the app says so on screen.

## P5 · The portals differ by data, not by code

Every difference found above is a *value* — a header name, a body field, a
discriminator, which JSON field carries the token. None is a different
algorithm. So the five apps share one shell, one authenticator and one API
client, and differ by an `NpcPortalDescriptor` and their own screens.

`portals_test.dart` pins each descriptor field against this audit. That test is
the reason the table above cannot rot quietly: the last version of these facts
was wrong in three places and nothing noticed, because nothing checked.
