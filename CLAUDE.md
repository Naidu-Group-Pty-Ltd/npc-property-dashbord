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

## What the API gateway checks (`verify_jwt`)
Read [`docs/security/VERIFY_JWT.md`](./docs/security/VERIFY_JWT.md) before
changing a `verify_jwt` line in `supabase/config.toml`, the deploy workflow's
changed-function list, or a function's own auth check. **An omitted
`[functions.X]` block is not "no opinion"** — the CLI reads it as `true`, which
asserts the gateway is checking a Supabase JWT in front of that function; it was
wrong for 91 of 425, and `check-verify-jwt-declared.mjs` now fails CI on a
missing declaration.

Two rules bite. **A preflight is not a `verify_jwt` probe** — the gateway exempts
`OPTIONS` and enforces on the real request, so a guarded function answers its
preflight normally; every wrong conclusion in this area came from reading a 200
(or a 503, which was a boot failure) as evidence about the gateway. Ask the
Management API instead. And **a config-only edit used to deploy nothing**,
because the changed-function list was built from `supabase/functions/**` paths
alone — which is how a declaration and production came to disagree at all.

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
than not billing.

**Model calls are metered by `_shared/llmRouter.ts` itself**, which is why
`meterUsage` exists and why it **defaults to true** — 19 of the 25 edge
functions that call the router were spending a forwarded key for free, and an
omitted flag must never mean unbilled. Only the six functions that log
adjacently to their own call pass `meterUsage: false`. The credential a
`(route, modelId)` pair spends is resolved by `_shared/llmUsageBinding.pure.ts`,
which mirrors the router's dispatch and returns **null** rather than guessing; a
CI test reads the router's source and fails when the two drift.

## The Commercial & Industrial Analysis Workspace
`/calculators` is one guided workspace, not nine calculator cards. Read
[`docs/commercial/ANALYSIS_WORKSPACE.md`](./docs/commercial/ANALYSIS_WORKSPACE.md)
before touching it, `src/components/commercial/workspace/` or
`src/lib/ciAssessment/analysis*.ts`. The rule that carries it: **an analysis is
an assessment record** — there is no separate calculator session, client model
or property model, so autosave, calculation runs, client linking and the
rendered report are the platform's own rather than a second implementation. The
standalone suite it replaces kept the whole deal in a Zustand store with no
persistence (a refresh discarded it) and its "Generate Report" produced no
document at all.

Two things bite. The **two analysis engines use different units** —
`capRateEngine`'s valuation gap is a ratio, `dcfEngine`'s IRRs are already
percentages — and getting it wrong renders a plausible number rather than an
error; both are pinned by tests. And **readiness is not a second opinion**:
blocking is exactly what the report route refuses, everything else is disclosed.

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

**Which template a report comes out in is now a choice, and it never was.**
Read [`docs/reports/TEMPLATE_SELECTION.md`](./docs/reports/TEMPLATE_SELECTION.md)
before touching `_shared/reports/reportTemplateSelection.pure.ts`, the picker or
anything that decides which `report_templates` row a document is drawn from. A
template used to reach a document by **ranking alone** — no surface anywhere
bound one to a report format, and every path that touched a template ended in
the Template Builder, which is an editor. A selection is stored per (user,
format) and read **before** the ranking, never instead of it, so a format with
nothing chosen behaves exactly as it did. Three rules bite: a format has up to
four spellings and they are **one** format (the alias map is now in that pure
module and the registry re-exports it — two copies is how `commercial_industrial`
became activatable and unresolvable); a chosen template whose engine is not
`weasyprint` is **still selectable and says so**, because it is what the ranking
would have picked and it produces the legacy document either way; and a
selection that goes stale resolves to **`unavailable`**, never silently to a
different template.

**A document can be completely correct and still never reach the renderer.**
Read [`docs/reports/RENDER_BOUNDARY.md`](./docs/reports/RENDER_BOUNDARY.md)
before touching `renderResourcePolicy.pure.ts`, `printFontPolicy.pure.ts`,
`tokensToFontFaceCss` or anything that compiles HTML for WeasyPrint.
`render-template-pdf` asserts the HTML can make **no** network request before
it invokes the engine, and all 500 seeded masters name their typefaces with a
Google Fonts `cssUrl` — so every design-system render was refused at that gate,
after parsing, binding and drawing 84 blocks correctly. It was invisible
because the gate ran *before* the `template_render_jobs` row was written and
before `templateId` was read, so a refusal left no row in the ledger and none
in `template_events`; the route fell back, and the legacy generator produces a
well-typeset document too. Two rules: **for print the container is the font
source** (`compileTemplateHtmlForPdf` forces it, and the production route goes
through that compiler rather than its own copy of the step), and **a family the
image lacks is substituted explicitly, never left to fontconfig** — an unknown
face prints as the engine default with no warning from anything.

