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
