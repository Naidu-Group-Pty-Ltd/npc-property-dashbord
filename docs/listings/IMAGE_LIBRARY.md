# Listing image library

Durable storage, caching and perpetual refresh for property photos.

## Why this exists

Nothing a listing arrives with is a usable image reference.

- **Airtable attachments are objects, not strings.** `PropertyListing.images` is
  typed `string[]`, but an attachment field returns
  `{ id, url, filename, type, size, thumbnails: { small, large, full } }`. Every
  caller that did `<img src={image}>` rendered `[object Object]`, so the gallery
  in `ListingDetailsModal` silently showed nothing for any base whose photos are
  attachments — which is most of them.
- **Those `url`s expire.** Airtable signs attachment URLs and invalidates them a
  couple of hours after handing them out, and re-signs them on every read. A URL
  captured in a report, a cache, or a database column is dead by the time anyone
  opens it.
- **Portal hotlinks rot.** A URL scraped from the source listing dies when the
  listing is withdrawn, and several portals block cross-origin image loads.

So the library treats every source URL as a *fetch instruction*, never as
storage, and keeps its own copy.

## Shape

| Piece | Path | Role |
| --- | --- | --- |
| Pure model | `supabase/functions/_shared/listingImages.pure.ts` | Normalisation, identity, fingerprinting, refresh schedule |
| Asset identity | `supabase/functions/_shared/listingImageAsset.pure.ts` | Which photograph a URL points at, ignoring its rendition |
| Gallery selection | `supabase/functions/_shared/listingImageSelection.pure.ts` | De-duplication and display order for one listing |
| Gallery hook | `src/hooks/useListingGallery.ts` | The browser's contribution: plan verdict, dimensions, visual signature |
| Client entry | `src/lib/listingImages.ts` | Re-export of the model, so both runtimes share one implementation |
| Session cache | `src/lib/listingImageCache.ts` | Stops repeat requests within a session |
| Hook | `src/hooks/useListingImages.ts` | Batched resolution, mirrors `useListingCoordinates` |
| Edge function | `supabase/functions/listing-images/index.ts` | Harvest, sign, sweep, Airtable write-back |
| Schema | `supabase/migrations/20260817000000_listing_image_library.sql` | Tables, private bucket, RLS, hourly cron |

The model lives under `_shared` and is re-exported into `src/` rather than
duplicated. Both runtimes must agree on identity and fingerprinting exactly — if
they drift, the library re-downloads every photo on every pass. This is the same
convention the repo already uses for other `_shared/*.pure` modules.

## Identity: why not the URL

Airtable re-signs an attachment on every read, so the same photo arrives as
`…/fl.jpg?ts=1770000000&sig=aaa` one hour and `…?ts=1770003600&sig=bbb` the
next. Keyed on the full URL, every poll looks like a brand-new image and the
harvester re-downloads the whole set forever.

`imageIdentity()` therefore keys on the Airtable attachment id when there is
one, and otherwise on `origin + pathname` with the query string dropped.
`imageSetFingerprint()` builds an order-independent digest of those identities,
so a refresh pass can distinguish "the agent added three photos" from "Airtable
re-signed the same three" without fetching a byte.

## Storage

- Bytes go to the private `listing-images` bucket at
  `{listingId}/{sha256(identity)[..32]}.{ext}` — deterministic, so re-harvesting
  the same photo overwrites in place instead of orphaning the previous object.
- `public.listing_images` holds one row per photo: storage path, origin,
  editorial position, checksum, dimensions, status.
- `public.listing_image_sets` holds one row per listing: fingerprint, counts,
  `refresh_after`, error state, and Airtable write-back state.

Both tables are **service-role only**, and no storage policy grants the
`authenticated` role anything on the bucket. The browser receives short-lived
signed URLs minted by the edge function and never a bucket path — the same
posture the repo takes for private report storage.

A photo that disappears from the source is marked `gone`, not deleted: a report
rendered last quarter may still reference it.

