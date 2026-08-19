/**
 * The public office-holder index: the parser, and the loader's rules.
 *
 * These run under `node --test` before anything is written, exactly like the
 * sanctions parser tests, because the failure mode is the same shape: an
 * index that parses to nothing, or that normalises differently from the
 * query, looks precisely like an index that works.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  WIKIDATA_AU_QUERY, parseWikidataOfficeholders, withNormalisedNames,
} from '../../scripts/aml/pepOfficeholderParsers.mjs';
import { normaliseName } from '../../scripts/aml/sanctionsParsers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const loader = readFileSync(join(root, 'scripts/aml/load-pep-officeholders.mjs'), 'utf8');
const migration = readFileSync(
  join(root, 'supabase/migrations/20260927000000_aml_pep_officeholder_index.sql'), 'utf8');

const binding = (over = {}) => ({
  person: { value: 'http://www.wikidata.org/entity/Q42' },
  personLabel: { value: 'Pat Example' },
  positionLabel: { value: 'member of the Australian House of Representatives' },
  ...over,
});
const results = (bindings) => ({ results: { bindings } });

/* ── the parser ───────────────────────────────────────────────────────── */

test('one row per person, with every term carried rather than repeated', () => {
  const rows = parseWikidataOfficeholders(results([
    binding({ start: { value: '2016-07-02T00:00:00Z' }, end: { value: '2019-05-18T00:00:00Z' } }),
    binding({ start: { value: '2019-05-18T00:00:00Z' }, end: { value: '2022-05-21T00:00:00Z' } }),
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].external_id, 'Q42');
  assert.equal(rows[0].source_detail.position_count, 2);
});

test('the office SHOWN is the current one, else the most recent', () => {
  const rows = parseWikidataOfficeholders(results([
    binding({
      positionLabel: { value: 'member of the Australian House of Representatives' },
      start: { value: '2010-01-01T00:00:00Z' }, end: { value: '2013-01-01T00:00:00Z' },
    }),
    binding({ positionLabel: { value: 'Minister for Finance' }, start: { value: '2020-01-01T00:00:00Z' } }),
  ]));
  assert.equal(rows[0].position_title, 'Minister for Finance');
  assert.equal(rows[0].currently_held, true);
});

test('a former office holder is INDEXED, never filtered out', () => {
  // Leaving a position does not end the risk — the treatment is a risk
  // assessment, not an expiry date — so the index carries them and the
  // determination decides.
  const rows = parseWikidataOfficeholders(results([
    binding({ start: { value: '1934-09-15T00:00:00Z' }, end: { value: '1966-02-17T00:00:00Z' } }),
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currently_held, false);
  assert.equal(rows[0].position_end, '1966-02-17');
});

test('"no end date recorded" is not "still in office" when there is no start either', () => {
  const rows = parseWikidataOfficeholders(results([binding()]));
  assert.equal(rows[0].currently_held, null);
});

test('a Q-id label is not a name and not an office', () => {
  // The label service emits the raw entity id when it has no English label.
  // Indexed as a name it is unsearchable noise; shown as an office it is a
  // machine id where the position should be.
  assert.deepEqual(parseWikidataOfficeholders(results([
    binding({ personLabel: { value: 'Q23939864' } }),
  ])), []);
  assert.deepEqual(parseWikidataOfficeholders(results([
    binding({ positionLabel: { value: 'Q12345' } }),
  ])), []);
});

test('aliases are collected, de-duplicated, and never the primary name again', () => {
  const rows = parseWikidataOfficeholders(results([
    binding({ altLabel: { value: 'Patricia Example' } }),
    binding({ altLabel: { value: 'Patricia Example' } }),
    binding({ altLabel: { value: 'Pat Example' } }),
  ]));
  assert.deepEqual(rows[0].aliases, ['Patricia Example']);
});

test('a malformed response is no rows, never a throw', () => {
  for (const bad of [null, {}, { results: {} }, { results: { bindings: 'x' } }]) {
    assert.deepEqual(parseWikidataOfficeholders(bad), []);
  }
});

test('every row can say where to CONFIRM it', () => {
  const rows = parseWikidataOfficeholders(results([binding()]));
  assert.ok(rows[0].confirm_url.startsWith('https://'));
});

/* ── normalisation ────────────────────────────────────────────────────── */

test('names are indexed with the SAME function the query uses', () => {
  // Not a stylistic preference. The search is a token overlap against
  // `normalised_names`; a second implementation that dropped one more
  // honorific would write rows no query can ever match.
  const row = withNormalisedNames({
    external_id: 'Q42', full_name: 'Sir Pat Example',
    aliases: ['Patricia Example'], position_title: 'Senator',
  }, 'wikidata_au_public_office', null);
  assert.deepEqual(row.normalised_names,
    [...new Set([...normaliseName('Sir Pat Example'), ...normaliseName('Patricia Example')])]);
  assert.ok(!row.normalised_names.includes('sir'));
});

test('a row with no searchable tokens is dropped by the loader and refused by the column', () => {
  const row = withNormalisedNames({
    external_id: 'Q1', full_name: 'Mr', aliases: [], position_title: 'Senator',
  }, 'wikidata_au_public_office', null);
  assert.deepEqual(row.normalised_names, []);
  assert.match(loader, /filter\(\(r\) => r\.normalised_names\.length > 0\)/);
  assert.match(migration, /cardinality\(normalised_names\) > 0/);
});

/* ── the loader's rules, each of which cost a production incident ─────── */

test('an index that parsed to zero entries is never published', () => {
  // An empty index is not "nobody holds public office"; it is a download
  // that failed, and it answers a search with the same zero rows.
  assert.match(loader, /refusing to publish an empty index/);
});

test('a shrink is a truncated response until a person says otherwise', () => {
  assert.match(loader, /PRUNE_SHRINK_FLOOR/);
  assert.match(loader, /--force-prune/);
});

test("the prune names sync_id in the RETURNING projection", () => {
  // On a MUTATION, PostgREST resolves the columns inside a logical or=(…)
  // against the RETURNING projection rather than the table, and answers
  // 42703 for a column the table plainly has. On the sanctions loader that
  // failed every load it was part of.
  const prune = loader.slice(loader.indexOf("from('pep_officeholders').delete()"));
  assert.match(prune, /\.select\('id, sync_id'\)/);
  assert.match(prune, /sync_id\.is\.null,sync_id\.neq\./);
});

test('a failed load is RECORDED as failed, so a search can refuse rather than return nothing', () => {
  assert.match(loader, /status: 'failed'/);
  assert.match(loader, /error_message/);
});

test('the query carries former holders and does not filter by date', () => {
  assert.match(WIKIDATA_AU_QUERY, /pq:P582/);
  assert.doesNotMatch(WIKIDATA_AU_QUERY, /FILTER\s*\(\s*!\s*BOUND\s*\(\s*\?end/i);
});

/* ── what the table itself promises ───────────────────────────────────── */

test('the table says out loud that it cannot clear anybody', () => {
  assert.match(migration, /A HIT is a CANDIDATE/i);
  assert.match(migration, /not a clearance/i);
});

test('reads go through the service role only, so coverage travels with the result', () => {
  assert.match(migration, /pep_officeholders_service_only/);
  assert.match(migration, /FOR ALL TO service_role/);
});
