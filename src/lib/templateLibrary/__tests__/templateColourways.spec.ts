/**
 * The colourway layer.
 *
 * The first block of tests is a transcription check and nothing else: the ten
 * Private Banking colourways are design decisions taken in Claude Design, and
 * the only thing that makes them trustworthy in this repository is that they
 * are byte-identical to the approved source. A contrast "improvement" to an
 * approved accent is a design change made by an engineer, and this is what
 * turns that into a failing test rather than into a slightly different report.
 *
 * The rest tests the DERIVATIONS — the roles the six approved values do not
 * cover — because those are this module's own work and can be wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  BODY_INK_LIFT,
  PRIVATE_BANKING_COLOURWAYS,
  SEMANTIC_COLOURS,
  applyColourwayToSchema,
  bodyInkFor,
  colourwayColors,
  colourwayFingerprint,
  colourwayTokenOverride,
  colourwaysForFamily,
  contrastRatio,
  defaultColourwayFor,
  findColourway,
  hexToHsl,
  hslToHex,
  resolveColourway,
  shiftLightness,
} from '../colourways';

/**
 * `COLOURWAYS.pb` from `Template Catalogue.dc.html`, transcribed independently
 * of the module under test.
 *
 * Field order is the catalogue's own `CW_KEYS`:
 *   ['colourway','paper','ink','accent','rule','muted','ground']
 */
const APPROVED_SOURCE: ReadonlyArray<readonly [string, string, string, string, string, string, string]> = [
  ['Gold on Obsidian', '#FAF7EF', '#251F18', '#8E6C15', '#DDD1C0', '#6E6253', 'light'],
  ['Oxblood', '#FAF7EF', '#241819', '#7B2230', '#DED0CE', '#6E5A5C', 'light'],
  ['Verde', '#F7F6EF', '#1C241D', '#2F5D45', '#D5DCD3', '#64705F', 'light'],
  ['Navy Signet', '#F8F8F4', '#1B2130', '#22406E', '#D8DCE2', '#636A76', 'light'],
  ['Slate Bronze', '#F6F5F2', '#23211E', '#8A6A3A', '#DBD8D1', '#6B675F', 'light'],
  ['Platinum', '#F7F7F5', '#1E1E1C', '#4A4A46', '#DCDCD8', '#6A6A66', 'light'],
  ['Obsidian Reverse', '#1E1A15', '#F2EBDE', '#D9A520', '#3A332A', '#A2957F', 'dark'],
  ['Oxblood Night', '#1C1416', '#F0E6E4', '#C0565F', '#332628', '#A2908E', 'dark'],
  ['Deep Verde', '#141A16', '#E8EFE8', '#6FA98A', '#26302A', '#92A196', 'dark'],
  ['Midnight Navy', '#131720', '#E9EDF4', '#7FA3D8', '#262C38', '#93A0B2', 'dark'],
];

