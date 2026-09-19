# The signed-in acceptance run — publication, R1–R12, and the ten PDFs

Written for the operator who holds the session. Every step names the action, the
expected result and the evidence to return. **Nothing here may be marked PASS
until its evidence exists**; an unperformed check is BLOCKED or PENDING.

Three things are deliberately kept apart, because conflating them is how a
release gets called verified when it is not:

| | what it proves | what it does NOT prove |
| --- | --- | --- |
| **P1 Publication confirmation** | the publish action completed | nothing about which code is being served |
| **P2 Served-version verification** | the bundle the browser runs was built from a named commit | nothing about whether a report can be produced |
| **P3 Generation** | the pipeline produced a document | nothing about the other R-checks |

---

## Part 1 · Publication

**P1 — publish the browser build.**
Lovable project `7976d60b-c277-4851-889b-c170285f4be2`
(`https://lovable.dev/projects/7976d60b-c277-4851-889b-c170285f4be2`) →
**Share → Publish**.

* Before pressing it, confirm the project's latest commit is the `main` you
  intend. The API reported `latest_commit_sha` `1dd8e1ce7…` before PR #2708;
  current `main` is `f42d8d6c5254d9830e77dc6971125d98bc4afd8f`.
* **Evidence:** screenshot of the publish confirmation, including the time.
* **This is a publication confirmation only.** `last_edited_at` is a sync
  timestamp, not a publication, and the Lovable API exposes no published-revision
  field — which is exactly why P2 exists.

**P2 — verify the version actually being served.**

The build stamps its commit into the bundle and writes the same value to a
static manifest (`vite.config.ts` → `buildVersionManifest()`; the id is
`VITE_BUILD_ID || VERCEL_GIT_COMMIT_SHA || GITHUB_SHA || COMMIT_REF`, else
`git rev-parse --short=12 HEAD`).

* **Action:** in the browser, open
  `https://command-centre.npcservices.com.au/version.json`.
* **Expected:** `{"buildId":"<first 12 characters of the published commit>"}` —
  `f42d8d6c5254` for the current `main`.
* **Evidence:** screenshot or the copied JSON, plus the commit you published.
* **Readings:** equal → the served bundle is that commit. Different → the CDN is
  still serving an older build; republish or purge. A value starting `t` means the
  builder had no git context and the commit cannot be identified from here; say
  so rather than inferring.

> This check cannot be performed from the engineering session: the origin answers
> **403 `cf-mitigated: challenge`** to that egress, including real headless
> Chromium. It needs your browser.

---

## Part 2 · The two subjects, and what the record actually holds

Retrieved from the programme record (`S5_HANDOFF.md` §2), not invented:

| | Annabelle | Pallas |
| --- | --- | --- |
| address | **18 Annabelle Crescent, Kellyville NSW 2155** | **262 Pallas Street, Maryborough QLD 4650** |
| price modelled | **$1,490,000** | **$575,000** |
| earlier report id | `9bd41c05-7f9b-41e8-819a-a029f4121369` | `3a4a3d9b-4d2d-4296-9e39-3fab0c2ae753` |
| earlier grade / score | F / 40 | C / 63 |
| coordinate | −33.7115485, 150.9586199 | not recorded here |

Mapped onto the four pre-generation tabs (`PreGenerationOverrides.tsx`):

| tab | field | Annabelle | Pallas |
| --- | --- | --- | --- |
| Property | Purchase price | **1,490,000** | **575,000** |
| Property | everything else (type, beds, baths, land, build, zoning…) | **not in the record — leave blank** | **not in the record — leave blank** |
| Financials | deposit / LVR / rate / term / loan type | **not in the record** | **not in the record** |
| Income | weekly rent, occupancy, expenses | **not in the record** | **not in the record** |
| Advanced | CPI, depreciation, tax, construction staging | **not in the record** | **not in the record** |

**Leave every unrecorded field blank.** The overrides are overrides: an empty
field means the pipeline researches or omits, and "absent is never zero" is the
rule the engine already enforces. Typing a plausible figure would make the
acceptance a test of invented inputs. The generator requires only a **property
address** and a **valid purchase price** — both of which the record supplies.

**The one thing worth deciding before you start:** whether you want the finance
tab populated. If the intended client scenario has a real deposit, rate and rent,
supply them and they become the accepted inputs for this run; if not, leave them
and the report will say what it cannot establish. Either is a valid acceptance —
but it must be the same choice for both properties, and recorded.

---

## Part 3 · How the five tiers are obtained

One parent generation per property. The other four are derived from it — this is
the existing workflow, and it is why ten PDFs need only **two** parent
generations.

| tier | route | model call |
| --- | --- | --- |
| **Investment Compass** | `generate-investment-report` — the parent | yes |
| **Financial Analysis** | `fork-investment-report` | **no** — composes deterministically |
| **Strategic / Due Diligence** | `fork-investment-report` | **no** |
| **Executive Briefing** | `condense-investment-report`, `targetTier: 'briefing'` | yes (16k max) |
| **Snapshot** | `condense-investment-report`, `targetTier: 'snapshot'` | yes (6k max) |

