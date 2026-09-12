/**
 * Governed narrative authority — a withheld fact may not be re-sourced.
 *
 * ## The defect this closes, measured in production
 *
 * RF-7.2B.1's Client-Safe Gate withholds demographics, SEIFA and employment
 * when no trusted geography is available. Two reports generated on 2026-09-11
 * through the real pipeline (`09f8569e…` Cowra, `3fbbcfe6…` Muswellbrook) had
 * `market.demographics` recorded `absent` in `market_fact_snapshot` — and both
 * documents then stated demographic figures anyway:
 *
 *   "According to the Australian Bureau of Statistics 2021 Census,
 *    Muswellbrook township recorded 12,272 residents, with a median age of 35"
 *
 * `abs_census_poa` for POA 2333 holds **13,795** and median age **36**. The
 * figures are not the platform's; they came from the section generator, which
 * is Perplexity `sonar-pro` — a SEARCH-GROUNDED model. Withholding the
 * authoritative number did not remove the claim, it removed the source: the
 * prompt still asked for a demographics section, so the model searched, and
 * wrote what it found under an ABS citation at a geography nobody asked for
 * (township, SA2, LGA, ERP — never the subject postal area).
 *
 * Three things were true at once and each was necessary:
 *
 *  1. **The withholding never reached the prompt.** `safeGeneration.removed`
 *     was `console.log`ged and nothing else, so the model was never told a
 *     category was unavailable, only handed a context without it.
 *  2. **The post-generation audit could not see it.** `auditMarketClaims` is
 *     VALUE-anchored — it finds a number it already holds and checks the prose
 *     around it (`if (fact.status !== 'present') continue`). A withheld fact
 *     has no value to anchor on, so nothing was checked.
 *  3. **Each half assumed the other covered it.** `marketClaimAudit`'s header
 *     said a mention of a withheld figure was "a different defect that the
 *     fact reconciliation already looks for". It does not:
 *     `factReconciliation.pure.ts` contains no occurrence of `withheld`,
 *     `absent`, `demographic` or `population`. Neither module covered it.
 *
 * ## The invariant
 *
 * **A governed market fact may be narrated quantitatively only when an
 * admissible corresponding fact exists in `market_fact_snapshot`.**
 *
 * This module is both halves of that, deliberately in ONE file: the directive
 * the prompt carries and the audit that checks the result read the same
 * category table. Two copies of "which categories are governed" is exactly how
 * the two modules above drifted apart.
 *
 * ## Why detection is sentence-scoped
 *
 * A governed TERM alone is not a claim — "tenants are typically local workers,
 * families and retirees rather than transient short-stay populations" says
 * nothing quantitative and must pass. A NUMBER alone is not a claim either —
 * "the near-1,000 m² land size" is the property's own fact. The claim is the
 * two together, in one sentence. Scoping to the sentence rather than a
 * character window is what stops a land size three clauses away from being
 * read as a population count.
 *
 * Bare four-digit years are excluded from what counts as quantitative, because
 * "the 2021 Census" beside the word "population" is an attribution, not a
 * figure. A genuine population of exactly 2,021 people written without its
 * separator would be missed; that is the conservative side of the trade and it
 * is preferred to blocking a report for citing a census year.
 *
 * Pure: no Deno, no DOM, no network, no clock.
 */

import type { MarketFactSnapshot, SnapshotFact } from './safeGenerationInputs.pure.ts';

export const GOVERNED_NARRATIVE_AUTHORITY_VERSION = '1.0.0';

export type GovernedCategory = 'demographics' | 'seifa' | 'employment';

/** How a category stands for one report. */
export type CategoryStanding = 'admissible' | 'withheld';

export type GovernedFaultKind =
  | 'substituted_figure'
  | 'false_attribution'
  | 'cross_grain_substitution';

export interface GovernedClaimFault {
  readonly category: GovernedCategory;
  readonly kind: GovernedFaultKind;
  /** The sentence the claim was found in, trimmed for a reviewer. */
  readonly excerpt: string;
  readonly message: string;
}

interface CategorySpec {
  readonly category: GovernedCategory;
  readonly label: string;
  /** Snapshot fact names that carry this category. */
  readonly owns: (factName: string) => boolean;
  /** Governed labels as they appear in prose. */
  readonly terms: RegExp;
  /** What the directive forbids, named rather than gestured at. */
  readonly banned: readonly string[];
}

