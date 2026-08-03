/**
 * Fictional Market Intelligence rows.
 *
 * Structurally faithful to the six real reports — eight layer keys, the same
 * prose block names, the same `marketEvents` shape, `includedLayers` in the
 * short form the edge function writes — and invented in every particular. No
 * client, no tenant and no figure here is real.
 */

export const LAYER_KEYS = [
  'layer1_rba',
  'layer2_housing',
  'layer3_sentiment',
  'layer4_regulatory',
  'layer5_outlook',
  'layer6_economic',
  'layer7_micro',
  'layer8_competitive_edge',
] as const;

export const REPORT_ID = '33333333-3333-4333-8333-333333333333';
export const PREPARED_ON = '2026-08-03T00:00:00.000Z';

/** Enough prose to clear `MIN_SECTION_CHARS`, in the model's own register. */
export function prose(seed = 0, paragraphs = 2): string {
  return Array.from({ length: paragraphs }, (_, i) =>
    `The cash rate held at **${(3.6 + (i + seed) * 0.1).toFixed(2)}%** through the quarter, with the `
    + `board's statement noting trimmed-mean inflation at ${(2.8 + i * 0.1).toFixed(1)}% against a `
    + 'target band of 2-3%. Housing credit grew faster than at any point since 2022, and investor '
    + 'lending accounted for a decade-high share of new commitments.').join('\n\n');
}

export function layerBody(seed = 0): string {
  return `## Overview\n\n${prose(seed)}\n\n### What moved\n\n`
    + '- Housing credit growth accelerated for the fourth month\n'
    + '- Investor share of new lending reached a decade high\n\n'
    + `### What it means\n\n${prose(seed + 3, 1)}`;
}

export function events(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-0${(i % 8) + 1}-${String((i % 27) + 1).padStart(2, '0')}`,
    event: `Reserve Bank board meeting ${i + 1}`,
    category: ['interest_rate', 'economic', 'housing', 'regulatory', 'seasonal'][i % 5],
    impact: ['positive', 'negative', 'neutral'][i % 3],
    description: 'The board is expected to hold, with the statement watched for any change to the '
      + 'language around the trimmed mean.',
    relevance_score: 80 - i,
  }));
}

export const cites = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `Reserve Bank of Australia, Statement on Monetary Policy, chart ${i + 1}`);

export interface RowOverrides {
  row?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

/** A completed `full` report with every layer populated. */
export function reportRow(over: RowOverrides = {}): Record<string, unknown> {
  return {
    id: REPORT_ID,
    status: 'completed',
    report_period: 'April 2026',
    report_type: 'full',
    audience_segment: 'general',
    include_advisory_strategy: true,
    generated_at: '2026-04-22T03:00:00.000Z',
    report_data: {
      generatedAt: '2026-04-22T03:00:00.000Z',
      reportPeriod: 'April 2026',
      reportType: 'full',
      reportTypeLabel: 'Full Market Intelligence Report',
      audienceSegment: 'general',
      executiveSummary: `## Executive Summary\n\n${prose(0, 3)}`,
      keyInsightsSnapshot: '## Your 60-Second Briefing\n\n'
        + '- The cash rate held for a third meeting\n'
        + '- Investor lending reached a decade-high share of new commitments\n'
        + '- Completions fall sharply next year against the ten-year average\n'
        + '- Vacancy is less than half the decade average across the sub-market\n'
        + '- Two states have flagged land tax changes; neither has legislated',
      actionableStrategy: `### What To Do Now\n\n${prose(1, 1)}\n\n### What To Avoid\n\n${prose(2, 1)}`,
      ctaContent: `### Where to start\n\n${prose(4, 1)}`,
      includedLayers: [
        'executive', 'key_insights', 'layer1', 'layer2', 'layer3', 'layer4',
        'layer5', 'layer6', 'layer7', 'layer8', 'actionable_strategy', 'events', 'cta',
      ],
      ...Object.fromEntries(
        LAYER_KEYS.map((k, i) => [k, { content: layerBody(i), citations: cites(3) }]),
      ),
      marketEvents: events(12),
      allCitations: cites(21),
      ...(over.data ?? {}),
    },
    ...(over.row ?? {}),
  };
}
