#!/usr/bin/env node
/**
 * Load the public office-holder index into `aml.pep_officeholders`.
 *
 * This is the SECOND register this platform loads, and it is not the same
 * kind of thing as the first. A sanctions list is authoritative and a match
 * against it is an outcome; this index is partial by construction, and a
 * search of it produces a CANDIDATE or nothing. Nothing here can clear
 * anybody, and the read path is written so that a caller cannot render "0
 * candidates" without also rendering what the index does and does not cover.
 *
 * Sources are public and unlicensed. OpenSanctions' PEP dataset is
 * deliberately not used for the same reason its sanctions data is not: the
 * aggregation is CC-BY-NC and we are a commercial user.
 *
 * Every hard-won rule from `load-sanctions-lists.mjs` is repeated here on
 * purpose, because each one cost a production incident:
 *
 *   - refuse to publish a source that parsed to ZERO entries;
 *   - a shrink is a truncated download until a person says otherwise;
 *   - the prune's `or()` must name `sync_id` in the RETURNING projection,
 *     or PostgREST answers 42703 and the whole load records as failed;
 *   - node 22 or later, because `createClient` builds a RealtimeClient that
 *     demands a native WebSocket.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/aml/load-pep-officeholders.mjs [options]
 *
 * Options:
 *   --source wikidata_au_public_office   Sources to load (default: all)
 *   --file <path>       Read the SPARQL JSON from disk instead of querying.
 *                       Use when the endpoint is unreachable — an official
 *                       site answering 403 to a scripted client is the norm
 *                       here, not the exception.
 *   --dry-run           Parse and report; write nothing.
 *   --no-prune          Keep entries that have vanished from the source.
 *   --force-prune       Prune even when the source shrank implausibly.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  WIKIDATA_AU_QUERY, parseWikidataOfficeholders, withNormalisedNames,
} from './pepOfficeholderParsers.mjs';

const SOURCES = {
  wikidata_au_public_office: {
    label: 'Australian public office holders (Wikidata)',
    endpoint: 'https://query.wikidata.org/sparql',
    query: WIKIDATA_AU_QUERY,
    parse: parseWikidataOfficeholders,
  },
};

/* A shrunken index is far more likely to be a truncated or throttled
   response than a mass exit from public life. */
const PRUNE_SHRINK_FLOOR = 0.5;

/* Wikidata asks for a descriptive agent with a contact route, and throttles
   anonymous generic ones. */
const UA = 'npc-aml-pep-officeholder-index/1.0 (AML/CTF compliance; admin@npcservices.com.au)';

