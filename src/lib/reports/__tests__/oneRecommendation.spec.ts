/**
 * A report makes ONE recommendation — the one its cover prints.
 *
 * The 60 Lawley Street Compass of 25 Sep 2026 printed STRONG BUY on its cover
 * and verdict page, then opened its Executive Verdict and Final
 * Recommendation with "Proceed with caution", and told the client the
 * difference was that "the recommendation also weighs matters the model does
 * not measure". Two verdicts, and an explanation written in the platform's
 * vocabulary rather than an adviser's. The sections had been told to choose
 * from a vocabulary of their own and never to restate the grade's label.
 *
 * The rule now: the verdict the page prints is read by ONE function
 * (`printedVerdict`), the projection publishes the cover's verdict from it,
 * and the generator hands the same answer to the two sections that state a
 * recommendation. Where the page prints no verdict, the adviser's own three
 * labels remain the vocabulary — the document still makes exactly one.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { compassSections } from '../../../../supabase/functions/_shared/compassSectionRegistry';
import {
  ADVISER_RECOMMENDATION_LABELS,
  COMPETING_RECOMMENDATION_LABELS,
  issuedRecommendation,
  RECOMMENDATION_SECTION_IDS,
  recommendationContract,
} from '../../../../supabase/functions/_shared/compassSectionContract';
import { projectInvestmentReport } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import { printedVerdict } from '../../../../supabase/functions/_shared/reports/printedVerdict.pure';
import {
  qualifyRecommendation,
  RECOMMENDATION_BY_GRADE,
} from '../../../../supabase/functions/_shared/reports/market/scoringV2Production.pure';
import { OVERALL_GRADE_UNAVAILABLE } from '../../../../supabase/functions/_shared/reports/market/scoringInputPolicy.pure';

const LAWLEY = {
  grade: 'A+',
  totalScore: 89,
  recommendation: qualifyRecommendation('A+', ['growth', 'location', 'yield', 'demand'], 5),
};

/** Every shape a stored score takes, including the ones that print nothing. */
const RECORDS: Record<string, unknown> = {
  lawley: LAWLEY,
  fullCoverageB: { grade: 'B', totalScore: 62, recommendation: RECOMMENDATION_BY_GRADE.B },
  caution: { grade: 'D', totalScore: 44, recommendation: RECOMMENDATION_BY_GRADE.D },
  bareLegacyAction: { grade: 'C', totalScore: 51, recommendation: 'HOLD' },
  withheldGradeWithVerdict: {
    grade: 'B', totalScore: 60, recommendation: RECOMMENDATION_BY_GRADE.B, policy: { gradeIssued: false },
  },
  ungraded: { grade: 'N/A', recommendation: OVERALL_GRADE_UNAVAILABLE.explanation, policy: { gradeIssued: false } },
  sentenceNotALabel: { grade: 'C', totalScore: 50, recommendation: 'Consider your circumstances carefully before proceeding.' },
  empty: {},
};

describe('the verdict the page prints is read by one rule', () => {
  it('is exactly what the projection publishes as the cover\'s verdict, on every shape', () => {
    for (const [name, score] of Object.entries(RECORDS)) {
      const rec = projectInvestmentReport({ id: name, property_address: 'x', investment_score: score } as never)
        .recommendation as Record<string, unknown>;
      const printed = printedVerdict(score);
      expect(rec.headline, name).toBe(printed?.headline);
      expect(rec.action, name).toBe(printed?.action);
    }
  });

  it('prints no verdict on an ungraded record, an empty one, or no record at all', () => {
    expect(printedVerdict(RECORDS.ungraded)).toBeNull();
    expect(printedVerdict(RECORDS.empty)).toBeNull();
    expect(printedVerdict(null)).toBeNull();
    expect(printedVerdict('STRONG BUY - x')).toBeNull();
  });

  it('keeps the coverage sentence out of the claim, as the page does', () => {
    expect(printedVerdict(LAWLEY)).toEqual({
      headline: 'STRONG BUY - Excellent investment opportunity with strong fundamentals across the metrics assessed.',
      action: 'STRONG BUY',
    });
  });
});