## De-duplication: one photograph, one slide

`imageIdentity` answers "is this the same URL". A gallery needs the answer to a
different question — "is this the same picture" — and the two diverge constantly,
because an agency listing page publishes each photograph several times over.

Measured against production on 2026-08-19, across 4,807 stored photographs on
471 listings:

| What | Scale |
| --- | --- |
| Rows that were a second copy of a photograph the same listing already held | **240**, on 56 listings |
| Worst single listing | **35 rows carrying 4 pictures** (`rec08CYsD6LXTKzS9`) |
| Listings whose first two or three slides were one photograph at two or three sizes | 12 |
| "Photographs" on one listing that were agent headshots, at two sizes each | 6 of 12 (`rec58tOiwSrbPmw6h`) |

Its card said "35 photos" and its carousel looped the same four nine times.

### Three layers, cheapest first

| Layer | Catches | Where it runs |
| --- | --- | --- |
| **Checksum** | Exact bytes — a re-signed Airtable URL, the same file fetched twice | Harvest and read path |
| **Asset key** (`listingImageAsset.pure.ts`) | The same picture at another size or through another CDN transform | Everywhere, before any fetch |
| **Visual signature** (`imageKind.ts`) | A re-encode sharing neither bytes nor URL shape | Browser only, from a decode it already does |

Absent evidence never merges anything, so each layer is optional and a caller
that knows only URLs still gets the first two.

