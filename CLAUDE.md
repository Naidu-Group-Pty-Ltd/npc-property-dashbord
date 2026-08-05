# CLAUDE.md

Guidance for Claude Code (and Claude-based tools) working in this repo.

## Read first
- **Frontend / UI work → [`FRONTEND_TOOLING.md`](./FRONTEND_TOOLING.md)** is the
  cross-tool source of truth. It defines the installed frontend packages and the
  non-negotiable UI rules. Use it for anything touching `src/` UI.
- **Backend / security / AML →** [`AGENTS.md`](./AGENTS.md) and
  [`AGENTS_NPC_Property_Dashboard.md`](./AGENTS_NPC_Property_Dashboard.md).

## Installed tooling (already wired for Claude Code)
- **Claude Design** — the **NPC Services Design System** project at
  [claude.ai/design](https://claude.ai/design), reached with the built-in
  **DesignSync** tool. It is the source of the brand: read `tokens/colors.css` and
  `tokens/typography.css` from it before choosing any colour or typeface, and push
  cards back one at a time (never wholesale-replace). Details in
  [`FRONTEND_TOOLING.md`](./FRONTEND_TOOLING.md).
- **MCP servers** — [`.mcp.json`](./.mcp.json): `shadcn`, `chrome-devtools`,
  `@21st-dev/magic`, `21st` (hosted HTTP). Setup and the `MAGIC_API_KEY` /
  `TWENTY_FIRST_API_KEY` steps are in [`MCP_SETUP.md`](./MCP_SETUP.md).
- **Skills** — [`.claude/skills/`](./.claude/skills/): **`npc-services-design`** (the
  brand itself — colours, type, logo marks, voice, and the print rules for generated
  reports), `frontend-design` (aesthetic direction) and `web-design-guidelines`
  (accessibility / UX review).

## Listings intake (Airtable + Make)
Everything on the Listings page arrives through one Make scenario, **NPC Email 1**, which
reads a mailbox and writes Airtable's **Property Intake Master** (205 columns, base
`NPC Emails`). Read [`docs/integrations/NPC_EMAIL_1_AUDIT.md`](./docs/integrations/NPC_EMAIL_1_AUDIT.md)
before touching intake, the projection in `_shared/airtableListing.pure.ts`, or anything to
do with listing photographs — it records 22 defects found in that scenario, including the
two that meant the page had never received a single photo, and it names the columns the
dashboard now depends on. Retention (the 30-day purge) is in
[`AIRTABLE_RETENTION.md`](./docs/integrations/AIRTABLE_RETENTION.md); it has one manual step.

Column names for that table live in `_shared/airtableIntakeFields.pure.ts` and nowhere else.
Airtable returns `undefined` for a column that does not exist exactly as it does for one
that is empty, so a mistyped name is invisible — that file's header records what that cost
last time.

## Generated reports / PDFs
Read [`.claude/skills/npc-services-design/reports/REPORT_RULES.md`](./.claude/skills/npc-services-design/reports/REPORT_RULES.md)
before touching any PDF generator — print has different contrast, colour and font
rules from screen, and most of the repo's "logo" files are email-signature banners
carrying the director's personal mobile number. Architecture and the migration
programme: [`docs/reports/DESIGN_SYSTEM.md`](./docs/reports/DESIGN_SYSTEM.md).

Investment report **generation** is a separate concern from rendering, and the
one pipeline that cannot finish inside a single request: 17 sections at ~25s each
against a ~150s edge ceiling. It survives by stopping at a wall-clock budget and
being resumed — by the browser, the bulk worker, or a cron watchdog. Read
[`docs/reports/INVESTMENT_REPORT_RESUME.md`](./docs/reports/INVESTMENT_REPORT_RESUME.md)
before changing the section loop, its timeouts, or anything that claims a report.

