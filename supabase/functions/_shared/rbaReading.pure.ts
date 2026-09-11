/**
 * The macro-economic reading served to reports, composed from stored RBA
 * statistical-table observations (`rba_observations` / `rba_series_meta`,
 * loaded by rba-tables-ingest) — replacing a path that asked a search model
 * for "exact current values" and coerced whatever came back with `|| 0`.
 *
 * Rules:
 *  - **Every figure carries its own reference period**, read from the
 *    observation's date — "4.35% (monthly average, August 2026)" — because
 *    freshness of a load is not currency of the data.
 *  - **The cash-rate month is a monthly average, never a decision date.**
 *    F1.1's own Description row says "Cash Rate Target; monthly average";
 *    the old path invented `lastDecisionDate` (defaulting to *today*). The
 *    honest derivable fact is the month the monthly average last moved,
 *    which is arithmetic on the series and is labelled as exactly that.
 *  - **Absent is absent**: a series with no stored observation contributes
 *    no figure, and nothing here fills a gap with a plausible number. GDP,
 *    unemployment and participation are not in these tables and are
 *    deliberately not in this reading.
 *  - **A projection is an assumption and says so.** The 10-year CPI path
 *    the financial engine indexes against converges from the measured
 *    year-ended CPI toward the RBA target midpoint; every year's `source`
 *    names it an assumption. The old labels claimed "RBA SMP forecast" for
 *    numbers no one had read from any forecast.
 */

export interface RbaMetaRow {
  series_id: string;
  table_code: string;
  title: string | null;
  description: string | null;
  units: string | null;
  publication_date: string | null;
}

export interface RbaObsRow {
  series_id: string;
  /** ISO date (YYYY-MM-DD). */
  obs_date: string;
  value: number;
}

/** A measured figure with its own reference period. */
export interface MacroFigure {
  value: number;
  /** '2026-08' for monthly series, '2026-06' (quarter-end month) for quarterly. */
  period: string;
  /** 'August 2026' / 'June quarter 2026' — for prose and table cells. */
  periodLabel: string;
}

/**
 * The cash rate target in force, and the day it took effect.
 *
 * This is a DIFFERENT FACT from `cashRate` below, and the difference is the
 * whole reason this exists. `cashRate` is F1.1's `FIRMMCRT` — "Cash Rate
 * Target; monthly average" — so in a month containing a Board change it is
 * an average of two targets and equals neither (4.31, 3.96, 3.83 and 3.70 all
 * appear in the series, and no Board ever set them). Presenting it as "the
 * current cash rate" states a number the RBA never announced.
 *
 * `cashRateTarget` is F1's `FIRMMCRTD` — the target ON A DATE — paired with
 * `FIRMMCCRT`, the RBA's own "as announced" change column. The effective date
 * is therefore read from the publisher, never inferred by differencing values.
 */
export interface CashRateTarget {
  /** Per cent, as announced. */
  percent: number;
  /** ISO date the current target took effect (the RBA's own announcement). */
  effectiveDate: string;
  /** '6 May 2026' — for prose. */
  effectiveLabel: string;
  /** The latest date the file carries a target for: it is still in force as at this date. */
  asAtDate: string;
  /** '10 September 2026' — the same date, said the way a report says it. */
  asAtLabel: string;
  /** Percentage points of the announced change that set this target. */
  changePoints: number;
  seriesId: string;
  tableCode: string;
  /** The series' own Description, verbatim ("Cash Rate Target on date"). */
  basis: string;
  publicationDate: string | null;
  source: string;
}

