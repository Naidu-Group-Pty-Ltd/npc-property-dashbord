# Client-facing deployment mode

One codebase, two deployments. The internal operations console runs with
everything on; a **client-facing deployment** builds with
`VITE_CLIENT_FACING=true` and hides the developer/operator tooling from the
front-end. The client-facing repository
(`npc-client-dashboard`) is a mirror of this one with that flag committed —
it carries no code of its own, so changes land here first and are pulled over.

## What the mode is, and is not

- **It is presentation.** Module permissions, workspace entitlements and the
  edge functions' own auth checks decide *access*, exactly as before. The flag
  removes surfaces from navigation and routing; it grants and revokes nothing.
- **It is build-time only.** Unlike `editorV2Flag` / `templateLibrary` there is
  deliberately no `?param` or localStorage override: the point of a
  client-facing build is that a visitor cannot flip the operator tooling back
  on from the address bar.
- **It never touches the pipelines it hides the controls for.** Hiding the
  Integrations page does not disturb the Make.com → Airtable
  **Property Intake Master** intake (that runs server-side and never depended
  on this UI); hiding the Airtable Sync card on `/automation` stops nobody's
  scheduled sync. Nothing server-side reads this flag.

## The one list

`src/lib/clientFacing.ts` holds `CLIENT_FACING_HIDDEN_PATHS`. Both halves of
the mode read it, so what is unlinked and what is unroutable cannot drift:

- **Navigation** — `useNavigationVisibility` (`src/hooks/useNavigation.ts`)
  filters items by URL. That one hook feeds the desktop sidebar, mobile
  sidebar, bottom bar and the ⌘K command palette (including `paletteOnly`
  items, which never had a sidebar entry to lose).
- **Routing** — `ClientFacingGate` (`src/components/auth/ClientFacingGate.tsx`)
  wraps the dashboard outlet in `DashboardLayout`, so a typed URL or stale
  bookmark lands on a quiet "not available on this dashboard" screen rather
  than the tool. This also covers the internal routes that carry no
  `ModuleGuard` at all (`/admin/report-engine-inspector`,
  `/integrations/ghl-migration`, …).

A path is hidden when it equals an entry or sits beneath one. Matching is by
path segment, never raw string prefix.

## Hidden beyond the list (component-level)

Some developer tooling lives *on* client-relevant pages, so it is gated where
it renders, always through `isClientFacingDeployment()`:

| Surface | Where |
| --- | --- |
| Test Numbers / Flush Test Calls, contact-name backfill | `src/pages/CallLogs.tsx` |
| Data-integrity debug panel | `src/pages/Overview.tsx` |
| Airtable Sync card (Dry Run / Sync Now / Clear Queue) | `src/pages/Automation.tsx` |
| Comparison-score migration card | `src/pages/Settings.tsx` |
| "Change model" deep-link into the Model Hub | `src/components/agentModels/ModelUpgradeButton.tsx` (self-gates, so all six pages that mount it are covered) |
| Pricing mock (A$1 Stripe test catalogue) | `src/lib/pricingMock.ts` — forced off, banner and CTA rewrite both; a shared `?pricingMock=1` link must not sell a tier for a dollar |

## Deliberately NOT hidden

Business features a client workspace runs itself, whatever group the sidebar
files them under: Templates and the Template Builder, Branding/White-label,
Settings, User Management, the portal admin pages, Data Import, the
report-generation switches on `/automation`, Activity Logs, and the AML
workspace (role-gated on its own axis). Superadmin-only cards that already
hide themselves by role (entitlement diagnostics, Mission Control key) keep
that behaviour — the operator debugging a client workspace still needs them.

## Adding to (or trimming) the list

Edit `CLIENT_FACING_HIDDEN_PATHS` — nav and routing follow together.
`src/lib/__tests__/clientFacing.test.ts` cross-checks the list against the
navigation registry both ways: the named operator tools must be hidden, the
client features must not be, and with the flag off nothing changes at all.
