/**
 * S5/S6 §2 — the recommended Property Risk method: a **recorded condition
 * record**, and the evidence path that produces one.
 *
 * ## The arithmetic that decides this, before any preference
 *
 * `riskModelD.pure.ts` requires observations spanning at least
 * `MINIMUM_INDEPENDENT_CATEGORIES` (2) before they may compose a Risk score.
 * `propertyRiskSchema.pure.ts` gives an established house exactly three of its
 * own questions, in two categories:
 *
 * | question                   | category   |
 * | -------------------------- | ---------- |
 * | `site_hazard_exposure`     | `site`     |
 * | `planning_constraints`     | `site`     |
 * | `condition_and_maintenance`| `building` |
 *
 * So hazard and planning together are ONE category however well they are
 * retrieved, and **Risk cannot score for a house without a `building`
 * observation.** That is not a preference about which evidence is nicer; it is
 * the only arrangement of the schema that reaches two categories. Every route
 * to a fifth scored dimension therefore runs through this module.
 *
 * ## The premise this corrects
 *
 * `propertyRiskSchema` moved hazard and planning to `held_but_unscoreable` on
 * the reasoning that *"no publisher issues a 0-100 scale"*. That reasoning is
 * wrong and is corrected there: **an internal methodology does not need a
 * government publisher to supply a ready-made score. It needs a defensible,
 * documented and versioned basis.** What it must not do is award points for a
 * missing finding, and that — not the absence of a published scale — is why a
 * register absence cannot become a reading:
 *
 *   * the retrieval is an **identify at a single coordinate**, so a layer that
 *     misses the point may still cross the lot (the probe record carries that
 *     caveat verbatim), and an address-point query is never clearance for a
 *     parcel; and
 *   * a hazard the publisher has not mapped is not a hazard the parcel lacks.
 *
 * A completed building inspection is the opposite case and that is the whole
 * argument for it: a qualified person examined a **recorded scope** and
 * reported. "No major defect recorded" is then a determination ABOUT the
 * dwelling by somebody who looked, not a silence in a register. It is the one
 * class of property-level condition evidence whose negative is admissible, and
 * that is why the recommendation prefers it.
 *
 * ## Why not a construction year — measured, not assumed
 *
 * See `constructionAgeCandidate.pure.ts`. Over all 1,230 stored reports on
 * 18 September 2026, `property_specs` carries a construction year on **0**
 * (`year_built` is present as an explicit JSON null on 1,102 rows and holds a
 * value on none). Every construction year the platform holds is an
 * operator-typed `manual_overrides.constructionYear`: **32 rows, 19
 * properties, zero carrying any source or reason field.** 31 of the 32 are
 * `2025`, `2026` or `2031` — a completion expectation for a new build, one of
 * them in the future — and the single historical value, `1941`, is on
 * **262 Pallas Street and on nothing else in the corpus.** Scoring it would
 * complete Pallas and not Kellyville, on an unsourced typed number.
 *
 * ## The three rules that bite here
 *
 * **A document, or it is not a record.** A typed year is a claim; an
 * inspection report, strata report, building certificate or vendor's statement
 * is a document with an issuer and a date. `assessConditionRecord` refuses
 * anything with no admissible source and names which refusal it is.
 *
 * **A negative needs a recorded scope.** An inspection that does not say what
 * was inspected cannot support "nothing found" — that is the register problem
 * again, moved indoors. `scope` is required before `findings: []` may be read
 * as a determination.
 *
 * **The conversion is defined, versioned and NOT activated.** The deduction
 * magnitudes below are declared and reasoned; they are not calibrated, because
 * this deployment holds zero condition records to calibrate against.
 * {@link CONDITION_METHOD_ACTIVATION} is `null` and a test asserts it, so
 * turning this on is a visible act with a decision behind it — the shape
 * `SCORING_V2_ACTIVATION` already uses.
 */

/** Bump when the admissibility rules or the conversion basis change. */
export const CONDITION_RECORD_METHOD_VERSION = '1.0.0';

