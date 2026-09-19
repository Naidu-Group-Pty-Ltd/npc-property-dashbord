/**
 * What may be built on this land, from the instrument's own land use table.
 *
 * ── Why this module exists ───────────────────────────────────────────────
 *
 * The planning programme retrieves the ZONE — `E3`, `R2`, `B4` — and every
 * control mapped over the parcel, and stops there. A zone code is not advice.
 * The question a buyer actually has is *what can happen on this land, and on
 * the land beside it*, and that is answered by the land use table: three lists
 * naming what is permitted without consent, what is permitted with consent and
 * what is prohibited.
 *
 * Measured on 48 Redfern Street, Cowra (19 Sep 2026), the difference between
 * the two is the whole report:
 *
 *   - The zone is **E3 Productivity Support** — an employment zone. Read
 *     alone, that reads as a residential property in the wrong zone, and a
 *     reasonable person would conclude the house sits on existing-use rights.
 *   - The land use table says **"Dwelling houses"** is *permitted with
 *     consent*. So the house is a permissible use, not a legacy one.
 *   - And it says **"Residential accommodation"** — the group term covering
 *     dual occupancies, secondary dwellings, multi dwelling housing, seniors
 *     housing and the rest — is *prohibited*. So there is no granny flat, no
 *     dual occupancy and no second dwelling on that 991 m² block, ever.
 *
 * Neither of those readings is available from the zone code. The first would
 * have been stated wrongly and the second is exactly the inference §4 of the
 * standard forbids being made from block size alone — *"a large block alone
 * does not establish subdivision or secondary-dwelling potential"*. Here the
 * instrument settles it in the other direction, and only the table says so.
 *
 * ── The reading rule, and why it is stated rather than inferred ──────────
 *
 * A use named specifically in item 3 is permissible notwithstanding a group
 * term covering it in item 4. That is how the Standard Instrument's land use
 * tables are read, and it is why "Dwelling houses permitted with consent"
 * coexists with "Residential accommodation prohibited" in the same table
 * without contradiction.
 *
 * This module applies that rule to produce a reading, and the reading always
 * carries the lists it came from, so a professional can check it. It does NOT
 * decide whether the existing dwelling was lawfully erected, whether consent
 * would be granted, or what a council would do with an application: those are
 * merit questions and a s.10.7 certificate and a town planner answer them.
 *
 * ── Coverage ────────────────────────────────────────────────────────────
 *
 * NSW only, today, because NSW is the jurisdiction that publishes a land use
 * table as structured data. The other seven are named as not served rather
 * than left absent — a register that was never asked is evidence of nothing,
 * and a blank where a reading belongs reads as a property with no controls.
 *
 * Deno-compatible: siblings and `_shared` only, explicit `.ts` extensions.
 */

export type PermissibilityStatus =
  /** The table was retrieved and read. */
  | 'retrieved'
  /** This jurisdiction publishes no structured land use table here. */
  | 'not_served'
  /** The service was asked and answered nothing for this zone. */
  | 'none_at_point'
  /** The service was asked and did not answer. */
  | 'unavailable';

export interface LandUseTable {
  status: PermissibilityStatus;
  /** The instrument the table belongs to, in the publisher's words. */
  instrument: string | null;
  zoneCode: string | null;
  /** The zone's objectives, verbatim from the instrument. */
  objectives: string | null;
  permittedWithoutConsent: string[];
  permittedWithConsent: string[];
  prohibited: string[];
  source: string | null;
  sourceUrl: string | null;
  licence: string | null;
  retrievedAt: string | null;
  /** Why, where the status is not `retrieved`. */
  note: string | null;
}

export const NSW_PERMISSIBILITY_SOURCE =
  'NSW Planning Portal — ePlanning land use permissibility service';
export const NSW_PERMISSIBILITY_LICENCE = 'CC BY 4.0';
const NSW_PERMISSIBILITY_URL =
  'https://api.apps1.nsw.gov.au/eplanning/data/v0/FetchEPILandUsePermissibility';

/** The eight jurisdictions, and which of them this can be asked of. */
export const PERMISSIBILITY_SERVED: Readonly<Record<string, boolean>> = {
  NSW: true, VIC: false, QLD: false, WA: false,
  SA: false, TAS: false, ACT: false, NT: false,
};

