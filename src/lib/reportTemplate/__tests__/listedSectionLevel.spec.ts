/**
 * Which heading level a contents list names.
 *
 * Found 18 September 2026 by reading a produced document: a Financial Analysis
 * whose narrative wraps everything in one `h1` listed its entire nineteen-page
 * body as ONE contents row, because the shallowest heading level held exactly
 * one section — the document's own title.
 */
import { describe, expect, it } from 'vitest';

import { listedSectionLevel, type NarrativeIndexSection } from '../narrativeIndex';

const s = (level: number, label = `s${level}`): NarrativeIndexSection =>
  ({ label, level, pageIndex: 0, anchor: label });

describe('listedSectionLevel', () => {
  it('descends past a level holding a single section — that is a title, not a tier', () => {
    // The measured shape: one h1 over six h2 sections and fourteen h3s.
    const sections = [s(1, 'Client Investment Feasibility & Financial Performance Report'),
      ...Array.from({ length: 6 }, (_, i) => s(2, `h2-${i}`)),
      ...Array.from({ length: 14 }, (_, i) => s(3, `h3-${i}`))];
    expect(listedSectionLevel(sections)).toBe(2);
  });

  it('leaves the Compass shape exactly as it was — 18 h2 over 26 h3', () => {
    const sections = [...Array.from({ length: 18 }, (_, i) => s(2, `h2-${i}`)),
      ...Array.from({ length: 26 }, (_, i) => s(3, `h3-${i}`))];
    expect(listedSectionLevel(sections)).toBe(2);
  });

  it('descends more than one level where each shallower level is a lone title', () => {
    const sections = [s(1, 'title'), s(2, 'part'), s(3, 'a'), s(3, 'b'), s(3, 'c')];
    expect(listedSectionLevel(sections)).toBe(3);
  });

  it('stands at the top where NO level has more than one — one section is one section', () => {
    expect(listedSectionLevel([s(2, 'only')])).toBe(2);
    expect(listedSectionLevel([s(1, 'title'), s(2, 'only')])).toBe(1);
  });

  it('answers 0 for an empty index, so a caller need not branch', () => {
    expect(listedSectionLevel([])).toBe(0);
  });

  it('reads levels by count, not by document order', () => {
    // Deeper headings appearing first must not change which level is listed.
    const sections = [s(3, 'a'), s(3, 'b'), s(1, 'title'), s(3, 'c')];
    expect(listedSectionLevel(sections)).toBe(3);
  });
});
