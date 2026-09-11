/**
 * RF-7.2B.1 — the point at which the safety architecture becomes the actual
 * forward production path for the Investment Property Report.
 *
 * RF-7.2B built the Client-Safe Gate, the safe fact projection and the safe
 * narrative bundle, and wired NONE of them: a report generated the day that
 * merged received exactly what it had received before. This module is the
 * boundary that changes it, and the reason it is one function rather than a
 * set of call-site edits is structural.
 *
 * `generate-investment-report` builds FOUR base prompts (suburb, postcode,
 * statewide, property), each interpolating `enhancedData` directly, and
 * `regenerate-report-qualitative` builds a FIFTH from its own
 * `buildEnhancedDataContext`. Gating at each of those five is five places to
 * forget. Gating the OBJECT they all read cannot be forgotten: a fact that is
 * not on `enhancedData` cannot reach a prompt that interpolates
 * `enhancedData`, whichever prompt it is and however it is written later.
 *
 * So the contract is: call `activateSafeGenerationInputs` once, after the
 * enhanced-data fan-out has finished and before the first prompt is composed,
 * and use the object it returns from then on.
 *
 * ## What is removed, and on what evidence
 *
 * The four disowned Location fields and the three market facts come from
 * `BLOCKED_FACTS` in the gate, which carries the measurement behind each.
 * Nothing new is decided here.
 *
 * Two deliberate boundaries:
 *
 *  - **Scoring is not re-pointed.** `investmentScoreEngine` reads `walkScore`,
 *    `commute.durationMinutes` and `schools.schoolsWithin3km`, so sanitising
 *    before the score call would silently move every new report's score. That
 *    is a different programme with its own forward-only closeout, so the
 *    activation runs AFTER scoring and before narrative and storage. The
 *    carry-forward is named in the phase document rather than quietly taken.
 *
 *  - **The whole `commute` block goes, not just its duration.** The measured
 *    defect was destination routing, and the live service has since fixed it —
 *    but a resumed run, a stored blob and a fresh call are the same shape, so
 *    nothing at this boundary can tell a repaired value from a legacy one.
 *    Blocking all of them cannot under-block; admitting the shape can. The
 *    cost is that a genuinely measured commute is not narrated, which is a
 *    loss of detail rather than a loss of accuracy.
 *
 * ## What is NOT removed
 *
 * `schools.nearestSchool` and `schools.distanceToSchool` stay: they are named
 * facts that already pass through `reconcileNearestSchool` /
 * `reconcileSchoolDistances` in the generator. Only the COUNT is disowned,
 * because the count is what sits at its ceiling on 851 of 1,114 reports.
 * Removing a working reconciliation would be widening the phase.
 *
 * Pure: no Deno, no network, no clock (the caller passes `capturedAt`), no
 * database. Deliberately total — every branch returns a value, because a
 * throw here would fail a report generation over a data-quality question.
 */

import {
  gateFact,
  isGeneratedSource,
  CLIENT_SAFE_GATE_VERSION,
  type SafeFact,
} from './clientSafeGate.pure.ts';
import {
  safeCashRate,
  safeCashRateTarget,
  SAFE_MARKET_FACTS_VERSION,
  type RbaCashRateReading,
  type CashRateTargetReading,
} from './safeMarketFacts.pure.ts';
import { isCensusProjectionSource } from '../../absCensusProjection.pure.ts';

export const SAFE_GENERATION_VERSION = '1.0.0';

/** One string naming every version a stored snapshot was produced under. */
export const ASSURANCE_VERSION =
  `gate ${CLIENT_SAFE_GATE_VERSION} / facts ${SAFE_MARKET_FACTS_VERSION} / activation ${SAFE_GENERATION_VERSION}`;

// ---------------------------------------------------------------------------
// What the activation strips
// ---------------------------------------------------------------------------

/**
 * Dotted paths removed from `enhancedData.locationIntelligence`.
 *
 * Named as data so a test can assert the list rather than the behaviour, and
 * so the phase document and the code cannot disagree about which four.
 */
export const DISOWNED_LOCATION_PATHS: readonly string[] = [
  'walkScore',
  'transport.qualityScore',
  'commute',
  'schools.schoolsWithin3km',
];

