/**
 * Loading the official sanctions lists, server-side.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 * `aml.sanctions_entries` has been empty since the platform was built, so
 * every screening attempt fails closed and Stage 5 cannot complete for any
 * customer. The only way to load it was `scripts/aml/load-sanctions-lists.mjs`
 * — a Node script needing the production service-role key on somebody's
 * laptop AND a successful download from dfat.gov.au.
 *
 * Neither holds. Measured from this environment: DFAT answers **HTTP 403** to
 * a scripted request (its own bot protection — the loader already carries
 * `--dfat-file` and `--dfat-url` escape hatches "when the site is
 * unreachable"), and handing a production service-role key to whoever
 * happens to be running the script is not a control anyone should want.
 *
 * A person with a browser is not blocked by either. So the file is fetched
 * by a human, the rows are read out of the workbook in the browser, and the
 * MAPPING and NORMALISATION happen here — on the server, from the raw rows.
 *
 * ── The rule that decides the split ───────────────────────────────────
 * The browser gets the cells out of the container and nothing else.
 *
 * Normalisation must never happen client-side, because the loader's own rule
 * is that names are normalised at write time with the SAME function the
 * screening query uses, so indexing and querying cannot drift apart. A
 * browser that normalised differently — a stale bundle, a different locale —
 * would write entries that no query can ever match, and a sanctions list
 * that silently matches nobody is indistinguishable from a working one.
 *
 * Every constant and every mapping below is taken verbatim from
 * `scripts/aml/sanctionsParsers.mjs`, which stays the batch path. A test
 * re-checks the two against each other.
 */

export const HONORIFICS = new Set(['mr','mrs','ms','miss','mx','dr','prof','professor','sir','dame','lord','lady','rev','reverend','hon','honourable','honorable','sheikh','sheik','shaikh','haji','hajji','sayyid','sayed','general','gen','col','colonel','maj','major','capt','captain','lt','lieutenant','sgt','sergeant','adm','admiral','brig','brigadier','president','minister','senator','governor','ambassador']);

export const ENTITY_SUFFIXES = new Set(['pty','ltd','limited','llc','lp','llp','inc','incorporated','corp','corporation','co','company','plc','gmbh','ag','sa','nv','bv','srl','spa','oyj','ab','as','aps','kk','pte','sdn','bhd','trust','trustee','trustees','holdings','group','international']);

export const PARTICLES = new Set(['al','el','bin','ibn','bint','van','von','de','del','della','di','da','dos','das','du','la','le','les','ter','ten','op','af','av','san','santa','st']);

export const TRANSLIT: Record<string, string> = { 'æ':'ae','Æ':'ae','ø':'o','Ø':'o','å':'a','Å':'a','ß':'ss','þ':'th','Þ':'th','ð':'d','Ð':'d','đ':'d','Đ':'d','ł':'l','Ł':'l','ŧ':'t','ħ':'h','ı':'i','ő':'o','ű':'u','œ':'oe','Œ':'oe' };

/** DFAT column spellings, in preference order. */
const DFAT_COLUMNS: Record<string, string[]> = {
  reference: ['reference', 'ref', 'listing reference'],
  name: ['name of individual or entity', 'name', 'name of individual/entity', 'individual/entity'],
  nameType: ['name type', 'type of name', 'nametype'],
  type: ['type', 'individual/entity', 'entity type'],
  dob: ['date of birth', 'dob', 'birth date'],
  pob: ['place of birth', 'pob'],
  citizenship: ['citizenship', 'nationality', 'nationalities'],
  address: ['address'],
  additional: ['additional information', 'aka', 'also known as', 'other information'],
  committee: ['committees', 'committee', 'listing information', 'sanctions regime'],
};


/**
 * Reduce a name to the tokens a match is made on.
 *
 * Honorifics, entity suffixes and name particles are dropped because they
 * carry no identifying information and would otherwise match everybody.
 */
