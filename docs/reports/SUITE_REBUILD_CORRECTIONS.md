# Owner corrections to the suite rebuild — the ledger

Corrections issued 17 September 2026 after accepting S1's visual direction.
Each is tracked to the stage that closes it. Nothing here restarts the audit or
the redesign; the staged plan is unchanged.

**Status key** — `done` (closed in this repository, with a test),
`open` (accepted, scheduled), `evidence` (closed by a measurement rather than a
code change).

---

## C1 · The two design decisions, confirmed

| | |
| --- | --- |
| **C1.1** Weekly holding position, loan amounts, repayments and financial modelling stay off the Compass cover, and keep their presentation in Financial and the other approved outputs. | **done** — the S1 cover carries none; `TIER_FRAMEWORK.md` § Decision E already governs the split, and the Financial tier is untouched. Re-pinned when the Financial fixture lands in S5. |
| **C1.2** Replace internal engineering remedies with concise, accurate client-facing explanations and actions. Authorised editorial interpretation of the evidence; not permission to invent facts. | **open · S3** — S1 withheld the stored remedies rather than rewriting them, which was the conservative reading. The authorised treatment is a client-facing sentence per gap, written from the evidence. |
| **C1.3** Distinguish work for the report provider from due diligence for the client or a professional. Remove "nothing for the reader to do". | **open · S3** — the sentence is on S1 page 3 and is wrong: a screening gap the provider closes and a certificate the buyer orders are different obligations, and the page currently implies the second does not exist. |

## C2 · Assessment presentation

| | |
| --- | --- |
| **C2.1** Distinguish performance on measured criteria, evidence coverage, any evidence-limited grade, and whether the evidence supports an overall conclusion. The cover reads `F · 40` as "assessment performance" while page 3 says the composite would be `C`. | **open · S3** — four readings, four labels. `F · 40` is the **evidence-limited grade**, `C` is the composite on measured criteria, `57%` is coverage, and "no overall conclusion" is the fourth. The cover currently labels the first as the second. |
| **C2.2** Do not change scoring formulas, thresholds or financial assumptions to solve a presentation problem. | **honoured** — S2's repair restores an input the engine already asked for; no weight, threshold or formula is touched, and `scoringV2Production.pure.ts` is unmodified. |
| **C2.3** Move the nominal-points explanation out of the evidence-coverage display or label it separately. Explain effective weights and rounding. | **open · S3** — "Composite points delivered, of 100 available" is a different quantity from "share of the method measured" and should not share a bar group. Effective weights (57/21/21% on this record) are renormalised over the measured dimensions and that is not said anywhere. |
| **C2.4** All values and conclusions bound to the actual assessment; do not hard-code one property's coverage or preliminary conclusion into reusable templates. | **open · S3** — `s1Pages.mts` is a review composition, not a template, and every figure on it is read from the row; but the conclusion sentence and the `57%` prose are authored strings and must become bindings before any master carries them. |

## C3 · Transport semantics

| | |
| --- | --- |
| **C3.1** Establish whether the stop list is sampled, what each count measures, the radius, pagination and duplicate handling — do not assume eight and 117 contradict each other. | **evidence · done** — traced and written up in [`S2_LOCATION_EVIDENCE_TRACE.md`](./S2_LOCATION_EVIDENCE_TRACE.md) § 3. They do **not** contradict: 117 is every grouped place within **1,600 m**, eight is the nearest-eight sample the record names. S1's note asserting a contradiction was wrong and is corrected. |
| **C3.2** An empty category in one source beside recorded stops in another may indicate differing coverage. | **evidence · done** — differing **definition**, established: the amenity register's `transit` category is four OSM tags (`railway=station|halt|tram_stop`, `public_transport=station`) within 2,000 m and matches no bus stop, so `0` is a true statement about rail and tram stations and says nothing about buses. |
| **C3.3** Label distance measurements accurately; remove walking and car-trip claims the route evidence does not support. | **open · S3** — every distance on these pages is straight-line (haversine), from both registers. No walking route is measured anywhere in this platform. |

