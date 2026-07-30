## Why pins disappeared

`ListingsMapView` now plots **only** listings that already carry `Latitude`/`Longitude` values from the Airtable "Property Intake Master" base. Browser-side geocoding was deliberately removed for privacy (there is a security test, `ListingsMapView.security.test.ts`, that fails if `geocodeAddress` returns to that file). Because almost no Airtable records have those fields populated, `markers.length` is 0 and the map shows the "No listings have map coordinates" notice.

The fix is not to re-add browser geocoding — it is to resolve coordinates **server-side** and cache them.

---

## Phase 1 — Restore pins (server-side geocoding + cache)

- New table `public.listing_geocodes`: `listing_hash` (address+suburb+state fingerprint, PK), `lat`, `lng`, `precision`, `provider`, `resolved_at`. Explicit GRANTs, service_role-only RLS per project standard.
- New edge function `resolve-listing-coordinates`: accepts a batch of listing address fragments, returns coordinates. Order of resolution:
  1. Airtable `Latitude`/`Longitude` if present (no lookup).
  2. Cache hit in `listing_geocodes`.
  3. Google Maps Geocoding via the connector gateway (server-side key), result written to cache.
- Frontend calls it through `invokeSecureFunction` from `Listings.tsx`, merges resolved points into listings before passing to the map. No address ever leaves the browser directly, so the privacy test stays green.
- Graceful degradation: unresolvable listings stay off the map and are surfaced in the existing "need saved coordinates" counter.

**Gate:** pins appear for the current Airtable dataset; security test + `npm run lint` pass.

---

## Phase 2 — Map design upgrade (heatmap + premium styling)

- Add `leaflet.heat` layer driven by listing density, weighted by price where available.
- View toggle inside the map: **Pins · Clusters · Heat** (heat overlays optionally combine with clusters).
- Dark-gold tile treatment: CartoDB dark basemap with a CSS filter tuned to the Aurixa palette, light-mode variant retained; all colours from semantic tokens.
- Custom marker glyphs (price bubbles instead of default Leaflet pins), styled cluster badges, glass legend + control panel matching `GlassCard`.
- Respect `prefers-reduced-motion` for fly-to/zoom transitions.

**Gate:** no hardcoded colours (`npm run audit:style` clean), no horizontal overflow at 1047px and mobile.

---

## Phase 3 — Google Street View integration

- Add a Street View panel to the listing popup and to the listing detail drawer.
- Preview uses the Street View **Static** API image via a server-side proxy edge function (`street-view-image`) so the server key is never exposed; interactive panorama uses the Maps JS `StreetViewPanorama` with the referrer-restricted browser key.
- Metadata check first (`/streetview/metadata`) so we only render the panel when imagery genuinely exists; otherwise show an actionable empty state.
- "Open in Google Maps" fallback link for listings with no panorama coverage.

**Gate:** panel renders for a coverage-positive listing, degrades cleanly for a coverage-negative one.

---

## Phase 4 — QA & hardening

- Playwright pass over `/listings?view=map`: pin count, heat toggle, popup → drawer, Street View load, console clean.
- Verify geocode cache prevents repeat provider calls (second load makes zero geocoding requests).
- `npm run lint`, `npm run audit:style`, `npm run build`, plus the listings security tests.

---

### Technical notes
- Uses the existing **Google Maps Platform connector** through the gateway for geocoding and Street View metadata — no new secrets needed if that connection is linked; if not, Phase 1 pauses to link it.
- Leaflet stays as the map engine; Street View is the only Google-rendered surface, avoiding a full Mapbox/Google map migration.
- All new edge functions follow the project's `verifyAuth` + CORS + signed-internal standards.
