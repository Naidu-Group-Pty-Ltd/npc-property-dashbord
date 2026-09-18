# All five tiers, read as documents — 18 September 2026

S5/S6 §9 asks for the report deliverables finished across all five reports, and
§10 asks that every page be read. This is the page-level read of **all five
tiers**, taken from real renders rather than from the code that produces them.

**This is a retained-data replay, not a real end-to-end generation.** Every
document below was drawn from a stored `investment_reports` row through the
journey harness: the real application in a real Chromium, the real template
path, and WeasyPrint 69.0 — the version `weasyprint-service/requirements.txt`
pins — but the Supabase project is answered from fixtures, no credential is
spent and no vendor is called. §10's ten PDFs for Annabelle and Pallas still
need the authorised environment. Nothing here is offered as those.

## The five tiers

One fixture per tier, all non-client rows (`client_property_id` null):

| tier | fixture | property | stored chars | rendered |
| --- | --- | --- | --- | --- |
| compass | `09f8569e` | 48 Redfern Street, Cowra NSW | 57,544 | 35 pp |
| strategic (Due Diligence) | `2f1f7f6f` | 1/27D Mitchell Street | 39,608 | 25 pp |
| financial | `c21ed1fa` | 1/27D Mitchell Street | 28,636 | 19 pp |
| briefing | `89b451f6` | 1/27D Mitchell Street | 14,435 | 11 pp |
| snapshot | `8c6edc56` | 1/27D Mitchell Street | 12,325 | 11 pp |

Front-end journey: **31/31 on every tier**, after the harness gap below.

## The harness gap that came in with `main`

The three Compass journeys on record were run 14 September and passed with
nothing unanswered. Re-run today the strategic journey failed one check —
`every request the page made was answered — fn:mission-control-announcements`.

That is not a product defect. `AnnouncementHost` is mounted by
`DashboardLayout` on every dashboard page, so it is on every report page;
`fetchAnnouncements` already answers a failure with an empty list and a warning
rather than an error. It is new chrome that arrived when `main` was brought into
the branch, and the double had never been taught it — its three siblings
(`mission-control-plan-change`, `mission-control-feedback-prompt`,
`notifications-feed-v2`) were already there. The double now answers
`{ announcements: [] }`, which is the shape `parseAnnouncementsPayload` reads
and what a deployment with nothing published returns.

Worth recording because the old artefacts *looked* like a clean baseline: a
four-day-old `journey.json` cannot see a request the page only started making
yesterday.

## The two fixes from the previous commits hold on every tier

**Cover (`htmlRenderer.ts`).** The visually-hidden `<h1>` carried for PDF/UA
7.4.2 was still being painted. Measured on the strategic cover's text layer,
the three occurrences of the document name are now all designed furniture at
real sizes — the brand lockup at `x=68 y=123.9` (13.6 pt) and `y=137.4`
(13.6 pt), and the running head at `x=466.9 y=124.1` (8.1 pt). Nothing sits at
the origin, on any tier.

**Contents (`listedSectionLevel`).** The generalised rule — *a level is a
section tier only if its sections open more than one page* — was verified on
the Compass shape before this. It holds on the other two shapes too:

| tier | contents rows | leads with |
| --- | --- | --- |
| strategic | 12 (9 real sections) | Executive dashboard · Client Property & Location Snapshot · Core Property Facts … |
| financial | 11 (7 real sections) | Executive dashboard · Client Investment Decision Summary · Financial Input Snapshot … |
| briefing | 22 | Location Overview · Current Market Performance · Market Activity … |
| snapshot | — | no contents page; page 2 is the Verdict (correct for the format) |

Before the fix the strategic listed its whole body as one row (`# Property &
Location Due Diligence Report`) and the financial as one (`# Client Investment
Feasibility & Financial Performance Report`).

## Mechanical measurement — `report-pdf/measure.mjs`

