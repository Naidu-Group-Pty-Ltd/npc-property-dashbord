# What a clone does not get, and how to finish provisioning one

Measured 19 September 2026 across every project in the fleet. Read this before
concluding that a clone's Market News Feed, listing scrape or Builder Stock is
broken — in each case the code is correct and something never reached the
deployment.

## The measurement

| Project | Ref | Latest migration | `market_sources` | `builder_network_connections` |
|---|---|---|---|---|
| NPC Property Dashboard (**prime**) | `dduzbchuswwbefdunfct` | `20261203010000` | populated | — |
| aurixa-clone-npc-client-dashboard | `plisdzywzleljorrphxv` | `20261123000000` | **0 rows** | **0 rows** |
| aurixa-clone-NPC Test | `umrtusxohxjxzodxorim` | `20261123000000` | — | — |
| aurixa-clone-Preflight Property Group | `egrmsulhtmqnmhvuccxr` | `20261123000000` | — | — |
| aurixa-builders (**the network**) | `htfluofznhxeumblwbww` | — | — | 1,066 stock items, 91 outbox events |

Two facts carry everything below.

**All three clones stop at `20261123000000`** and are missing the same
seventeen migrations, `20261124000000` through `20261204010000`. That is a
fleet-wide gap, not three coincidences.

**A clone's migration LEDGER is not a record of what ran.** On
`plisdzywzleljorrphxv` all seven `market_sources` seeding migrations are
recorded as applied and the table holds **zero rows**. Clone provisioning
copies the schema and the ledger; the rows those migrations INSERT do not come
with it. Anything a migration seeds is therefore absent on every clone while
looking, from the ledger, exactly like it is present.

## 1. The Market News Feed source registry

**Fixed in code — no action needed.** `market-updates-ingest` now fills an
empty registry from the catalogue shipped in
`_shared/marketSources/canonicalRegistry.generated.ts` (43 sources) and carries
on. The next ingestion on any clone seeds itself.

It only ever acts on an **empty** registry. A deployment whose sources an
operator disabled is left exactly as it is — see `registrySeed.pure.ts`.

To confirm afterwards: the Market News Feed page should stop reporting
`HTTP 422`, and `market_sources` should hold 43 rows.

## 2. Reading a listing page

**Half fixed in code.** `FIRECRAWL_API_KEY` is an Integrations credential no
clone is provisioned with, and there is no free substitute: measured from the
production egress, `r.jina.ai` answers **HTTP 200 with an "Access Denied"
body** for both `realestate.com.au` and `domain.com.au`. Both portals WAF-block
it.

`scrape-property-listing` now resolves a route — direct where the deployment
holds the key, otherwise **brokered through Mission Control**, which holds the
one key and meters its own call. A deployment with neither behaves exactly as
it does today, so nothing regressed.

**What is still owed: Mission Control must serve the brokered path.**

```
POST /api/public/page/read
     x-clone-api-key: <the clone's Mission Control key>
     { "url": "https://www.domain.com.au/..." }

→ 200 { "markdown": "...", "title": "...", "description": "..." }
→ 4xx with `x-mission-control-refusal` set on its OWN refusals, never on a
  relayed vendor error — both ends answer similar JSON and send an operator
  to opposite remedies.
```

Its handler **must re-assert the host allow-list**. A brokered read fetches a
URL a tenant named and spends the prime's Firecrawl credits, so it cannot trust
its caller. Import `PROPERTY_LISTING_HOSTS` / `refusePageReadUrl` from
`_shared/pageRead/pageReadRoute.pure.ts` rather than restating the list — two
copies is how a broker comes to accept a host the caller's own normaliser would
have refused. The eight portals are the narrow list on purpose: widening them
widens what any tenant can bill to the prime.

Until that ships, a clone scrape still falls through to the model search and
still draws the provenance warning, which is exactly today's behaviour.

### What an operator can do today, without waiting for the broker

The audit's own wording for this item — *add `FIRECRAWL_API_KEY` on the clone's
Integrations page* — is performable right now, and it was checked end to end
rather than assumed:

* the **Firecrawl** card exists on the Integrations page under Automation, with
  one required field, `FIRECRAWL_API_KEY`;
