import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * The chart-evidence contract, pinned against the record it was measured on.
 *
 * Every fixture here is verbatim from the Investment Compass for 48 Redfern
 * Street, Cowra (report 09f8569e), whose record holds `demographics_data:
 * NULL`, `location_intelligence: NULL`, `data_sources.marketData: null`, no
 * planning source at all, an `investment_score` that issued no grade, and a
 * `market_fact_snapshot` recording population as absent with the ruling "not
 * client safe" — while page 11 charts it.
 */
import { describe, expect, it } from 'vitest';
import {
  assessChartEvidence,
  claimOf,
  enforceChartEvidence,
  claimSupportRules,
  readEvidenceInventory,
  type EvidenceInventory,
} from '../investment/chartEvidence.pure';
import { parseVizDirectives } from '../vizDirectives.pure';
import { presentStoredMarkdown } from '../investment/derivedHygiene.pure';

const COWRA_RECORD = {
  investment_score: { grade: 'N/A', totalScore: null, policy: { gradeIssued: false }, breakdown: {} },
  data_sources: {
    demographics: null,
    marketData: null,
    seifa: null,
    economics: { source: 'rba', confidence: 0.9 },
    crimeStatistics: { source: 'state_crime_data', confidence: 0.8 },
  },
  market_fact_snapshot: {
    facts: [
      { name: 'market.demographics', status: 'absent' },
      { name: 'market.cashRateTargetCurrent', status: 'present', value: 4.35 },
    ],
  },
};

const HELD: EvidenceInventory = {
  recordedScores: [72, 82],
  demographics: true,
  marketData: true,
  location: true,
  withheldFacts: [],
};

describe('what the record says it holds', () => {
  it('reads the inventory off the row, and a null producer is "did not answer"', () => {
    const inv = readEvidenceInventory(COWRA_RECORD);
    expect(inv.demographics).toBe(false);
    expect(inv.marketData).toBe(false);
    expect(inv.recordedScores).toEqual([]);
    expect(inv.withheldFacts).toContain('market.demographics');
  });

  it('a present producer is a producer that answered', () => {
    const inv = readEvidenceInventory({ data_sources: { demographics: { source: 'abs', confidence: 1 } } });
    expect(inv.demographics).toBe(true);
  });

  it('an absent row is an empty inventory, never an assumed one', () => {
    const inv = readEvidenceInventory(null);
    expect(inv.demographics).toBe(false);
    expect(inv.recordedScores).toEqual([]);
    expect(inv.withheldFacts).toEqual([]);
  });
});

describe('what a visual is claiming', () => {
  const claim = (src: string) => claimOf(parseVizDirectives(src)[0]);

  it('a gauge and a wheel are ratings by construction', () => {
    expect(claim('{{gauge: 72 | Location fit}}')).toBe('rating');
    expect(claim('{{wheel: 70,65,55 | labels=A,B,C | max=100}}')).toBe('rating');
  });

  it('bars out of a hundred with no unit are a minted scorecard', () => {
    expect(claim('{{bars: Planning 90, Building 80 | max=100}}')).toBe('rating');
  });

  it('bars in per cent are a composition', () => {
    expect(claim('{{bars: Detached 80, Units 10 | max=100 | unit=%}}')).toBe('share');
  });

  it('bars in kilometres are a measurement, and stay one', () => {
    expect(claim('{{bars: CBD 1.6 km, School 0.7 km | max=3 | unit=km}}')).toBe('measurement');
  });

  it('a glance, a tile strip and a timeline claim nothing quantitative', () => {
    expect(claim('{{glance: ✓ One | ◆ Two}}')).toBe('qualitative');
    expect(claim('{{tiles: A "x" int=0.8, B "y" int=0.5}}')).toBe('qualitative');
    expect(claim('{{timeline: Existing "Now", 0-2y "Soon"}}')).toBe('qualitative');
  });
});

describe('a share of a population the record does not hold', () => {
  const OCCUPIER_MIX =
    '{{donut: Family renters 45, Local owner-occupiers 35, Professionals & small households 20 '
    + '| title=Likely occupier mix | center=45% | centerSub=Family renters}}';

  it('is withheld — three axes, no denominator, no period, no census table', () => {
    const [f] = assessChartEvidence(OCCUPIER_MIX, readEvidenceInventory(COWRA_RECORD));
    expect(f.verdict).toBe('population_not_held');
    expect(f.reason).toContain('no demographics producer answered');
  });

  it('is drawn where a demographics producer DID answer', () => {
    expect(assessChartEvidence(OCCUPIER_MIX, HELD)).toEqual([]);
  });

  it('a share of the report\'s OWN evidence is not a population and is left alone', () => {
    // "Evidence mix: Official statistics 40, Major property portals 35, Local
    // intelligence 25" describes where this report's material came from. It
    // has its own defects — see the register — but it is not a census claim,
    // and a rule that fired on it would fire on every cost breakdown too.
    const evidenceMix =
      '{{donut: Official statistics 40, Major property portals 35, Local intelligence 25 | title=Evidence mix}}';
    expect(assessChartEvidence(evidenceMix, readEvidenceInventory(COWRA_RECORD))).toEqual([]);
  });

  it('a pictograph of a transaction share is the same claim in icons', () => {
    const [f] = assessChartEvidence(
      '{{pictograph: 7/10 | label=Approximate share of core family houses in Cowra transactions '
      + '| sub=Around seven in ten sales are traditional family houses | icon=house | cols=10}}',
      readEvidenceInventory(COWRA_RECORD),
    );
    expect(f.verdict).toBe('population_not_held');
  });
});

