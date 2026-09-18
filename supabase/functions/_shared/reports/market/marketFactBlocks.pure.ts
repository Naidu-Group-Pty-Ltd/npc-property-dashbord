/**
 * The market figures a report may state, and what each one rests on.
 *
 * ## The defect this exists to end
 *
 * `MarketEvidence` reached the SCORING SERVICE and nothing else. The generator
 * builds `marketPoints` from Domain and the open-data sales registers, posts
 * it to `investment-scoring-service`, and the grade comes back — and the model
 * that writes the market prose is handed none of it.
 *
 * So the prose supplies its own. On 18 Annabelle Crescent, Kellyville, the
 * document stated six market figures:
 *
 * > Kellyville house medians are consistently **reported** around the
 * > **high-$1.8m to ~$2.0m range**, with annual house price growth **called
 * > in** the **low single digits** …
 * >
 * > Recent data sets **report** **median house prices in the order of
 * > $1.96m**, **unit medians in the high-$700k to low-$800k range**, and
 * > **median weekly house rents around $900** …
 * >
 * > a price guide around **$1.55m** … That guide positions the property
 * > **below the prevailing Kellyville house median**
 *
 * `market_fact_snapshot` — the governed ledger this report was built on —
 * holds no median price, no median rent, no growth rate and no sale count for
 * that property. Not `absent` with a ruling: no such fact at all. The ledger
 * carries 27 ABS and RBA facts and not one market price.
 *
 * Note the grammar, because it is the tell and it is diagnosable: *is
 * consistently reported*, *data sets report*, *is called*. **An agentless
 * passive is what a sentence uses when it has no source to name.** A model
 * with a figure names where it came from; a model without one reaches for a
 * construction that does not require it.
 *
 * And the report's central valuation claim rests on two of them: a $1.55m
 * guide is "below the prevailing Kellyville house median" of $1.96m. Two
 * unsourced numbers, compared, in the Executive Verdict.
 *
 * ## The rules
 *
 * 1. **A market figure is stated only where the record holds it**, with the
 *    geography it describes, the dwelling split, the period and the
 *    publisher — the same standard the planning controls answer to.
 * 2. **An agentless attribution is not a source.** "Reported", "data sets
 *    show", "is generally around" and "market commentary suggests" name
 *    nobody, and a figure introduced that way has no provenance whatever it
 *    is.
 * 3. **A licence decides what a client may be shown.** `mayReachClientReport`
 *    is the gate, and it is applied HERE rather than trusted downstream:
 *    Domain's rights are `unverified` pending the follow-up, so its points
 *    score the grade and stay out of the client's document.
 * 4. **A benchmark never borrows the subject's authority, and the subject
 *    never borrows the benchmark's.** They are separate rows naming separate
 *    geographies, because a state figure printed beside a suburb one reads as
 *    the suburb's.
 * 5. **An absence is stated, and says which kind.** A provider that was asked
 *    and could not answer is named with its reason; a measure nothing
 *    published is listed as not held. Neither is an invitation to supply one.
 * 6. **Nothing here is a valuation.** A median describes a market, not this
 *    property. A comparison against one IS permitted in the prose and is
 *    useful — the defect was comparing two UNSOURCED figures, not comparing —
 *    provided the median's provenance travels with it and the sentence stops
 *    at the difference. What is never permitted is the verdict: "undervalued",
 *    "a bargain", or an equity or margin inferred from the gap.
 *
 * Pure: no fetch, no Deno, no clock.
 */

import {
  describePoint,
  EVIDENCE_KEYS,
  mayReachClientReport,
  presentPoints,
  type EvidenceKey,
  type EvidencePoint,
  type EvidenceProvider,
  type MarketEvidence,
} from './marketEvidence.pure.ts';

