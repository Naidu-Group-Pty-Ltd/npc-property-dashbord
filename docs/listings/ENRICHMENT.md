# Listing enrichment

Where the missing property data comes from, and why it is not where you would
first look.

## The starting position

Property Intake Master holds 1,441 records. Measured directly against the live
base:

| Field | Populated |
| --- | --- |
| `Address` | 1,233 (86%) |
| `Suburb` | 1,336 (93%) |
| `Extraction Confidence` (+5 more scores) | 1,440 (99.9%) |
| `Display Price Text` | 1,023 (71%) |
| `Price Numeric` | 773 (54%) |
| `Beds` / `Baths` / `Car Spaces` | 987 / 927 / 915 |
| `Property Description` | 839 (58%) |
| `Web Link` / `Source Web Link` | 880 (61%) / 676 (47%) |
| `Inspection Start` | 268 (19%) |
| **`Listing Images`, `Floorplan`, `Brochure`, `Additional Attachments`** | **0** |
| **`Latitude` / `Longitude`** | **0** |

The intake pipeline is a Make.com scenario in an account this workspace cannot
see. It runs one stage — read the email body, ask a model for structured fields,
write to Airtable — and stops. Its own status columns say so:
`Web Scrape Status` = "Not Required" on every record, `Enrichment Status` =
"Not Started", `Processing Stage` = "AI Parsed" and never advancing. The image,
document, geocode and duplicate branches it was designed with never run.

Since the pipeline cannot be fixed from here, the gap is closed downstream.

## What does not work: mining the stored text

The obvious cheap idea is to re-read `Raw Source Snippet`, which is populated on
1,440 of 1,441 records. **It recovers almost nothing.** Over a 120-record sample:

- Of the **60 records with no price, zero** had a dollar figure anywhere in their
  stored text.
- Of the **75 with no bedroom count, one** mentioned a bedroom.
- One record in 120 carried an image URL.

The snippets are short extracts, not email bodies — typically 100–500 characters
of marketing copy the extractor already mined. A representative one reads, in
full: *"Exclusive One-Part Contracts Almost Gone! - Act Now!! Please reach out to
your BDM for more information."*

The `mine` stage exists anyway, because it costs nothing and occasionally catches
a bare `4 2 2` spec line. It is a safety net, not the answer, and the numbers
above are why the pipeline does not stop there.

## What does work: the listing page

`Web Link` is populated on 880 records. Fetching one for **13 Larundel Road** — a
listing the dashboard displays as *"Unknown / – / – / – / Price on request"* —
returns:

- **62 property photographs**
- 6 bedrooms, 4 bathrooms, 2 car spaces
- 809 m² land
- $5,300,000

Two details decide whether that works at all:

- **Galleries hide the real photo.** The full-size images are in `data-thumb` and
  `data-fancybox` attributes; `<img src>` holds placeholders. Reading `src`
  returned two files — the agency logo and the agent's signature.
- **The images have no file extension.** They are served as
  `lh3.googleusercontent.com/d/<id>=w1200`. An extension test rejects all 62, so
  `isPropertyImageUrl` also accepts a list of known media hosts.

The same page also carries the specs, marked up semantically
(`<li class="no-of-bed">6`), which is far more reliable than looking for "6 bed"
in prose that also discusses the neighbourhood.

### The links are not all listing pages

Of 94 sampled: 63 go straight to a property page, **25 are email-tracking
redirects**, 4 are an agency homepage, 1 is a search page.

Tracking links are worth following — one resolved in a single hop to
`greatoceanproperties.com.au/8300588` — but **every hop is re-validated**. A
tracking service is an open redirector by definition, so the only URL ever
checked is the one we started with.

> Writing the tests for that caught a real hole. The first version of the host
> check ended its alternation with `$`, so `127\.` could only match a hostname
> that was *exactly* `127.` — and `127.0.0.1`, `192.168.x`, and the
> `169.254.169.254` cloud metadata endpoint all went through. Each range now has
> its own assertion in `src/lib/listingUrlPolicy.test.ts`.

A homepage or a search page is never scraped: it would attach the agency's hero
banner to a property as though it were the house.

## Shape

| Piece | Path |
| --- | --- |
| Mining, prioritisation, merge rules | `supabase/functions/_shared/listingEnrichment.pure.ts` |
| Page extraction | `supabase/functions/_shared/listingScrape.pure.ts` |
| URL classification and SSRF gate | `supabase/functions/_shared/listingUrlPolicy.pure.ts` |
| The sweep | `supabase/functions/listing-enrichment/index.ts` |
| Schema, cron, atomic claim | `supabase/migrations/20260803162826_listing_enrichment.sql` |
| Image storage | `listing-images` `op:'harvest'` |