const CATEGORIES: readonly CategorySpec[] = [
  {
    category: 'demographics',
    label: 'resident demographics',
    owns: (n) =>
      n === 'market.demographics'
      || /^market\.(population|medianAge|medianRentWeekly|medianHouseholdIncomeWeekly|medianMortgageMonthly|ownerOccupierRate|renterRate)$/.test(n)
      || /^abs\.(population|medianAge|medianHouseholdIncomeAnnual|medianWeeklyIncome)$/.test(n),
    // Plurals matter: the defect corpus contains a model-drawn occupier-mix
    // chart reading `Local owner-occupiers 35`, which asserts an
    // owner-occupier RATE — a governed fact — and `owner[- ]occupier` alone
    // does not match it.
    terms:
      /\b(population|residents?|median age|household size|median (?:weekly |annual )?(?:household |personal |family )?income|median rent|median mortgage|owner[- ]occupiers?|renters?|rented dwellings?|tenure)\b/gi,
    banned: [
      'a population or resident count',
      'a median age',
      'a median household, personal or family income',
      'a median rent or mortgage figure',
      'an owner-occupier, renter or tenure percentage',
    ],
  },
  {
    category: 'seifa',
    label: 'SEIFA socio-economic indexes',
    owns: (n) => n.startsWith('abs.seifa.'),
    terms: /\b(seifa|irsd|irsad|\bier\b|\bieo\b|socio[- ]economic (?:index|advantage|disadvantage)|decile)\b/gi,
    banned: [
      'a SEIFA score or decile',
      'an IRSD, IRSAD, IER or IEO figure',
      'a socio-economic ranking expressed as a number',
    ],
  },
  {
    category: 'employment',
    label: 'workforce and employment composition',
    owns: (n) =>
      n.startsWith('abs.industryShare.')
      || /^abs\.(unemploymentRate|labourForce|labourForceParticipation|employmentRate)$/.test(n)
      || /^market\.(unemploymentRate|participationRate)$/.test(n),
    terms:
      /\b(unemployment rate|participation rate|labour force|labor force|employed residents?|employment rate|workforce|industry share|largest (?:single )?industry|employing)\b/gi,
    banned: [
      'an unemployment or participation rate',
      'a labour-force or employed-persons count',
      'an industry share or workforce percentage',
    ],
  },
];

/** Attribution to an official statistical source. */
const ATTRIBUTION =
  /\b(australian bureau of statistics|\babs\b|census|\bnema\b|areasearch|id\.community|profile\.id)\b/i;

/** A geography that is not the subject postal area. */
const OTHER_GRAIN =
  /\b(sa2|sa3|sa4|\blga\b|local government area|township|shire|erp|estimated resident population|statistical area)\b/i;

/**
 * A quantitative token. Currency, percentages and separated thousands are
 * always quantitative; a bare integer counts too, except where it is a plain
 * four-digit year (see the header for why that trade is taken this way).
 */
const QUANT = /\$\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\b\d+(?:\.\d+)?\b/g;

function hasQuantitativeAssertion(sentence: string): boolean {
  const tokens = sentence.match(QUANT);
  if (!tokens) return false;
  for (const raw of tokens) {
    const token = raw.trim();
    const bare = token.replace(/[\s,$%]/g, '');
    const decorated = /[$%]/.test(token) || /,/.test(token);
    if (!decorated && /^(?:19|20)\d{2}$/.test(bare)) continue; // a year, not a figure
    return true;
  }
  return false;
}

/**
 * Split into claim-sized units. Sentences, but newlines end a unit too: a
 * markdown table row and a `{{bars: …}}` visual directive each assert on their
 * own line without a full stop, and both carry figures.
 */
function claimUnits(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const trim = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 240);

/** Does the snapshot hold at least one PRESENT fact for this category? */
function standingOf(spec: CategorySpec, facts: readonly SnapshotFact[]): CategoryStanding {
  for (const fact of facts) {
    if (!spec.owns(fact.name)) continue;
    if (fact.status === 'present') return 'admissible';
  }
  return 'withheld';
}

/**
 * Every governed category and where it stands for this report.
 *
 * A category with no fact of its own in the snapshot at all reads `withheld`,
 * not `admissible` — absence of evidence is the whole condition this guards.
 */
export function governedCategoryStanding(
  snapshot: Pick<MarketFactSnapshot, 'facts'> | null | undefined,
): Record<GovernedCategory, CategoryStanding> {
  const facts = snapshot?.facts ?? [];
  const out = {} as Record<GovernedCategory, CategoryStanding>;
  for (const spec of CATEGORIES) out[spec.category] = standingOf(spec, facts);
  return out;
}

/**
 * The directive the prompt carries when a governed category is unavailable.
 *
 * Returns '' when every category is admissible, so a healthy report's prompt
 * is byte-identical to what it is today. Modelled on `absentRentDirective`,
 * which already establishes the shape: name the absence, forbid the
 * substitution specifically, and keep qualitative discussion open — a
 * prohibition with no permitted action is one a model routes around.
 */
