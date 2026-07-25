import { describe, expect, it } from 'vitest';
import { getInvestmentGradeTone, getInvestmentScoreSummary, resolveInvestmentGrade } from '../utils';

const report = (overrides: Record<string, unknown> = {}) => ({
  id: 'report-1',
  created_at: '2026-07-24T10:00:00.000Z',
  status: 'completed',
  investment_score: undefined,
  ...overrides,
});

describe('resolveInvestmentGrade', () => {
  it('uses the most recent calculated persisted score rather than report variant order', () => {
    const resolved = resolveInvestmentGrade([
      report({ id: 'compass', created_at: '2026-07-22T10:00:00.000Z', investment_score: { grade: 'B', totalScore: 68 } }),
      report({ id: 'briefing', created_at: '2026-07-24T10:00:00.000Z', investment_score: { grade: 'A', totalScore: 84 } }),
    ] as any);

    expect(resolved).toMatchObject({ status: 'calculated', grade: 'A', score: 84, sourceReportId: 'briefing' });
  });

  it('keeps a completed score authoritative while a newer regeneration is pending', () => {
    const resolved = resolveInvestmentGrade([
      report({ id: 'completed', created_at: '2026-07-22T10:00:00.000Z', investment_score: { grade: 'B+', totalScore: 76 } }),
      report({ id: 'regenerating', created_at: '2026-07-24T10:00:00.000Z', status: 'processing' }),
    ] as any);

    expect(resolved).toMatchObject({ status: 'calculated', grade: 'B+', score: 76, sourceReportId: 'completed' });
  });

  it.each([
    [{ status: 'pending' }, 'pending'],
    [{ status: 'failed' }, 'failed'],
    [{ investment_score: { coverage: { dataInsufficient: true } } }, 'insufficient_data'],
    [{}, 'not_graded'],
  ] as const)('returns %s safely without inventing a score', (input, status) => {
    const resolved = resolveInvestmentGrade([report(input)] as any);
    expect(resolved.status).toBe(status);
    expect(resolved.score).toBeNull();
  });
});

describe('investment score display values', () => {
  it('discards malformed JSON values before they reach the report UI', () => {
    const summary = getInvestmentScoreSummary(report({
      investment_score: {
        grade: { unexpected: 'A' },
        recommendation: ['Buy'],
        totalScore: 82,
        coverage: { partialLabel: 42 },
      },
    }) as any);

    expect(summary).toMatchObject({
      grade: null,
      recommendation: null,
      partialLabel: null,
      score: 82,
    });
  });

  it('handles a non-string grade defensively when called with untyped data', () => {
    expect(getInvestmentGradeTone({ unexpected: 'A' } as any)).toBe('bg-muted text-muted-foreground');
  });
});