```
listings_cache ──▶ seed queue ──▶ claim (atomic, leased)
                                     │
                     mine ──▶ resolve_url ──▶ scrape
                                     │
                         listing_enrichment (values + provenance)
                                     │
                   listing-images op:'harvest' ──▶ private bucket
```

## Rules that are load-bearing

**Airtable wins wherever it has a value.** The overlay fills holes. The single
exception is the locality pair, and only when the record's own state and postcode
contradict each other — the one case where they are known to be wrong.

**`Address` and `Suburb` are never replaced**, disputed or not. A wrong address
propagates into deduplication, geocoding, reports and generated PDFs, with no
undo.

**A stage that found nothing never blanks a field.** Enrichment only ever adds. A
failed scrape must not erase what mining found.

**No foreign key to `listings_cache`.** Airtable prunes that table at 30 days and
the cache mirrors the deletion, so a cascade would destroy a month of accumulated
enrichment every night. The overlay deliberately outlives the mirror.

**Claiming is atomic, with a lease.** Two overlapping cron fires would otherwise
harvest the same listing twice and pay twice. (`listing-images`' own sweep does
not do this; the pattern is deliberately not copied.)

**Priority is the gap discounted by remaining life.** A 29-day-old record is about
to be pruned upstream, so enriching it buys a day of benefit.

## Boilerplate

Mined and scraped URLs are frequently the agency logo, the agent's headshot,
social icons, tracking pixels, or the "SOLD"/"UNDER OFFER" overlay stickers that
sit in the markup of every listing whether they apply or not. Because the same
file appears on every listing, harvesting them would fill the library with a
dozen images repeated a thousand times and put a letterhead where the house
should be. `listingScrape.pure.ts` carries the denylist; every entry in it was
observed on a real page.

## Budget

This makes scheduled outbound requests to third-party websites, so the cost of a
runaway loop is being blocked by the sites the data comes from.

| Limit | Value |
| --- | --- |
| Sweep interval | 10 minutes |
| Listings per run | 25 |
| Page fetches per run | 60 |
| Page fetches per day | 4,000 |
| Listings per day | 3,000 |
| Images per listing | 16 (harvester caps at 12) |
| Write-backs per day | 200 |

At 25 per run the 1,441-record backlog clears inside a day, then idles.

**No LLM calls and no Perplexity.** `scrape-property-listing` is job-based and
paid; cron × Perplexity × 1,441 is a bill nobody approved. Regex over
machine-generated agency-CRM markup is sufficient, as the numbers above show. If
coverage plateaus, that is the point to reconsider — not before.

**Street View bytes are never harvested.** Caching Google's imagery is a
terms-of-service grey area and `street-view` already renders it live. The
`street_view` origin stays in the enum and is never populated by the sweep.

## Write-back to Airtable

`op:'writeback'`, six-hourly, **shipped in dry-run**.

Airtable is what people read and edit, and clobbering a human's correction is
unrecoverable. So: allowlisted fields only; only into columns still empty when the
run reads them; confidence ≥ 0.85; never an LLM-derived value; and refused
outright when `listings_cache_sync.status` is not `ok` — never write into a base
you cannot currently read reliably, because a column that looks empty may just be
one you failed to read.

Where the enriched value differs from a non-empty Airtable value, the record is
counted as a conflict and left alone.

Run `{"op":"writeback","dryRun":true}` and read `wouldPatch` and `sample` before
setting `dryRun:false`.

## Verifying

```sql
-- Coverage, before and after.
select
  count(*) filter (where fields->>'Price Numeric' is not null) as price,
  count(*) filter (where fields->>'Beds' is not null) as beds,
  count(*) filter (where coalesce(fields->>'Web Link','') <> '') as web_link,
  count(*) as total
from public.listings_cache where table_key = 'tblWIg5cs85O30pcY';

-- What the sweep has done.
select status, count(*) from public.listing_enrichment group by status;
select stage, outcome, count(*) from public.listing_enrichment_events
  group by stage, outcome order by 3 desc;
select * from public.listing_enrichment_budget order by day desc limit 7;

-- Photographs actually stored.
select count(*) from public.listing_images where status = 'stored';
```

Unit tests: `src/lib/listingScrape.test.ts` (extraction, boilerplate rejection),
`src/lib/listingUrlPolicy.test.ts` (classification, every SSRF range, merge
rules).