export function emptyLandUseTable(
  status: PermissibilityStatus,
  note: string | null,
  zoneCode: string | null = null,
  instrument: string | null = null,
): LandUseTable {
  return {
    status,
    instrument,
    zoneCode,
    objectives: null,
    permittedWithoutConsent: [],
    permittedWithConsent: [],
    prohibited: [],
    source: null,
    sourceUrl: null,
    licence: null,
    retrievedAt: null,
    note,
  };
}

/**
 * The request, which takes its parameters as HEADERS.
 *
 * Measured 19 Sep 2026: the same values as query parameters answer HTTP 400
 * with `{"ErrorMessage": "EPI Name cannot be empty!!!"}`, which reads like a
 * missing argument and is actually the wrong transport. Recorded here so the
 * next person does not spend the same half hour.
 */
export function buildNswPermissibilityRequest(
  epiName: string,
  zoneCode: string,
): { url: string; headers: Record<string, string> } {
  return {
    url: NSW_PERMISSIBILITY_URL,
    headers: {
      EpiName: epiName,
      ZoneCode: zoneCode,
      Accept: 'application/json',
    },
  };
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

/** The service returns each land use twice. De-duplicate, keep first order. */
function uses(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const it of raw) {
    const name = str((it as { Landuse?: unknown } | null)?.Landuse);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Parse the service's answer.
 *
 * Returns `none_at_point` rather than an empty table when the body parses and
 * carries no zone — a zone the instrument does not contain is a real answer,
 * and it is not the same as the service failing.
 */
export function parseNswPermissibility(
  body: unknown,
  zoneCode: string,
  retrievedAt: string,
): LandUseTable {
  const top = Array.isArray(body) ? body[0] : null;
  if (!top || typeof top !== 'object') {
    return emptyLandUseTable('unavailable', 'The permissibility service answered a body this could not read', zoneCode);
  }
  const epi = str((top as { EPIName?: unknown }).EPIName);
  const precincts = (top as { Precinct?: unknown }).Precinct;
  const zones: unknown[] = [];
  if (Array.isArray(precincts)) {
    for (const pr of precincts) {
      const z = (pr as { Zone?: unknown } | null)?.Zone;
      if (Array.isArray(z)) zones.push(...z);
    }
  }
  const match = zones.find((z) => str((z as { ZoneCode?: unknown }).ZoneCode) === zoneCode)
    ?? zones[0];
  if (!match || typeof match !== 'object') {
    return emptyLandUseTable(
      'none_at_point',
      `The instrument's land use table carries no zone ${zoneCode}`,
      zoneCode,
      epi,
    );
  }
  const z = match as Record<string, unknown>;
  const landUse = Array.isArray(z.LandUse) ? (z.LandUse[0] as Record<string, unknown> | undefined) : undefined;
  const withoutConsent = uses(landUse?.PermittedWithoutConsent);
  const withConsent = uses(landUse?.PermittedWithConsent);
  const prohibited = uses(landUse?.Prohibited);
  if (!withoutConsent.length && !withConsent.length && !prohibited.length) {
    return emptyLandUseTable(
      'none_at_point',
      `The service answered for zone ${zoneCode} and returned no land uses`,
      zoneCode,
      epi,
    );
  }
  return {
    status: 'retrieved',
    instrument: epi,
    // The zone CODE is the map layer's, never this service's — its own
    // `ZoneDescription` is stale metadata (it reads "Environmental Management"
    // for an E3 the 2023 Land Use Zones amendment renamed "Productivity
    // Support"), and a stale label beside a current table is worse than none.
    zoneCode,
    objectives: str(z.ZoneObjective),
    permittedWithoutConsent: withoutConsent,
    permittedWithConsent: withConsent,
    prohibited,
    source: NSW_PERMISSIBILITY_SOURCE,
    sourceUrl: NSW_PERMISSIBILITY_URL,
    licence: NSW_PERMISSIBILITY_LICENCE,
    retrievedAt,
    note: null,
  };
}

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

/**
 * The residential uses a report is actually asked about, and the group term
 * that covers them.
 *
 * `residentialGroup` is listed separately because the specific-over-general
 * rule turns entirely on it: a table that prohibits the group while permitting
 * one member permits that member and nothing else in the group.
 */
const DWELLING_HOUSE = 'dwelling houses';
const RESIDENTIAL_GROUP = 'residential accommodation';
const SECONDARY_RESIDENTIAL = [
  'secondary dwellings',
  'dual occupancies',
  'dual occupancies (attached)',
  'dual occupancies (detached)',
  'multi dwelling housing',
  'attached dwellings',
  'semi-detached dwellings',
  'seniors housing',
  'boarding houses',
  'group homes',
  'residential flat buildings',
  'shop top housing',
];

export type DwellingStanding =
  /** Named in the permitted-with-consent list. */
  | 'permitted_with_consent'
  /** Named in the permitted-without-consent list. */
  | 'permitted_without_consent'
  /** Named in the prohibited list, or covered by a prohibited group term. */
  | 'prohibited'
  /** Neither named nor covered — the table does not settle it. */
  | 'not_stated';

export interface ResidentialReading {
  /** How the table treats a dwelling house on this land. */
  dwellingHouse: DwellingStanding;
  /**
   * Whether the group term is prohibited, which is what forecloses every
   * other residential form even where a dwelling house is permitted.
   */
  residentialGroupProhibited: boolean;
  /** Other residential uses the table names explicitly, and how. */
  otherResidential: Array<{ use: string; standing: DwellingStanding }>;
  /**
   * The non-residential uses a neighbour could lawfully bring, ordered as the
   * instrument lists them. This is amenity information a residential buyer on
   * employment-zoned land is entitled to and would not otherwise get.
   */
  neighbouringUsesWithConsent: string[];
}

const lc = (s: string) => s.trim().toLowerCase();

function standingOf(table: LandUseTable, use: string): DwellingStanding {
  const want = lc(use);
  if (table.permittedWithoutConsent.some((u) => lc(u) === want)) return 'permitted_without_consent';
  if (table.permittedWithConsent.some((u) => lc(u) === want)) return 'permitted_with_consent';
  if (table.prohibited.some((u) => lc(u) === want)) return 'prohibited';
  return 'not_stated';
}

/**
 * Read the table for what it says about living on this land.
 *
 * The specific-over-general rule is applied in exactly one direction: a use
 * NAMED in a permitted list stays permitted even where a group term covering
 * it is prohibited. It is never applied the other way — a use named as
 * prohibited is prohibited whatever any group term says — because inventing a
 * permission is the failure this whole programme exists to stop.
 */
export function readResidentialStanding(table: LandUseTable): ResidentialReading | null {
  if (table.status !== 'retrieved') return null;
  const groupProhibited = table.prohibited.some((u) => lc(u) === RESIDENTIAL_GROUP);

  let dwelling = standingOf(table, DWELLING_HOUSE);
  if (dwelling === 'not_stated' && groupProhibited) dwelling = 'prohibited';

  const other: Array<{ use: string; standing: DwellingStanding }> = [];
  for (const use of SECONDARY_RESIDENTIAL) {
    let st = standingOf(table, use);
    if (st === 'not_stated') {
      if (!groupProhibited) continue;
      st = 'prohibited';
    }
    other.push({ use, standing: st });
  }

  return {
    dwellingHouse: dwelling,
    residentialGroupProhibited: groupProhibited,
    otherResidential: other,
    // "Any other development not specified in item 2 or 4" is a catch-all
    // clause, not a use; listing it as something a neighbour might build is
    // meaningless to a reader.
    neighbouringUsesWithConsent: table.permittedWithConsent.filter(
      (u) => !/^any other development/i.test(u) && lc(u) !== DWELLING_HOUSE,
    ),
  };
}

/**
 * The sentence the reading supports, and never one word further.
 *
 * Deliberately says what the INSTRUMENT does, not what a council would do:
 * "permitted with consent" is a statement about the land use table, and
 * "you can build this" is a statement about an application nobody has made.
 */
export function residentialSentence(reading: ResidentialReading): string {
  const dwelling = (() => {
    switch (reading.dwellingHouse) {
      case 'permitted_with_consent':
        return 'A dwelling house is permitted with development consent on this land.';
      case 'permitted_without_consent':
        return 'A dwelling house is permitted without development consent on this land.';
      case 'prohibited':
        return 'A dwelling house is prohibited on this land under the instrument in force.';
      case 'not_stated':
        return 'The land use table does not name a dwelling house in any of its three lists.';
    }
  })();
  if (!reading.residentialGroupProhibited) return dwelling;
  return `${dwelling} Every other form of residential accommodation — a secondary dwelling, a dual occupancy, multi dwelling housing and the rest of the group — is prohibited, so no additional dwelling may be added to this land however large it is.`;
}
