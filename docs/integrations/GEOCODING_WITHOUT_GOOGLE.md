# Geocoding without Google

**Status: built 16 Sep 2026, on branch `claude/adoring-hopper-g02tdt`.**
Production proof is recorded in §9 as it is obtained; until the migration is
applied and the functions are deployed, every claim below about production is a
claim about the code.

Read this before touching `supabase/functions/_shared/geocode/*`,
`google-places-autocomplete`, the geocode step in `estimate-capital-growth`,
`resolve-listing-coordinates`, `location-intelligence-service` or
`parse-property-pdf`, or the `geocode_cache` table.

---

## 1. What went wrong, and the decision

Every server-side geocode in this product was a direct call to Google's
Geocoding API under one key. On **12 September 2026** that key began
answering `REQUEST_DENIED` to every request — 25 refusals after 15 successes
that day, 22 on the 14th, 139 on the 15th (`api_usage_log`, service
`googlemaps`) — and it has not answered since. Four surfaces went dark at
once, each reporting it differently:

| Surface | Symptom |
|---|---|
| Listings map (`resolve-listing-coordinates`) | Pins stopped appearing for any listing without a cached coordinate. |
| Investment report location intelligence (`location-intelligence-service`) | `geocoder_unavailable`; every Places Nearby and Distance Matrix call went quiet with it, because each begins with a geocode. |
| PDF import (`parse-property-pdf`) | Addresses stayed incomplete — no suburb, state or postcode filled in. |
| Estimate CGR (`estimate-capital-growth`) | Fell back to parsing the typed text: "the geocoder answered REQUEST_DENIED". |
| Address field (`google-places-autocomplete`) | `502 upstream_error` on every keystroke (pg_net 246932, 16 Sep). |

The remedy was in the Google Cloud console, and the owner's decision was that
the product must not depend on that console or on Google's charges. This is a
commercial product cloned per tenant; a geocoder that any tenant can switch off
by mis-setting a billing account, and that bills every clone against the prime's
key, is not a foundation.

## 2. The design

One chain, one contract, a cache in front and the same gates behind.

```
geocodeAddress(supabase, ask, options)          _shared/geocode/geocoder.ts
  1. geocode_cache        by the folded address key — a hit is the answer
  2. nominatim            OpenStreetMap: house or street precision
  3. abs_locality         the suburb's own centroid from the ABS boundary server
  4. google               ONLY if listed in GEOCODER_PROVIDERS and a key is set
  → assessGeocodeGranularity on every answer, whoever gave it
  → the council from the ABS point-in-polygon query, when asked for
  → cached
```

The default order is `nominatim,abs_locality`. **It names no Google.** An
operator who wants Google as a last resort sets
`GEOCODER_PROVIDERS=nominatim,abs_locality,google` — and that provider still
meters, judges the body and consumes the daily cap exactly as the four call
sites it replaced did.

Every provider answers in one shape (`GeocodeResult`): a coordinate, a
precision (`address` / `street` / `locality` / `postcode`), Google-shaped
`types` so the existing granularity gate judges every provider alike, the
suburb, state, postcode and council it named, what it MATCHED, which provider
it was and the licence line the data travels under.

### 2.1 Measured, not assumed

From the production egress, 16 Sep 2026 (pg_net request ids in brackets):

| Provider | Probe | Answer |
|---|---|---|
| Nominatim [246882] | `10 Leakes Road, Truganina VIC 3029` | Leakes Road, Truganina, 3029 — `road`, street precision |
| Nominatim [246884] | `291 Stone Mason Drive, Kellyville NSW 2155` | Stone Mason Drive, Kellyville, 2155 |
| Nominatim [246936] | `Cobblebank VIC 3338` | a **railway station first**, the suburb second — the rule in §4 |
| Photon [246883, 246934] | `10 Leakes Road Trug` | Leakes Road, Truganina, 3029 |
| Photon [246935] | `291 Stone Mason Dr Kelly` | a bus stop first, the street second — the rule in §5 |
| ABS SAL [246900] | `Glenelg (SA)` | the suburb's polygon, 3.9 KB of rings |
| ABS LGA [246899] | point `144.7265, -37.8375` | `Wyndham`, code `27260` |
| ABS SAL [246898] | the query shape itself | name matched under the ABS qualifier |
| Google geocode | any address, since 12 Sep | `REQUEST_DENIED` |

Every mapper in `_shared/geocode/*.pure.ts` is pinned against those verbatim
answers by `src/lib/geocode/__tests__/*.spec.ts`.

## 3. The rules