| tier | fonts | result | issues |
| --- | --- | --- | --- |
| strategic | 12/12 embedded | FAIL | SPARSE p2 48.4%, p3 55.3%, p24 52.6%; **TOKEN p7** |
| financial | 13/13 embedded | FAIL | SPARSE p2 51.2% |
| briefing | 6/6 embedded | FAIL | SPARSE p3 55.3%; **TOKEN p4** |
| snapshot | 5/5 embedded | **PASS** | none |

No ILLEGIBLE, no OFF-PAGE, no OVERLAP, no MOJIBAKE, no BLANK on any tier.
Page numbering correct on every page that draws it.

### The SPARSE pages are the contents and the dashboard, and they are not defects

p2 on the strategic and the financial is the **contents page**: 12 and 11 rows
on a page sized for about 30, so the band under the last row is half the body.
Filling it would mean listing subsections, which `listedSectionLevel` exists to
refuse — a complete list of sections beats a truncated list of sections and
subsections. p3 is the executive dashboard, a fixed-geometry master. p24 is
the strategic's disclaimer.

Recorded as measured rather than closed: the threshold is deliberately
generous and these are the pages it is generous *about*.

### The two TOKEN findings are real, and both are fixed at the producer

Both are model-authored prose in **stored** content, so neither is repaired by
this release for the rows that carry them — a prompt change is forward-only,
and **prose is never regex-scrubbed** on read or on write. What changes is that
the next document cannot be written this way.

**1 — an absence drawn as a finding.** Strategic p7:

> `⚠ Exact bed/bath/car details not provided`

Measured across all seven retained reports: **4 of 194 at-a-glance cells** put
a gap in our own file into the strip's `⚠` *watch* cell, which means something
a buyer should watch. Three of the four are on `8ef4bfc3`, the sparse Compass
with no financials — the shape holding least evidence is where the model
reaches for this.

`COMPASS_DOCUMENT_CONTRACT` already said the right thing about prose ("omit the
sentence … do not say it is unavailable"). The model obeyed that and put the
absence in a chip instead. This is the third time this repository has recorded
the same shape: a prohibition that names a form without demonstrating the
permitted one is one a model routes around. The contract now extends the rule
past prose into the strip, the cell and the chart, and demonstrates the
permitted form — **fewer cells**: three that each carry a finding is a complete
strip.

**2 — the document naming its own source.** Briefing p4:

> *"Specific market activity metrics like active listings, sales volume, and
> vacancy rate were not provided numerically in the original report."*

Row `89b451f6` carries four of these, each shaped
`N/A (… not provided in the original report.)`.

The cause is exact and was in the prompt: `condense-investment-report` handed
the parent to the model under the literal label **`ORIGINAL COMPREHENSIVE
REPORT:`**, and the model gave that phrase to the client — who was handed one
document and cannot open the other one. It is the same routing-around twice
over: `IMPORTANT` banned the *token* ("NEVER write N/A") without naming the
permitted form, so the model wrote a sentence narrating the gap and
parenthesised the token inside it. A prose bullet is exactly where the
read-path placeholder scrub correctly cannot reach.

Changed: the block is labelled `SOURCE MATERIAL (pipeline input — the reader
has never seen this document)`; the two structure guides stop saying "the
original report's own section headings"; and `IMPORTANT` states the reader
holds one document, names the three phrases, and gives the permitted form —
omit the line, the bullet or the row, and do not leave the heading behind.

Both rules are pinned by
`src/lib/reports/__tests__/documentNeverDescribesItsOwnProduction.spec.ts`
(9 tests), including the assertion that no prompt text anywhere between
`TIER_CONFIG` and the end of the user prompt hands the model the phrase.

`condense.system_template` in `engine-prompts.ts` still says "as they appear in
the original". It is left alone deliberately: it is a DB-overridable default, it
says "the original" rather than "the original report", and the load-bearing ban
is in the code-built user prompt, which no deployment can override.

## What this does not cover

- §10's ten PDFs through real generation for Annabelle and Pallas.
- The ten-year infrastructure outlook sourcing gap (§9), still open.
- The navigation and educational treatment from the Lot 20427 reference (§9).
