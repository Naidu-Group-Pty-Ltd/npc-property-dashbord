/**
 * Each jurisdiction's own projection workbook, and the parser written
 * against it.
 *
 * ── Written against what CI printed, never against memory ─────────────────
 *
 * Every layout below is the one `state-projection-liveness` described from CI
 * on 23 Sep 2026 (run 35827597400, job 107072665157): the sheet names, the row
 * the header sits on, where the publisher states which years are history and
 * which are projected, and which rows are totals rather than areas. Where a
 * fact about a file is not in that output it is not assumed here — it is read
 * from the workbook at load time and the load REFUSES if the workbook does not
 * say it. A parser that guesses a layout loads a plausible wrong table, and a
 * projection table is read by a client as a statement about their suburb.
 *
 * ── The base year is the publisher's statement, never an inference ───────
 *
 * A projection opens on the population it starts from, which is an estimate —
 * a measurement — and printing that under a forward heading as projected is
 * the worst failure this register can commit. So each parser reads the base
 * from where its publisher states it:
 *
 *  - NSW says it on the sheet itself: *"Historic (2001-2021) and projected
 *    (2022-2041)"*. The last historic year is the base; the historic years
 *    before it are not loaded, because they are estimates and not the
 *    projection.
 *  - Victoria in Future says it in its Explanatory Notes: the projections
 *    start from *"the Estimated Resident Population (ERP) as at 30 June
 *    2022"*. The table prints 2021, 2026, 2031 and 2036, so 2021 is the
 *    newest estimate it prints and everything after the stated jump-off is
 *    projected.
 *  - Tasmania's Treasury does not print the sentence, and its components table
 *    states it structurally: the first interval is `2023-2028` and its
 *    start-of-interval population is the base. The parser reads the base from
 *    there and then CHECKS the Totals sheet's figure for that year against the
 *    components table's, area by area — the two tables are the publisher's own
 *    and must agree, or the column was misread.
 *
 * ── Every series is loaded, none defaulted ───────────────────────────────
 *
 * Tasmania publishes Medium, High and Low in three files, and all three are
 * here: loading one would be the choice `choices[0]` made for the ABS. NSW
 * publishes its high and low series for the state as a whole only, so its SA2
 * and LGA files carry the one series its own file name calls **main**.
 * Victoria in Future publishes one series, named by its edition (`VIF2023`).
 *
 * ── What is refused ──────────────────────────────────────────────────────
 *
 * A missing statement of the base, an edition the workbook does not name, a
 * header with fewer years than the statement promises, and a parse that names
 * fewer areas than the file measured (a truncated read looks exactly like a
 * smaller state). Rows the parser declines — a state total, a row with no
 * code — are counted and named in `declined`, never dropped silently.
 *
 * Deno-compatible: explicit `.ts` extensions, no `@/` aliases. Pure.
 */
import type { ProjectionAreaKind } from './projectionRegister.pure.ts';
import { projectionAreaToken, type ProjectionLoadRow } from './projectionLoad.pure.ts';
import type { ProjectionState } from './stateProjectionPublishers.pure.ts';
import { cellText, headText, type Grid, type GridCell } from './xlsxSheet.pure.ts';

export type ProjectionFileKey = 'nsw_sa2' | 'nsw_lga' | 'vic_lga' | 'tas_medium' | 'tas_high' | 'tas_low';

export interface ProjectionParse {
  rows: ProjectionLoadRow[];
  release: string;
  series: string[];
  base: number | null;
  horizon: number;
  areas: number;
  /** Rows the parser read and declined to load, with the reason — never dropped silently. */
  declined: string[];
}

