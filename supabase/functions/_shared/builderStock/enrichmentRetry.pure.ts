/**
 * Builder stock — when a paid enrichment stage is worth running AGAIN.
 *
 * WHY THIS EXISTS. Stages 2 and 3 spend somebody else's money: three Google
 * calls (geocode, Street View metadata, the image itself) and one Perplexity
 * call per property. They ran unconditionally for every property that had no
 * builder photograph, and since imports began re-queueing every item, importing
 * the same stock list a second time bought the same pictures a second time. On
 * a 70-property list that is ~280 vendor calls to reach the answer already on
 * the row — and under this product's display rule that imagery can never appear
 * on a card anyway, so not one of those calls could change what a client sees.
 *
 * THE RULE, AND WHY IT IS NOT A CACHE TTL.
 *
 *   A stage is run again when it has never answered, when its last answer was
 *   about US rather than about the property, or when the input it answered FOR
 *   has changed. Otherwise the recorded answer stands.
 *
 * That distinction is the whole policy. "The API key was missing", "the kill
 * switch was on", "the circuit was open", "the daily ceiling was reached",
 * "the request failed" are all statements about this deployment at a moment —
 * fix the key and the honest thing is to ask again. "This address has no Street
 * View coverage", "nothing published was found", "this property names nothing
 * to search for" are statements about the property, and asking again with the
 * same input buys the same answer.
 *
 * An expiry window would be a number nobody can justify. Input equality is a
 * fact: the property's own address and search subject are what these stages
 * consume, so they are what decides whether the recorded answer still applies.
 * Correct an address and the stage re-runs — which it MUST, because a Street
 * View of the old address is a picture of the wrong house.
 *
 * MIGRATION IS ONE PASS. Rows written before reasons were recorded carry
 * neither a reason nor an input, and are treated as unknown — so they run once
 * more, and that run records both. The policy costs one extra pass over
 * existing stock and settles for ever after; guessing at those rows instead
 * would freeze whatever they happened to say.
 */

/** The single row each stage writes when it produced no image. */
export const STAGE_STATUS_REFERENCE = 'stage-status';

/** Where the input a stage answered for is recorded, on every row it writes. */
export const STAGE_INPUT_KEY = 'stage_input';
/** Where the classified reason is recorded, on a stage-status row. */
export const STAGE_REASON_KEY = 'stage_reason';

/**
 * Why a stage produced no image.
 *
 * Split by WHO the statement is about, because that is what decides whether
 * asking again can produce a different answer.
 */
export type StageReason =
  // About this deployment or the provider. Ask again.
  | 'not_configured'
  | 'switched_off'
  | 'provider_unavailable'
  | 'quota_exhausted'
  | 'retrieval_failed'
  // About the property or the world. The same input buys the same answer.
  | 'no_input'
  | 'address_not_found'
  | 'no_imagery';

/**
 * The reasons that SETTLE a stage — and the list is deliberately this way round.
 *
 * Membership is tested against the settled set rather than the environmental
 * one, so anything this code does not recognise falls to "ask again": a reason
 * added by a future version, a typo, and the absent reason on a row written
 * before reasons existed all spend a call rather than suppressing a stage on a
 * guess. Being wrong in this direction costs money once; being wrong in the
 * other costs a picture for ever, and nothing would report it.
 */
const SETTLED_REASONS: ReadonlySet<string> = new Set<StageReason>([
  'no_input',
  'address_not_found',
  'no_imagery',
]);

/** Is this a statement about us rather than about the property? */
export function isEnvironmentalReason(reason: unknown): boolean {
  return typeof reason !== 'string' || !SETTLED_REASONS.has(reason);
}

/** The columns of a stage row this decision reads, and no others. */
export interface StageRow {
  source_reference?: string | null;
  processing_status?: string | null;
  source_detail?: Record<string, unknown> | null;
}

export type StageRunReason =
  | 'no_record'
  | 'input_changed'
  | 'environmental'
  | 'already_answered'
  | 'already_settled';

export interface StageDecision {
  /** Whether to spend on this stage now. */
  run: boolean;
  /** Why, for the audit line and for the tests that pin this. */
  reason: StageRunReason;
}

/**
 * The input a stage's recorded rows were answered for, or `undefined` when no
 * row records one.
 *
 * A ready row is preferred over the stage-status row: it is the one that
 * actually produced the picture we are deciding whether to keep.
 */
function recordedInput(rows: StageRow[]): string | null | undefined {
  const ready = rows.filter((row) => row.processing_status === 'ready');
  for (const row of [...ready, ...rows]) {
    const detail = row.source_detail ?? {};
    if (!(STAGE_INPUT_KEY in detail)) continue;
    const value = detail[STAGE_INPUT_KEY];
    return typeof value === 'string' ? value : null;
  }
  return undefined;
}

/**
 * Should this stage be run for this property now?
 *
 * `rows` is every image row the property holds for the ONE stage being decided;
 * `input` is what that stage would consume this time — the geocodable address
 * for stage 2, the search subject for stage 3 — or null when the property does
 * not name enough for the stage to run at all.
 */
export function decideStageRun(rows: StageRow[], input: string | null): StageDecision {
  if (!rows.length) return { run: true, reason: 'no_record' };

  /**
   * A CHANGED INPUT OUTRANKS EVERYTHING, including an image already in hand.
   * If the address was corrected, the Street View on the row is of the wrong
   * house — keeping it to save a call would be the more expensive mistake.
   */
  const previous = recordedInput(rows);
  if (previous !== undefined && previous !== input) {
    return { run: true, reason: 'input_changed' };
  }

  // The stage already produced imagery for this input. Buying it again buys
  // the same bytes.
  if (rows.some((row) => row.processing_status === 'ready')) {
    return { run: false, reason: 'already_answered' };
  }

  const status = rows.find((row) => row.source_reference === STAGE_STATUS_REFERENCE);
  if (!status) return { run: true, reason: 'no_record' };

  return isEnvironmentalReason((status.source_detail ?? {})[STAGE_REASON_KEY])
    ? { run: true, reason: 'environmental' }
    : { run: false, reason: 'already_settled' };
}

/** What the audit line says when a stage was not worth paying for again. */
export function stageSkipMessage(reason: StageRunReason): string {
  return reason === 'already_answered'
    ? 'Skipped: this stage already holds imagery for this property.'
    : 'Skipped: this stage already reported that none is available for this property.';
}