/**
 * Document kinds whose findings may answer `condition_and_maintenance`.
 *
 * Each is a document produced by somebody accountable for it, carrying an
 * issuer and a date. The order is the preference order used by
 * {@link bestConditionRecord}, and it is an order of scope rather than of
 * trust: an AS 4349.1 inspection covers the whole dwelling, a strata report
 * covers the scheme, a certificate covers what was certified, and a vendor's
 * statement covers what the vendor chose to disclose.
 */
export const ADMISSIBLE_SOURCES = [
  'building_inspection',
  'strata_report',
  'building_certificate',
  'vendor_statement',
] as const;

export type ConditionSourceKind = typeof ADMISSIBLE_SOURCES[number];

/**
 * Named inadmissible sources.
 *
 * Present rather than absent, for the reason `WITHHELD_CAPTURE_KEYS` is:
 * a reader can see that the typed year was considered and refused, instead of
 * wondering whether anybody thought about it.
 */
export const INADMISSIBLE_SOURCES: Readonly<Record<string, string>> = Object.freeze({
  typed_construction_year:
    'An operator-typed year with no document. Measured over the whole corpus: 32 rows, none '
    + 'carrying a source or a reason, 31 of them a completion expectation rather than an '
    + 'observed build date.',
  listing_description:
    'An agent\'s marketing copy. It describes the property to sell it and nobody is accountable '
    + 'for a condition statement in it.',
  model_inference:
    'A model reading a photograph or a description. It produces a confident number from no '
    + 'observation, which is the failure this platform has already had once.',
  area_statistic:
    'A suburb or postcode figure. It is not about this dwelling, and Location already owns '
    + 'area characteristics.',
});

/** How far the record has been checked. Evidence and observation are different bars. */
export type ConditionVerification =
  /** The document itself is held, and its issuer has been checked against a register. */
  | 'issuer_verified'
  /** The document itself is held and read; the issuer has not been checked. */
  | 'document_held'
  /** Somebody recorded the findings without the document. Evidence, never an observation. */
  | 'transcribed_only';

/** The severities an AS 4349.1 report uses, plus the one a strata report adds. */
export type FindingSeverity =
  | 'safety_hazard'
  | 'major_defect'
  | 'minor_defect'
  | 'unfunded_liability';

export interface ConditionFinding {
  /** The building element or scheme matter the finding is about. */
  element: string;
  severity: FindingSeverity;
  /** The inspector's or issuer's own words, kept rather than summarised. */
  note?: string;
}

export interface ConditionDocument {
  kind: ConditionSourceKind;
  /** The firm or person who issued it. Required — an unattributed document is a claim. */
  issuer: string;
  /** Licence or registration number where the kind carries one. */
  issuerLicence?: string;
  /** ISO date the document was issued. */
  issuedOn: string;
  /** ISO date the dwelling was actually examined, where that differs from issue. */
  inspectedOn?: string;
  /** The issuer's own reference, so the record points back at the paper. */
  reference?: string;
}

export interface ConditionRecord {
  document: ConditionDocument;
  /**
   * What the document covered, in the issuer's own terms. Required before
   * `findings: []` may be read as a determination rather than as a silence.
   */
  scope?: string;
  findings: readonly ConditionFinding[];
  verification: ConditionVerification;
  /** Who entered it, and when. Provenance of the RECORD, not of the document. */
  recordedBy?: string;
  recordedAt?: string;
}

/** Why a record cannot become an observation. Each is a different remedy. */
export type ConditionRefusal =
  | 'no_record'
  | 'inadmissible_source'
  | 'unattributed'
  | 'undated'
  | 'scope_not_recorded'
  | 'not_verified'
  | 'out_of_currency';

/**
 * How long a condition document speaks for the dwelling.
 *
 * Declared rather than derived. A pre-purchase inspection describes the day it
 * was made; beyond this window it is disclosed as evidence and stops being an
 * observation, because a dwelling's condition is exactly the thing that
 * changes. Three years is the ordinary re-inspection interval a lender or an
 * insurer works to; it is a parameter and this is where it is stated.
 */
export const CONDITION_MAX_AGE_MONTHS = 36;

