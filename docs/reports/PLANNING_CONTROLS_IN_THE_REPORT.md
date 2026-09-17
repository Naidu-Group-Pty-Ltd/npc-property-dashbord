# Planning controls in the report

Read this before touching `_shared/planning/planningFacts.pure.ts`, the
`# Zoning & Planning Analysis` block in `generate-investment-report`, the
`planning` entry in `dataSources`, or `propertySpecs.zoning` /
`propertySpecs.councilArea`.

Companion documents: `ZONING_BY_JURISDICTION.md` records where each
jurisdiction's planning data comes from and how every endpoint was verified;
this one records what the **report** does with the answer.

---

## 1. The defect

`planning-data-service` has worked since 2026-09-06. It resolves the
jurisdiction from the layers themselves, returns the zone, the parcel, the
state development instruments and the DA activity, and says which of five
kinds of absence each empty cell is. `generate-investment-report` calls it on
every report with a verified coordinate and assigns the answer to
`enhancedData.planningData`.

The zoning **section** read none of it.

Measured on 262 Pallas Street, Maryborough QLD 4650 (report
`aa41bcec-5a5c-434d-9162-96deb50e9bdb`, generated 16 Sep 2026):

| question | answer |
| --- | --- |
| `property_specs.zoning` | null |
| `property_specs.councilArea` | null |
| zoning keys among the report's 25 manual overrides | 0 |
| `data_sources ? 'planning'` | false |
| the report's own stored coordinate | −25.5161079, 152.7074047 — correctly in Maryborough |

A live call to the deployed service at that report's own coordinate (pg_net
request 260612) answered `200` with `jurisdiction: QLD`, `parcel.status: ok`,
`lga: "Fraser Coast Regional"`, `locality: "Maryborough"`, `tenure: Freehold`,
licence CC BY 4.0, `zoning.status: not_served` (Queensland sets zoning in each
council scheme) and `developmentInstruments.status: none_at_point` — an
evidenced negative, not a gap. **The enrichment worked and the report
discarded 100% of it.**

What the reader got instead was the prompt's own furniture. The section was
101 lines of template carrying `[XX]%` site coverage, `[X]m` setbacks, `[XX]m²`
private open space, "Refer to LEP" for minimum lot size, height and floor space
ratio, and the sentence *"Check minimum lot size requirements (typically
450m²)"* — handed to a model with no source to fill any of it from. A model
asked for a control it has not been given supplies a plausible one. **450 m²,
8.5 m and 0.5:1 reached a client's document**, and nothing on the page told
them apart from a measurement. The template was also written for New South
Wales — Local Environmental Plan, Development Control Plan, a s10.7
certificate — on a Queensland property, where none of those instruments
exists.

---

## 2. The rules

1. **A control with no source is never a number.** Every cell is a value with
   a provenance or a named absence. There is no default, no "typical", and no
   bracketed placeholder for a model to fill. This is the rule the 450/8.5/0.5
   trio broke.
2. **An audited operator override outranks a layer, and says so.** A person
   who has read the certificate knows more than a spatial layer, so an
   override is never overwritten by an automatic reading — and it is labelled
   `operator_stated` rather than presented as a published control.
3. **A layer is indicative; the instrument settles it.** Every answer carries
   the jurisdiction's own verification instrument, and the section says on the
   page that this is desktop research rather than a planning certificate.
4. **The five absences are five different sentences.** `not_served` (the
   jurisdiction publishes no such dataset), `not_integrated` (no verified
   adapter), `licence_restricted` (the data exists and may not be
   republished), `none_at_point` (the service answered and nothing covers this
   point) and `unavailable` (the read failed). Collapsing them into "Not
   specified" is how "we did not look" comes to read as "there is nothing
   there".
5. **Adopted and draft never merge.** A control carries its standing, and a
   draft amendment is never reported as though it were in force.
6. **A zone that admits a use is not approval for it.** Development potential
   is described as conditional and subject to assessment, and no uplift is
   quantified.

---

## 3. What changed