export interface ProjectionFile {
  key: ProjectionFileKey;
  state: ProjectionState;
  /** The publishing body, as the page will name it. */
  publisher: string;
  /** The publisher's own URL for the workbook. */
  url: string;
  /** The sheets the parser reads; nothing else in the workbook is inflated. */
  sheets: readonly string[];
  /**
   * The licence the PUBLISHER states for this file, as read, or null where it
   * has not been read. A null refuses the load: readable is not
   * republishable, and a projection table goes into a client's PDF.
   */
  licence: string | null;
  /** Where the licence was read, so the claim can be checked again. */
  licenceEvidence: string;
  /** The fewest areas a complete read of this file names — below it, the read was cut short. */
  minAreas: number;
  parse(grids: Readonly<Record<string, Grid>>, sourceUrl: string, licence: string): ProjectionParse;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared readers
// ─────────────────────────────────────────────────────────────────────────────

const yearOf = (v: GridCell | undefined): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d{4}\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : null;
};

const numberOf = (v: GridCell | undefined): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};

export interface YearHeader {
  row: number;
  /** Year → column, in the sheet's own order. */
  years: Array<{ col: number; year: number }>;
}

/**
 * The first row where `labelled(row)` holds and at least `minYears` year cells
 * follow `fromCol` — the row a projection table's columns are named on.
 */
export function findYearHeader(grid: Grid, labelled: (row: GridCell[]) => boolean, fromCol: number, minYears = 3): YearHeader | null {
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !labelled(row)) continue;
    const years: Array<{ col: number; year: number }> = [];
    for (let c = fromCol; c < row.length; c++) {
      const y = yearOf(row[c]);
      if (y !== null) years.push({ col: c, year: y });
    }
    if (years.length >= minYears) return { row: r, years };
  }
  return null;
}

/** The whole text of a sheet — every non-empty cell, one per line. */
export function sheetText(grid: Grid): string {
  return headText(grid, grid.length);
}

interface Statement { historicTo: number; projectedFrom: number; projectedTo: number }

/** NSW's own sentence: "Historic (2001-2021) and projected (2022-2041) …". */
export function readHistoricProjected(text: string): Statement | null {
  const m = /historic\s*\(\s*(\d{4})\s*[-–]\s*(\d{4})\s*\)[\s\S]{0,40}?projected\s*\(\s*(\d{4})\s*[-–]\s*(\d{4})\s*\)/i.exec(text);
  if (!m) return null;
  return { historicTo: Number(m[2]), projectedFrom: Number(m[3]), projectedTo: Number(m[4]) };
}

/** Victoria in Future's own sentence: the base is "the Estimated Resident Population (ERP) as at 30 June 2022". */
export function readJumpOffYear(text: string): number | null {
  const m = /Estimated Resident Population\s*\(ERP\)\s*as at 30 June\s*(\d{4})/i.exec(text);
  return m ? Number(m[1]) : null;
}

/** Tasmania's components table: the first interval's start (`2023-2028` → 2023). */
export function readFirstInterval(grid: Grid): number | null {
  for (const row of grid.slice(0, 12)) {
    for (const c of row ?? []) {
      const m = /^\s*(\d{4})\s*[-–]\s*(\d{4})\s*$/.exec(cellText(c));
      if (m && Number(m[2]) > Number(m[1])) return Number(m[1]);
    }
  }
  return null;
}

interface RowSpec {
  state: ProjectionState;
  release: string;
  series: string;
  areaKind: ProjectionAreaKind;
  publisher: string;
  sourceUrl: string;
  licence: string;
}

/** The rows one area contributes: its base (where the file prints one) and every projected year. */
function rowsForArea(
  spec: RowSpec,
  area: { name: string; code: string; token: string },
  values: ReadonlyMap<number, number>,
  base: number | null,
  projected: readonly number[],
): ProjectionLoadRow[] {
  const out: ProjectionLoadRow[] = [];
  const push = (year: number, kind: 'base' | 'projected') => {
    const v = values.get(year);
    if (v === undefined) return; // absent, never zero
    out.push({
      state: spec.state, release: spec.release, series: spec.series, measure: 'persons',
      area_kind: spec.areaKind, area_code: area.code, area: area.name, area_token: area.token,
      year, year_kind: kind, value: v,
      publisher: spec.publisher, source_url: spec.sourceUrl, licence: spec.licence,
    });
  };
  if (base !== null) push(base, 'base');
  for (const y of projected) push(y, 'projected');
  return out;
}