**Every provider is judged by the same gates.** OpenStreetMap has Google's
failure modes: a query it cannot match can answer a state, a country or the
centre of the continent. The Google-shaped `types` every result carries feed
`assessGeocodeGranularity` unchanged, so "matched the state, not the address"
is refused for OSM exactly as it was for Google, and `resolve-listing-coordinates`
still runs `assessAuPoint`, `assessAuPostcodePoint` and the suburb consensus on
top, as before.

**A cached answer is the first provider.** OpenStreetMap's usage policy
requires it, the listings sweep re-asks the same addresses daily, and every
allowance holds only if a repeat costs nothing. `geocode_cache` is keyed by the
folded address text (case and punctuation folded; spelling variants such as
`Rd`/`Road` deliberately NOT folded, because a key that guesses equivalence
serves the wrong cached answer). A wrong answer that was cached is removed by
deleting its row; nothing expires, because an address does not move.

**The free providers spend no credential, so they are never metered.** They
are fetched through `fetchWithTimeout`, never `meteredFetch`, and
`openstreetmap.org` and `komoot.io` sit on the billing map's never-metered
list beside `abs.gov.au`. Only the Google provider meters.

**The allowance fails closed.** `osmAllowance.ts` holds two things the public
services ask for: a daily ceiling per kind (`OSM_GEOCODING_DAILY_LIMIT`,
default 2000; `OSM_AUTOCOMPLETE_DAILY_LIMIT`, default 5000) and the
one-request-a-second turn Nominatim's policy makes an absolute maximum. Both
are held in the shared limiter (`security_consume_rate_limit`), not in an
isolate, and a limiter that cannot be read REFUSES — the reading
`consumeGoogleDailyCap` takes, for the same reason: the per-isolate fallback
answers `ok` for the first N requests of every isolate, and Edge Functions
scale horizontally. The verdict words are two of the Google caps' three
(`daily_cap`, `limiter_unavailable`), so `clientStatusFor` reads them
unchanged and no call site spells a client status of its own.

**No Maps caller touches the raw abuse-control quota.** `enforceGlobalDailyQuota`
is named in `osmAllowance.ts` and nowhere a Maps caller can reach it;
`googleMapsDailyCaps.spec.ts` scans for the name.

**A failure says which kind it was.** The chain's failure carries
`no_match` / `unavailable` / `budget` / `refused`, `providerRefused`, and for
`budget` a `capReason`. `location-intelligence-service` maps it onto its
existing vocabulary — `address_not_resolved` only for `no_match`,
`geocoder_unavailable` for a provider fault, `geocoder_not_attempted` with
the cap reason — and re-derives nothing from the absence of a point. The
ZERO_RESULTS rule (RF-7.2B.1B0) moved with the Google provider: the chain reads
`ADDRESS_IS_THE_ANSWER` and never enumerates refusal statuses.

**The locality floor is offered only where a caller accepts it.**
`allowLocalityFallback` is `true` for the map, the report and Estimate CGR
(a suburb centroid is the grade the map already accepts) and `false` for the
PDF import, whose whole purpose is to learn the suburb, state and postcode the
extraction did not read — a centroid names only what it was given.

**The order is configuration, and a misspelt setting is the default.**
`parseProviderOrder` drops unknown names and falls back to the default on an
empty result, so a typo can never switch every geocode off silently.

## 4. Nominatim, in detail (`osmGeocode.pure.ts`)

The search is **structured** where the parts are known — `street`, `city`,
`state`, `postalcode`, `country=Australia` — because Nominatim matches a
structured query far better than the same words free-text; free-text
otherwise. Always `countrycodes=au`, `addressdetails=1`, `limit=5`,
`dedupe=1`.

**The first result is not always the answer.** `Cobblebank VIC 3338` answered
a railway station first. A property's geography is never a station, so
`chooseNominatimPlace` chooses by what the caller asked for: a query that names
a street prefers a house, then the road, then the place; a query that names only
a place prefers the place and never a point of interest. Anything wider than a
suburb (`state`, `county`, `country`, `administrative`) is `coarse` and never
an answer.

**Precision is what the provider matched, in the assessor's words.**
`addresstype` → `house` (`address`), `road` (`street`), `suburb`/`town`/…
(`locality`), `postcode` — each mapped onto the Google-shaped type the
granularity gate already judges.

**Etiquette.** The `User-Agent` is `npc-property-dashboard/1.0 (+repo URL)` —
the product, never a person and never an email address. One request a second
per application, held in the shared limiter (§3). Nominatim's policy forbids
using it for autocomplete, which is why the address field uses Photon (§5).

## 5. Photon, for the address field (`osmAutocomplete.pure.ts`)

