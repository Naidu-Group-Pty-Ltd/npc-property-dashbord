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

The scenario that is actually **switched on** is `NPC Email 1 New` (Make id `9618493`); the
audited `NPC Email 1` (`6720116`) is off. Listings reach it *forwarded* by NPC staff rather
than sent by agents, and that broke who a listing belongs to — every record it wrote named a
colleague as the agent. Read [`FORWARDED_SENDER.md`](./docs/integrations/FORWARDED_SENDER.md)
before touching `Sender Email`/`Sender Name`, the contact fallback in
`_shared/listingContact.pure.ts`, or anything that decides who to email about a listing. It
also records the one rule that keeps biting: an address on our side of the pipeline is never
the answer, in any column.

Column names for that table live in `_shared/airtableIntakeFields.pure.ts` and nowhere else.
Airtable returns `undefined` for a column that does not exist exactly as it does for one
that is empty, so a mistyped name is invisible — that file's header records what that cost
last time.

## Workflow Playground (the automation canvas)
Read [`docs/workflows/DISPATCH.md`](./docs/workflows/DISPATCH.md) before touching
the run engine, the trigger-capture triggers or the dispatcher. One engine serves
three callers — a test run, a live run a person starts, and a workflow a captured
event dispatches with nobody watching — so it lives in
`supabase/functions/_shared/workflow/` and `src/lib/workflow/*` are one-line
shims onto it. Those modules must parse under Deno: no `@/` aliases, explicit
`.ts` extensions.

Two things the doc records that keep biting. **Nothing is captured unless a live
workflow listens for it**, so an empty `workflow_trigger_events` on a deployment
with no live workflows is correct rather than broken. And **what can run live is
derived from the catalog, never listed**: an operation is runnable because it
declares a `request` descriptor (`httpRequest.pure.ts`), so adding a vendor is a
declaration beside the operation rather than a change to the executor — and a
new vendor call that skips `_shared/meteredFetch.ts` is billed to nobody.

## API usage metering (this deployment may be spending someone else's money)
A workspace provisioned by Aurixa Mission Control boots with the **prime's own
vendor keys** forwarded into its Supabase project — OpenAI, Resend, Domain,
Cotality, Lovable — so every model token and property lookup it makes is billed
to the prime's accounts and recharged per tenant. A key the workspace supplies
itself is charged at nothing. Read
[`docs/integrations/API_USAGE_METERING.md`](./docs/integrations/API_USAGE_METERING.md)
before touching `_shared/logApiUsage.ts`, adding a vendor API call, or changing
`service_name` on an existing one: an unmapped service is metered here and
**never billed**, because guessing which credential a call spent bills the wrong
tenant. The map is `_shared/apiUsageBilling.pure.ts` and nowhere else.

New vendor calls should use `_shared/meteredFetch.ts` rather than `fetch` — it
resolves the credential from the URL and logs the call itself, so metering
cannot be forgotten. Never add it to a call site that already calls
`logApiUsage` for the same request: that bills the tenant twice, which is worse
than not billing. That constraint is why everything behind `_shared/llmRouter.ts`
is still uninstrumented; the doc explains what it would take to fix.

## Stamp duty
Every duty figure in the product comes from `supabase/functions/_shared/stampDuty/`
and nowhere else; `src/utils/stampDutyCalculator.ts` is a one-line re-export.
Read [`docs/reports/STAMP_DUTY.md`](./docs/reports/STAMP_DUTY.md) before changing
a rate — it records the four divergent implementations this replaced (and what
each got wrong), the third-party iframe it retired, and the handful of published
quirks that look like bugs and must not be "fixed": VIC steps **up** at $960k,
the ACT steps **down** at $1.455m, and NT is quadratic below $525k. A rate change
is a data edit in `schedules.pure.ts` plus a regenerated seed — never a hand-written
one. The weekly sweep flags stale schedules and **never writes a rate**; the doc
explains why that asymmetry is deliberate.

## Generated reports / PDFs
**Read [`docs/reports/COVERAGE.md`](./docs/reports/COVERAGE.md) before anything
else here.** The design system renders **0.14%** of the documents this product
actually produces — 2 of 1,440, and zero of 1,162 investment reports. Every
other measure in this programme (the ink floor, the critique rubric, the golden
diff, PDF/UA validation) is taken against fixtures in a harness and passes while
that stays true. A correctness measure cannot see an unused system, so check
coverage before improving output.

Read [`.claude/skills/npc-services-design/reports/REPORT_RULES.md`](./.claude/skills/npc-services-design/reports/REPORT_RULES.md)
before touching any PDF generator — print has different contrast, colour and font
rules from screen, and most of the repo's "logo" files are email-signature banners
carrying the director's personal mobile number. Architecture and the migration
programme: [`docs/reports/DESIGN_SYSTEM.md`](./docs/reports/DESIGN_SYSTEM.md).

