/**
 * SWOT, suitability, holding, exit and monitoring — composed from the record.
 *
 * ## The defect this exists to end
 *
 * Five pieces of content the brief calls for were each missing in a different
 * way, and three of them looked present.
 *
 * `sectionRegistry.pure.ts` already declares `swot`, `suitability` and
 * `exitStrategy`. But `swot`'s producer is `composeSwotSection`, which types
 * four lists off `investment_score`, and on the two subjects measured on
 * 18 Sep 2026 those lists hold — in total, across both properties — **two
 * strengths, three weaknesses, two opportunities and ZERO threats**:
 *
 * ```
 * 18 Annabelle Crescent   strengths []   weaknesses ["Below average rental
 *                         yield may require owner contribution",
 *                         "Measured demand in this market is soft"]
 * 262 Pallas Street       strengths ["Measured capital growth in this suburb
 *                         is strong"]
 * ```
 *
 * That is a V1 scoring artefact of one-line strings, and a SWOT drawn from it
 * is three bullets with an empty Threats heading. `suitability` and
 * `exitStrategy` are `depth: 'optional'` on the Financial tier alone with
 * `producer: routed(...)` — meaning a model writes them if it gets to them.
 * A **holding strategy** and a **monitoring plan** do not exist anywhere.
 *
 * Meanwhile the record holds a great deal that bears directly on all five and
 * that none of them reads: the market evidence table (median, one-, three-,
 * five- and ten-year growth, sales volume, each with its publisher and
 * period), the planning layer's answer with its own currency date, the
 * transport feeds' stop count and the two things they explicitly do not
 * measure, the financial engine's weekly position, the loan's structure and
 * whether its interest-only term was assumed, the score's dimensions and the
 * gaps that withheld its grade.
 *
 * So the five sections are composed from that, and every entry names the fact
 * it rests on.
 *
 * ## The rules
 *
 * 1. **No entry without a fact.** Every bullet is built from a value the
 *    record holds. There is no branch in this module that produces an entry
 *    from an absence, and none that produces one from a judgement.
 * 2. **An absence is coverage, never a quadrant entry.** A register that was
 *    not read contributes nothing to Strengths and nothing to Threats — it is
 *    named in the section's own coverage line. This is
 *    `infrastructureEvidence`'s rule (`docs/reports/PLANNING_CONTROLS_IN_THE_REPORT.md`
 *    §9) applied to a second surface: an absence may not be rated, and "no
 *    flood overlay was returned" is not a strength.
 * 3. **The modelling travels only where the tier carries it.** `finance` is
 *    null on the Compass and the Due Diligence report, and every entry that
 *    would state a yield, a weekly position, an LVR or an equity figure is
 *    then simply not produced — not softened, not rounded, not described in
 *    words. `TIER_FRAMEWORK.md` Decision E: withholding the modelling is not
 *    withholding the price.
 * 4. **Suitability states a REQUIREMENT, never a person.** What the asset
 *    demands of whoever holds it is a fact about the asset. Whether a
 *    particular investor meets it is not in this record — no personal
 *    circumstances are supplied to any report — so the section says what is
 *    required and says plainly that the match is not assessed here.
 * 5. **Liquidity is measured; equity is modelled.** How many dwellings of
 *    this kind sold in this market last quarter is a published fact. What the
 *    equity is at year five is an output of the projection under a recorded
 *    growth rate. They are different claims, they are labelled differently,
 *    and the second never appears where the modelling does not travel.
 * 6. **Monitoring names the register, its cadence and the reading that would
 *    change the conclusion** — and never promises that this platform will
 *    watch it. A review date is an instruction to a person.
 * 7. **A threshold nobody published may not produce a rating.** This is rule 2
 *    with the absence taken out of it, and it was learned here: the first
 *    version graded sales volume at 250 settled sales a quarter, a number
 *    invented in this file, and rendered against production it put "A thin
 *    market" in a client's Weaknesses column over 162 house sales in one
 *    quarter in one Sydney postcode. A count is stated; the reader grades it.
 *
 * Pure: no fetch, no Deno, no clock. Every date in the output is a date the
 * caller supplied from the record.
 */

import type { MarketFacts, MarketFactRow } from '../market/marketFactBlocks.pure.ts';
import type { EvidenceKey } from '../market/marketEvidence.pure.ts';
import type { SubjectPrice } from './subjectPrice.pure.ts';

// ─── What the sections rest on ──────────────────────────────────────────────

/** The financial engine's own figures. Null wherever the tier withholds the modelling. */
export interface StrategyFinance {
  /** `keyMetrics.grossRentalYield`, a percentage. */
  grossYield: number | null;
  /** `keyMetrics.netRentalYield`, a percentage. */
  netYield: number | null;
  /** `keyMetrics.weeklyNet` — negative means the owner contributes. */
  weeklyNet: number | null;
  /** `keyMetrics.annualNet`. */
  annualNet: number | null;
  /** `keyMetrics.lvr`, a percentage. */
  lvr: number | null;
  /** `keyMetrics.totalInvestment` — deposit plus acquisition costs. */
  upfront: number | null;
  /** `annualCosts.totalAnnual`. */
  annualCosts: number | null;
  /** `loanDetails.loanAmount`. */
  loanAmount: number | null;
  /** `loanDetails.interestRate`, a percentage. */
  interestRate: number | null;
  /** The sentence the ledger publishes for the loan. */
  loanStructure: string | null;
  /** `loanDetails.interestOnlyPeriod` in years — 0 is an explicit principal-and-interest answer. */
  interestOnlyYears: number | null;
  /** True where that term was assumed rather than recorded. */
  interestOnlyAssumed: boolean;
  /** `assumptions.capitalGrowth` — the rate the projection runs on. */
  capitalGrowth: number | null;
  /** `income.weeklyRent`. */
  weeklyRent: number | null;
  /** `keyMetrics.occupancyWeeks`. */
  occupancyWeeks: number | null;
}

/** What the planning layers answered for this property. */
export interface StrategyPlanning {
  /** The zone as the layer stated it, or null. */
  zone: string | null;
  /** `stated` | `not_served` | `none_at_point` | `not_integrated` | `licence_restricted` | `unavailable`. */
  zoneStatus: string | null;
  /** The publisher's own name for the layer. */
  zoneSource: string | null;
  /** The instrument's own currency date, as the publisher gave it. */
  zoneEffectiveDate: string | null;
  /** The council the cadastre resolved. */
  council: string | null;
  /** The sentence naming what actually settles the question. */
  verification: string | null;
  /** When this report retrieved it. */
  retrievedAt: string | null;
}

