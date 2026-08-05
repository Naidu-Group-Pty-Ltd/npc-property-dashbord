/**
 * Four rules about where a page may break, each written for the render that
 * showed it was needed.
 *
 * None of these were visible in a test before, and none of them is a rule about
 * *content* — they are all "the reader turns the page and finds a fault". They
 * are here rather than in a format's own spec because three of the four are in
 * shared print primitives that every format goes through.
 */
import { describe, expect, it } from 'vitest';

import { buildReportCss } from '../css.pure';
import { renderContentsPage } from '../primitives.pure';
import { resolveReportPalette } from '../brandResolve.pure';

const sheet = () => buildReportCss({ palette: resolveReportPalette(), masthead: 'Acme' });
const entry = (n: number) => ({
  number: String(n).padStart(2, '0'),
  title: `Section ${n}`,
  note: 'A note of about the length these carry in a real report.',
});

describe('a contents page does not strand its last entry', () => {
  it('splits evenly rather than filling the first sheet', () => {
    // Fourteen entries put thirteen rows on one sheet and the fourteenth alone
    // on the next, at 0.2% ink, on a named page that carries no running head —
    // page three of a twenty-two page report was one line under nothing.
    const html = renderContentsPage('Contents', Array.from({ length: 14 }, (_, i) => entry(i + 1)), 11);
    const sheets = html.split('page-contents').length - 1;
    expect(sheets).toBe(2);
    const rows = html.split('page-contents').slice(1).map((s) => s.split('toc-row').length - 1);
    expect(rows).toEqual([7, 7]);
  });

  it('gives every sheet its own heading, so a continuation is not anonymous', () => {
    const html = renderContentsPage('Contents', Array.from({ length: 14 }, (_, i) => entry(i + 1)), 11);
    expect(html.split('<h1>').length - 1).toBe(2);
  });

  it('is one sheet, unchanged, when it fits', () => {
    const html = renderContentsPage('Contents', [entry(1), entry(2)], 11);
    expect(html.split('page-contents').length - 1).toBe(1);
    expect(html.split('toc-row').length - 1).toBe(2);
  });

  it('is one sheet when no cap is given, which is every other format', () => {
    const html = renderContentsPage('Contents', Array.from({ length: 30 }, (_, i) => entry(i + 1)));
    expect(html.split('page-contents').length - 1).toBe(1);
  });
});

describe('a subhead does not open a section at the foot of a page', () => {
  it('keeps the heading with its first two blocks', () => {
    // `page-break-after: avoid` on the heading only promises the *next* box,
    // and when every paragraph is one line the next box always fits — so a
    // section opened two lines before the footer and continued overleaf. The
    // orphans/widows properties count lines inside one paragraph and cannot see
    // this at all.
    const css = sheet();
    expect(css).toMatch(/h2 \+ p[^{]*\{[^}]*break-after: avoid/);
    expect(css).toMatch(/h3 \+ p[^{]*\{[^}]*break-after: avoid/);
  });

  it('covers the block kinds a section actually opens with', () => {
    const css = sheet();
    for (const opener of ['h2 + ul', 'h2 + ol', 'h2 + .table-block']) {
      expect(css, opener).toContain(opener);
    }
  });
});