Every report is rendered by one container, `weasyprint-service/`, and it ships
on its **own** deploy — `ci.yml` builds that image to test it and publishes
nothing. `deploy-weasyprint-service.yml` stages a revision with no traffic on
every push and promotes only when a person asks, for the reason below; the
manual path and the one-time federation setup are in
[`docs/reports/CONTAINER_RELEASE.md`](./docs/reports/CONTAINER_RELEASE.md).
Read that before changing the engine pin, the fonts or the render options: it
also carries the order the container and the render routes have to ship in,
which is not interchangeable — the routes ask for `pdf/ua-1`, and an engine
without that variant returns a 500 on every report.

Investment report **generation** is a separate concern from rendering, and the
one pipeline that cannot finish inside a single request: 17 sections at ~25s each
against a ~150s edge ceiling. It survives by stopping at a wall-clock budget and
being resumed — by the browser, the bulk worker, or a cron watchdog. Read
[`docs/reports/INVESTMENT_REPORT_RESUME.md`](./docs/reports/INVESTMENT_REPORT_RESUME.md)
before changing the section loop, its timeouts, or anything that claims a report.

Ten formats have been migrated onto it, and each carries its own contract:
[`INVESTMENT.md`](./docs/reports/INVESTMENT.md),
[`BORROWING_CAPACITY.md`](./docs/reports/BORROWING_CAPACITY.md),
[`CASH_FLOW.md`](./docs/reports/CASH_FLOW.md),
[`PORTFOLIO.md`](./docs/reports/PORTFOLIO.md),
[`COMPARISON.md`](./docs/reports/COMPARISON.md),
[`CASH_FLOW_COMPARISON.md`](./docs/reports/CASH_FLOW_COMPARISON.md),
[`CLIENT_DETAILS.md`](./docs/reports/CLIENT_DETAILS.md),
[`QA.md`](./docs/reports/QA.md),
[`MARKET_INTELLIGENCE.md`](./docs/reports/MARKET_INTELLIGENCE.md) and
[`COMMERCIAL_CAPACITY.md`](./docs/reports/COMMERCIAL_CAPACITY.md). Read the
relevant one before touching that format — each records defects that only a
render against production data revealed, and each names the legacy generators
that must stay.

**Investment Location & Property Fit** is the highest-volume format by an order
of magnitude — 1,182 rows, 5-18 a week — and the one to read before touching
anything the *model* draws. Its prose carries a chart vocabulary the generator's
prompt demands and the renderer had never parsed: **3,753 `{{bars: ...}}`-style
directives, about 107 a report**, every one of which set as body copy on a
client's page. The parser and the router are shared
(`_shared/reports/vizDirectives.pure.ts`, `vizFigures.pure.ts`) and eleven of the
twelve kinds map one-to-one onto a chart primitive that already existed.
`INVESTMENT.md` also records why nothing keyed on a section *number* works any
more: of the 35 reports the current generator has produced, **none is numbered**.

**Commercial & Industrial Capacity** is the one to read before
adding a format whose prose a model writes. Its figures come from the stored
calculation run and never from a recomputation; its analysis section is
model-authored under a tool schema that contains **no numeric field at all**,
persisted against the run so a re-issued report says what the first one said,
and labelled as model-written on the page. It is also the format whose first
render found a live bug in `measure.pure.ts` — `formatDelta` reported "no
change" for every `rate` that changed, which had been silently wrong in the
Borrowing Capacity Snapshot's audit table.

Two of the ten carry model-authored Markdown rather than typed figures, and
they share the programme's only Markdown renderer,
`_shared/reports/markdown.pure.ts`. Read them first if you are touching prose.
**Report Q&A** discovers its sections from the content rather than declaring
them, and is the only render route that can call a model. **Market Intelligence**
is the one whose page budget is fitted block by block against real renders rather
than summed, the one that clips a section and says so on the page, and the only
one that writes a PDF a scheduled email later attaches.

## The PDF-import sidecar (Docling)
Template Builder's PDF import runs through one Cloud Run container,
`pdf-parse-service/`, dispatched by `pdf-parse-dispatch`. Read
[`docs/pdf-import/SIDECAR_PERFORMANCE_PROGRAMME.md`](./docs/pdf-import/SIDECAR_PERFORMANCE_PROGRAMME.md)
before changing its deployment, its Docling options or the watchdog: it records
what the production ledger measured against what the deploy docs assumed, and
they disagreed on nearly every point — **43% of 76 jobs failed**, one 94-page
job took 357s while another took 46,424s, and 42% of a healthy job's wall clock
was cross-Pacific IO to Supabase.

Two rules that keep biting. **OCR availability is not OCR forcing** — they were a
single expression until lane-policy v3, so enabling the fallback force-OCR'd
every page of 44% of traffic; and disabling it would have stopped `ocr_scanned`
OCR-ing a genuine scan, because the capability is a hard ceiling. **The sidecar
and the dispatcher share `LANE_POLICY_VERSION` and must deploy together**, or the
cache fingerprint serves stale-semantics artifacts.

Sidecar options live in `app.py`'s `GLOBAL_CAPABILITIES`, the lane matrix in
`lane_policy.py`, and the OCR language contract in `ocr_languages.py` — a
mistyped language code is not inert, it fails the whole conversion (`zh` is not
an EasyOCR code and cost 9 production jobs). Those three modules are pure and
gated by `ci.yml`; nothing else in `pdf-parse-service/` runs in CI.

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
