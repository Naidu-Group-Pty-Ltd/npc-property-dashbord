# NPC mobile — master plan

Five native Flutter apps against the existing NPC platform. **One backend,
several purpose-built frontends** — Supabase, Edge Functions, RLS, permissions,
report engines and integrations are reused; only the presentation layer is
rebuilt.

This is not a translation of the React app. Nothing here is produced by
converting a component; every surface is rebuilt from the *contract and
behaviour* underneath it.

**Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first.** It records what was
measured in this codebase — the auth mechanisms, the ES256 constraint, the
device-seat economics, the fleet tenancy — and this plan assumes those findings
(cited below as A1…A12).

| App | Plan | Users | Phase | Distribution |
|---|---|---|---|---|
| **Command Centre** | [`apps/command_centre/plan.md`](./apps/command_centre/plan.md) | NPC staff | **1** | Private (ABM / Play managed) |
| Client | [`portals/client/plan.md`](./portals/client/plan.md) | Property-buying clients | 2 | Public listing |
| Finance | [`portals/finance/plan.md`](./portals/finance/plan.md) | Broker partners | 2 | Public, B2B product page |
| Solicitor | [`portals/solicitor/plan.md`](./portals/solicitor/plan.md) | Legal partners | 3 | Public, B2B product page |
| Builder | [`portals/builder/plan.md`](./portals/builder/plan.md) | Builder/developer partners | 3 | Public, B2B product page |

Distribution targets **three stores**: Apple App Store, Google Play, and Huawei
AppGallery (Huawei devices ship without Google services — the AppGallery rules
in Part 3 reshape two server prerequisites). Listing and launch practice is its
own playbook: [`store-listing/plan.md`](./store-listing/plan.md).

## Generated inputs — regenerate, never hand-edit

| Artefact | Generator | What it is |
|---|---|---|
| [`design-tokens.json`](./design-tokens.json) | `npm run mobile:tokens` | Every design token (light, dark, financeMidnight, financeGraphite) parsed from `src/styles/tokens.css` + `src/styles/finance-portal.css`. Verbatim values; the Flutter `npc_design_system` package owns resolution. |
| [`api-surface.json`](./api-surface.json) | `npm run mobile:api` | Every edge function from the audited security registry, classified `portal` / `public` / `staff` / `server-only`. |

Both have `--check` drift modes, and **both are now CI gates in `ci.yml`**. They
were not, and the API surface had already drifted by 11 functions (A7). A
contract nothing enforces is a document.

## The honest line on "guaranteed approval"

