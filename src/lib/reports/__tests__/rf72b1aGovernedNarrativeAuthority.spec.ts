/**
 * RF-7.2B.1A — GOVERNED NARRATIVE AUTHORITY.
 *
 * The prose fixtures below are VERBATIM from two reports this pipeline
 * generated in production on 2026-09-11, both of which recorded
 * `market.demographics` as `absent` in `market_fact_snapshot` and then stated
 * demographic figures anyway:
 *
 *   09f8569e-21ca-48b9-a3b9-57f4793d0836   48 Redfern Street, Cowra NSW 2794
 *   3fbbcfe6-eaad-490c-a10d-cfaa757820f5   28 Bligh Street, Muswellbrook NSW 2333
 *
 * They are kept as regression evidence rather than paraphrased, because the
 * detector has to survive the sentences that actually occurred — footnote
 * markers, en-dashed ranges, `{{…}}` visual directives and all. Muswellbrook's
 * claimed figures disagree with the record the platform holds for POA 2333
 * (population 13,795, median age 36, median household income $1,640/wk), which
 * is what makes the false attribution the serious half of the defect.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  auditGovernedNarrativeAuthority,
  governedAuthorityBlocks,
  governedCategoryDirective,
  governedCategoryStanding,
  governedFaultToFlag,
} from '../contract/governedNarrativeAuthority.pure';
import type { SnapshotFact } from '../contract/safeGenerationInputs.pure';

const absentFact = (name: string): SnapshotFact => ({
  name,
  status: 'absent',
  value: null,
  source: 'withheld',
  dataset: null,
  grain: null,
  geographyId: null,
  referencePeriod: null,
  asOf: null,
  ruling: 'Withheld: no trusted geography for this property.',
});

const presentFact = (name: string, value: number): SnapshotFact => ({
  name,
  status: 'present',
  value,
  source: 'abs_census_poa',
  dataset: 'ABS Census 2021 GCP DataPack (POA)',
  grain: 'postcode',
  geographyId: '2333',
  referencePeriod: '2021',
  asOf: '2026-09-06',
  ruling: 'Observed and owned; published as stated.',
});

/** The shape the two production reports actually carried. */
const WITHHELD = { facts: [absentFact('market.demographics')] };

/** A healthy report: demographics resolved against the subject postal area. */
const ADMISSIBLE = {
  facts: [
    presentFact('market.population', 13795),
    presentFact('market.medianAge', 36),
    presentFact('market.medianHouseholdIncomeWeekly', 1640),
  ],
};

// --- production prose, verbatim ------------------------------------------

const COWRA_POPULATION =
  'ABS regional population spreadsheets for 2023–24 show the Cowra SA2 at around '
  + '9,150–9,138 residents, a very small movement over the year, while the Cowra Shire '
  + 'ERP series reported roughly 12,659 residents in 2023 rising to around 12,680–12,721 '
  + 'by 2024–25.';

const COWRA_SPARKLINE =
  '{{margin: Cowra Shire ERP trend, 2015–2024 | spark=12759,12720,12690,12659,12680,12721 '
  + '| label=Population stability}}';

const COWRA_QUALITATIVE =
  'Cowra functions as a regional centre with schools, health services, retail and light '
  + 'industrial employment, so tenants are typically local workers, families and retirees '
  + 'rather than transient short-stay populations.';

const MUSWELLBROOK_CENSUS =
  'According to the Australian Bureau of Statistics 2021 Census, Muswellbrook township '
  + 'recorded 12,272 residents, with a median age of 35 and an average household size of '
  + '2.5 people, indicating a mix of young families, couples and single-person households.';

const MUSWELLBROOK_INCOME =
  'The Muswellbrook LGA records a median personal income of around $55,000–$56,000 per '
  + 'year and a median weekly household income of approximately $1,603, according to ABS '
  + '2021 Census data and NEMA\'s LGA profile.';

