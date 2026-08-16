/**
 * Builder stock — a paid stage must not buy the same answer twice.
 *
 * WHAT WAS WRONG. Stages 2 and 3 spend the prime's forwarded vendor keys:
 * three Google calls (geocode, Street View metadata, the image) and one
 * Perplexity call per property. They ran unconditionally for every property
 * with no builder photograph, and since imports began re-queueing every item
 * they touched, importing the same stock list a second time bought the same
 * pictures a second time. On the 70-property Notion list that is ~280 vendor
 * calls to reach an answer already sitting on the row — and under this
 * product's display rule none of that imagery can ever appear on a card, so
 * not one of those calls could change what a client sees.
 *
 * THE RULE THESE PIN. A stage runs again when it has never answered, when its
 * last answer was about US rather than about the property, or when the input it
 * answered FOR has changed. Otherwise the recorded answer stands.
 *
 * The two directions are not symmetrical and the tests are written to say so:
 * refusing to spend when we should have costs a picture, and spending when we
 * need not costs money. So the doubtful case — an unrecognised reason, a row
 * from before reasons were recorded — spends.
 */
import { describe, expect, it } from 'vitest';

import {
  decideStageRun, isEnvironmentalReason, stageSkipMessage,
  STAGE_INPUT_KEY, STAGE_REASON_KEY, STAGE_STATUS_REFERENCE,
  type StageReason, type StageRow,
} from '../../../supabase/functions/_shared/builderStock/enrichmentRetry.pure';

const ADDRESS = 'Lot 537 Kirramingly Avenue, Donnybrook VIC 3064';

/** The row a stage writes when it produced no image. */
const statusRow = (reason: StageReason | null, input: string | null = ADDRESS): StageRow => ({
  source_reference: STAGE_STATUS_REFERENCE,
  processing_status: 'unavailable',
  source_detail: {
    ...(reason ? { [STAGE_REASON_KEY]: reason } : {}),
    [STAGE_INPUT_KEY]: input,
  },
});

/** The row a stage writes when it bought a picture. */
const readyRow = (input: string | null = ADDRESS): StageRow => ({
  source_reference: 'streetview',
  processing_status: 'ready',
  source_detail: { [STAGE_INPUT_KEY]: input },
});

// ---------------------------------------------------------------------------
// A — nothing recorded
// ---------------------------------------------------------------------------