Eight formats have been migrated onto it, and each carries its own contract:
[`BORROWING_CAPACITY.md`](./docs/reports/BORROWING_CAPACITY.md),
[`CASH_FLOW.md`](./docs/reports/CASH_FLOW.md),
[`PORTFOLIO.md`](./docs/reports/PORTFOLIO.md),
[`COMPARISON.md`](./docs/reports/COMPARISON.md),
[`CASH_FLOW_COMPARISON.md`](./docs/reports/CASH_FLOW_COMPARISON.md),
[`CLIENT_DETAILS.md`](./docs/reports/CLIENT_DETAILS.md),
[`QA.md`](./docs/reports/QA.md) and
[`MARKET_INTELLIGENCE.md`](./docs/reports/MARKET_INTELLIGENCE.md). Read the
relevant one before touching that format — all eight record defects that only a
render against production data revealed, and all eight name the legacy generators
that must stay.

Two of the eight carry model-authored Markdown rather than typed figures, and
they share the programme's only Markdown renderer,
`_shared/reports/markdown.pure.ts`. Read them first if you are touching prose.
**Report Q&A** discovers its sections from the content rather than declaring
them, and is the only render route that can call a model. **Market Intelligence**
is the one whose page budget is fitted block by block against real renders rather
than summed, the one that clips a section and says so on the page, and the only
one that writes a PDF a scheduled email later attaches.

## The template converter
An existing template can be brought *onto* the design system rather than into the
visual editor: `/admin/template-builder/converter` extracts a template's section
structure, binds it to one of the migrated report formats, and renders it through
WeasyPrint under a **brand design system** — a saved brand colour plus a full
`ReportDesignOptions`, authored in the UI or drafted by Claude from a brief. The
palette is never stored, only resolved. Read
[`docs/reports/TEMPLATE_CONVERTER.md`](./docs/reports/TEMPLATE_CONVERTER.md)
before touching it: it records why binding is confirmed rather than guessed, why
unmatched sections become an appendix instead of being dropped, and why the
output goes to its own private bucket rather than `report-templates`. The
existing `ImportPdfDialog` / `parse-template-document` path is a different
destination and stays.

## Report templates
The seeded PDF catalogue (40 templates) is **generated**, not hand-edited. Its look
comes from `scripts/template-library/designSystem.ts` — five voices keyed to the
catalogue's `style` axis, six accents keyed to subject, all derived from the NPC
tokens. Edit the voice, then run `npm run templates:library:seed`. Never hand-edit
the generated migration. See
[`docs/template-library/06-design-system.md`](./docs/template-library/06-design-system.md).

## Mobile (Flutter) translation
The four portals are being translated into one cross-platform Flutter app.
[`mobile/plan.md`](./mobile/plan.md) is the master plan — architecture
decisions, the server-side prerequisites in this repo (bearer auth for the
cookie portals, a native Turnstile replacement, the missing account-deletion
flow), and the store verification rule catalog for the App Store, Google
Play **and Huawei AppGallery** (HMS devices have no Google services — the
push/attestation abstractions are three-platform by rule). Per-portal plans
live in `mobile/portals/*/plan.md`; listing/launch practice for all three
stores is `mobile/store-listing/plan.md`. Two generated artefacts feed the
Flutter workspace and must never be hand-edited: `mobile/design-tokens.json`
(`npm run mobile:tokens`) and `mobile/api-surface.json`
(`npm run mobile:api`); both have `:check` drift modes.

## Frontend loop (summary — full detail in `FRONTEND_TOOLING.md`)
1. Design new surfaces with the **frontend-design** skill.
2. Build shadcn-first; use **@21st-dev/magic** for net-new components, then adapt to
   our semantic tokens and `components.json` aliases.
3. Review with the **web-design-guidelines** skill.
4. Verify in a browser with **chrome-devtools** (console clean, screenshot the result).

## Hard rules
- **Semantic design tokens only** — never raw Tailwind palette classes or hardcoded
  colors/fonts in shared UI. `npm run audit:style` must not regress (new violations = 0).
- **Surfaces are glass.** The material lives in [`src/styles/glass.css`](./src/styles/glass.css)
  (recipe) and the glass scale in `src/styles/tokens.css` (values). Use a `.glass-*`
  class; don't hand-roll a frosted surface, don't add a `bg-*`/`shadow-*` utility to
  one, and don't put `backdrop-filter` on anything that repeats. Read that file's
  header before adding a surface — it explains why for each rule.
- Respect the shadcn setup (`components.json`, `tailwind.config.ts`, `src/index.css`).
- Before finishing a UI change, run `npm run lint`, `npm run audit:style`, and `npm run build`.
