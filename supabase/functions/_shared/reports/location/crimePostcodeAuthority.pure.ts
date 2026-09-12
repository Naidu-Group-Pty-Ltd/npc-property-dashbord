/**
 * RF-7.2B.1B1 — which postcode is allowed to SELECT client-facing crime evidence.
 *
 * ## The defect this closes
 *
 * `generate-investment-report` derives the postcode it keys evidence on from
 * the free-text address, with one expression:
 *
 *     propertyAddress.match(/\b(\d{4})\b/)
 *
 * That is the FIRST four-digit token in the string, not the postcode. Measured
 * over the production corpus on 2026-09-12:
 *
 *   addresses containing a 4-digit token            418
 *   where the first token is NOT the postcode        30
 *   where that wrong token is a real postcode        17
 *
 * The wrong tokens are builder-stock LOT numbers, which is the same trap
 * `builderStockAddress.pure.ts` already records for the address line:
 *
 *   "Lot 2267 Hunza Road, Truganina, VIC 3029"  → parsed 2267 (a NSW postcode)
 *   "Lot 2325 Ned Street, Mambourin, VIC 3024"  → parsed 2325 (a NSW postcode)
 *
 * Nothing was actually served wrong, and it matters WHY: `crime-statistics-service`
 * filters `.eq('state', st)` as well as `.eq('area', area)`, and no Victorian
 * postcode register is loaded, so `area=2267, state=VIC` returns nothing. Exactly
 * one corpus row would have returned data for a mis-parsed postcode, and it is
 * `"Properties in Armidale NSW 2350, 2351"` — a two-postcode query where taking
 * the first is legitimate.
 *
 * **So the containment is accidental, not designed.** It rests on Victoria not
 * being loaded. The day a VIC postcode register lands, twelve stored addresses
 * begin selecting Cessnock's crime figures for properties in Truganina, and
 * nothing in the pipeline would notice — the figures would be real, current,
 * correctly attributed to BOCSAR, and about somewhere else.
 *
 * ## The rule
 *
 * A postcode may select client-facing statistical evidence only when it comes
 * from a source that ASSERTED it as a postcode. Two do:
 *
 *   `resolved_geography`   the ABS point-in-polygon POA for the verified
 *                          coordinate — canonical, and outranks everything
 *   `structured_subject`   `propertyDetails.postcode`, a field the caller filled
 *                          in, as opposed to a number found inside a sentence
 *
 * One does not:
 *
 *   `free_text_parse`      a regex over the address string. It cannot tell a
 *                          postcode from a lot number, and it has no way to
 *                          report that it is unsure.
 *
 * `propertyDetails.postcode` is already supplied and logged by the generator and
 * has never been read for this — the free-text parse won on every path.
 *
 * A withheld rate and a withheld count are different losses, and this is the
 * second one: where no trusted postcode exists the counts are withheld, because
 * the risk is not an absent number but a precise, sourced, plausible number
 * about the wrong town. F4's denominator rule is untouched and orthogonal — that
 * decides whether a rate may be DIVIDED, this decides which area is being
 * described at all.
 */

/** Where a candidate postcode came from, in descending authority. */
export type PostcodeProvenance =
  | 'resolved_geography'
  | 'structured_subject'
  | 'free_text_parse'
  | 'none';

/** Only the first two may select evidence. */
const TRUSTED_PROVENANCE: ReadonlySet<PostcodeProvenance> = new Set([
  'resolved_geography',
  'structured_subject',
]);

export interface CrimePostcodeInputs {
  /** `subjectPostcodeOf(subjectGeography)` — the ABS POA, or null. */
  readonly geographyPostcode?: unknown;
  /** `propertyDetails.postcode` — a field the caller filled in. */
  readonly structuredPostcode?: unknown;
  /** The `\b\d{4}\b` result. Recorded, never trusted. */
  readonly freeTextPostcode?: unknown;
  /** The subject's state, used only to refuse a contradiction. */
  readonly state?: unknown;
}

export interface CrimePostcodeAuthority {
  /** The postcode evidence may be keyed on, or null. Never a fallback. */
  readonly postcode: string | null;
  readonly provenance: PostcodeProvenance;
  readonly trusted: boolean;
  /** Operator-facing. Never rendered to a client. */
  readonly note: string;
}

const isFourDigits = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}$/.test(value.trim());

const clean = (value: unknown): string | null =>
  isFourDigits(value) ? (value as string).trim() : null;