/** Why each one is disowned — the gate's evidence, restated at the boundary. */
export const DISOWNED_LOCATION_REASONS: Readonly<Record<string, string>> = {
  'walkScore':
    'A bespoke composite over Google Places result counts, published under the '
    + 'name of a third-party product with its own methodology.',
  'transport.qualityScore':
    'An invented score. The transport service deliberately publishes none, '
    + 'because a stops file carries no mode, frequency or rating.',
  'commute':
    'The measured defect was destination routing. Nothing at this boundary can '
    + 'tell a repaired value from a legacy one, so the block is disowned whole.',
  'schools.schoolsWithin3km':
    'A Places result count that sits at its ceiling on most reports, so it '
    + 'distinguishes nothing.',
};

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export interface SafeGenerationInput {
  /** The assembled fan-out payload. Not mutated. */
  readonly enhancedData: unknown;
  /** The in-force cash rate target, as `cashRateTargetOf` derived it. */
  readonly cashRateTarget?: CashRateTargetReading | null;
  /** The monthly-average reading, for trend context only. */
  readonly cashRateMonthlyAverage?: RbaCashRateReading | null;
  /** ISO timestamp the caller is generating at — passed so this stays pure. */
  readonly capturedAt: string;
}

export interface RemovedFact {
  readonly path: string;
  readonly reason: string;
  /** True where the value was actually present — a removal that removed something. */
  readonly hadValue: boolean;
}

/** One fact as the report stores it, so reopening cannot re-read today's tables. */
export interface SnapshotFact {
  readonly name: string;
  readonly status: 'present' | 'absent';
  readonly value: number | string | null;
  readonly source: string | null;
  readonly dataset: string | null;
  readonly grain: string | null;
  readonly geographyId: string | null;
  readonly referencePeriod: string | null;
  readonly asOf: string | null;
  readonly ruling: string;
}

export interface MarketFactSnapshot {
  readonly capturedAt: string;
  readonly assuranceVersion: string;
  readonly facts: readonly SnapshotFact[];
}

export interface SafeGenerationResult {
  /** Use this from here on. The input object is left untouched. */
  readonly enhancedData: Record<string, unknown>;
  readonly facts: readonly SafeFact<unknown>[];
  readonly removed: readonly RemovedFact[];
  readonly snapshot: MarketFactSnapshot;
  readonly demographicsKept: boolean;
  readonly demographicsRuling: string;
  readonly version: string;
}

// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/**
 * Delete a dotted path from a shallow clone, reporting whether anything was
 * there. Clones only the objects on the path, so unrelated branches keep their
 * identity and nothing else in the payload is disturbed.
 */
function withoutPath(
  source: Record<string, unknown>,
  path: string,
): { next: Record<string, unknown>; hadValue: boolean } {
  const [head, ...rest] = path.split('.');
  if (!(head in source)) return { next: source, hadValue: false };

  if (rest.length === 0) {
    const hadValue = source[head] !== undefined && source[head] !== null;
    const next = { ...source };
    delete next[head];
    return { next, hadValue };
  }

  const child = source[head];
  if (!isRecord(child)) return { next: source, hadValue: false };
  const inner = withoutPath(child, rest.join('.'));
  if (inner.next === child) return { next: source, hadValue: false };
  return { next: { ...source, [head]: inner.next }, hadValue: inner.hadValue };
}

/**
 * Is this demographics payload a retrieval from the Census table, or a
 * generated block wearing the same label?
 *
 * Asymmetric on purpose: it must be RECOGNISED to be kept. `dataQuality` alone
 * is not enough — the generated corpus set it too — so the source string must
 * also have the exact shape the Census projection emits, and must carry no
 * generated-source marker anywhere in it.
 */
export function demographicsAreRetrieved(demographics: unknown): boolean {
  if (!isRecord(demographics)) return false;
  const source = demographics['dataSource'] ?? demographics['source'];
  if (isGeneratedSource(source)) return false;
  if (!isCensusProjectionSource(source)) return false;
  return str(demographics['dataQuality']) === 'census';
}

/**
 * The postal area out of `ABS Census 2021 (POA 3024)`.
 *
 * Safe to read positionally because `isCensusProjectionSource` has already
 * established the exact shape; a string that did not match never gets here.
 * The geography identifier is carried on the SNAPSHOT rather than added to
 * `FactContext`, which is a shared type several other surfaces already render.
 */
export function poaOfCensusSource(source: unknown): string | null {
  if (typeof source !== 'string') return null;
  const m = /\(POA (\d{4})\)$/.exec(source.trim());
  return m ? m[1] : null;
}

const snapshotFactOf = (
  f: SafeFact<unknown>,
  geographyId: string | null,
): SnapshotFact => ({
  name: f.name,
  status: f.status,
  value: typeof f.value === 'number' || typeof f.value === 'string' ? f.value : null,
  source: f.source,
  dataset: f.context?.dataset ?? null,
  grain: f.context?.grain ?? null,
  geographyId,
  referencePeriod: f.context?.referencePeriod ?? null,
  asOf: f.context?.asOf ?? null,
  ruling: f.ruling,
});

/**
 * Apply the gate to one report's enhanced data.
 *
 * Returns a NEW payload. Callers replace their working object with it, and
 * everything downstream — every prompt branch, the stored blobs, the derived
 * briefing — is then reading gated facts by construction.
 */
