/**
 * The section registry — one constitution for every investment-report tier.
 *
 * Law 3 of the tier framework (docs/reports/TIER_FRAMEWORK.md): *structure is
 * selected by section id, never by matching heading strings; a declared section
 * with no producer fails CI.* This module is the first half of that law. The
 * second half is `sectionRegistry.spec.ts`, which refuses to let a declaration
 * here be a wish.
 *
 * ## What it replaces
 *
 * Structure was defined in SIX places that competed, and no two agreed:
 *
 *   1. `generate-investment-report`'s `DEFAULT_REPORT_SECTIONS` — 12 generation
 *      groups naming 26 H2s, plus three more lists for the other scopes;
 *   2. `compassSectionRegistry.ts` — 12 `compass.*` + 11 `financial.*` ids;
 *   3. `reportSplitRegistry.ts` — FIN's 16 and PLDD's 17, routed by heading
 *      substring;
 *   4. `condense-investment-report`'s `TIER_CONFIG[*].sections`;
 *   5. the `structureGuide` prose inside the same object;
 *   6. a ninth heading list typed inline at the snapshot's trim call site.
 *
 * Number 4 was read by **nothing** — and the snapshot's copy of it was wrong,
 * declaring `Top Opportunities & Risks` and `Recommendation` where the guide
 * beside it asked for `Top 3 Opportunities`, `Top 3 Risks` and `Quick
 * Recommendation`, and omitting two more headings the guide asks for. Six
 * declared entries against nine real ones, in the same object literal.
 *
 * ## Why the sections are fine-grained, and tiers merge them
 *
 * The registry is the **union** of every section any tier draws, and a tier
 * that draws one heading where another draws four says so with `merged`. That
 * shape is forced by the corpus rather than chosen:
 *
 *  - The Due Diligence tier splits demand across four headings (socioeconomic,
 *    population, employment, tenant demand) and risk across two (environmental,
 *    and the dashboard). The Compass draws one `Demand Drivers` and one `Risk
 *    Dashboard`. A registry with only the coarse ids cannot emit PLDD's heading
 *    list; one with only the fine ids cannot emit the Compass's.
 *  - The Compass v3.0 cut folded six sections into two, and that fact lived in
 *    a code comment. Which is why the compass-40 engine shipped a report
 *    carrying the **unmerged** v2.0 sections — `Population & Housing Demand`,
 *    `Tenant & Buyer Profile`, `Employment & Economic Linkages`, `Education &
 *    Family Amenity`, `Retail, Healthcare & Lifestyle Amenity`, `Transport &
 *    Connectivity` — plus two sections the registry marks `includeInCompass:
 *    false`, and nothing noticed. Of five runs of that engine, three produced
 *    three different structures.
 *
 * Two more things a flat list could not express, both measured:
 *
 *  - **A tier renames a section.** One "purchase and holding costs" section is
 *    `Purchase & Ongoing Costs (Annual)` to the generator, `Purchase Costs &
 *    Annual Holding Cost Breakdown` to FIN, and `Purchase & Ongoing Costs` in
 *    the briefings production holds. The label belongs to the *placement*.
 *  - **A section is not always markdown.** The cover, the property identity
 *    table and the key-figures strip are drawn by the template from the binding
 *    projection. A definition that only knows `##` headings cannot say a tier
 *    has them, which is how "the spine is mandatory in every tier" stayed
 *    unenforceable.
 *
 * ## What a declaration is worth
 *
 * FIN declares 16 sections; two — `10-Year Cashflow, Equity & Growth
 * Projection` and `Financial Investment Scorecard` — had never appeared in any
 * of the 11 financial reports ever produced. PLDD declares 17; six consecutive
 * ones, `Planning, Zoning and Title Due Diligence` among them, appear on 1 of
 * 11, on the tier whose whole promise is due diligence. Nothing measured
 * either, because a list of strings cannot be asked whether anything makes them.
 * Hence `producer` on every placement, and a spec that resolves each one.
 *
 * ## What this module is NOT, yet
 *
 * Phase 2 makes the registry the thing the other definitions are *checked
 * against*; Phase 3 makes it the thing they are *assembled from*, and deletes
 * heading-string matching. So `aliases` is populated from measured production
 * headings and `sectionIdForHeading` works, but nothing routes on it yet —
 * `reportSplitRegistry` still owns the fork's substring routing and
 * `compassSectionRegistry` still owns the generator's prompt. Both are now
 * pinned to this file, so they can drift only by failing CI.
 *
 * Deno-parsed: no `@/` aliases, explicit `.ts` extensions. Bridged for the
 * browser at `src/lib/reports/investment/sectionRegistry.pure.ts`.
 */

// ─── Tiers ──────────────────────────────────────────────────────────────────

/**
 * The five tiers stored in `investment_reports.report_tier`.
 *
 * `strategic` is the stored value for what a reader is shown as the **Due
 * Diligence Report** — decision B of the framework. The rename is a label
 * change and lands in Phase 4 with the tier's own cover identity; the stored
 * value never changes, because rows carry it.
 *
 * Comparison is the framework's sixth tier and is deliberately absent: it is
 * not an `investment_reports` row at all — it lives in `property_comparisons`
 * with its own producer — and declaring a tier whose sections this module
 * cannot ground would be the fiction the registry exists to remove. Phase 5
 * brings it in with the storage it needs.
 *
 * One tier has two routes to it and this file describes one of them.
 * `report_tier = 'financial'` is reachable by forking a Compass (11 rows) and,
 * in principle, by condensing one — `condense-investment-report`'s TIER_CONFIG
 * carries a `financial` guide. That second route has produced **zero** rows, so
 * the financial placements below name the fork's routed and composed producers,
 * which is what the corpus actually holds. If the condense route is ever used,
 * its headings and these must be reconciled rather than allowed to be a seventh
 * competing definition.
 */
export const REPORT_TIERS = ['compass', 'briefing', 'snapshot', 'financial', 'strategic'] as const;
export type ReportTier = (typeof REPORT_TIERS)[number];

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * Where the facts in this section come from, and therefore what may validate
 * them. The framework's provenance classes.
 *
 * A table cell may hold only `measured` / `computed` / `recorded` values, never
 * `authored` — law 1 restated as a property of the section rather than of a
 * sentence.
 */
