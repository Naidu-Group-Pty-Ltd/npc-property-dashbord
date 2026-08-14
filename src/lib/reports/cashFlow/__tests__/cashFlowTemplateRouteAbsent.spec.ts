/**
 * The 10 Year Cash Flow deliberately does **not** route through Template
 * Builder, and this is the file that keeps that decision from being undone by
 * someone pattern-matching the other seven formats.
 *
 * ## Why it is the exception
 *
 * Every other migrated format's delivery path asks `tryTemplateDocument` first
 * and renders the activated template when there is one. Those formats all read
 * the same stored record the adapter reads, so the two agree by construction.
 *
 * This one does not. `requestCashFlowPdf` takes the projection **as an
 * argument**: `CashFlowAnalysisModal` recomputes ten years in the browser from
 * the report's `manual_overrides` plus whatever the adviser has changed since
 * the modal opened, and sends that. `cashFlowAdapter` cannot see any of it — it
 * reads the stored `financial_calculations.projections`, a different series
 * whenever an override exists, which is the normal case for the reports this
 * modal is opened on.
 *
 * So routing here would hand a client a document whose numbers are not the
 * numbers the adviser was looking at while they sent it. A misread figure in a
 * client's financial report is this programme's top risk, and it outranks a
 * nicer layout. Wiring it needs a way to know the on-screen series is the
 * stored one; until then, the absence is the feature.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..');

const sources = () => readdirSync(DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => [f, readFileSync(join(DIR, f), 'utf8')] as const);

describe('the cash flow delivery path', () => {
  it('does not ask for a templated document anywhere', () => {
    for (const [file, source] of sources()) {
      // Comments stripped first: this rule is *explained* in prose in
      // `requestCashFlowPdf.ts`, and a check that reads the explanation as a
      // violation would have to be written around rather than trusted.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${file} routes through Template Builder — read that file's header first`)
        .not.toContain('tryTemplateDocument');
    }
  });

  it('still says why, where the next person will look', () => {
    // A rule with no reason beside it gets removed by whoever finds it next.
    const request = readFileSync(join(DIR, 'requestCashFlowPdf.ts'), 'utf8');
    expect(request).toContain('Why there is no Template Builder route here');
    expect(request).toContain('manual_overrides');
  });

  it('and the format still has a working adapter, which is the point', async () => {
    // The exclusion is about *this surface*, not about the format: the adapter
    // renders the stored projection correctly and the Template Library preview
    // uses it. Only the live modal cannot be served by it.
    const { getAdapter } = await import('@/lib/reportTemplate/adapters');
    expect(getAdapter('cashflow')?.supportsProduction).toBe(true);
  });
});
