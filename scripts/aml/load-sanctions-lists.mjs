#!/usr/bin/env node
/**
 * Load the official sanctions lists into `aml.sanctions_entries`.
 *
 * Sources are the PUBLISHERS' own files, not an aggregator:
 *   - DFAT Consolidated List — the legally operative Australian source
 *   - UN Consolidated List
 *   - OFAC SDN
 *
 * OpenSanctions is deliberately not used. Its aggregated data is CC-BY-NC and
 * we are a commercial user; the engine is free, the list is not.
 *
 * Names are normalised at write time with the SAME function the screening
 * query uses, so indexing and querying can never drift apart.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/aml/load-sanctions-lists.mjs [--list un,ofac] [--dry-run]
 *
 * DFAT publishes XLSX, which this script does not parse. Export it to CSV and
 * pass --dfat-csv <path>. That is a deliberate limitation rather than a silent
 * partial load: a screening list that is quietly incomplete is worse than one
 * that is obviously absent.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SOURCES = {
  un: {
    url: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
    label: 'UN Consolidated List',
  },
  ofac: {
    url: 'https://www.treasury.gov/ofac/downloads/sdn.csv',
    label: 'OFAC SDN',
  },
  dfat: {
    url: 'https://www.dfat.gov.au/international-relations/security/sanctions/consolidated-list',
    label: 'DFAT Consolidated List (Australia)',
  },
};

/* ── normalisation: must mirror _shared/aml/matching.ts exactly ─────────── */

const HONORIFICS = new Set(['mr','mrs','ms','miss','mx','dr','prof','professor','sir','dame','lord','lady','rev','reverend','hon','honourable','honorable','sheikh','sheik','shaikh','haji','hajji','sayyid','sayed','general','gen','col','colonel','maj','major','capt','captain','lt','lieutenant','sgt','sergeant','adm','admiral','brig','brigadier','president','minister','senator','governor','ambassador']);
const ENTITY_SUFFIXES = new Set(['pty','ltd','limited','llc','lp','llp','inc','incorporated','corp','corporation','co','company','plc','gmbh','ag','sa','nv','bv','srl','spa','oyj','ab','as','aps','kk','pte','sdn','bhd','trust','trustee','trustees','holdings','group','international']);
const PARTICLES = new Set(['al','el','bin','ibn','bint','van','von','de','del','della','di','da','dos','das','du','la','le','les','ter','ten','op','af','av','san','santa','st']);
const TRANSLIT = { 'æ':'ae','Æ':'ae','ø':'o','Ø':'o','å':'a','Å':'a','ß':'ss','þ':'th','Þ':'th','ð':'d','Ð':'d','đ':'d','Đ':'d','ł':'l','Ł':'l','ŧ':'t','ħ':'h','ı':'i','ő':'o','ű':'u','œ':'oe','Œ':'oe' };