* that name is in `ALLOWED_INTEGRATION_SECRETS` and is **not** one of the six
  `LISTINGS_PIPELINE_SECRETS` the page refuses, so the write is accepted;
* `update-integration-secret` puts it in the **project environment** — on a
  clone through Mission Control's broker, because a clone must never hold the
  Supabase management token — which is where
  `Deno.env.get("FIRECRAWL_API_KEY")` reads it from.

Saving it requires a superadmin and a recent reauthentication
(`step_up`, capability `secrets.update`).

**Doing this now does not conflict with the broker.** `resolvePageReadRoute`
returns `direct` whenever a key is held and only falls to `broker` when none
is, so a key set today is used today, and clearing it later hands the same
deployment to Mission Control with no code change and nothing to undo.

The cost is the reason it is not the fleet answer, not a reason to avoid it on
one deployment: a spend-bearing credential on a tenant project, a key to mint
and rotate per tenant, and every clone provisioned tomorrow still starting with
no page-read capability at all. Use it to unblock a specific clone; use the
broker to stop the problem recurring.

## 3. Builder Stock

The network holds **1,066 stock items** and has composed **91 outbox events**.
None of it reaches a clone, for two independent reasons.

**Reason one, fixed in code.** `builder_network_stock_ranked` and the `rank_*`
columns arrive with `20261202090000`, which no clone has, so the marketplace
answered PostgREST 42P01 and the tab said "Builder stock could not be loaded".
It now falls back to the base table and reports `ranked: false`, so a clone
that HAS stock will show it, newest first, saying plainly that the order is not
merit.

**Reason two, not fixable from code.** `builder_network_connections` holds zero
rows on the clone, so no events are delivered and the mirror stays empty. A
connection is a two-sided record with a shared HMAC secret and cannot be
created by one side alone.

### Finishing it

**Step A — apply the missing migrations.** Each clone repository has the
`Apply a migration` workflow (`.github/workflows/apply-migration.yml`), which
applies ONE named file to that repository's own project. It reads
`vars.SUPABASE_PROJECT_REF` and `secrets.SUPABASE_DB_URL`, so it targets the
clone and nothing else. Dispatch it once per file, **in version order**:

```
20261124000000 … 20261204010000    (17 files, `ls supabase/migrations/`)
```

The three that matter for Builder Stock, and why:

| Migration | What it adds |
|---|---|
| `20261124010000_builder_network_stock_selection_producer.sql` | the inbound sweep and its one-minute pg_cron job |
| `20261201090000_builder_network_stock_consumer_and_agency_disclosure.sql` | the consumer that converges events into the mirror |
| `20261202090000_builder_marketplace_ranking.sql` | `builder_network_stock_ranked` and the `rank_*` columns |

Read `apply-migration.yml`'s header first. It deliberately does **not** run
`supabase db push`: this project's ledger under-reports by about two orders of
magnitude, so a push would replay ~130 already-applied migrations including
data mutations where a second application is not a no-op.

**Step B — establish the connection.** Both sides, same `network_connection_id`
and the same symmetric `outbound_hmac_secret`:

- on `aurixa-builders`: a `workspace_connections` row naming the clone and its
  inbound URL;
- on the clone: a `builder_network_connections` row with `state = 'active'`,
  the same secret, and `network_inbound_url` pointing at the network's
  `builder-network-inbound`.

Mint the secret with `openssl rand -hex 32`. It is symmetric — both directions
sign `${timestamp}.${rawBody}` with it — so it must be identical on both sides
and must never be committed anywhere.

**Step C — confirm by effect, never by configuration.** The one-minute sweep
(`builder_network_apply_inbound_events`) should move rows into
`builder_network_stock_items` on the clone. Check `integration_outbox.attempts`
and `net._http_response.status_code` rather than the pg_cron run's own status:
pg_cron reports on the SQL that queued the HTTP call, not on the call.

## Why all three were silent

Each of these is a deployment that is missing something, and in each case the
product reported the *consequence* rather than the *cause* — an empty feed, a
scrape about the wrong property, a marketplace that could not be loaded. The
fixes above make each one say which absence it is. That is the part worth
keeping: the next gap of this shape should be readable from the screen rather
than from a migration ledger.