The asset key is the interesting one. It strips what is a *rendering
instruction* and keeps what names the asset, which covers four real shapes:
a size directory (`/custom/m/…` vs `/custom/l/…` vs `/custom/160x/…`), a Rails
ActiveStorage variation token (the blob id is the photograph; `/blobs/` and
`/representations/` are the same asset), an AWS Serverless Image Handler
envelope (`{bucket, key, edits}` base64'd into the path), and a base64 thumbor
instruction wrapping a source URL. Two rules keep it safe:

- **A key is only ever compared within one listing.** Nothing merges across
  listings, anywhere, so a wrong answer costs one property's gallery.
- **A distinctive filename decides on its own** — long, and carrying a digit, so
  a UUID or an agency asset number — and the directories above it are then
  ignored wholesale. That is what collapses every size-path shape without a rule
  per CDN. Bare numeric path segments are *never* stripped: `/gallery/1/main.jpg`
  and `/gallery/2/main.jpg` are two pictures.

Validated by replaying all 4,807 rows through it: 40 groups merged rows with
different bytes, and every one was a genuine rendition pair. Zero distinct
photographs collided.

### Where each fix lives

- **`orderCandidatesForDisplay`** collapses renditions before anything is
  fetched, so every path into the harvester inherits it and the
  `MAX_IMAGES_PER_LISTING` cap counts photographs rather than copies.
- **`harvestListing`** adopts a stored row when a candidate's asset key matches
  it, so a rendition of something already held costs no fetch and files no row.
- **`signStoredImages`** de-duplicates before signing. This is the guarantee a
  reader depends on: the table will always accumulate copies, a deploy lands
  before a migration is dispatched, and the next agency to serve four sizes of
  every shot has not been met yet. It is also cheaper — the copies leave the
  Storage signing request, not just the render.
- **`retireRedundantCopies`** marks a stored row `gone` when the same photograph
  is held by another row that is being kept, so the table heals itself as
  listings come round. This is **not** the retirement `listingImageReconcile`
  guards, which claims the source no longer offers a photograph and can blank a
  gallery; this one is checked against the rows themselves and every row it
  retires has a surviving twin by construction.

There is a repair migration for the checksum half of this
(`20260828000000_listing_image_duplicate_repair.sql`). It has never been applied
— migrations here are dispatched one at a time by hand — which is precisely why
the duplication was still on the page, and why the fix is in the runtime instead.

### Ordering demotes; it never promotes

`selectListingGallery` bands into `standard` → `weak` → `plan`, stable within
each, and the middle band is the default. The agent's own ordering is editorial
and survives untouched; what moves is a floor plan, and anything the evidence
says is not a photograph of this property (page furniture, a measured 150×150
headshot, an image that exists only at thumbnail size).

**There is deliberately no "good photograph" band.** The first draft had one,
lifted by filename words — `facade`, `kitchen`, `main`, `hero`. Replayed over the
corpus it moved eleven listings' hero, and the moves were wrong: on two it
promoted `CEA_Main Lockup_Black.png`, an agency logo, over the photograph,
because a logo lockup is called a *main* lockup. A filename is the agency's word
for a file, not evidence about a picture. So a façade or a living area leads the
card by *exclusion* — everything standing in front of it has been moved behind
it — which is the only version that cannot be a matter of taste.

The selector never returns an empty gallery for a non-empty input. Over-filtering
blanks a card, which is much worse than showing a weak photograph — the same
asymmetry retirement records below.

### The chrome filter reads decoded URLs

`looksLikeChromeUrl` now matches its hints against the *decoded* URL. A growing
share of agency CDNs base64-encode the source path into a segment, which made
every hint unreachable: `ProfileFace/Andrew-Turley.jpg` was invisible to a filter
that had `headshot`, `avatar` and `profile-` in its list. One listing was showing
three agents' faces, twice each.

## Perpetual refresh

`refresh_after` drives an hourly cron sweep (`op: 'refresh'`). Cadence comes from
listing recency, on the premise that listings churn hardest when they are new
and settle once the campaign is running:

| Listing age | Re-verified every |
| --- | --- |
| ≤ 7 days | 1 day |
| ≤ 30 days | 3 days |
| ≤ 180 days | 14 days |
| older | 60 days |
| unknown date | 14 days |
| failing | exponential backoff, capped at 60 days |

An unknown date is treated as mid-life rather than as new: unknown dates come
from thin records, and thin records are the ones most likely to burn a refresh
budget for nothing.

The sweep is bounded per run, so the backlog drains as a steady trickle rather
than a daily burst that collides with Airtable's rate limit. A pass whose
fingerprint is unchanged re-arms the schedule and touches no bytes at all — that
is what makes hourly affordable.

## Airtable enrichment

`op: 'sync'` writes the durable URLs back into an Airtable column so anything
reading the base directly gets usable links. The column is named per base, so it
is configuration:

| Variable | Purpose |
| --- | --- |
| `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME` | Already used by `airtable-proxy` |
| `AIRTABLE_IMAGE_LIBRARY_FIELD` | **New.** Long-text column the URLs are written to (newline separated) |

Without `AIRTABLE_IMAGE_LIBRARY_FIELD` the write-back is skipped rather than
guessed at — the sweep and the read path still work, the base just is not
enriched. `op: 'sync'` is not scheduled by the migration; wire it to cron once
the column exists and you have confirmed the field name against the live base.

## Safety

Candidate URLs come from caller-supplied data, so every fetch goes through
`_shared/ssrfGuard.ts` (`assertPublicUrl`) before a request leaves the runtime,
and then:

- content type must be in an image allowlist,
- size is bounded both by `content-length` and by the actual read (8 MB),
- bytes are only ever written to the bucket, never returned to the caller, so
  the endpoint cannot be used to read a response back out,
- `resolve` requires an authenticated user with `listings.can_view`, and carries
  actor, IP and global daily quotas plus a `LISTING_IMAGES_KILL_SWITCH`,
- `refresh` and `sync` require the service-role key, which cron holds and a
  browser never does.

## Status

Built and type-checked; the pure model is covered by `src/lib/listingImages.test.ts`.
The migration, the edge function's live behaviour and the Airtable write-back
have **not** been exercised against a real base or project from this
environment — they need a deploy, `AIRTABLE_IMAGE_LIBRARY_FIELD` to be set, and
a first `op: 'refresh'` run to verify end to end.
