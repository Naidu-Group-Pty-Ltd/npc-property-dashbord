# WP-28 — the three deployed auth endpoints with no source

WP-27 recorded `custom-auth-login`, `custom-auth-logout` and
`custom-auth-verify` as present in `SECURITY_REGISTRY.json` and
`supabase/config.toml`, absent from `supabase/functions/`, and **ACTIVE** on the
live project. This is where they came from and what was done about them.

## Correction to WP-27

WP-27 said `custom-auth-verify` had been updated the same morning, and inferred
that something was still actively shipping these. **That was wrong** — a
misreading of the function list. The real timeline, read from the project:

| Function | Version | Created | Last deployed |
|---|---|---|---|
| `custom-auth-login` | 16 | 2026-07-30 18:51Z | **2026-07-31 02:04Z** |
| `custom-auth-logout` | 16 | 2026-07-30 18:51Z | **2026-07-31 02:04Z** |
| `custom-auth-verify` | 16 | 2026-07-30 18:51Z | **2026-07-31 02:04Z** |
| `custom-auth-login-v2` | 40 | 2026-07-31 17:24Z | 2026-08-11 05:44Z |
| `custom-auth-logout-v2` | 38 | 2026-07-31 17:24Z | 2026-08-11 05:44Z |
| `custom-auth-verify-v2` | 37 | 2026-07-31 17:24Z | 2026-08-09 19:41Z |

Nobody is shipping the v1 trio. They are **frozen** at version 16, and the
05:44Z deploy was `-v2`. That is a worse fact than the one it replaces, not a
better one — see below.

## Where they came from

They are not deleted files. They were **never** in this repository's git
history: `git log --all --diff-filter=ADM` over those paths returns nothing.

The explanation is the history itself. This repository's history begins on
2026-08-07, 213 commits ago. The v1 functions were created on the project on
2026-07-30 and superseded by `-v2` the next day — a week before the history
starts. Whatever repository held their source is not this one; what survived
into this one is their `config.toml` stanzas and their registry entries, because
those files were carried across as content while the function directories were
not.

## Why it mattered: this was a bypass, not a stale copy

`.github/workflows/deploy-supabase-functions.yml` decides what to deploy by
**listing directories**:

```sh
find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name '_shared' -printf '%f\n'
```

It never reads `config.toml`. A function with a registry entry, a config stanza
and no directory is therefore invisible to it — permanently. So while every
other function was redeployed on each `_shared/` change (the workflow deploys
everything when shared code moves, deliberately), the v1 trio sat at its 31 July
bundle and `custom-auth-login-v2` went on to twenty-four more deploys.

Everything added to staff login in those twenty-four deploys existed on one URL
and not the other. The one that matters most:

> **`custom-auth-login` had no source-keyed rate limiting.**

`enforceAuthRateLimit` — the IP and identifier ceilings that ABUSE-003 exists to
impose — was added to v2 and could never reach v1. The v1 endpoint had only the
per-account lockout, and as v2's own comment says, a per-account counter cannot
see a spray: one attempt against each of a thousand staff usernames never
reaches attempt two on any of them.

So an attacker spraying credentials against the Command Centre simply posted to
`/functions/v1/custom-auth-login` instead of `/functions/v1/custom-auth-login-v2`
and met no ceiling at all. Both mint the same session cookie and the same JWT.
The rate limiting was one URL away from absent.

Also missing from the frozen bundle, in descending order of consequence:

- **No body size bound** (WP-27). Unauthenticated, unbounded `req.json()`.
- **A July snapshot of `_shared/auth.ts`**, because Supabase bundles a
  function's imports at deploy time. That snapshot still accepts
  `x-internal-edge-secret` — the legacy internal-auth path WP-12 removed and
  `check-internal-legacy-fallback.mjs` exists to keep out.
- **No lockout visibility**: v1 answers a locked account with a generic 401, the
  behaviour that made a password reset look broken and which v2 fixed.
- **Username-only login**: v2 accepts the account email too. A behaviour
  difference, not a security one, and the reason v1 could not simply be pointed
  at v2's user lookup without thought.

## The fix

Non-breaking, and structural rather than a patch.

Each handler moved to `supabase/functions/_shared/customAuth/` and **both**
entrypoints became one-line shims onto it:

```ts
import { handleStaffLogin } from '../_shared/customAuth/login.ts';
Deno.serve((req: Request) => handleStaffLogin(req, 'v1'));
```

