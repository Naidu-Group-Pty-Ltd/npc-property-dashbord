# Command Centre — Flutter app (phase 1)

The staff application: NPC's own people, working listings, clients, deals,
reports and compliance. It ships **first** and **privately**.

First because it is the largest surface in the product and has the hardest auth
(see [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) A1/A2/A12) — building it
first means the auth adapter, the tenant resolver, the design system and the
API client are all proven against the worst case before a consumer ever sees
them. Privately because it is an internal tool for a known workforce, and
private distribution removes most of the store surface (R-ARCH-2, R-APL-10,
R-GPL-7).

## Auth — mostly already there

The Command Centre can be authenticated from Dart **today** (A1):
`custom-auth-login-v2` returns an `access_token`, `verifyAuth` accepts it as a
`custom_users` identity, and `enforceCsrf` correctly stands aside for a
cookieless caller. Prove this with the smoke test in the master plan's gate
before writing any new server code — it is the cheapest possible validation of
the whole architecture.

What must be built is revocability (A2): `mobile-auth-login` / `-refresh` /
`-logout` and the `sid` check in `verifyAuth`. Until those land, the app runs on
the existing 24-hour token behind a flavor flag, and **never ships to a device
that way** — an unrevocable 24-hour credential on a lost phone is not
acceptable for staff data.

Session storage is `flutter_secure_storage` (Keychain / Keystore). The refresh
token never touches ordinary preferences, and neither does the install UUID.

## Device seats — reused, but they cost

`mission-control-devices` is called unchanged (A5): `register` after sign-in,
`heartbeat` every five minutes while foregrounded, `release` on sign-out. The
`device_fingerprint` is a UUID minted at first launch and held in secure
storage; `device_label` is `iPhone` / `iPad` / `Android`.

**The app must handle `device_limit_reached` as a first-class screen**, not an
error toast — it lists the user's active devices and offers to revoke one,
exactly as `ManageDevicesDialog` does on web. On a Starter plan this is not an
edge case: one browser plus this app is the cap (S-8).

## Data — Edge Functions only

No `supabase.from()` against protected tables, no realtime (A4, R-ARCH-7). The
generated client is restricted to `mobileScope: "staff"` and `"public"`, and a
call outside that fails the build.

Live surfaces poll a stamp and refetch on movement. Long-running work is
resumed, not awaited — investment report generation in particular stops at a
wall-clock budget and is resumed by a worker or watchdog, so the app **polls
status and never holds a request open** (`docs/reports/INVESTMENT_REPORT_RESUME.md`).

## M1 — the feature matrix, which is the real decision

`src/App.tsx` carries **243 routes**; 188 distinct non-portal paths, 32 of them
under `admin/`. Porting that is neither possible nor desirable. A mobile app
should make the things somebody needs **away from their desk** exceptionally
good, and leave the power-user environment on the web.

The classification below is the starting proposal for M1, not its conclusion —
M1 is complete when every one of the 188 paths has an entry and an owner has
signed it off.

### Mobile — phase 1

The away-from-desk core.

| Area | Routes |
|---|---|
| Overview | `dashboard`, `notifications`, `activity` |
| Listings | `listings`, `listings/:listingId`, `properties`, `property-insights` |
| Clients & pipeline | `clients`, `clients/:clientId`, `deal-pipeline`, `deal-progress`, `client-tracker` |
| Communication | `messages`, `conversations`, `emails`, `client-inbox`, `call-logs` |
| Day planning | `calendar`, `appointments`, `booking`, `tasks`, `reminders`, `action-items` |
| Documents & reports | `reports`, `documents`, `investment-report/:id` (view/share only) |
| Self | `profile`, `settings`, `settings/security`, `change-password` |

### Mobile — later phases

`aml`, `cases`, `cases/:caseId`, `compliance`, `checklists`, `agreements`,
`partner-referrals`, `commissions`, `earnings`, `calculators`, `commercial`,
`insights`, `market-updates`, `support`.

### Web-only — deliberately, and this list is the point

These are authoring and diagnostic environments. They are precise, dense,
multi-panel and mouse-driven; a phone rendering of them would be worse than a
phone that declines to render them.

- **All 32 `admin/*` routes** — Template Builder and its converter, the PDF
  import engine, diagnostics, monitoring, retention and golden-regression
  surfaces, AML v3 cutover, portal administration, user management, token audit.
- `workflow-playground` — the automation canvas.
- `report-engine-inspector`, `quality-assurance`, `report-qa`, `qa/*`.
- `white-label`, `portal-config`, `configuration`, `integrations`, `sources`,
  `data-import`, `model-hub`, `cloudflare`, `launch-ops`, `governance`.
- **`billing`, `billing/usage`, `api-usage`** — and this one is a store rule,
  not a preference: token and billing purchases must not appear in the app at
  all (R-APL-5). Not a link, not a price, not a plan comparison.

The app links out to the web for anything on this list rather than hiding it —
a staff member should be told where the thing lives, not left wondering whether
the app is broken.

## Store posture

Private distribution: **Apple Business Manager custom app** and **Play
managed/private**. Consequences, all of them simplifying:

- No public product page; Guideline 4.3 does not apply to an app outside the
  catalog, which is what makes five NPC apps defensible.
- **S-6 review accounts are not required** for this app.
- No consumer data-safety exposure; the declarations still get written (they
  are the same mapping table as everything else) but the audience is the
  organisation, not the public.
- Full App Review still applies to an ABM custom app. R-ARCH-3 (no WebView
  wrapper), R-APL-4 (honest permission strings), R-APL-5 (no purchase),
  R-APL-7 (export compliance) and every R-BOTH rule still bind.

If a public staff listing is ever wanted instead, the 4.3 exposure and the S-6
work both return — that is the trade, and it should be made deliberately.

## Verification deltas beyond the master gate

```
[ ] Bearer smoke: Dart → custom-auth-login-v2 → Authorization: Bearer → staff fn → 200
[ ] Revocation: revoking a session on web kills the mobile session within one refresh
[ ] device_limit_reached renders the device list and revoke flow, not an error toast
[ ] Mobile device appears in ManageDevicesDialog on web; release frees the slot
[ ] No supabase.from() against a protected table anywhere in the app target
[ ] Generated client exposes zero functions outside mobileScope staff/public
[ ] Every web-only route the app links to opens the correct web URL for the tenant
[ ] Billing, api-usage and token purchase surfaces absent from the binary (grep gate)
```