export interface MacroReading {
  /** In-force target with its effective date, or null when F1 is not loaded. */
  cashRateTarget: CashRateTarget | null;
  cashRate: {
    current: MacroFigure;
    /** The series' own Description ("Cash Rate Target; monthly average"). */
    basis: string;
    /** The month the monthly average last moved — arithmetic, not a board date. */
    lastMove: { periodLabel: string; from: number; to: number } | null;
    publicationDate: string | null;
    source: string;
  } | null;
  inflation: {
    yearEnded: MacroFigure | null;
    trimmedMeanYearEnded: MacroFigure | null;
    quarterly: MacroFigure | null;
    index: (MacroFigure & { base: string }) | null;
    /** The RBA's published medium-term target — a fact about the target, not a reading. */
    targetBand: string;
    publicationDate: string | null;
    source: string;
  } | null;
  lendingRates: {
    ownerOccupier: {
      standardVariable: MacroFigure | null;
      discountedVariable: MacroFigure | null;
      threeYearFixed: MacroFigure | null;
    };
    investor: {
      standardVariable: MacroFigure | null;
      discountedVariable: MacroFigure | null;
      threeYearFixed: MacroFigure | null;
    };
    basis: string;
    publicationDate: string | null;
    source: string;
  } | null;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** 'August 2026' from a monthly observation's date. */
export function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** 'June quarter 2026' from a quarter-end observation's date (ABS wording). */
export function quarterLabel(isoDate: string): string {
  return `${monthLabel(isoDate).replace(' ', ' quarter ')}`;
}

const period = (isoDate: string): string => isoDate.slice(0, 7);

function latestOf(obs: RbaObsRow[], seriesId: string): RbaObsRow | null {
  let best: RbaObsRow | null = null;
  for (const o of obs) {
    if (o.series_id !== seriesId) continue;
    if (!Number.isFinite(o.value)) continue;
    if (!best || o.obs_date > best.obs_date) best = o;
  }
  return best;
}

const monthly = (obs: RbaObsRow[], id: string): MacroFigure | null => {
  const o = latestOf(obs, id);
  return o ? { value: o.value, period: period(o.obs_date), periodLabel: monthLabel(o.obs_date) } : null;
};

const quarterly = (obs: RbaObsRow[], id: string): MacroFigure | null => {
  const o = latestOf(obs, id);
  return o ? { value: o.value, period: period(o.obs_date), periodLabel: quarterLabel(o.obs_date) } : null;
};

/**
 * The month the series' value last differed from the month before it —
 * found by walking the ordered series, never asserted from anywhere else.
 * Null when the series never moves in the window supplied.
 */
export function lastMoveOf(obs: RbaObsRow[], seriesId: string): { periodLabel: string; from: number; to: number } | null {
  const series = obs
    .filter((o) => o.series_id === seriesId && Number.isFinite(o.value))
    .sort((a, b) => (a.obs_date < b.obs_date ? -1 : 1));
  for (let i = series.length - 1; i >= 1; i--) {
    if (series[i].value !== series[i - 1].value) {
      return { periodLabel: monthLabel(series[i].obs_date), from: series[i - 1].value, to: series[i].value };
    }
  }
  return null;
}

const metaOf = (meta: RbaMetaRow[], id: string): RbaMetaRow | null =>
  meta.find((m) => m.series_id === id) ?? null;

/** '6 May 2026' from an ISO date — the effective date said the way a person says it. */
export function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  const month = MONTHS[Number(m) - 1];
  if (!month) return isoDate;
  return `${Number(d)} ${month} ${y}`;
}

/**
 * The cash rate target in force, read from F1 rather than inferred.
 *
 * Fails CLOSED — returns null — rather than answering approximately, because
 * the caller's alternative is F1.1's monthly average and presenting that as
 * the current target is precisely the defect this exists to close. Null on
 * any of: F1 not loaded, no target observations, no announced change in the
 * window, or the target on the effective date disagreeing with the target on
 * the latest date. That last one is the important one: it means the change
 * column and the level column no longer describe the same step, and a
 * disagreement between two columns of one file is never something to average.
 */
export function cashRateTargetOf(meta: RbaMetaRow[], obs: RbaObsRow[]): CashRateTarget | null {
  const targets = obs
    .filter((o) => o.series_id === 'FIRMMCRTD' && Number.isFinite(o.value))
    .sort((a, b) => (a.obs_date < b.obs_date ? -1 : 1));
  const changes = obs
    .filter((o) => o.series_id === 'FIRMMCCRT' && Number.isFinite(o.value))
    .sort((a, b) => (a.obs_date < b.obs_date ? -1 : 1));
  if (targets.length === 0 || changes.length === 0) return null;

  const latest = targets[targets.length - 1];
  // The most recent announced change at or before the latest target we hold.
  let effective: RbaObsRow | null = null;
  for (let i = changes.length - 1; i >= 0; i--) {
    if (changes[i].obs_date <= latest.obs_date) { effective = changes[i]; break; }
  }
  if (!effective) return null;

  const atEffective = targets.find((o) => o.obs_date === effective!.obs_date);
  if (!atEffective || atEffective.value !== latest.value) return null;

  const targetMeta = metaOf(meta, 'FIRMMCRTD');
  return {
    percent: latest.value,
    effectiveDate: effective.obs_date,
    effectiveLabel: dayLabel(effective.obs_date),
    asAtDate: latest.obs_date,
    asAtLabel: dayLabel(latest.obs_date),
    changePoints: effective.value,
    seriesId: 'FIRMMCRTD',
    tableCode: 'f1',
    basis: targetMeta?.description ?? 'Cash Rate Target on date',
    publicationDate: targetMeta?.publication_date ?? null,
    source: 'RBA statistical table F1',
  };
}

