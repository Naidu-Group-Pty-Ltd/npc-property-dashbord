import { describe, expect, it } from 'vitest';
import { PDF_FLATTEN_LIMITS, validateFlattenPage } from './flattenPdf';

describe('PDF flattening resource limits', () => {
  it('accepts ordinary rendered page dimensions', () => {
    expect(validateFlattenPage(1275, 1650, 0)).toBe(2_103_750);
  });

  it('rejects an excessive canvas dimension', () => {
    expect(() => validateFlattenPage(PDF_FLATTEN_LIMITS.maxCanvasDimension + 1, 100, 0))
      .toThrow(/page dimensions exceed/);
  });

  it('rejects excessive per-page pixel area', () => {
    expect(() => validateFlattenPage(10_000, 10_000, 0))
      .toThrow(/page pixel area/);
  });

  it('rejects excessive cumulative rendered pixels', () => {
    expect(() => validateFlattenPage(1_000, 1_000, PDF_FLATTEN_LIMITS.maxTotalPixels))
      .toThrow(/total rendered pixel area/);
  });

  it('rejects non-finite page dimensions', () => {
    expect(() => validateFlattenPage(Number.POSITIVE_INFINITY, 100, 0))
      .toThrow(/invalid page dimensions/);
  });
});