`google-places-autocomplete` keeps its name, its route and its response
projection — `{ placeId, description, mainText, secondaryText }` — because
`AddressAutocomplete.tsx` and the three portal forms read exactly that, and
they use one field of it: the chosen prediction's `description` becomes the
address text. The provider behind it is `ADDRESS_AUTOCOMPLETE_PROVIDER`:
`osm` (Photon, the default) or `google` by an operator's explicit choice.
Any other spelling is the default.

Three rules. **A point of interest is never an address suggestion** — a bus
stop, a petrol station and a self-storage yard all sit on Leakes Road; a
feature under an amenity, shop or transport key is dropped unless it carries a
house number, and then it is offered as its ADDRESS. **The typed house number
is kept**: OSM holds address points for a fraction of Australian houses, so
most answers are the street, and a description without the number the person
just typed would delete their own input. **Every line ends in the state code
and postcode when known**, because that is what `parseAddressText` reads
downstream.

The endpoint's abuse controls are unchanged: per-IP and per-session quotas,
input cap, timeout, redacted upstream errors. The circuit breaker is **per
provider** (`osm_autocomplete` / `google_places`) so an outage at one cannot
open the other, and `GOOGLE_PLACES_KILL_SWITCH` still stops the endpoint
whichever provider answers.

## 6. The ABS boundary server (`absLocality.pure.ts`)

`geo.abs.gov.au` serves the ASGS 2021 boundaries the report geography already
resolves through. Two more questions it answers here: a suburb's own polygon by
name (`SAL_NAME_2021`, matched under the ABS qualifier — `Glenelg (SA)`,
`Richmond (Vic.)` — with the state pinned by `STATE_NAME_2021`) whose centroid
is the `locality` answer, and the council a point falls in (`LGA` layer,
point-in-polygon), asked with `wantLga: true` because Queensland's sales
register is by council and Truganina alone straddles Melton and Wyndham.

The centroid is computed by the shoelace formula over the largest outer ring;
holes are ignored. It is a floor, not a substitute: never offered where a street
was asked for and could have been found.

## 7. What each call site does now

| Function | Before | Now |
|---|---|---|
| `resolve-listing-coordinates` | Google, `GOOGLE_MAPS_API_KEY` required, `google_listing_geocoding` breaker | The chain; `GEOCODING_KILL_SWITCH` stops it; breaker `listing_geocoding`; `listing_geocodes.provider` records `nominatim` / `abs_locality` / `google`; `precision` carries `nominatim:street` etc., read by `describeGeocodePrecision` on the map by its suffix; fresh lookups stop after a **20 s wall-clock budget** and the rest are reported as `pendingLookups`, which the client already drains |
| `location-intelligence-service` | Google geocode, then Places and Distance Matrix; no key → `not_configured` for the whole measurement | The chain for the geocode; the key gates only the amenity and commute calls, which are recorded as unmeasured without it — a coordinate is a measurement in its own right |
| `parse-property-pdf` | Google, only when a key was set | The chain, always, never the locality floor |
| `estimate-capital-growth` | Google with the daily cap and the body judge | The chain with `wantLga: true`; `locationType` reads `<provider>:<precision>` |
| `google-places-autocomplete` | Google Places | Photon by default; Google by choice |

Nothing in the frontend changed except `describeGeocodePrecision`, which learned
the chain's suffix form.

## 8. Configuration

Every setting below is a **project environment variable** — a Supabase secret
on the deployment, set the way `OPENAI_API_KEY` is. None of them is required:
the defaults are the shipped behaviour and a deployment that sets nothing
geocodes correctly.

| Name | Default | Meaning |
|---|---|---|
| `GEOCODER_PROVIDERS` | `nominatim,abs_locality` | The order. Add `google` to make Google a last resort. A misspelt value falls back to the default, never to "no providers". |
| `GEOCODER_OSM_URL` | `https://nominatim.openstreetmap.org` | A self-hosted Nominatim (§10). |
| `OSM_GEOCODING_DAILY_LIMIT` | `2000` | The day's Nominatim allowance across the deployment. |
| `ADDRESS_AUTOCOMPLETE_PROVIDER` | `osm` | `osm` or `google`. Any other spelling is `osm`. |
| `AUTOCOMPLETE_PHOTON_URL` | `https://photon.komoot.io` | A self-hosted Photon (§10). |
| `OSM_AUTOCOMPLETE_DAILY_LIMIT` | `5000` | The day's Photon allowance. |
| `GEOCODING_KILL_SWITCH` | unset | Stops `resolve-listing-coordinates` geocoding at all (503, and the client backs off). |
| `GOOGLE_GEOCODING_KILL_SWITCH` | unset | Stops the Google PROVIDER only, through `consumeGoogleDailyCap`. |

### Why these are not on the Integrations page

They were, for one commit, and the card was wrong twice over.

