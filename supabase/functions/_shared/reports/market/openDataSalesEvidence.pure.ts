/**
 * The open-data sales register → market-evidence points.
 *
 * `market_sales_medians` holds a median sale price series per area and
 * dwelling type, loaded from two open publishers (`openData/qgsoRldaSales`,
 * `openData/nswDcjSales`). This is the one place a series becomes the points
 * the Growth scorer reads — `medianPrice`, `priceSeries`, `growth1Year`,
 * `growth3YearCagr`, `growth5YearCagr`, `growth10YearCagr`, `salesCount` and
 * the state-wide `benchmark*` counterparts — under the same arithmetic the
 * Domain adapter uses (`compoundAnnualGrowth`, a horizon computed only where
 * the same quarter exists that many years earlier, never a nearer quarter
 * called a five-year figure).
 *
 * What travels on every point, so a reader can defend it: the publisher's
 * grain (`level: 'lga'` for Queensland, `'postcode'` for New South Wales —
 * the scorer's confidence ladder prices each), the area under the
 * publisher's own label, whether the dwelling type matched the property
 * (a house scored on all-dwellings data is a weaker claim and is stamped
 * so), the quarter the sales settled in as `asOf`, the sales behind the
 * median as `sampleSize`, `licensingStatus: 'open'` and
 * `acquisition: 'open_public'` — the footing that makes a figure both
 * production evidence and printable to a client, which Domain's
 * `unverified` series is not.
 */
import type {
  EvidenceDwellingType,
  EvidenceKey,
  EvidencePoint,
  EvidenceProvider,
  EvidenceSubject,
  GeographicLevel,
  MarketEvidence,
} from './marketEvidence.pure.ts';
import { compoundAnnualGrowth } from './domainEvidence.pure.ts';
import {
  type SalesDwellingType,
  type SalesMedianRow,
  type SalesRegisterState,
  comparePeriods,
  dwellingWords,
  periodEndDate,
  periodLabel,
  periodYearsBefore,
} from './openData/salesRegister.pure.ts';
import { QGSO_RLDA_LICENCE, QGSO_RLDA_PAGE_URL, QGSO_RLDA_SOURCE_LABEL } from './openData/qgsoRldaSales.pure.ts';
import { NSW_DCJ_LICENCE, NSW_DCJ_PAGE_URL, NSW_DCJ_SOURCE_LABEL } from './openData/nswDcjSales.pure.ts';

export const OPEN_DATA_SALES_EVIDENCE_VERSION = '1.0.0';

export interface SalesRegisterSource {
  provider: EvidenceProvider;
  label: string;
  url: string;
  licence: string;
  /** The grain the publisher keys the register on for this state. */
  areaKind: 'lga' | 'postcode';
}

/** One source per state, and the grain each publishes at. */
export const SALES_REGISTER_SOURCES: Record<SalesRegisterState, SalesRegisterSource> = {
  QLD: { provider: 'qld_qgso_rlda', label: QGSO_RLDA_SOURCE_LABEL, url: QGSO_RLDA_PAGE_URL, licence: QGSO_RLDA_LICENCE, areaKind: 'lga' },
  NSW: { provider: 'nsw_dcj_rent_sales', label: NSW_DCJ_SOURCE_LABEL, url: NSW_DCJ_PAGE_URL, licence: NSW_DCJ_LICENCE, areaKind: 'postcode' },
};

/** Whether a state has an open register at all — the generator asks before reading. */
export function salesRegisterSourceFor(state: string | null | undefined): SalesRegisterSource | null {
  if (state === 'QLD' || state === 'NSW') return SALES_REGISTER_SOURCES[state];
  return null;
}