describe('a series the client-safe gate already refused', () => {
  it('is withheld, and the finding names the gate\'s own ruling', () => {
    const [f] = assessChartEvidence(
      '{{margin: Cowra Shire ERP trend, 2015–2024 | spark=12759,12720,12690,12659,12680,12721 '
      + '| note=Broadly stable. | label=Population stability}}',
      readEvidenceInventory(COWRA_RECORD),
    );
    expect(f.verdict).toBe('series_withheld');
    expect(f.reason).toContain('market.demographics');
  });

  it('a series of something the gate did not refuse is left alone', () => {
    expect(assessChartEvidence(
      '{{margin: Cash rate | spark=4.1,4.35,4.35 | label=Rate path}}',
      readEvidenceInventory(COWRA_RECORD),
    )).toEqual([]);
  });
});

describe('a rating the engine did not record', () => {
  it('is judged by the rule that already exists, so the two cannot drift', () => {
    const found = assessChartEvidence(
      '{{gauge: 72 | Location–property alignment}}\n{{wheel: 70,65,55 | labels=A,B,C | max=100}}',
      readEvidenceInventory(COWRA_RECORD),
    );
    expect(found.every((f) => f.verdict === 'unrecorded_rating')).toBe(true);
    expect(found).toHaveLength(2);
  });

  it('says what the engine DID record, or that it issued no grade at all', () => {
    const [none] = assessChartEvidence('{{gauge: 72 | Fit}}', readEvidenceInventory(COWRA_RECORD));
    expect(none.reason).toContain('issued no grade at all');
    const [some] = assessChartEvidence('{{gauge: 61 | Fit}}', HELD);
    expect(some.reason).toContain('72, 82');
  });

  it('a rating the engine DID record is drawn', () => {
    expect(assessChartEvidence('{{gauge: 72 | Fit}}', HELD)).toEqual([]);
  });
});

describe('enforcement removes the unsupported visual and records it', () => {
  const OCCUPIER =
    '{{donut: Family renters 45, Local owner-occupiers 35, Professionals & small households 20 | title=Mix}}';

  it('does not tabulate an unsupported share — a table of it is the same claim', () => {
    // A supported dataset a chart cannot render falls back to a table, and
    // `vizFigures` still does that on the parser's `refused` list. An
    // UNSUPPORTED dataset may not: the reader would receive three percentages
    // of a population nobody measured, wearing the authority of a table.
    const { markdown, findings } = enforceChartEvidence(OCCUPIER, readEvidenceInventory(COWRA_RECORD));
    expect(markdown.trim()).toBe('');
    expect(parseVizDirectives(markdown)).toEqual([]);
    expect(markdown).not.toContain('Family renters 45');
    // Nothing is lost to the operator: the directive and its reason are the
    // audit record §2 requires the material to be retained in.
    expect(findings).toHaveLength(1);
    expect(findings[0].directive).toContain('Family renters 45');
    expect(findings[0].verdict).toBe('population_not_held');
  });

  it('removes a rating too, because a gauge\'s data IS its verdict', () => {
    const { markdown } = enforceChartEvidence('{{gauge: 72 | Fit}}\n\nProse stays.',
      readEvidenceInventory(COWRA_RECORD));
    expect(markdown).not.toContain('{{gauge');
    expect(markdown).toContain('Prose stays.');
  });

  it('never touches the prose, the headings or a qualitative visual', () => {
    const doc = [
      '## Target Occupier & Tenant Profile',
      '',
      'The locality-fit insight is that 48 Redfern Street sits within Cowra’s core residential belt.',
      '',
      OCCUPIER,
      '',
      '{{glance: ✓ Established street | ◆ Regional hub}}',
      '',
      '- **Proximity to Cowra town centre:** Approximately 1.6 km from the CBD',
    ].join('\n');
    const { markdown } = enforceChartEvidence(doc, readEvidenceInventory(COWRA_RECORD));
    for (const line of doc.split('\n')) {
      if (!line.trim() || line.startsWith('{{donut')) continue;
      expect(markdown).toContain(line);
    }
  });

  it('is a no-op on a record that holds its evidence', () => {
    const doc = `${OCCUPIER}\n\n{{gauge: 72 | Fit}}`;
    expect(enforceChartEvidence(doc, HELD)).toEqual({ markdown: doc, findings: [] });
  });
});

