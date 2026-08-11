import { describe, expect, it } from 'vitest';
import {
  citationHost,
  dedupeSortTimeline,
  explodeCitationClusters,
  normaliseAnswerMarkdown,
  supplementTimeline,
} from '../marketQaAnswerFormat.pure';

describe('normaliseAnswerMarkdown', () => {
  it('unglues a known section heading from the paragraphs on both sides', () => {
    // The exact defect from production: heading fused mid-line, prose
    // continuing on the same line after the title.
    const raw = 'affecting homeowner equity [[8]]. ## Risks and caveats The primary risk is the wealth effect.';
    const fixed = normaliseAnswerMarkdown(raw);
    expect(fixed).toContain('affecting homeowner equity [[8]].\n\n## Risks and caveats\n\nThe primary risk');
  });

  it('leaves well-formed headings semantically unchanged', () => {
    const clean = 'Opening paragraph.\n\n## What happened\n\nThe RBA held the cash rate.';
    expect(normaliseAnswerMarkdown(clean)).toBe(clean);
  });

  it('normalises heading case and trailing punctuation to the prescribed title', () => {
    const fixed = normaliseAnswerMarkdown('Text before. ## risks and caveats: more text.');
    expect(fixed).toContain('## Risks and caveats');
    expect(fixed).not.toContain('caveats:');
  });

  it('breaks the line before an unknown heading rather than leaving it inline', () => {
    const fixed = normaliseAnswerMarkdown('Some prose. ## Unusual heading');
    expect(fixed).toContain('Some prose.\n\n## Unusual heading');
  });

  it('collapses runaway blank lines', () => {
    expect(normaliseAnswerMarkdown('a\n\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('explodeCitationClusters', () => {
  it('splits the bracketed-pair form the model emits', () => {
    expect(explodeCitationClusters('values are falling [[8], [11]].')).toBe('values are falling [[8]] [[11]].');
  });

  it('splits the comma form', () => {
    expect(explodeCitationClusters('policy changes [[9, 10]] continue')).toBe('policy changes [[9]] [[10]] continue');
  });

  it('leaves single markers and uuid markers untouched', () => {
    expect(explodeCitationClusters('a claim [[2]] and [[3f1c-9]]')).toBe('a claim [[2]] and [[3f1c-9]]');
  });

  it('is idempotent', () => {
    const once = explodeCitationClusters('x [[1], [2]] y');
    expect(explodeCitationClusters(once)).toBe(once);
  });
});

describe('timeline determinism', () => {
  const docs = [
    { id: 'a', title: 'RBA holds cash rate at 4.35%', source_name: 'RBA', source_published_at: '2026-08-11T04:00:00Z' },
    { id: 'b', title: 'National rents reach record highs', source_name: 'Cotality', source_published_at: '2026-06-30T00:00:00Z' },
    { id: 'c', title: 'Tax reform consultation opens', source_name: 'Treasury', source_published_at: '2026-08-04T00:00:00Z' },
  ];

  it('guarantees one entry per used dated source when the model under-extracts', () => {
    // The production symptom: model returned a single entry despite three used sources.
    const merged = supplementTimeline(
      [{ date: '2026-08-11', event: 'RBA holds the cash rate.', source_id: 'a' }],
      docs,
      ['a', 'b', 'c'],
    );
    expect(merged).toHaveLength(3);
    expect(merged.map(e => e.date)).toEqual(['2026-06-30', '2026-08-04', '2026-08-11']);
  });

  it('keeps the model wording when a source is already represented', () => {
    const merged = supplementTimeline(
      [{ date: '2026-08-11', event: 'RBA holds at 4.35% with a hawkish bias.', source_id: 'a' }],
      docs,
      ['a'],
    );
    expect(merged).toEqual([{ date: '2026-08-11', event: 'RBA holds at 4.35% with a hawkish bias.', source_id: 'a' }]);
  });

  it('does not duplicate a date the model already narrated', () => {
    const merged = supplementTimeline(
      [{ date: '2026-08-11', event: 'Rate held; scheme announced the same day.' }],
      docs,
      ['a'],
    );
    expect(merged.filter(e => e.date === '2026-08-11')).toHaveLength(1);
  });

  it('ignores unused sources', () => {
    const merged = supplementTimeline([], docs, ['b']);
    expect(merged).toEqual([{ date: '2026-06-30', event: 'National rents reach record highs (Cotality)', source_id: 'b' }]);
  });

  it('sorts oldest first and drops exact duplicates', () => {
    const sorted = dedupeSortTimeline([
      { date: '2026-08-11', event: 'Later event' },
      { date: '2026-01-01', event: 'Earlier event' },
      { date: '2026-08-11', event: 'later event' },
    ]);
    expect(sorted.map(e => e.event)).toEqual(['Earlier event', 'Later event']);
  });
});

describe('citationHost', () => {
  it('labels a citation by its host without www', () => {
    expect(citationHost('https://www.abc.net.au/news/2026-08-11/article')).toBe('abc.net.au');
  });
  it('returns null for an unparseable url', () => {
    expect(citationHost('not a url')).toBeNull();
  });
});
