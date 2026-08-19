/**
 * Parse public office-holder sources into index rows.
 *
 * Pure: takes bytes or parsed JSON, returns rows. Every I/O concern lives in
 * `load-pep-officeholders.mjs`, so this file can be unit-tested without a
 * network or a database.
 *
 * `normaliseName` is imported from `sanctionsParsers.mjs` rather than
 * re-implemented. Names in this table are searched by the SAME token overlap
 * the sanctions screening uses; a second implementation that drifted by one
 * honorific would write rows no query can ever match, which looks exactly
 * like an index that works.
 */
import { normaliseName } from './sanctionsParsers.mjs';

/**
 * The SPARQL query behind the Wikidata source.
 *
 * `wdt:P279*` walks the subclass tree from "public office of Australia", so
 * this picks up parliamentarians, ministers, judges, heads of agency and the
 * state and territory equivalents without naming each one — a hand-written
 * list of offices is a list that goes out of date silently.
 *
 * Position dates are kept and never used to FILTER. A former office holder
 * is assessed on risk rather than written off by the passage of time, so the
 * index carries them and the determination decides.
 */
export const WIKIDATA_AU_QUERY = `
SELECT ?person ?personLabel ?positionLabel ?start ?end ?altLabel ?article WHERE {
  ?person p:P39 ?statement .
  ?statement ps:P39 ?position .
  ?position wdt:P279* wd:Q18912794 .
  OPTIONAL { ?statement pq:P580 ?start }
  OPTIONAL { ?statement pq:P582 ?end }
  OPTIONAL {
    ?article schema:about ?person ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  OPTIONAL { ?person skos:altLabel ?altLabel FILTER (lang(?altLabel) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`.trim();

const text = (b, k) => {
  const v = b?.[k]?.value;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
};

/** `2016-07-02T00:00:00Z` → `2016-07-02`; anything else → null. */
const asDate = (v) => {
  if (!v) return null;
  const m = /^(-?\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/**
 * A Wikidata label that is really a Q-id ("Q23939864") is the label service
 * having no English label for the entity. Indexing that as a NAME would put
 * an unsearchable string in the table and, worse, could match a real query
 * token; indexing it as a POSITION would show an operator a machine id where
 * the office should be.
 */
const isQid = (s) => typeof s === 'string' && /^Q\d+$/.test(s);

/**
 * SPARQL JSON → index rows, one per person (positions merged).
 *
 * One row per person rather than per position, because the operator's
 * question is "is this person an office holder", and five rows for five
 * terms of the same seat is five times the reading for no more information.
 * The positions are carried in `source_detail` so nothing is lost.
 */
export function parseWikidataOfficeholders(json) {
  const bindings = json?.results?.bindings;
  if (!Array.isArray(bindings)) return [];

  const byPerson = new Map();
  for (const b of bindings) {
    const uri = text(b, 'person');
    const name = text(b, 'personLabel');
    const position = text(b, 'positionLabel');
    if (!uri || !name || !position) continue;
    if (isQid(name) || isQid(position)) continue;

    const qid = uri.split('/').pop();
    let row = byPerson.get(qid);
    if (!row) {
      row = {
        external_id: qid,
        full_name: name,
        aliases: new Set(),
        positions: [],
        article: text(b, 'article'),
      };
      byPerson.set(qid, row);
    }
    const alias = text(b, 'altLabel');
    if (alias && !isQid(alias) && alias !== name) row.aliases.add(alias);
    if (!row.article) row.article = text(b, 'article');

    const start = asDate(text(b, 'start'));
    const end = asDate(text(b, 'end'));
    const key = `${position}|${start ?? ''}|${end ?? ''}`;
    if (!row.positions.some((p) => p.key === key)) {
      row.positions.push({ key, title: position, start, end });
    }
  }

  return [...byPerson.values()].map((row) => {
    // The office to SHOW is the one that is current, else the most recent —
    // an operator scanning candidates needs the position that makes this
    // person worth a second look, not whichever term the query emitted first.
    const sorted = row.positions.slice().sort((a, b) => {
      const aOpen = a.end === null, bOpen = b.end === null;
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      return String(b.end ?? b.start ?? '').localeCompare(String(a.end ?? a.start ?? ''));
    });
    const lead = sorted[0];
    /*
     * `currently_held` is null when the source does not say, NEVER false.
     * An open-ended statement on Wikidata means "no end date recorded",
     * which is not the same as "still in office" — but a start date with no
     * end is the only positive signal the source has, so it is reported as
     * `true` and the absence of any date at all is reported as unknown.
     */
    const currentlyHeld = lead.end !== null ? false : (lead.start !== null ? true : null);
    return {
      external_id: row.external_id,
      full_name: row.full_name,
      aliases: [...row.aliases].slice(0, 12),
      position_title: lead.title,
      pep_type: 'domestic',
      jurisdiction: 'Australia',
      position_start: lead.start,
      position_end: lead.end,
      currently_held: currentlyHeld,
      // Where an operator goes to read about the candidate before deciding
      // it is worth confirming against the official register.
      confirm_url: row.article ?? `https://www.wikidata.org/wiki/${row.external_id}`,
      source_detail: {
        positions: sorted.map(({ title, start, end }) => ({ title, start, end })),
        position_count: sorted.length,
      },
    };
  });
}

/**
 * Attach the searchable tokens and the sync id.
 *
 * Identical in shape to `withNormalisedNames` in `sanctionsParsers.mjs`, and
 * deliberately using the same `normaliseName`.
 */
export function withNormalisedNames(entry, sourceCode, syncId) {
  const normalised = [...new Set(
    [entry.full_name, ...(entry.aliases ?? [])].flatMap((n) => normaliseName(n)),
  )];
  return {
    source_code: sourceCode,
    external_id: entry.external_id,
    full_name: entry.full_name,
    aliases: entry.aliases ?? [],
    normalised_names: normalised,
    position_title: entry.position_title,
    pep_type: entry.pep_type ?? 'domestic',
    jurisdiction: entry.jurisdiction ?? null,
    position_start: entry.position_start ?? null,
    position_end: entry.position_end ?? null,
    currently_held: entry.currently_held ?? null,
    confirm_url: entry.confirm_url ?? null,
    source_detail: entry.source_detail ?? {},
    sync_id: syncId ?? null,
    updated_at: new Date().toISOString(),
  };
}