This is the convention `CLAUDE.md` already sets for the workflow engine, where
`src/lib/workflow/*` are one-line shims onto `supabase/functions/_shared/workflow/`.

What it buys:

1. **The bypass closes.** v1 gets the rate limiter, the body bound and the
   current shared bundle, because it is now literally the same code. The
   limiter `scope` is shared (`ccl`) on purpose — two scopes would give a caller
   two budgets and let them alternate URLs to double their attempts, which is
   the bypass in miniature.
2. **The directories exist**, so the deploy workflow can see them. This is what
   actually ships the fix; without a directory nothing else in this document
   reaches production.
3. **They cannot drift again.** There is no second copy to fall behind.
4. **Every gate can see them.** `check-edge-functions` went 418 → 421 entry
   points; `check-public-validation` 37 → 40 functions.

Nothing about the request or response contract changed. The extraction was
verified by normalised diff against the previous v2 sources: the only
differences are the import-path rewrite, the function signature, the CORS
preamble moving into `staffAuthCorsHeaders`, one added log line, and a type
annotation on a `.map` callback.

### Instrumentation, so deletion can be decided on evidence

Every v1-served request logs `[custom-auth.legacy_v1]` with the user-agent,
origin and referer — nothing identifying, nothing credential-bearing. The
marker mirrors `[wp11c.legacy_fallback]`, which the cookie-only rollout used to
drive its own legacy carriers to zero before deleting them.

It logs on the **success** path too. A marker that only fires on failures cannot
answer "is anyone still using this", which is the only question standing between
here and deleting these three functions.

**Nothing in this repository calls them** — no reference in `src/` or
`supabase/functions/`, and their appearance in `mobile/api-surface.json` is
generated from the registry and config rather than evidence of a caller. But
"nothing in the repository calls it" is a claim about source, and these are
public URLs on the internet. Watch the marker for a couple of weeks; if it stays
silent, delete the functions from the project, the `config.toml` stanzas and the
registry entries together.

## What this exposed about the gates

The shim pattern broke two gates on the same commit, in opposite directions, and
that is the part worth remembering:

- `check-auth-rate-limit-coverage` **failed** — it looked for
  `enforceAuthRateLimit(` in the entrypoint and the call had moved into the
  handler. Loud, and therefore harmless.
- `check-public-validation` **passed** — it looks for a body read, found none in
  the shim, and skipped the function entirely. Its summary line went on
  reporting a passing count that had quietly stopped including two
  unauthenticated login endpoints.

The second is the dangerous one. A refactor that silently removes a function
from a gate's coverage without removing it from production is the exact failure
this suite exists to prevent, and it would have looked like a clean run.

`scripts/security/lib/entrypointSource.mjs` now reads an entrypoint together
with the handler it serves, and both gates use it. It follows **only** the
modules whose bindings are referenced inside `Deno.serve(...)`, one level deep —
not the transitive closure, because `_shared/auth.ts` alone reaches most of the
shared tree and several gates forbid expressions that legitimately live in it.

That distinction is now the rule for the helper, and it is worth stating plainly
because getting it wrong failed five correct handlers on the first attempt:

> A **positive** assertion ("must call the limiter") follows the delegation.
> A **negative** one ("must not read `X-Forwarded-For`") must not — the shared
> modules an entrypoint reaches contain the very expressions they exist to
> encapsulate. `getTrustedClientIp` has to read that header in order to
> sanitise it.

Two negative-test controls hold the new arrangement: one removes the body bound
from the shared login handler, one removes the rate limiter. The harness also
caught the pre-existing rate-limit control still pointing at the old v2 file and
refused to run until it was re-pointed, which is exactly what it is for. 30 → 31
controls.

## Not done here

**These are authored, not deployed.** The fix reaches production when
`deploy-supabase-functions.yml` runs on `main` — which now *can* deploy them,
because the directories exist. Until that run completes, the live v1 endpoints
are still the frozen 31 July bundle with no rate limiting. Check the workflow
summary on the merge commit; it reports what it deployed, and warns loudly if
`SUPABASE_ACCESS_TOKEN` is unset and it deployed nothing.

**`mobile/api-surface.json` has pre-existing drift** unrelated to this work —
six functions added to the registry by other merges without regenerating it
(`agreement-centre-render`, `didit-webhook`, `dispatch-workflow-triggers` and
three more). It is not checked by any workflow. `npm run mobile:api` fixes it;
left out of this change so a security diff does not also silently register
somebody else's functions.