describe('A — a property nothing has been bought for', () => {
  it('runs the stage', () => {
    expect(decideStageRun([], ADDRESS)).toEqual({ run: true, reason: 'no_record' });
  });

  /** Rows exist for the stage but none of them is the stage's own answer. */
  it('runs when the rows carry no answer at all', () => {
    const orphan: StageRow = { source_reference: 'something-else', processing_status: 'failed' };
    expect(decideStageRun([orphan], ADDRESS).run).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B — THE DEFECT: the same answer, bought again
// ---------------------------------------------------------------------------

describe('B — an answer already given about an unchanged property', () => {
  /**
   * The dominant case. A property whose Street View we already hold is
   * re-queued by every re-import; buying it again buys the same bytes.
   */
  it('does not re-buy imagery it already holds', () => {
    expect(decideStageRun([readyRow()], ADDRESS))
      .toEqual({ run: false, reason: 'already_answered' });
  });

  /**
   * The case that matters MOST on this product's stock, and the one a
   * ready-only rule would have missed: Builder Stock is new estates, whose
   * roads have often not been driven, so "no coverage" is the common answer.
   */
  it('does not re-ask an address that has no imagery', () => {
    expect(decideStageRun([statusRow('no_imagery')], ADDRESS))
      .toEqual({ run: false, reason: 'already_settled' });
  });

  it('does not re-ask an address that could not be located', () => {
    expect(decideStageRun([statusRow('address_not_found')], ADDRESS).run).toBe(false);
  });

  /** A property that names nothing to search for still names nothing. */
  it('does not re-ask a property with nothing to go on', () => {
    expect(decideStageRun([statusRow('no_input', null)], null))
      .toEqual({ run: false, reason: 'already_settled' });
  });
});

// ---------------------------------------------------------------------------
// C — statements about US are always re-asked
// ---------------------------------------------------------------------------

describe('C — an answer that was about this deployment, not the property', () => {
  const environmental: StageReason[] = [
    'not_configured', 'switched_off', 'provider_unavailable',
    'quota_exhausted', 'retrieval_failed',
  ];

  it.each(environmental)('re-runs after %s', (reason) => {
    expect(decideStageRun([statusRow(reason)], ADDRESS))
      .toEqual({ run: true, reason: 'environmental' });
  });

  /**
   * The whole point of the split. Add the key that was missing and the next
   * pass must buy the picture — a policy that froze this would turn a
   * five-minute configuration fix into permanently empty cards.
   */
  it('classifies the environmental reasons and only those', () => {
    for (const reason of environmental) expect(isEnvironmentalReason(reason)).toBe(true);
    for (const reason of ['no_input', 'address_not_found', 'no_imagery']) {
      expect(isEnvironmentalReason(reason)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// D — a changed input outranks everything
// ---------------------------------------------------------------------------

describe('D — the property moved', () => {
  /**
   * NOT a billing question. A Street View bought for the old address is a
   * photograph of the wrong house, so holding it to save a call would be the
   * more expensive mistake.
   */
  it('re-runs when the address it bought for has changed', () => {
    expect(decideStageRun([readyRow('12 Old Road, Somewhere')], ADDRESS))
      .toEqual({ run: true, reason: 'input_changed' });
  });

  it('re-runs when a settled absence was about a different address', () => {
    expect(decideStageRun([statusRow('no_imagery', '12 Old Road, Somewhere')], ADDRESS))
      .toEqual({ run: true, reason: 'input_changed' });
  });

  /** An address filled in later is a change from "nothing to go on". */
  it('re-runs once a property that named nothing names something', () => {
    expect(decideStageRun([statusRow('no_input', null)], ADDRESS))
      .toEqual({ run: true, reason: 'input_changed' });
  });

  /** And the reverse: the same input is the same input. */
  it('does not re-run for an unchanged address', () => {
    expect(decideStageRun([readyRow(ADDRESS)], ADDRESS).run).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E — the doubtful case spends, and it settles after one pass
// ---------------------------------------------------------------------------

describe('E — rows written before any of this existed', () => {
  /**
   * MIGRATION IS ONE PASS, and it is deliberately the expensive direction.
   * A row with no reason and no input tells us nothing, and suppressing a stage
   * on a guess would freeze whatever it happened to say. So it runs once — and
   * that run records a reason and an input, after which the rule applies.
   */
  it('re-runs a row that records neither reason nor input', () => {
    const legacy: StageRow = {
      source_reference: STAGE_STATUS_REFERENCE,
      processing_status: 'unavailable',
      source_detail: { },
    };
    expect(decideStageRun([legacy], ADDRESS)).toEqual({ run: true, reason: 'environmental' });
  });

  it('re-runs a row with no source_detail at all', () => {
    const legacy: StageRow = {
      source_reference: STAGE_STATUS_REFERENCE,
      processing_status: 'unavailable',
      source_detail: null,
    };
    expect(decideStageRun([legacy], ADDRESS).run).toBe(true);
  });

  /** An unrecognised reason is a reason this code does not understand. */
  it('re-runs on a reason it does not recognise', () => {
    expect(decideStageRun([statusRow('something_new' as StageReason)], ADDRESS).run).toBe(true);
  });

  /**
   * A legacy READY row still holds a picture, and no input to compare it
   * against. It is not re-bought — the artefact is the answer.
   */
  it('does not re-buy a legacy row that already holds imagery', () => {
    const legacy: StageRow = {
      source_reference: 'streetview', processing_status: 'ready', source_detail: null,
    };
    expect(decideStageRun([legacy], ADDRESS))
      .toEqual({ run: false, reason: 'already_answered' });
  });
});

// ---------------------------------------------------------------------------
// F — what a person is told
// ---------------------------------------------------------------------------

describe('F — the audit line', () => {
  it('distinguishes holding imagery from having established there is none', () => {
    expect(stageSkipMessage('already_answered')).toMatch(/already holds imagery/);
    expect(stageSkipMessage('already_settled')).toMatch(/none is available/);
  });

  /**
   * A ready row and a settled absence can both be present — a stage that once
   * succeeded and later recorded a status. The picture in hand wins, because
   * it is the thing the record is for.
   */
  it('prefers the imagery in hand when the rows say both', () => {
    expect(decideStageRun([statusRow('no_imagery'), readyRow()], ADDRESS))
      .toEqual({ run: false, reason: 'already_answered' });
  });
});
