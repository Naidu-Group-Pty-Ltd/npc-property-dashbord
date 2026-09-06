/**
 * Phase 3 — heading resolution and the partition rule, measured against the
 * corpus rather than against opinion.
 *
 * Phase 2 built the registry and proved every declared section can be produced.
 * Phase 3 assembles documents from it, and the first question that has to be
 * answered honestly is whether the registry can recognise what production
 * actually wrote. Measured over the 1,199 stored reports: **966 distinct H2
 * headings** for a product with 38 sections.
 *
 * That ratio is the finding. The legacy generator promotes its sub-headings to
 * H2 — `Strengths`, `Weaknesses`, `Opportunities` and `Threats` under SWOT;
 * `Market Commentary:` and `Yield Commentary:` under their own sections; the
 * whole `11.1 …` / `15.1 …` / `4.2 …` family — so a partition that dropped
 * every heading it could not name would discard nearly a third of every legacy
 * document, and one that treated each as a section would fragment one SWOT into
 * four.
 *
 * Hence the rule these tests exist to hold: **an unrecognised heading is
 * content belonging to the section above it. Never a section, never a
 * deletion.**
 *
 * `fixtures/corpusHeadings.json` is the real heading inventory — every heading
 * carried by two or more reports, with its report count, scrubbed of the twelve
 * singletons that named a property address. It is a fixture rather than a live
 * query so the guard runs in CI, and it is the reason a coverage regression
 * shows up as a failing number instead of as a quietly thinner report.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isSubHeadingByNumbering,
  normaliseHeading,
  partitionByRegistry,
  sectionIdForHeading,
} from '../investment/sectionRegistry.pure';

const FIXTURE: Array<{ h: string; reports: number }> = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/corpusHeadings.json'), 'utf8'),
);

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe('a heading is stripped to what identifies it', () => {
  it('removes a leading ordinal, with or without trailing punctuation', () => {
    expect(normaliseHeading('9. Financial Analysis')).toBe('financial analysis');
    // The case the first version missed: the legacy generator numbers its
    // sub-sections `11.1 X` with no punctuation after the number, and that one
    // absent `?` in the pattern cost 3.5 points of corpus coverage.
    expect(normaliseHeading('11.1 Public Transport Network')).toBe('public transport network');
    expect(normaliseHeading('4.2 Public Transport Access')).toBe('public transport access');
    expect(normaliseHeading('12) Key Opportunities')).toBe('key opportunities');
  });

  it('removes emoji and a trailing colon, and collapses whitespace', () => {
    expect(normaliseHeading('⚖️ PROFESSIONAL DISCLAIMER')).toBe('professional disclaimer');
    expect(normaliseHeading('Market Commentary:')).toBe('market commentary');
    expect(normaliseHeading('  Risk   Dashboard ')).toBe('risk dashboard');
  });

  it('never eats a number that is part of the name', () => {
    // `10-Year …` survives because a hyphen is not whitespace.
    expect(normaliseHeading('10-Year Investment Projections')).toBe('10-year investment projections');
    expect(normaliseHeading('Top 3 Risks')).toBe('top 3 risks');
    // And a bare number followed by a space is NOT an ordinal. Making the
    // trailing punctuation merely optional would strip this, and no corpus
    // heading has the shape today — which is the moment to close it, not after
    // one arrives.
    expect(normaliseHeading('2026 Market Review')).toBe('2026 market review');
    expect(normaliseHeading('12 Month Outlook')).toBe('12 month outlook');
  });
});

// ---------------------------------------------------------------------------
// Qualified variants
// ---------------------------------------------------------------------------

describe('a known name with a qualifier is the same section', () => {
  it.each([
    ['Property Value Projections (AUD)', 'tenYear'],
    ['Cumulative Cashflow Projections (10 Years - AUD)', 'tenYear'],
    ['Rental Income Projections (Annual - AUD)', 'tenYear'],
    ['Sensitivity Analysis (interest rate, rent, vacancy)', 'sensitivity'],
    ['Cashflow Analysis - Interest-Only Scenario (Year 1)', 'loan'],
    ['Environmental Risk: High Bushfire Rating and Moderate Flood Risk', 'environmentalRisk'],
  ])('%s → %s', (heading, id) => {
    expect(sectionIdForHeading(heading)).toBe(id);
  });

  it('will not let a short name swallow a longer, different one', () => {
    // `Market Position` prefixes `Market Positioning`, so matching on a bare
    // space would make every qualified heading resolve to whichever alias
    // happened to be shortest. The separator must be a bracket, a dash or a
    // colon.
    expect(sectionIdForHeading('Market Position Relative To Nothing')).toBeNull();
    expect(sectionIdForHeading('Risk Dashboard Extended Commentary')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Corpus coverage
// ---------------------------------------------------------------------------

describe('the registry recognises what production wrote', () => {
  const resolved = FIXTURE.filter((r) => sectionIdForHeading(r.h) !== null);
  const unresolved = FIXTURE.filter((r) => sectionIdForHeading(r.h) === null);
  const instances = (rows: typeof FIXTURE) => rows.reduce((s, r) => s + r.reports, 0);

  it('resolves a majority of heading instances, and the floor only rises', () => {
    const pct = (100 * instances(resolved)) / instances(FIXTURE);
    // A floor, not a target. It went 60.7 → 64.2 (ordinal fix) → 68.2
    // (qualifiers) → here; Phase 3's assembly work should raise it further, and
    // this fails if a change ever lowers it.
    expect(pct).toBeGreaterThan(70);
  });

  it('the headings it cannot name are sub-headings and furniture, not sections', () => {
    // Every unresolved heading carried by 15+ reports, checked by eye against
    // the corpus and recorded here. If a NEW one joins them, this fails and
    // somebody looks at it — which is the point: an unrecognised section is a
    // silent hole, and an unrecognised sub-heading is fine.
    const looksStructural = (h: string) => {
      const n = normaliseHeading(h);
      return !(
        h.trimEnd().endsWith(':') ||          // `Market Commentary:`
        isSubHeadingByNumbering(h) ||          // `11.1 Public Transport Network`
        ['strengths', 'weaknesses', 'opportunities', 'threats'].includes(n) ||
        n === 'contact us'                     // marketing furniture, 761 reports
      );
    };
    const loud = unresolved.filter((r) => r.reports >= 15 && looksStructural(r.h));
    // Reported together rather than one at a time: the first failure of this
    // kind is rarely the only one, and a list is what somebody can act on.
    expect(loud.map((r) => `${r.reports}× ${r.h}`)).toEqual([]);
  });

  it('resolves every heading the current generators are declared to write', () => {
    // Anything on 100+ reports is structural rather than incidental.
    const structural = FIXTURE.filter((r) => r.reports >= 100 && normaliseHeading(r.h) !== 'contact us');
    for (const r of structural) {
      expect(sectionIdForHeading(r.h), `"${r.h}" on ${r.reports} reports resolves to nothing`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// The partition rule
// ---------------------------------------------------------------------------

describe('an unrecognised heading belongs to the section above it', () => {
  it('opens a section on a recognised heading and keeps its body', () => {
    const { sections, preamble } = partitionByRegistry(
      '# Title\n\nintro\n\n## Risk Dashboard\n\nflood risk\n\n## Final Recommendation\n\nproceed\n',
    );
    expect(preamble).toBe('# Title\n\nintro');
    expect(sections.map((s) => s.id)).toEqual(['riskDashboard', 'recommendation']);
    expect(sections[0].body).toBe('flood risk');
    expect(sections[1].body).toBe('proceed');
  });

  it('absorbs a sub-heading into the open section rather than splitting it', () => {
    // The SWOT case. Four H2s, one section — not four.
    const { sections, absorbed } = partitionByRegistry(
      '## SWOT Analysis\n\n## Strengths\n\na\n\n## Weaknesses\n\nb\n\n## Threats\n\nc\n',
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('swot');
    // Every word survives, headings included.
    expect(sections[0].body).toContain('## Strengths');
    expect(sections[0].body).toContain('## Weaknesses');
    expect(sections[0].body).toContain('## Threats');
    expect(sections[0].body).toContain('c');
    expect(absorbed.map((a) => a.heading)).toEqual(['Strengths', 'Weaknesses', 'Threats']);
    expect(absorbed.every((a) => a.into === 'swot')).toBe(true);
  });

  it('reports what it absorbed, so a new heading is visible rather than swallowed', () => {
    const { absorbed } = partitionByRegistry('## Risk Dashboard\n\n## Something Nobody Declared\n\nx\n');
    expect(absorbed).toEqual([{ heading: 'Something Nobody Declared', into: 'riskDashboard' }]);
  });

  it('keeps furniture before the first section out of it', () => {
    // `📞 CONTACT US` is on 761 reports and is not a section. Attributing it to
    // whatever follows would put marketing inside a client's verdict.
    const { preamble, sections, absorbed } = partitionByRegistry(
      '## 📞 CONTACT US\n\ncall us\n\n## Executive Verdict\n\nproceed\n',
    );
    expect(preamble).toContain('call us');
    expect(sections.map((s) => s.id)).toEqual(['verdict']);
    expect(sections[0].body).toBe('proceed');
    expect(absorbed[0]).toEqual({ heading: '📞 CONTACT US', into: null });
  });

  it('loses nothing — every line of the input survives somewhere', () => {
    const doc = [
      '# Investment Report', '', 'preamble line', '',
      '## 📞 CONTACT US', '', 'furniture', '',
      '## Location Overview', '', 'the location', '',
      '## 11.1 Public Transport Network', '', 'trains', '',
      '## SWOT Analysis', '', '## Strengths', '', 'good bones', '',
    ].join('\n');
    const { preamble, sections, absorbed } = partitionByRegistry(doc);
    const rejoined = [preamble, ...sections.map((s) => `## ${s.heading}\n${s.body}`)].join('\n');
    for (const line of ['preamble line', 'furniture', 'the location', 'trains', 'good bones']) {
      expect(rejoined, `lost: ${line}`).toContain(line);
    }
    expect(sections.map((s) => s.id)).toEqual(['locationCase', 'swot']);
    expect(absorbed.map((a) => a.heading)).toEqual(['📞 CONTACT US', '11.1 Public Transport Network', 'Strengths']);
  });

  it('keeps a repeated section id in order rather than collapsing it', () => {
    // Production briefing 89b451f6 spreads one section across several headings:
    // 29 headings resolve to 21 distinct sections, with `marketPosition` four
    // times and `tenYear` three. Folding them here would merge bodies that were
    // written apart and silently reorder a client's document.
    const { sections } = partitionByRegistry(
      '## Historical Price Growth Table\n\na\n\n## Market Activity\n\nb\n\n## Risk Dashboard\n\nc\n\n## Comparable Market Evidence\n\nd\n',
    );
    expect(sections.map((s) => s.id)).toEqual([
      'marketPosition', 'marketPosition', 'riskDashboard', 'marketPosition',
    ]);
    expect(sections.map((s) => s.body)).toEqual(['a', 'b', 'c', 'd']);
    // Each keeps the heading the document actually used, which is what lets a
    // later step fold them without inventing a title.
    expect(sections[0].heading).toBe('Historical Price Growth Table');
    expect(sections[3].heading).toBe('Comparable Market Evidence');
  });

  it('handles a document with no recognised heading at all', () => {
    const { preamble, sections } = partitionByRegistry('# Title\n\njust prose\n');
    expect(sections).toEqual([]);
    expect(preamble).toBe('# Title\n\njust prose');
  });

  it('handles an empty document', () => {
    expect(partitionByRegistry('')).toEqual({ preamble: '', sections: [], absorbed: [] });
  });
});