That boundary judges **where the renderer fetches, not where it draws**. It used
to scan the whole document as one string, so it refused reports for their prose —
808 of 1,182 investment reports carry a URL in their content, and the two
model-authored formats are the most exposed because a model cites its sources.
Attribute values and stylesheet bodies are judged; text between tags is not.
Every attribute is judged rather than a list of the fetchable ones (guessing
narrowly reopens the SSRF; guessing widely costs a loud refusal), and exactly two
are exempt: `xmlns*`, and `href` **on `<a>`** alone. The other half of the same
rule is that **an asset that cannot be brought inside the boundary is dropped and
named, never carried into it** — a bound `src` is resolved and inlined like a
literal one, and what cannot be fetched is left out with a notice rather than
failing the document.

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
of magnitude — 1,182 rows, 5-18 a week. Its *structure* is
[`INVESTMENT_STRUCTURE.md`](./docs/reports/INVESTMENT_STRUCTURE.md), which is the
one to read before changing a section, the generator prompt or the word caps:
the report carried **90 editorial commentary labels a report — 16.9% of the
document** and ran at 2.3× its own declared budget, because the prompt told the
model "after every visual" and "one per section" at the same time, and because
`compassPostProcessor` / `compassQAValidator` **had no caller in the generation
path at all** — every cap they enforce applied to everything except the document
a client receives. Two rules there keep biting: a label is stripped with its
paragraph but **never a figure or a table**, and a report banked under a
different section list is **regenerated rather than resumed**, because
`last_completed_section` is an index into whichever list is current.

`INVESTMENT.md` is the one to read before touching anything the *model* draws. Its prose carries a chart vocabulary the generator's
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

## Agreement Centre documents
Partner agreements are rendered by the same WeasyPrint container as the reports,
but they are **stored**, and that is the thing to understand before changing
anything that renders, stores or serves one. Read
[`docs/agreements/DOCUMENT_REVISIONS.md`](./docs/agreements/DOCUMENT_REVISIONS.md).

An issued version freezes what the agreement *says* — `field_values` and
`brand_snapshot` on the version row — and the stored PDF is a **cache** of
those inputs, not the record. Until August 2026 the code froze the bytes as
well, so a fixed cover reached every future issue and nothing already issued:
the draft export came out right the same day the fix deployed and the Issued PDF
kept coming out wrong for ever. The revision now lives in the object's path
(`issued-r2.pdf`; r1 unsuffixed), `resolveVersionArtefact` is the only place that
decides, and **a signature freezes an artefact permanently** — re-typesetting
under a signatory is the one thing this must never do. Bump
`AGREEMENT_CENTRE_DOCUMENT_REVISION` when the composition changes; nothing needs
backfilling.

An agreement is addressed to the partner **organisation**
(`finance_agent_contact_id`), which is how the Finance Portal resolves it too —
so it can be issued before anybody has a login and be waiting when they
activate. Read
[`PARTNER_ACTIVATION.md`](./docs/agreements/PARTNER_ACTIVATION.md) before
changing what may be issued or what notifies a partner. Two rules that bite:
`finance_portal_users.is_active` is set when the **invitation is sent**, so it
never meant "can sign in" — `partnerAccess.pure.ts` is the authority, and only a
deliberate revocation blocks a digital issue. And a notification raised before
the portal user exists has nowhere to live, so activation sweeps for whatever
was issued in the meantime rather than the issue trying to queue it.

A partner asks for a change by **pinning it to the clause**, not by picking a
section from a dropdown. Read
[`ANNOTATIONS.md`](./docs/agreements/ANNOTATIONS.md) before touching
`annotations.pure.ts` or the annotation layer. The anchor is the **same path an
amendment writes to** (`contentOverrides.pure.ts`), so the request and the
change answering it name the same node — and because both portals render one
`DigitalAgreementView` and one `AnnotationRail`, the Command Centre seeing the
partner's pins is structural rather than a second implementation. Two rules:
**a stale anchor degrades to a list entry and is never dropped** (`anchor_label`
is stored, never re-derived — re-pointing a commission comment at a termination
clause is worse than no pin), and **the migration is optional** — the columns
are probed, and without them the request still saves with its location in the
comment.

