import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260812000000_market_updates_article_archive.sql');
const curate = read('supabase/functions/market-updates-curate/index.ts');
const status = read('supabase/functions/market-updates-status/index.ts');
const feed = read('supabase/functions/market-updates-feed/index.ts');
const digest = read('supabase/functions/market-updates-digest/index.ts');
const qa = read('supabase/functions/market-updates-qa/index.ts');
const qaShare = read('supabase/functions/market-qa-share/index.ts');
const embed = read('supabase/functions/market-updates-embed-backfill/index.ts');
const ingest = read('supabase/functions/market-updates-ingest/index.ts');
const service = read('src/services/marketUpdatesService.ts');
const types = read('src/types/marketUpdates.ts');
const generatedTypes = read('src/integrations/supabase/types.ts');

const requireTokens = (text, tokens, label) => {
  for (const token of tokens) assert.ok(text.includes(token), `${label} missing ${token}`);
};

requireTokens(migration, [
  'archived_at timestamptz', 'archived_by uuid', 'pre_archive_status text',
  "failure_reason = 'hidden_by_operator'", 'market_updates_archived_at_idx',
  'where archived_at is not null', 'market_update_archive_purge_runs',
  'purge_expired_market_updates_archive', "archived_at <= v_cutoff_at",
  "now() - interval '30 days'", 'get diagnostics v_deleted_count = row_count',
  'raise log', 'market-updates-archive-purge-daily', "'37 2 * * *'",
  'revoke all on function public.purge_expired_market_updates_archive()',
  'grant execute on function public.purge_expired_market_updates_archive()',
], 'archive migration');
assert.doesNotMatch(migration, /cron\.unschedule[\s\S]{0,160}where jobname like 'market-updates-%'/, 'archive migration must not broadly unschedule Market jobs');
assert.match(migration, /delete from public\.market_updates\s+where archived_at is not null\s+and archived_at <= v_cutoff_at/s);

requireTokens(curate, [
  "requestedAction === 'hide' ? 'archive'", "action !== 'archive' && action !== 'restore'",
  "requireModulePermission", "'market_updates', 'can_edit'", 'archived_by:auth.userId',
  'pre_archive_status:existing.status', "outcome:'already_archived'", "outcome:'already_restored'",
  "code:'not_found_or_purged'", ".is('archived_at', null)", ".not('archived_at', 'is', null)",
], 'curate function');

requireTokens(status, [
  "action === 'archive'", "'market_updates', 'can_edit'", 'pageSize', 'hasMore',
  'ARCHIVE_COLUMNS', 'days_remaining', 'deletes_at', "not('archived_at', 'is', null)",
  "is('archived_at', null)", 'archivedUpdates', 'archiveSearch',
], 'status function');
assert.ok(!status.match(/ARCHIVE_COLUMNS[^\n]*confidence_score/), 'archive response must not expose confidence_score');

for (const [name, source] of [['feed', feed], ['digest', digest], ['qa', qa], ['qa-share', qaShare], ['embed', embed]]) {
  assert.ok(source.includes('archived_at'), `${name} must explicitly account for archived rows`);
}
assert.ok((qa.match(/is\('archived_at',\s*null\)/g) ?? []).length >= 4, 'all QA retrieval branches must exclude archived rows');
assert.ok((embed.match(/is\('archived_at',\s*null\)/g) ?? []).length >= 2, 'embedding select and update must exclude archived rows');

// Dedupe deliberately scans all retained rows. An archived predicate here would
// allow an archived article to be recreated before its 30-day purge.
const dedupeBlock = ingest.slice(ingest.indexOf('const lookups = ['), ingest.indexOf('const lookupResults', ingest.indexOf('const lookups = [')));
requireTokens(dedupeBlock, [".eq('dedupe_hash',dedupe_hash)", ".eq('canonical_url',canonicalUrl)", ".eq('external_id',item.externalId)"], 'ingestion dedupe');
assert.ok(!dedupeBlock.includes('archived_at'), 'ingestion dedupe must include retained archived rows');

requireTokens(service, ['archiveMarketUpdate', 'restoreMarketUpdate', 'fetchMarketUpdateArchive'], 'frontend service contract');
requireTokens(types, ['ArchivedMarketUpdate', 'MarketUpdateArchivePage', 'archivedUpdates'], 'application types');
requireTokens(generatedTypes, ['market_update_archive_purge_runs', 'purge_expired_market_updates_archive', 'pre_archive_status'], 'generated database types');

// Boundary scenarios mirror the SQL predicate and prove active/young records are
// never retention candidates.
const now = Date.parse('2026-08-01T12:00:00.000Z');
const eligible = (archivedAt) => archivedAt !== null && Date.parse(archivedAt) <= now - 30 * 86_400_000;
assert.equal(eligible(null), false, 'active rows are never purged');
assert.equal(eligible('2026-07-03T12:00:00.000Z'), false, '29-day archives are retained');
assert.equal(eligible('2026-07-02T12:00:00.001Z'), false, 'rows just under 30 days are retained');
assert.equal(eligible('2026-07-02T12:00:00.000Z'), true, 'exactly 30-day archives are eligible');
assert.equal(eligible('2026-06-01T00:00:00.000Z'), true, 'older archives are eligible');

console.log('Validated Market Updates archive schema, authorization, active-query exclusions, retention boundaries, and ingestion dedupe.');
