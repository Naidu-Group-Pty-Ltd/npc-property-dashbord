/**
 * The stylesheet must be derived, deterministic and print-legal.
 *
 * "Print-legal" is the part worth spelling out: WeasyPrint silently ignores what
 * it does not implement. A `box-shadow`, a `filter`, a `position: sticky` costs
 * nothing at render time and simply does not appear — so a stylesheet full of
 * screen constructs looks correct in review and prints flat. The only way that
 * defect surfaces before a client sees it is a test that reads the CSS.
 */
import { describe, expect, it } from 'vitest';
import { buildReportCss } from '../css.pure';
import { resolveReportPalette, type ReportPreset } from '../brandResolve.pure';
import { NAMED_PAGES, type NamedPage } from '../page.pure';
import {
  DEFAULT_REPORT_DESIGN_OPTIONS,
  type ReportDesignOptions,
} from '../options.pure';

const palette = resolveReportPalette();
const css = (options?: Partial<ReportDesignOptions>, masthead = 'Acme Advisory · Analysis') =>
  buildReportCss({ palette, options, masthead });

describe('buildReportCss — page geometry is derived, not restated', () => {
  const sheet = css();

  it.each(Object.keys(NAMED_PAGES) as NamedPage[])('emits an @page rule for %s', (page) => {
    // `body` is the base rule and is emitted unnamed.
    if (page === 'body') expect(sheet).toMatch(/@page\s*\{/);
    else expect(sheet).toContain(`@page ${page} {`);
  });

  it.each(Object.keys(NAMED_PAGES) as NamedPage[])('exposes .page-%s to markup', (page) => {
    expect(sheet).toContain(`.page-${page} { page: ${page}; }`);
  });

  it('suppresses running chrome on every full-bleed page', () => {
    for (const [name, spec] of Object.entries(NAMED_PAGES)) {
      if (spec.header && spec.footer) continue;
      const rule = sheet.slice(sheet.indexOf(`@page ${name} {`));
      const block = rule.slice(0, rule.indexOf('\n  }'));
      if (!spec.header) expect(block, name).toContain('@top-left { content: none; }');
      if (!spec.footer) expect(block, name).toContain('@bottom-right { content: none; }');
    }
  });

  it('sets the landscape page landscape', () => {
    const rule = sheet.slice(sheet.indexOf('@page landscape-table {'));
    expect(rule.slice(0, rule.indexOf('\n  }'))).toContain('size: A4 landscape;');
  });
});

describe('buildReportCss — the masthead is the tenant\'s, and is escaped', () => {
  it('prints the supplied masthead in the running foot', () => {
    expect(css(undefined, 'Harbour Capital · Compass')).toContain(
      'content: "Harbour Capital · Compass";',
    );
  });

  it('escapes a quote rather than terminating the CSS string', () => {
    // Without escaping this closes the string and WeasyPrint drops the whole
    // @page block — a silently missing footer on every page.
    const sheet = css(undefined, 'The "Good" Property Co');
    expect(sheet).toContain('content: "The \\"Good\\" Property Co";');
    expect(sheet).not.toContain('content: "The "Good"');
  });

  it('flattens a newline, which is a CSS parse error inside a string', () => {
    expect(css(undefined, 'Line one\nLine two')).toContain('content: "Line one Line two";');
  });
});

describe('buildReportCss — print legality', () => {
  const sheet = css({ showDropCaps: true, chapterStyle: 'opener_band' });

  it.each([
    ['-webkit-', /-webkit-/],
    ['box-shadow', /box-shadow/],
    ['filter', /(^|[^-\w])filter\s*:/],
    ['position: fixed', /position:\s*fixed/],
    ['position: sticky', /position:\s*sticky/],
    ['background-clip', /background-clip/],
    ['CSS Grid', /display:\s*grid/],
    ['flexbox', /display:\s*flex/],
    // WeasyPrint places a floated ::first-letter but does not shorten the first
    // line box around it, so the initial lands on top of the words it opens.
    // Verified against a real render; the option ships a raised initial instead.
    ['a floated initial', /float:\s*left/],
  ])('emits no %s', (_label, pattern) => {
    expect(sheet).not.toMatch(pattern);
  });

  it('keeps exactly one gradient — the cover scrim', () => {
    expect(sheet.match(/linear-gradient/g)).toHaveLength(1);
  });

  it('leaves no unresolved template hole', () => {
    // A stray backtick inside a CSS comment terminates the template literal and
    // the rest of the sheet becomes JavaScript. It has happened twice.
    expect(sheet).not.toContain('${');
    expect(sheet).not.toContain('[object Object]');
  });

  it('emits balanced braces, so no rule is silently swallowed', () => {
    expect((sheet.match(/\{/g) ?? []).length).toBe((sheet.match(/\}/g) ?? []).length);
  });
});

describe('buildReportCss — options actually change the output', () => {
  it('scales the body size with bodyScale', () => {
    expect(css({ bodyScale: 100 })).toContain('font-size: 10.5pt;');
    expect(css({ bodyScale: 115 })).toContain('font-size: 12pt;');
  });

  it('clamps a hostile bodyScale rather than rendering one word per page', () => {
    expect(css({ bodyScale: 400 })).toBe(css({ bodyScale: 115 }));
    expect(css({ bodyScale: Number.NaN })).toBe(css({}));
  });

  it('emits only the selected table variant', () => {
    expect(css({ tableStyle: 'classic' })).toContain('tbody tr:nth-child(even)');
    expect(css({ tableStyle: 'minimal' })).not.toContain('tbody tr:nth-child(even)');
    expect(css({ tableStyle: 'ledger' })).toContain('table.data tbody tr:last-child td');
  });

  it('hides section numbers when the option is off', () => {
    expect(css({ showSectionNumbers: true })).toContain('.chapter-no {\n    display: block;');
    expect(css({ showSectionNumbers: false })).toContain('.chapter-no {\n    display: none;');
  });

  it('only emits the drop-cap rule when asked', () => {
    expect(css({ showDropCaps: false })).not.toContain('::first-letter');
    expect(css({ showDropCaps: true })).toContain('::first-letter');
  });

  it('justifies body copy only when asked, and hyphenates when it does', () => {
    expect(css({ justifyText: true })).toContain('hyphens: auto;');
    expect(css({ justifyText: false })).not.toContain('hyphens: auto;');
  });

  it('changes vertical rhythm with density', () => {
    expect(css({ density: 'compact' })).toContain('line-height: 1.42;');
    expect(css({ density: 'spacious' })).toContain('line-height: 1.72;');
  });

  it('drops the cover photograph to a solid plate at zero intensity', () => {
    expect(css({ visualIntensity: 0 })).toContain('opacity: 0.25;');
    expect(css({ visualIntensity: 100 })).toContain('opacity: 0.7;');
  });
});

describe('buildReportCss — determinism', () => {
  it('is byte-identical for identical input', () => {
    const a = buildReportCss({ palette, options: DEFAULT_REPORT_DESIGN_OPTIONS, masthead: 'X' });
    const b = buildReportCss({ palette, options: DEFAULT_REPORT_DESIGN_OPTIONS, masthead: 'X' });
    expect(a).toBe(b);
  });

  it.each<ReportPreset>(['signature', 'editorial_navy', 'minimal_ink', 'high_contrast'])(
    'builds a complete sheet for the %s preset',
    (preset) => {
      const sheet = buildReportCss({
        palette: resolveReportPalette({ preset }),
        options: { preset },
        masthead: 'Acme',
      });
      expect(sheet).toContain('.report-cover');
      expect(sheet).toContain('table.data');
      expect(sheet).toContain('.company-page');
      // No unresolved template holes.
      expect(sheet).not.toContain('undefined');
      expect(sheet).not.toContain('NaN');
    },
  );

  it('paints Category B semantics regardless of preset or tenant brand', () => {
    const sheet = buildReportCss({
      palette: resolveReportPalette({ preset: 'high_contrast', brandHex: '#00FF00' }),
      options: { preset: 'high_contrast' },
      masthead: 'Acme',
    });
    // The tenant is bright green; "negative" is still the product's red.
    expect(sheet).toContain(`color: ${resolveReportPalette().negative};`);
  });
});