function valuesOf(row: GridCell[], header: YearHeader): Map<number, number> {
  const out = new Map<number, number>();
  for (const { col, year } of header.years) {
    const v = numberOf(row[col]);
    if (v !== null) out.set(year, v);
  }
  return out;
}

function refuse(file: string, why: string): never {
  throw new Error(`${file}: ${why} — refused`);
}

// ─────────────────────────────────────────────────────────────────────────────
// New South Wales — 2024 NSW Population Projections (SA2 and LGA workbooks)
// ─────────────────────────────────────────────────────────────────────────────

const NSW_PUBLISHER = 'the NSW Department of Planning, Housing and Infrastructure';
/** State-wide rows a NSW table may carry; they are not areas of the grain. */
const NSW_TOTAL = /^(new south wales|nsw|total\b|greater sydney|rest of nsw|regional nsw)/i;

/** The edition's own name, from the Notes sheet ("2024 NSW Population Projections"). */
function nswRelease(notes: Grid, file: string): string {
  for (const line of sheetText(notes).split('\n')) {
    if (/^\d{4} NSW Population Projections$/.test(line)) return line;
  }
  refuse(file, 'the Notes sheet does not name the edition ("YYYY NSW Population Projections")');
}

/** Collapsed SA2 → the ASGS 2021 SA2s it combines, from the publisher's own table. */
export function nswCollapsedSa2s(grid: Grid, file: string): Map<string, string[]> {
  const header = grid.findIndex((row) => /^collapsed sa2$/i.test(cellText(row?.[0])) && /^sa2_name_2021$/i.test(cellText(row?.[1])));
  if (header < 0) refuse(file, 'the "Collapsed SA2s" sheet has no "Collapsed SA2 | SA2_NAME_2021" header');
  const out = new Map<string, string[]>();
  for (let r = header + 1; r < grid.length; r++) {
    const collapsed = cellText(grid[r]?.[0]);
    const member = cellText(grid[r]?.[1]);
    if (collapsed === '' || member === '') continue;
    out.set(collapsed, [...(out.get(collapsed) ?? []), member]);
  }
  if (out.size === 0) refuse(file, 'the "Collapsed SA2s" sheet lists no collapsed area');
  return out;
}