export function activateSafeGenerationInputs(
  input: SafeGenerationInput,
): SafeGenerationResult {
  const removed: RemovedFact[] = [];
  const facts: SafeFact<unknown>[] = [];

  let next: Record<string, unknown> = isRecord(input.enhancedData)
    ? { ...input.enhancedData }
    : {};

  // --- Location: disown the four, wherever they sit -------------------------
  const location = next['locationIntelligence'];
  if (isRecord(location)) {
    let loc: Record<string, unknown> = location;
    for (const path of DISOWNED_LOCATION_PATHS) {
      const result = withoutPath(loc, path);
      loc = result.next;
      const reason = DISOWNED_LOCATION_REASONS[path] ?? 'Disowned by the Client-Safe Gate.';
      removed.push({ path: `locationIntelligence.${path}`, reason, hadValue: result.hadValue });
      facts.push(gateFact({
        name: `market.${path.split('.').pop()}`,
        value: null,
        safety: 'not_client_safe',
        source: 'location_intelligence',
      }));
    }
    next['locationIntelligence'] = loc;
  }

  // --- Demographics: keep only a recognised retrieval -----------------------
  const demographics = next['demographics'];
  const demographicsKept = demographicsAreRetrieved(demographics);
  const demographicsSource = isRecord(demographics)
    ? str(demographics['dataSource'] ?? demographics['source'])
    : null;
  const demographicsPoa = demographicsKept ? poaOfCensusSource(demographicsSource) : null;
  const demographicsReferencePeriod = isRecord(demographics)
    ? str(demographics['referencePeriod'])
    : null;
  let demographicsRuling: string;
  if (demographics === undefined || demographics === null) {
    demographicsRuling =
      'No demographic payload was supplied for this report, so none is narrated.';
  } else if (demographicsKept) {
    demographicsRuling =
      `Retrieved from the ABS Census postal-area table (${demographicsSource ?? 'POA'}) and kept.`;
  } else {
    delete next['demographics'];
    removed.push({
      path: 'demographics',
      reason:
        'Not recognised as a retrieval from the ABS Census postal-area table. A '
        + 'generated block carrying an ABS label is the defect this closes, and a '
        + 'source must be recognised rather than merely not blocked.',
      hadValue: true,
    });
    demographicsRuling =
      'The demographic payload is not a recognised ABS Census postal-area retrieval, '
      + 'so it is withheld. It is not estimated, synthesised or borrowed from a '
      + 'neighbouring area.';
  }
  facts.push(gateFact({
    name: 'market.demographics',
    value: demographicsKept ? 'retrieved' : null,
    safety: demographicsKept ? 'contextual' : 'not_client_safe',
    source: demographicsKept ? 'abs_census_poa' : 'generated',
    material: true,
    context: demographicsKept
      ? {
        grain: 'postcode',
        referencePeriod: demographicsReferencePeriod ?? '2021 Census',
        dataset: 'abs_census_poa',
        asOf: demographicsReferencePeriod,
      }
      : undefined,
    absenceReason: demographicsKept ? undefined : demographicsRuling,
  }));

  // --- The cash rate: the in-force target leads, the average is context -----
  //
  // The gate's verdict has to reach the PROMPT, not just the fact list.
  // `macroEconomicBlock` renders `economics.cashRateTarget` straight off the
  // payload, so a refused target — an LLM-sourced one, a series that is not
  // FIRMMCRTD — would still have printed a "current" row with an effective
  // date while the gate recorded it as absent. Removing the refused value from
  // the object is what makes the refusal structural rather than advisory: the
  // block then fails closed onto the monthly average under its own label,
  // which is exactly what it does when F1 is not loaded at all.
  const targetFact = safeCashRateTarget(input.cashRateTarget ?? null);
  const monthlyFact = safeCashRate(input.cashRateMonthlyAverage ?? null);
  facts.push(targetFact, monthlyFact);

  const economics = next['economics'];
  if (isRecord(economics) && economics['cashRateTarget'] !== undefined) {
    if (targetFact.status !== 'present') {
      const stripped = { ...economics };
      delete stripped['cashRateTarget'];
      next['economics'] = stripped;
      removed.push({
        path: 'economics.cashRateTarget',
        reason:
          targetFact.absence?.reason
          ?? 'The gate did not recognise this as the Reserve Bank cash rate target.',
        hadValue: economics['cashRateTarget'] !== null,
      });
    }
  }

  return {
    enhancedData: next,
    facts,
    removed,
    demographicsKept,
    demographicsRuling,
    snapshot: {
      capturedAt: input.capturedAt,
      assuranceVersion: ASSURANCE_VERSION,
      facts: facts.map((f) =>
        snapshotFactOf(f, f.name === 'market.demographics' ? demographicsPoa : null)),
    },
    version: SAFE_GENERATION_VERSION,
  };
}