function normaliseName(input) {
  if (!input) return [];
  let s = String(input).toLowerCase();
  s = s.replace(/[æÆøØåÅßþÞðÐđĐłŁŧħıőűœŒ]/g, (c) => TRANSLIT[c] ?? c);
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[''`´]/g, '').replace(/[^a-z0-9]+/g, ' ');
  return s.split(' ').map((t) => t.trim()).filter(Boolean)
    .filter((t) => !HONORIFICS.has(t))
    .filter((t) => !ENTITY_SUFFIXES.has(t))
    .filter((t) => !PARTICLES.has(t))
    .filter((t) => t.length > 1);
}

/* ── parsers ────────────────────────────────────────────────────────────── */

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** OFAC SDN: fixed positional CSV, no header. */
function parseOfac(text) {
  const out = [];
  for (const r of parseCsv(text)) {
    if (r.length < 12) continue;
    const [uid, name, type, , , , , , , , , remarks] = r;
    if (!uid || !name || name === '-0- ') continue;
    const aliases = [];
    // DOB and aka data live in the free-text remarks column.
    const dobMatch = String(remarks ?? '').match(/DOB\s+([^;]+)/i);
    out.push({
      external_id: `OFAC-${uid.trim()}`,
      primary_name: name.trim(),
      aliases,
      entry_type: /individual/i.test(type ?? '') ? 'individual'
        : /vessel/i.test(type ?? '') ? 'vessel'
        : /aircraft/i.test(type ?? '') ? 'aircraft' : 'entity',
      date_of_birth: dobMatch ? dobMatch[1].trim() : null,
      listing_reference: 'OFAC SDN',
      listing_detail: { remarks: (remarks ?? '').slice(0, 2000) },
    });
  }
  return out;
}

/** UN consolidated XML — regex-scanned rather than DOM-parsed (no deps). */
function parseUn(xml) {
  const out = [];
  const blocks = xml.split(/<\/(?:INDIVIDUAL|ENTITY)>/i);
  for (const block of blocks) {
    const isIndividual = /<INDIVIDUAL[\s>]/i.test(block);
    const isEntity = /<ENTITY[\s>]/i.test(block);
    if (!isIndividual && !isEntity) continue;

    const pick = (tag) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i')) ?? [])[1]?.trim() ?? '';
    const id = pick('DATAID');
    if (!id) continue;

    const nameParts = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME']
      .map(pick).filter(Boolean);
    const primary = nameParts.join(' ').trim();
    if (!primary) continue;

    const aliases = [...block.matchAll(/<ALIAS_NAME>([^<]*)<\/ALIAS_NAME>/gi)]
      .map((m) => m[1].trim()).filter(Boolean);
    const year = (block.match(/<YEAR>([^<]*)<\/YEAR>/i) ?? [])[1]?.trim();
    const dateStr = (block.match(/<DATE>([^<]*)<\/DATE>/i) ?? [])[1]?.trim();

    out.push({
      external_id: `UN-${id}`,
      primary_name: primary,
      aliases,
      entry_type: isIndividual ? 'individual' : 'entity',
      date_of_birth: dateStr || year || null,
      listing_reference: pick('REFERENCE_NUMBER') || 'UN Consolidated List',
      listing_detail: { comments: pick('COMMENTS1').slice(0, 2000) },
    });
  }
  return out;
}

/** DFAT CSV export — column names as published. */
function parseDfat(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const iRef = col('reference');
  const iName = col('name of individual or entity', 'name');
  const iType = col('type');
  const iDob = col('date of birth', 'dob');
  const iAlias = col('additional information', 'aka', 'also known as');
  const iCommittee = col('committees', 'committee');

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[iName] ?? '').trim();
    if (!name) continue;
    const ref = (row[iRef] ?? `ROW${r}`).trim();
    out.push({
      external_id: `DFAT-${ref}`,
      primary_name: name,
      aliases: (row[iAlias] ?? '').split(/[;|]/).map((a) => a.trim()).filter(Boolean).slice(0, 20),
      entry_type: /individual/i.test(row[iType] ?? '') ? 'individual' : 'entity',
      date_of_birth: (row[iDob] ?? '').trim() || null,
      listing_reference: (row[iCommittee] ?? '').trim() || 'Autonomous Sanctions Regulations 2011',
      listing_detail: {},
    });
  }
  return out;
}

/* ── loader ─────────────────────────────────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const listArg = (args[args.indexOf('--list') + 1] ?? 'un,ofac');
  const lists = args.includes('--list') ? listArg.split(',').map((s) => s.trim()) : ['un', 'ofac'];
  const dfatCsvPath = args.includes('--dfat-csv') ? args[args.indexOf('--dfat-csv') + 1] : null;
  if (dfatCsvPath && !lists.includes('dfat')) lists.push('dfat');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !key)) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --dry-run).');
    process.exit(1);
  }
  const admin = dryRun ? null : createClient(url, key);

  for (const list of lists) {
    const source = SOURCES[list];
    if (!source) { console.error(`unknown list: ${list}`); continue; }

    console.log(`\n=== ${list} — ${source.label}`);
    let sync = null;
    if (admin) {
      const { data } = await admin.schema('aml').from('sanctions_list_syncs')
        .insert({ list_code: list, source_url: source.url, status: 'pending' })
        .select('id').single();
      sync = data;
    }

    try {
      let raw;
      if (list === 'dfat') {
        if (!dfatCsvPath) {
          // Refuse rather than load nothing and report success.
          throw new Error(
            'DFAT publishes XLSX. Export it to CSV and pass --dfat-csv <path>. ' +
            'Refusing to record a successful sync with no entries.',
          );
        }
        raw = readFileSync(dfatCsvPath, 'utf8');
      } else {
        const res = await fetch(source.url, { headers: { 'User-Agent': 'aml-sanctions-loader/1.0' } });
        if (!res.ok) throw new Error(`${source.url} returned ${res.status}`);
        raw = await res.text();
      }

      const sha = createHash('sha256').update(raw).digest('hex');
      const parsed = list === 'ofac' ? parseOfac(raw)
        : list === 'un' ? parseUn(raw)
        : parseDfat(raw);

      if (parsed.length === 0) throw new Error('parser produced 0 entries — refusing to publish an empty list');

      const rows = parsed.map((e) => ({
        list_code: list,
        ...e,
        normalised_names: [...new Set(
          [e.primary_name, ...(e.aliases ?? [])].flatMap((n) => {
            const t = normaliseName(n);
            return t.length ? t : [];
          }),
        )],
        sync_id: sync?.id ?? null,
        updated_at: new Date().toISOString(),
      })).filter((r) => r.normalised_names.length > 0);

      console.log(`  parsed ${parsed.length}, usable ${rows.length}, sha256 ${sha.slice(0, 16)}…`);
      if (dryRun) { console.log('  dry run — not written'); console.log('  sample:', rows[0]); continue; }

      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = await admin.schema('aml').from('sanctions_entries')
          .upsert(chunk, { onConflict: 'list_code,external_id' });
        if (error) throw error;
        process.stdout.write(`\r  upserted ${Math.min(i + 500, rows.length)}/${rows.length}`);
      }
      console.log('');

      await admin.schema('aml').from('sanctions_list_syncs').update({
        status: 'succeeded', entry_count: rows.length,
        payload_sha256: sha, completed_at: new Date().toISOString(),
      }).eq('id', sync.id);
      console.log(`  ✓ ${list} loaded`);
    } catch (e) {
      console.error(`  ✗ ${list} failed: ${e.message}`);
      if (admin && sync) {
        await admin.schema('aml').from('sanctions_list_syncs').update({
          status: 'failed', error_detail: String(e.message).slice(0, 1000),
          completed_at: new Date().toISOString(),
        }).eq('id', sync.id);
      }
      process.exitCode = 1;
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