export interface ConditionReading {
  version: string;
  /** May this record contribute a `building` observation? */
  admissible: boolean;
  refusal: ConditionRefusal | null;
  /** The document, echoed so a reader can see what was judged. */
  document: ConditionDocument | null;
  findings: readonly ConditionFinding[];
  /** Months between the examination and the assessment date. */
  ageMonths: number | null;
  /**
   * The observation, 0-100 where higher is safer — **null unless the method is
   * activated**, whatever the record's admissibility. Admissibility and
   * authorisation are different questions and collapsing them is how an
   * uncalibrated scale reaches a client document.
   */
  observation: number | null;
  /** What the observation would be were the method activated. Never published. */
  provisionalObservation: number | null;
  /** One sentence a report may print. */
  statement: string;
}

/**
 * The conversion basis. Declared, reasoned, versioned — and uncalibrated.
 *
 * A completed inspection over a recorded scope that records no major defect
 * and no safety hazard is a determination by a qualified person and takes the
 * reference. Each recorded finding then DEDUCTS. The direction is the only
 * part of this that is certain: a recorded defect is evidence of exposure, and
 * nothing here ever adds points for something nobody found.
 *
 * The magnitudes are the uncalibrated part, and they are the specific thing
 * approval is sought for. They are ordered by what the finding obliges — a
 * safety hazard obliges immediate work, a major defect obliges capital, a
 * minor defect obliges maintenance — rather than by any observed cost, because
 * this deployment holds no maintenance-cost data to observe.
 */
export const CONDITION_REFERENCE = 85;

export const SEVERITY_DEDUCTION: Readonly<Record<FindingSeverity, number>> = Object.freeze({
  safety_hazard: 20,
  major_defect: 15,
  unfunded_liability: 12,
  minor_defect: 4,
});

/** A single record may not exhaust the scale on minor findings alone. */
export const MAX_MINOR_DEDUCTION = 16;

/**
 * The activation decision, or `null` while there is none.
 *
 * `null` is the shipped state. The conversion above is implemented so it can
 * be reviewed and tested against real records; it contributes nothing to any
 * score until this names a decision. `conditionRecord.spec.ts` asserts it.
 */
export const CONDITION_METHOD_ACTIVATION: {
  approved: boolean;
  approvedOn: string;
  reference: string;
  decidedBy: string;
  methodVersion: string;
} | null = null;

const MS_PER_MONTH = 30.436875 * 24 * 60 * 60 * 1000;

function monthsBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / MS_PER_MONTH;
}

/**
 * Judge one record, and say which refusal it is.
 *
 * `asOf` is a parameter rather than a read of the clock, so a stored reading can be
 * re-derived identically, and so a test is not a race.
 */
export function assessConditionRecord(
  record: ConditionRecord | null | undefined,
  asOf: string,
): ConditionReading {
  const base = {
    version: CONDITION_RECORD_METHOD_VERSION,
    document: record?.document ?? null,
    findings: record?.findings ?? [],
    observation: null,
    provisionalObservation: null,
  };

  const refuse = (refusal: ConditionRefusal, statement: string, ageMonths: number | null = null)
    : ConditionReading => ({ ...base, admissible: false, refusal, ageMonths, statement });

  if (!record) {
    return refuse(
      'no_record',
      'No condition record has been submitted for this property, so the dwelling\'s condition and '
      + 'deferred-maintenance exposure is not assessed. A building inspection report, strata report, '
      + 'building certificate or vendor\'s statement would answer it.',
    );
  }

  const doc = record.document;
  if (!doc || !(ADMISSIBLE_SOURCES as readonly string[]).includes(doc.kind)) {
    return refuse(
      'inadmissible_source',
      'The condition evidence on file is not a document an issuer is accountable for, so it is '
      + 'recorded and not scored.',
    );
  }
  if (!doc.issuer?.trim()) {
    return refuse(
      'unattributed',
      'The condition document names no issuer. An unattributed document is a claim rather than a '
      + 'record, so it is not scored.',
    );
  }
  const examined = doc.inspectedOn ?? doc.issuedOn;
  const ageMonths = examined ? monthsBetween(examined, asOf) : null;
  if (ageMonths === null) {
    return refuse(
      'undated',
      'The condition document carries no usable date, so how far it still describes the dwelling '
      + 'cannot be established and it is not scored.',
    );
  }
  // Scope is what makes an empty finding list a determination rather than a
  // silence. Refused BEFORE verification, because a scopeless document is not
  // rescued by checking who signed it.
  if (!record.scope?.trim()) {
    return refuse(
      'scope_not_recorded',
      'The condition document does not record what was examined, so an absence of findings in it '
      + 'cannot be read as a finding about the dwelling. It is recorded as evidence.',
      ageMonths,
    );
  }
  if (record.verification === 'transcribed_only') {
    return refuse(
      'not_verified',
      'The condition findings were transcribed without the document itself, so they are shown as '
      + 'evidence and do not contribute to the assessment.',
      ageMonths,
    );
  }
  if (ageMonths > CONDITION_MAX_AGE_MONTHS) {
    return refuse(
      'out_of_currency',
      `The condition document is ${Math.round(ageMonths / 12)} years old. Condition is the property `
      + 'of a dwelling that changes, so it is shown with its date and does not contribute to the '
      + 'assessment.',
      ageMonths,
    );
  }

  const provisional = convertFindings(record.findings);
  const activated = CONDITION_METHOD_ACTIVATION?.approved === true;

  return {
    ...base,
    admissible: true,
    refusal: null,
    ageMonths,
    observation: activated ? provisional : null,
    provisionalObservation: provisional,
    statement: activated
      ? `Assessed from a ${labelFor(doc.kind)} issued by ${doc.issuer} on ${doc.issuedOn}, `
        + `recording ${describeFindings(record.findings)}.`
      : `A ${labelFor(doc.kind)} issued by ${doc.issuer} on ${doc.issuedOn} records `
        + `${describeFindings(record.findings)}. It is shown as evidence; no condition scale is `
        + 'authorised for this deployment yet, so it contributes no points.',
  };
}