`_shared/planning/planningFacts.pure.ts` is the one place that decides what a
report may state about planning.

- `buildPlanningFacts({ planningData, overrides })` folds the service's answer
  and the operator's audited overrides into one record: jurisdiction, council,
  locality, lot/plan, parcel area and basis, and a `PlanningCell` per control
  carrying `value | status | note | source | sourceUrl | licence |
  effectiveDate | retrievedAt | standing`.
- `renderPlanningControls(facts)` composes the client-facing table — Control /
  Reading / Standing / Evidence — plus the two paragraphs that qualify it
  (rules 3 and 6).
- `planningFactBlocks(facts)` is the prohibitions the prose beside it must
  obey. It deliberately does **not** repeat the readings: `planningStatBlocks`
  already puts the measured cells in the prompt and the table is handed over
  verbatim, so a third copy would give a model three versions of one fact to
  choose between.

In the generator:

- the eight `effectiveZoning*` constants are gone. They were computed from the
  overrides alone, at a point in the run **before a coordinate has been
  verified** and therefore before anything could have been retrieved — which
  is why a property whose zone the state's own layer would have answered
  printed placeholders instead.
- `property_specs.zoning` and `.councilArea` take the operator's record first,
  then what the jurisdiction's layer answered, then whatever the listing
  carried.
- `dataSources.planning` exists, carrying jurisdiction, council, zone status,
  source, licence, the layer's currency date, the verification sentence and
  the portal URL — so the coverage disclosure stops counting a source the run
  had already spent.

---

## 4. Queensland: what a council scheme can and cannot be read from

Queensland has no state-wide zoning layer; the zone is set in each council's
planning scheme. That is what `zoning.status: not_served` means, and it is
correct rather than a gap.

Measured 17 Sep 2026 from the production egress (pg_net; every request id is
recorded here):

| probe | request | result |
| --- | ---: | --- |
| ArcGIS Online search, "Fraser Coast zoning" | 261122 | 200 — the only Fraser Coast asset is `FCRC_Inundation_Zones`, published by the Queensland disaster-management org (`si70weKpzPSa0BGV`), not a planning scheme |
| that org's full catalogue, filtered for zone/planning/scheme/overlay | 261146 | 200 — evacuation and inundation zones for a dozen councils; **no planning-scheme zoning** |
| `eplan.frasercoast.qld.gov.au` | 261155 | **403** — the host exists and refuses a scripted client |
| ArcGIS Online, `title:(planning scheme zon*)` + Queensland | 261156 | 200 — **five councils publish a public planning-scheme zoning Feature Service**: Mackay, Moreton Bay (zones, dissolved zones and zone precincts), Burke Shire, Townsville and Sunshine Coast |
| Townsville's layer, queried at −19.2590, 146.8169 | 261206 | **200 with a feature** |

So Fraser Coast publishes no machine-readable scheme layer, and for 262 Pallas
Street `not_served` with the council named is the honest answer.

For the councils that do publish one, the endpoint shape is the same ArcGIS
point query the ACT adapter already uses, and Townsville's field names are
verified: `LVL1_ZONE` (`"Centre"`), `LVL2_ZONE` (`"Principal Centre"`),
`TCC_CODE` (`"PC"`), `LGA_CODE` (`7010`), with `GAZ_DATE` for currency.
Building `QLD_COUNCIL_SCHEME_LAYERS` — keyed by the cadastre's own `lga`, so
the council that answers the parcel query selects the scheme — is the next
step, and each council's field names must be verified by execution before it
is added, exactly as `planningSources.pure.ts` requires.

**One probing note worth keeping.** `services*.arcgis.com` answers `400 Bad
Request — invalid header name` to a pg_net request carrying a `User-Agent`
header, and `200` to the identical request without one. That is an artefact of
the probe tool, not of the endpoint: the edge functions use `fetch` and the ACT
adapter against `services1.arcgis.com` is verified working. Do not read a 400
from a pg_net probe as evidence that a council's layer is unreachable.
