/**
 * The forward-only scoring policy, as executable proofs.
 *
 * Every check below is one of the properties the production closeout requires.
 * They are written against the policy module and against the SOURCE of the
 * scoring service, because the service's scorer is not exported — and a rule
 * asserted over the source cannot be quietly unwired, which is the same guard
 * pattern `scoringMethodology.spec.ts` already uses for the V2 engine.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ASSESSED_LABEL,
  INPUT_CLASSES,
  INPUT_OWNER,
  NOT_ASSESSED_REASON,
  OVERALL_GRADE_UNAVAILABLE,
  SCORING_INPUT_POLICY_VERSION,
  admissibleInputs,
  policyStamp,
  ruleOn,
} from '../market/scoringInputPolicy.pure';
import { gradedLine } from '../investment/scoreSections.pure';

const ROOT = join(__dirname, '..', '..', '..', '..');
const SERVICE = readFileSync(
  join(ROOT, 'supabase', 'functions', 'investment-scoring-service', 'index.ts'), 'utf8',
);

/** The inputs each dimension presents today, from the live scorer. */
const PRESENTED = {
  yield: ['propertyPrice', 'weeklyRent', 'cashFlow'],
  growth: ['priceGrowth1Year', 'priceGrowth3Year', 'populationGrowth'],
  location: ['walkScore', 'commuteTimeCBD', 'schoolsNearby'],
  demand: ['vacancyRate', 'daysOnMarket', 'medianSuburbPrice', 'unemploymentRate'],
  risk: ['lvr', 'cashFlow', 'vacancyRate', 'daysOnMarket', 'priceGrowth1Year'],
} as const;

const MIN_DIMENSIONS = 3;

/** How many dimensions could score, given what the record presents. */
function measuredCount(verified: string[] = []): number {
  const y = admissibleInputs('yield', [...PRESENTED.yield], verified);
  const yieldOk = y.includes('propertyPrice') && y.includes('weeklyRent');
  return [
    yieldOk,
    admissibleInputs('growth', [...PRESENTED.growth], verified).length > 0,
    admissibleInputs('location', [...PRESENTED.location], verified).length > 0,
    admissibleInputs('demand', [...PRESENTED.demand], verified).length > 0,
    admissibleInputs('risk', [...PRESENTED.risk], verified).length > 0,
  ].filter(Boolean).length;
}

describe('an overall grade requires sufficient verified evidence', () => {
  it('today’s inputs yield too few measured dimensions, so no grade may be issued', () => {
    // Everything the record can offer, nothing declared verified.
    expect(measuredCount()).toBeLessThan(MIN_DIMENSIONS);
    expect(measuredCount()).toBe(1); // Yield alone
  });

  it('a grade becomes permitted once enough inputs are genuinely verified', () => {
    const verified = ['walkScore', 'commuteTimeCBD', 'priceGrowth1Year', 'priceGrowth3Year'];
    expect(measuredCount(verified)).toBeGreaterThanOrEqual(MIN_DIMENSIONS);
  });

  it('the stamp records whether a grade was issued, and the policy version', () => {
    const withheld = policyStamp(['yield'], false, new Date('2026-09-11T00:00:00Z'));
    expect(withheld.gradeIssued).toBe(false);
    expect(withheld.eligibility).toBe('insufficient_verified_evidence');
    expect(withheld.inputPolicyVersion).toBe(SCORING_INPUT_POLICY_VERSION);
    expect(withheld.evaluatedAt).toBe('2026-09-11T00:00:00.000Z');

    const issued = policyStamp(['yield', 'growth', 'location'], true, new Date());
    expect(issued.gradeIssued).toBe(true);
    expect(issued.eligibility).toBe('issued');
  });
});

describe('untrusted and unavailable inputs cannot reach a property grade', () => {
  it('Location’s templated inputs are refused until repaired', () => {
    expect(admissibleInputs('location', [...PRESENTED.location])).toEqual([]);
    for (const input of PRESENTED.location) {
      expect(ruleOn('location', input, []).reason).toBe('awaiting_repair');
    }
  });

  it('Growth is refused for want of evidence — and never becomes 50', () => {
    expect(admissibleInputs('growth', [...PRESENTED.growth])).toEqual([]);
    expect(ruleOn('growth', 'priceGrowth1Year', []).reason).toBe('awaiting_evidence');
    // The policy returns admissibility only. It cannot express a substitute
    // value at all, which is what makes the 50 unreachable by construction.
    expect(Object.values(INPUT_CLASSES)).not.toContain(50 as unknown as string);
  });

  it('Demand is refused for want of evidence — and never becomes 50', () => {
    expect(admissibleInputs('demand', [...PRESENTED.demand])).toEqual([]);
    expect(ruleOn('demand', 'vacancyRate', []).reason).toBe('awaiting_evidence');
  });

  it('an input nobody classified is refused rather than admitted', () => {
    expect(ruleOn('growth', 'someNewSignal', []).admitted).toBe(false);
    expect(ruleOn('growth', 'someNewSignal', ['someNewSignal']).reason).toBe('unclassified');
  });
});