const MUSWELLBROOK_LABOUR =
  'The Muswellbrook Local Government Area has a labour force of around 7,700–8,000 people, '
  + 'with approximately 7,300–8,500 residents employed across full-time and part-time roles, '
  + 'according to 2021 Census data.';

const MUSWELLBROOK_QUALITATIVE =
  'The land size allows for yard space, off-street parking and privacy—features that remain '
  + 'central to demand in Muswellbrook\'s regional setting, where households often value '
  + 'space and practicality over compact urban living.';

describe('RF-7.2B.1A — category standing', () => {
  it('reads a withheld demographics umbrella as withheld', () => {
    expect(governedCategoryStanding(WITHHELD).demographics).toBe('withheld');
  });

  it('reads a category with no fact at all as withheld, never admissible', () => {
    const standing = governedCategoryStanding({ facts: [] });
    expect(standing.demographics).toBe('withheld');
    expect(standing.seifa).toBe('withheld');
    expect(standing.employment).toBe('withheld');
  });

  it('reads a present fact as admissible', () => {
    expect(governedCategoryStanding(ADMISSIBLE).demographics).toBe('admissible');
  });
});

describe('RF-7.2B.1A — pre-generation directive', () => {
  it('names the category and the specific substitutions it forbids', () => {
    const directive = governedCategoryDirective(WITHHELD);
    expect(directive).toContain('NOT AVAILABLE');
    expect(directive).toContain('resident demographics');
    expect(directive).toMatch(/median age/i);
    // Not a generic "do not invent data" — the banned routes are named.
    expect(directive).toMatch(/web search/i);
    expect(directive).toMatch(/SA2/);
    expect(directive).toMatch(/\bLGA\b/);
    expect(directive).toMatch(/ERP/);
    expect(directive).toMatch(/Census/);
  });

  it('keeps qualitative discussion explicitly permitted', () => {
    expect(governedCategoryDirective(WITHHELD)).toMatch(/qualitatively/i);
  });

  it('is empty when every governed category is admissible, so a healthy prompt is unchanged', () => {
    const all = {
      facts: [
        ...ADMISSIBLE.facts,
        presentFact('abs.seifa.irsdDecile', 2),
        presentFact('abs.industryShare.Health Care and Social Assistance', 15.1),
      ],
    };
    expect(governedCategoryDirective(all)).toBe('');
  });
});

describe('RF-7.2B.1A — post-generation authority audit (BLOCK cases)', () => {
  it('blocks a population claim while demographics are withheld', () => {
    const faults = auditGovernedNarrativeAuthority(COWRA_POPULATION, WITHHELD);
    expect(faults.length).toBeGreaterThan(0);
    expect(faults.some((f) => f.category === 'demographics')).toBe(true);
    expect(governedAuthorityBlocks(faults)).toBe(true);
  });

  it('blocks a median-age claim', () => {
    const faults = auditGovernedNarrativeAuthority(
      'The suburb records a median age of 35 across its resident base.',
      WITHHELD,
    );
    expect(governedAuthorityBlocks(faults)).toBe(true);
  });

  it('blocks a household-income claim', () => {
    const faults = auditGovernedNarrativeAuthority(MUSWELLBROOK_INCOME, WITHHELD);
    expect(governedAuthorityBlocks(faults)).toBe(true);
  });

  it('blocks a false ABS/Census attribution and names it as one', () => {
    const faults = auditGovernedNarrativeAuthority(MUSWELLBROOK_CENSUS, WITHHELD);
    expect(faults.some((f) => f.kind === 'false_attribution')).toBe(true);
    expect(governedAuthorityBlocks(faults)).toBe(true);
  });

  it('blocks cross-grain substitution (SA2 / LGA / township / shire / ERP)', () => {
    const faults = auditGovernedNarrativeAuthority(COWRA_SPARKLINE, WITHHELD);
    expect(faults.some((f) => f.kind === 'cross_grain_substitution')).toBe(true);
  });

  it('blocks a withheld employment claim', () => {
    const faults = auditGovernedNarrativeAuthority(MUSWELLBROOK_LABOUR, WITHHELD);
    expect(faults.some((f) => f.category === 'employment')).toBe(true);
  });

  it('catches the whole Cowra passage as one report body', () => {
    const body = [COWRA_QUALITATIVE, COWRA_POPULATION, COWRA_SPARKLINE].join('\n\n');
    expect(governedAuthorityBlocks(auditGovernedNarrativeAuthority(body, WITHHELD))).toBe(true);
  });
});