/** The conversion itself, separated so it can be reviewed on its own. */
export function convertFindings(findings: readonly ConditionFinding[]): number {
  let minor = 0;
  let other = 0;
  for (const f of findings) {
    const d = SEVERITY_DEDUCTION[f.severity];
    if (d === undefined) continue;
    if (f.severity === 'minor_defect') minor += d;
    else other += d;
  }
  const deduction = Math.min(minor, MAX_MINOR_DEDUCTION) + other;
  return Math.max(0, Math.min(100, CONDITION_REFERENCE - deduction));
}

/**
 * Pick the record a reading should be built from, where several exist.
 *
 * Preference order is {@link ADMISSIBLE_SOURCES}, then the most recent
 * examination. Deliberately not "the best score": choosing by outcome is how a
 * record becomes an argument.
 */
export function bestConditionRecord(
  records: readonly ConditionRecord[],
): ConditionRecord | null {
  const rank = (k: ConditionSourceKind) => ADMISSIBLE_SOURCES.indexOf(k);
  const usable = records.filter((r) =>
    r.document && (ADMISSIBLE_SOURCES as readonly string[]).includes(r.document.kind));
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => {
    const byKind = rank(a.document.kind) - rank(b.document.kind);
    if (byKind !== 0) return byKind;
    const da = Date.parse(a.document.inspectedOn ?? a.document.issuedOn) || 0;
    const db = Date.parse(b.document.inspectedOn ?? b.document.issuedOn) || 0;
    return db - da;
  })[0];
}

function labelFor(kind: ConditionSourceKind): string {
  switch (kind) {
    case 'building_inspection': return 'building inspection report';
    case 'strata_report': return 'strata report';
    case 'building_certificate': return 'building certificate';
    case 'vendor_statement': return 'vendor\'s statement';
  }
}

function describeFindings(findings: readonly ConditionFinding[]): string {
  if (findings.length === 0) return 'no defect or hazard over the scope examined';
  const counts = new Map<FindingSeverity, number>();
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  const word: Record<FindingSeverity, [string, string]> = {
    safety_hazard: ['safety hazard', 'safety hazards'],
    major_defect: ['major defect', 'major defects'],
    unfunded_liability: ['unfunded liability', 'unfunded liabilities'],
    minor_defect: ['minor defect', 'minor defects'],
  };
  const parts: string[] = [];
  for (const s of ['safety_hazard', 'major_defect', 'unfunded_liability', 'minor_defect'] as const) {
    const n = counts.get(s);
    if (n) parts.push(`${n} ${word[s][n === 1 ? 0 : 1]}`);
  }
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts[0];
}