/** What the transport feeds answered. */
export interface StrategyTransport {
  /** `gtfs` where a loaded feed answered; anything else is a different source. */
  source: string | null;
  /** `stops_nearby` | `no_stops_within_radius` | `outside_loaded_networks` | null. */
  verdict: string | null;
  stopsWithin1km: number | null;
  /** Kilometres to the nearest stop. */
  nearestKm: number | null;
  nearestName: string | null;
  /** The things the feeds do not publish — carried verbatim. */
  notMeasured: string[];
}

/** The stored score, read for its grade, its gaps and its own four lists. */
export interface StrategyScore {
  grade: string | null;
  total: number | null;
  /** Reasons the grade was withheld or capped, as the scorer wrote them. */
  gaps: string[];
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  risks: string[];
}

/** The property's own recorded attributes. */
export interface StrategyProperty {
  address: string;
  propertyType: string | null;
  landSqm: number | null;
  councilArea: string | null;
  parking: number | null;
  bedrooms: number | null;
}

export interface StrategyRecord {
  property: StrategyProperty;
  price: SubjectPrice;
  market: MarketFacts;
  /** Null where this tier does not carry the analysis of a purchase. */
  finance: StrategyFinance | null;
  planning: StrategyPlanning;
  transport: StrategyTransport;
  score: StrategyScore;
}

// ─── Small shared writers ───────────────────────────────────────────────────

/*
 * Grouped by hand, never `toLocaleString`. `reportDesign/measure.pure.ts`
 * records why and a spec enforces it over every canonical investment module:
 * the same payload is formatted in Deno and in Node and their ICU builds need
 * not agree on grouping.
 */
