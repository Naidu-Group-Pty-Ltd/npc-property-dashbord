# Acquiring the property attributes the reports are built to show

Scoped 2026-09-06, against the live database and the code as it stands. Every
number here is measured, not estimated.

## The problem

`property_specs` carries nine attributes and `reportBindingProjection` publishes
all nine to every template. Across **all 1,199 stored reports**:

| attribute | reports with a value |
|---|---|
| `property_type` | 1,071 |
| `bedrooms` | 651 |
| `bathrooms` | 633 |
| `parking` | **0** |
| `year_built` | **0** |
| `building_size_sqm` | **0** |
| `land_size_sqm` | **0** |
| `council_area` | **0** |
| `zoning` | **0** |

`propertyIdentity` is a **spine** section — mandatory in every tier — so this is
law 2 ("a labelled row is a promise that a figure follows it") failing at the
data layer, where no template or assembly work reaches it.

The obvious conclusion is that the platform needs a property-data vendor. That
conclusion is wrong for two thirds of it.

## Finding: four of the six are already collected

The manual inputs panel (`components/reports/manual-inputs/PropertyTab.tsx`)
asks for land size, build size and car spaces, and operators fill it in. Those
answers land in `manual_overrides` under **different spellings** from the ones
`property_specs` uses, and nothing ever copied them across:

| attribute | in `manual_overrides` | keys used | in `property_specs` |
|---|---|---|---|
| land size | **150** | `landSizeSqm`, `landSize` | 0 |
| build size | **145** | `buildSizeSqm`, `buildSize` | 0 |
| car spaces | **155** | `carSpaces` | 0 |
| construction year | **29** | `constructionYear` | 0 |
| zoning / council | **0** | — | 0 |

Two real examples: report `6d1157e0` (28 Bligh Street, Muswellbrook) holds
`landSizeSqm: 771` in overrides and `land_size_sqm: null` in specs; `c15ce1b0`
(6 Acer Court) holds 1,922 m² land, 253 m² build and 2 car spaces, and rendered
all three blank.

**Fixed.** The binding projection now reads overrides as a third source behind
`property_specs` and the finance run's own copy — healed on READ, the way
`reconcileStoredFinancials` heals the financial fold, so no stored row is
rewritten and every report already issued gains the figure its operator
supplied. Precedence is by source, so a real stored spec always wins. Pinned by
`propertySpecsHealing.spec.ts` against those two production rows.

That leaves **zoning and council area** as the only true acquisition gap.

## What exists today

- **Cotality (CoreLogic)** — `cotality-service` is scaffolding. Every branch
  returns `{ source: 'modelled', confidence: 0.3 }`. `COTALITY_API_KEY` is
  unset, `data_provenance` holds **0 rows**, and the usage log shows **0 calls**
  ever. The scoping brief (`docs/integrations/cotality-scoping.md`, 2026-05-26)
  is still at "outbound enquiry sent". Its own branch table puts planning/zoning
  at *"Cotality (partial) + state portals"* with a fallback of *"state portals
  only"* — so even a signed Cotality licence does not settle zoning.
- **Domain** — `domain-data-service` exists and calls exactly one endpoint,
  `suburbPerformanceStatistics` (suburb-level, not property-level). **0 calls**
  logged.
- **Coordinates** — `location_intelligence.coordinates` holds real lat/lng on
  **1,112 of 1,199** reports (93%), e.g. `{lat: -28.2273893, lng: 153.5453605}`.
  This is the asset that makes the cheap option viable.

## The three options, cheapest first

### 1. Free government spatial services — recommended first

Every state publishes land zoning as a public, point-queryable spatial service.
NSW's is an ArcGIS REST MapServer under
`mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/…`, published via
Data.NSW as *Environmental Planning Instrument — Land Zoning*; VIC, QLD and the
others publish equivalents (Vicmap Planning, QLD Spatial). No licence fee, no
API key for the open layers.

We already hold the coordinates, so the work is a point-in-polygon query per
property, not an address-matching problem. Local government area comes from the
same family of boundary services.

**Cost:** engineering only. **Caveats to confirm per state:** attribution and
licence terms for re-publishing a zone code in a client PDF; rate limits;
currency of each layer; and that the eight jurisdictions are done one at a time
rather than assumed uniform. Coverage is bounded by the 93% that have
coordinates, and the 87 reports without them need geocoding first (Google Maps
is already wired — 1,506 calls logged).

### 2. Domain API property endpoints

Domain sells property-level attribute lookups beyond the suburb statistics we
already call. Useful for *land size, build size, year built and parking without
asking an operator to type them* — i.e. to raise the 150/145/155 to something
near 1,199. It does not solve zoning.

**Cost:** per-lookup, commercial terms. The key is already forwarded by Mission
Control, so metering is in place (`domain` is mapped in
`apiUsageBilling.pure.ts`); a clone's calls bill the prime.

### 3. Cotality (CoreLogic)

The existing brief's plan: verified attributes, AVM, sales and rental history,
Cordell build costs, demographics, climate risk. Enterprise licence, and the
volume forecast in that document is 2.4k–4k calls/month at launch.

This is the right answer for branches 1–4 and 6–7 — and by its own scoping table
**still not the answer for zoning**, which stays a government feed.

## Recommendation

1. **Done** — the read-path heal, which puts land size, build size, car spaces
   and construction year onto 150-odd reports today at zero cost.
2. **Next, if wanted** — NSW zoning + LGA from the free spatial service, keyed on
   stored coordinates, behind `data_provenance` so every value carries its source
   and confidence exactly as the Cotality scaffolding already specifies. One
   state first, to prove the shape, then the rest.
3. **Only then** — decide Domain vs Cotality on the *attribute* question, which
   is a commercial call about how much operator typing to remove, not a
   correctness one.

The sequencing matters: options 2 and 3 are procurement, and option 1 was a bug.
Doing them in the other order would have paid a vendor for data operators had
already entered.
