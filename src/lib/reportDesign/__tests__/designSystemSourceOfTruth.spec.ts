/**
 * The report design system must have exactly one implementation.
 *
 * Two failure modes this guards against, both of which have already happened in
 * this repo:
 *
 *  1. **A bridge grows logic.** `src/lib/reportDesign/*.pure.ts` must be nothing
 *     but a re-export. The moment one gains a helper "just for the frontend",
 *     the app and the Edge Functions disagree about what a colour is.
 *  2. **The two directories drift apart.** `compassSectionRegistry.ts` is
 *     mirrored by hand into `src/lib/reports/` and `_shared/`, and
 *     `docs/COMPASS_40_PAGE_ARCHITECTURE.md` states they "must stay in sync" —
 *     they are now 672 lines against 174. Nothing enforced it.
 *
 * Structural assertions, not snapshots, so this guards from the first run.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../..');
const CANONICAL_DIR = resolve(REPO, 'supabase/functions/_shared/reportDesign');
const BRIDGE_DIR = resolve(REPO, 'src/lib/reportDesign');

const pureModules = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.pure.ts')).sort();

/** An optional block comment, then exactly one `export * from '…'`. */
const BRIDGE_SHAPE =
  /^(?:\/\*\*[\s\S]*?\*\/\s*)?export \* from '\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/reportDesign\/([\w.]+)\.pure\.ts';\s*$/;

describe('report design system — single source of truth', () => {
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
      expect(
        match,
        `${file} must contain nothing but a doc comment and one `
          + `\`export * from '../../../supabase/functions/_shared/reportDesign/<name>.pure.ts';\``,
      ).not.toBeNull();
      expect(`${match![1]}.pure.ts`).toBe(file);
    });

    it('declares no logic of its own', () => {
      // Assert on code, not prose — the doc comment legitimately contains the
      // words "import" and "export" while explaining why the bridge exists.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // `export *` is the only export form allowed; anything else is an
      // implementation living in the wrong place.
      expect(code).not.toMatch(/export (?:const|function|class|interface|type|default)\b/);
      expect(code).not.toMatch(/^\s*import\b/m);
    });
  });

  describe.each(pureModules(CANONICAL_DIR))('canonical %s', (file) => {
    const source = readFileSync(resolve(CANONICAL_DIR, file), 'utf8');

    /**
     * Anchored to the start of a line and to an `import`/`export` keyword.
     *
     * `/from '([^']+)'/` on its own matches ordinary prose: a comment whose
     * line happens to end on the word "from" pairs with the opening quote of
     * the next concatenated string, and the guard reports that a canonical
     * module imports `\n      + `. It happened, on a sentence about
     * hyphenation.
     */
    const importSpecs = (code: string): string[] =>
      [...code.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom '([^']+)'/gm)].map((m) => m[1]);

    it('imports only sibling .pure modules, so Deno and Vite both resolve it', () => {
      const imports = importSpecs(source);
      for (const spec of imports) {
        expect(
          spec,
          `${file} imports "${spec}" — canonical modules may only import `
            + 'sibling .pure.ts modules (Edge Functions cannot resolve anything else)',
        ).toMatch(/^\.\/[\w.]+\.pure\.ts$/);
      }
    });

    it('uses explicit .ts extensions on relative imports (Deno requires them)', () => {
      const relative = importSpecs(source).filter((spec) => spec.startsWith('.'));
      for (const spec of relative) expect(spec.endsWith('.ts')).toBe(true);
    });
  });
});