describe('issuedRecommendation', () => {
  it('hands the writer the cover\'s label, grade and score (60 Lawley Street)', () => {
    expect(issuedRecommendation(LAWLEY)).toEqual({
      action: 'STRONG BUY',
      label: 'Strong Buy',
      statement: 'STRONG BUY - Excellent investment opportunity with strong fundamentals across the metrics assessed.',
      grade: 'A+',
      total: 89,
    });
  });

  it('writes every label in the vocabulary as words for a sentence', () => {
    const labels = Object.entries(RECOMMENDATION_BY_GRADE).map(([grade, recommendation]) =>
      issuedRecommendation({ grade, totalScore: 50, recommendation })?.label);
    expect(new Set(labels)).toEqual(new Set(['Strong Buy', 'Buy', 'Hold/Buy', 'Hold', 'Caution', 'Avoid']));
  });

  it('states no grade where the record may not, and still issues the verdict the page prints', () => {
    const issued = issuedRecommendation(RECORDS.withheldGradeWithVerdict);
    expect(issued?.action).toBe('HOLD/BUY');
    expect(issued?.grade).toBeNull();
    expect(issued?.total).toBeNull();
  });

  it('issues nothing where the page prints nothing, and never a sentence as a label', () => {
    expect(issuedRecommendation(RECORDS.ungraded)).toBeNull();
    expect(issuedRecommendation(RECORDS.empty)).toBeNull();
    expect(issuedRecommendation(undefined)).toBeNull();
    // The projection prints this sentence whole; it is not one of the labels,
    // so the writer is not told to open with it.
    expect(printedVerdict(RECORDS.sentenceNotALabel)?.action).toBe('Consider your circumstances carefully before proceeding.');
    expect(issuedRecommendation(RECORDS.sentenceNotALabel)).toBeNull();
    // A legacy record's bare action is a label.
    expect(issuedRecommendation(RECORDS.bareLegacyAction)?.label).toBe('Hold');
  });
});