/** How each measure is named to a reader, and how its value is written. */
const MEASURE: Readonly<Record<EvidenceKey, { label: string; unit: 'money' | 'percent' | 'count' | 'days' | 'series' }>> = {
  medianPrice: { label: 'Median sale price', unit: 'money' },
  growth1Year: { label: 'Price growth, 1 year', unit: 'percent' },
  growth3YearCagr: { label: 'Price growth, 3 years (compound annual)', unit: 'percent' },
  growth5YearCagr: { label: 'Price growth, 5 years (compound annual)', unit: 'percent' },
  growth10YearCagr: { label: 'Price growth, 10 years (compound annual)', unit: 'percent' },
  priceSeries: { label: 'Median price series', unit: 'series' },
  salesCount: { label: 'Sales in the period', unit: 'count' },
  daysOnMarket: { label: 'Median days on market', unit: 'days' },
  vacancyRate: { label: 'Rental vacancy rate', unit: 'percent' },
  listingActivity: { label: 'Properties advertised', unit: 'count' },
  medianRent: { label: 'Median advertised weekly rent', unit: 'money' },
  vendorDiscount: { label: 'Vendor discount', unit: 'percent' },
  auctionClearanceRate: { label: 'Auction clearance rate', unit: 'percent' },
  benchmarkGrowth1Year: { label: 'Benchmark price growth, 1 year', unit: 'percent' },
  benchmarkGrowth3YearCagr: { label: 'Benchmark price growth, 3 years (compound annual)', unit: 'percent' },
  benchmarkGrowth5YearCagr: { label: 'Benchmark price growth, 5 years (compound annual)', unit: 'percent' },
  benchmarkMedianPrice: { label: 'Benchmark median sale price', unit: 'money' },
  populationGrowth: { label: 'Resident population growth (a driver, not growth)', unit: 'percent' },
};

/** Rule 4 — a benchmark is drawn apart, never in the subject's block. */
const IS_BENCHMARK = (key: EvidenceKey): boolean => key.startsWith('benchmark');

/** The publisher as a reader should see it, never the enum. */
const PROVIDER_LABEL: Readonly<Partial<Record<EvidenceProvider, string>>> = {
  domain: 'Domain',
  cotality: 'Cotality',
  proptrack: 'PropTrack',
  sqm_research: 'SQM Research',
  abs_res_dwell: 'Australian Bureau of Statistics — Residential Dwellings',
  abs_census: 'Australian Bureau of Statistics — Census',
  abs_erp: 'Australian Bureau of Statistics — Estimated Resident Population',
  nsw_valuer_general: 'NSW Valuer General',
  vic_property_sales: 'Victorian Property Sales Report',
  qld_titles: 'Queensland Titles Registry',
  sa_land_services: 'Land Services SA',
  qld_qgso_rlda: 'Queensland Government Statistician — Residential Land and Dwelling Activity',
  nsw_dcj_rent_sales: 'NSW Department of Communities and Justice — Rent and Sales Report',
};

const providerName = (p: EvidenceProvider): string => PROVIDER_LABEL[p] ?? p;

