# Market Updates — shadow mode and full source coverage (2026-08-01)

## Why

The canonical registry holds **43 sources**. Thirty were live; thirteen sat at
`enabled = false` and produced no evidence at all. That is the wrong shape for
onboarding a source: the only way to learn whether a feed is worth publishing is
to run it through the real pipeline and look at what it would have produced.

The workspace made this worse by showing a single "30/43 sources live" figure.
A reader could not tell a source blocked on a commercial licence from one that
was quietly ready for promotion — both were simply "not live".

## What changed

### 1. A third source state

`market_sources.ingest_mode` is now `live | shadow | disabled`.

| Mode | Fetched | Classified | Can publish |
| --- | --- | --- | --- |
| `live` | yes | yes | yes |
| `shadow` | yes | yes | **never** |
| `disabled` | no | no | no |

A shadow source runs the entire pipeline — fetch, parse, dedupe, relevance gate,
LLM classification, publication decision — and then writes its items with
`visibility = 'shadow'`, recording in `shadow_would_publish` the decision the
pipeline *would* have reached. That gap between "would have published" and
"published nothing" is the measurement.

`enabled` is kept and keeps its old meaning (live, publishes to the feed).
Several existing objects read it directly — the automation alert in
`20260726210000` and the registry summary in `20260726150000` among them — and a
shadow source failing must not raise a production source-failure alert. A
`before insert or update` trigger reconciles the two columns so that whichever
one a caller writes, the other follows and neither path silently reverts the
other.

### 2. The invariant is enforced in the database, not just in code

```sql
check (visibility = 'public' or status <> 'published')
```

This matters more than it looks. Every client-facing read path already filters
`status = 'published'` — the RSS feed, all four `market-updates-qa` retrieval
branches, the digest. Because a shadow row can never hold that status, **no
read path needed changing to keep shadow content out of client-facing output**,
and no future code path can quietly leak one.

Two counters did need scoping, because they count non-published rows:

- `market-updates-digest` counted every `candidate` in the window; shadow rows
  are candidates too, and would have inflated "items awaiting review".
- `market-updates-status` counted `published` / `candidate` / `ignored` for the
  operator header, and now reports shadow evidence separately.

`market-updates-embed-backfill` now embeds `visibility = 'public'` rows only, so
embedding spend is not consumed by rows that can never be surfaced.

### 3. The Federal Register of Legislation adapter

`official_api` previously resolved to a stub that always threw. It is now a real
OData adapter against `api.prod.legislation.gov.au`, which answers
unauthenticated. Two service quirks, verified live on 2026-08-01, shape it:

- `$orderby` cannot be combined with `$filter` (HTTP error), and a `$filter` on
  `makingDate` silently returns zero rows. So the request carries ordering only
  and the subject-matter screen runs in the adapter.
- `$top` is capped at 100. Asking for more fails the whole request rather than
  being truncated — `{"message":"The limit of '100' for Top query has been
  exceeded"}` — so both the adapter ceiling and the registry's `fetch_limit` are
  pinned to the service's own limit.
- The API returns registry metadata, not article text, so the excerpt is composed
  from the returned fields rather than extracted from a document — which matches
  the metadata-only extraction policy already recorded for this source.

Screened against live data on 2026-08-01, the 100 most recently made titles
yielded 8 in-scope instruments — Housing Australia Investment Mandate directions,
a banking exemption, Financial Sector (Shareholdings) approvals and a
superannuation amendment. That ratio is exactly what the shadow window exists to
confirm before this source is promoted.

Without a subject-matter screen the Register would return mostly pharmaceutical
listings and defence determinations, so an empty `include_keywords` list is
treated as a misconfiguration rather than "accept everything".

### 4. All 43 sources rendered

`MarketSourceCoveragePanel` accounts for every canonical source, grouped by what
the pipeline actually does with it, with per-source health, authority, the
blocker where one exists, and — for shadow sources — the would-publish rate that
would justify promotion. Collapsed to three tiles by default so the page does not
get busier.

The feed also gained a source filter, and each card now shows the publisher's
**source authority** (regulator, bank research, industry advocacy, academic
research…) next to a clickable publisher name. A regulator and an advocacy body
carry very different weight, and the card previously showed neither.

`resolveIngestMode` falls back to `enabled` when `ingest_mode` is absent, so the
client renders truthfully even when deployed ahead of the read contract that
returns the new column.

## Where the 43 sources landed

**Live — 30.** Unchanged.

**Shadow — 7.**