describe('the read path adopts it without changing anything else', () => {
  const DOC = [
    '## Section',
    '',
    'Prose that must survive.',
    '',
    '{{gauge: 72 | Fit}}',
    '',
    '{{bars: CBD 1.6 km, School 0.7 km | max=3 | unit=km}}',
  ].join('\n');

  it('omitting the inventory is byte-identical to the behaviour before the contract', () => {
    expect(presentStoredMarkdown(DOC)).toBe(presentStoredMarkdown(DOC, null));
  });

  it('a measurement in kilometres is never withheld — the record is not what is wrong with it', () => {
    const out = presentStoredMarkdown(DOC, readEvidenceInventory(COWRA_RECORD));
    expect(out).toContain('{{bars: CBD 1.6 km');
    expect(out).not.toContain('{{gauge');
    expect(out).toContain('Prose that must survive.');
  });
});

describe('the prose half of the same contract', () => {
  const HELD_NOTHING = readEvidenceInventory(COWRA_RECORD);

  it('forbids a share of a population where none was retrieved', () => {
    // The removed occupier donut had a prose twin — "roughly 45% of tenants
    // are families". Removing the drawing and leaving the sentence moves an
    // unsupported figure rather than withdrawing it.
    const rules = claimSupportRules(HELD_NOTHING);
    expect(rules).toMatch(/NO population or household composition was retrieved/);
    expect(rules).toMatch(/not as "roughly", not as "around half", not as "predominantly"/);
    // §3's rule, restated where the sentence is written.
    expect(rules).toMatch(/not the predicted tenant mix\s+of this particular property/);
  });

  it('forbids a proportion of transactions, which is the "7 in 10" claim', () => {
    const rules = claimSupportRules(HELD_NOTHING);
    expect(rules).toMatch(/not as "7 in 10", not as "the majority", not as "most"/);
    expect(rules).toMatch(/no denominator in this record/i);
  });

  it('forbids a rating in WORDS, not only in figures', () => {
    const rules = claimSupportRules(HELD_NOTHING);
    expect(rules).toMatch(/in figures OR in words/);
    for (const phrase of ['Rates strongly', 'scores\nwell', 'upper tier', 'above-average']) {
      expect(rules.replace(/\s+/g, ' ')).toContain(phrase.replace(/\s+/g, ' '));
    }
  });

  it('names the three qualitative claims the standard names', () => {
    const rules = claimSupportRules(HELD_NOTHING).replace(/\s+/g, ' ');
    for (const word of ['Renovated', 'strong demand', 'low risk', 'verified']) {
      expect(rules).toContain(word);
    }
    // And says why they need support: no digit is not no claim.
    expect(rules).toContain('happen to carry no digit');
  });

  it('a provider answering is not that provider supplying the figure', () => {
    const rules = claimSupportRules(HELD_NOTHING).replace(/\s+/g, ' ');
    expect(rules).toContain('it does not mean its answer contains the number beside your citation');
    expect(rules).toContain('do not cite a document nobody read');
  });

  it('where evidence IS held the rule permits the claim, with its basis', () => {
    // A prohibition with no permitted form is one a model routes around —
    // the lesson the Compass document contract already paid for.
    const held = { ...HELD_NOTHING, demographics: true, marketData: true, recordedScores: [72, 61] };
    const rules = claimSupportRules(held);
    expect(rules).toMatch(/may be stated only with the dataset, the period and the geography/);
    expect(rules).toMatch(/The scoring engine recorded 72, 61/);
  });

  it('a withheld fact may not be re-stated in prose in any form', () => {
    const withheld = { ...HELD_NOTHING, withheldFacts: ['Suburb median price'] };
    const rules = claimSupportRules(withheld);
    expect(rules).toContain('Suburb median price');
    expect(rules).toMatch(/including a\s+characterisation or a range/);
  });

  it('never asks for a placeholder or an apology in the replacement sentence', () => {
    const rules = claimSupportRules(HELD_NOTHING);
    expect(rules).toMatch(/never says "data was unavailable", never apologises/);
    expect(rules).toMatch(/an\s+absence is omitted or explained, not worded/);
  });
});

describe('the generator writes under it', () => {
  it('pins the prose rules from the same inventory shape the charts are judged on', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/generate-investment-report/index.ts'),
      'utf8',
    );
    const pin = src.indexOf('const pinnedPlanningContext = [');
    const end = src.indexOf("].join('\\n\\n');", pin);
    const block = src.slice(pin, end);
    expect(block).toContain('claimSupportRules({');
    // The five fields `readEvidenceInventory` produces — so the page and the
    // sentence beside it cannot disagree about what the record holds.
    for (const key of ['recordedScores', 'demographics', 'marketData', 'location', 'withheldFacts']) {
      expect(block).toContain(`${key}:`);
    }
  });
});