export interface OpenDataSalesInput {
  subject: EvidenceSubject;
  /** The engine's reading of the property's dwelling type. */
  askedDwelling: EvidenceDwellingType;
  areaKind: 'lga' | 'postcode';
  /** The publisher's own label for the area the rows describe. */
  area: string;
  /** Every row the register holds for that area, any dwelling type, any order. */
  rows: ReadonlyArray<SalesMedianRow>;
  /** The state-wide rows, for the benchmark points. Optional. */
  benchmarkRows?: ReadonlyArray<SalesMedianRow>;
  source: SalesRegisterSource;
}

export type OpenDataSalesPoints = Partial<Pick<MarketEvidence, EvidenceKey>>;

export interface OpenDataSalesResult {
  points: OpenDataSalesPoints;
  notes: string[];
  /** The dwelling series the points were drawn from, or null where none priced. */
  dwellingType: SalesDwellingType | null;
  dwellingTypeMatched: boolean;
  latestPeriod: string | null;
  pricedPeriods: number;
}

/** The order of dwelling series to try for what the engine asked. */
export function dwellingPreference(asked: EvidenceDwellingType): SalesDwellingType[] {
  switch (asked) {
    case 'house': return ['house', 'any'];
    case 'attached': return ['attached', 'any'];
    case 'any': return ['any', 'house', 'attached'];
    case 'land': return [];
  }
}

function pricedSeries(rows: ReadonlyArray<SalesMedianRow>, dwellingType: SalesDwellingType): SalesMedianRow[] {
  return rows
    .filter((r) => r.dwellingType === dwellingType && r.medianPrice !== null && r.medianPrice > 0)
    .sort((a, b) => comparePeriods(a.period, b.period));
}

function areaNameFor(areaKind: 'lga' | 'postcode', area: string, state: string | null): string {
  const st = state ? `, ${state}` : '';
  return areaKind === 'postcode' ? `postcode ${area}${st}` : `${area} local government area${st}`;
}

/**
 * Turn a register series into evidence points. Never throws: an area with
 * nothing priced answers empty points and a note, which the generator
 * records as the provider being unavailable for a stated reason.
 */
