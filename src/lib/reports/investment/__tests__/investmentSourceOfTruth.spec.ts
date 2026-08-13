/**
 * The investment document must have exactly one implementation.
 *
 * The guard matters more here than anywhere else in the programme. The route
 * this format replaces carried **two** chart engines, both of them
 * function-for-function duplicates of `reportDesign/charts.pure.ts` —
 * `renderGaugeSvg`, `renderWaterfallSvg`, `renderHeatmapSvg`,
 * `renderScoreWheelSvg`, `renderBulletSvg`, `renderMarimekkoSvg`,
 * `renderMicroMapSvg`, `renderQuadrantSvg`, `renderPictographSvg`,
 * `renderDonutSvg`, `renderTilesSvg` — plus its own 24-value palette and its
 * own Markdown parser off a CDN. Duplication at that scale is what this rule
 * exists to prevent, and this is the format that proves the point.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const CANONICAL_DIR = resolve(REPO, 'supabase/functions/_shared/reports/investment');
const BRIDGE_DIR = resolve(REPO, 'src/lib/reports/investment');

const pureModules = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.pure.ts')).sort();

const BRIDGE_SHAPE =
  /^(?:\/\*\*[\s\S]*?\*\/\s*)?export \* from '\.\.\/\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/reports\/investment\/([\w.]+)\.pure\.ts';\s*$/;

/**
 * Siblings, the design system next door, or the shared report helpers.
 *
 * `vizDirectives`/`vizFigures` joined `text`/`markdown` when the model's own
 * `{{bars: …}}` vocabulary turned out to be shared: it is written into the
 * investment corpus, but the parser and the router sit at the root of
 * `_shared/reports/` because nothing about them is investment-specific.
 */
const ALLOWED_IMPORT =
  /^(?:\.\/[\w.]+\.pure\.ts|\.\.\/\.\.\/reportDesign\/[\w.]+\.(?:pure|generated)\.ts|\.\.\/(?:text|markdown|vizDirectives|vizFigures)\.pure\.ts)$/;

describe('investment report — single source of truth', () => {
  it('has at least one canonical module', () => {
    expect(pureModules(CANONICAL_DIR).length).toBeGreaterThan(0);
  });

  it('exposes exactly one bridge per canonical module, and no extras', () => {
    expect(pureModules(BRIDGE_DIR)).toEqual(pureModules(CANONICAL_DIR));
  });

  describe.each(pureModules(BRIDGE_DIR))('bridge %s', (file) => {
    const source = readFileSync(resolve(BRIDGE_DIR, file), 'utf8');

    it('is only a re-export of its canonical module', () => {
      const match = source.match(BRIDGE_SHAPE);
      expect(match, `${file} must contain nothing but a doc comment and one \`export *\``).not.toBeNull();
      expect(`${match![1]}.pure.ts`).toBe(file);
    });

    it('declares no logic of its own', () => {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/export (?:const|function|class|interface|type|default)\b/);
      expect(code).not.toMatch(/^\s*import\b/m);
    });
  });

  describe.each(pureModules(CANONICAL_DIR))('canonical %s', (file) => {
    const source = readFileSync(resolve(CANONICAL_DIR, file), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    it('imports only siblings, the design system, or the shared helpers', () => {
      // Specifiers only — matching `from '…'` anywhere also matches prose.
      const imports = [...source.matchAll(/from '([^']+)'/g)]
        .map((m) => m[1])
        .filter((spec) => !/\s/.test(spec));
      for (const spec of imports) {
        expect(spec, `${file} imports "${spec}"`).toMatch(ALLOWED_IMPORT);
      }
    });

    it('is pure — no clock, no randomness, no I/O', () => {
      for (const forbidden of ['Date.now(', 'new Date(', 'Math.random(', 'fetch(', 'localStorage', 'Deno.']) {
        expect(code, `${file} uses ${forbidden} — pass it in as an argument instead`).not.toContain(forbidden);
      }
    });

    it('draws no SVG of its own', () => {
      // The rule this format exists to restate. Charts are composed from
      // `reportDesign/charts.pure.ts`; a module here that opens an `<svg>` is a
      // third chart engine starting.
      //
      // `charts.pure.ts` is exempt for exactly two shapes it assembles by hand —
      // the SWOT grid, which is HTML rather than SVG, and the peer strip, whose
      // dual-axis geometry has no primitive. Both are named here so a third
      // never arrives quietly.
      if (file === 'charts.pure.ts') {
        const opens = (code.match(/<svg\b/g) || []).length;
        expect(opens, 'charts.pure.ts may hand-assemble the peer strip and nothing else')
          .toBeLessThanOrEqual(1);
        return;
      }
      expect(code, `${file} emits raw SVG`).not.toMatch(/<svg\b/);
    });

    it('draws no PDF of its own', () => {
      for (const library of ['jspdf', 'jsPDF', 'pdf-lib', 'html2canvas', 'PDFDocument', 'api2pdf', 'quickchart']) {
        expect(code, `${file} references ${library}`).not.toContain(library);
      }
    });

    it('hardcodes no colour', () => {
      // The route being replaced carried 24 hex literals in a `THEME` object,
      // none of them the tenant's brand. Every colour here comes from the
      // resolved palette.
      const hexes = code.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
      expect(hexes, `${file} hardcodes ${hexes.join(', ')}`).toEqual([]);
    });

    it('formats numbers without the runtime locale', () => {
      // `measure.pure.ts:121` records why — Deno and Node need not agree on ICU
      // grouping, and these strings are asserted in tests.
      expect(code, `${file} uses toLocaleString`).not.toContain('toLocaleString');
    });
  });
});
