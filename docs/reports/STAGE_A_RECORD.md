# Stage A — what was built, what was measured, and what is not yet true

19 September 2026. Branch `claude/reporting-engine-audit-4850hs`, PR #2700.

Stage A asked for one complete, freshly researched Cowra Compass produced by
the candidate's real acquisition and composition paths, with substantive
zoning/planning and infrastructure chapters, reconciled claims and improved
headings; plus a concise evidence record and the completed five-format
ownership matrix — and to **clearly distinguish any retained-data replay from
fresh generation.** This is that distinction, stated first.

---

## 1. What is fresh, what is composed, and what is not yet possible

| | State | Why |
|---|---|---|
| **The research** | **Fresh.** Retrieved 19 Sep 2026 by execution from the production egress. | 38 NSW planning layers asked explicitly by id; the cadastre; the address point; the instrument's land use table; three dated Health Infrastructure pages. Every URL is in the evidence record and every answer is reproducible. |
| **The two chapters** | **Composed by the production modules, from that evidence.** | `scripts/verify/cowra-chapter-demo.mjs` runs `buildPlanningFacts` → `renderPlanningControls` → `planningFactBlocks` and `projectsNear` → `renderPublishedProjects` → `publishedProjectRules`. The output is `COWRA_REBUILT_CHAPTERS.md`. It is what the chapter will contain. |
| **A fresh end-to-end generation** | **Not yet possible, and saying otherwise would be false.** | The acquisition runs in deployed edge functions. These changes are on an unmerged branch, so a generation today would run the OLD deployed code — which is precisely the code that never asked the planning register for this property. Stage C's merge and deploy gates are what make a generation fresh. |

**No report row was written, regenerated or modified.** The stored Cowra
record is untouched; nothing here overwrites an issued report or a customer
edit. A$0.00 of the A$25 test budget has been spent.

---

## 2. The finding that changes the document

The report describes 48 Redfern Street as sitting "within Cowra's core
residential belt". The register says the land is zoned **E3 Productivity
Support** — an employment zone — uniformly across the whole of Lot 19, at the
centroid and at all four corners.

Read from the zone code alone that is a house in the wrong zone, and a
reasonable person concludes the dwelling survives on existing-use rights. The
instrument's own land use table says otherwise, and says something sharper:

- **Dwelling houses** is named at item 3 — *permitted with development
  consent*. The house is a permissible use, not a legacy one.
- **Residential accommodation** — the group term covering secondary dwellings,
  dual occupancies, multi dwelling housing, attached dwellings, seniors
  housing and the rest — is named at item 4, *prohibited*. So **no additional
  dwelling may be put on that 991 m² block at any size.**

Neither reading is available from the zone code. The first would have been
stated wrongly; the second is exactly the inference the standard forbids
drawing from block size — *"a large block alone does not establish subdivision
or secondary-dwelling potential"* — settled here in the other direction by the
instrument itself.

The zone's own objectives name the street: *"To ensure commercial development
in the Redfern Street area … does not detract from the core commercial
functions of the Cowra central business district."*

---

## 3. Why the old report had none of it

`data_sources` on the stored row has **no planning key at all** — not a null, no
key. The generator's planning fetch is guarded on
`enhancedData.locationIntelligence?.coordinates`; the location enrichment
produced nothing; the call was skipped silently, with no error and no log line.
The document then printed planning content anyway, from the prompt template.

That guard is one instance of a general defect. `data_sources` is composed as
`enhancedData.X ? stamp : null` under a comment reading *"A null is a fact ('we
asked and got nothing'), never an error"* — and the code cannot support it. Six
producers were null on the Cowra row beside `errorsEncountered: 0`.

---

## 4. What shipped

| # | Change | Verified by |
|---|---|---|
| 1 | **The evidence contract removes rather than tabulates.** An unsupported share or series leaves the client document and is returned on `findings` as the audit record. A supported dataset a chart cannot render still falls back to a table. | Measured on the real Cowra record: gauge 3→0, wheel 1→0, margin 1→0, pictograph 1→0, donut 3→1, bars 7→4; glance/tiles/timeline untouched; prose byte-identical. 23 specs. |
| 2 | **The acquisition ledger.** Five outcomes per producer — answered, never requested, requested and failed, retrieved and not bound, unavailable in coverage — recorded at every acquisition site and persisted on `data_sources._acquisition`. A producer nobody accounted for is named in `unaccounted`. | 16 specs, including source-level assertions that the planning guard records its skip and that the ledger is built after the late fetches. |
| 3 | **The instrument's land use table.** Retrieved for NSW, read for what it says about living on this land, rendered with the reading and the neighbouring uses. The specific-over-general rule is applied in exactly one direction. | 15 specs against the real Cowra answer, duplicates included. |
| 4 | **The published project register.** Major public projects recorded from their publisher's own dated pages, labelled as recorded rather than retrieved. One project, one investment figure; stages carry no amount, by construction. | 22 specs. |
| 5 | **The running head names the chapter.** Derived from the same packing that decides the page breaks, estimated by the projection and overwritten by the renderer's pre-pass. "The report" heading deleted. | 13 specs. |
| 6 | **`Agriculture-dominat…` fixed.** `fitLines` broke on whitespace only, so a hyphenated compound was one token that never wrapped. It breaks after a hyphen or slash between letters now — never between digits. | 6 specs. |
| 7 | **The five-format ownership matrix**, generated from the registry with a spec that fails on drift. | 5 specs. |
| 8 | The register's own denominator error corrected (§7a). | — |

Gates at each commit: `npx tsc --noEmit` clean; `check-edge-functions.mjs`
334/334 baseline, no new errors; `check-edge-column-names.mjs` clean; the
reports suite green.

---

## 5. What Stage A did not close

Stated plainly rather than left to be discovered.

1. **No fresh end-to-end generation** — see §1. It needs the deploy.
2. **`npm run templates:compass:qa` did not complete** inside the windows
   available here (it renders all 500 masters in Chromium). It is not reported
   as passing. It must run to completion before merge.
3. **The remaining §2 claims** — the "7 in 10" transaction claim, the
   population statements around the removed chart, and the bedroom / bathroom /
   renovation contradictions — are prose defects in the STORED document. The
   chart contract removes the unsupported visuals; the prose versions need the
   regeneration that §1 says is not yet possible. They are not fixed and are
   not claimed to be.
4. **Cowra Shire Council's capital works programme, its DA register and its
   Development Control Plan** were not retrieved. The infrastructure register
   states that limitation on the page.
5. **`legislation.nsw.gov.au` refuses this egress** — a Cloudflare managed
   challenge on the HTML view, the PDF and the XML export alike, and again from
   headless Chromium. Any future feature needing instrument text must go through
   the Planning Portal's structured services.
6. **Seed regeneration.** The master changes (running head, narrative box) are
   in `scripts/template-library/`; `npm run templates:library:seed` has not been
   re-run, so the seeded catalogue still carries the old furniture.

---

## 6. Where the evidence is

| Document | What it holds |
|---|---|
| `COWRA_EVIDENCE_RECORD.md` | Every fact, its source, retrieval date, publisher's currency date, geographic scope and material limitation. Including what was asked and is not there. |
| `COWRA_REBUILT_CHAPTERS.md` | The two chapters as the production modules compose them. |
| `SECTION_OWNERSHIP_MATRIX.md` | 40 topics × 5 formats: producer, full-detail owner, permitted summaries. |
| `COWRA_VISUAL_REGISTER.md` | The 21-row visual register, with §7a correcting its own denominator error. |