/**
 * Compose the reading. Null only when nothing at all is loaded; otherwise
 * each component is present exactly where its series holds observations.
 */
export function buildMacroReading(meta: RbaMetaRow[], obs: RbaObsRow[]): MacroReading | null {
  const cash = monthly(obs, 'FIRMMCRT');
  const cashMeta = metaOf(meta, 'FIRMMCRT');

  const yearEnded = quarterly(obs, 'GCPIAGYP');
  const trimmed = quarterly(obs, 'GCPIOCPMTMYP');
  const qtr = quarterly(obs, 'GCPIAGSAQP');
  const indexFig = quarterly(obs, 'GCPIAG');
  const indexMeta = metaOf(meta, 'GCPIAG');
  const g1Meta = metaOf(meta, 'GCPIAGYP') ?? indexMeta;

  const ooStd = monthly(obs, 'FILRHLBVS');
  const ooDisc = monthly(obs, 'FILRHLBVD');
  const ooFixed = monthly(obs, 'FILRHL3YF');
  const invStd = monthly(obs, 'FILRHLBVSI');
  const invDisc = monthly(obs, 'FILRHLBVDI');
  const invFixed = monthly(obs, 'FILRHL3YFI');
  const f5Meta = metaOf(meta, 'FILRHLBVS');

  const cashRateTarget = cashRateTargetOf(meta, obs);

  const cashRate = cash
    ? {
      current: cash,
      basis: cashMeta?.description ?? 'Cash Rate Target; monthly average',
      lastMove: lastMoveOf(obs, 'FIRMMCRT'),
      publicationDate: cashMeta?.publication_date ?? null,
      source: 'RBA statistical table F1.1',
    }
    : null;

  const inflation = (yearEnded || trimmed || qtr || indexFig)
    ? {
      yearEnded,
      trimmedMeanYearEnded: trimmed,
      quarterly: qtr,
      index: indexFig && indexMeta?.units ? { ...indexFig, base: indexMeta.units } : null,
      targetBand: '2–3 per cent',
      publicationDate: g1Meta?.publication_date ?? null,
      source: 'RBA statistical table G1 (ABS Consumer Price Index)',
    }
    : null;

  const anyLending = ooStd || ooDisc || ooFixed || invStd || invDisc || invFixed;
  const lendingRates = anyLending
    ? {
      ownerOccupier: { standardVariable: ooStd, discountedVariable: ooDisc, threeYearFixed: ooFixed },
      investor: { standardVariable: invStd, discountedVariable: invDisc, threeYearFixed: invFixed },
      basis: 'Banks’ indicator housing lending rates',
      publicationDate: f5Meta?.publication_date ?? null,
      source: 'RBA statistical table F5',
    }
    : null;

  if (!cashRateTarget && !cashRate && !inflation && !lendingRates) return null;
  return { cashRateTarget, cashRate, inflation, lendingRates };
}

// ---------------------------------------------------------------------------
// The 10-year CPI path the financial engine indexes against
// ---------------------------------------------------------------------------

export interface CpiProjectionYear {
  year: number;
  cpiPercent: number;
  source: string;
}

export const RBA_TARGET_MIDPOINT = 2.5;

/**
 * A named assumption, not a forecast: converge from the measured year-ended
 * CPI toward the RBA target midpoint (the same arithmetic the old path used
 * as its silent fallback — kept because it is a reasonable indexation
 * assumption, and now labelled as one on every year). With no measured CPI
 * the path is flat at the target midpoint and says that too.
 */
export function cpiProjectionsFromMeasured(measured: MacroFigure | null): CpiProjectionYear[] {
  const years = Array.from({ length: 10 }, (_, i) => i + 1);
  if (!measured) {
    return years.map((year) => ({
      year,
      cpiPercent: RBA_TARGET_MIDPOINT,
      source: 'Assumption — RBA inflation target midpoint of 2.5% (no measured CPI reading was available)',
    }));
  }
  const label =
    `Assumption — convergence from measured year-ended CPI (${measured.value}%, ${measured.periodLabel}) toward the RBA inflation target midpoint of 2.5%`;
  return years.map((year) => {
    const convergence = 1 - Math.pow(0.8, year);
    const projected = measured.value + (RBA_TARGET_MIDPOINT - measured.value) * convergence;
    return { year, cpiPercent: Math.round(projected * 10) / 10, source: label };
  });
}