export type Provenance = 'measured' | 'computed' | 'recorded' | 'authored';

/** Where the section is drawn in a given tier. */
export type Surface =
  /** A `##` section inside `report_content`. */
  | 'markdown'
  /** Drawn by the template from the binding projection; no heading in the prose. */
  | 'document';

/**
 * How strongly a tier commits to a section.
 *
 *  - `spine`    — one of the five sections every tier carries. Never absent,
 *                 never optional, never merged away.
 *  - `required` — the tier promises it; it needs a producer.
 *  - `optional` — drawn when the record supports it; absence is not a defect.
 *  - `merged`   — this tier carries the substance inside another section, named
 *                 by `mergedInto`. An absence of a heading, not of the content.
 *
 * A tier absent from `tiers` is **excluded**: it deliberately does not carry
 * the section, and a producer emitting it there is the defect.
 */
export type Depth = 'spine' | 'required' | 'optional' | 'merged';

/**
 * What actually makes the section, and where to look for it.
 *
 *  - `composed`   — a pure function writes the markdown from the record.
 *  - `authored`   — a model writes it under a named guide. The spec asserts the
 *                   guide really asks for this heading: an authored section
 *                   whose prompt never names it is a section nobody will write.
 *  - `routed`     — carried over from a parent document by the split registry.
 *  - `projection` — bound by the template from `reportBindingProjection`.
 */
export type ProducerKind = 'composed' | 'authored' | 'routed' | 'projection';

export interface SectionProducer {
  kind: ProducerKind;
  ref: string;
}

export interface TierPlacement {
  depth: Depth;
  /** Position within the tier, 1-based. Absent only when `depth` is `merged`. */
  order?: number;
  /** The heading this tier gives it. Required for `markdown`, absent otherwise. */
  label?: string;
  /** Defaults to `markdown`. */
  surface?: Surface;
  /** Only, and always, when `depth` is `merged`. */
  mergedInto?: SectionId;
  /**
   * What makes it here. `null` is an honest declaration that nothing does yet —
   * every null on a `spine` or `required` placement must appear in
   * PRODUCER_GAPS, and a new one fails CI.
   */
  producer: SectionProducer | null;
}

export interface SectionDefinition {
  id: SectionId;
  /** The name this section goes by when a tier does not rename it. */
  canonicalLabel: string;
  provenance: Provenance;
  /**
   * Every heading production has actually carried for this section.
   *
   * Measured from the `##` headings of the 1,199 stored reports, which is why
   * the list is untidy: numbered and unnumbered forms of one name, trailing
   * colons, and the emoji headings 746 legacy Compass reports carry. Nothing
   * routes on these in Phase 2; Phase 3's assembly reads them so no consumer
   * keeps its own regex — which is how `TITLED_SECTION_CHARTS`, `SPLIT_ROUTES`
   * and `sourceHeadings` became three opinions about the same heading.
   */
  aliases: readonly string[];
  /** Absent tier ⇒ excluded from that tier. */
  tiers: Partial<Record<ReportTier, TierPlacement>>;
  purpose: string;
}

// ─── Section ids ────────────────────────────────────────────────────────────