function writeValue(value: unknown, unit: (typeof MEASURE)[EvidenceKey]['unit']): string | null {
  if (unit === 'series') {
    return Array.isArray(value) && value.length
      ? `${value.length} periods, ${String((value[0] as { period?: unknown })?.period ?? '?')} to `
        + `${String((value[value.length - 1] as { period?: unknown })?.period ?? '?')}`
      : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  switch (unit) {
    case 'money': return `$${Math.round(value).toLocaleString('en-AU')}`;
    // One decimal, and the sign kept: a fall is a fact and "-2.1%" is what it
    // looks like. `toFixed` on a negative already carries it.
    case 'percent': return `${value.toFixed(1)}%`;
    case 'days': return `${Math.round(value).toLocaleString('en-AU')} days`;
    default: return Math.round(value).toLocaleString('en-AU');
  }
}

export interface MarketFactsInput {
  /** `enhancedData.marketEvidence` — what the adapters extracted, or absent. */
  marketEvidence?: unknown;
}

export interface MarketFactRow {
  key: EvidenceKey;
  label: string;
  /** The figure, written. Null where the value could not be written. */
  value: string | null;
  /** The geography, dwelling split, sample and period — `describePoint`. */
  describes: string;
  publisher: string;
  /** Anything a reader needs in order not to over-read it. */
  note: string | null;
  benchmark: boolean;
}

export interface MarketFacts {
  /** Measures a client's document may state. */
  rows: MarketFactRow[];
  /** Measures held but withheld from a client document, and why. */
  withheld: Array<{ label: string; publisher: string; reason: string }>;
  /** Providers asked that could not answer, with the reason each gave. */
  unavailable: Array<{ publisher: string; reason: string }>;
  /** Providers asked at all. */
  consulted: string[];
  /** True when at least one row may be stated. */
  anyStated: boolean;
  /** True when no evidence object was produced at all. */
  evidenceMissing: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function buildMarketFacts(input: MarketFactsInput): MarketFacts {
  const raw = isRecord(input.marketEvidence) ? input.marketEvidence : null;
  // The generator stores `{ points, providersConsulted, providersUnavailable }`;
  // a caller may equally hand the `MarketEvidence` itself. Both are read,
  // because a shape mismatch here fails exactly like an empty market.
  const points = isRecord(raw?.points) ? raw!.points : raw;
  if (!points) {
    return { rows: [], withheld: [], unavailable: [], consulted: [], anyStated: false, evidenceMissing: true };
  }
  const ev = { subject: {}, providersConsulted: [], providersUnavailable: [], ...points } as unknown as MarketEvidence;

  const rows: MarketFactRow[] = [];
  const withheld: MarketFacts['withheld'] = [];
  for (const { key, point } of presentPoints(ev)) {
    const measure = MEASURE[key];
    if (!measure) continue;
    const publisher = providerName(point.provider);
    // Rule 3, applied here rather than trusted downstream.
    if (!mayReachClientReport(point)) {
      withheld.push({
        label: measure.label,
        publisher,
        reason: 'the right to publish this measure in a client document is not confirmed',
      });
      continue;
    }
    const value = writeValue((point as EvidencePoint<unknown>).value, measure.unit);
    if (value === null) continue;
    rows.push({
      key,
      label: measure.label,
      value,
      describes: describePoint(point),
      publisher,
      note: point.sourceNote,
      benchmark: IS_BENCHMARK(key),
    });
  }

  const unavailable = Array.isArray(raw?.providersUnavailable)
    ? (raw!.providersUnavailable as unknown[]).flatMap((u) => (isRecord(u) && typeof u.provider === 'string'
      ? [{ publisher: providerName(u.provider as EvidenceProvider), reason: String(u.reason ?? 'no reason stated') }]
      : []))
    : [];
  const consulted = Array.isArray(raw?.providersConsulted)
    ? (raw!.providersConsulted as unknown[]).flatMap((p) => (typeof p === 'string' ? [providerName(p as EvidenceProvider)] : []))
    : [];

  return { rows, withheld, unavailable, consulted, anyStated: rows.length > 0, evidenceMissing: false };
}

// ---------------------------------------------------------------------------
// Rendering

/** The measures a report could carry, so an empty table reads as a short search. */
const NOT_HELD_LABELS = (facts: MarketFacts): string[] => {
  const have = new Set(facts.rows.map((r) => r.key));
  const withheldLabels = new Set(facts.withheld.map((w) => w.label));
  return EVIDENCE_KEYS
    .filter((k) => !have.has(k) && !IS_BENCHMARK(k) && k !== 'priceSeries' && k !== 'populationGrowth')
    .map((k) => MEASURE[k].label)
    .filter((l) => !withheldLabels.has(l));
};

/**
 * The market evidence a client reads.
 *
 * Composed here rather than asked of a model: every row is either measured or
 * absent, and neither is a writing task.
 */
export function renderMarketFacts(facts: MarketFacts): string {
  const lines: string[] = [];

  if (facts.rows.length) {
    lines.push('| Measure | Figure | What it describes | Published by |');
    lines.push('|---|---|---|---|');
    // Rule 4: the subject first, the benchmark under its own heading, so a
    // state figure beside a suburb one can never read as the suburb's.
    for (const r of facts.rows.filter((x) => !x.benchmark)) {
      lines.push(`| ${r.label} | ${r.value} | ${r.describes} | ${r.publisher} |`);
    }
    const marks = facts.rows.filter((x) => x.benchmark);
    if (marks.length) {
      lines.push('');
      lines.push('**The wider market these are judged against.** Each row below describes a DIFFERENT geography '
        + 'from the rows above, and states nothing about this suburb.');
      lines.push('');
      lines.push('| Measure | Figure | What it describes | Published by |');
      lines.push('|---|---|---|---|');
      for (const r of marks) lines.push(`| ${r.label} | ${r.value} | ${r.describes} | ${r.publisher} |`);
    }
    lines.push('');
    const notes = facts.rows.filter((r) => r.note);
    for (const r of notes) lines.push(`**${r.label}.** ${r.note}`);
    if (notes.length) lines.push('');
  }

  if (facts.evidenceMissing) {
    lines.push('**Not retrieved.** No market evidence was assembled for this property, so this report states no '
      + 'median price, rent, growth rate, vacancy rate or sale count. That is a statement about this run rather '
      + 'than about the market.');
    lines.push('');
    return lines.join('\n');
  }

  for (const w of facts.withheld) {
    lines.push(`**Held but not published.** ${w.label} was measured by ${w.publisher} and is not printed here: `
      + `${w.reason}. It is used to grade the property and is withheld from this document.`);
    lines.push('');
  }

  for (const u of facts.unavailable) {
    lines.push(`**Asked and could not answer.** ${u.publisher}: ${u.reason}`);
    lines.push('');
  }

  const notHeld = NOT_HELD_LABELS(facts);
  if (notHeld.length) {
    // Same reason as rule 4's separator: the labels are what the table prints
    // and the comma belongs in them, so the JOIN changes instead.
    lines.push(`**Not held for this market:** ${notHeld.join('; ').toLowerCase()}. No figure for any of these is `
      + 'stated anywhere in this report. A measure nobody published is not a market with none.');
    lines.push('');
  }

  lines.push('**What these are, and what they are not.** Each figure above describes a MARKET over a stated '
    + 'period, at the geography and dwelling split named beside it. None of them is a valuation of this '
    + 'property, an estimate of what it would sell for, or a forecast. A median is the middle of what sold; '
    + 'the property may sit anywhere relative to it for reasons no median carries.');

  return lines.join('\n');
}

/** The rules the prose beside the table must obey. */
export function marketFactRules(facts: MarketFacts): string {
  const head = 'MARKET FIGURE RULES FOR THE WHOLE REPORT — they apply in every section, including the executive '
    + 'verdict, risk registers, SWOT tables, checklists and summaries, and they override any example elsewhere '
    + 'in this prompt AND anything a live web search returns.';

  /*
   * Rule 2 in the words the model is handed, and it is the one that carries
   * the rest. Every figure in the Kellyville report arrived this way, and the
   * construction is the diagnosis: a sentence that has a source names it.
   */
  const noAgentless = 'An agentless attribution is NOT a source. Do not write that a figure "is reported", "is '
    + 'generally around", "is called", that "recent data sets report" it, that "market commentary suggests" it, '
    + 'or that it comes from "multiple sources" — those name nobody. Every market figure you state must name its '
    + 'publisher, the geography it describes and the period, exactly as the table gives them.';

  if (facts.evidenceMissing || !facts.anyStated) {
    return [
      `${head} No market figure was retrieved for this property.`,
      '1. Do NOT state a median sale price, a median rent, a price growth rate, a vacancy rate, a days-on-market '
      + 'figure, an auction clearance rate or a sales volume — not for the suburb, the postcode, the council or '
      + 'the state, and not from a live web search, a listing portal, a news article or your own knowledge. '
      + 'There is no figure here to state.',
      `2. ${noAgentless}`,
      '3. Say in one sentence that no market price or rent series was retrieved for this location and that the '
      + 'market discussion below is therefore qualitative. Then write it qualitatively — position, dwelling mix, '
      + 'demand drivers, what a buyer would compare — without a number.',
      '4. Do NOT compare the asking price or price guide against a median, a "prevailing" level or a "typical" '
      + 'figure. There is no median here, so any such comparison invents one.',
      '5. Do NOT rate, score or grade the market from the absence. A figure nobody retrieved is not evidence that '
      + 'the market is strong, weak, fair value or anything else.',
    ].join('\n');
  }

  const stated = facts.rows.filter((r) => !r.benchmark).map((r) => r.label);
  const marks = facts.rows.filter((r) => r.benchmark).map((r) => r.label);
  return [
    head,
    `1. The market evidence table above is supplied complete. Exactly these measures are held and may be stated: `
    + `${stated.join('; ') || 'none for this subject'}. Every other market figure is NOT held — do not state one, `
    + 'and do not supply one from a live web search, a listing portal, a news article or your own knowledge.',
    `2. ${noAgentless}`,
    '3. State each figure with the geography and dwelling split the table names beside it. A postcode figure is '
    + 'not the suburb’s, an "all dwelling types" figure is not the house figure, and a period is part of the '
    + 'fact rather than a footnote.',
    marks.length
      // Several of these labels carry a comma ("Price growth, 3 years …"),
      // so a comma-joined list of them reads as twice as many entries.
      ? `4. ${marks.join('; ')} ${marks.length === 1 ? 'describes' : 'describe'} a DIFFERENT geography and `
        + `${marks.length === 1 ? 'is' : 'are'} a benchmark. Name that geography whenever you use one, and `
        + 'never present it as this suburb’s figure or let it stand in for one that is missing.'
      : '4. No benchmark is held, so do not compare this market against a wider one by supplying a figure for it.',
    '5. A median is the middle of what sold; it is not a valuation of this property and not a forecast. You MAY '
    + 'say how the subject\u2019s recorded price sits against a median in this table, with that median\u2019s '
    + 'publisher, geography, dwelling split and period beside it — that is useful and the reader needs it. What '
    + 'you may NOT do is turn the gap into a verdict: no "undervalued", "a bargain", "priced below its worth", '
    + '"good buying" or "cheap", and no equity, instant gain or margin inferred from it. Say what the '
    + 'difference is and what a median cannot see — land size, condition, age, position, and the spread it '
    + 'hides.',
    '6. Where the table says a measure is not held, say so if the subject comes up rather than supplying one, and '
    + 'do not rate or score the market from its absence.',
  ].join('\n');
}