function parseNsw(
  grids: Readonly<Record<string, Grid>>, sourceUrl: string, licence: string,
  opts: { file: ProjectionFileKey; label: RegExp; areaKind: 'sa2' | 'lga' },
): ProjectionParse {
  const table = grids['Total population'];
  const release = nswRelease(grids['Notes'], opts.file);
  const header = findYearHeader(table, (row) => opts.label.test(cellText(row[0])), 1, 10);
  if (!header) refuse(opts.file, `the "Total population" sheet has no year header labelled ${opts.label}`);
  const statement = readHistoricProjected(headText(table, header.row));
  if (!statement) refuse(opts.file, 'the sheet no longer states which years are historic and which projected');
  if (statement.projectedFrom !== statement.historicTo + 1) {
    refuse(opts.file, `the statement leaves a gap between history (to ${statement.historicTo}) and projection (from ${statement.projectedFrom})`);
  }
  const printed = new Set(header.years.map((y) => y.year));
  const projected = header.years.map((y) => y.year).filter((y) => y >= statement.projectedFrom && y <= statement.projectedTo);
  if (!printed.has(statement.historicTo) || !printed.has(statement.projectedTo)) {
    refuse(opts.file, `the header does not print the base ${statement.historicTo} and the horizon ${statement.projectedTo} its own statement names`);
  }

  const collapsed = opts.areaKind === 'sa2' ? nswCollapsedSa2s(grids['Collapsed SA2s'], opts.file) : new Map<string, string[]>();
  const spec: RowSpec = {
    state: 'NSW', release, series: 'Main series', areaKind: opts.areaKind,
    publisher: NSW_PUBLISHER, sourceUrl, licence,
  };
  const rows: ProjectionLoadRow[] = [];
  const declined: string[] = [];
  const seenCollapsed = new Set<string>();
  let areas = 0;
  for (let r = header.row + 1; r < table.length; r++) {
    const row = table[r];
    const name = cellText(row?.[0]);
    if (!row || name === '') continue;
    if (NSW_TOTAL.test(name)) { declined.push(`${name} (a total, not an area)`); continue; }
    const values = valuesOf(row, header);
    if (values.size === 0) { declined.push(`${name} (no figures)`); continue; }
    areas += 1;
    const members = collapsed.get(name);
    if (members) {
      seenCollapsed.add(name);
      // One row set per ASGS SA2 the collapsed area combines, each naming the
      // area the figure actually describes — the reader asks by the property's
      // own SA2, and must be answered with the area the publisher projected.
      for (const member of members) {
        const token = projectionAreaToken('sa2', member);
        rows.push(...rowsForArea(spec, { name, code: token, token }, values, statement.historicTo, projected));
      }
      continue;
    }
    const token = projectionAreaToken(opts.areaKind, name);
    rows.push(...rowsForArea(spec, { name, code: token, token }, values, statement.historicTo, projected));
  }
  const unmatched = [...collapsed.keys()].filter((c) => !seenCollapsed.has(c));
  if (unmatched.length > 0) {
    refuse(opts.file, `the collapsed-SA2 table names ${unmatched.slice(0, 3).map((u) => JSON.stringify(u)).join(', ')}, which the population table does not hold`);
  }
  return {
    rows, release, series: [spec.series], base: statement.historicTo, horizon: Math.max(...projected), areas, declined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Victoria — Victoria in Future 2023, LGA workbook
// ─────────────────────────────────────────────────────────────────────────────

const VIC_PUBLISHER = 'the Victorian Department of Transport and Planning';

function parseVic(grids: Readonly<Record<string, Grid>>, sourceUrl: string, licence: string): ProjectionParse {
  const file: ProjectionFileKey = 'vic_lga';
  const contents = sheetText(grids['Contents']).split('\n');
  const title = contents.find((l) => /^Victoria in Future\b/i.test(l));
  const month = contents.find((l) => /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/.test(l));
  const edition = /\b(VIF\d{4})_/.exec(contents.join('\n'))?.[1];
  if (!title || !month || !edition) refuse(file, 'the Contents sheet does not name the edition, its date and its file');
  const release = `${title}, ${month}`;

  const jumpOff = readJumpOffYear(sheetText(grids['Explanatory Notes']));
  if (jumpOff === null) refuse(file, 'the Explanatory Notes no longer state the base Estimated Resident Population year');

  const table = grids['Total_Population'];
  const header = findYearHeader(table, (row) => /^lga code$/i.test(cellText(row[0])) && /^lga$/i.test(cellText(row[1])), 2, 3);
  if (!header) refuse(file, 'the "Total_Population" sheet has no "LGA code | LGA | years" header');
  const estimates = header.years.map((y) => y.year).filter((y) => y <= jumpOff);
  const base = estimates.length > 0 ? Math.max(...estimates) : null;
  const projected = header.years.map((y) => y.year).filter((y) => y > jumpOff);
  if (projected.length === 0) refuse(file, `no printed year follows the stated base of ${jumpOff}`);

  const spec: RowSpec = {
    state: 'VIC', release, series: edition, areaKind: 'lga', publisher: VIC_PUBLISHER, sourceUrl, licence,
  };
  const rows: ProjectionLoadRow[] = [];
  const declined: string[] = [];
  let areas = 0;
  for (let r = header.row + 1; r < table.length; r++) {
    const row = table[r];
    if (!row) continue;
    const code = cellText(row[0]);
    const name = cellText(row[1]);
    if (name === '' && code === '') continue;
    // The state total sits in the table with no code; an LGA always has one.
    if (!/^\d{5}$/.test(code)) { declined.push(`${name || '(unnamed)'} (no LGA code — a total, not an area)`); continue; }
    const values = valuesOf(row, header);
    if (values.size === 0) { declined.push(`${name} (no figures)`); continue; }
    areas += 1;
    rows.push(...rowsForArea(spec, { name, code, token: projectionAreaToken('lga', name) }, values, base, projected));
  }
  return { rows, release, series: [edition], base, horizon: Math.max(...projected), areas, declined };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tasmania — Treasury's population projections, one main output file per series
// ─────────────────────────────────────────────────────────────────────────────

const TAS_PUBLISHER = 'the Tasmanian Department of Treasury and Finance';
const TAS_COMPONENTS = 'LGADetailedComponents5yr';
/** The state's own row, in either table. */
const TAS_TOTAL = /^tasmania$/i;

/**
 * Each LGA's start-of-interval population for the FIRST interval, from the
 * components table: a name on its own row, then `Start-of-interval
 * population` with one figure per interval.
 */
export function tasComponentsBase(grid: Grid): Map<string, number> {
  const out = new Map<string, number>();
  let current: string | null = null;
  for (const row of grid) {
    if (!row) continue;
    const label = cellText(row[0]);
    const figures = row.slice(1).filter((c) => numberOf(c) !== null).length;
    if (label !== '' && figures === 0 && !/^\d{4}\s*[-–]/.test(label) && !/values as at/i.test(label) && !/components/i.test(label)) {
      current = label;
      continue;
    }
    if (current !== null && /^start-of-interval population/i.test(label)) {
      const v = numberOf(row[1]);
      if (v !== null) out.set(current, v);
      current = null;
    }
  }
  return out;
}

function parseTas(
  grids: Readonly<Record<string, Grid>>, sourceUrl: string, licence: string,
  opts: { file: ProjectionFileKey; series: string },
): ProjectionParse {
  const readme = grids['ReadMe'];
  const release = cellText(readme?.[0]?.[0]);
  if (release === '') refuse(opts.file, 'the ReadMe sheet does not name the edition in its first cell');

  const components = grids[TAS_COMPONENTS];
  const base = readFirstInterval(components);
  if (base === null) refuse(opts.file, 'the components table does not state its first interval, so the base is unknown');
  const startOf = tasComponentsBase(components);
  if (startOf.size === 0) refuse(opts.file, 'the components table names no area with a start-of-interval population');

  const table = grids['Totals'];
  const header = findYearHeader(table, (row) => cellText(row[0]) === '', 1, 10);
  if (!header) refuse(opts.file, 'the "Totals" sheet has no row of years');
  if (!header.years.some((y) => y.year === base)) refuse(opts.file, `the Totals sheet does not print the base year ${base}`);
  const projected = header.years.map((y) => y.year).filter((y) => y > base);
  if (projected.length === 0) refuse(opts.file, `no printed year follows the base ${base}`);

  const spec: RowSpec = {
    state: 'TAS', release, series: opts.series, areaKind: 'lga', publisher: TAS_PUBLISHER, sourceUrl, licence,
  };
  const rows: ProjectionLoadRow[] = [];
  const declined: string[] = [];
  let areas = 0;
  for (let r = header.row + 1; r < table.length; r++) {
    const row = table[r];
    const name = cellText(row?.[0]);
    if (!row || name === '') continue;
    if (TAS_TOTAL.test(name)) { declined.push(`${name} (the state, not an LGA)`); continue; }
    // Only the areas the publisher's own components table names are LGAs;
    // anything else in Totals — a region, a grouping — is a total.
    if (!startOf.has(name)) { declined.push(`${name} (not an LGA in the components table)`); continue; }
    const values = valuesOf(row, header);
    const printedBase = values.get(base);
    const stated = startOf.get(name)!;
    if (printedBase === undefined || Math.abs(printedBase - stated) > 1) {
      refuse(opts.file, `${name}: Totals prints ${printedBase ?? 'nothing'} for ${base}, the components table starts from ${Math.round(stated)} — the base column was misread`);
    }
    areas += 1;
    const token = projectionAreaToken('lga', name);
    rows.push(...rowsForArea(spec, { name, code: token, token }, values, base, projected));
  }
  const missing = [...startOf.keys()].filter((n) => !TAS_TOTAL.test(n) && !rows.some((row) => row.area === n));
  if (missing.length > 0) refuse(opts.file, `the components table names ${missing.slice(0, 3).join(', ')}, which Totals does not print`);
  return { rows, release, series: [opts.series], base, horizon: Math.max(...projected), areas, declined };
}

// ─────────────────────────────────────────────────────────────────────────────
// The files
// ─────────────────────────────────────────────────────────────────────────────

const NOT_YET_READ = 'not yet read from the publisher — the load refuses until it is';

/**
 * Read from CI on 23 Sep 2026 (run 35831008944), from the site that serves
 * both workbooks: the Department's copyright page states that "unless
 * otherwise stated, all department material available on this website is
 * licensed under the Creative Commons Attribution 4.0 International (CC BY
 * 4.0)", and asks attribution in the form "© State of New South Wales and
 * Department of Planning, Housing and Infrastructure [year of publication]".
 * Neither workbook states otherwise — the dry run read every line of both —
 * and each carries exactly that notice on its Notes sheet, which
 * `suppliedNotice` reads and every row carries. "Unless otherwise stated" is
 * held at load time too: `parseProjectionFile` refuses a file that states
 * terms of its own, so a later edition published under different terms is
 * refused rather than loaded under these.
 */
const NSW_LICENCE = 'Creative Commons Attribution 4.0 International';
const NSW_LICENCE_EVIDENCE = 'planning.nsw.gov.au/copyright-and-disclaimer ("Unless otherwise stated, all department '
  + 'material available on this website is licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0)"); '
  + 'the workbook states no terms of its own and carries the notice that page asks for — read from CI 23 Sep 2026 '
  + '(run 35831008944)';

export const PROJECTION_FILES: readonly ProjectionFile[] = [
  {
    key: 'nsw_sa2',
    state: 'NSW',
    publisher: NSW_PUBLISHER,
    url: 'https://www.planning.nsw.gov.au/sites/default/files/2024-11/2024-nsw-population-projections-sa2s.xlsx',
    sheets: ['Notes', 'Collapsed SA2s', 'Total population'],
    licence: NSW_LICENCE,
    licenceEvidence: NSW_LICENCE_EVIDENCE,
    minAreas: 500,
    parse: (g, url, licence) => parseNsw(g, url, licence, { file: 'nsw_sa2', label: /^SA2$/i, areaKind: 'sa2' }),
  },
  {
    key: 'nsw_lga',
    state: 'NSW',
    publisher: NSW_PUBLISHER,
    url: 'https://www.planning.nsw.gov.au/sites/default/files/2024-11/2024-nsw-population-projections-local-government-areas.xlsx',
    sheets: ['Notes', 'Total population'],
    licence: NSW_LICENCE,
    licenceEvidence: NSW_LICENCE_EVIDENCE,
    minAreas: 120,
    parse: (g, url, licence) => parseNsw(g, url, licence, { file: 'nsw_lga', label: /^Local Government Area$/i, areaKind: 'lga' }),
  },
  {
    key: 'vic_lga',
    state: 'VIC',
    publisher: VIC_PUBLISHER,
    url: 'https://www.planning.vic.gov.au/__data/assets/excel_doc/0033/680874/VIF2023_LGA_Pop_Hhold_Dwelling_Projections_to_2036.xlsx',
    sheets: ['Contents', 'Explanatory Notes', 'Total_Population'],
    licence: 'Creative Commons Attribution 4.0 International',
    licenceEvidence: 'discover.data.vic.gov.au, dataset 4912723f-79a3-4dc8-b9d1-61b0f00152ce '
      + '("VIF2023 LGA Population Household Dwelling Projections to 2036"), read from CI 23 Sep 2026',
    minAreas: 75,
    parse: (g, url, licence) => parseVic(g, url, licence),
  },
  ...(['Medium', 'High', 'Low'] as const).map((s): ProjectionFile => ({
    key: `tas_${s.toLowerCase()}` as ProjectionFileKey,
    state: 'TAS',
    publisher: TAS_PUBLISHER,
    url: `https://www.treasury.tas.gov.au/Documents/2024-population-projections-${s}-series-Main-output-file.xlsx`,
    sheets: ['ReadMe', 'Totals', TAS_COMPONENTS],
    licence: null,
    licenceEvidence: NOT_YET_READ,
    minAreas: 25,
    parse: (g, url, licence) => parseTas(g, url, licence, { file: `tas_${s.toLowerCase()}` as ProjectionFileKey, series: `${s} series` }),
  })),
];

export function projectionFileByKey(key: string): ProjectionFile | null {
  return PROJECTION_FILES.find((f) => f.key === key) ?? null;
}

/** A cell that opens a copyright notice: `©`, `(c)`, or `Copyright ©`. */
const NOTICE = /^(©|\(c\)\s|copyright\s*©)/i;

/**
 * The copyright notice the publisher SUPPLIES with a file — the first cell, in
 * the order the sheets were read, that opens with `©`, verbatim — or null.
 *
 * CC BY 4.0 §3(a)(1)(A)(ii) asks a reuser to retain "a copyright notice" where
 * the licensor supplies one with the material, so the notice travels with
 * every row the file writes and reaches the page beside the licence. It is
 * READ from the file, never typed: a typed notice is one nobody checks against
 * the next edition.
 */
export function suppliedNotice(grids: Readonly<Record<string, Grid>>): string | null {
  for (const grid of Object.values(grids)) {
    for (const row of grid) for (const c of row ?? []) {
      const t = cellText(c);
      if (NOTICE.test(t)) return t;
    }
  }
  return null;
}

/**
 * Words with which a workbook states terms of its OWN. A licence here is read
 * from the publisher's site, and a site's licence is stated "unless otherwise
 * stated" — so a file that does otherwise state is refused until somebody
 * reads what it says, rather than loaded under terms that may not be its own.
 * The copyright notice itself is not a statement of terms, and is left out.
 */
export const OWN_TERMS = /licen[cs]e[ds]?\b|creative commons|\bcc[ -]by\b|all rights reserved|permission|may not be (reproduced|copied|used|distributed)|terms (of use|and conditions)/i;

/** Every cell of the sheets read that states terms of the file's own, verbatim. */
export function statedTerms(grids: Readonly<Record<string, Grid>>): string[] {
  const out: string[] = [];
  for (const grid of Object.values(grids)) {
    for (const row of grid) for (const c of row ?? []) {
      const t = cellText(c);
      if (t !== '' && !NOTICE.test(t) && OWN_TERMS.test(t)) out.push(t);
    }
  }
  return out;
}

/** The licence a row carries: the licence read from the publisher, and the notice the file supplies. */
export function licenceWithNotice(licence: string, notice: string | null): string {
  return notice ? `${licence} — ${notice}` : licence;
}

/**
 * Parse a file's sheets and hold the result to the file's own floor. The one
 * entry point the loader and the CI dry run share, so what CI proves about a
 * file is what production would write.
 */
export function parseProjectionFile(
  file: ProjectionFile, grids: Readonly<Record<string, Grid>>, sourceUrl: string, licence: string,
): ProjectionParse {
  const terms = statedTerms(grids);
  if (terms.length > 0) {
    refuse(file.key, `the workbook states terms of its own (${JSON.stringify(terms[0].slice(0, 160))}) — the licence `
      + `read for it (${file.licenceEvidence.slice(0, 80)}) may not describe this file; read what it says before loading it`);
  }
  const parsed = file.parse(grids, sourceUrl, licenceWithNotice(licence, suppliedNotice(grids)));
  if (parsed.areas < file.minAreas) {
    refuse(file.key, `the read named ${parsed.areas} areas, fewer than the ${file.minAreas} a complete read of this file names — a truncated read looks exactly like a smaller state`);
  }
  return parsed;
}

/**
 * Whether this platform's loader reads a jurisdiction's own projection: a
 * file is declared for it AND that file's licence has been read from its
 * publisher. `FORWARD_DEMAND_PUBLISHERS.ingested` is this, derived rather
 * than typed, so the flag, the sentence and the loader cannot disagree — and a
 * file whose licence is unread counts for nothing, because the loader refuses
 * it.
 */
export function projectionIngested(state: string): boolean {
  return PROJECTION_FILES.some((f) => f.state === state && f.licence !== null);
}