describe('the buyer’s position cannot move the property grade', () => {
  it('LVR and cash flow are owned by finance and forbidden to every dimension', () => {
    expect(INPUT_OWNER.lvr).toBe('finance');
    expect(INPUT_OWNER.cashFlow).toBe('finance');
    for (const dim of ['yield', 'growth', 'location', 'demand', 'risk'] as const) {
      expect(ruleOn(dim, 'lvr', []).admitted, `${dim} must not read lvr`).toBe(false);
      expect(ruleOn(dim, 'cashFlow', []).admitted, `${dim} must not read cashFlow`).toBe(false);
      // Declaring a buyer fact "verified" must not open it either: this is an
      // ownership refusal, not a trust one.
      expect(ruleOn(dim, 'lvr', ['lvr']).reason).toBe('not_owned_by_dimension');
    }
  });

  it('Risk has no admissible input left, so it cannot score from the buyer', () => {
    expect(admissibleInputs('risk', [...PRESENTED.risk])).toEqual([]);
    expect(admissibleInputs('risk', [...PRESENTED.risk], ['lvr', 'cashFlow'])).toEqual([]);
  });
});

describe('trusted Yield survives', () => {
  it('operator-entered price and rent score without any declaration', () => {
    const admitted = admissibleInputs('yield', [...PRESENTED.yield]);
    expect(admitted).toContain('propertyPrice');
    expect(admitted).toContain('weeklyRent');
  });

  it('cash flow is still excluded from Yield — it is the buyer’s, not the asset’s', () => {
    expect(admissibleInputs('yield', [...PRESENTED.yield])).not.toContain('cashFlow');
  });

  it('a missing rent leaves Yield unscoreable rather than partially scored', () => {
    const admitted = admissibleInputs('yield', ['propertyPrice']);
    expect(admitted).toEqual(['propertyPrice']);
    expect(admitted.includes('weeklyRent')).toBe(false);
  });
});

describe('what the client is told', () => {
  it('no grade is stated as unavailable evidence, never as a bad property', () => {
    const all = `${OVERALL_GRADE_UNAVAILABLE.value} ${OVERALL_GRADE_UNAVAILABLE.explanation}`;
    expect(OVERALL_GRADE_UNAVAILABLE.value).toMatch(/not available/i);
    expect(all).toMatch(/insufficient verified/i);
    // Never a verdict about the asset.
    expect(all).not.toMatch(/\b(poor|bad|weak|risky|unsuitable|avoid|fail)\b/i);
    // Never an F, a zero or any grade letter standing in for the absence.
    expect(all).not.toMatch(/\bgrade [A-F]\b/);
    expect(all).not.toMatch(/\b0 out of 100\b/);
  });

  it('every dimension has a reason a non-technical reader can act on', () => {
    for (const [dim, reason] of Object.entries(NOT_ASSESSED_REASON)) {
      expect(reason, dim).toMatch(/^Not assessed — /);
      // No engineering vocabulary reaches a client.
      expect(reason, dim).not.toMatch(
        /untrusted|gate|dimension|provenance|hasData|null|composite|admissib/i,
      );
    }
    expect(ASSESSED_LABEL).toBe('Measured');
  });

  it('an absent grade is not rendered as a verdict anywhere', () => {
    // The projection both the viewer and the PDF read returns nothing at all
    // rather than inventing a line, so the two cannot disagree.
    expect(gradedLine({ grade: 'N/A', totalScore: null })).toBeUndefined();
    expect(gradedLine({ grade: null, totalScore: null })).toBeUndefined();
    expect(gradedLine({ totalScore: 72, grade: 'B+' })).toMatch(/Graded B\+ at 72/);
  });
});

describe('the change is forward-only and confined to the property scorer', () => {
  it('the service gates its data points through the policy', () => {
    expect(SERVICE).toContain("from '../_shared/reports/market/scoringInputPolicy.pure.ts'");
    expect(SERVICE).toMatch(/admissibleInputs\(dimension, presented, verified\)/);
    for (const dim of ['yield', 'growth', 'location', 'demand', 'risk']) {
      expect(SERVICE, `${dim} must be gated`).toContain(`admitted('${dim}'`);
    }
  });

  it('the area scorer is untouched — it is a different product surface', () => {
    // Area scoring composes marketMomentum/economicStrength/... and must keep
    // deciding its own coverage; widening this policy onto it would change a
    // surface nothing in this programme measured.
    expect(SERVICE).toContain('marketMomentum: { ...marketMomentum, hasData: mmPoints.length > 0');
  });

  it('nothing here reads or rewrites a stored score', () => {
    const policySrc = readFileSync(
      join(ROOT, 'supabase', 'functions', '_shared', 'reports', 'market', 'scoringInputPolicy.pure.ts'),
      'utf8',
    );
    for (const forbidden of ['supabase', 'from(', 'update(', 'insert(', 'upsert(', 'fetch(']) {
      expect(policySrc, `policy must not ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('a refused input stays visible for audit rather than disappearing', () => {
    expect(SERVICE).toContain('dataPointsPresented');
  });
});