The Integrations page is a register of **credentials**: every card maps to a key
an edge function or the browser reads, and the page derives a card's status from
its **required** fields alone — `configuredFields.length === 0` is
`not_configured`. These providers are free and keyless, so every field on such a
card is optional, the required set is empty, and the card reads **"Not
configured" for ever**, however the deployment is set, for a geocoder that is on
by default and working. Measured across all 144 cards at the time, it was the
only one with no required field. A register that prints a false status about
itself is worse than a register that does not mention the thing.

The second fault: a card on that page must have at least one workflow operation
(`catalog.spec.ts` pins it — an app an operator can configure is an app they can
use). The only honest operation would be "geocode an address", and a live
workflow step calling Nominatim through the generic executor bypasses
`osmAllowance.ts` — no daily ceiling, no one-request-a-second turn. A workflow
looping five hundred rows through it would breach OpenStreetMap's usage policy
under this product's own User-Agent and get it **blocked**, taking the listings
map, the reports and the address field down together. A palette entry with no
request descriptor would instead be a step that draws and does nothing.

So the rule that put the Google caps on that page does not reach here, and
reading it again says why: it is about a **spending** limit on a paid vendor,
where a ceiling nobody can see is a ceiling nobody can raise before a bill
arrives. Nothing is spent here. `allowedSecrets.test.ts` now fails on any card
whose every field is optional, and `geocoderWiring.spec.ts` asserts this table
names every setting the runtime reads, and that the runtime reads every setting
this table names.

### The migration

`20261128090000_geocode_cache.sql`: the table, RLS on with no policy
(service-role only), and `geocode_cache_touch(text)` granted to `service_role`
alone. Apply it through `apply-migration.yml` after the merge; the chain works
without it (a failed cache read is a miss, a failed write is a warning), but
every allowance assumes it.

## 9. Production proof

Recorded here as each step is measured. Until a row is filled in, it is not
done.

| Step | Evidence |
|---|---|
| Migration applied, `geocode_cache` present | _pending_ |
| Autocomplete answers `10 Leakes Road Trug` from Photon | _pending_ |
| A listing geocodes through Nominatim and is cached | _pending_ |
| Estimate CGR geography carries a council from the ABS | _pending_ |
| A second ask of the same address is a cache hit (`hit_count`) | _pending_ |

## 10. Scale, and the end state

The public Nominatim and Photon are run by volunteers for everybody. They are
right for this product's measured volume (tens of geocodes a day, a listings
sweep that the cache absorbs after its first pass) and wrong for a fleet of
clones each asking on its own: the allowance is per deployment and the
policies are per application. Two steps up, neither built here:

1. **Self-host on Fly.io.** `mediagis/nominatim` with the Geofabrik Australia
   extract, and `komoot/photon` built from it, behind `GEOCODER_OSM_URL` and
   `AUTOCOMPLETE_PHOTON_URL`. No code changes; the etiquette limits stop
   applying to a host you run, and the allowances become yours to set.
2. **G-NAF.** Geoscape's Geocoded National Address File is the authoritative
   register of every Australian address with a rooftop coordinate, published
   quarterly under an open licence. Loaded into the project's own Postgres it
   is a fourth provider answering `address` precision for every real address —
   and the only one that can. That is the commercial-grade end state; it is a
   loader and a provider, not a redesign, because the chain and the contract
   already exist.

## 11. What still asks Google

This programme moved the geocode and the address field. Three things still
spend the Google key, and each has a free path measured or named:

| Still Google | Where | Free path |
|---|---|---|
| Places Nearby (amenity counts, nearest school) | `location-intelligence-service`, `school-data-service` | OpenStreetMap's Overpass API. **Unresolved**: it answered `406` from the production egress on 16 Sep; the query shape and mirror need measuring before it is a provider. |
| Distance Matrix (CBD commute) | `location-intelligence-service` | OSRM's public demo router for driving; the GTFS stops already loaded (`TRANSPORT_SOURCES.md`) for the transit reading. |
| Street View imagery | `street-view` | Mapillary (CC BY-SA street-level imagery) where coverage exists; nothing otherwise, and the panel already says when Google has no imagery. |

Until those move, a report without the key measures its coordinate, its
transport reading, its crime area and its geography, and records amenities and
commute as unmeasured — never as zero (RF-7.2B.1B2's rule, unchanged).

## 12. What stays unverified until the merge

- Nominatim's precision on rural and builder-stock addresses (a lot number
  is not a street number: the composition rules in `ADDRESS_COMPOSITION.md`
  still decide what the chain is asked).
- The one-request-a-second turn under concurrent isolates — the limiter
  holds it by construction; it has not been measured under load.
- The ABS qualifier for every suburb name the register carries.
- Everything in §9.