describe('recommendationContract', () => {
  const [EXEC, FINAL] = RECOMMENDATION_SECTION_IDS;

  it('names two sections the Compass actually writes, and speaks to no other', () => {
    const ids = compassSections().map((s) => s.id);
    for (const id of RECOMMENDATION_SECTION_IDS) expect(ids).toContain(id);
    const issued = issuedRecommendation(LAWLEY);
    for (const id of ids.filter((i) => !(RECOMMENDATION_SECTION_IDS as readonly string[]).includes(i))) {
      expect(recommendationContract(id, issued), id).toBe('');
      expect(recommendationContract(id, null), id).toBe('');
    }
    expect(recommendationContract(undefined, issued)).toBe('');
  });

  it('opens both sections with the cover\'s recommendation and its condition (60 Lawley Street)', () => {
    const issued = issuedRecommendation(LAWLEY);
    for (const id of [EXEC, FINAL]) {
      const c = recommendationContract(id, issued);
      expect(c, id).toContain('This report\'s recommendation is **Strong Buy** (graded A+, 89 out of 100).');
      expect(c, id).toContain('**Strong Buy — subject to the due diligence set out in this report**');
      expect(c, id).toContain('"STRONG BUY - Excellent investment opportunity with strong fundamentals across the metrics assessed."');
      expect(c, id).toContain('it is the only recommendation the document makes');
    }
  });

  it('forbids every other label as a second verdict, and never the one issued', () => {
    for (const [grade, recommendation] of Object.entries(RECOMMENDATION_BY_GRADE)) {
      const issued = issuedRecommendation({ grade, totalScore: 50, recommendation })!;
      const c = recommendationContract(FINAL, issued);
      const forbidden = c.split('\n').find((l) => l.startsWith('- State no other recommendation'))!;
      for (const label of COMPETING_RECOMMENDATION_LABELS) {
        if (label.toLowerCase() === issued.label.toLowerCase()) expect(forbidden, grade).not.toContain(`"${label}"`);
        else expect(forbidden, `${grade}: ${label}`).toContain(`"${label}"`);
      }
    }
  });

  it('conditions only a recommendation to buy; a cautionary one stands as issued', () => {
    const caution = recommendationContract(FINAL, issuedRecommendation(RECORDS.caution));
    expect(caution).toContain('Open this section with it, in bold, on its own line: **Caution**.');
    expect(caution).not.toContain('subject to the due diligence');
  });

  it('gives each section its own shape', () => {
    const issued = issuedRecommendation(LAWLEY);
    expect(recommendationContract(EXEC, issued)).toMatch(/two to four sentences/);
    expect(recommendationContract(FINAL, issued)).toMatch(/150–250 words of continuous rationale/);
  });

  it('keeps the adviser\'s three labels where the page prints no verdict, and one of them only', () => {
    for (const id of [EXEC, FINAL]) {
      const c = recommendationContract(id, null);
      expect(c, id).toContain(`exactly one of ${ADVISER_RECOMMENDATION_LABELS.map((l) => `**${l}**`).join(', ')}`);
      expect(c, id).toContain('the same one in the Executive Verdict and the Final Recommendation');
      expect(c, id).toContain('Do not discuss a grade or a score in this section.');
    }
  });

  it('is written in an adviser\'s voice: the recommendation is never a model\'s output', () => {
    for (const issued of [issuedRecommendation(LAWLEY), null]) {
      for (const id of [EXEC, FINAL]) {
        const c = recommendationContract(id, issued);
        expect(c).toContain('Never describe the recommendation as a score, a model\'s output or a classification.');
        // The instruction that produced the Lawley contradiction, gone in every form.
        expect(c).not.toMatch(/does not measure|model's reading|classification printed/);
      }
    }
  });
});

describe('the registry no longer asks for a second vocabulary', () => {
  it('neither recommendation section is told the grade is "the model\'s classification"', () => {
    for (const id of RECOMMENDATION_SECTION_IDS) {
      const purpose = compassSections().find((s) => s.id === id)!.purpose;
      expect(purpose, id).toContain('the recommendation this document issues');
      expect(purpose, id).not.toMatch(/model's (own )?classification|the model does not measure|Proceed \/ Proceed with caution|\*\*Proceed\*\*/);
    }
  });
});

describe('the generator hands the recommendation to the two sections', () => {
  const generator = readFileSync('supabase/functions/generate-investment-report/index.ts', 'utf8');

  it('reads it after the evidence-basis decision, from the score the sections are written from', () => {
    const decided = generator.indexOf('writtenBasisDecision = decideWrittenBasis(');
    const read = generator.indexOf('const issuedRec = issuedRecommendation(enhancedData?.investmentScore);');
    const loop = generator.indexOf('for (let i = 0; i < filteredSections.length; i++) {');
    expect(decided).toBeGreaterThan(0);
    expect(read).toBeGreaterThan(decided);
    expect(loop).toBeGreaterThan(read);
  });

  it('appends it to the section\'s contract, which travels in the system message untrimmed', () => {
    expect(generator).toContain('const recommendationRules = recommendationContract(baseSectionDef.registryId, issuedRec);');
    expect(generator).toMatch(/\{ \.\.\.baseSectionDef, contract: \[baseSectionDef\.contract, recommendationRules\]\.filter\(Boolean\)\.join\('\\n\\n'\) \}/);
    // …and the call uses the section so composed.
    const call = generator.indexOf('const result = await generateReportSection(\n          sectionDef,');
    expect(call).toBeGreaterThan(generator.indexOf('const recommendationRules = recommendationContract('));
    // The contract is the system message's never-trimmed block.
    expect(generator).toContain("const sectionContractBlock = [sectionDef.contract ?? '', correction ?? '']");
  });
});