So the paid steps are: 2 parent generations + 4 condensations = **six model-calling
steps in total**. The four forks cost nothing. Do **not** start five independent
parent generations per property.

---

## Part 4 · R1–R12, as actions

Definitions are `S5_ISOLATED_RUN_REQUEST.md` §3, unchanged.

| check | action | expected | evidence |
| --- | --- | --- | --- |
| **R1 Generate** | Reports → Investment Report Generator; address + price; Generate. Let it run to completion including any resume. | a Compass report exists and completes | report id, start/finish times, screenshot of the completed state |
| **§4 conflicting case** | on one Compass, leave bedrooms/bathrooms blank while the listing material states counts | the document does not promote a listing assertion into a recorded property fact | the page where counts would appear |
| **R2–R3 Edit, save, reopen** | edit one section of a Compass and one of a Briefing; save; navigate away; reopen | the edit reads back unchanged; nothing regenerated | before/after screenshots + the edited text |
| **R4–R5 Template apply and change** | choose a template for the Investment format; reload; then change it and re-export | the choice survives reload; the alternative renders; content and history intact | picker screenshots both times, plus both PDFs |
| **R6–R7 Preview and export** | for each of the ten, compare on-screen preview against the exported PDF | export matches preview — every section, the final sentence, no truncation | the ten PDFs + preview screenshots |
| **R8–R9 Navigate, permissions** | walk the routes and the back button; confirm role/workspace limits | routes resolve, back works, limits hold in UI and server | screenshots of each route and of one refused action |
| **R10–R11 Historical compatibility, preserved edits** | open representative pre-existing reports, including any you had edited | legacy formats still render; pre-change edits survive, compared by content | screenshots of the legacy documents |
| **R12 Protected records** | note report content, scores and financial values on protected rows before and after the run | unchanged | the before/after values |

**An exported PDF alone proves R6–R7 for that document and nothing else.**

---

## Part 5 · Identifying the template that actually drew each PDF

This is a separate question from whether the master carries v15, and both are
asked per document.

**Which template was chosen** — available:

* the **template picker** shows the selection per (user, format), and matches the
  stored choice by `libraryLineage.entryId` + `entryVersion`. Screenshot it
  immediately before each export.
* the selection is stored per user and format, so it is the same for every tier
  of that format unless you change it.

**Whether that master carries v15** — not shown anywhere in the application.
`config.libraryLineage.releaseApplied` is the field that records it, and no
surface renders it. **Record that as unavailable rather than assumed.**

There is, however, a direct page-level test, because v15's changes are visible:

1. **The running head names the chapter.** A v15 master prints the current
   chapter in the running head (`{{narrative.chapters.N}}`). A master that did
   not receive v15 does not.
2. **The Contents page carries a companion note above the list**, saying where
   the rest of the analysis is. Exact sentences, per tier:
   * Compass — *"Purchase costs, yield, loan structure, cash flow and the
     ten-year projection are set out in the Financial Analysis Report for this
     property."*
   * Financial Analysis — *"The location case, the planning controls mapped over
     the land and the risk register are set out in the Investment Compass for
     this property."*
   * Strategic — *"The financial position is set out in the Financial Analysis
     Report for this property."*
   * Briefing — *"The full assessment is in the Investment Compass, and the
     financial position in the Financial Analysis Report."*
   * Snapshot — *"The location case is in the Investment Compass, and the full
     modelling in the Financial Analysis Report."*

Both present → the master that drew this document carries v15. Either absent →
it did not, which is a legitimate outcome for a master the refresh deferred, and
**must not be corrected by force-refreshing a customised copy**.

**The classification, stated exactly.** The refresh classified **16** active
adopted masters (`template_master_refresh_decisions`: absent → 16 rows, run #68).

* **Directly observed:** 16 classified; 543 baselines captured (run #67).
* **Derived, not observed:** `deferred_no_baseline` = 0 — the classification
  joins only published entries with a non-null schema, and a baseline was
  captured for every such entry.
* **PENDING:** the `already_current` / `refreshed` / `deferred_customised`
  split. It is in no log, and the query that yields it is in the refresh
  migration's own footer comment. Sixteen classified is **not** sixteen upgraded.

---

## Part 6 · The order to run in, and the spend

1. **P1, then P2.** Do not generate anything until the served version is known.
2. **The first Compass — 18 Annabelle Crescent — and stop.** Return it before
   anything else. It is the first of the ten, not an extra. I review it for a
   material input, research or rendering failure before the rest proceed.
3. On a clean first Compass: the two free forks, then the two condensations, for
   Annabelle; then the same five for Pallas.
4. Capture per document: submitted inputs, report id, generation start/finish,
   chosen template, and the exported PDF.

**Spend.** A$25 total, including paid retries. **A$0.00 spent.** Six
model-calling steps. Pause before the cap; do not re-run a generation to obtain
a better outcome.

**Preservation.** Test records only — `client_property_id` null, `generated_by`
null, no portal delivery, no client notification, retained for audit. Historical
reports and user edits are not to be modified.