Getting the document *to* the partner is its own concern:
[`SENDING.md`](./docs/agreements/SENDING.md). Two rules there. Issuing emails
the partner as well as notifying the portal — it used to write one in-app
notification and stop, which is no signal at all to somebody who has never
logged in. And **the portal's notification feed does not depend on a
migration**: `finance-portal-notifications` filtered every read on three routing
columns from a migration that was merged and never applied, so PostgREST
answered `42703` for the whole statement and the feed returned 500 for three
weeks — 238 notifications, 236 unread, 0 readable. The boundary is now stated in
`financeNotificationRouting.pure.ts` and enforced on the columns where they
exist and on the notification type where they do not.

Once it is there, the two portals have to agree that it is. Read
[`SYNCHRONISATION.md`](./docs/agreements/SYNCHRONISATION.md) before touching
`syncStamp.pure.ts`, `useAgreementSync.ts` or either function's `sync`
operation. "The Finance Portal is not receiving agreements" was measured and is
not a delivery fault — one production agreement went issued → opened in
**11 seconds** — it is that **every agreement surface on both sides fetched once,
on mount**, so an agreement issued into an hour-old tab was invisible until
somebody reloaded. Realtime is unavailable to the partner *by construction*
(bespoke session token, service-role-only tables), so both portals poll a
four-scalar **stamp** and refetch payloads only when it moves. Three rules bite:
a **null previous stamp is not a change** (or every mount refetches what it just
fetched), `refetchOnWindowFocus: true` **and** `staleTime: 0` are set against the
app's global defaults and are the half that actually fixes the reported case,
and a **receipt is counted on `metadata->>agreement_id`** — `related_entity_id`
is null on every agreement notification in production. That doc also records why
`notifyPartner` now returns its outcome: it swallowed its own errors and
returned void, so an issue whose notification never wrote said the same thing as
one that landed.

**The partner's session lives in a cookie, and for a long time nothing read
it.** Read
[`PARTNER_SESSION_TRANSPORT.md`](./docs/agreements/PARTNER_SESSION_TRANSPORT.md)
before touching `_shared/financeSessionToken.ts`, `finance-portal-session.ts`
or any `finance-portal-*` token extraction. WP-11B/C moved the session into an
HttpOnly `__Host-finance_session_token` cookie and dropped the storage mirror —
the client keeps an **in-memory copy that does not survive a page load** — but
only `verify` and `logout` were taught to read the cookie. Every data function
kept a hand-rolled four-`??` extractor that could not see it, so from the second
page view onwards a partner got `401 Session token required` on everything: a
cookie-only request is **byte-identical** to sending no credential at all (both
54 bytes). The portal looked signed in because the session *check* read the
cookie and the data calls did not. Three rules: there is **one reader**
(`extractFinanceSessionToken`) and hand-rolled lookups fail
`security:finance-session-transport`; the order **header → body → cookie** is
load-bearing because it keeps every previously working caller on its path; and
**cookie source implies a CSRF guard** — the cookie is `SameSite=None`, so
honouring it creates ambient cross-site authority that `enforceCsrf` must cover.

And an agreement must never be *nowhere*. Read
[`CONTINUITY.md`](./docs/agreements/CONTINUITY.md) before touching the
register's stage counters, its empty states, or `dashboardGroupForStatus` /
`stageToFollow` / `isIssued`. "The agreement disappears from the originating
portal once it is issued" was measured and is not a data fault — the row is
present, `list` returns it, the timeline is unbroken and the partner opened it —
it is that **the register partitions by status and issuing changes the
status**, so the "Ready to Issue" stage you issued from empties and says
"Nothing in this stage" over a **Create Agreement** button. Four rules: an
empty state reachable with rows in the register must say so and **never offer
to create more**; a row that changes stage **says where it went** rather than
vanishing; **`isIssued` is `issued_at`, never a status** (a withdrawn or voided
agreement was still issued, and no status ever rendered as "Issued"); and
`partner_legal_name` is typed while `finance_agent_contact_id` is what the
portal resolves against — they differ on half the production register, so the
row shows the linked **portal account** whenever it disagrees.

Deployment is the other half of it, and it has bitten twice:
[`DEPLOYMENT.md`](./docs/agreements/DEPLOYMENT.md).

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

That sidecar is only **one** of the two PDF engines. A checkbox in the import
dialog routes the file to Claude instead, via `template-design-agent`. Read
[`CLAUDE_RECONSTRUCTION_GROUNDING.md`](./docs/pdf-import/CLAUDE_RECONSTRUCTION_GROUNDING.md)
before touching that path: it was the only reference kind the importer did not
ground, and it now measures the attached PDF with PDF.js first. Two rules there
keep biting — grounding is read from the **attached bytes and never from the
open template** (measurements from the wrong document are worse than none, since
the agent treats them as authoritative), and **absent grounding is not empty
grounding** (an empty element list tells the model a scanned page has no text,
which it then reproduces).

