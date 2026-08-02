/**
 * The font contract between the type stacks and the render container.
 *
 * ## Why this test exists
 *
 * `typography.pure.ts` used to declare Cormorant Garamond, Fraunces and
 * Playfair Display as installed, on the strength of the Dockerfile's
 * `apt-get install fonts-cormorant-garamond fonts-fraunces
 * fonts-playfair-display`. **None of those three packages exists in Debian** —
 * not bookworm, not trixie. `apt-get install -y` exits non-zero on an unknown
 * package, so that layer failed and the image could not be built at all.
 *
 * Nothing said so, because nothing read the Dockerfile. This does.
 *
 * A font failure is uniquely invisible: the engine substitutes silently, the
 * PDF renders, the tests pass, and the defect is only visible to whoever opens
 * the document — which is the client.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_FONT_FILES,
  CONTAINER_FONT_PACKAGES,
  CONTAINER_INSTALLED_FAMILIES,
  PRINT_STACK,
  effectiveFamily,
  familiesInStack,
  isFileShippedFamily,
  missingFamilies,
  shippedWeights,
} from '../typography.pure';
import { buildReportCss } from '../css.pure';
import { resolveReportPalette } from '../brandResolve.pure';
import {
  chartContext,
  renderBars,
  renderDonut,
  renderGauge,
  renderHeatmap,
  renderQuadrant,
  renderTiles,
  renderWaterfall,
} from '../charts.pure';

const REPO = resolve(__dirname, '../../../..');
const SERVICE = resolve(REPO, 'weasyprint-service');
const DOCKERFILE = readFileSync(resolve(SERVICE, 'Dockerfile'), 'utf8');
const FONT_DIR = resolve(SERVICE, 'fonts');

/** Lines of the Dockerfile with `#` comments stripped — prose names packages. */
const dockerCode = DOCKERFILE.split('\n')
  .map((line) => line.replace(/(^|\s)#.*$/, ''))
  .join('\n');

/** `fonts-*` packages the image actually installs. */
const aptFontPackages = [...new Set(
  (dockerCode.match(/\bfonts-[a-z0-9-]+/g) ?? []),
)].sort();

describe('the Dockerfile and the type stacks agree', () => {
  it('installs exactly the packages the module claims', () => {
    expect(aptFontPackages).toEqual(Object.keys(CONTAINER_FONT_PACKAGES).sort());
  });

  it('COPYs exactly the font files the module claims', () => {
    const onDisk = readdirSync(FONT_DIR).filter((f) => f.endsWith('.ttf')).sort();
    expect(onDisk).toEqual(Object.keys(CONTAINER_FONT_FILES).sort());
  });

  it('copies the font directory into the image and rebuilds the cache', () => {
    expect(dockerCode).toMatch(/COPY\s+fonts\/\s+\/usr\/local\/share\/fonts\//);
    // Without fc-cache the files are present and fontconfig cannot see them,
    // which looks exactly like not shipping them.
    expect(dockerCode).toMatch(/fc-cache\s+-f/);
  });

  it('pins the base image to a Debian release', () => {
    // The package contract is only checkable against a known release, and an
    // unpinned `-slim` moves distribution when the tag is rebuilt.
    expect(dockerCode).toMatch(/^FROM python:[\d.]+-slim-(bookworm|trixie)\s*$/m);
  });

  /**
   * The exact regression. These three read as plausible package names and are
   * the ones that broke the build.
   */
  it.each([
    'fonts-playfair-display',
    'fonts-cormorant-garamond',
    'fonts-fraunces',
  ])('does not install %s — no such Debian package', (pkg) => {
    expect(aptFontPackages).not.toContain(pkg);
  });
});

describe('the font files themselves', () => {
  it.each(Object.keys(CONTAINER_FONT_FILES))('%s declares a plausible weight', (file) => {
    const spec = CONTAINER_FONT_FILES[file];
    expect(spec.weight).toBeGreaterThanOrEqual(100);
    expect(spec.weight).toBeLessThanOrEqual(900);
    // The filename is the only cross-check available without parsing the OS/2
    // table, and a mislabelled weight is silently wrong forever.
    const named: Record<string, number> = {
      Regular: 400, Italic: 400, Medium: 500, SemiBold: 600, Bold: 700, Black: 900,
    };
    const suffix = Object.keys(named).find((n) => file.includes(n));
    if (suffix) expect(spec.weight).toBe(named[suffix]);
    expect(Boolean(spec.italic)).toBe(/italic/i.test(file));
  });

  it.each(Object.keys(CONTAINER_FONT_FILES))('%s exists and is a real font', (file) => {
    const path = resolve(FONT_DIR, file);
    expect(existsSync(path), `${file} is declared but not present`).toBe(true);
    // A truncated or LFS-pointer file is a few hundred bytes and installs
    // without complaint.
    expect(statSync(path).size).toBeGreaterThan(20_000);
    // TrueType magic: 0x00010000, or 'true'.
    const head = readFileSync(path).subarray(0, 4);
    expect([...head]).toSatisfy((bytes: number[]) =>
      (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)
      || String.fromCharCode(...bytes) === 'true');
  });

  it('ships a licence beside every redistributed family', () => {
    // SIL OFL 1.1 requires the licence to travel with the font, and these are
    // redistributed inside a container image.
    const licences = readdirSync(FONT_DIR).filter((f) => f.endsWith('-OFL.txt'));
    const families = [...new Set(Object.values(CONTAINER_FONT_FILES).map((f) => f.family))];
    expect(licences.length).toBeGreaterThanOrEqual(families.length);
    for (const licence of licences) {
      expect(readFileSync(resolve(FONT_DIR, licence), 'utf8')).toContain('SIL OPEN FONT LICENSE');
    }
  });

  it('ships an italic for the accent role', () => {
    // Without a real italic the engine synthesises a slant from the upright,
    // which on a high-contrast didone reads as a printing fault. The first real
    // render showed exactly that, because the accent stack led with a family
    // that was not installed at all.
    const accentFamily = effectiveFamily(PRINT_STACK.accent);
    expect(accentFamily).not.toBeNull();
    expect(shippedWeights(accentFamily!, true).length).toBeGreaterThan(0);
  });
});

describe('every stack resolves to a face that exists', () => {
  it.each(Object.entries(PRINT_STACK))('%s names no absent family', (_role, stack) => {
    expect(missingFamilies(stack)).toEqual([]);
  });

  it.each(Object.entries(PRINT_STACK))('%s resolves to an installed face', (role, stack) => {
    const family = effectiveFamily(stack);
    expect(
      family,
      `the ${role} stack falls through to its generic — the reader gets the `
        + 'engine default and nothing reports it',
    ).not.toBeNull();
    expect(CONTAINER_INSTALLED_FAMILIES).toContain(family);
  });

  it.each(Object.entries(PRINT_STACK))('%s ends in a generic', (_role, stack) => {
    // A missing face must degrade to the right *shape*. Without the generic, a
    // sans-set technical report prints in Times.
    expect(stack.trim()).toMatch(/(serif|sans-serif|monospace)$/);
  });

  it('sets the cover in the brand display face and nothing else does', () => {
    // Cinzel ships Bold only and sets lowercase as small capitals; at body sizes
    // it is unreadable.
    expect(familiesInStack(PRINT_STACK.cover)[0]).toBe('Cinzel');
    for (const [role, stack] of Object.entries(PRINT_STACK)) {
      if (role === 'cover') continue;
      expect(familiesInStack(stack), role).not.toContain('Cinzel');
    }
  });
});

/**
 * The check that would have caught the real defect.
 *
 * A weight the stylesheet asks for and the image cannot answer is not a missing
 * font — it is a *synthesised* one: the engine smears the nearest face, the PDF
 * renders, and nothing reports it. This reads the actual stylesheet, so it
 * cannot drift from what ships.
 */
describe('every weight the stylesheet asks for exists as a file', () => {
  const css = buildReportCss({ palette: resolveReportPalette(), masthead: 'Acme' });

  /**
   * The drawings request type too, through SVG attributes rather than
   * declarations — and they are where Playfair Bold is asked for. Scanning only
   * the stylesheet would have shipped a file nothing used and missed a weight
   * something did.
   */
  const chartCtx = chartContext(resolveReportPalette());
  const charts = [
    renderGauge(chartCtx, 72, { label: 'Score', caption: 'weighted' }),
    renderWaterfall(chartCtx, [{ label: 'A', value: 10 }, { label: 'B', value: -4, total: true }]),
    renderBars(chartCtx, [{ label: 'A', value: 4 }], { title: 'Scorecard' }),
    renderDonut(chartCtx, [{ label: 'A', value: 6 }, { label: 'B', value: 4 }], { title: 'Mix' }),
    renderHeatmap(chartCtx, [[1, 2], [3, 4]], { title: 'Grid' }),
    renderTiles(chartCtx, [{ label: 'A', value: '$1' }], { title: 'Tiles' }),
    renderQuadrant(chartCtx, [{ x: 1, y: 1, label: 'A', highlight: true }], { title: 'Q' }),
  ].join('');

  /** (family, weight, italic) triples the report actually requests. */
  const requested = (() => {
    const out = new Map<string, { family: string; weight: number; italic: boolean }>();
    const add = (family: string, weight: number, italic: boolean) => {
      const head = family.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      out.set(`${head}|${weight}|${italic}`, { family: head, weight, italic });
    };
    for (const tag of charts.match(/<text [^>]*>/g) ?? []) {
      const family = tag.match(/font-family="([^"]+)"/)?.[1];
      if (!family) continue;
      add(family, Number(tag.match(/font-weight="(\d+)"/)?.[1] ?? 400), false);
    }
    for (const [, block] of css.matchAll(/\{([^{}]*)\}/g)) {
      const family = block.match(/font-family:\s*([^;]+);/)?.[1];
      if (!family) continue;
      // An unstated weight is 400, not "no request" — which is precisely where
      // Playfair Regular is used (the pull quote states no weight at all).
      const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1] ?? 400);
      const head = family.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      const italic = /font-style:\s*italic/.test(block);
      out.set(`${head}|${weight}|${italic}`, { family: head, weight, italic });
    }
    return [...out.values()];
  })();

  it('finds weight declarations to check', () => {
    expect(requested.length).toBeGreaterThan(3);
  });

  it.each(requested.map((r) => [`${r.family} ${r.weight}${r.italic ? ' italic' : ''}`, r]))(
    '%s is answered by a real file, not synthesised',
    (_label, req) => {
      // Families from a Debian package ship their full weight range; only the
      // file-shipped ones can have a gap.
      if (!isFileShippedFamily(req.family)) return;
      expect(
        shippedWeights(req.family, req.italic),
        `${req.family} ${req.weight}${req.italic ? ' italic' : ''} would be `
          + 'synthesised — add the weight to weasyprint-service/fonts/',
      ).toContain(req.weight);
    },
  );

  it('ships no weight the stylesheet never asks for', () => {
    // Not a correctness failure, but every file is ~190KB in the image.
    const asked = new Set(requested.map((r) => `${r.family}|${r.weight}|${r.italic}`));
    for (const [file, spec] of Object.entries(CONTAINER_FONT_FILES)) {
      const key = `${spec.family}|${spec.weight}|${Boolean(spec.italic)}`;
      expect(asked.has(key), `${file} is not requested anywhere`).toBe(true);
    }
  });
});

describe('CONTAINER_INSTALLED_FAMILIES is derived, not restated', () => {
  it('is exactly the union of the two installation routes', () => {
    const union = [...new Set([
      ...Object.values(CONTAINER_FONT_PACKAGES).flat(),
      ...Object.values(CONTAINER_FONT_FILES).map((f) => f.family),
    ])].sort();
    expect([...CONTAINER_INSTALLED_FAMILIES]).toEqual(union);
  });

  it('lists no family twice', () => {
    expect(new Set(CONTAINER_INSTALLED_FAMILIES).size).toBe(CONTAINER_INSTALLED_FAMILIES.length);
  });
});