/**
 * Australia Post's allocation, by state. Used ONLY to refuse a candidate that
 * contradicts the state already established — never to infer a state, and never
 * to repair a postcode.
 *
 * This is what catches the measured case directly: 2267 is inside NSW's range
 * and nowhere near Victoria's, so `Lot 2267 … VIC` is refused on its face
 * rather than relying on Victoria's register being absent.
 */
const STATE_RANGES: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>> = {
  NSW: [[1000, 2599], [2619, 2899], [2921, 2999]],
  ACT: [[200, 299], [2600, 2618], [2900, 2920]],
  VIC: [[3000, 3999], [8000, 8999]],
  QLD: [[4000, 4999], [9000, 9999]],
  SA: [[5000, 5999]],
  WA: [[6000, 6797], [6800, 6999]],
  TAS: [[7000, 7999]],
  NT: [[800, 999]],
};

/**
 * Does this postcode belong to this state?
 *
 * Unknown state → true. An unrecognised jurisdiction is not evidence that the
 * postcode is wrong, and refusing on it would withhold evidence for a reason
 * that has nothing to do with the postcode.
 */
export function postcodeMatchesState(postcode: string, state: unknown): boolean {
  if (typeof state !== 'string') return true;
  const ranges = STATE_RANGES[state.trim().toUpperCase()];
  if (!ranges) return true;
  const n = Number(postcode);
  if (!Number.isFinite(n)) return false;
  return ranges.some(([lo, hi]) => n >= lo && n <= hi);
}

/**
 * Decide which postcode, if any, may select crime evidence for this subject.
 *
 * Authority is ordered and total: the canonical POA wins, then the structured
 * field, and a free-text parse never wins. A candidate that contradicts the
 * subject's state is refused at whatever rank it holds — a mismatch there means
 * one of the two is wrong, and neither is worth guessing between.
 */
export function resolveCrimePostcodeAuthority(
  inputs: CrimePostcodeInputs,
): CrimePostcodeAuthority {
  const geography = clean(inputs.geographyPostcode);
  const structured = clean(inputs.structuredPostcode);
  const freeText = clean(inputs.freeTextPostcode);

  if (geography) {
    if (!postcodeMatchesState(geography, inputs.state)) {
      return {
        postcode: null,
        provenance: 'none',
        trusted: false,
        note:
          `The resolved geography's postcode ${geography} does not belong to `
          + `${String(inputs.state)}. No postcode-level crime evidence was selected.`,
      };
    }
    return {
      postcode: geography,
      provenance: 'resolved_geography',
      trusted: true,
      note:
        `Crime evidence keyed on POA ${geography}, resolved by point-in-polygon `
        + 'from the verified coordinate.',
    };
  }

  if (structured) {
    if (!postcodeMatchesState(structured, inputs.state)) {
      return {
        postcode: null,
        provenance: 'none',
        trusted: false,
        note:
          `The supplied postcode ${structured} does not belong to `
          + `${String(inputs.state)}. No postcode-level crime evidence was selected.`,
      };
    }
    return {
      postcode: structured,
      provenance: 'structured_subject',
      trusted: true,
      note:
        `Crime evidence keyed on postcode ${structured}, supplied as a structured `
        + 'property field rather than parsed from the address.',
    };
  }

  if (freeText) {
    return {
      postcode: null,
      provenance: 'free_text_parse',
      trusted: false,
      note:
        `Postcode ${freeText} was parsed from the address text and is not `
        + 'authoritative on its own — the same expression reads a builder-stock lot '
        + 'number as a postcode. No postcode-level crime evidence was selected; '
        + 'resolve the geography or supply a structured postcode.',
    };
  }

  return {
    postcode: null,
    provenance: 'none',
    trusted: false,
    note: 'No postcode was available. No postcode-level crime evidence was selected.',
  };
}

/**
 * What the DOCUMENT says when no trusted postcode exists.
 *
 * About the record, never about the property: a reader must not come away
 * thinking the area has no recorded crime. Deliberately says nothing about a
 * rate — the denominator is F4's subject and a different sentence.
 */
export const CRIME_EVIDENCE_WITHHELD_NOTE =
  'Postcode-level recorded crime statistics are not included in this report, '
  + 'because the subject property could not be tied to a verified postcode. This '
  + 'is a limitation of the available location data rather than a statement about '
  + 'the area, and no substitute figures have been used.';
