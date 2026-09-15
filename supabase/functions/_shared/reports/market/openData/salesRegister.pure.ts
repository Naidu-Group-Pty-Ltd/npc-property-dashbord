/**
 * The open-data sales register — the vocabulary its loaders write and the
 * evidence adapter reads.
 *
 * ## Why this exists
 *
 * The Investment Grade requires a capital-growth reading before a letter is
 * printed (`SCORING_V2_ACTIVATION.requiredDimensions`), and the only wired
 * source of one was Domain's suburb-performance series behind a package the
 * key's project does not carry. Two state publishers put a median sale price
 * series on the open web under CC BY 4.0, reachable from this project's own
 * egress (measured 15 Sep 2026, `docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md`):
 *
 *  - **Queensland** — the Government Statistician's residential land
 *    development activity spreadsheet: median price and number of detached
 *    and attached dwelling sales, quarterly since June 2008, for every
 *    monitored local government area (Queensland Valuation and Sales data).
 *  - **New South Wales** — the Department of Communities and Justice Rent and
 *    Sales Report: sale-price quartiles, median and count by POSTCODE and by
 *    local government area, one workbook per quarter since 2017.
 *
 * Both land in one table (`market_sales_medians`) under one row shape, so the
 * adapter that turns a series into evidence points is written once.
 *
 * ## Three rules
 *
 * **The period is the quarter the sales settled in, never the load date.**
 * `period` is the quarter's END month (`2026-03` for the March quarter),
 * which is what the growth horizons compare and what `asOf` is derived from.
 *
 * **An area is stored under the publisher's own label and looked up by a
 * token.** QGSO writes `Moreton Bay (C)`, the cadastre writes
 * `MORETON BAY REGIONAL`; `salesAreaToken` strips the dressing from both so
 * one indexed lookup answers, the same rule the crime register uses.
 *
 * **A suppressed figure is null, never zero.** DCJ prints `-` where thirty or
 * fewer properties sold and QGSO prints nothing where a quarter is not
 * published; a zero median would be a real number about nothing.
 */
import { normaliseCouncilTokens } from '../../../planning/developmentActivity.pure.ts';

export const SALES_REGISTER_VERSION = 'me9.sales.1';

export type SalesRegisterState = 'QLD' | 'NSW';

/** `region` is a publisher grouping (South East Queensland …) — context, never evidence. */
export type SalesAreaKind = 'lga' | 'postcode' | 'region';

/** `any` means the publisher did not split — DCJ's "Total" — and is a real answer. */
export type SalesDwellingType = 'house' | 'attached' | 'any';

export interface SalesMedianRow {
  state: SalesRegisterState;
  areaKind: SalesAreaKind;
  /** The publisher's own label — `Moreton Bay (C)`, `2155`, `South East Queensland`. */
  area: string;
  dwellingType: SalesDwellingType;
  /** Quarter END month, `YYYY-MM`. */
  period: string;
  /** Dollars, or null where the publisher suppressed or did not publish. */
  medianPrice: number | null;
  /** Sales settled in the quarter, or null where not published. */
  salesCount: number | null;
}

const QUARTER_END_MONTH: Record<string, string> = {
  mar: '03', march: '03',
  jun: '06', june: '06',
  sep: '09', sept: '09', september: '09',
  dec: '12', december: '12',
};

/** The quarter-end month of a month name, or null for a month that ends no quarter. */
export function quarterEndMonth(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  return QUARTER_END_MONTH[name.trim().toLowerCase()] ?? null;
}

/** `('Jun', 2008)` → `2008-06`; null when either half is not a quarter label. */
export function periodOf(monthName: unknown, year: unknown): string | null {
  const month = quarterEndMonth(monthName);
  const y = typeof year === 'number' ? year : typeof year === 'string' ? Number(year.trim()) : NaN;
  if (!month || !Number.isInteger(y) || y < 1990 || y > 2100) return null;
  return `${y}-${month}`;
}

export function isPeriod(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(03|06|09|12)$/.test(value);
}

/** The same quarter `years` earlier. */
export function periodYearsBefore(period: string, years: number): string {
  const [y, m] = period.split('-');
  return `${Number(y) - years}-${m}`;
}

/** The last day of the quarter, ISO — what an evidence point's `asOf` is. */
export function periodEndDate(period: string): string {
  const m = period.slice(5);
  const day = m === '06' || m === '09' ? '30' : '31';
  return `${period}-${day}`;
}

const MONTH_WORD: Record<string, string> = { '03': 'March', '06': 'June', '09': 'September', '12': 'December' };

/** `2026-03` → `March 2026 quarter`. */
export function periodLabel(period: string): string {
  return `${MONTH_WORD[period.slice(5)] ?? period.slice(5)} ${period.slice(0, 4)} quarter`;
}

/** Compare two periods chronologically. */
export function comparePeriods(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The lookup token for an area — a postcode's digits, or a council name
 * with its dressing stripped. `Moreton Bay (C)` and `MORETON BAY REGIONAL`
 * both become `BAY MORETON`; the parenthesised class QGSO appends (`(C)`
 * city, `(R)` regional, `(S)` shire, `(T)` town, `(A)` aboriginal) is
 * removed BEFORE tokenising, because `C` is not a dressing word.
 */
export function salesAreaToken(kind: SalesAreaKind, area: string): string {
  if (kind === 'postcode') return area.replace(/\D/g, '');
  const bare = area.replace(/\s*\([A-Za-z .]{1,4}\)\s*$/, '').trim();
  return normaliseCouncilTokens(bare);
}

/**
 * A cell as a number, or null. Publishers write suppressed and unpublished
 * figures as `-`, `..`, `n.p.`, `n.a.` or nothing; a thousands separator or a
 * dollar sign is stripped. Nothing here turns an absence into zero.
 */
export function parseNumberCell(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s === '' || /^(-|–|—|\.\.|n\.?p\.?|n\.?a\.?|np|na|\*+)$/i.test(s)) return null;
  const cleaned = s.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** The words a reader sees for a dwelling type. */
export function dwellingWords(type: SalesDwellingType): string {
  return type === 'house' ? 'houses' : type === 'attached' ? 'units and townhouses' : 'all dwellings';
}