## C4 · Infrastructure wording and the research commitment

| | |
| --- | --- |
| **C4.1** Replace "is not funded" / "is not under construction" with wording that says those statuses are **not established by the current evidence**. | **open · S3** — the present wording asserts a negative the DA register cannot support. |
| **C4.2** A determination must not imply a delivery date or funding position. | **done** — the page places nothing on a horizon and says why; retained. |
| **C4.3** Keep retrieved records, confirmed applications and distinct projects distinct until identifiers establish their relationships. | **done** — the three Norwest rows are flagged, not merged, and counted as applications. |
| **C4.4** The wider ten-year research deliverable remains outstanding, with the agreed source coverage and property relevance. | **open · S4** — unchanged from the staged plan. |

## C5 · Risk interpretation

| | |
| --- | --- |
| **C5.1** Do not rate exposure `Low` because a desktop layer returned no mapped feature; use an undetermined status. | **open · S3** — the environmental row is exactly that and must read `Not established`. |
| **C5.2** `Verified` must name **what** is verified, without implying the property-risk assessment is settled. | **open · S3** — "Verified" against a mapped control and against an LGA application count are different claims and both are currently one word. |
| **C5.3** Correct the FSR explanation: floor space ratio is total floor area to site area, not building footprint. | **open · S3** — the current sentence says "footprint", which is site coverage, a different control. |
| **C5.4** Remove "ordinary pre-contract work"; correct "four of the five carry an outstanding check" — the table gives an action for all five. | **open · S3** — both are in one sentence on page 6. |
| **C5.5** Retain the exposure / evidence-confidence separation. | **done** — retained. |

## C6 · Client-facing treatment

| | |
| --- | --- |
| **C6.1** Internal field names, namespaces, implementation details and engineering remedies belong in the review notes, not the report. | **open · S3** — `stopsWithin1km`, `RF-7.2B` and the provisional chips' vocabulary are all on the S1 pages by design for review, and none may survive into a client document. |
| **C6.2** Concise source, date and measurement-method references on the page; detailed provenance in the appendix. | **open · S3**. |
| **C6.3** Use the selected template's typography and colours consistently, including the risk components. | **open · S3** — the rating and confidence chips are a fixed palette in `_chips.html.ts` (S1 defect D5). |
| **C6.4** Treat the prototype's parent-report page references as provisional; verify contents destinations, pagination and bookmarks through the actual template workflow. | **open · S3** — already chipped provisional on page 2. |

## C7 · Content completeness and integration

| | |
| --- | --- |
| **C7.1** Fitting on the page does not prove content survived; verify completeness alongside overlap and footer clearance. | **open · S3** — the decision-box truncation (S1 defect D6) is the proof. The measurement harness must gain a content-conservation check: what went in comes out. |
| **C7.2** Implement the approved treatment in the existing shared rendering path so it reaches user-generated reports. | **open · S3** — `s1Pages.mts` is a review composition and reaches no user. |
| **C7.3** Address the reported accessibility defects and validate the affected outputs; keep conformance claims to what is verified. | **open · S3** — S1 defect D7: the `image` block emits no `alt`, the route declares `pdf/ua-1`, and the service fails on engine warnings only under `strict`. |

## C8 · Programme

| | |
| --- | --- |
| **C8.1** Proceed with S2; track these against S2, S3 and S4. | **done** — this ledger. |
| **C8.2** CGR, pre-generation inputs, accepted assumptions and the Cash Flow connection unchanged; preservation gate maintained. | **honoured** — gate green at 18 of 18 after every change in S2. |
| **C8.3** Continue delivery across Compass, Financial, Strategic, Briefing and Snapshot; S1's design acceptance does not close implementation, suite verification or production release. | **open · S3 – S6** — unchanged. |