export function governedCategoryDirective(
  snapshot: Pick<MarketFactSnapshot, 'facts'> | null | undefined,
): string {
  const standing = governedCategoryStanding(snapshot);
  const withheld = CATEGORIES.filter((s) => standing[s.category] === 'withheld');
  if (withheld.length === 0) return '';

  const lines: string[] = [
    '',
    '**GOVERNED DATA UNAVAILABLE FOR THIS PROPERTY.** The categories below could',
    'not be established for the subject property from an authoritative source, so',
    'this report does NOT have them. They are unavailable, not merely missing from',
    'the context above.',
    '',
  ];

  for (const spec of withheld) {
    lines.push(`- **${spec.label} — NOT AVAILABLE.** Do not state:`);
    for (const banned of spec.banned) lines.push(`    - ${banned};`);
  }

  lines.push(
    '',
    'For every category listed above, in this report:',
    '',
    '- Do NOT search for, look up, recall or derive a replacement figure. A figure',
    '  obtained from a web search, a statistical publication, an encyclopaedia, a',
    '  council or agency profile, or your own knowledge is NOT a substitute and must',
    '  not appear.',
    '- Do NOT substitute a different geography. A figure for an SA2, an SA3, an LGA,',
    '  a shire, a township, an urban centre, an ERP series or any area other than the',
    '  subject property\'s own postal area is NOT a substitute and must not appear.',
    '- Do NOT attribute any figure to the ABS, the Census, or any statistical agency',
    '  in this report for these categories. No such figure is held for this property.',
    '- Where such a figure would have appeared, write "Not available" and state in one',
    '  sentence that the data could not be established for this property.',
    '- You MAY still discuss the area qualitatively — its role, its amenity, the kind',
    '  of tenant it attracts, the character of local demand — provided you attach NO',
    '  number to any category listed above.',
    '',
  );
  return lines.join('\n');
}

/**
 * Audit the finished prose for governed claims the snapshot cannot support.
 *
 * Category-anchored, where `auditMarketClaims` is value-anchored: it asks
 * whether the text asserts a category for which no admissible fact exists,
 * which is precisely the question a withheld fact makes unanswerable by
 * looking for its value.
 */
export function auditGovernedNarrativeAuthority(
  reportText: unknown,
  snapshot: Pick<MarketFactSnapshot, 'facts'> | null | undefined,
): GovernedClaimFault[] {
  if (typeof reportText !== 'string' || reportText.trim() === '') return [];
  const standing = governedCategoryStanding(snapshot);
  const withheld = CATEGORIES.filter((s) => standing[s.category] === 'withheld');
  if (withheld.length === 0) return [];

  const faults: GovernedClaimFault[] = [];
  const units = claimUnits(reportText);

  for (const unit of units) {
    if (!hasQuantitativeAssertion(unit)) continue;
    for (const spec of withheld) {
      spec.terms.lastIndex = 0;
      if (!spec.terms.test(unit)) continue;

      if (ATTRIBUTION.test(unit)) {
        faults.push({
          category: spec.category,
          kind: 'false_attribution',
          excerpt: trim(unit),
          message:
            `A figure for ${spec.label} is attributed to an official statistical source, `
            + 'but no such figure is held for this property — the category was withheld '
            + 'because trusted geography was unavailable. The attribution cannot be honoured.',
        });
        continue;
      }

      if (OTHER_GRAIN.test(unit)) {
        faults.push({
          category: spec.category,
          kind: 'cross_grain_substitution',
          excerpt: trim(unit),
          message:
            `A figure for ${spec.label} is stated for a different geography (an SA2, LGA, `
            + 'township, shire or ERP series) in place of the subject property\'s own postal '
            + 'area. A neighbouring grain is not a substitute for the area that was withheld.',
        });
        continue;
      }

      faults.push({
        category: spec.category,
        kind: 'substituted_figure',
        excerpt: trim(unit),
        message:
          `A quantitative claim about ${spec.label} appears in the report, but the snapshot `
          + 'holds no admissible fact for that category. A governed fact may be narrated '
          + 'quantitatively only where the report actually holds it.',
      });
    }
  }

  // One fault of each kind per category is enough to send a reviewer to the
  // text; the same finding twenty times is how a flag list stops being read.
  const seen = new Set<string>();
  return faults.filter((f) => {
    const key = `${f.category}|${f.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Does this set of faults block the report from being treated as client-ready?
 *
 * Every fault of this class blocks. The category exists because the claim is
 * unsupported by anything the platform holds, and an unsupported factual claim
 * about a customer's property is not a disclosure-grade finding.
 */
export function governedAuthorityBlocks(faults: readonly GovernedClaimFault[]): boolean {
  return faults.length > 0;
}

/** The shape `validation_flags` already carries, so these sit beside the rest. */
export function governedFaultToFlag(fault: GovernedClaimFault): {
  type: string;
  severity: string;
  field: string;
  message: string;
  value: Record<string, unknown>;
} {
  return {
    type: 'governed_authority',
    // `critical`, and blocking with it. `high` is the band `market_claim` uses
    // for a fact that is real but described wrongly; this band is for a fact
    // the report does not have at all.
    severity: 'critical',
    field: `governed.${fault.category}`,
    message: fault.message,
    value: {
      kind: fault.kind,
      category: fault.category,
      excerpt: fault.excerpt,
      blocking: true,
      readiness: 'blocked',
      version: GOVERNED_NARRATIVE_AUTHORITY_VERSION,
    },
  };
}