const money = (n: number): string =>
  `$${String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const signedMoney = (n: number): string => (n < 0 ? `−${money(n)}` : money(n));
const pct = (n: number, dp = 1): string => `${n.toFixed(dp)}%`;
/*
 * "a 84% rise" — the article is decided by the SOUND of the first character,
 * and a percentage begins with a digit whose name may start with either. 8, 11
 * and 18 take "an"; every other leading digit takes "a".
 */
const article = (value: string): 'a' | 'an' => {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.startsWith('8')) return 'an';
  if (/^1[18]/.test(digits)) return 'an';
  return 'a';
};
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One entry: the claim, and the fact it rests on. Never one without the other. */
export interface PositionEntry {
  /** What a reader takes from it. */
  claim: string;
  /** The recorded figure or reading it is built from, with its provenance. */
  basis: string;
}

const writeEntries = (entries: PositionEntry[]): string[] =>
  entries.map((e) => `- **${e.claim}** ${e.basis}`);

/**
 * The market row for a measure, or null. Never a benchmark.
 *
 * `key` is typed `EvidenceKey` rather than `string` deliberately. The first
 * render of this module asked for `medianSalePrice`, `salesVolume`,
 * `rentalVacancy` and `auctionClearance` — four names the union does not
 * carry — and every one of them returned null in silence, so the SWOT drew no
 * median, the suitability profile no liquidity requirement and the monitoring
 * table no sale-price row, on a record that held all three. That is
 * `docs/aml/CASE_TENANT_COLUMN.md`'s rule in a different schema: **never name
 * a field the shape does not have**, and the way to make it impossible rather
 * than merely forbidden is to let the compiler read the union.
 */
function subjectRow(market: MarketFacts, key: EvidenceKey): MarketFactRow | null {
  return market.rows.find((r) => r.key === key && !r.benchmark) ?? null;
}

/** "the NSW Department of … median sale price of houses, postcode 2155, March 2026 quarter". */
function citeRow(row: MarketFactRow): string {
  return `${row.publisher} — ${row.describes}`;
}

// ─── 1. SWOT ────────────────────────────────────────────────────────────────

export interface Swot {
  strengths: PositionEntry[];
  weaknesses: PositionEntry[];
  opportunities: PositionEntry[];
  threats: PositionEntry[];
  /** Registers read and registers not read, so an empty quadrant is legible. */
  coverage: string[];
}

/**
 * Rule 1 and rule 2 in one function.
 *
 * Every push is guarded by the presence of the value it names. `coverage`
 * takes everything that could not be read — it is the only place an absence
 * appears, and it is prose rather than a quadrant.
 */
export function buildSwot(rec: StrategyRecord): Swot {
  const s: PositionEntry[] = [];
  const w: PositionEntry[] = [];
  const o: PositionEntry[] = [];
  const t: PositionEntry[] = [];
  const coverage: string[] = [];

  const g1 = subjectRow(rec.market, 'growth1Year');
  const g3 = subjectRow(rec.market, 'growth3YearCagr');
  const g5 = subjectRow(rec.market, 'growth5YearCagr');
  const g10 = subjectRow(rec.market, 'growth10YearCagr');
  const median = subjectRow(rec.market, 'medianPrice');
  const volume = subjectRow(rec.market, 'salesCount');

  // ── Market ──
  const longest = g10 ?? g5 ?? g3;
  if (longest && longest.value) {
    const horizon = longest === g10 ? 'ten years' : longest === g5 ? 'five years' : 'three years';
    s.push({
      claim: `Measured capital growth over ${horizon} of ${longest.value} a year.`,
      basis: `${citeRow(longest)}. It is a measurement of what this market did, not a forecast of what it will do.`,
    });
  }
  /*
   * The one-year rate against the longer-run average is NOT a quadrant entry.
   *
   * The first version put it in Opportunities when the latest year ran more
   * than two percentage points ahead and in Threats when it ran two behind —
   * and two points is a number invented in this file. It decided whether a
   * client read an opportunity, a threat or nothing at all, on a rendered
   * difference of 1.7 points for 262 Pallas Street. Rule 7: the comparison is
   * worth making and the verdict is not this module's to pronounce, so both
   * figures are stated together in the holding strategy, with no rating word
   * between them.
   */
  /*
   * Sales volume is deliberately NOT a quadrant entry.
   *
   * The first version of this module rated it: 250 settled sales or more was
   * "a liquid market", fewer was "a thin market". Nobody publishes that
   * threshold, and rendered against production it called 162 house sales in
   * one quarter in a single Sydney postcode "thin" — a verdict invented by
   * this file, carried into a client's Weaknesses column, sourced to a
   * register that says nothing of the kind.
   *
   * That is `docs/reports/PLANNING_CONTROLS_IN_THE_REPORT.md` §9's rule with
   * the absence taken out of it: **a threshold nobody published may not
   * produce a rating.** The volume is a fact and it is stated as one, in the
   * exit section, where a reader can judge it against a market they know.
   */
  if (median && median.value && rec.price.value !== null) {
    const m = Number(median.value.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(m) && m > 0) {
      const diff = rec.price.value - m;
      const share = Math.abs(diff) / m * 100;
      const side = diff < 0 ? 'below' : 'above';
      (diff < 0 ? o : w).push({
        // The label is a noun phrase that can end in a preposition ("…this
        // analysis is modelled on"), so it is quoted as a subject rather than
        // run straight into a verb: "The purchase price this analysis is
        // modelled on sits 18% below" is correct and reads as a mistake.
        claim: `At ${money(rec.price.value)}, the ${rec.price.basis === 'accepted_input' ? 'figure this analysis is modelled on' : 'price the listing recorded'} is ${pct(share, 0)} ${side} the market's median.`,
        basis: `${money(rec.price.value)} against ${median.value} — ${citeRow(median)}. `
          + 'A median is the middle of what sold across the whole geography and dwelling split named; it does not '
          + 'describe this dwelling, and the difference may be land size, condition, age or position rather than value.',
      });
    }
  }

  // ── Planning ──
  if (rec.planning.zoneStatus === 'stated' && rec.planning.zone) {
    s.push({
      claim: `The zone is on a published layer: ${rec.planning.zone}.`,
      basis: `${rec.planning.zoneSource ?? 'the jurisdiction planning layer'}`
        + (rec.planning.zoneEffectiveDate ? `, current at ${rec.planning.zoneEffectiveDate}` : '')
        + `. ${rec.planning.verification ?? ''}`.trimEnd(),
    });
  } else if (rec.planning.zoneStatus) {
    coverage.push(
      `The zone was **not read from a layer** for this property (${rec.planning.zoneStatus.replace(/_/g, ' ')})`
      + (rec.planning.council ? `, although the cadastre resolved the council as ${rec.planning.council}` : '')
      + '. Nothing here treats that as a finding either way.',
    );
  }

  // ── Transport ──
  if (rec.transport.verdict === 'stops_nearby' && isNum(rec.transport.stopsWithin1km) && rec.transport.stopsWithin1km > 0) {
    s.push({
      claim: `${rec.transport.stopsWithin1km} public transport stops within one kilometre`
        + (isNum(rec.transport.nearestKm) ? `, the nearest ${rec.transport.nearestKm} km away` : '')
        + '.',
      basis: (rec.transport.nearestName ? `Nearest stop: ${rec.transport.nearestName}. ` : '')
        + 'Counted from the operator\'s own published stop file. '
        + (rec.transport.notMeasured.length
          ? `Two things it does not settle — ${rec.transport.notMeasured.join(' ')}`
          : ''),
    });
  } else if (rec.transport.verdict === 'outside_loaded_networks') {
    coverage.push(
      'The property is **outside every transport network loaded on this platform**, which is a fact about the '
      + 'feeds rather than about the area. It is not evidence that the area is poorly served, and nothing in this '
      + 'section counts it either way.',
    );
  } else if (rec.transport.source && rec.transport.source !== 'gtfs') {
    coverage.push(
      `Public transport was read from \`${rec.transport.source}\` rather than an operator timetable feed, so stop `
      + 'counts here are not the operator\'s own and no conclusion is drawn from them.',
    );
  }

  // ── The modelling, where it travels ──
  const f = rec.finance;
  if (f) {
    if (isNum(f.grossYield) && isNum(f.netYield)) {
      const thin = f.grossYield < 3.5;
      (thin ? w : s).push({
        claim: thin
          ? `A thin income return: ${pct(f.grossYield, 2)} gross, ${pct(f.netYield, 2)} net.`
          : `An income return of ${pct(f.grossYield, 2)} gross, ${pct(f.netYield, 2)} net.`,
        basis: 'Computed from the recorded rent and the purchase price this analysis is modelled on, before finance '
          + 'and before tax. Net is unlevered — it carries the operating costs and not the loan.',
      });
    }
    if (isNum(f.weeklyNet) && f.weeklyNet < 0) {
      w.push({
        claim: `The position needs ${money(f.weeklyNet)} a week from the owner.`,
        basis: `${signedMoney(f.annualNet ?? f.weeklyNet * 52)} a year after operating costs and loan payments, at `
          + `${isNum(f.interestRate) ? pct(f.interestRate, 2) : 'the recorded rate'}`
          + `${f.loanStructure ? ` on ${f.loanStructure.charAt(0).toLowerCase()}${f.loanStructure.slice(1)}` : ''}. `
          + 'That is a cost of holding, met from income outside the property.',
      });
    } else if (isNum(f.weeklyNet) && f.weeklyNet >= 0) {
      s.push({
        claim: `The position covers itself: ${money(f.weeklyNet)} a week after costs and loan payments.`,
        basis: `${signedMoney(f.annualNet ?? f.weeklyNet * 52)} a year at `
          + `${isNum(f.interestRate) ? pct(f.interestRate, 2) : 'the recorded rate'}.`,
      });
    }
    if (f.interestOnlyAssumed && isNum(f.interestOnlyYears) && f.interestOnlyYears > 0) {
      t.push({
        claim: `The interest-only term is an assumption, not a recorded fact — ${f.interestOnlyYears} years.`,
        basis: 'The overrides named an interest-only product and not its term, so the ledger assumed the platform '
          + 'default and says so. When the term ends the payment steps up to principal and interest over the '
          + 'remaining years, and the real term is the one on the loan offer.',
      });
    }
    if (isNum(f.lvr) && f.lvr >= 80 && f.lvr < 100) {
      // One multiple, computed once. The first version wrote "five times" behind
      // a literal `=== '80%'` test and rendered "reaches equity  faster" at every
      // other ratio — a sentence with a hole where its only number should be.
      const gearing = 100 / (100 - f.lvr);
      t.push({
        claim: `At ${pct(f.lvr, 0)} lending, a fall in value reaches equity ${gearing.toFixed(gearing % 1 === 0 ? 0 : 1)} times faster than it reaches the market.`,
        basis: `${money(f.loanAmount ?? 0)} borrowed against ${money(rec.price.value ?? 0)} leaves ${pct(100 - f.lvr, 0)} `
          + `of the value as the owner's. A 10% fall in value is a ${pct(10 * gearing, 0)} fall in that share. `
          + 'This is arithmetic on the recorded loan, not a prediction about values.',
      });
    }
    if (isNum(f.capitalGrowth) && longest && longest.value) {
      const modelled = f.capitalGrowth;
      const measured = parseFloat(longest.value);
      if (Number.isFinite(measured) && Math.abs(modelled - measured) < 0.05) {
        o.push({
          claim: `The projection runs on the measured rate rather than an assumed one: ${pct(modelled, 1)} a year.`,
          basis: `${citeRow(longest)}. Past growth is the only growth anything here can measure; it is carried `
            + 'forward as a base case and is not a forecast.',
        });
      }
    }
  } else {
    coverage.push(
      'Yield, cash flow, lending and equity are **deliberately not in this section**. They are the subject of the '
      + 'Financial Analysis Report, and this document does not carry the analysis of a purchase.',
    );
  }

  // ── The score's own four lists, absorbed rather than replaced ──
  const fromScore = (x: string): PositionEntry =>
    ({ claim: /[.!?]$/.test(x.trim()) ? x.trim() : `${x.trim()}.`, basis: 'Recorded on the investment score for this report.' });
  for (const x of rec.score.strengths) s.push(fromScore(x));
  for (const x of rec.score.weaknesses) w.push(fromScore(x));
  for (const x of rec.score.opportunities) o.push(fromScore(x));
  for (const x of rec.score.risks) t.push(fromScore(x));

  // ── What was not held ──
  const notHeld = (['vacancyRate', 'daysOnMarket', 'medianRent', 'auctionClearanceRate', 'vendorDiscount'] as const)
    .filter((k) => !subjectRow(rec.market, k));
  if (notHeld.length) {
    coverage.push(
      'No published figure was held for vacancy, days on market, advertised rent, vendor discount or auction '
      + 'clearance in this market. Each would bear on the entries above; none is estimated, and their absence is '
      + 'not counted as a strength or a weakness.',
    );
  }
  if (rec.score.gaps.length) {
    coverage.push(
      `The investment score itself records ${rec.score.gaps.length === 1 ? 'a gap' : `${rec.score.gaps.length} gaps`}: `
      + `${rec.score.gaps.join('; ')}.`,
    );
  }

  return { strengths: s, weaknesses: w, opportunities: o, threats: t, coverage };
}