The import review can now ask a model **what differs** between the source page
and the rendered one, per page, on an operator click. Read
[`VISUAL_CRITIQUE.md`](./docs/pdf-import/VISUAL_CRITIQUE.md) before touching
`_shared/visualCritique.pure.ts` or the `visual_critique` mode. It is a judge and
never a fixer: the model notices, and every claim geometry can settle is settled
by geometry before a reviewer sees it — a finding naming an element the page does
not contain is **dropped**, and one measurement contradicts is shown as
contradicted rather than as a defect. The doc also records the endpoint it
replaces: `layout_reconciliation_repair` reads a field its only client never
sent, so it answered "no changes" to every request ever made of it.

A scanned PDF is routed to the engine that can read it. Read
[`SCANNED_ROUTING.md`](./docs/pdf-import/SCANNED_ROUTING.md) before touching
`scannedDocumentPolicy.pure.ts` or `probeTextLayer`: the deterministic path
cannot read a scan and **OCR is not the fallback** — 0 OCR pages across 1,164 in
production, because the capability ceiling defaults false — so the dialog
measures the text layer in the browser and pre-selects the Claude engine. Two
rules there: a **failed probe is `unknown`, never `scanned`** (it fails on
encrypted files, which are not scans), and a stray watermark character must not
make a scanned page look native.

Chart reconstruction is **inert in production and now says so**. Read
[`CHART_RECONSTRUCTION_STATUS.md`](./docs/pdf-import/CHART_RECONSTRUCTION_STATUS.md)
before touching `chartCandidate.pure.ts` or anything in the chart path: 0 chart
overlays exist across 245 imports, for four independent reasons (the scene graph
never runs, so `chart_candidates.py` never executes; Docling's picture classifier
runs on 2 of 84 jobs; `chartNativeEnabled` is off). The client-side detector
recovers the classification from geometry the import already holds and **never
reads a value off a chart** — a misread number in a client's financial report is
this programme's top risk, and a classification cannot misstate a figure.

An import now also brings a **design system** with it, read off the source and
bound to its own overlays. Read
[`IMPORT_DESIGN_SYSTEM.md`](./docs/pdf-import/IMPORT_DESIGN_SYSTEM.md) before
touching `designSystemBinding.pure.ts`, the token derivation in
`mapDoclingToPagePlan`, or `applyTemplateImportPlan`'s token merge. One rule
carries it: **bind only where the token's value is exactly what the overlay
measured** — that is what makes the render byte-identical and the import
restyleable at the same time, and there is no tolerance parameter. Two things
that bit: anything which **measures** a template (CDIR) has to resolve the
references first or it derives a palette of `token:heading`, and the base
template's tokens win every conflict so an import cannot restyle pages it lands
beside.

An imported overlay also carries what the source said it **is** —
`overlay.semantics`, from Docling's own label. Read
[`SEMANTIC_STRUCTURE.md`](./docs/pdf-import/SEMANTIC_STRUCTURE.md) before
touching `semanticRole.pure.ts`, the overlay element name in
`blocks/_shared.html.ts`, or image `alt`. WeasyPrint builds the tagged PDF's
structure tree from the **element name**, and `render-template-pdf` asks for
`pdf/ua-1` — so a `<div>` is why an imported page's structure tree used to be
flat with zero headings. The stage's hard constraint is that it adds meaning and
moves nothing: pixel identity at 300 DPI is asserted before and after, and the
`margin:0` reset and the `<span>` inside a heading are both there for measured
reasons the doc records.

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
The seeded PDF catalogue is **generated**, not hand-edited. Never hand-edit the
generated migration — edit the source and run `npm run templates:library:seed`,
which revalidates every schema against the live Zod contract, the production
renderer allow-list and the publish gate before writing anything.

It carries **two authoring systems over one renderer**. The 43 *voice* templates
come from `scripts/template-library/designSystem.ts` — five voices keyed to the
catalogue's `style` axis, six accents keyed to subject, all derived from the NPC
tokens ([`06-design-system.md`](./docs/template-library/06-design-system.md)).

