/**
 * The 10 Year Cash Flow routes through Template Builder **only behind a proof
 * that the series on screen is the series that is stored**, and this file keeps
 * that condition from being dropped by someone tidying it into line with the
 * other seven formats.
 *
 * ## Why it is the exception
 *
 * Every other migrated format's delivery path reads the same stored record its
 * adapter reads, so the two agree by construction and the template can simply
 * be asked for. This one does not. `requestCashFlowPdf` takes the projection as
 * an **argument**: `CashFlowAnalysisModal` recomputes ten years in the browser
 * from the report's `manual_overrides` plus whatever the adviser has changed
 * since the modal opened, and sends that. `cashFlowAdapter` reads the stored
 * `financial_calculations.projections`, a different series whenever an override
 * exists — which is the normal case for the reports this modal is opened on.
 *
 * Asking for the template unconditionally would hand a client a document whose
 * numbers are not the ones the adviser was reading while they sent it. So
 * `matchStoredScenario` must name a stored scenario first, and it answers null
 * for everything it cannot be certain of. The rule in one line: **the request
 * for a template is guarded, never bare.**
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LIB = join(__dirname, '..');
const MODAL = join(__dirname, '../../../../components/reports/CashFlowAnalysisModal.tsx');

const withoutComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the cash flow library', () => {
  it('asks for no templated document of its own', () => {
    // The guard lives at the one call site that holds the on-screen series.
    // A `deliver*`-style helper here would have nothing to compare it against.
    for (const file of readdirSync(LIB).filter((f) => f.endsWith('.ts'))) {
      const code = withoutComments(readFileSync(join(LIB, file), 'utf8'));
      expect(code, `${file} routes through Template Builder — read this file's header`)
        .not.toContain('tryTemplateDocument');
    }
  });
});

describe('the modal', () => {
  const code = withoutComments(readFileSync(MODAL, 'utf8'));

  it('never asks for a template without first matching the stored series', () => {
    const at = code.indexOf('tryTemplateDocument(');
    expect(at, 'the modal no longer routes at all — that is a different change')
      .toBeGreaterThan(-1);

    // The match has to be established *before* the request, and be what the
    // request is conditional on. Both are asserted, because either one alone
    // can be true of code that asks regardless.
    const matchAt = code.indexOf('matchStoredScenario(');
    expect(matchAt, 'the template is requested without matching the stored series first')
      .toBeGreaterThan(-1);
    expect(matchAt).toBeLessThan(at);

    // The 200 characters before the call, where the condition has to be.
    const guard = code.slice(Math.max(0, at - 200), at);
    expect(guard, 'the request for a template is not guarded by the match')
      .toMatch(/storedScenario\s*(\?|&&)/);
  });

  it('renders the scenario it proved, not a default one', () => {
    // The adapter picks one of three stored scenarios from `variant`, and
    // defaults to `moderate` when told nothing. Passing the matched scenario is
    // what stops a report whose on-screen series is the optimistic one being
    // typeset from the moderate one — same report, different figures.
    expect(code).toMatch(/tryTemplateDocument\(\s*'cashflow',[^)]*variant:\s*storedScenario/);
  });

  it('still says why, where the next person will look', () => {
    const request = readFileSync(join(LIB, 'requestCashFlowPdf.ts'), 'utf8');
    expect(request).toContain('Template Builder route');
    expect(request).toContain('manual_overrides');
  });
});