| Source | Why shadow |
| --- | --- |
| `federal_register_legislation` | New adapter; validating that the keyword screen returns property/credit/tax instruments rather than unrelated ones. |
| `reserve_bank_australia` | All five feeds reachable from other networks; this project's egress gets HTTP 403. Shadow detects recovery automatically. |
| `afca` | Origin returns HTTP 403 to automated requests. |
| `banking_code_compliance_committee` | Origin returns HTTP 403. |
| `property_council_australia` | Origin returns HTTP 403. |
| `domain_research` | `domain.com.au/news/feed/` returns HTTP 403. |
| `austrac` | Origin refuses this egress (HTTP/2 stream error). |

The six blocked origins are polled **once a day** (`refresh_frequency_minutes =
1440`), not hourly. A plain GET to a public page that answers 403 is a failed
request, not a restriction being worked around — nothing retries with forged
credentials, rotates identity or evades a block. The value is that recovery is
detected automatically instead of by someone remembering to re-test.

**Held — 6.** There is no endpoint to call.

| Source | Blocker |
| --- | --- |
| `australian_financial_review` | Licence pending; needs the documented AFR content-API credentials. |
| `reuters_australia` | Licence pending; Reuters publishes no public RSS for this use. |
| `bloomberg_australia` | Licence pending; needs the documented Bloomberg feed credentials. |
| `asic_newsroom` | Re-tested 2026-08-01: `/newsroom/media-releases/` is a 14KB client-rendered shell — HTTP 200, zero JSON-LD blocks, zero article anchors. |
| `fbaa` | Excluded on content, not access: Newshub republishes outlets already ingested directly. |
| `nab_economics_market_news` | `news.nab.com.au/feed/` returns HTTP 404 on every check. |

Scraping the three licensed wires is not an acceptable fallback and is not
attempted; `licensed_api` now resolves to an adapter that fails loudly rather
than one that silently scrapes the public website instead.

## Endpoint verification, 2026-08-01

| Endpoint | Result |
| --- | --- |
| `api.prod.legislation.gov.au/v1/Titles` | 200, 585KB, OData v4 |
| `rba.gov.au/rss/rss-cb-media-releases.xml` | 200 externally, 403 from this project |
| `asic.gov.au/newsroom/media-releases/` | 200, 14KB shell, 0 extractable anchors |
| `afca.org.au/news/media-releases` | 403 |
| `bankingcode.org.au/resources/` | 403 |
| `propertycouncil.com.au/news-research/property-australia` | 403 |
| `domain.com.au/news/feed/` | 403 |
| `austrac.gov.au/news-and-media/media-release` | HTTP/2 stream error |
| `news.nab.com.au/feed/` | 404 |

## Promoting a shadow source

1. Read `market_shadow_source_metrics`, or expand **Source coverage** in the
   workspace.
2. Confirm the source has produced evidence — `wouldPublishRate` returns `null`
   rather than `0%` while `shadow_items` is zero, so "no evidence yet" is never
   confused with "nothing worth publishing".
3. Check the items themselves: `market-updates-status` with
   `{ action: 'updates', status: 'candidate', visibility: 'shadow' }` (admin only).
4. `update market_sources set ingest_mode = 'live' where source_key = '…'` — the
   trigger sets `enabled` to match.

Shadow rows written before promotion stay at `visibility = 'shadow'`; only items
ingested after the switch reach the feed. Their dedupe hashes survive, so a
promoted source does not republish the backlog it already sampled.

## Deployment status

The database migrations are applied. At the time of writing, **Edge Function
deployment is failing on Supabase's side** — both the official CLI
(`supabase functions deploy … --use-api`) and a direct Management API call fail,
with `TransportError` and HTTP 409 `deployment already exists` respectively, for
unmodified functions as well as changed ones. This is a platform-side deploy
outage, not a defect in this change.

The intermediate state is safe. The deployed ingest function selects
`enabled = true`, and shadow sources have `enabled = false`, so it simply skips
them: no shadow ingestion happens until the new code lands, and there is no path
by which a shadow item could be published. `visibility` defaults to `'public'`,
so the live pipeline is unaffected.

The following functions still need to be deployed for shadow mode to start
producing evidence:

- `market-updates-ingest` — selects `live` + `shadow`, tags rows, holds shadow items
- `market-updates-status` — returns `ingest_mode` and shadow metrics
- `market-updates-digest` — scopes the candidate count to `visibility = 'public'`
- `market-updates-embed-backfill` — embeds public rows only