describe('RF-7.2B.1A — PASS cases (the detector must not be brittle)', () => {
  it('passes qualitative tenant and demand commentary carrying no governed number', () => {
    expect(auditGovernedNarrativeAuthority(COWRA_QUALITATIVE, WITHHELD)).toEqual([]);
    expect(auditGovernedNarrativeAuthority(MUSWELLBROOK_QUALITATIVE, WITHHELD)).toEqual([]);
  });

  it("passes the property's own figures, which are not governed facts", () => {
    const prose =
      'The dwelling offers three bedrooms and one bathroom on 988 m² of land, purchased '
      + 'at $555,000 with a weekly rent of $445 and an 80% loan-to-value ratio.';
    expect(auditGovernedNarrativeAuthority(prose, WITHHELD)).toEqual([]);
  });

  it('passes a census YEAR mentioned beside a governed term with no figure', () => {
    const prose = 'Population characteristics were last measured at the 2021 Census.';
    expect(auditGovernedNarrativeAuthority(prose, WITHHELD)).toEqual([]);
  });

  it('passes an admissible demographic fact quoted correctly', () => {
    const prose =
      'The postal area recorded a population of 13,795 at the 2021 Census, with a median '
      + 'age of 36 and a median weekly household income of $1,640.';
    expect(auditGovernedNarrativeAuthority(prose, ADMISSIBLE)).toEqual([]);
    expect(governedAuthorityBlocks(auditGovernedNarrativeAuthority(prose, ADMISSIBLE))).toBe(false);
  });

  it('raises no new fault on a healthy report whose categories are all admissible', () => {
    const body = [MUSWELLBROOK_CENSUS, MUSWELLBROOK_INCOME, MUSWELLBROOK_LABOUR].join('\n\n');
    const all = {
      facts: [
        ...ADMISSIBLE.facts,
        presentFact('abs.unemploymentRate', 5.7),
        presentFact('abs.labourForce', 6406),
        presentFact('abs.seifa.irsdDecile', 2),
      ],
    };
    expect(auditGovernedNarrativeAuthority(body, all)).toEqual([]);
  });
});

/**
 * Calibration against real prose, not invented prose.
 *
 * Every unit below is verbatim from the stored Cowra report. They were pulled
 * by selecting every claim unit in that document containing ANY governed term,
 * which is the set a brittle detector would over-fire on. The point of the
 * block is the ratio: the detector must find the two fabrications and leave
 * the ten innocent units alone.
 */
