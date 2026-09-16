/**
 * South Australia's metropolitan median house sales by suburb, read
 * through the archive.
 *
 * The Department for Housing and Urban Development (formerly the Land
 * Services Group, hence `lsg_stats`) publishes one workbook a quarter on
 * data.sa.gov.au under Creative Commons Attribution: one sheet, one row
 * per metropolitan suburb under its council, with the number of sales and
 * the median house price for the quarter AND for the same quarter a year
 * earlier, and the change between them. data.sa.gov.au answers this
 * project's egress 403 (catalogue and files alike, pg_net 240128/240151),
 * so the loader reads the Internet Archive's captures — forty-odd quarters
 * back to 2014 are held there, the newest as the archive last looked.
 *
 * Two rules. **Each workbook yields two quarters** (the quarter and its
 * year-earlier comparison), and a later workbook's figure for a quarter
 * wins over an earlier workbook's, because the publisher revises. **An
 * empty cell is a suburb with no sale to report**, and is null — the
 * publisher prints nothing where there is nothing, never a zero.
 */
import { type SalesMedianRow, parseNumberCell } from './salesRegister.pure.ts';

export const SA_LSG_PAGE_URL = 'https://data.sa.gov.au/data/dataset/metro-median-house-sales';
export const SA_LSG_SOURCE_LABEL =
  'South Australian Department for Housing and Urban Development (Land Services), metro median house sales by suburb';
export const SA_LSG_LICENCE = 'Creative Commons Attribution';
export const SA_LSG_LICENCE_URL = 'https://data.sa.gov.au/data/dataset/metro-median-house-sales';
/** The archive's index of the dataset's files; the dataset id is stable across its resource ids. */
export const SA_LSG_ARCHIVE_PATTERN = 'data.sa.gov.au/data/dataset/0d447195-1158-4a3c-8cc7-0e333b87eb72/*';

/**
 * `lsg_stats_2024_q4.xlsx`, `copy-of-lsg_stats_2020_q1.xlsx`, `lsgstats2016q4.xlsx`,
 * `lsgstats-2015q1.xlsx`, `cdata.salsgstats-2015q4.xlsx`, `lsg_stats_2020_q4-.csv`
 * — every spelling the publisher has used, ranked by the quarter it names.
 */
export const SA_LSG_FILE = /lsg_?stats[-_]?(\d{4})[-_]?q([1-4])[^/]*\.(xlsx|csv)$/i;

export const SA_PLAUSIBILITY = {
  minSuburbs: 300,
  minPrice: 50_000,
  maxPrice: 30_000_000,
} as const;

type Grid = ReadonlyArray<ReadonlyArray<unknown>>;

const text = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '');

/** `1Q 2024` → `2024-03`; null for anything else. */
export function quarterOfHeading(heading: string): { kind: 'sales' | 'median'; period: string } | null {
  const m = /^(Sales|Median)\s+([1-4])Q\s+(\d{4})$/i.exec(heading);
  if (!m) return null;
  const end = ['03', '06', '09', '12'][Number(m[2]) - 1];
  return { kind: m[1].toLowerCase() as 'sales' | 'median', period: `${m[3]}-${end}` };
}

/** The quarter a file name describes, as a sortable index (year × 4 + quarter). */
export function rankOfSaFileName(name: string): number | null {
  const m = SA_LSG_FILE.exec(name);
  if (!m) return null;
  return Number(m[1]) * 4 + Number(m[2]);
}

export interface SaLsgParse {
  rows: SalesMedianRow[];
  /** The two quarters the workbook carries, ascending. */
  periods: string[];
  latestPeriod: string;
  suburbs: number;
  councils: number;
}

/**
 * The single sheet: a header naming `City`, `Suburb` and two
 * `Sales nQ YYYY` / `Median nQ YYYY` pairs; every later row a suburb.
 * Throws on any other shape.
 */
export function parseSaLsgStats(grid: Grid, capturedAt: string | null): SaLsgParse {
  let headerRow = -1;
  for (let r = 0; r < Math.min(grid.length, 6); r++) {
    const row = grid[r] ?? [];
    if (text(row[0]).toLowerCase() === 'city' && text(row[1]).toLowerCase() === 'suburb') { headerRow = r; break; }
  }
  if (headerRow < 0) throw new Error('the South Australian sheet has no "City | Suburb" header (layout drift) — refused');
  const header = grid[headerRow] ?? [];
  const cols: Array<{ col: number; kind: 'sales' | 'median'; period: string }> = [];
  for (let c = 2; c < header.length; c++) {
    const q = quarterOfHeading(text(header[c]));
    if (q) cols.push({ col: c, ...q });
  }
  const periods = [...new Set(cols.map((c) => c.period))].sort();
  if (periods.length !== 2 || !cols.some((c) => c.kind === 'median')) {
    throw new Error(`the South Australian sheet names ${periods.length} quarters in its header (expected the quarter and its year-earlier comparison) — refused`);
  }
  const rows: SalesMedianRow[] = [];
  const suburbs = new Set<string>();
  const councils = new Set<string>();
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const council = text(row[0]);
    const suburb = text(row[1]);
    if (!suburb || !council) continue;
    if (suburb.length > 60) continue;
    suburbs.add(suburb);
    councils.add(council);
    for (const period of periods) {
      const medianCol = cols.find((c) => c.kind === 'median' && c.period === period);
      const salesCol = cols.find((c) => c.kind === 'sales' && c.period === period);
      const median = medianCol ? parseNumberCell(row[medianCol.col]) : null;
      const sales = salesCol ? parseNumberCell(row[salesCol.col]) : null;
      if (median !== null && (median < SA_PLAUSIBILITY.minPrice || median > SA_PLAUSIBILITY.maxPrice)) {
        throw new Error(`the South Australian sheet prices ${suburb} ${period} at $${median}, outside ${SA_PLAUSIBILITY.minPrice}–${SA_PLAUSIBILITY.maxPrice} — refused`);
      }
      rows.push({
        state: 'SA', areaKind: 'suburb', area: suburb, dwellingType: 'house', period,
        medianPrice: median,
        salesCount: sales !== null && sales >= 0 ? Math.round(sales) : null,
        priceMeasure: 'median', periodSpan: 'quarter', capturedAt,
      });
    }
  }
  if (suburbs.size < SA_PLAUSIBILITY.minSuburbs) {
    throw new Error(`the South Australian sheet lists ${suburbs.size} suburbs, fewer than ${SA_PLAUSIBILITY.minSuburbs} — refused`);
  }
  return { rows, periods, latestPeriod: periods[1], suburbs: suburbs.size, councils: councils.size };
}