export function openDataSalesPoints(input: OpenDataSalesInput): OpenDataSalesResult {
  const notes: string[] = [];
  const points: OpenDataSalesPoints = {};
  const empty = (dwellingType: SalesDwellingType | null): OpenDataSalesResult =>
    ({ points, notes, dwellingType, dwellingTypeMatched: false, latestPeriod: null, pricedPeriods: 0 });

  if (input.askedDwelling === 'land') {
    notes.push('The register holds dwelling sales; land is not a dwelling.');
    return empty(null);
  }
  let chosen: SalesDwellingType | null = null;
  let series: SalesMedianRow[] = [];
  for (const candidate of dwellingPreference(input.askedDwelling)) {
    const s = pricedSeries(input.rows, candidate);
    if (s.length) { chosen = candidate; series = s; break; }
  }
  if (!chosen) {
    notes.push(`No priced quarter for ${input.area} in the register (every median suppressed or absent).`);
    return empty(null);
  }
  const matched = chosen === input.askedDwelling;
  if (!matched) notes.push(`${dwellingWords(input.askedDwelling)} not priced for ${input.area}; ${dwellingWords(chosen)} used instead.`);

  const level: GeographicLevel = input.areaKind === 'lga' ? 'lga' : 'postcode';
  const areaName = areaNameFor(input.areaKind, input.area, input.subject.state);
  const latest = series[series.length - 1];
  const sample = latest.salesCount;

  const point = <T>(value: T, method: 'observed' | 'calculated', sourceNote: string, sampleSize: number | null): EvidencePoint<T> => ({
    value,
    level,
    areaName,
    dwellingType: chosen as EvidenceDwellingType,
    dwellingTypeMatched: matched,
    provider: input.source.provider,
    asOf: periodEndDate(latest.period),
    sampleSize,
    periodsAvailable: series.length,
    method,
    licensingStatus: 'open',
    acquisition: 'open_public',
    sourceNote,
  });

  points.medianPrice = point(latest.medianPrice as number, 'observed',
    `${input.source.label}; median sale price of ${dwellingWords(chosen)}, ${areaName}, ${periodLabel(latest.period)}`, sample);

  if (series.length >= 2) {
    points.priceSeries = point(
      series.map((r) => ({ period: r.period, value: r.medianPrice as number })),
      'observed',
      `${input.source.label}; median sale price of ${dwellingWords(chosen)} by quarter, ${areaName}`,
      sample,
    );
  } else {
    notes.push('One priced quarter only; no series and no growth.');
  }

  const growth = (years: number, key: EvidenceKey): void => {
    const want = periodYearsBefore(latest.period, years);
    const prior = series.find((r) => r.period === want);
    if (!prior) { notes.push(`No priced quarter ${years} year${years === 1 ? '' : 's'} before ${periodLabel(latest.period)}; ${key} not computed.`); return; }
    const value = compoundAnnualGrowth(prior.medianPrice as number, latest.medianPrice as number, years);
    if (value === null) return;
    (points as Record<string, unknown>)[key] = point(value, 'calculated',
      `Compound annual growth of the median sale price of ${dwellingWords(chosen)}, ${areaName}, ${periodLabel(prior.period)} to ${periodLabel(latest.period)} (${input.source.label})`,
      sample);
  };
  growth(1, 'growth1Year');
  growth(3, 'growth3YearCagr');
  growth(5, 'growth5YearCagr');
  growth(10, 'growth10YearCagr');

  if (sample !== null) {
    points.salesCount = point(sample, 'observed',
      `${input.source.label}; ${dwellingWords(chosen)} sold in ${areaName}, ${periodLabel(latest.period)}`, sample);
  }

  // ---- Benchmarks: the state-wide series, coarser by construction.
  if (input.benchmarkRows?.length) {
    const bench = pricedSeries(input.benchmarkRows, chosen);
    const benchLatest = bench.find((r) => r.period === latest.period) ?? null;
    if (benchLatest) {
      const benchName = `${input.subject.state ?? 'the state'} (all areas the publisher monitors)`;
      const benchPoint = (value: number, method: 'observed' | 'calculated', sourceNote: string): EvidencePoint => ({
        value,
        level: 'state',
        areaName: benchName,
        dwellingType: chosen as EvidenceDwellingType,
        dwellingTypeMatched: matched,
        provider: input.source.provider,
        asOf: periodEndDate(benchLatest.period),
        sampleSize: benchLatest.salesCount,
        periodsAvailable: bench.length,
        method,
        licensingStatus: 'open',
        acquisition: 'open_public',
        sourceNote,
      });
      points.benchmarkMedianPrice = benchPoint(benchLatest.medianPrice as number, 'observed',
        `${input.source.label}; median sale price of ${dwellingWords(chosen)}, ${benchName}, ${periodLabel(benchLatest.period)}`);
      const benchGrowth = (years: number, key: 'benchmarkGrowth1Year' | 'benchmarkGrowth3YearCagr' | 'benchmarkGrowth5YearCagr'): void => {
        const prior = bench.find((r) => r.period === periodYearsBefore(benchLatest.period, years));
        if (!prior) return;
        const value = compoundAnnualGrowth(prior.medianPrice as number, benchLatest.medianPrice as number, years);
        if (value === null) return;
        points[key] = benchPoint(value, 'calculated',
          `Compound annual growth of the median sale price of ${dwellingWords(chosen)}, ${benchName}, ${periodLabel(prior.period)} to ${periodLabel(benchLatest.period)} (${input.source.label})`);
      };
      benchGrowth(1, 'benchmarkGrowth1Year');
      benchGrowth(3, 'benchmarkGrowth3YearCagr');
      benchGrowth(5, 'benchmarkGrowth5YearCagr');
    } else {
      notes.push(`No state-wide figure for ${periodLabel(latest.period)}; no benchmark.`);
    }
  }

  return { points, notes, dwellingType: chosen, dwellingTypeMatched: matched, latestPeriod: latest.period, pricedPeriods: series.length };
}