export const SECTION_IDS = [
  // the spine
  'identity',
  'verdict',
  'propertyIdentity',
  'keyFigures',
  'provenance',
  'assumptions',
  // location & market
  'locationCase',
  'infrastructure',
  'suburbCharacter',
  'marketPosition',
  'supplyPipeline',
  // demand
  'population',
  'socioeconomic',
  'employment',
  'tenantDemand',
  // amenity & access
  'amenityAccess',
  'education',
  'transport',
  // the property
  'propertyFit',
  'dwelling',
  'planning',
  // risk
  'riskDashboard',
  'environmentalRisk',
  'dueDiligenceChecklist',
  // the financial model
  'purchaseHolding',
  'rentalYield',
  'loan',
  'sensitivity',
  'tenYear',
  'scorecard',
  'swot',
  'exitStrategy',
  'suitability',
  // the close
  'opportunities',
  'risks',
  'recommendation',
  // snapshot furniture
  'marketStats',
  'financialSnapshot',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

// ─── Producer refs, spelled once ────────────────────────────────────────────

/** An ordinal `composeFinancialChapters` emits; the spec runs it and checks. */
const composed = (ordinal: number): SectionProducer => ({
  kind: 'composed',
  ref: `financialChapters.pure.ts#${ordinal}`,
});

const composedFn = (fn: string): SectionProducer => ({
  kind: 'composed',
  ref: `scoreSections.pure.ts#${fn}`,
});

export type AuthoringGuide = 'condense.briefing' | 'condense.snapshot' | 'generator.compass';

const authored = (guide: AuthoringGuide): SectionProducer => ({ kind: 'authored', ref: guide });

const routed = (variant: 'financial' | 'dueDiligence', ordinal: number): SectionProducer => ({
  kind: 'routed',
  ref: `split.${variant}#${ordinal}`,
});

/**
 * A binding-projection namespace.
 *
 * The name before the dot must be one `applyInvestmentProjection` actually
 * merges — `property`, `financials`, `assumptions`, `recommendation`, `summary`,
 * `report`, `narrative`. The first draft of this file named `keyFigures.*` and
 * `sources.*`, neither of which exists, which is precisely the failure mode a
 * producer field is for: a structure definition asserting something is drawn by
 * machinery that was never written.
 */
const projection = (path: string): SectionProducer => ({ kind: 'projection', ref: path });

/**
 * The disclaimer `fork-investment-report` appends to both variants.
 *
 * Not routed and not authored — `renderVariantMarkdown` writes `## Disclaimer`
 * with the variant's own footer, unconditionally, which is why it is the one
 * heading on 11 of 11 financial and 11 of 11 strategic reports while six of
 * PLDD's declared sections are on one.
 */
const forkDisclaimer: SectionProducer = {
  kind: 'composed',
  ref: 'supabase/functions/fork-investment-report/index.ts#renderVariantMarkdown',
};

/** A section a tier folds into another one. Carries no heading and no producer. */
const merged = (into: SectionId): TierPlacement => ({
  depth: 'merged',
  mergedInto: into,
  producer: null,
});

// ─── The matrix ─────────────────────────────────────────────────────────────

export const SECTION_REGISTRY: readonly SectionDefinition[] = [
  // ── The spine ────────────────────────────────────────────────────────────
  {
    id: 'identity',
    canonicalLabel: 'Cover & report identity',
    provenance: 'recorded',
    aliases: ['Cover', 'Cover Page', 'Contents & Reading Guide', 'Client Reading Guide'],
    purpose:
      'Who issued it, what it is, which property, when. Drawn by the template on every tier — the model-written cover was excluded from Compass assembly in 2026-09 because it rendered as a second cover inside the body.',
    tiers: {
      compass: { depth: 'spine', order: 1, surface: 'document', producer: projection('report.*') },
      briefing: { depth: 'spine', order: 1, surface: 'document', producer: projection('report.*') },
      snapshot: { depth: 'spine', order: 1, surface: 'document', producer: projection('report.*') },
      financial: { depth: 'spine', order: 1, surface: 'document', producer: projection('report.*') },
      strategic: { depth: 'spine', order: 1, surface: 'document', producer: projection('report.*') },
    },
  },
  {
    id: 'keyFigures',
    canonicalLabel: 'Key figures',
    provenance: 'computed',
    aliases: [],
    purpose:
      'Price, rent, gross yield, weekly position — four Computed facts on the verdict page. Decision A of the framework keeps this on the Compass; detailed modelling stays in the Financial tier.',
    tiers: {
      compass: { depth: 'spine', order: 2, surface: 'document', producer: projection('financials.*') },
      briefing: { depth: 'spine', order: 2, surface: 'document', producer: projection('financials.*') },
      snapshot: { depth: 'spine', order: 2, surface: 'document', producer: projection('financials.*') },
      financial: { depth: 'spine', order: 2, surface: 'document', producer: projection('financials.*') },
      strategic: { depth: 'spine', order: 2, surface: 'document', producer: projection('financials.*') },
    },
  },
  {
    id: 'verdict',
    canonicalLabel: 'Executive Verdict',
    provenance: 'authored',
    aliases: [
      'Executive Verdict', 'Executive Summary', '1. Executive Summary', 'Overall Assessment',
      'Investment Recommendation', 'Investment Score',
      'Client Investment Decision Summary', 'Client Property & Location Snapshot',
    ],
    purpose:
      'The verdict first: the call, the score and grade, the coverage it rests on, and the two or three things that would change it.',
    tiers: {
      compass: { depth: 'spine', order: 3, label: 'Executive Verdict', producer: authored('generator.compass') },
      briefing: { depth: 'spine', order: 3, label: 'Executive Summary', producer: authored('condense.briefing') },
      snapshot: { depth: 'spine', order: 5, label: 'Investment Score', producer: authored('condense.snapshot') },
      financial: { depth: 'spine', order: 3, label: 'Client Investment Decision Summary', producer: routed('financial', 1) },
      strategic: { depth: 'spine', order: 3, label: 'Client Property & Location Snapshot', producer: routed('dueDiligence', 1) },
    },
  },
  {
    id: 'propertyIdentity',
    canonicalLabel: 'Property & Locality Snapshot',
    provenance: 'recorded',
    aliases: [
      'Property & Locality Snapshot', 'Property Snapshot', 'Property-Level Information',
      '5. Property-Level Information', 'Locality Snapshot', 'Property Summary',
      'Property Overview', 'Property Snapshot — Non-Financial',
      'Core Property Facts & Physical Profile', 'Financial Input Snapshot',
    ],
    purpose:
      'The property as facts in a table — type, bed/bath/car, land, configuration, suburb, LGA. Recorded, never authored, and internally consistent everywhere it appears.',
    tiers: {
      compass: { depth: 'spine', order: 4, label: 'Property & Locality Snapshot', producer: authored('generator.compass') },
      briefing: { depth: 'spine', order: 4, surface: 'document', producer: projection('property.*') },
      snapshot: { depth: 'spine', order: 3, label: 'Property Summary', producer: authored('condense.snapshot') },
      financial: { depth: 'spine', order: 4, label: 'Financial Input Snapshot', producer: routed('financial', 2) },
      strategic: { depth: 'spine', order: 4, label: 'Core Property Facts & Physical Profile', producer: routed('dueDiligence', 2) },
    },
  },
  {
    id: 'provenance',
    canonicalLabel: 'Appendix, Source Notes & Disclaimer',
    provenance: 'recorded',
    aliases: [
      'Appendix, Source Notes & Disclaimer', 'PROFESSIONAL DISCLAIMER',
      '⚖️ PROFESSIONAL DISCLAIMER', 'Disclaimer', 'Source Appendix', 'Appendix',
      'Market Data Sources', 'Market Data Sources & Data Transparency',
      'Sources & Data Transparency', '13. Sources & Data Transparency', 'Data Sources',
      'Data Transparency Statement', 'SOURCES & REFERENCES',
    ],
    purpose:
      'What the document rests on and what it is not: sources with dates and the advice disclaimer. A source that was not used is omitted rather than listed.',
    tiers: {
      compass: { depth: 'spine', order: 90, label: 'Appendix, Source Notes & Disclaimer', producer: authored('generator.compass') },
      briefing: { depth: 'spine', order: 90, label: 'Market Data Sources', producer: authored('condense.briefing') },
      snapshot: { depth: 'spine', order: 11, label: 'Market Data Sources', producer: authored('condense.snapshot') },
      financial: { depth: 'spine', order: 19, label: 'Disclaimer', producer: forkDisclaimer },
      strategic: { depth: 'spine', order: 90, label: 'Disclaimer', producer: forkDisclaimer },
    },
  },
  {
    id: 'assumptions',
    canonicalLabel: 'Base Assumptions',
    provenance: 'recorded',
    aliases: [
      'Base Assumptions', 'Projection Assumptions', 'Financial Assumptions & Data Sources',
      'Assumptions, Verification Items & Adviser Disclaimer',
    ],
    purpose:
      'The inputs every figure rests on — growth, CPI, occupancy, rate — and the items a client must independently verify. Separate from the disclaimer because they answer different questions, and the Financial report carries both.',
    tiers: {
      compass: merged('provenance'),
      briefing: merged('provenance'),
      financial: { depth: 'required', order: 18, label: 'Assumptions, Verification Items & Adviser Disclaimer', producer: routed('financial', 16) },
    },
  },

  // ── Location & market ────────────────────────────────────────────────────
  {
    id: 'locationCase',
    canonicalLabel: 'Why This Location Matters',
    provenance: 'measured',
    aliases: [
      'Why This Location Matters', 'Location Overview', '1. Location Overview',
      'Position Within the Locality', 'Location & Demand', 'Growth Corridor',
      'Location & Profile', 'Suburb Profile',
    ],
    purpose: 'The case for the location itself: where it sits, what is changing, and why that matters to this purchase.',
    tiers: {
      compass: { depth: 'required', order: 5, label: 'Why This Location Matters', producer: authored('generator.compass') },
      briefing: { depth: 'required', order: 5, label: 'Location & Demand', producer: authored('condense.briefing') },
      strategic: { depth: 'required', order: 6, label: 'Position Within the Locality', producer: routed('dueDiligence', 4) },
    },
  },
  {
    id: 'infrastructure',
    canonicalLabel: 'Infrastructure and Growth Context',
    provenance: 'measured',
    aliases: [
      'Infrastructure and Growth Context', 'Future Infrastructure',
      'Future Infrastructure & Growth Pipeline', 'Infrastructure & Development',
      'Infrastructure Pipeline', 'Supply & Development Pipeline',
    ],
    purpose: 'The committed and planned pipeline — what is funded, what is announced, and when each lands.',
    tiers: {
      compass: merged('locationCase'),
      briefing: merged('locationCase'),
      strategic: { depth: 'required', order: 16, label: 'Infrastructure and Growth Context', producer: routed('dueDiligence', 14) },
    },
  },
  {
    id: 'suburbCharacter',
    canonicalLabel: 'Suburb Character, Lifestyle & Occupier Appeal',
    provenance: 'measured',
    aliases: ['Suburb Character, Lifestyle & Occupier Appeal', 'Suburb Character & Lifestyle'],
    purpose: 'What living there is actually like, and who that appeals to.',
    tiers: {
      compass: merged('propertyFit'),
      briefing: merged('propertyFit'),
      strategic: { depth: 'required', order: 7, label: 'Suburb Character, Lifestyle & Occupier Appeal', producer: routed('dueDiligence', 5) },
    },
  },
  {
    id: 'marketPosition',
    canonicalLabel: 'Market Positioning',
    provenance: 'measured',
    aliases: [
      'Market Positioning', 'Market Position', 'Current Market Performance',
      'Current Market Performance (Q3/Q4 2025)', 'Market Analysis', 'Market Activity',
      'Market KPIs', '2. Market KPIs', 'Market Performance & Macro Demand',
      'Historical Price Growth Table', 'Historical Rent Growth Table',
      'Comparable Market Evidence', '8. Comparable Market Evidence',
      'Recent Comparable Sales', 'Recent Comparable Rentals', 'Price Trends & Growth',
      'Price, Rent & Yield Market Positioning',
    ],
    purpose: 'Where this property sits in its local market — medians, growth, days on market, and the comparables that anchor them.',
    tiers: {
      compass: { depth: 'required', order: 6, label: 'Market Positioning', producer: authored('generator.compass') },
      briefing: { depth: 'required', order: 7, label: 'Market Position', producer: authored('condense.briefing') },
      financial: { depth: 'required', order: 5, label: 'Price, Rent & Yield Market Positioning', producer: routed('financial', 3) },
      strategic: merged('supplyPipeline'),
    },
  },
  {
    id: 'supplyPipeline',
    canonicalLabel: 'Competitive Landscape and Supply Pipeline',
    provenance: 'measured',
    aliases: ['Competitive Landscape and Supply Pipeline'],
    purpose: 'What else is coming to market nearby, and what that does to this property’s position.',
    tiers: {
      compass: merged('marketPosition'),
      briefing: merged('marketPosition'),
      strategic: { depth: 'required', order: 17, label: 'Competitive Landscape and Supply Pipeline', producer: routed('dueDiligence', 16) },
    },
  },

  // ── Demand ───────────────────────────────────────────────────────────────
  // The Compass draws these four as one `Demand Drivers`; the Due Diligence
  // tier draws them separately. `population` carries the merged placement
  // because it is the heading the Compass's own registry gives it.
  {
    id: 'population',
    canonicalLabel: 'Demand Drivers',
    provenance: 'measured',
    aliases: [
      'Demand Drivers', 'Demographics & Demand Drivers', '3. Demographics & Demand Drivers',
      'Population & Household Characteristics', 'Population & Development Trends',
      'Population & Housing Demand', 'Population, Household Growth & Demographic Fit',
      'Demographics & Economics', 'Demographics, SEIFA, Employment & Demand',
    ],
    purpose: 'Who wants to live here and why — population, household formation and the demographic fit for this dwelling.',
    tiers: {
      compass: { depth: 'required', order: 7, label: 'Demand Drivers', producer: authored('generator.compass') },
      briefing: merged('locationCase'),
      strategic: { depth: 'required', order: 11, label: 'Population, Household Growth & Demographic Fit', producer: routed('dueDiligence', 9) },
    },
  },
  {
    id: 'socioeconomic',
    canonicalLabel: 'Socioeconomic Profile & SEIFA Interpretation',
    provenance: 'measured',
    aliases: ['Socioeconomic Profile & SEIFA Interpretation', 'Socioeconomic Profile'],
    purpose: 'SEIFA deciles read as what they mean for tenant quality, arrears risk and resale depth.',
    tiers: {
      compass: merged('population'),
      briefing: merged('locationCase'),
      strategic: { depth: 'required', order: 10, label: 'Socioeconomic Profile & SEIFA Interpretation', producer: routed('dueDiligence', 8) },
    },
  },
  {
    id: 'employment',
    canonicalLabel: 'Employment, Income & Affordability Profile',
    provenance: 'measured',
    aliases: [
      'Employment, Income & Affordability Profile', 'Employment & Economic Linkages',
      'Major Industries & Job Growth', 'Employment & Industry Breakdown',
      'Job Growth Trends', 'Current Economic Context', 'Economic Context',
      'State Economic Overview',
    ],
    purpose: 'What people there do for a living, what they earn, and whether this price is affordable against it.',
    tiers: {
      compass: merged('population'),
      briefing: merged('locationCase'),
      strategic: { depth: 'required', order: 12, label: 'Employment, Income & Affordability Profile', producer: routed('dueDiligence', 10) },
    },
  },
  {
    id: 'tenantDemand',
    canonicalLabel: 'Tenant Demand and Occupier Personas',
    provenance: 'measured',
    aliases: [
      'Tenant Demand and Occupier Personas', 'Tenant & Buyer Profile',
      'Rental Market Deep Dive', 'Rental Market',
      'Vacancy Risk, Tenant Income & Rent Sustainability',
    ],
    purpose: 'Who rents here, what they will pay, and how exposed the rent is to them leaving.',
    tiers: {
      compass: merged('population'),
      briefing: merged('locationCase'),
      financial: { depth: 'required', order: 9, label: 'Vacancy Risk, Tenant Income & Rent Sustainability', producer: routed('financial', 7) },
      strategic: { depth: 'required', order: 13, label: 'Tenant Demand and Occupier Personas', producer: routed('dueDiligence', 11) },
    },
  },

  // ── Amenity & access ─────────────────────────────────────────────────────
  {
    id: 'amenityAccess',
    canonicalLabel: 'Amenity & Access',
    provenance: 'measured',
    aliases: [
      'Amenity & Access', 'Amenity & Livability Matrix', 'Amenity Maturity & Daily Liveability',
      'Amenity Summary', 'Healthcare & Shopping', 'Retail, Healthcare & Lifestyle Amenity',
      'Recreational Amenities', 'Major Recreational Complexes', 'Recreation & Parks',
      'Shopping & Dining Facilities', 'Healthcare Facilities',
      'Infrastructure & Amenities', '4. Infrastructure & Amenities',
      'Amenities & Infrastructure', 'Location & Amenities',
    ],
    purpose: 'What is nearby and how good it is — retail, healthcare, recreation and everyday liveability.',
    tiers: {
      compass: { depth: 'required', order: 8, label: 'Amenity & Access', producer: authored('generator.compass') },
      briefing: { depth: 'required', order: 6, label: 'Amenity & Access', producer: authored('condense.briefing') },
      strategic: { depth: 'required', order: 8, label: 'Amenity Maturity & Daily Liveability', producer: routed('dueDiligence', 6) },
    },
  },
  {
    id: 'education',
    canonicalLabel: 'Schools & Education',
    provenance: 'measured',
    aliases: [
      'Schools & Education', 'Education & Family Amenity', 'Education & Family Demand',
      'Education Facilities', 'Education Infrastructure Summary',
    ],
    purpose: 'Catchments, the schools in them and what that does to family demand.',
    tiers: {
      compass: merged('amenityAccess'),
      briefing: merged('amenityAccess'),
      strategic: merged('amenityAccess'),
    },
  },
  {
    id: 'transport',
    canonicalLabel: 'Transport, Commute & Daily Movement',
    provenance: 'measured',
    aliases: [
      'Transport, Commute & Daily Movement', 'Transport & Accessibility',
      'Transport & Connectivity', 'Connectivity & Transport', 'Public Transport Network',
    ],
    purpose: 'Real commute times to the places people actually go, and what the road and rail plans change.',
    tiers: {
      compass: merged('amenityAccess'),
      briefing: merged('amenityAccess'),
      strategic: { depth: 'required', order: 9, label: 'Transport, Commute & Daily Movement', producer: routed('dueDiligence', 7) },
    },
  },

  // ── The property ─────────────────────────────────────────────────────────
  {
    id: 'propertyFit',
    canonicalLabel: 'Property Fit Within the Suburb',
    provenance: 'authored',
    aliases: [
      'Property Fit Within the Suburb', 'Property Fit', 'Strategic Assessment',
      'Future Buyer and Resale Appeal', 'Investment Suitability Screening',
      'Key Strengths & Watch Points',
    ],
    purpose: 'How this dwelling aligns with local demand — position, land/build balance, occupier appeal and its limitations.',
    tiers: {
      compass: { depth: 'required', order: 9, label: 'Property Fit Within the Suburb', producer: authored('generator.compass') },
      briefing: { depth: 'required', order: 8, label: 'Property Fit', producer: authored('condense.briefing') },
      strategic: { depth: 'required', order: 14, label: 'Future Buyer and Resale Appeal', producer: routed('dueDiligence', 12) },
    },
  },
  {
    id: 'dwelling',
    canonicalLabel: 'Dwelling Layout & Functional Fit',
    provenance: 'recorded',
    aliases: ['Dwelling Layout & Functional Fit'],
    purpose: 'The floor plan as a functional claim: layout, orientation, storage, and who the configuration suits.',
    tiers: {
      compass: merged('propertyFit'),
      briefing: merged('propertyFit'),
      strategic: { depth: 'required', order: 5, label: 'Dwelling Layout & Functional Fit', producer: routed('dueDiligence', 3) },
    },
  },
  {
    id: 'planning',
    canonicalLabel: 'Planning, Zoning and Title Due Diligence',
    provenance: 'measured',
    aliases: [
      'Planning, Zoning and Title Due Diligence', 'Zoning', 'Planning', 'Property & Zoning',
      'Government Policy & Regulation',
    ],
    purpose:
      'Zone, overlays, easements, title, and what must be confirmed on the certificate before contract. On the Due Diligence tier this is the defining section — it appeared on 1 of 11 produced reports.',
    tiers: {
      compass: merged('riskDashboard'),
      briefing: merged('riskDashboard'),
      strategic: { depth: 'required', order: 15, label: 'Planning, Zoning and Title Due Diligence', producer: routed('dueDiligence', 13) },
    },
  },

  // ── Risk ─────────────────────────────────────────────────────────────────
  {
    id: 'riskDashboard',
    canonicalLabel: 'Risk Dashboard',
    provenance: 'measured',
    aliases: [
      'Risk Dashboard', 'Risk Summary', 'Risk Assessment', '7. Risk Assessment',
      'Risk Overview', 'Key Risks Before Proceeding', 'Risk & Macro Factors',
      'Financial Risk Dashboard', 'Property & Location Risk Dashboard',
    ],
    purpose: 'Every risk in one table with a level, why it matters and the check that would settle it. Protected under page pressure.',
    tiers: {
      compass: { depth: 'required', order: 10, label: 'Risk Dashboard', producer: authored('generator.compass') },
      briefing: { depth: 'required', order: 9, label: 'Risk Overview', producer: authored('condense.briefing') },
      financial: { depth: 'required', order: 13, label: 'Financial Risk Dashboard', producer: routed('financial', 11) },
      strategic: { depth: 'required', order: 18, label: 'Property & Location Risk Dashboard', producer: routed('dueDiligence', 17) },
    },
  },
  {
    id: 'environmentalRisk',
    canonicalLabel: 'Climate, Environmental, Insurance, Crime and Safety Risk',
    provenance: 'measured',
    aliases: [
      'Climate, Environmental, Insurance, Crime and Safety Risk',
      'Environmental Risks & Climate', 'Environmental Risks', 'Environmental Risk',
      'Crime & Safety', 'Crime Statistics', 'Crime Breakdown by Category',
      'Crime Profile Analysis', 'Crime Trends', 'Climate Profile',
      'Climate Risk Commentary', 'Extreme Weather Risk Assessment',
      'Crime, Climate & Environmental Risk Register',
    ],
    purpose: 'Flood, bushfire, heat, coastal and crime — each with its source, its measured level and its insurance consequence.',
    tiers: {
      compass: merged('riskDashboard'),
      briefing: merged('riskDashboard'),
      strategic: { depth: 'required', order: 19, label: 'Climate, Environmental, Insurance, Crime and Safety Risk', producer: routed('dueDiligence', 15) },
    },
  },
  {
    id: 'dueDiligenceChecklist',
    canonicalLabel: 'Due Diligence Checklist',
    provenance: 'recorded',
    aliases: ['Due Diligence Checklist', 'Due Diligence', 'Investment Recommendations'],
    purpose: 'What must be verified before contract, as a list somebody can work through.',
    tiers: {
      compass: { depth: 'required', order: 11, label: 'Due Diligence Checklist', producer: authored('generator.compass') },
      strategic: { depth: 'optional', order: 20, label: 'Due Diligence Checklist', producer: null },
    },
  },

  // ── The financial model ──────────────────────────────────────────────────
  // Every one of these is `composed` in the tiers that carry it as prose: typed
  // from `financial_calculations` through `reconcileStoredFinancials`, so a
  // chapter and a KPI tile cannot disagree about a number. Law 1.
  //
  // The Compass carries none of them — it is the location and property case,
  // and detailed modelling belongs to the Financial tier. That is a rule of the
  // Compass registry too, and both are now pinned to this one.
  {
    id: 'purchaseHolding',
    canonicalLabel: 'Purchase Costs & Annual Holding Cost Breakdown',
    provenance: 'computed',
    aliases: [
      'Purchase Costs & Annual Holding Cost Breakdown', 'Purchase & Ongoing Costs (Annual)',
      'Purchase & Ongoing Costs', 'Costs for Investors', '6. Costs for Investors',
    ],
    purpose: 'What it costs to buy and what it costs to hold, per year, from the recorded calculation.',
    tiers: {
      briefing: { depth: 'required', order: 11, label: 'Purchase Costs & Annual Holding Cost Breakdown', producer: composed(4) },
      financial: { depth: 'required', order: 6, label: 'Purchase Costs & Annual Holding Cost Breakdown', producer: composed(4) },
    },
  },
  {
    id: 'rentalYield',
    canonicalLabel: 'Rental Assessment, Gross Yield & Net Yield',
    provenance: 'computed',
    aliases: [
      'Rental Assessment, Gross Yield & Net Yield', 'Rental Assessment & Yield Calculation',
      'Gross & Net Yield Calculation',
    ],
    purpose: 'Rent, gross yield and net yield after the holding costs above.',
    tiers: {
      briefing: { depth: 'required', order: 12, label: 'Rental Assessment, Gross Yield & Net Yield', producer: composed(5) },
      financial: { depth: 'required', order: 7, label: 'Rental Assessment, Gross Yield & Net Yield', producer: composed(5) },
    },
  },
  {
    id: 'loan',
    canonicalLabel: 'Loan Structure, Repayments & Cashflow Impact',
    provenance: 'computed',
    aliases: [
      'Loan Structure, Repayments & Cashflow Impact', 'Loan Structure & Repayment Analysis',
      'Loan Analysis (P&I and Interest-Only)', 'LVR Projections', 'Cashflow Analysis',
      'Projected Loan-to-Value Ratio (LVR) - Year 10',
    ],
    purpose: 'Loan size, LVR, repayments on both structures, and the weekly position that falls out of them.',
    tiers: {
      briefing: { depth: 'required', order: 13, label: 'Loan Structure, Repayments & Cashflow Impact', producer: composed(6) },
      financial: { depth: 'required', order: 8, label: 'Loan Structure, Repayments & Cashflow Impact', producer: composed(6) },
    },
  },
  {
    id: 'sensitivity',
    canonicalLabel: 'Sensitivity & Scenario Testing',
    provenance: 'computed',
    aliases: [
      'Sensitivity & Scenario Testing', 'Sensitivity Analysis', 'Interest Rate Sensitivity',
      'Structural Cashflow Deficit',
    ],
    purpose: 'What a rate move or a rent move does to the position — the recorded grid, not a re-derivation.',
    tiers: {
      briefing: { depth: 'required', order: 14, label: 'Sensitivity & Scenario Testing', producer: composed(8) },
      financial: { depth: 'required', order: 10, label: 'Sensitivity & Scenario Testing', producer: composed(8) },
    },
  },
  {
    id: 'tenYear',
    canonicalLabel: '10-Year Cashflow, Equity & Growth Projection',
    provenance: 'computed',
    aliases: [
      '10-Year Cashflow, Equity & Growth Projection', '10-Year Investment Projections',
      '10-Year Projection Scenarios', '10. 10-Year Projection Scenarios',
      '10-Year Projection Commentary', 'Property Value Projections',
      'Rental Income Projections', 'Cumulative Cashflow Projections',
      'Capital Appreciation Potential', 'Leveraged Equity Accumulation',
      'Projection Assumptions',
    ],
    purpose: 'Value, rent, cashflow and equity year by year under the recorded scenarios.',
    tiers: {
      briefing: { depth: 'required', order: 15, label: '10-Year Cashflow, Equity & Growth Projection', producer: composed(9) },
      financial: { depth: 'required', order: 11, label: '10-Year Cashflow, Equity & Growth Projection', producer: composed(9) },
    },
  },
  {
    id: 'exitStrategy',
    canonicalLabel: 'Resale Liquidity & Exit Strategy',
    provenance: 'authored',
    aliases: ['Resale Liquidity & Exit Strategy', 'Equity & Exit Scenarios'],
    purpose: 'How quickly this sells, to whom, and what the exit looks like at year five and year ten.',
    tiers: {
      financial: { depth: 'optional', order: 12, label: 'Resale Liquidity & Exit Strategy', producer: routed('financial', 10) },
    },
  },
  {
    id: 'scorecard',
    canonicalLabel: 'Investment Score Breakdown',
    provenance: 'computed',
    aliases: [
      'Investment Score Breakdown', 'Investment Score Analysis', 'Score Breakdown',
      'Score Breakdown (simplified)', 'Overall Investment Score', '11. Overall Investment Score',
      'Macro Investment Scorecard', 'Financial Investment Scorecard',
      'Investment Score & SWOT', 'Investment Score & Hotspot Identification',
    ],
    purpose:
      'The score by dimension with its weights — every row a Computed figure, and a dimension with no data omitted rather than scored zero.',
    tiers: {
      compass: { depth: 'optional', order: 12, surface: 'document', producer: projection('recommendation.gradedDetailLine') },
      briefing: { depth: 'required', order: 16, label: 'Investment Score Breakdown', producer: composedFn('composeScoreBreakdownSection') },
      snapshot: { depth: 'required', order: 6, label: 'Score Breakdown', producer: authored('condense.snapshot') },
      financial: { depth: 'required', order: 14, label: 'Financial Investment Scorecard', producer: composed(12) },
    },
  },
  {
    id: 'swot',
    canonicalLabel: 'SWOT Analysis',
    provenance: 'computed',
    aliases: ['SWOT Analysis', 'SWOT Analysis Summary', 'Financial SWOT: Returns, Risk & Holding Capacity'],
    purpose: 'Strengths, weaknesses, opportunities and risks — typed from the stored score, never re-authored.',
    tiers: {
      briefing: { depth: 'required', order: 17, label: 'SWOT Analysis', producer: composedFn('composeSwotSection') },
      financial: { depth: 'required', order: 16, label: 'Financial SWOT: Returns, Risk & Holding Capacity', producer: composed(14) },
    },
  },
  {
    id: 'suitability',
    canonicalLabel: 'Investor Suitability Profile',
    provenance: 'authored',
    aliases: ['Investor Suitability Profile'],
    purpose: 'The investor this suits, and the one it does not — holding capacity, horizon and risk appetite.',
    tiers: {
      financial: { depth: 'optional', order: 15, label: 'Investor Suitability Profile', producer: routed('financial', 13) },
    },
  },

  // ── The close ────────────────────────────────────────────────────────────
  {
    id: 'opportunities',
    canonicalLabel: 'Top 3 Opportunities',
    provenance: 'authored',
    aliases: ['Top 3 Opportunities', 'Key Opportunities & Risks', '12. Key Opportunities & Risks'],
    purpose: 'The three things that could go better than the base case, each in a sentence or two.',
    tiers: {
      briefing: { depth: 'required', order: 18, label: 'Top 3 Opportunities', producer: authored('condense.briefing') },
      snapshot: { depth: 'required', order: 8, label: 'Top 3 Opportunities', producer: authored('condense.snapshot') },
    },
  },
  {
    id: 'risks',
    canonicalLabel: 'Top 3 Risks',
    provenance: 'authored',
    aliases: ['Top 3 Risks'],
    purpose: 'The three things most likely to go worse, each with what would show it early.',
    tiers: {
      briefing: { depth: 'required', order: 19, label: 'Top 3 Risks', producer: authored('condense.briefing') },
      snapshot: { depth: 'required', order: 9, label: 'Top 3 Risks', producer: authored('condense.snapshot') },
    },
  },
  {
    id: 'recommendation',
    canonicalLabel: 'Final Recommendation',
    provenance: 'authored',
    aliases: [
      'Final Recommendation', 'Final Conclusion', 'Recommendation', 'Quick Recommendation',
      'Financial Recommendation', 'Financial Recommendation & Portfolio Fit',
    ],
    purpose: 'The call, the rationale in a paragraph, and the immediate actions. Proceed / proceed with caution / not suitable.',
    tiers: {
      compass: { depth: 'required', order: 13, label: 'Final Recommendation', producer: authored('generator.compass') },
      briefing: { depth: 'required', order: 20, label: 'Recommendation', producer: authored('condense.briefing') },
      snapshot: { depth: 'required', order: 10, label: 'Quick Recommendation', producer: authored('condense.snapshot') },
      financial: { depth: 'required', order: 17, label: 'Financial Recommendation & Portfolio Fit', producer: routed('financial', 15) },
      strategic: { depth: 'optional', order: 21, label: 'Final Recommendation', producer: null },
    },
  },

  // ── Snapshot furniture ───────────────────────────────────────────────────
  {
    id: 'marketStats',
    canonicalLabel: 'Key Market Stats',
    provenance: 'measured',
    aliases: ['Key Market Stats', 'Key Highlights'],
    purpose:
      'A short metric table — median price, yield, vacancy, growth, days on market, walk score. Only metrics whose value is known: a labelled row is a promise that a figure follows it.',
    tiers: {
      snapshot: { depth: 'required', order: 4, label: 'Key Market Stats', producer: authored('condense.snapshot') },
    },
  },
  {
    id: 'financialSnapshot',
    canonicalLabel: 'Financial Snapshot',
    provenance: 'computed',
    aliases: ['Financial Snapshot'],
    purpose: 'Price, weekly rent, gross and net yield, annual cashflow and the ten-year value — from the recorded figures only.',
    tiers: {
      snapshot: { depth: 'required', order: 7, label: 'Financial Snapshot', producer: authored('condense.snapshot') },
    },
  },
];

// ─── The frozen gap list ────────────────────────────────────────────────────

/**
 * `tier:sectionId` pairs a tier promises and nothing yet produces.
 *
 * Keyed by tier and section the way `edge-missing-names.txt` is keyed by file
 * and identifier, and for the same reason: a count baseline absorbs a
 * regression as long as something else is fixed in the same commit. A NEW gap
 * fails the spec; closing one means deleting its line, so the list can only
 * shrink.
 *
 * It is empty — every `spine` and `required` placement names a producer that
 * resolves. That is a statement about the DECLARATION, and the corpus says
 * something separate and worse: the `routed` producers for the Due Diligence
 * tier's planning, tenant-demand, resale, infrastructure and supply sections
 * exist and are correct, and still put `Planning, Zoning and Title Due
 * Diligence` on 1 of 11 documents — because routing depends on the *parent*
 * carrying a heading the rule can match, and the Compass parent carries its
 * planning content merged inside Risk Dashboard. Phase 3 removes that
 * dependency by assembling from stored sections instead of re-reading a sibling
 * document; law 4 is the rule it is enforcing.
 */
export const PRODUCER_GAPS: readonly string[] = [];

// ─── Readers ────────────────────────────────────────────────────────────────

const byId = new Map<SectionId, SectionDefinition>(SECTION_REGISTRY.map((s) => [s.id, s]));

export function section(id: SectionId): SectionDefinition {
  const found = byId.get(id);
  // Unreachable from TypeScript; this catches a JavaScript caller.
  if (!found) throw new Error(`Unknown report section id: ${id}`);
  return found;
}

export interface PlacedSection {
  id: SectionId;
  definition: SectionDefinition;
  placement: TierPlacement;
  /** The heading this tier gives it, or the canonical label. */
  label: string;
  order: number;
  surface: Surface;
}

/**
 * Every section a tier draws — spine, required and optional — in tier order.
 *
 * Merged sections are absent: their substance is inside the section named by
 * `mergedInto`, and returning them would make a caller draw a heading the tier
 * deliberately does not have.
 */
export function sectionsForTier(tier: ReportTier): PlacedSection[] {
  return SECTION_REGISTRY.flatMap((definition) => {
    const placement = definition.tiers[tier];
    if (!placement || placement.depth === 'merged') return [];
    return [{
      id: definition.id,
      definition,
      placement,
      label: placement.label ?? definition.canonicalLabel,
      order: placement.order ?? 0,
      surface: placement.surface ?? 'markdown',
    }];
  }).sort((a, b) => a.order - b.order);
}

/**
 * The headings a tier's `report_content` may carry, in order.
 *
 * This is what `trimToDeclaredSections` is handed. Sections drawn by the
 * template (`surface: 'document'`) are excluded, because they never appear as a
 * `##` heading and listing them would make the trim keep prose the tier does
 * not want.
 */
export function markdownHeadingsForTier(tier: ReportTier): string[] {
  return sectionsForTier(tier).filter((s) => s.surface === 'markdown').map((s) => s.label);
}

/**
 * The subset of those a MODEL is expected to write.
 *
 * Separate from the whole list because the two behave differently under a trim:
 * the composed chapters are appended by us and therefore always match, so
 * "something survived the trim" is satisfied by our own output and says nothing
 * about whether the model followed the guide. A briefing whose prose was
 * entirely discarded is financial tables with no case attached to them, and
 * that is the state worth refusing to ship.
 */
export function authoredHeadingsForTier(tier: ReportTier): string[] {
  return sectionsForTier(tier)
    .filter((s) => s.surface === 'markdown' && s.placement.producer?.kind === 'authored')
    .map((s) => s.label);
}

/** The five spine sections, in tier order. Never empty, on any tier. */
export function spineForTier(tier: ReportTier): PlacedSection[] {
  return sectionsForTier(tier).filter((s) => s.placement.depth === 'spine');
}

/** Sections a tier folds into another, with the section that carries each. */
export function mergesForTier(tier: ReportTier): Array<{ id: SectionId; into: SectionId }> {
  return SECTION_REGISTRY.flatMap((definition) => {
    const placement = definition.tiers[tier];
    return placement?.depth === 'merged' && placement.mergedInto
      ? [{ id: definition.id, into: placement.mergedInto }]
      : [];
  });
}

/**
 * Strip a heading down to what identifies it.
 *
 * Case, a leading `N.` ordinal, a leading emoji and a trailing colon all vary
 * across the corpus for the same section — `1. Location Overview`, `⚖️
 * PROFESSIONAL DISCLAIMER` and `Market Commentary:` are the bare headings with
 * decoration — and every consumer that rolled its own normalisation counted
 * them separately.
 */
export function normaliseHeading(heading: string): string {
  return (heading || '')
    .replace(/^[^\p{Letter}\p{Number}]+/u, '')
    .replace(/^\d+(?:\.\d+)*[.)]\s*/, '')
    .replace(/\s*:\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const aliasIndex = new Map<string, SectionId>();
for (const definition of SECTION_REGISTRY) {
  const names = [definition.canonicalLabel, ...definition.aliases];
  for (const placement of Object.values(definition.tiers)) {
    if (placement.label) names.push(placement.label);
  }
  for (const name of names) {
    const key = normaliseHeading(name);
    // First declaration wins. Several sections legitimately share an alias —
    // `Investment Recommendations` is the Compass's due-diligence checklist and
    // reads as the briefing's recommendation — and silently reassigning it to
    // whichever section was declared last is how a routing table develops an
    // opinion nobody wrote down. Declaration order is the tie-break, and the
    // spec prints the collisions so they stay deliberate.
    if (key && !aliasIndex.has(key)) aliasIndex.set(key, definition.id);
  }
}

/** Which section a heading belongs to, or null. Exact match after normalisation. */
export function sectionIdForHeading(heading: string): SectionId | null {
  return aliasIndex.get(normaliseHeading(heading)) ?? null;
}

/** Every normalised heading the registry knows, with the section that owns it. */
export function knownHeadings(): ReadonlyMap<string, SectionId> {
  return aliasIndex;
}