describe('RF-7.2B.1A — calibration on the real Cowra document', () => {
  const INNOCENT: ReadonlyArray<readonly [string, string]> = [
    ['A', 'Cowra’s residential pocket around **48 Redfern Street** offers a straightforward regional house-and-land play: solid local amenity and community attachment, a genuine family-tenant market.'],
    ['B', 'The broader suburb context around Redfern Street is characterised by **free-standing houses on generous blocks**, many between 900 m² and 2,200 m².'],
    ['C', 'The subject asset at **48 Redfern Street, Cowra NSW 2794** is recorded as a **Residential Property on a 988 m² block with one parking space**.'],
    ['D', 'Cowra functions as a regional centre with schools, health services, retail and light industrial employment, so tenants are typically **local workers, families and retirees** rather than transient short-stay populations.'],
    ['F', '- **Owner-occupier appeal:** Strong, given the renovated interiors, sizeable block and conventional street character'],
    ['H', 'The broader LGA’s area of roughly 2,800 square kilometres and a single main town centre mean Cowra functions as the primary location for schooling, healthcare, retail, and community services.'],
    ['I', '### Population and Development Trajectory'],
    ['J', 'The population trend insight is that Cowra’s headcount has been broadly stable to mildly growing over the past decade, with modest short-term fluctuations rather than rapid expansion or steep decline.'],
    ['K', 'The New South Wales Government’s Cowra Regional Economic Development Strategy describes Cowra as a major population centre in the central west, located on the Lachlan River.'],
    ['L', 'From an occupier fit perspective, the property’s layout and land size make it **best suited to long-term family renters and owner-occupiers who value space and a traditional home**.'],
  ];

  it.each(INNOCENT)('passes real unit %s', (_id, text) => {
    expect(auditGovernedNarrativeAuthority(text, WITHHELD)).toEqual([]);
  });

  it('blocks the fabricated resident population (real unit G)', () => {
    const g =
      'Cowra Shire’s estimated resident population was about 12,721 people as at June 2025 '
      + 'according to the Cowra Shire demographic profile, with the Cowra SA2 containing around '
      + '9,150–9,273 residents.';
    expect(governedAuthorityBlocks(auditGovernedNarrativeAuthority(g, WITHHELD))).toBe(true);
  });

  it('blocks a model-drawn occupier-mix chart asserting a tenure split (real unit E)', () => {
    const e =
      '{{donut: Family renters 45, Local owner-occupiers 35, Professionals & small households 20 '
      + '| title=Likely occupier mix | center=45% | centerSub=Family renters}}';
    expect(governedAuthorityBlocks(auditGovernedNarrativeAuthority(e, WITHHELD))).toBe(true);
  });
});

/**
 * Source-level wiring, because a pure module cannot tell you whether
 * production calls it — and the first draft of this change injected the
 * directive into `propertyPrompt` alone, which is one of FOUR scope prompts.
 * An address report would have carried the rule and a suburb report would
 * not. That is the same "exists but is not wired" shape RF-7.2B.1 was opened
 * to close, so it is pinned here rather than trusted.
 */
describe('RF-7.2B.1A — wired into the real generator', () => {
  const generator = readFileSync(
    resolve(__dirname, '../../../../supabase/functions/generate-investment-report/index.ts'),
    'utf-8',
  );

  it('imports the module', () => {
    expect(generator).toContain('governedNarrativeAuthority.pure.ts');
  });

  it('appends the directive AFTER the scope selects, so all four prompts carry it', () => {
    const selection = generator.indexOf('let prompt = reportScope ===');
    const injection = generator.indexOf('prompt += governedCategoryDirective(');
    expect(selection).toBeGreaterThan(-1);
    expect(injection).toBeGreaterThan(selection);
  });

  it('does not inject the directive into any single scope template instead', () => {
    expect(generator).not.toContain('${governedCategoryDirective(');
  });

  it('runs the audit over the assembled report and feeds validation_flags', () => {
    expect(generator).toContain('auditGovernedNarrativeAuthority(');
    expect(generator).toContain('...governedFlags,');
  });
});

describe('RF-7.2B.1A — the fault is blocking, not advisory', () => {
  it('emits a critical, blocking validation flag', () => {
    const [fault] = auditGovernedNarrativeAuthority(MUSWELLBROOK_CENSUS, WITHHELD);
    const flag = governedFaultToFlag(fault);
    expect(flag.type).toBe('governed_authority');
    expect(flag.severity).toBe('critical');
    expect(flag.value.blocking).toBe(true);
    expect(flag.value.readiness).toBe('blocked');
  });

  it('does not block when there is nothing to block', () => {
    expect(governedAuthorityBlocks([])).toBe(false);
  });
});