describe('approved source values', () => {
  it('ships exactly ten Private Banking colourways', () => {
    expect(PRIVATE_BANKING_COLOURWAYS).toHaveLength(10);
  });

  it('matches the approved catalogue, value for value and in order', () => {
    expect(PRIVATE_BANKING_COLOURWAYS.map(colourwayFingerprint))
      .toEqual(APPROVED_SOURCE.map((row) => row.join('|')));
  });

  it('is six light grounds and four dark, as the catalogue states', () => {
    const light = PRIVATE_BANKING_COLOURWAYS.filter((c) => c.ground === 'light');
    const dark = PRIVATE_BANKING_COLOURWAYS.filter((c) => c.ground === 'dark');
    expect(light).toHaveLength(6);
    expect(dark).toHaveLength(4);
  });

  it('defaults to Gold on Obsidian', () => {
    // The catalogue derives the default rather than storing it: index 0 unless
    // its ground disagrees with the variant's declared mode. Every Private
    // Banking variant declares light and index 0 is light.
    expect(defaultColourwayFor('private_banking')?.name).toBe('Gold on Obsidian');
  });

  it('classifies Gold on Obsidian as a LIGHT ground', () => {
    // The name describes the cover field, not the body ground. Getting this
    // backwards would put the flagship template in the wrong filter bucket.
    expect(findColourway('private_banking', 'pb-gold-on-obsidian')?.ground).toBe('light');
    expect(findColourway('private_banking', 'pb-obsidian-reverse')?.ground).toBe('dark');
  });

  it('has unique ids', () => {
    const ids = PRIVATE_BANKING_COLOURWAYS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('colourway lookup is scoped to its family', () => {
  it('finds a colourway inside its own family', () => {
    expect(findColourway('private_banking', 'pb-verde')?.name).toBe('Verde');
  });

  it('refuses a colourway from a family that does not exist', () => {
    // A colourway id is only meaningful inside the family that curated it. A
    // global lookup would let a request paint a Private Banking master in a
    // palette no designer ever paired it with.
    expect(findColourway('luxury_editorial', 'pb-verde')).toBeNull();
    expect(colourwaysForFamily('luxury_editorial')).toHaveLength(0);
  });

  it('returns null rather than a default for an unknown id', () => {
    expect(findColourway('private_banking', 'pb-not-a-colourway')).toBeNull();
    expect(findColourway('private_banking', null)).toBeNull();
  });
});

describe('colour maths', () => {
  it('round-trips hex through HSL', () => {
    for (const c of PRIVATE_BANKING_COLOURWAYS) {
      expect(hslToHex(hexToHsl(c.paper))).toBe(c.paper.toUpperCase());
      expect(hslToHex(hexToHsl(c.accent))).toBe(c.accent.toUpperCase());
    }
  });

  it('clamps rather than wrapping at the ends of the lightness scale', () => {
    expect(shiftLightness('#000000', -20)).toBe('#000000');
    expect(shiftLightness('#FFFFFF', 20)).toBe('#FFFFFF');
  });
});

describe('body ink derivation', () => {
  it('reproduces the archetype pair the rule was measured from', () => {
    // The approved Private Banking archetype sets `--field: #251F18` and
    // `--ink: #312A21` — the NPC design system's `--aurixa-obsidian` and
    // `--foreground`, four points of lightness apart. If this drifts, body copy
    // on every Private Banking page is the wrong weight of black.
    const gold = PRIVATE_BANKING_COLOURWAYS[0];
    expect(gold.ink).toBe('#251F18');
    const derived = hexToHsl(bodyInkFor(gold));
    const archetype = hexToHsl('#312A21');
    // Tolerances are set by 8-bit quantisation, not by looseness about the
    // rule. At 12–16% lightness one step of 1/255 moves the computed hue by
    // more than a degree, so an exact match is not a thing a hex colour can be.
    expect(derived.l).toBeCloseTo(archetype.l, 0);
    expect(Math.abs(derived.h - archetype.h)).toBeLessThan(3);
  });

  it('lifts by exactly the documented delta on a light ground', () => {
    for (const c of PRIVATE_BANKING_COLOURWAYS.filter((x) => x.ground === 'light')) {
      const lifted = hexToHsl(bodyInkFor(c)).l - hexToHsl(c.ink).l;
      // Within half a percentage point of the documented lift; the remainder is
      // the round trip through 8-bit RGB.
      expect(Math.abs(lifted - BODY_INK_LIFT), `${c.name} lift`).toBeLessThan(0.5);
    }
  });

  it('leaves a dark ground alone', () => {
    // On a dark ground the colourway's `ink` IS the light type colour. Lifting
    // it further would wash body copy out.
    for (const c of PRIVATE_BANKING_COLOURWAYS.filter((x) => x.ground === 'dark')) {
      expect(bodyInkFor(c)).toBe(c.ink);
    }
  });
});

describe('resolved roles', () => {
  it('puts the cover field and its type on opposite sides of the ground', () => {
    const light = findColourway('private_banking', 'pb-gold-on-obsidian')!;
    const dark = findColourway('private_banking', 'pb-obsidian-reverse')!;

    // Light: the cover is the obsidian ink, type on it is the ivory paper.
    expect(resolveColourway(light).bg).toBe(light.ink);
    expect(resolveColourway(light).text).toBe(light.paper);

    // Dark: the page is already the field, so the roles invert.
    expect(resolveColourway(dark).bg).toBe(dark.paper);
    expect(resolveColourway(dark).text).toBe(dark.ink);
  });

  it('keeps body copy legible on paper in every colourway', () => {
    for (const c of PRIVATE_BANKING_COLOURWAYS) {
      const r = resolveColourway(c);
      // WCAG AA for body text. These are printed client documents, so this is a
      // floor rather than a target.
      expect(contrastRatio(r.ink, r.surface), `${c.name} body on paper`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps type on the cover field legible in every colourway', () => {
    for (const c of PRIVATE_BANKING_COLOURWAYS) {
      const r = resolveColourway(c);
      expect(contrastRatio(r.text, r.bg), `${c.name} cover type`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks type on an accent fill by measurement, not by assumption', () => {
    for (const c of PRIVATE_BANKING_COLOURWAYS) {
      const r = resolveColourway(c);
      // The accent runs from #22406E (Navy Signet) to #D9A520 (Obsidian
      // Reverse). A fixed choice of white or black is illegible at one end.
      expect(contrastRatio(r.onPrimary, r.primary), `${c.name} on accent`).toBeGreaterThanOrEqual(3);
      expect([c.paper, c.ink]).toContain(r.onPrimary);
    }
  });

  it('separates the panel fill from the page it sits on', () => {
    for (const c of PRIVATE_BANKING_COLOURWAYS) {
      const r = resolveColourway(c);
      expect(r.panel).not.toBe(r.surface);
      // …but not so far that a table stripe reads as a filled block.
      expect(contrastRatio(r.panel, r.surface), `${c.name} panel`).toBeLessThan(1.6);
    }
  });

  it('holds the semantic colours fixed against the palette', () => {
    // Category B in the NPC design system: the colour of a loss is not a
    // branding decision, and must never follow a tenant brand or a colourway.
    const light = PRIVATE_BANKING_COLOURWAYS.filter((c) => c.ground === 'light');
    for (const c of light) {
      const r = resolveColourway(c);
      expect(r.negative).toBe(SEMANTIC_COLOURS.light.negative);
      expect(r.positive).toBe(SEMANTIC_COLOURS.light.positive);
    }
    // Dark grounds take the lifted forms — the same hues, legible on obsidian.
    for (const c of PRIVATE_BANKING_COLOURWAYS.filter((x) => x.ground === 'dark')) {
      const r = resolveColourway(c);
      expect(r.negative).toBe(SEMANTIC_COLOURS.dark.negative);
      expect(contrastRatio(r.negative, r.surface), `${c.name} negative`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('fills every role a block can address', () => {
    const roles = [
      'primary', 'bg', 'surface', 'panel', 'text', 'ink', 'muted',
      'onPrimary', 'line', 'positive', 'caution', 'negative', 'info',
    ];
    for (const c of PRIVATE_BANKING_COLOURWAYS) {
      const colors = colourwayColors(c);
      for (const role of roles) {
        expect(colors[role], `${c.name}.${role}`).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });
});

describe('applying a colourway', () => {
  const schema = {
    version: 1,
    name: 'Chancery',
    tokens: { colors: { primary: '#000000', custom: '#123456' }, fonts: { body: 'Inter' } },
    pages: [{ id: 'p1', blocks: [] }],
  };

  it('replaces the colour roles and leaves everything else alone', () => {
    const cw = findColourway('private_banking', 'pb-midnight-navy')!;
    const next = applyColourwayToSchema(schema, cw) as any;
    expect(next.tokens.colors.primary).toBe(cw.accent);
    expect(next.tokens.fonts.body).toBe('Inter');
    expect(next.pages).toEqual(schema.pages);
    expect(next.name).toBe('Chancery');
  });

  it('keeps colour keys the colourway does not define', () => {
    const cw = findColourway('private_banking', 'pb-verde')!;
    const next = applyColourwayToSchema(schema, cw) as any;
    expect(next.tokens.colors.custom).toBe('#123456');
  });

  it('never mutates the entry it was given', () => {
    // The caller's copy is the published library entry. Mutating it would let
    // one preview change what the next reader sees.
    const cw = findColourway('private_banking', 'pb-oxblood')!;
    const before = JSON.stringify(schema);
    applyColourwayToSchema(schema, cw);
    expect(JSON.stringify(schema)).toBe(before);
  });

  it('passes a non-object schema through untouched', () => {
    const cw = PRIVATE_BANKING_COLOURWAYS[0];
    expect(applyColourwayToSchema(null, cw)).toBeNull();
    expect(applyColourwayToSchema('nope', cw)).toBe('nope');
  });

  it('produces a token override the renderer can merge', () => {
    const cw = findColourway('private_banking', 'pb-platinum')!;
    const override = colourwayTokenOverride(cw);
    expect(Object.keys(override)).toEqual(['colors']);
    expect(override.colors.primary).toBe(cw.accent);
  });
});