const QUADRANT_NOTE: Record<keyof Omit<Swot, 'coverage'>, string> = {
  strengths: 'Nothing the record holds reads as a strength. That is a statement about this record, not a verdict on the property.',
  weaknesses: 'Nothing the record holds reads as a weakness. That is a statement about this record, not a clearance.',
  opportunities: 'No opportunity is stated, because none is evidenced. An opportunity nobody measured is a hope.',
  threats: 'No threat is stated. Every threat below the line would have to come from a register, and the registers read for this property returned none — which is not the same as there being none.',
};

export function composeSwot(rec: StrategyRecord, heading: string): string {
  const swot = buildSwot(rec);
  const lines: string[] = [`## ${heading}`, ''];
  lines.push(
    'Each entry names the recorded figure or register reading it rests on. Nothing here is inferred from an '
    + 'absence: a measure nobody published, and a register nobody read, appear under *What this rests on* at the '
    + 'foot rather than in a quadrant.',
    '',
  );
  const groups: Array<[keyof Omit<Swot, 'coverage'>, string]> = [
    ['strengths', 'Strengths'],
    ['weaknesses', 'Weaknesses'],
    ['opportunities', 'Opportunities'],
    ['threats', 'Threats'],
  ];
  for (const [key, title] of groups) {
    lines.push(`### ${title}`, '');
    const entries = swot[key];
    if (entries.length) lines.push(...writeEntries(entries));
    else lines.push(`*${QUADRANT_NOTE[key]}*`);
    lines.push('');
  }
  if (swot.coverage.length) {
    lines.push('### What this rests on', '');
    for (const c of swot.coverage) lines.push(`- ${c}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// ─── 2. Investor suitability ────────────────────────────────────────────────

/**
 * Rule 4. Every line is a REQUIREMENT the asset imposes, drawn from a figure.
 * The last paragraph says the match is not assessed, because no report here is
 * given a person's circumstances and a document that implies otherwise is
 * advice nobody is licensed here to give.
 */
export function composeSuitability(rec: StrategyRecord, heading: string): string {
  const f = rec.finance;
  const lines: string[] = [`## ${heading}`, ''];
  lines.push(
    'What follows is what holding this asset **requires**, taken from the figures this report already carries. '
    + 'Whether a particular investor meets those requirements is not assessed here — no personal financial '
    + 'circumstances are supplied to this report, and none is assumed.',
    '',
  );

  const reqs: PositionEntry[] = [];
  if (f) {
    if (isNum(f.upfront)) {
      reqs.push({
        claim: `${money(f.upfront)} of capital at settlement.`,
        basis: 'Deposit plus the recorded acquisition costs — stamp duty, legal and the rest of the upfront schedule '
          + 'in the Financial Analysis Report.',
      });
    }
    if (isNum(f.weeklyNet) && f.weeklyNet < 0) {
      const annual = f.annualNet ?? f.weeklyNet * 52;
      reqs.push({
        claim: `${money(f.weeklyNet)} a week — ${money(annual)} a year — of income from outside the property.`,
        basis: 'The position after operating costs and loan payments at the recorded rate. It is met from salary or '
          + 'other income, every week, whether or not the property is tenanted that week.',
      });
      if (isNum(f.interestRate)) {
        // Sensitivity to the one input that moves fastest, stated as arithmetic.
        const perPointWeekly = isNum(f.loanAmount) ? (f.loanAmount * 0.01) / 52 : null;
        if (perPointWeekly !== null) {
          reqs.push({
            claim: `Room for the rate to move: each one percentage point adds ${money(perPointWeekly)} a week.`,
            basis: `${money(f.loanAmount!)} borrowed at ${pct(f.interestRate, 2)}. One point is `
              + `${money(f.loanAmount! * 0.01)} a year of additional interest while the balance is unchanged. `
              + 'This is arithmetic on the recorded loan, not a rate forecast.',
          });
        }
      }
    }
    if (isNum(f.occupancyWeeks) && isNum(f.weeklyRent)) {
      reqs.push({
        claim: `Tolerance for vacancy: every untenanted week costs ${money(f.weeklyRent)} of income and none of the costs.`,
        basis: `The projection assumes ${f.occupancyWeeks} occupied weeks a year. `
          + (f.occupancyWeeks >= 52
            ? 'That is full occupancy, which is an assumption rather than a measurement — no vacancy figure was '
              + 'published for this market, so none is applied.'
            : `The remaining ${52 - f.occupancyWeeks} weeks are already allowed for.`),
      });
    }
    if (f.interestOnlyAssumed && isNum(f.interestOnlyYears) && f.interestOnlyYears > 0 && isNum(f.loanAmount)) {
      reqs.push({
        claim: `Capacity for the step-up when the interest-only term ends in year ${f.interestOnlyYears}.`,
        basis: 'The payment moves from interest alone to principal and interest over the remaining years. The term '
          + 'itself was assumed rather than recorded — the loan offer settles it.',
      });
    }
  }

  const g10 = subjectRow(rec.market, 'growth10YearCagr');
  const g5 = subjectRow(rec.market, 'growth5YearCagr');
  const g3 = subjectRow(rec.market, 'growth3YearCagr');
  const longest = g10 ?? g5 ?? g3;
  if (longest) {
    const years = longest === g10 ? 10 : longest === g5 ? 5 : 3;
    reqs.push({
      claim: `A horizon at least as long as the evidence: ${years} years.`,
      basis: `${citeRow(longest)}. The measured rate is an average across that window and includes the periods `
        + 'inside it that went the other way. A hold shorter than the measurement is exposed to one of those periods '
        + 'rather than to the average.',
    });
  }
  const volume = subjectRow(rec.market, 'salesCount');
  if (volume?.value) {
    // Stated, never graded: how deep the market is, is the reader's judgement
    // against a market they know, and no threshold here is published anywhere.
    reqs.push({
      claim: 'Tolerance for however long an exit takes in a market of this depth.',
      basis: `${volume.value} comparable dwellings settled in the latest published quarter — ${citeRow(volume)}. `
        + 'A sale is agreed between two parties at a time neither fully controls; nothing in this record says how '
        + 'long one takes here, because days on market was not published for this market.',
    });
  }

  if (reqs.length) {
    lines.push('### What holding this asset requires', '');
    lines.push(...writeEntries(reqs));
    lines.push('');
  } else {
    lines.push(
      '*The record holds no figure from which a requirement can be stated. Nothing is inferred in its place.*',
      '',
    );
  }

  if (!f) {
    lines.push(
      '### What is not here', '',
      '- The capital, weekly contribution and rate sensitivity above are the subject of the **Financial Analysis '
      + 'Report** and are deliberately not restated in this document.',
      '',
    );
  }

  lines.push(
    '### The limits of this profile', '',
    '- This is a description of the asset, not a recommendation about a person. No income, tax position, existing '
    + 'portfolio, borrowing capacity, dependants, health or time horizon has been supplied to this report, and none '
    + 'is assumed.',
    '- Nothing above is personal advice, a credit assessment or a tax opinion. Those belong to a licensed adviser '
    + 'who has your circumstances in front of them.',
    '',
  );
  return lines.join('\n').trimEnd();
}

// ─── 3. Holding strategy ────────────────────────────────────────────────────

/**
 * What to DO across the hold, as against `suitability`'s what it DEMANDS.
 * Every item is an action with a date or a trigger the record can name.
 */
export function composeHoldingStrategy(rec: StrategyRecord, heading: string): string {
  const f = rec.finance;
  const lines: string[] = [`## ${heading}`, ''];
  lines.push(
    'The base case this report models, what has to stay true for it to hold, and the points at which a decision is '
    + 'actually owed. Each item names the figure or reading behind it.',
    '',
  );

  const holds: PositionEntry[] = [];
  const g1 = subjectRow(rec.market, 'growth1Year');
  const g10 = subjectRow(rec.market, 'growth10YearCagr');
  const g5 = subjectRow(rec.market, 'growth5YearCagr');
  const g3 = subjectRow(rec.market, 'growth3YearCagr');
  const longest = g10 ?? g5 ?? g3;

  if (f && isNum(f.capitalGrowth)) {
    holds.push({
      claim: `The base case grows value at ${pct(f.capitalGrowth, 1)} a year.`,
      basis: longest
        ? `Taken from ${citeRow(longest)} — the measured rate for this market over the longest window the register `
          + 'holds. It is carried forward unchanged, which is a modelling choice and not a forecast.'
        : 'Recorded on this report\'s assumptions.',
    });
  } else if (longest?.value) {
    holds.push({
      claim: `This market's measured growth over the longest published window is ${longest.value} a year.`,
      basis: `${citeRow(longest)}. What a projection does with that rate is the Financial Analysis Report's subject; `
        + 'the rate itself is a measurement of what this market did, and it is the thing that has to keep holding.',
    });
  }
  // The growth ladder, stated and not graded. Both figures, no verdict.
  if (g1?.value && (g3?.value || g5?.value)) {
    const longer = g3 ?? g5!;
    const years = longer === g3 ? 'three' : 'five';
    holds.push({
      claim: `The latest year and the ${years}-year average are ${g1.value} and ${longer.value}.`,
      basis: `Both from ${g1.publisher} for the same geography and dwelling split. They are stated side by side and `
        + 'not graded: no publisher sets the point at which a gap between them becomes a change of direction, and one '
        + 'period is one period either way.',
    });
  }
  if (f && isNum(f.weeklyNet) && f.weeklyNet < 0 && isNum(f.weeklyRent)) {
    // The break-even rent, stated as arithmetic on figures the record holds.
    const shortfall = Math.abs(f.weeklyNet);
    const breakEven = f.weeklyRent + shortfall;
    holds.push({
      claim: `The position turns cash-flow neutral at ${money(breakEven)} a week of rent, all else unchanged.`,
      basis: (() => {
        const rise = pct((shortfall / f.weeklyRent!) * 100, 0);
        return `${money(f.weeklyRent!)} is recorded now and the position is ${money(shortfall)} a week short, so that `
          + `is ${article(rise)} ${rise} rise in rent with costs and the rate held still. It is the point at which `
          + 'the property stops asking for a contribution, not a prediction that it reaches it.';
      })(),
    });
  }
  if (f && f.interestOnlyAssumed && isNum(f.interestOnlyYears) && f.interestOnlyYears > 0) {
    holds.push({
      claim: `Year ${f.interestOnlyYears} is a decision, not a milestone: the interest-only term ends.`,
      basis: 'Refinance, extend, or let it convert to principal and interest — each changes the weekly position. '
        + 'The term used here was assumed rather than recorded, so the first thing to confirm is the date on the '
        + 'loan offer itself.',
    });
  }
  if (f && isNum(f.lvr) && f.lvr >= 80) {
    holds.push({
      claim: `Lenders mortgage insurance and the ${pct(f.lvr, 0)} lending ratio are a refinance constraint, not just a settlement one.`,
      basis: 'Until value growth or principal repayment takes the ratio below the lender\'s threshold, refinancing '
        + 'and releasing equity are limited by it. The ratio moves with both value and balance.',
    });
  }
  if (rec.planning.zoneStatus === 'stated' && rec.planning.zone) {
    holds.push({
      claim: `The zone in force is ${rec.planning.zone}, and it can change.`,
      basis: `${rec.planning.zoneSource ?? 'the planning layer'}`
        + (rec.planning.zoneEffectiveDate ? `, current at ${rec.planning.zoneEffectiveDate}` : '')
        + '. A zone admits uses; it is not approval for any of them, and a planning proposal in this locality would '
        + 'change what the register says without anything happening on this lot.',
    });
  }

  if (holds.length) {
    lines.push('### The base case and what holds it', '');
    lines.push(...writeEntries(holds));
    lines.push('');
  }

  const breaks: string[] = [];
  if (f && isNum(f.weeklyNet) && f.weeklyNet < 0) {
    breaks.push('The weekly contribution stops being met from income outside the property. This is the one that '
      + 'forces a sale at a time not of the owner\'s choosing, and it is the first thing a buffer is for.');
  }
  if (f && isNum(f.interestRate) && isNum(f.loanAmount)) {
    breaks.push(`The rate moves materially from ${pct(f.interestRate, 2)}. Each percentage point is `
      + `${money(f.loanAmount * 0.01)} a year on the recorded balance.`);
  }
  if (longest) {
    breaks.push(`Measured growth for this market stops resembling ${longest.value} a year. The register behind that `
      + `figure (${longest.publisher}) republishes and can be re-read; the section below says when.`);
  }
  if (breaks.length) {
    lines.push('### What would break it', '');
    for (const b of breaks) lines.push(`- ${b}`);
    lines.push('');
  }

  if (!f) {
    lines.push(
      '*The loan structure, the weekly position and the equity path are the subject of the Financial Analysis '
      + 'Report and are not restated here.*',
      '',
    );
  }
  return lines.join('\n').trimEnd();
}

// ─── 4. Resale liquidity and exit ───────────────────────────────────────────

/**
 * Rule 5. `liquidity` is measured and travels everywhere; `equity` is modelled
 * and travels only with `finance`.
 */
export function composeExitOutlook(rec: StrategyRecord, heading: string): string {
  const f = rec.finance;
  const lines: string[] = [`## ${heading}`, ''];
  lines.push(
    'Two different questions, answered from two different kinds of evidence. **How easily this sells** is measured '
    + 'from a published register. **What the position looks like at a future year** is an output of this report\'s '
    + 'own projection under a recorded growth rate. The first is a fact; the second is a model.',
    '',
  );

  const liquidity: PositionEntry[] = [];
  const volume = subjectRow(rec.market, 'salesCount');
  const median = subjectRow(rec.market, 'medianPrice');
  const series = subjectRow(rec.market, 'priceSeries');
  if (volume?.value) {
    liquidity.push({
      claim: `${volume.value} comparable dwellings settled in the latest published quarter.`,
      basis: `${citeRow(volume)}. That is the depth of the buyer pool an exit would be tested against, at the `
        + 'geography and dwelling split named — not at this street. It is stated rather than graded: no publisher '
        + 'sets a threshold at which a market becomes liquid or thin, and this report does not invent one.',
    });
  }
  if (median?.value) {
    liquidity.push({
      claim: `The market's middle price is ${median.value}.`,
      basis: `${citeRow(median)}. Half of what sold went for less. A dwelling priced far from the middle is sold to a `
        + 'narrower pool, in either direction.',
    });
  }
  if (series?.value) {
    liquidity.push({
      claim: `The register holds ${series.value} of history for this market.`,
      basis: `${citeRow(series)}. A long series is what makes a growth rate a measurement rather than an impression, `
        + 'and it is re-read each time this report is produced.',
    });
  }
  if (rec.property.landSqm) {
    liquidity.push({
      claim: `The land is ${rec.property.landSqm} m².`,
      basis: 'Recorded on the property. Land size is one of the attributes a median cannot see, and it is among the '
        + 'first things a comparison against one has to account for.',
    });
  }

  if (liquidity.length) {
    lines.push('### Resale liquidity — measured', '');
    lines.push(...writeEntries(liquidity));
    lines.push('');
  } else {
    lines.push(
      '### Resale liquidity — measured', '',
      '*No sales volume, median or series was published for this market, so liquidity is not described. It is not '
      + 'estimated in their place.*',
      '',
    );
  }

  if (f && isNum(f.capitalGrowth) && rec.price.value !== null) {
    const p = rec.price.value;
    const rate = f.capitalGrowth / 100;
    const at = (y: number) => p * Math.pow(1 + rate, y);
    lines.push('### The modelled position — projection, not measurement', '');
    lines.push(
      `Value compounds from ${money(p)} at ${pct(f.capitalGrowth, 1)} a year, the rate recorded on this report's `
      + 'assumptions. Selling costs are not deducted; agent commission, marketing and legal costs all fall between '
      + 'these figures and a net result.',
      '',
      '| Year | Modelled value | Growth since settlement |',
      '|---|---|---|',
      `| 5 | ${money(at(5))} | ${money(at(5) - p)} |`,
      `| 10 | ${money(at(10))} | ${money(at(10) - p)} |`,
      '',
    );
    if (isNum(f.loanAmount)) {
      lines.push(
        `The loan balance at those years depends on the structure — ${f.loanStructure ?? 'as recorded'} — and the `
        + 'year-by-year balance is in the Financial Analysis Report\'s own ledger rather than recomputed here.',
        '',
      );
    }
    lines.push(
      '*Every figure in this table is a projection. It states what the recorded rate produces if it repeats, which '
      + 'no market is obliged to do, and it is not a valuation, an appraisal or a forecast.*',
      '',
    );
  } else if (!f) {
    lines.push(
      '### The modelled position', '',
      '*The equity path at year five and year ten is modelling, and belongs to the Financial Analysis Report. It is '
      + 'not restated here.*',
      '',
    );
  }
  return lines.join('\n').trimEnd();
}

// ─── 5. Monitoring and review ───────────────────────────────────────────────

/** One thing to re-check: the register, what it publishes, when, and what would change. */
export interface MonitorRow {
  what: string;
  register: string;
  cadence: string;
  lastRead: string;
  changesIf: string;
}

/**
 * Rule 6. Built from the registers this report actually read — nothing is
 * listed that the platform does not consult, and nothing here says the
 * platform will consult it on the reader's behalf.
 */
export function buildMonitorRows(rec: StrategyRecord): MonitorRow[] {
  const rows: MonitorRow[] = [];
  const median = subjectRow(rec.market, 'medianPrice');
  const g1 = subjectRow(rec.market, 'growth1Year');
  if (median) {
    rows.push({
      what: 'The market\'s median sale price and its growth',
      register: median.publisher,
      cadence: 'Quarterly, on the publisher\'s own schedule',
      lastRead: `${median.value ?? '—'} — ${median.describes}`,
      changesIf: 'A median that moves against the recorded trend for two consecutive quarters is the earliest signal '
        + 'this report\'s growth assumption has stopped describing the market.',
    });
  }
  if (g1 && g1 !== median) {
    rows.push({
      what: 'The one-year growth rate',
      register: g1.publisher,
      cadence: 'Quarterly, from the same series',
      lastRead: g1.value ?? '—',
      changesIf: 'It is the fastest-moving figure here and the noisiest. One quarter is not a signal; four are.',
    });
  }
  if (rec.planning.zoneStatus === 'stated') {
    rows.push({
      what: 'The planning control in force',
      register: rec.planning.zoneSource ?? 'the jurisdiction planning layer',
      cadence: 'On gazettal — no schedule; the layer carries its own currency date',
      lastRead: rec.planning.zoneEffectiveDate
        ? `current at ${rec.planning.zoneEffectiveDate}`
        : (rec.planning.retrievedAt ? `retrieved ${rec.planning.retrievedAt.slice(0, 10)}` : 'retrieved for this report'),
      changesIf: 'A planning proposal, a new overlay or an amended instrument changes what may be built here and '
        + 'nearby. A spatial layer is indicative — a planning certificate from the council is what settles it.',
    });
  } else {
    rows.push({
      what: 'The planning control in force',
      register: rec.planning.council ? `${rec.planning.council} council` : 'the council',
      cadence: 'On request',
      lastRead: 'No layer answered for this property',
      changesIf: 'This one is not a re-check but a first check: the control was never read from a register here, and '
        + 'a planning certificate is the way to obtain it.',
    });
  }
  if (rec.transport.verdict === 'stops_nearby') {
    rows.push({
      what: 'Public transport serving the property',
      register: 'The operator\'s published stop file',
      cadence: 'Each time the feed is reloaded on this platform',
      lastRead: isNum(rec.transport.stopsWithin1km) ? `${rec.transport.stopsWithin1km} stops within 1 km` : '—',
      changesIf: 'A stop count changes when the network changes. Service frequency and mode are not measured at all '
        + 'here, and a change in either would not show in this reading.',
    });
  }
  if (rec.finance && isNum(rec.finance.interestRate)) {
    rows.push({
      what: 'The interest rate on the loan',
      register: 'The lender\'s own schedule, and the RBA cash rate behind it',
      cadence: 'Monthly for the cash rate; on notice from the lender',
      lastRead: pct(rec.finance.interestRate, 2),
      changesIf: isNum(rec.finance.loanAmount)
        ? `Each percentage point is ${money(rec.finance.loanAmount * 0.01)} a year on the recorded balance.`
        : 'It moves the weekly position directly.',
    });
  }
  if (rec.finance && isNum(rec.finance.weeklyRent)) {
    rows.push({
      what: 'The rent actually achieved',
      register: 'The managing agent\'s statement',
      cadence: 'At each lease renewal, and monthly in the statement',
      lastRead: `${money(rec.finance.weeklyRent)} a week, recorded for this analysis`,
      changesIf: 'The gap between the recorded rent and the rent achieved is the single largest source of '
        + 'divergence between this report and the position an owner is actually in.',
    });
  }
  return rows;
}

export function composeMonitoringPlan(rec: StrategyRecord, heading: string): string {
  const rows = buildMonitorRows(rec);
  const lines: string[] = [`## ${heading}`, ''];
  lines.push(
    'A report is a reading taken on a day. Each row below is a thing that reading depends on, where it is published, '
    + 'how often it changes, and what a different answer would mean. **Nothing on this platform watches these on '
    + 'your behalf** — each is a check to make, or to ask an adviser to make.',
    '',
  );
  if (!rows.length) {
    lines.push('*No register answered for this property, so there is nothing here to re-read.*');
    return lines.join('\n').trimEnd();
  }
  lines.push(
    '| What to re-check | Where it is published | How often it changes | As read for this report | What a different answer would mean |',
    '|---|---|---|---|---|',
  );
  for (const r of rows) {
    lines.push(`| ${r.what} | ${r.register} | ${r.cadence} | ${r.lastRead} | ${r.changesIf} |`);
  }
  lines.push('');
  lines.push(
    'A sensible cadence follows the slowest thing on the list rather than the fastest: the sale-price registers '
    + 'republish quarterly, so a review more often than that re-reads the same numbers, and one less often than '
    + 'annually lets two publication cycles pass unexamined.',
    '',
  );
  return lines.join('\n').trimEnd();
}

// ─── The rules the prose beside these sections must obey ────────────────────

export function strategySectionRules(rec: StrategyRecord): string {
  const head = 'STRATEGY SECTION RULES — they apply to the SWOT, the suitability profile, the holding strategy, the '
    + 'exit outlook and the monitoring plan, and they override any example elsewhere in this prompt.';
  const lines = [
    head,
    '1. These five sections are COMPOSED from the record and are supplied to you complete. Do not rewrite them, do '
    + 'not restate their entries in prose elsewhere, and do not add an entry of your own to any quadrant or table.',
    '2. Every entry names the fact it rests on. If you refer to one of them in another section, carry that fact and '
    + 'its publisher with it.',
    '3. An absence is never a strength, a weakness, an opportunity or a threat. A register that was not read, and a '
    + 'measure nobody published, are recorded under "What this rests on" and must not be turned into a finding, a '
    + 'rating or a reassurance anywhere in the report.',
    '4. The suitability profile describes what the ASSET requires. It is not a statement about any person, and no '
    + 'section may convert it into one — no "this suits you", no "ideal for first-time investors", no personal '
    + 'advice, credit assessment or tax opinion.',
    '5. A modelled figure is never written as a measured one. The year-five and year-ten values are the projection\'s '
    + 'output under a recorded growth rate; say so wherever you use them, and never call one a valuation, an '
    + 'appraisal or a forecast.',
  ];
  if (!rec.finance) {
    lines.push(
      '6. This document does not carry the analysis of a purchase. Do NOT state a yield, a weekly or annual cash '
      + 'position, a loan amount, a lending ratio, a repayment or an equity figure in any section — they belong to '
      + 'the Financial Analysis Report, and the sections above deliberately omit them.',
    );
  }
  return lines.join('\n');
}

// ─── Reading a stored report row ────────────────────────────────────────────

/**
 * One reader, two callers.
 *
 * `generate-investment-report` composes the evidence half for the Compass from
 * the enrichment it is holding; `fork-investment-report` composes the
 * modelling half for the Financial report from the stored parent row. Both
 * need the same shapes out of the same JSONB, and a second copy of this
 * mapping is how the two documents come to disagree about what the record
 * says — the defect `_shared/reports/investment/loanLedger.pure.ts` records for
 * the loan and `captureObjectsFor` records for the capture plan.
 *
 * Every field is read defensively: a report row predating any of these columns
 * answers `null`, which every composer already handles.
 */
export interface StrategyRowInput {
  /** `investment_reports.property_address`. */
  propertyAddress?: unknown;
  /** `investment_reports.property_specs`. */
  propertySpecs?: unknown;
  /** `investment_reports.financial_calculations`. */
  financialCalculations?: unknown;
  /** `investment_reports.investment_score`. */
  investmentScore?: unknown;
  /** `investment_reports.data_sources` — for the planning reading. */
  dataSources?: unknown;
  /** `investment_reports.location_intelligence` — for the transport reading. */
  locationIntelligence?: unknown;
}

export interface StrategyRowOptions {
  /** The market evidence table this tier may state. */
  market: MarketFacts;
  /** The one recorded price, already named by its rung. */
  price: SubjectPrice;
  /**
   * False on a tier that does not carry the analysis of a purchase, which
   * makes `finance` null and every modelled entry simply not produced.
   */
  carriesModelling: boolean;
}

const rec = (v: unknown): Record<string, unknown> | null =>
  (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null);
const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
const text = (v: unknown): string | null =>
  (typeof v === 'string' && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map((x) => text(x)).filter((x): x is string => x !== null) : []);

export function readStrategyRecord(row: StrategyRowInput, opts: StrategyRowOptions): StrategyRecord {
  const specs = rec(row.propertySpecs) ?? {};
  const fin = rec(row.financialCalculations) ?? {};
  const metrics = rec(fin.keyMetrics) ?? {};
  const income = rec(fin.income) ?? {};
  const costs = rec(fin.annualCosts) ?? {};
  const loan = rec(fin.loanDetails) ?? {};
  const assumptions = rec(fin.assumptions) ?? {};
  const score = rec(row.investmentScore) ?? {};
  const planning = rec(rec(row.dataSources)?.planning) ?? {};
  const transport = rec(rec(row.locationIntelligence)?.transport) ?? {};

  const finance: StrategyFinance | null = opts.carriesModelling
    ? {
      grossYield: num(metrics.grossRentalYield),
      netYield: num(metrics.netRentalYield),
      weeklyNet: num(metrics.weeklyNet),
      annualNet: num(metrics.annualNet),
      lvr: num(metrics.lvr),
      upfront: num(metrics.totalInvestment),
      annualCosts: num(costs.totalAnnual),
      loanAmount: num(loan.loanAmount),
      interestRate: num(loan.interestRate),
      loanStructure: text(loan.structure),
      interestOnlyYears: num(loan.interestOnlyPeriod),
      // An ASSUMED term is a different statement from a recorded one, and the
      // ledger already publishes which it was. Never inferred from the number.
      interestOnlyAssumed: loan.interestOnlyPeriodAssumed === true,
      capitalGrowth: num(assumptions.capitalGrowth),
      weeklyRent: num(income.weeklyRent),
      occupancyWeeks: num(metrics.occupancyWeeks) ?? num(income.occupancyWeeks),
    }
    : null;

  return {
    property: {
      address: text(row.propertyAddress) ?? '',
      propertyType: text(specs.property_type),
      landSqm: num(specs.land_size_sqm),
      councilArea: text(specs.council_area),
      parking: num(specs.parking),
      bedrooms: num(specs.bedrooms),
    },
    price: opts.price,
    market: opts.market,
    finance,
    planning: {
      zone: text(planning.zone),
      zoneStatus: text(planning.zoneStatus),
      zoneSource: text(planning.zoneSource),
      zoneEffectiveDate: text(planning.zoneEffectiveDate),
      council: text(planning.council),
      verification: text(planning.verification),
      retrievedAt: text(planning.timestamp),
    },
    transport: {
      source: text(transport.source),
      verdict: text(transport.verdict),
      stopsWithin1km: num(transport.stopsWithin1km),
      nearestKm: num(transport.distanceToStation),
      nearestName: text(transport.nearestStation),
      notMeasured: strings(transport.notMeasured),
    },
    score: {
      grade: text(score.grade),
      total: num(score.totalScore),
      gaps: strings(score.gradeGaps).length
        ? strings(score.gradeGaps)
        : (Array.isArray(score.gradeGaps)
          ? (score.gradeGaps as unknown[]).flatMap((g) => {
            const o = rec(g);
            const reason = o ? (text(o.reason) ?? text(o.remedy) ?? text(o.dimension)) : null;
            return reason ? [reason] : [];
          })
          : []),
      strengths: strings(score.strengths),
      weaknesses: strings(score.weaknesses),
      opportunities: strings(score.opportunities),
      risks: strings(score.risks),
    },
  };
}

/** One composed section: the heading a tier gives it and the markdown under it. */
export interface StrategySection {
  id: 'swot' | 'suitability' | 'holdingStrategy' | 'exitStrategy' | 'monitoring';
  heading: string;
  markdown: string;
}

/**
 * Compose the sections a tier asks for, in the order given.
 *
 * The caller names the headings, because a tier's label is the registry's to
 * decide and this module has no business knowing that the Compass calls the
 * exit section "Resale Liquidity & Exit Outlook" and the Financial report
 * calls it "Resale Liquidity & Exit Strategy".
 */
export function composeStrategySections(
  record: StrategyRecord,
  wanted: ReadonlyArray<{ id: StrategySection['id']; heading: string }>,
): StrategySection[] {
  const composers: Record<StrategySection['id'], (r: StrategyRecord, h: string) => string> = {
    swot: composeSwot,
    suitability: composeSuitability,
    holdingStrategy: composeHoldingStrategy,
    exitStrategy: composeExitOutlook,
    monitoring: composeMonitoringPlan,
  };
  return wanted.map(({ id, heading }) => ({ id, heading, markdown: composers[id](record, heading) }));
}