export function normaliseName(input: unknown): string[] {
  if (!input) return [];
  let s = String(input).toLowerCase();
  s = s.replace(/[æÆøØåÅßþÞðÐđĐłŁŧħıőűœŒ]/g, (c) => TRANSLIT[c] ?? c);
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/['’`´]/g, "").replace(/[^a-z0-9]+/g, " ");
  return s.split(" ").map((t) => t.trim()).filter(Boolean)
    .filter((t) => !HONORIFICS.has(t))
    .filter((t) => !ENTITY_SUFFIXES.has(t))
    .filter((t) => !PARTICLES.has(t))
    .filter((t) => t.length > 1);
}

export interface SanctionsEntry {
  external_id: string;
  primary_name: string;
  aliases: string[];
  entry_type: "individual" | "entity" | "unknown";
  date_of_birth: string | null;
  place_of_birth: string | null;
  nationalities: string[];
  listing_reference: string;
  listing_detail: Record<string, unknown>;
}

/**
 * Find the header row. DFAT sometimes ships a title or blurb row above the
 * table, so the first row is not reliably the header — it is located by a
 * recognisable name column instead of by position.
 */
function locateHeader(rows: unknown[][], maxScan = 15): number {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const cells = (rows[i] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
    if (cells.some((c) => DFAT_COLUMNS.name.includes(c))) return i;
  }
  return -1;
}

/**
 * Convert a header-mapped table into sanctions entries.
 *
 * DFAT publishes ONE ROW PER NAME VARIANT, with alias rows repeating the
 * listing's reference. Rows are grouped by reference: the primary name is the
 * row marked as such, every other row for that reference becomes an alias.
 * Treating each row as its own listing would collide on
 * (list_code, external_id) and leave whichever alias sorted last standing in
 * as the person's primary name.
 *
 * It throws rather than guessing at column positions. A misread column is a
 * sanctions list that matches the wrong people, which is worse than a refusal.
 */
export function rowsToDfatEntries(rows: unknown[][]): SanctionsEntry[] {
  const headerIdx = locateHeader(rows);
  if (headerIdx < 0) {
    throw new Error(
      "could not find a DFAT header row containing a recognisable name column " +
      `(looked for one of: ${DFAT_COLUMNS.name.join(", ")}). ` +
      "Refusing to guess at column positions.",
    );
  }
  const header = (rows[headerIdx] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
  const col = (key: string) => {
    for (const n of DFAT_COLUMNS[key]) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const idx: Record<string, number> = Object.fromEntries(
    Object.keys(DFAT_COLUMNS).map((k) => [k, col(k)]));
  if (idx.name < 0) throw new Error("DFAT header located but the name column resolved to -1");

  const cell = (row: unknown[], i: number) => (i >= 0 ? String(row[i] ?? "").trim() : "");
  interface Group {
    reference: string; primaryName: string | null; names: string[];
    dobs: string[]; pobs: string[]; citizenships: string[];
    addresses: string[]; additional: string[]; committees: string[]; type: string;
  }
  const grouped = new Map<string, Group>();

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = cell(row, idx.name);
    if (!name) continue;
    // Rows without their own reference belong to the listing above them.
    const ref = cell(row, idx.reference) || `ROW${r}`;
    if (!grouped.has(ref)) {
      grouped.set(ref, {
        reference: ref, primaryName: null, names: [], dobs: [], pobs: [],
        citizenships: [], addresses: [], additional: [], committees: [], type: "",
      });
    }
    const g = grouped.get(ref)!;
    const nameType = cell(row, idx.nameType);
    if (!g.primaryName && (!nameType || /primary|main/i.test(nameType))) g.primaryName = name;
    g.names.push(name);
    const push = (arr: string[], v: string) => { if (v && !arr.includes(v)) arr.push(v); };
    push(g.dobs, cell(row, idx.dob));
    push(g.pobs, cell(row, idx.pob));
    push(g.citizenships, cell(row, idx.citizenship));
    push(g.addresses, cell(row, idx.address));
    push(g.additional, cell(row, idx.additional));
    push(g.committees, cell(row, idx.committee));
    if (!g.type) g.type = cell(row, idx.type);
  }

  const out: SanctionsEntry[] = [];
  for (const g of grouped.values()) {
    const primary = g.primaryName || g.names[0];
    if (!primary) continue;
    const aliases = [...new Set(g.names.filter((n) => n !== primary))].slice(0, 50);
    out.push({
      external_id: `DFAT-${g.reference}`,
      primary_name: primary,
      aliases,
      entry_type: /individual/i.test(g.type) ? "individual"
        : /entity|organisation|organization/i.test(g.type) ? "entity"
        : "unknown",
      date_of_birth: g.dobs[0] ?? null,
      place_of_birth: g.pobs[0] ?? null,
      nationalities: g.citizenships.slice(0, 10),
      listing_reference: g.committees[0] || "Autonomous Sanctions Regulations 2011",
      listing_detail: {
        all_dates_of_birth: g.dobs.slice(0, 10),
        addresses: g.addresses.slice(0, 5),
        additional_information: g.additional.join(" | ").slice(0, 2000),
        committees: g.committees.slice(0, 10),
        name_variants: g.names.length,
      },
    });
  }
  return out;
}

/** A row ready for `aml.sanctions_entries`, normalised at write time. */
export function withNormalisedNames(
  entry: SanctionsEntry, listCode: string, syncId: string | null, nowIso: string,
) {
  const normalised = [...new Set(
    [entry.primary_name, ...(entry.aliases ?? [])].flatMap((n) => normaliseName(n)),
  )];
  return {
    list_code: listCode,
    external_id: entry.external_id,
    entry_type: entry.entry_type ?? "unknown",
    primary_name: entry.primary_name,
    aliases: entry.aliases ?? [],
    normalised_names: normalised,
    date_of_birth: entry.date_of_birth ?? null,
    place_of_birth: entry.place_of_birth ?? null,
    nationalities: entry.nationalities ?? [],
    listing_reference: entry.listing_reference ?? null,
    listing_detail: entry.listing_detail ?? {},
    sync_id: syncId ?? null,
    updated_at: nowIso,
  };
}

/**
 * A shrunken list is far more likely to be a truncated upload than a mass
 * delisting, so old entries are kept and the load is reported rather than
 * silently deleting most of the register. Mirrors PRUNE_SHRINK_FLOOR in the
 * batch loader.
 */
export const PRUNE_SHRINK_FLOOR = 0.5;

export interface IngestDecision {
  accept: boolean;
  prune: boolean;
  reason: string;
}

export function decideSanctionsIngest(
  incoming: number, existing: number, force = false,
): IngestDecision {
  if (incoming === 0) {
    // A zero-entry load is not a list. Writing it would publish a "successful"
    // sync that returns clear for everybody.
    return { accept: false, prune: false, reason: "the upload contained no usable entries" };
  }
  if (existing > 0 && incoming < existing * PRUNE_SHRINK_FLOOR && !force) {
    return {
      accept: true, prune: false,
      reason: `the upload holds ${incoming} entries against ${existing} already loaded — ` +
        "the new entries are written but nothing is deleted, because a list that " +
        "halves is far more likely to be a truncated file than a mass delisting",
    };
  }
  return { accept: true, prune: true, reason: `${incoming} entries loaded` };
}

/* ──────────────── The last mile: simulator → live ──────────────── */

/**
 * Whether loading this list makes the screening provider able to answer.
 *
 * ── The dead end this closes ──────────────────────────────────────────
 * Loading DFAT was necessary to screen anybody and it was never sufficient.
 * `aml.provider_configs` carries `mode` for `pep_sanctions/local_lists`, and
 * production refuses to run a provider in `simulator` mode
 * (`providerEnvironment.ts`) — correctly, because the screening simulator
 * returns **"clear" for everyone** who does not match a hardcoded keyword.
 *
 * So an MLRO could load the legally operative list in full and Stage 5 would
 * still refuse, with nothing on the page to press: the only way to finish the
 * job was an undocumented UPDATE against `provider_configs`, and no surface in
 * the product performs it.
 *
 * ── Why this belongs to the ingest and not to a switch ────────────────
 * `local_lists` calls no vendor. It queries `aml.sanctions_entries` behind its
 * own freshness gate, so whether it can produce an authoritative answer is
 * decided **by the data** and by nothing else. A separate `mode` flag is a
 * second source of truth about that same fact, and it can only ever disagree
 * with the first in one of two ways:
 *
 *   live + no list    claims readiness it does not have
 *   simulator + list  refuses although it could answer   ← where we were
 *
 * Promoting on a successful load of the legally operative list removes the
 * disagreement by making the flag a CONSEQUENCE of the data rather than a
 * parallel assertion about it. It is the exact moment the assertion becomes
 * true, it is already MLRO-gated, and it is already a recorded compliance act.
 *
 * ── What it deliberately will not do ──────────────────────────────────
 * This is not "flip the mode to make the error go away", which is the thing
 * that must never happen. It promotes ONLY on the legally operative list,
 * ONLY when entries were actually written, and ONLY out of `simulator`:
 *
 *  - a non-DFAT list does not promote. UN and OFAC are corroborating; DFAT is
 *    the Australian TFS source the provider requires.
 *  - a zero-entry write does not promote, so an empty "success" cannot.
 *  - an inactive provider is left inactive. Deactivation is a deliberate act
 *    and reversing it is not a data-loading decision.
 *  - a provider already live is left alone, so a routine refresh is not
 *    recorded as a change.
 *
 * And it never DEMOTES. Freshness stays the provider's own gate: a live flag
 * over a stale list still fails closed as a technical condition, never as a
 * customer outcome. Nothing here can turn a stale list into a clear result.
 */
export const PROMOTING_LIST = "dfat";

export interface ProviderPromotion {
  promote: boolean;
  /** Operator-facing statement of what did or did not change, and why. */
  reason: string;
}

export function decideProviderPromotion(input: {
  listCode: string;
  entriesWritten: number;
  currentMode: string | null | undefined;
  active: boolean | null | undefined;
}): ProviderPromotion {
  if (String(input.listCode).toLowerCase() !== PROMOTING_LIST) {
    return {
      promote: false,
      reason: "Screening readiness is unchanged — it follows the DFAT Consolidated List, "
        + "which is the Australian source the provider requires.",
    };
  }
  if (!(input.entriesWritten > 0)) {
    return {
      promote: false,
      reason: "Screening readiness is unchanged, because no entries were written.",
    };
  }
  if (input.active !== true) {
    return {
      promote: false,
      reason: "The list is loaded, but the screening provider is deactivated. Reactivating "
        + "it is a deliberate decision and is not made by loading data.",
    };
  }
  if (String(input.currentMode) === "live") {
    return {
      promote: false,
      reason: "Screening was already live; the list has been refreshed.",
    };
  }
  return {
    promote: true,
    reason: "Screening is now live. The provider was in simulator mode, which production "
      + "refuses to run, so the list alone could not have completed a single check.",
  };
}

/* ──────────────── How current the DATA is, not the upload ──────────────── */

/**
 * The newest listing in the file, and whether that makes it a current list.
 *
 * ── The near-miss this exists to stop ─────────────────────────────────
 * Every freshness control in this platform measures WHEN WE SYNCED.
 * `sanctions_list_syncs.completed_at`, the 72-hour provider gate, the
 * 7-day banner on the health card — all of them read the timestamp of the
 * load, and none of them reads the data.
 *
 * So a stale file uploaded today is indistinguishable from a current one.
 * Worse than indistinguishable: it passes every check, because the load is
 * genuinely recent. Measured while trying to load this list for real,
 * DFAT's own canonical URL
 *
 *     /sites/default/files/regulation8_consolidated.xlsx
 *
 * answers 404 with `location: …/regulation8_consolidated_2.xls` — its own
 * Drupal redirect — and that file's newest Control Date is **2022-01-07**.
 * 7,840 rows, structurally perfect, and four and a half years out of date.
 *
 * Loading it would have written a `succeeded` sync stamped today, made
 * `dfatLoaded` true, promoted the provider to live, turned every gate green,
 * and screened every customer against a register that predates the entire
 * Russia/Ukraine listing expansion — returning **clear** for all of them.
 *
 * That is the exact outcome this programme exists to prevent, and no control
 * that existed before this function would have caught it.
 *
 * ── What it reads ─────────────────────────────────────────────────────
 * The Control Date column: the date each listing was made or last amended.
 * The newest one across the file is the strongest available statement about
 * how current the file is, and it comes from the publisher rather than from
 * us. A file with no readable dates is reported as unknown and never as
 * fresh — not reading a date is not evidence of currency.
 */

/**
 * A list whose newest listing is older than this cannot be the operative
 * register. DFAT amends the Consolidated List many times a year, so a full
 * year of total silence is not a quiet period, it is the wrong file.
 * Deliberately generous: this must never fire on a genuinely current list.
 */
export const LIST_STALE_AFTER_DAYS = 365;

const CONTROL_DATE_COLUMNS = ["control date", "control_date", "date of listing", "listing date"];

export interface ListRecency {
  /** ISO date of the newest listing found, or null when none could be read. */
  newestListing: string | null;
  ageDays: number | null;
  /** True only when a date was read AND it is older than the window. */
  stale: boolean;
  /** True when no date could be read at all. Never treated as fresh. */
  unknown: boolean;
  reason: string;
}

export function assessListRecency(
  rows: unknown[][],
  nowMs: number,
  staleAfterDays: number = LIST_STALE_AFTER_DAYS,
): ListRecency {
  const headerIdx = locateHeader(rows);
  const header = headerIdx >= 0
    ? (rows[headerIdx] ?? []).map((h) => String(h ?? "").trim().toLowerCase())
    : [];
  let col = -1;
  for (const n of CONTROL_DATE_COLUMNS) {
    const i = header.indexOf(n);
    if (i >= 0) { col = i; break; }
  }

  let newest: number | null = null;
  if (col >= 0) {
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const raw = String((rows[r] ?? [])[col] ?? "").trim();
      if (!raw) continue;
      // DFAT writes d/m/yyyy. ISO is accepted too so a re-exported file works.
      const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      /*
       * Ranges are checked before `Date.UTC`, which does not validate: it
       * ROLLS OVER, so `31/31/9999` becomes year 10001 and a single
       * malformed cell would make an archived file look like the newest
       * list ever published. Caught by its own test.
       */
      const parts = dmy
        ? { y: +dmy[3], m: +dmy[2], d: +dmy[1] }
        : iso
          ? { y: +iso[1], m: +iso[2], d: +iso[3] }
          : null;
      if (!parts) continue;
      if (parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31) continue;
      if (parts.y < 1900 || parts.y > 2200) continue;
      const t = Date.UTC(parts.y, parts.m - 1, parts.d);
      // A rolled-over value no longer matches what was parsed.
      const back = new Date(t);
      if (back.getUTCMonth() !== parts.m - 1 || back.getUTCDate() !== parts.d) continue;
      if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
    }
  }

  if (newest === null) {
    return {
      newestListing: null, ageDays: null, stale: false, unknown: true,
      reason: "The file carries no readable listing dates, so how current it is could not "
        + "be established from its contents.",
    };
  }

  const ageDays = Math.floor((nowMs - newest) / 86_400_000);
  const newestListing = new Date(newest).toISOString().slice(0, 10);
  if (ageDays > staleAfterDays) {
    return {
      newestListing, ageDays, stale: true, unknown: false,
      reason: `The newest listing in this file is dated ${newestListing}, which is `
        + `${Math.floor(ageDays / 365)} year(s) old. This is not the current Consolidated `
        + "List. Loading it would screen every client against an out-of-date register and "
        + "report them clear.",
    };
  }
  return {
    newestListing, ageDays, stale: false, unknown: false,
    reason: `Newest listing ${newestListing}.`,
  };
}
