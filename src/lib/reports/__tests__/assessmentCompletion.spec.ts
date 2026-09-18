/**
 * The five-dimension completion gate.
 *
 * The instruction this implements: **a completed final investment grade issues
 * only when all five dimensions have valid scores under the approved method.**
 * Appending "assessed on 3 of 5 dimensions" to an AVOID verdict is an honest
 * sentence and is not a gate, so the letter is now withheld rather than
 * qualified — while every measurement that WAS taken is preserved and
 * reported.
 *
 * Measured over production on 18 September 2026: 9 of 9 runs that issued a
 * grade did so on 3 of 5 dimensions, location and property risk excluded on
 * every one, two of the letters F.
 */

import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_DIMENSIONS,
  MAX_ACQUISITION_ATTEMPTS,
  assessCompletion,
  completionDiffersFromCoverage,
  isValidDimensionScore,
  type CompletionInput,
} from '../../../../supabase/functions/_shared/reports/market/assessmentCompletion.pure.ts';

/** What both validation properties look like today: three measured, two not. */
const THREE_OF_FIVE: CompletionInput = {
  dimensions: {
    growth: { scored: true, score: 56 },
    yield: { scored: true, score: 23 },
    demand: { scored: true, score: 13 },
    location: {
      scored: false,
      reason: 'No location inputs could be measured for this property.',
      recovery: {
        actor: 'system',
        action: 'Regenerate the assessment so the enrichment is re-acquired with a stamp.',
        retryable: true,
      },
    },
    risk: {
      scored: false,
      reason: 'No property-specific risk measurement is available.',
      recovery: {
        actor: 'operator',
        action: 'Submit a building inspection report covering the whole dwelling.',
        retryable: false,
      },
    },
  },
  evidenceCoverage: 0.57,
};

const all5 = (): CompletionInput => ({
  dimensions: Object.fromEntries(
    ASSESSMENT_DIMENSIONS.map((d) => [d, { scored: true, score: 60 }]),
  ) as CompletionInput['dimensions'],
  evidenceCoverage: 0.62,
});

describe('a completed grade needs all five, not a caveat', () => {
  it('withholds the completed grade on three of five', () => {
    const c = assessCompletion(THREE_OF_FIVE);
    expect(c.mayIssueCompletedGrade).toBe(false);
    expect(c.scoredCount).toBe(3);
    expect(c.totalCount).toBe(5);
  });

  it('issues it on five of five', () => {
    const c = assessCompletion(all5());
    expect(c.mayIssueCompletedGrade).toBe(true);
    expect(c.state).toBe('completed');
    expect(c.outstanding).toHaveLength(0);
  });

  it('withholds it on four of five — the threshold is five, not "most"', () => {
    const input = all5();
    (input.dimensions as Record<string, unknown>).risk = {
      scored: false, reason: 'Not measured.',
      recovery: { actor: 'operator', action: 'Submit an inspection report.', retryable: false },
    };
    expect(assessCompletion(input).mayIssueCompletedGrade).toBe(false);
  });
});

describe('the measurements that WERE taken are preserved', () => {
  it('reports every dimension, scored or not', () => {
    const c = assessCompletion(THREE_OF_FIVE);
    expect(c.dimensions).toHaveLength(5);
    expect(c.dimensions.filter((d) => d.scored).map((d) => d.dimension))
      .toEqual(['growth', 'yield', 'demand']);
  });

  it('keeps the scores of the dimensions that scored', () => {
    const c = assessCompletion(THREE_OF_FIVE);
    expect(c.dimensions.find((d) => d.dimension === 'growth')!.score).toBe(56);
    expect(c.dimensions.find((d) => d.dimension === 'yield')!.score).toBe(23);
  });

  it('substitutes NOTHING for a dimension that did not score', () => {
    const c = assessCompletion(THREE_OF_FIVE);
    for (const d of c.outstanding) {
      expect(d.score, `${d.dimension} must carry no substitute value`).toBeNull();
      expect(d.reason).toBeTruthy();
    }
    // Specifically: not zero, and not a neutral mid-point.
    expect(c.dimensions.map((d) => d.score)).toEqual([56, 23, 13, null, null]);
  });

  it('refuses to invent a score even when handed one beside `scored: false`', () => {
    const c = assessCompletion({
      dimensions: { risk: { scored: false, score: 50, reason: 'x' } },
    });
    expect(c.dimensions.find((d) => d.dimension === 'risk')!.score).toBeNull();
  });
});

