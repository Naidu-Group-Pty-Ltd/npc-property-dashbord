/**
 * R1 — de-tracking letter-spaced source text.
 *
 * The primary fixture is the exact string a production import stored, verbatim
 * from the template row — including the LOST word boundary between PROPERTY and
 * CONSULTING, which only span evidence can recover.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveTrackingPt,
  detrackText,
  looksTracked,
} from '@/lib/reportTemplate/pdfImport/detrackText.pure';

// Verbatim from report_templates 91fd530c…, page 1, overlay 1.
const PRODUCTION = 'N A I D U   P R O P E R T Y C O N S U L T I N G   S E R V I C E S';

describe('looksTracked', () => {
  it('recognises the production artifact', () => {
    expect(looksTracked(PRODUCTION)).toBe(true);
    expect(looksTracked('P R E P A R E D   F O R')).toBe(true);
    expect(looksTracked('R E F   9 0 E 5 D F 3 4')).toBe(true);
  });

  it('leaves ordinary text alone', () => {
    expect(looksTracked('BORROWING CAPACITY SNAPSHOT')).toBe(false);
    expect(looksTracked('Masline Nyawo')).toBe(false);
    expect(looksTracked('18 April 2026')).toBe(false);
    // Initials do not make a name tracked — the long tokens dominate.
    expect(looksTracked('J R R Tolkien')).toBe(false);
    expect(looksTracked('9.44%')).toBe(false);
    expect(looksTracked('')).toBe(false);
  });
});

describe('detrackText — span partition (the only recoverer of lost boundaries)', () => {
  it('recovers the production heading, including the LOST boundary', () => {
    // The PDF drew four word-spans: their char counts are the word structure.
    const r = detrackText(PRODUCTION, [5, 8, 10, 8]);
    expect(r.text).toBe('NAIDU PROPERTY CONSULTING SERVICES');
    expect(r.method).toBe('span-partition');
    expect(r.changed).toBe(true);
  });

  it('refuses a partition that does not account for the letters exactly', () => {
    // 30 ≠ 31 letters: these spans describe something else. Trusting them
    // would invent boundaries; fall to the string's own gaps instead.
    const r = detrackText(PRODUCTION, [5, 8, 10, 7]);
    expect(r.method).toBe('multi-space');
  });

  it('ignores degenerate span lists', () => {
    for (const spans of [[31], [], [5, 8, 10, 8.5], [5, 8, 10, 0, 8]]) {
      const r = detrackText(PRODUCTION, spans as number[]);
      expect(r.method).toBe('multi-space');
    }
  });
});

describe('detrackText — multi-space fallback', () => {
  it('collapses letters and keeps word gaps that survived', () => {
    const r = detrackText('P R E P A R E D   F O R');
    expect(r.text).toBe('PREPARED FOR');
    expect(r.method).toBe('multi-space');
  });

  it('handles the mixed alphanumeric reference line', () => {
    expect(detrackText('R E F   9 0 E 5 D F 3 4').text).toBe('REF 90E5DF34');
  });

  it('cannot recover a lost boundary — and does not pretend to', () => {
    // Without span evidence, PROPERTY–CONSULTING stays merged. Honest: the
    // string alone does not contain that boundary.
    const r = detrackText(PRODUCTION);
    expect(r.text).toBe('NAIDU PROPERTYCONSULTING SERVICES');
    expect(r.method).toBe('multi-space');
  });

  it('leaves untracked text byte-identical', () => {
    for (const s of ['BORROWING CAPACITY SNAPSHOT', 'Masline Nyawo', '  ', 'A B']) {
      const r = detrackText(s);
      expect(r.changed).toBe(false);
      expect(r.text).toBe(s);
    }
  });

  it('is deterministic and never throws on hostile input', () => {
    expect(detrackText(PRODUCTION, [5, 8, 10, 8])).toEqual(detrackText(PRODUCTION, [5, 8, 10, 8]));
    for (const bad of [null, undefined, 42, {}]) {
      expect(() => detrackText(bad as never)).not.toThrow();
    }
  });
});

describe('deriveTrackingPt', () => {
  const measure = (text: string, _f: string, size: number) => [...text].length * size * 0.55;

  it('derives spacing from measured minus natural width', () => {
    // 34 glyphs at 12pt, natural 224.4pt, measured 386.3pt (the stored bbox).
    const pt = deriveTrackingPt('NAIDU PROPERTY CONSULTING SERVICES', 386.3, 12, 'Cinzel', measure);
    expect(pt).toBeCloseTo((386.3 - 224.4) / 33, 1);
  });

  it('falls back to the glyph-advance estimate without a measurer', () => {
    const pt = deriveTrackingPt('PREPARED FOR', 76, 8, 'Helvetica', null);
    // natural ≈ 12 × 8 × 0.5 = 48 → (76-48)/11 ≈ 2.5
    expect(pt).toBeCloseTo(2.55, 1);
  });

  it('returns null rather than negative spacing', () => {
    // Measured narrower than natural: this text was not tracked after all.
    expect(deriveTrackingPt('WIDE TEXT', 10, 12, 'Helvetica', measure)).toBeNull();
  });

  it('clamps absurd derivations instead of trusting them', () => {
    const pt = deriveTrackingPt('AB', 10000, 10, 'Helvetica', measure);
    expect(pt).toBeLessThanOrEqual(15);
  });

  it('returns null on unusable inputs', () => {
    expect(deriveTrackingPt('A', 100, 12, 'H', measure)).toBeNull();
    expect(deriveTrackingPt('ABC', 0, 12, 'H', measure)).toBeNull();
    expect(deriveTrackingPt('ABC', Number.NaN, 12, 'H', measure)).toBeNull();
    expect(deriveTrackingPt('ABC', 100, 0, 'H', measure)).toBeNull();
  });

  it('survives a measurer that throws', () => {
    const throwing = () => { throw new Error('no canvas'); };
    expect(() => deriveTrackingPt('ABC DEF', 100, 12, 'H', throwing)).not.toThrow();
  });
});
