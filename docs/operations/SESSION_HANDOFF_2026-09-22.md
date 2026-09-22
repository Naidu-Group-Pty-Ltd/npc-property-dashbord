# Session handoff — 22 Sep 2026

Written for whoever picks this up next. It records **state**, not recollection:
every number in it was read back from production or from an executed
measurement, and where something is unverified it says so in those words.

Branch: **`claude/vibrant-maxwell-h5na7d`**, head **`7f5e7d3`**, all pushed.
`origin/main` is at **`658211f`** (PR #2734, merged and deployed).

---

## 1 · Standing constraints — read these before doing anything

These came from the owner and are **still in force**. They are not
negotiable and they are not mine to relax.

- **No direct SQL.** `mcp__Supabase__execute_sql` is *not* approved. The two
  reviewed migration workflows — `apply-migration.yml` and
  `migration-drift.yml` — are the authorised route to the database, and a
  queued Lovable "Query Database" request was explicitly **not** approved.
  Reading production **logs** through the Supabase MCP (`query_logs`, project
  `dduzbchuswwbefdunfct`) is log inspection and *is* permitted.
- **Do not bypass access controls**, or substitute server responses, replay
  renders, or publication confirmations for application acceptance.
- **Record unperformed checks as BLOCKED or PENDING, never PASS.**
- **Do not substitute manually patched data, fixtures or stored-report replays**
  for a real measurement.
- **Do not request credentials, JWTs, service-role keys or internal secrets.**
- **Do not break existing functionality.**
- **Do not touch the builder portals, AML/CTF compliance, or agreements.**
- **Do not introduce new infrastructure or destructive migrations** without
  separate approval, and do not repeat completed template migrations.
- **Do not open a pull request unless the owner asks for one.**
- Authorised spend for the acceptance exercise is **A$25** including paid
  retries; track it and pause before exceeding it.

The owner's standing brief: *take full ownership of the programme, think
outside the box, and always keep in mind the end user receiving the report —
the quality and presentation, and how content is placed within the report so a
client can read it easily.*

---

## 2 · What shipped, and what is live

**PR #2734 is merged (`658211f`) and deployed.** The deploy was confirmed by
**effect**, not by the green tick: the live `generate-investment-report` bundle
was read back (2,734,595 bytes) and grepped.

| probe | live bundle |
| --- | --- |
| `compass.infrastructure` / `compass.supplyPipeline` ids | 1 each |
| `includeInCompass: true` | **16** (was 14) |
| distinct `compass.*` section ids | **17** (was 15) |
| `sectionPriority === 'Protected'` (derived set) | present |
| `finiteOrNull` | 9 call sites |
| `=== null ? null : Number(` — the guard that printed `$NaN` | **0** |

### W2.2 — the Compass has a section for what it retrieves

`Infrastructure and Growth Context` (ordinal 5) and `Competitive Landscape and
Supply Pipeline` (ordinal 12) are now sections the generator authors.

**The finding worth keeping**: W2.2's stated acceptance was satisfiable
*without the generator writing a word*. All three criteria are statements about
`sectionRegistry.pure.ts`, and the generator reads `compassSectionRegistry.ts`.
The only pin joining them asserted `compassSections() ⊆ sectionsForTier('compass')`
and said nothing about the other direction. `compassUnmergedSections.spec.ts`
closes it, on the **set** and on the **order**.

Three pre-existing defects fell out: `Supply & Development Pipeline` was
claimed by two sections at once; four sections declared
`sectionPriority: 'Protected'` while `PROTECTED_SECTION_IDS` (which
`compassPostProcessor` actually reads) omitted them — `compass.planningConstraints`
among them; and `theCountThatDecidesCompletion.spec.ts` restated a number the
product derives, in the file named for that defect.

### The `$NaN`, and the sweep after it

Rendering the new Supply block against the register's real depth printed
`$NaN`. The sweep found **the rule written four times, two of them wrong** —
`salesRegisterRead` (the register the Growth dimension is scored from) and
`rba-data-service` (`target_percent` *is* the cash rate this product prints).
One shared `finiteOrNull` now. The unpredicted half: `Number('')` is **0**, so
a median suppressed because thirty or fewer sold would have read as **$0**.

### On the branch, not yet merged (3 commits)

- `ced35d9` — two stale statements in the programme doc corrected; §9's open
  question narrowed.
- `2ce539d` — `compassFitsItsPageAllowance.spec.ts`: nothing connected the
  registry's word budget to the master's `NARRATIVE_PAGES`. It fits — 19 of 40
  at the declared ceiling, 35 of 40 at the renderer's own maximum.
- `7f5e7d3` — **`{{bars:}}` clipped the start of a long label off the left edge
  of the SVG.** Real defect, real string: the approvals register's
  `other residential dwellings (townhouses, units and apartments)` (62 chars)
  was drawn from **x = −73.7** in a `0 0 760 134` viewBox. Fixed by wrapping
  into the column and growing the row, byte-identical where nothing needed
  wrapping.

---

## 3 · Live production state — the ABS approvals register

`market_building_approvals` **deepens itself hourly** and is doing so right
now, unattended. Confirmed by effect over four consecutive cron ticks.

| | 08:59 | 09:24 | 10:24 |
| --- | --- | --- | --- |
| rows | 4,934 | 19,736 | **34,538** |
| periods | `2026-07..2026-07` | `2026-04..2026-07` | `2026-01..2026-07` |
| distinct SA2s | 2,458 | 2,458 | 2,458 |

Subsequent planner choices, from `function_logs`:

```
11:20:01  page=0 2025-10→2025-12  frontier=2026-07
12:20:04  page=0 2025-07→2025-09  frontier=2026-07
```

So `oldest` was **2025-07** after the 12:20 tick, moving back exactly
`APPROVALS_PAGE_MONTHS` (3) per hour, and the frontier is **not** re-read —
that is the cadence rule working (one frontier read per calendar month).

### THE ONE PENDING MEASUREMENT

The floor is `REGISTER_FLOOR_PERIOD = '2023-01'`. From `2025-07` that is **30
months = 10 more ticks**, so the walk should reach the floor at about
**22:20 UTC on 22 Sep** and the *next* tick (~23:20) should report
**`settled`** — writing a `market_sales_sync` row and asking the ABS nothing.

**That `settled` verdict has never been observed.** It is the other end of the
guarantee and the only part of this register still unverified. To check it:

```
# 1. the planner's own words
mcp__Supabase__query_logs, source='function_logs',
  event_message like '%approvals%'      # expect: no ABS window, or a settled note

# 2. the register's own edges — via apply-migration.yml on main
supabase/migrations/20261215020000_approvals_grain_read_back.sql
# then read postgres_logs for APPROVALS_READBACK
# expect: periods [... 2023-01..2026-07 ], ~148,000 rows, 2,458 distinct SA2s
```

The read-back migration **writes nothing** — one read and one `RAISE WARNING` —
so it is safe to apply any number of times. `record_version: false`.

**If it does NOT settle** and keeps asking the ABS below 2023-01, that is a
real defect in `planApprovalsWork`'s rule 4 and worth hunting.

### What the Supply section reads today

At four of twelve months loaded, `windowOf` reports `floor: true` and
`summariseApprovals` returns `changePct: null`. Once the register passes 12
months the FLOOR qualification drops; at 24 months the year-on-year comparison
becomes available. **Nothing needs changing for either** — both are derived
from what is held.

---

## 4 · Open questions, with their exact state

### The land-use register: five rows where the code says thirteen

`A_PREMIUM_DOCUMENT.md` §9. **Narrowed from four candidate explanations to
one**, by execution through the real composer:

- Dead: *"the list was shorter then"* — `SECONDARY_RESIDENTIAL` has had twelve
  entries since the file was created (19 Sep), a day before the render, with
  the group branch and its sentence in the same first commit.
- Dead: *"the two copies were composed separately"* — `renderPlanningControls`
  is composed **once** and the same string is both pinned and appended.
- **Recorded as wrong because it nearly shipped as a settlement**: that page 33's
  table ends at `Dual occupancies (detached)` is *not* evidence of the five-row
  shape. That use is item 4 of the module's own order and the first four
  secondary rows read identically in both shapes, so a truncated thirteen and a
  complete five end on the same line.
- What is left is the bundle deployed at that render, and **that evidence is
  gone** — the function has been redeployed twice since.

It is therefore a **pending measurement with a trigger**: the next delivered
Compass for a property whose land use table prohibits *Residential
accommodation* as a group shows which. Nothing is built on either answer.

### W3.5 — Demand scoring in ACT/NT/TAS/WA

Settled for three of four by measurement: **no sub-state count of residential
sales is published**. Only Tasmania is unresolved and the reason is ours —
`data.tas.gov.au` does not resolve from this egress. No register to create, no
approval to seek.

---

## 5 · How to verify, and where the environment lies to you

```
npx vitest run src/lib/reports                  # ~150s, 7,604 passing
npx vitest run src/lib/reportDesign             # 1,001 passing
node scripts/security/check-edge-column-names.mjs
npm run templates:library:seed:check            # seed-drift gate
```

Three environment gaps that are **not** code defects — do not chase them:

1. **`xlsx` does not resolve.** It is declared in `package.json` as a CDN
   tarball that this sandbox did not fetch, so **11 test files fail to
   collect**. CI installs it. Affected: `ciAssessment/intakePack/*`,
   `excelImport`, `AddClientModal`, `ExcelImportTab`, `sanctionsIngest`,
   `dfatParserParity`, `AmlConfiguration`, `intakePackDownloads`.
2. **Two specs time out at vitest's 5s default under full-suite parallel load**
   (`edgeColumnSchema.spec.ts`, `registrySeedWrite.spec.ts`) — they read 1,000+
   migrations. Both pass in isolation, 31 tests.
3. **Two specs fail on unmodified `origin/main`** — `brandDesign/import.spec.ts`
   and `security/manageClientDataStandalone.spec.ts`. Proved pre-existing in a
   clean worktree; they are not yours.

**`check-edge-functions.mjs` cannot be run locally** — it needs Deno, which is
not installed. Record it as **BLOCKED, never PASS**. CI runs it.

---

## 6 · Corrections I made — do not re-make them

Three, and each cost real time:

1. **I claimed a settlement of §9's open question that the evidence did not
   support**, from the terminal row of a table. Corrected above.
2. **I raised a false alarm that the Compass no longer fit its page
   allowance** — 40/41 pages against a 40-page master. It came from packing
   with `packMarkdownPages` on the default charge model. **Production resolves
   the calibrated narrative profile and packs with `packNarrativePages`**, and
   the calibrated model measures 95 characters a line where the legacy one
   assumes 65 — a third's difference. The real figures are 18 and 19 of 40.
   `compassFitsItsPageAllowance.spec.ts` now asserts the *instrument* first:
   the profile must resolve **and** be `measured`, because a silent fall back
   to legacy would be the same wrong measurement wearing a passing tick.
3. **I announced "seed v20" before the gate answered** — it was a v19
   regeneration, because v19 is still unapplied.

The rule all three are instances of, and the one this programme keeps paying
for: **an instrument that can fail the way its subject fails is not an
instrument.** Check what production actually calls before measuring with
something that merely looks like it.

---

## 7 · Where the programme stands

Everything in `REPORT_PRESENTATION_PROGRAMME.md` that needs no new
infrastructure is closed. W1.1, W1.3, W1.4, W2.1, W2.2, W3.1 and W3.6 are done;
W1.2, W2.3, W2.4, W4.2, W4.3 and W4.4 are withdrawn or answered on measurement;
W3.2–W3.5 were each answered by measuring a publisher rather than by building.

Three decisions the plan deliberately does **not** take, all the owner's:
whether the 21 `market_sources` rows are seeded; whether the nine pre-19-Sep
reports are regenerated (**the owner has said no**); and whether Risk can ever
score — it needs a construction year, held on 0 of 1,230 stored reports, and
`propertyRiskSchema.pure.ts` forbids manufacturing it. **Four of five scored
dimensions is the honest ceiling.**

### Suggested next steps, in order

1. **Read back the `settled` verdict** (§3). Cheap, and it is the last
   unobserved half of a guarantee this branch spent a day building.
2. **Decide whether the branch's three commits go to `main`.** They are
   independent of each other and all are additive plus one real renderer fix.
   *No PR has been opened — that is the owner's call.*
3. The register passes 12 months of history around 18:20 UTC and 24 months
   around 06:20 on 23 Sep; after that the Supply section can state a
   year-on-year change. Worth **looking at a delivered document** then — which
   would also settle §9's pending measurement if the property is in NSW.

---

*Every figure here was read back from production or from an executed
measurement at the time of writing. Nothing in it is an estimate presented as
a reading.*