The 500 *family* templates come from the approved Claude Design **Investment
Compass Template Catalogue**: ten design families × five structural variants ×
ten colourways. The designs carry no subject matter, so they serve **all ten
migrated report formats** — 50 masters each of Investment Compass, the Borrowing
Capacity Snapshot, the Portfolio Performance Review, the Property Comparison
Analysis, the 10 Year Cash Flow, the Client Details Form, the Cash Flow
Comparison, Report Q&A, Commercial & Industrial Capacity and Market
Intelligence, sharing one shell (`investmentCompass/master.ts`) and contributing
a page sequence each. Nine are production-ready; the Cash Flow Comparison is
**preview-only because nothing about a comparison is persisted anywhere a
template can read** — not the projections, not the analysis, not the ledger.

**Model-authored Markdown is drawn by `markdown-block`, which takes source
rather than HTML.** Report Q&A and Market Intelligence both carry prose a model
wrote — 70% of Q&A answers use inline bold, and Market Intelligence is eight
Markdown layers — and neither could be drawn until that block existed. It renders
through `_shared/reports/markdown.pure.ts`, the programme's only Markdown
implementation and **escape-first**, so safety is a property of the renderer
rather than of the caller: no input to it produces markup the model chose. That
is what admits it to `PRODUCTION_SAFE_BLOCK_TYPES` without opening a hole in a
security allow-list, and a block accepting rendered HTML must never be added.

**A body of unknown length is carried by conditional pages, not by a bigger
block.** `packMarkdownPages` (`reports/markdownPaging.pure.ts`) is shared by the
block and the projections precisely so they cannot disagree — a master makes
page N conditional on a published page count while the block decides what page N
holds, and one line of drift prints a blank page or loses the end of a section.
Adding a format is a composer plus a `ReportFormat` descriptor — and the adapter
and projection that make it production-ready — not a second design system.

**A `category` must be one the column accepts.** `template_library_entries_category_check`
and the TypeScript `TemplateLibraryCategory` union have diverged: the union has
`market`, the column has `suburb`/`postcode`/`statewide`. The column decides, the
seed builder refuses to write when a category is outside it, and that guard
exists because 50 Client Details masters were rejected by Postgres **mid-apply,
after 290 rows had been written**.

Two rules are worth knowing before you bind anything. **A declared block height
is a promise the renderer keeps only if the text is as short as the author
assumed**, and a block that sets taller does not overflow the page, it prints
over the next one; size from `textHeight(chars)` against measured production
lengths, and `npm run templates:compass:qa` fails on the class. And **an
unresolved binding renders as the empty string, never as a visible `{{…}}`** —
which is why two formats shipped a cover with no title at all, why the
Investment Compass's narrative page and risk register were blank on every report
(49 of its 80 paths resolved to nothing), and why **every** document printed a
blank letterhead until `organisationProjection.pure.ts` gave `org.*` a producer.
A format's projection is the authority on what may be bound; the catalogue specs
assert the masters bind nothing it cannot publish, and the check that finds this
class is to resolve every bound path against a row taken verbatim from
production — never against `SAMPLE_REPORT_DATA`, which is written in the
catalogue's own vocabulary and passes while production is empty. Read
[`docs/template-library/07-investment-compass-families.md`](./docs/template-library/07-investment-compass-families.md)
before touching `scripts/template-library/investmentCompass/` or
`_shared/templateColourways.*`.

**The families and colourways are GENERATED, never hand-written.**
`investmentCompass/source.json` is a verbatim evaluation of `FAMILIES` and
`COLOURWAYS` from the Design file; `npm run templates:compass:generate` emits
the two `.generated.ts` modules from it. ~250 manifest entries and 500 colour
values are not something anyone transcribes correctly, and a mistyped hex is a
design change nobody approved — so `investmentCompassSource.spec.ts` re-checks
the generated files against the source every run. A design change goes to Claude
Design and comes back through the generator.

Four rules keep biting. **A colourway is tokens and nothing else** — the
catalogue's own rule is "tokens carry no layout meaning", which is why this is 50
masters × 10 palettes and not 500 templates; a spec asserts every block's
geometry is byte-identical across a family's ten palettes. **A colourway's `ink`
is the cover FIELD, not body copy** — body ink is derived by lifting it 4 points,
the measured gap between `--aurixa-obsidian` and `--foreground`, and setting body
copy to the field colour is invisible on screen and wrong on paper. **The
manifest vocabulary is resolved, never read directly** — 31 KPI layouts and 30
chart styles map onto primitives in `resolvers.ts`, which **throws** on an
unmapped value so a new family fails the build instead of silently rendering as
somebody else's layout. And **`family_id` is version lineage, not a design
family** — it is what the publish path deprecates siblings by, so overloading it
would make publishing one master deprecate the other four; family metadata lives
in the additive `design_meta` column instead.

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