describe('the four states, and which one an assessment is really in', () => {
  it('is `acquisition` while a retryable gap has attempts left', () => {
    const c = assessCompletion({ ...THREE_OF_FIVE, attemptsUsed: 1 });
    expect(c.state).toBe('acquisition');
    expect(c.attemptsRemaining).toBe(MAX_ACQUISITION_ATTEMPTS - 1);
    expect(c.statement).toContain('automatic attempt');
  });

  it('becomes `evidence_required` once the attempts are spent', () => {
    // The distinction that matters: retrying will not close it any more, so
    // the assessment must stop looking like a slow one and name who must act.
    const c = assessCompletion({ ...THREE_OF_FIVE, attemptsUsed: MAX_ACQUISITION_ATTEMPTS });
    expect(c.state).toBe('evidence_required');
    expect(c.attemptsRemaining).toBe(0);
  });

  it('is `evidence_required` immediately where NOTHING outstanding is retryable', () => {
    // Re-running a fetch cannot produce a building inspection report, so a
    // non-retryable gap never consumes an attempt and never waits.
    const c = assessCompletion({
      dimensions: {
        growth: { scored: true, score: 60 },
        yield: { scored: true, score: 60 },
        demand: { scored: true, score: 60 },
        location: { scored: true, score: 60 },
        risk: {
          scored: false, reason: 'No condition record has been submitted.',
          recovery: { actor: 'operator', action: 'Submit a building inspection report.', retryable: false },
        },
      },
    });
    expect(c.state).toBe('evidence_required');
    expect(c.attemptsRemaining).toBe(MAX_ACQUISITION_ATTEMPTS);
  });

  it('is `processing` while the run is still scoring', () => {
    expect(assessCompletion({ ...THREE_OF_FIVE, inFlight: 'processing' }).state).toBe('processing');
  });

  it('names a specific act and an actor for every gap — never "try again later"', () => {
    const c = assessCompletion({ ...THREE_OF_FIVE, attemptsUsed: MAX_ACQUISITION_ATTEMPTS });
    for (const d of c.outstanding) {
      expect(d.recovery, d.dimension).toBeTruthy();
      expect(d.recovery!.action.length).toBeGreaterThan(25);
      expect(d.recovery!.action.toLowerCase()).not.toContain('try again later');
      expect(['system', 'operator', 'owner', 'provider']).toContain(d.recovery!.actor);
    }
  });

  it('treats a dimension the run said nothing about as a gap in the RECORD', () => {
    // Silence is not "still acquiring"; reporting it that way hides a run that
    // failed to report, for ever.
    const c = assessCompletion({ dimensions: { growth: { scored: true, score: 60 } } });
    const risk = c.dimensions.find((d) => d.dimension === 'risk')!;
    expect(risk.scored).toBe(false);
    expect(risk.recovery!.retryable).toBe(false);
    expect(risk.reason).toContain('recorded no outcome');
    expect(c.state).toBe('evidence_required');
  });
});

describe('history is preserved, never re-derived', () => {
  it('reports a historical record as historical and issues nothing new', () => {
    const c = assessCompletion({ ...THREE_OF_FIVE, historical: true });
    expect(c.state).toBe('historical');
    expect(c.mayIssueCompletedGrade).toBe(false);
    expect(c.statement).toContain('keeps the grade its own run issued');
  });

  it('does not re-issue a historical record even when it is complete', () => {
    const c = assessCompletion({ ...all5(), historical: true });
    expect(c.state).toBe('historical');
    expect(c.mayIssueCompletedGrade).toBe(false);
  });

  it('still reports the historical record’s measurements', () => {
    const c = assessCompletion({ ...THREE_OF_FIVE, historical: true });
    expect(c.scoredCount).toBe(3);
    expect(c.dimensions.find((d) => d.dimension === 'growth')!.score).toBe(56);
  });
});

describe('dimension completion is not evidence coverage', () => {
  it('keeps the run’s own coverage figure and never derives one', () => {
    expect(assessCompletion(THREE_OF_FIVE).evidenceCoverage).toBe(0.57);
    expect(assessCompletion({ dimensions: {} }).evidenceCoverage).toBeNull();
  });

  it('lets five scored dimensions sit below 100% coverage', () => {
    const c = assessCompletion(all5());
    expect(c.scoredCount / c.totalCount).toBe(1);
    expect(c.evidenceCoverage).toBe(0.62);
    expect(completionDiffersFromCoverage(c)).toBe(true);
  });

  it('lets three scored dimensions sit at full coverage of those three', () => {
    const c = assessCompletion({ ...THREE_OF_FIVE, evidenceCoverage: 1 });
    expect(c.scoredCount).toBe(3);
    expect(completionDiffersFromCoverage(c)).toBe(true);
  });

  it('answers false rather than guessing where no coverage was retained', () => {
    expect(completionDiffersFromCoverage(assessCompletion(all5()).evidenceCoverage === null
      ? assessCompletion(all5())
      : assessCompletion({ dimensions: all5().dimensions }))).toBe(false);
  });
});

