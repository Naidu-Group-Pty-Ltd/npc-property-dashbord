# Zoning, land and council data — one plan per Australian jurisdiction

Scoped 2026-09-06 against the live corpus and each jurisdiction's actual data
service. It supersedes the single-state sketch in
[`PROPERTY_ATTRIBUTE_ACQUISITION.md`](./PROPERTY_ATTRIBUTE_ACQUISITION.md),
which reasoned from NSW and asserted that "the other states publish
equivalents". They do not, and the differences decide the work.

## Where the business actually is

State resolved from `location_intelligence.coordinates`, which 1,112 of the
1,199 stored reports carry:

| jurisdiction | reports | share |
|---|---|---|
| **QLD** | 402 | 36.2% |
| **WA** | 347 | 31.2% |
| **VIC** | 207 | 18.6% |
| NSW | 115 | 10.3% |
| NT / other | 15 | 1.3% |
| SA | 11 | 1.0% |
| TAS | 9 | 0.8% |
| QLD/NSW border (Gold Coast–Tweed) | 6 | 0.5% |

**NSW is the smallest identifiable mainland state in this corpus.** QLD, WA and
VIC together are 86%. Any plan that starts with NSW starts with a tenth of the
business, and the first version of this scope did exactly that.

Note the resolution method. A state token (`NSW`, `VIC`, …) appears in only
about 30% of `property_address` values; adding a postcode-range fallback still
leaves 776 unresolved. The coordinate resolves 93%. **The router must be
geographic, not textual.**

## What each jurisdiction actually publishes

| | zoning source | statewide? | licence | commercial use |
|---|---|---|---|---|
| **VIC** | Vicmap Planning — Planning Scheme Zone Polygon (WFS/WMS, DataVic) | yes, standardised under the Victoria Planning Provisions | **CC BY 4.0** | **yes**, with attribution |
| **NSW** | ePlanning *Environmental Planning Instrument — Land Zoning* (ArcGIS REST, weekly) | yes | **CC BY** | **yes**, with attribution |
| **WA** | SLIP `Property_and_Planning` MapServer — layer **112** Local Planning Scheme Zones & Reserves (DPLH-071), layer **111** R-Codes, layer **48** Region Scheme | yes, where a Local Planning Scheme exists | SLIP public terms: *"only use this data for your personal and non-commercial use"* | **NO — blocked** |
| **QLD** | **none at state level.** Zoning is set by each local government's planning scheme | no | per council | per council |
| SA | Planning and Design Code (single statewide code since 2021) | yes | to confirm | to confirm |
| TAS | Tasmanian Planning Scheme (statewide standard zones) | yes | to confirm | to confirm |
| ACT | Territory Plan zones (single jurisdiction) | yes | to confirm | to confirm |
| NT | NT Planning Scheme (single scheme) | yes | to confirm | to confirm |

### Two traps worth naming

**QLD's state service looks like zoning and is not.**
`spatial-gis.information.qld.gov.au/.../PlanningCadastre/LandUse/MapServer` is
the *Queensland Land Use* layer, classified to the Australian Land Use and
Management Classification. It is land **use**, not planning **zone**. Bound to a
report it would print "agriculture" where the client needs "Rural Residential
Zone" from the council's scheme — a plausible, wrong figure, which is worse
than an absent one.

**WA's free service forbids the thing we do with it.** Layer 112 is exactly the
data required, and the public SLIP terms restrict it to personal,
non-commercial use, with reproduction and derivative works needing written
authorisation from the custodian. This platform renders commercial client-facing
PDFs. Free is not the same as usable, and this is the single most important
correction to the earlier scope.

### QLD is not a 77-council problem

Within the 402 QLD reports:

| region | reports | share of QLD |
|---|---|---|
| Brisbane / Moreton Bay / Ipswich | 160 | 39.2% |
| Sunshine Coast / Noosa | 93 | 22.8% |
| Gold Coast / Logan / Redland | 11 | 2.7% |
| Townsville | 9 | 2.2% |
| Central QLD | 7 | 1.7% |
| other QLD | 128 | 31.4% |