function arg(name, argv) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function runSparql(source) {
  const url = `${source.endpoint}?query=${encodeURIComponent(source.query)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
    // The full query is minutes of work on the public endpoint. A short
    // timeout here would produce a partial index, which is worse than none.
    signal: AbortSignal.timeout(20 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`${source.endpoint} answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { json: JSON.parse(buf.toString('utf8')), buf };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const prune = !argv.includes('--no-prune');
  const forcePrune = argv.includes('--force-prune');
  const file = arg('--file', argv);
  const sources = argv.includes('--source')
    ? (arg('--source', argv) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    : Object.keys(SOURCES);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !key)) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --dry-run).');
    process.exit(1);
  }
  const admin = dryRun ? null : createClient(url, key);

  for (const code of sources) {
    const source = SOURCES[code];
    if (!source) { console.error(`unknown source: ${code}`); process.exitCode = 1; continue; }

    console.log(`\n=== ${code} — ${source.label}`);
    let sync = null;
    if (admin) {
      const { data, error } = await admin.schema('aml').from('pep_officeholder_syncs')
        .insert({ source_code: code, status: 'running' }).select('id').single();
      if (error) { console.error(`  ✗ could not open a sync row: ${error.message}`); process.exitCode = 1; continue; }
      sync = data;
    }

    try {
      let json, payload;
      if (file) {
        payload = readFileSync(file);
        json = JSON.parse(payload.toString('utf8'));
        console.log(`  read ${file} (${payload.length} bytes)`);
      } else {
        const r = await runSparql(source);
        json = r.json; payload = r.buf;
      }

      const parsed = source.parse(json);
      if (parsed.length === 0) {
        // The sanctions rule, and it applies here for a different reason:
        // an empty index is not "nobody is an office holder", it is a
        // download that failed, and a search against it returns the same
        // zero rows a real search would.
        throw new Error('parser produced 0 entries — refusing to publish an empty index');
      }

      const sha = createHash('sha256').update(payload).digest('hex');
      const rows = parsed
        .map((e) => withNormalisedNames(e, code, sync?.id))
        .filter((r) => r.normalised_names.length > 0);

      console.log(`  parsed ${parsed.length}, searchable ${rows.length}, sha256 ${sha.slice(0, 16)}…`);
      if (dryRun) {
        console.log('  dry run — not written');
        console.log('  sample:', JSON.stringify(rows[0], null, 2).slice(0, 800));
        continue;
      }

      const { count: before } = await admin.schema('aml').from('pep_officeholders')
        .select('id', { count: 'exact', head: true }).eq('source_code', code);

      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = await admin.schema('aml').from('pep_officeholders')
          .upsert(chunk, { onConflict: 'source_code,external_id' });
        if (error) throw error;
        process.stdout.write(`\r  upserted ${Math.min(i + 500, rows.length)}/${rows.length}`);
      }
      console.log('');

      let pruned = 0;
      if (prune) {
        const shrankTooFar = (before ?? 0) > 0 && rows.length < (before ?? 0) * PRUNE_SHRINK_FLOOR;
        if (shrankTooFar && !forcePrune) {
          console.warn(
            `  ! ${code} went from ${before} to ${rows.length} entries. That is more likely a ` +
            'truncated response than a real change, so nothing was deleted. ' +
            'Re-run with --force-prune if the shrink is real.',
          );
          process.exitCode = 1;
        } else {
          // `sync_id` MUST be named in the projection. On a MUTATION,
          // PostgREST resolves the columns inside a logical `or=(…)` against
          // the RETURNING projection rather than the table, and answers
          // `42703 column … does not exist` for a column the table plainly
          // has. On the sanctions loader that failed EVERY load it was part
          // of, and the failure recorded as a failed sync, which fails the
          // provider closed. Same filter, same fix, same reason.
          const { data: removed, error: pruneErr } = await admin.schema('aml')
            .from('pep_officeholders').delete().eq('source_code', code)
            .or(`sync_id.is.null,sync_id.neq.${sync.id}`).select('id, sync_id');
          if (pruneErr) throw pruneErr;
          pruned = (removed ?? []).length;
          if (pruned) console.log(`  pruned ${pruned} entr${pruned === 1 ? 'y' : 'ies'} no longer in the source`);
        }
      }

      await admin.schema('aml').from('pep_officeholder_syncs').update({
        status: 'succeeded', entry_count: rows.length, removed_count: pruned,
        payload_sha256: sha,
        // The source's own currency. Wikidata is edited continuously, so the
        // query date IS its as-at — unlike a published file, whose control
        // date can be years older than the day it was downloaded.
        source_as_at: new Date().toISOString().slice(0, 10),
        completed_at: new Date().toISOString(),
      }).eq('id', sync.id);
      console.log(`  ✓ ${code} loaded (${rows.length} entries, ${pruned} pruned)`);
    } catch (e) {
      console.error(`  ✗ ${code} failed: ${e.message}`);
      if (admin && sync) {
        await admin.schema('aml').from('pep_officeholder_syncs').update({
          status: 'failed', error_message: String(e.message).slice(0, 1000),
          completed_at: new Date().toISOString(),
        }).eq('id', sync.id);
      }
      process.exitCode = 1;
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