describe('scored: true is a claim, and the value must satisfy the contract', () => {
  // v1.0.0 trusted the flag: a dimension reporting `scored: true, score: NaN`
  // counted towards the five, so a completed grade could have issued over a
  // value no reader could print.
  const withRisk = (score: unknown): CompletionInput => {
    const input = all5();
    (input.dimensions as Record<string, unknown>).risk = { scored: true, score };
    return input;
  };

  it.each([
    ['missing', undefined],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['negative', -5],
    ['above 100', 150],
    ['a numeric string', '61' as never],
  ])('an invalid score (%s) does not complete the dimension or the assessment', (_label, v) => {
    const c = assessCompletion(withRisk(v));
    const risk = c.dimensions.find((d) => d.dimension === 'risk')!;
    expect(risk.scored).toBe(false);
    expect(c.scoredCount).toBe(4);
    expect(c.mayIssueCompletedGrade).toBe(false);
    expect(c.state).toBe('evidence_required');
  });

  it('never clamps an invalid value into an apparently valid score', () => {
    for (const v of [Number.NaN, 150, -5, Number.POSITIVE_INFINITY]) {
      const risk = assessCompletion(withRisk(v)).dimensions.find((d) => d.dimension === 'risk')!;
      expect(risk.score, `no substitute for ${v}`).toBeNull();
    }
  });

  it('names the invalid value as a defect of the record, with a non-retryable recovery', () => {
    const risk = assessCompletion(withRisk(Number.NaN)).dimensions.find((d) => d.dimension === 'risk')!;
    expect(risk.reason).toContain('invalid value (NaN)');
    expect(risk.reason).toContain('defect of the record');
    expect(risk.recovery!.retryable).toBe(false);
  });

  it('keeps a genuine zero admissible — rock bottom is still measured', () => {
    const c = assessCompletion(withRisk(0));
    const risk = c.dimensions.find((d) => d.dimension === 'risk')!;
    expect(risk.scored).toBe(true);
    expect(risk.score).toBe(0);
    expect(c.mayIssueCompletedGrade).toBe(true);
  });

  it('admits both boundary values, 0 and 100, and nothing beyond them', () => {
    expect(isValidDimensionScore(0)).toBe(true);
    expect(isValidDimensionScore(100)).toBe(true);
    expect(isValidDimensionScore(100.0001)).toBe(false);
    expect(isValidDimensionScore(-0.0001)).toBe(false);
  });

  it('keeps score validity distinct from the reason vocabulary of admissibility', () => {
    // An invalid VALUE is a record defect; inadmissible EVIDENCE is a
    // different statement and keeps its own reason. The two must not blur.
    const evidence = assessCompletion({
      dimensions: {
        ...all5().dimensions,
        risk: { scored: false, reason: 'No condition record has been submitted.' },
      },
    }).dimensions.find((d) => d.dimension === 'risk')!;
    expect(evidence.reason).not.toContain('invalid value');
  });
});

describe('a stale in-flight flag cannot leave an assessment acquiring for ever', () => {
  it('honours a live acquisition claim only while attempts remain', () => {
    const c = assessCompletion({ ...THREE_OF_FIVE, inFlight: 'acquisition', attemptsUsed: 1 });
    expect(c.state).toBe('acquisition');
  });

  it('reads evidence_required on resume once the attempts are spent, whatever the flag says', () => {
    // The reopen/resume case: a run persisted (or replayed) an in-flight flag
    // and died. The next reading must not report "still working" for ever.
    const c = assessCompletion({
      ...THREE_OF_FIVE, inFlight: 'acquisition', attemptsUsed: MAX_ACQUISITION_ATTEMPTS,
    });
    expect(c.state).toBe('evidence_required');
    expect(c.attemptsRemaining).toBe(0);
  });

  it('lets completion beat every in-flight claim on reopen', () => {
    expect(assessCompletion({ ...all5(), inFlight: 'acquisition' }).state).toBe('completed');
    expect(assessCompletion({ ...all5(), inFlight: 'processing' }).state).toBe('completed');
  });

  it('lets history beat every in-flight claim on reopen', () => {
    expect(assessCompletion({ ...THREE_OF_FIVE, historical: true, inFlight: 'acquisition' }).state)
      .toBe('historical');
  });

  it('walks the full transition: acquisition → evidence_required as attempts are consumed', () => {
    const states = [0, 1, 2, 3, 4].map((attemptsUsed) =>
      assessCompletion({ ...THREE_OF_FIVE, attemptsUsed }).state);
    expect(states).toEqual([
      'acquisition', 'acquisition', 'acquisition', 'evidence_required', 'evidence_required',
    ]);
  });
});