Roughly **62% of QLD volume sits in about four local government areas**, and
several of those publish their planning-scheme zone layers as open data. So the
realistic QLD path is: cover the handful of councils that carry the volume, and
disclose the rest — not attempt all 77.

## The rules this has to be built to

**1. The router is geographic, and bounding boxes are not good enough.** The
tables above were produced with rectangular latitude/longitude buckets, which is
fine for sizing a problem and unfit for deciding which government's law applies
to a client's property. Production must resolve jurisdiction by point-in-polygon
against an authoritative boundary, or by asking the candidate jurisdiction's own
service and accepting its answer. Six reports already sit on the Gold
Coast–Tweed border, where a rectangle gets it wrong.

**2. Two fields, never one.** Store the **verbatim** local code (`GRZ1`, `R2`,
`Low density residential`, `Residential R20`) *and* a normalised national
family (`low-density residential`). The verbatim code is what a conveyancer
checks and the only thing that is legally meaningful; the family is what lets a
client compare a Victorian report with a Queensland one. **The family must never
be printed as though it were the zone.** Zoning vocabularies are not comparable
across states — VIC's GRZ, NSW's R2, WA's R-codes and QLD's per-council names
are different systems, and silently harmonising them is how a report tells a
client something untrue.

**3. A spatial layer is indicative; the certificate is the instrument.** The Due
Diligence tier's value is telling a client what to verify and where. Each report
must name the jurisdiction's actual instrument — NSW s10.7 planning certificate,
VIC s.199 Land Information Certificate, QLD council planning and development
certificates, WA equivalents — rather than presenting a queried polygon as
settled fact.

**4. Licence is a gate, checked per source before a value is printed.**
`data_provenance.licence_tag` already exists for this. A value whose source
forbids commercial redistribution must not reach a client PDF, however
successfully it was fetched. WA is currently in that state.

**5. Coverage is disclosed, never inferred.** A jurisdiction with no usable
source says so on the page. The absent row is honest; a guessed one is not
(law 2).

**6. Overlays are separable from zoning, and QLD proves why.** Even where the
State publishes no zoning, it publishes hazard layers — QLD's
`spatial-gis.information.qld.gov.au` carries **FloodCheck** and historic flood
lines statewide. Flood, bushfire and heritage overlays drive more of a due
diligence conclusion than the zone code does, and they can be delivered on a
different schedule from zoning. Do not block the hazard work on the zoning work.

**7. Currency travels with the value.** Update cadence differs by source (NSW
weekly; VIC periodic; QLD per council). Every value carries `fetched_at` and is
rendered "as at" that date.

## Suggested order

Sequenced by *business volume against difficulty*, with the long-lead item
started first even though it lands later:

| step | jurisdiction | why here |
|---|---|---|
| 0 | **WA — licence** | Start immediately and in parallel: 31% of volume is blocked on a written authorisation or SLIP subscription, and procurement has lead time, not engineering. |
| 1 | **VIC** | 19%, CC BY 4.0, statewide standardised zones and overlays. The cheapest place to prove the architecture end to end. |
| 2 | **NSW** | 10%, CC BY, same shape as VIC. Confirms the multi-jurisdiction router on a second vocabulary. |
| 3 | **QLD hazard** | FloodCheck statewide, no zoning dependency. Delivers due-diligence value to 36% of the corpus without waiting for council aggregation. |
| 4 | **WA** | Build once the licence lands. |
| 5 | **QLD zoning** | The four council areas carrying ~62% of QLD volume, then disclose the tail. |
| 6 | SA, TAS, ACT, NT | 4% combined; each is a single statewide scheme, so each is small. |

Every step writes through `data_provenance` with source, confidence, licence tag
and fetch time — the envelope `cotality-service` already specifies — so the
report can state what it knows, how it knows it and when it last checked.

## What this does not change

Cotality remains the answer for verified property attributes, AVM, sales and
rental history. It is **not** the answer for zoning: its own scoping brief puts
planning at *"Cotality (partial) + state portals"* with a fallback of *"state
portals only"*. A signed Cotality licence would still leave this document's work
to do.
