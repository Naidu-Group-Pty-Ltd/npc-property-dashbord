import { describe, expect, it } from 'vitest';
import { judgeBrowserProductionExport } from '../browserExportGuard';

const page = (types: string[]) => ({
  id: 'p1', name: 'Page 1',
  blocks: types.map((type, i) => ({ id: `b${i}`, type, props: {} })),
});

/**
 * RC-3.2 — the rule is absolute: a paying client never receives a placeholder.
 */
describe('browser production export guard', () => {
  it('permits a template every block of which the browser can draw', () => {
    const verdict = judgeBrowserProductionExport({
      pages: [page(['cover', 'text-block', 'data-table', 'kpi-grid', 'footer'])],
    } as never);
    expect(verdict.ok).toBe(true);
  });

  it('REFUSES a placeholder, not merely warns about it', () => {
    // `exportCapability` calls this a warning, which is right for an operator
    // exporting a draft and wrong for a document leaving the building: a
    // dashed box reading "renders in HTML/PDF pipeline" looks deliberate.
    const verdict = judgeBrowserProductionExport({
      pages: [page(['text-block', 'definition-list'])],
    } as never);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.blockTypes.join(' ')).toMatch(/definition/i);
  });

  it('refuses a block with no renderer at all', () => {
    const verdict = judgeBrowserProductionExport({
      pages: [page(['text-block', 'markdown-block'])],
    } as never);
    expect(verdict.ok).toBe(false);
  });

  it('names the blocks for the operator without naming internals to a client', () => {
    const verdict = judgeBrowserProductionExport({
      pages: [page(['chart-line'])],
    } as never);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // The reason a person reads carries no block id, no renderer name and no
    // infrastructure vocabulary.
    expect(verdict.reason).not.toMatch(/jspdf|weasy|placeholder block|drawExtras|Cloud Run/i);
    expect(verdict.reason).toMatch(/standard report has been produced instead/i);
  });

  it('permits when there is no template — the standard document has no blocks', () => {
    expect(judgeBrowserProductionExport(null).ok).toBe(true);
    expect(judgeBrowserProductionExport(undefined).ok).toBe(true);
  });
});
