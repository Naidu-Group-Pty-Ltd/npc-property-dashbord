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
  missingFamilies,
} from '../typography.pure';

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
    const families = [...new Set(Object.values(CONTAINER_FONT_FILES).flat())];
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
    const italics = Object.keys(CONTAINER_FONT_FILES).filter((f) => /italic/i.test(f));
    expect(italics.length).toBeGreaterThan(0);
    const accentFamily = effectiveFamily(PRINT_STACK.accent);
    expect(accentFamily).not.toBeNull();
    expect(italics.some((f) => f.replace(/[^a-z]/gi, '').toLowerCase()
      .includes(accentFamily!.replace(/[^a-z]/gi, '').toLowerCase()))).toBe(true);
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

describe('CONTAINER_INSTALLED_FAMILIES is derived, not restated', () => {
  it('is exactly the union of the two installation routes', () => {
    const union = [...new Set([
      ...Object.values(CONTAINER_FONT_PACKAGES).flat(),
      ...Object.values(CONTAINER_FONT_FILES).flat(),
    ])].sort();
    expect([...CONTAINER_INSTALLED_FAMILIES]).toEqual(union);
  });

  it('lists no family twice', () => {
    expect(new Set(CONTAINER_INSTALLED_FAMILIES).size).toBe(CONTAINER_INSTALLED_FAMILIES.length);
  });
});