No plan can make store approval literally certain: both major stores retain
subjective review clauses (Apple 4.0 "design", Google "spam and minimum
functionality"), policies change between authoring and submission, and outcomes
vary by reviewer. What a plan *can* do is eliminate every **deterministic**
rejection class — the ones triggered mechanically by a missing capability,
declaration or artefact — and minimise the subjective surface. Treat every rule
below as a release gate: **a submission with any rule unmet is expected to be
rejected.**

Store requirements drift. Every rule tagged `[re-verify]` must be checked
against current published policy in the week before each submission.

---

## Part 1 — Architecture decisions

**R-ARCH-1 · Five apps, one monorepo, shared packages.**
Each portal and the Command Centre ship as their own binary. Shared code lives
in packages so the apps differ at the *feature* layer, not the plumbing layer.

The risk this carries is real and is named here rather than discovered at
review: **Apple Guideline 4.3 (spam) catches near-identical binaries from one
developer.** Five apps are defensible only if they are genuinely different
products for genuinely different audiences, and are not five public consumer
listings competing in the same catalog. That is what R-ARCH-2 and the store
posture in Part 3 exist to guarantee. Identical shells with a swapped logo
would not survive, and no amount of listing copy would save them.

**R-ARCH-2 · The Command Centre ships first, and privately.**
It is the largest surface (A12), has the hardest auth (A1/A2) and the strictest
data, so building it first de-risks everything after it. It is distributed as
an **Apple Business Manager custom app** and through **Play's managed/private
distribution** — an internal staff tool for a known workforce.

This is not a compromise; it removes work. A privately distributed app has no
public product page, no consumer data-safety exposure, no "the reviewer could
not register" rejection class (S-6 is not needed for it), and Guideline 4.3
does not bite an app that is not in the catalog at all.

**R-ARCH-3 · Native Flutter UI. A WebView wrapper is an automatic rejection.**
Apple 4.2 (minimum functionality) rejects apps that repackage a website.
WebView is permitted for exactly two embedded jobs: rendering generated PDF
reports and, if S-2 chooses that route, the Turnstile challenge. Navigation,
lists, forms and dashboards are Flutter widgets.

**R-ARCH-4 · Backend is unchanged, and scope is enforced by a lint.**
Each app's generated client exposes only the functions whose `mobileScope`
matches it — `staff` (+`public`) for the Command Centre, `portal`/`public` for
the portals. A call outside scope fails the build. The `mobileScope` field
exists precisely so this can be mechanical rather than reviewed.

**R-ARCH-8 · The apps differ by descriptor, not by code.**
Every difference between the five apps' backends is a value — a header name, a
body field, a discriminator, which JSON field carries the token — and none is a
different algorithm (`ARCHITECTURE.md` P5). So they share one shell, one
authenticator and one API client from `npc_portal`, and differ by an
`NpcPortalDescriptor` and their own screens. `nativeBlockers` is **derived** from
the descriptor's audited fields rather than declared, so an app cannot claim a
readiness its own contract contradicts, and an app that is blocked says why on
screen instead of failing obscurely.

**R-ARCH-5 · Workspace layout.**

```
mobile/
├── ARCHITECTURE.md  plan.md  design-tokens.json  api-surface.json
├── apps/
│   ├── command_centre/                       # phase 1
│   └── client/ finance/ solicitor/ builder/  # phases 2-3
└── packages/
    ├── npc_core/            # result types, logging, errors, flavors
    ├── npc_tenant/          # A6 — backend discovery
    ├── npc_auth/            # A1/A2 — session, refresh, secure storage, device seat
    ├── npc_api/             # generated client over api-surface.json
    ├── npc_design_system/   # design-tokens.json → ThemeData + GlassTheme
    ├── npc_brand/           # A11 — whitelabel_settings → runtime override
    └── npc_portal/          # P5 — descriptors, portal auth, the shared shell
```

It lives in this repo because the contracts it consumes are **generated here**
and drifted within a day of being written (A7); keeping the consumer in the same
CI that generates them is what makes the gates real. The Flutter tree imports
nothing from `src/` and carries its own workflow, so it can be extracted if
release cadence ever collides — that trigger is documented, not pre-empted.

**R-ARCH-6 · The backend is resolved at runtime, never compiled in.**
Mission Control provisions a clone per tenant (A6). An app with a hardcoded
Supabase URL serves exactly one tenant, and per-tenant binaries are an app
factory. Apps discover their backend from
`https://<slug>.aurixasystems.com.au/.well-known/npc-mobile.json` and cache it
in secure storage. **No Mission Control credential ever reaches a device.**
Flavors select the discovery environment, not a project.

**R-ARCH-7 · No direct PostgREST, no realtime.**
ES256 signing means an HS256 custom token is rejected by PostgREST, and a
protected-table query returns **empty rather than failing** (A4) — a screen
built that way looks like it works and shows nothing. All protected data goes
through Edge Functions; every "live" surface polls a cheap stamp and refetches
only when it moves (`syncStamp.pure.ts` is the proven pattern).

## Part 2 — Server-side prerequisites (work in THIS repo, blocking)

**S-1 · Revocable native sessions. [blocking — but smaller than it looks]**
A native client can already authenticate (A1): login returns a Bearer JWT,
`verifyAuth` accepts it, CSRF is correctly bypassed for header-only requests.
What is missing is **revocability, short lifetime and rotation** (A2). Add
`mobile-auth-login` / `-refresh` / `-logout`, and teach `verifyAuth` to reject a
token whose `sid` names a revoked or idle-expired session — tokens without `sid`
must behave exactly as they do now. Reuses `_shared/sessionHash.ts` and
`_shared/jwt.ts` unchanged. Registry entries for each.

**The portals were audited too, and this rule was wrong about three of the
four** (`ARCHITECTURE.md` P1). Client and finance both return `session_token` in
the login body *and* accept it back as their own header — they need **nothing**.
Solicitor needs its login to return the token to an attested native caller (it
answers `session_token: null` by choice) and needs admission past the Origin
gate. Builder needs those two plus a header carrier, since
`extractBuilderSessionToken` reads no header or body at all.

| Portal | Server change needed |
|---|---|
| Client | none |
| Finance | none |
| Solicitor | return the token to an attested native caller; admit it past the Origin gate |
| Builder | the above, plus accept `x-builder-session-token` before the cookie |

**Both blockers are the same change.** The Origin allow-list and Turnstile are
both browser-shaped provenance signals, so `S-2`'s attestation is the native
replacement for each (`ARCHITECTURE.md` P3). And the native path must be
**additive** — builder's "no raw session token in JSON" is deliberate hardening
for browsers and stays (P4).

**Never weaken the web to serve mobile (A3):** `extractSessionToken` stays
cookie-only, and no header or body fallback returns.

**S-2 · A native-capable human-verification path. [blocking for the portals]**
All four portal logins embed Cloudflare Turnstile, a browser widget. Prefer
server-accepted platform attestation — App Attest (iOS), Play Integrity (GMS
Android), Huawei device attestation `[re-verify current kit]` — behind one
endpoint; fall back to Turnstile in an in-app WebView on the login screen only.
The solicitor portal passes `turnstile_token` explicitly in its request body, so
the server change must cover that call path, not just the shared widget.
*Not blocking for the Command Centre, whose login has no Turnstile.*

**S-3 · Account deletion, in-app and by URL. [blocking — confirmed absent]**
No account-deletion flow exists for any portal. Apple 5.1.1(v) requires in-app
deletion wherever accounts exist (invite-based creation counts); Google Play
additionally requires a web URL discoverable from the listing. **AML tension,
resolved explicitly:** records retained by law are exempt, the exemption is
stated in the flow and the privacy policy, and everything outside the retention
duty actually deletes. Do not ship a deletion flow that silently deletes
nothing. *Applies to the publicly distributed portal apps; a private staff app
manages accounts administratively.*

**S-4 · Deep-link attestation files on the web origin.**
`public/.well-known/apple-app-site-association` and `assetlinks.json`, so invite
and handoff links open the app. Needs the real Team ID and signing-cert
fingerprints, so it is templated here and gated, not seeded.

**S-5 · Native push registration. [three transports, from the start]**
Web push is service-worker based (A10); native needs token registration and a
send path keyed by device token for **APNs, FCM and HMS Push Kit**. The client
hides all three behind one abstraction (R-HAG-3); the server stores
`(device, transport, token)`. Push must never gate a core flow (R-BOTH-6).

**S-6 · Review sandbox accounts. [blocking for review, easy to forget]**
Every portal is invite-gated; App Review cannot create an account, and "we
couldn't log in" is a same-day rejection. One standing, seeded, non-production
demo account **per public app**, documented in App Review notes / Play App
Access / AppGallery remarks, kept alive by a scheduled check. **Not required
for the privately distributed Command Centre** (R-ARCH-2).

**S-7 · The tenant discovery document.**
Each clone serves `/.well-known/npc-mobile.json` with `supabaseUrl`, `anonKey`,
`minAppVersion` and `portalsEnabled[]` (A6, R-ARCH-6). Static and
unauthenticated. `minAppVersion` is the forced-upgrade gate R-BOTH-7 requires.

**S-8 · Device-seat economics. [decision, not code]**
`mission-control-devices` is reused unchanged (A5) — no server work. But a
mobile install consumes a paid device seat, and `device_limit_per_seat` is 2 on
Starter: one browser plus one phone exhausts it. **The business decides**
whether mobile carries its own allowance or the plans change. Shipping without
that decision means users meeting `device_limit_reached` at first login.

## Part 3 — Store-verification prerequisite rules

Each rule: requirement → how it is verified before submission.

### Apple App Store

**R-APL-1 · Publish from an Organization developer account** (D-U-N-S), not an
individual — this is a financial-services adjacent product and the seller name
must match the AML-supervised entity. EU DSA trader details completed.
*Verify:* App Store Connect account type + seller name.

**R-APL-2 · In-app account deletion** reachable from Settings in ≤ 3 taps on
every public app (depends on S-3). *Verify:* UI test per app.

**R-APL-3 · Privacy manifest + nutrition labels.** `PrivacyInfo.xcprivacy`
declaring collected data and required-reason APIs; third-party SDKs from Apple's
list must ship their own manifests and signatures `[re-verify]`. App Privacy
answers must match `api-surface.json` reality: identity data, financial info,
documents, messages. *Verify:* archive validation passes + a written mapping
table from data type → collecting function.

**R-APL-4 · Permission strings that tell the truth.**
`NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` (AML identity
documents), `NSMicrophoneUsageDescription` (voice notes). **No location
permission in v1**: the listings map renders without device location, and an
unjustified prompt is a rejection. *Verify:* Info.plist contains exactly the
used permissions, each triggered in context (no launch-time prompt walls).

**R-APL-5 · No digital-goods purchase in the app (3.1.1).** Token and billing
purchases exist in the Command Centre **on web** and stay there — this survives
the Command Centre coming to mobile, and is a specific thing to check in M1's
feature matrix. No app sells anything, shows a price list, or links out to
purchase. *Verify:* grep gate on the Flutter tree for store/checkout/price URLs.

**R-APL-6 · Sign in with Apple is not required while auth is email+invite only**
(4.8 triggers on third-party/social login). Adding any social login later
triggers the requirement. *Verify:* auth methods list at submission.

**R-APL-7 · Export compliance:** standard TLS only →
`ITSAppUsesNonExemptEncryption = false`. *Verify:* Info.plist key present.

**R-APL-8 · No tracking, no ATT.** No ad SDKs, no cross-app identifiers; App
Privacy declares no tracking, so no ATT prompt. *Verify:* dependency audit of
the Flutter lockfile.

**R-APL-9 · Review notes** explain the invite model, the demo accounts (S-6),
and that AML identity capture is a regulatory feature of the publishing entity —
reviewers reject KYC flows they cannot understand. *Verify:* notes drafted and
stored beside the release checklist.

**R-APL-10 · The Command Centre is distributed, not listed.** Apple Business
Manager custom app: full review, no public product page, install by
link/MDM. *Verify:* ABM distribution configured; the app does not appear in
public search.

### Google Play

**R-GPL-1 · Target API 36 (Android 16), from the first commit.** `[re-verify]`
Current policy: **new apps and updates must target API 36 from 31 August 2026**;
extensions available to 1 November 2026 (A8). AAB upload, Play App Signing.
Flutter and NDK kept current for the 16 KB page-size requirement on Android 15+
`[re-verify]`. *Verify:* `flutter build appbundle` + Play pre-launch report.

**R-GPL-2 · Data safety form** consistent with R-APL-3's mapping table — the
stores' declarations must not contradict each other. *Verify:* one source table
generates every store's answers.

**R-GPL-3 · Account deletion web URL** in each public listing (S-3's hosted
page) plus the in-app flow. *Verify:* listing field populated; URL live.

**R-GPL-4 · Financial-features declaration.** The finance portal surfaces
mortgage-broking workflow; Play's finance declarations and any regional
personal-loan policies must be answered accurately as *facilitation tooling by
the regulated entity, not a lending product* `[re-verify]`. *Verify:* Play
Console declaration screenshots archived with the release.

**R-GPL-5 · App Access credentials** for review (S-6 accounts, per public app).
*Verify:* Play Console App Access section.

**R-GPL-6 · IARC content rating** completed (finance category, no public
user-generated content, no gambling). *Verify:* rating certificate issued.

**R-GPL-7 · The Command Centre uses managed/private distribution**, not open
testing or production. *Verify:* Play Console distribution settings.

### Huawei AppGallery

Huawei devices have shipped without Google Mobile Services since 2019, so
AppGallery is a third platform target whose constraints reach back into the
architecture. Nothing in this product depends on Google services (the listings
map is Leaflet + OSM tiles), so R-HAG-3 is honourable from day one rather than
retrofitted.

**R-HAG-1 · Global AppGallery only; mainland China excluded in v1.** Mainland
distribution requires a local entity and ICP filing `[re-verify]` — a business
decision, excluded until someone makes it.

**R-HAG-2 · Huawei enterprise developer account** (D-U-N-S verified), seller
name = the AML-supervised entity. *Verify:* AGC account type + seller name.

**R-HAG-3 · Zero-GMS rule.** Every app must be fully functional on a device with
no Google services: push through the S-5 abstraction (HMS Push Kit), attestation
through S-2's per-platform verifier, maps via `flutter_map` + OSM tiles, and
**no transitive Play-Services dependency** in the Android build. *Verify:*
lockfile dependency audit + a full walkthrough on HMS-only hardware.

**R-HAG-4 · AppGallery review parity.** Privacy policy linked, permissions
declared and justified, account deletion available, review credentials supplied.
The three-store data/privacy mapping is **one table**. *Verify:* AGC declaration
screenshots archived with the release.

**R-HAG-5 · Packaging and signing per current AGC requirements** `[re-verify]`.
Huawei Flutter plugins pinned and audited like any other dependency. *Verify:*
AGC upload validation + release build smoke test.

**R-HAG-6 · No Huawei IAP obligations** — no app sells anything (R-APL-5), so
AppGallery's payment-kit requirements are never triggered. *Verify:* same grep
gate as R-APL-5.

### All stores

**R-BOTH-1 · Login-wall completeness:** every pre-auth screen (login, workspace
discovery, invite acceptance, forgot/change password) works without an account,
renders offline errors gracefully, and never dead-ends. Blank screens behind
network failure are the classic "2.1 performance" rejection. *Verify:*
airplane-mode walkthrough of every pre-auth route.

**R-BOTH-2 · Sensitive-document hygiene.** AML identity captures never enter the
OS photo library by default, uploads are TLS-only to registry-listed functions,
local temp files are wiped after upload, and screens showing identity documents
set `FLAG_SECURE` / iOS screen-capture obscuring. *Verify:* code-review
checklist + manual capture walkthrough.

**R-BOTH-3 · Accessibility parity with the web work:** honour platform
reduced-motion and reduced-transparency (the glass material collapses to opaque
exactly as on web — reimplement the *policy*, not the media queries), 44pt/48dp
touch floors, and TalkBack/VoiceOver labels on every control. *Verify:* the
Flutter accessibility suite + a manual screen-reader pass of login → dashboard →
document upload.

**R-BOTH-4 · Glass performance budget carries over.** The web audit measured
blur-per-repeated-element as the one catastrophic cost; the same is true of
Flutter's `BackdropFilter`. Containers blur; list items never do. Budget ≤ 8
live blur layers per screen, verified with the performance overlay on mid-range
Android hardware before each release.

**R-BOTH-5 · Deep links verified end-to-end** (S-4): invite mail → install →
acceptance in-app; web handoff links open the right app. *Verify:*
physical-device matrix + every store's link validator.

**R-BOTH-6 · Push is optional.** Requested in context at the first relevant
feature, never at launch, and every flow works with it denied. *Verify:*
denied-permission walkthrough.

**R-BOTH-7 · Version/deprecation policy:** minimum iOS 15 / Android 8 (covers
the Flutter floor `[re-verify]`), and a forced-upgrade mechanism — served by
`minAppVersion` in the S-7 discovery document — so a broken release can be
retired without stranding sessions.

## Part 4 — Design-system translation

Two layers, and confusing them produces an app that is wrong on every tenant but
one (A11):

- **Design system** — `design-tokens.json` is the contract, compiled in. The
  Dart generator in `npc_design_system` resolves `var()` references and HSL
  triplets into `ThemeData` plus a `GlassTheme` extension (fills, strokes,
  sheen, blur radii, shadows, motion durations). Theme parity: `light`, `dark`,
  and the finance palettes map to the same semantics the web applies.
- **Brand** — `npc_brand` reads `whitelabel_settings.theme_config` /
  `logo_config` for the **resolved tenant** at runtime and overrides the tokens
  it names. A brand change made in Command Centre reaches web and mobile alike.

The glass recipe translates as: container decoration = fill + stroke + sheen
gradient; `BackdropFilter` only on the container tier (R-BOTH-4); scrims darken
*and* blur exactly as `.glass-scrim` does. Typography uses the platform default
type family per OS — do not embed a webfont to imitate the other platform's
system face.

## Part 5 — Phasing

**Phase 0 — foundations (this repo).** CI drift gates (done). S-1 for staff,
S-7 discovery, S-8 decision. Flutter workspace, packages, Command Centre shell.

**Phase 1 — Command Centre.** M1's feature matrix first; then overview,
listings, clients/pipeline, reports, messages/notifications, calendar.
Private distribution to staff on iOS and Android. Push (S-5) and deep links
(S-4) land here because staff are the safest audience to prove them on.

**Phase 2 — Client + Finance.** Needs S-1's portal bearer mode, S-2, S-3, S-6.
The client app carries the public store posture. AppGallery submission follows
once the HMS transport is exercised on real Huawei hardware.

**Phase 3 — Solicitor + Builder.** Cheapest last: they share nearly everything
structural with finance, and their plans note the deltas.

## Part 6 — Pre-submission gate (run in full, every release)

```
[ ] mobile:tokens:check and mobile:api:check green (CI enforces; check anyway)
[ ] flutter analyze clean, flutter test green, dart format clean
[ ] S-1..S-8 satisfied for the app being shipped
[ ] Every R-APL / R-GPL / R-HAG / R-BOTH rule checked by its named verification
[ ] [re-verify] items re-checked against current store policy (dated note)
[ ] Demo accounts logged into from a clean device (public apps)
[ ] Airplane-mode pass, denied-permissions pass, screen-reader pass
[ ] Performance overlay pass on mid-range Android hardware
[ ] Zero-GMS walkthrough on HMS-only hardware, before any AppGallery release
[ ] Tenant discovery tested against at least two clones
[ ] Listing pre-flight from store-listing/plan.md §9 completed for every store
```
