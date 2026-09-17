/**
 * Development-application intelligence — summarising what a council's DA
 * register actually says, and resolving which register that is.
 *
 * Two measured facts shape this module (probe log in
 * `docs/reports/ZONING_BY_JURISDICTION.md`, 2026-09-06):
 *
 *  1. **The NSW Online DA API's council filter is exact-match**:
 *     `CouncilName: ["MUSWELLBROOK"]` matches nothing, `["MUSWELLBROOK SHIRE
 *     COUNCIL"]` matches 62. The zoning layer answers `LGA_NAME:
 *     "MUSWELLBROOK"`; the DA rows say `"Muswellbrook Shire Council"`. The
 *     suffix varies by council (Shire/City/Regional/Municipal/none), so it is
 *     resolved by comparing NORMALISED token sets against the register's own
 *     council list — and an ambiguous or absent match REFUSES rather than
 *     guessing, because a confident answer for the wrong council is worse
 *     than none.
 *
 *  2. **A page is a sample unless it is the whole register.** The API states
 *     `TotalCount`; the summary carries how many applications it actually
 *     read against that total, so "the largest projects" can never silently
 *     mean "the largest of the first page".
 *
 * Everything here is arithmetic over rows the register returned. Nothing is
 * estimated; a field a row does not carry is skipped and the counts say how
 * many rows carried it.
 */

export interface NswDaRow {
  PlanningPortalApplicationNumber?: unknown;
  CouncilApplicationNumber?: unknown;
  LodgementDate?: unknown;
  DeterminationDate?: unknown;
  CostOfDevelopment?: unknown;
  NumberOfNewDwellings?: unknown;
  ApplicationStatus?: unknown;
  ApplicationType?: unknown;
  Council?: { CouncilName?: unknown };
  DevelopmentType?: Array<{ DevelopmentType?: unknown }>;
  Location?: Array<{ Suburb?: unknown; Postcode?: unknown; FullAddress?: unknown }>;
}

/**
 * What an application IS, for the purpose of adding costs up.
 *
 * ## The defect this ends
 *
 * A modification restates the development it modifies. The register carries
 * the WHOLE cost and the WHOLE dwelling count on the modification row, not
 * the delta — so adding every row together counts the same building twice,
 * and counts it again for each further modification.
 *
 * Measured live against the register on 17 Sep 2026, The Hills Shire Council,
 * every application lodged 17 Mar – 17 Sep 2026 (all 659 rows, 7 pages):
 *
 * | type | rows | stated cost | new dwellings |
 * | --- | ---: | ---: | ---: |
 * | Development Application | 474 | $1,177,228,202 | 1,412 |
 * | Modification Application | 173 | $1,181,805,735 | 2,028 |
 * | Review of determination | 12 | $7,857,446 | 7 |
 * | **summed, as the report did** | **659** | **$2,366,891,383** | **3,447** |
 *
 * The report was therefore stating **$2.367bn** of development where the
 * genuinely new proposals are **$1.177bn** — a 101% overstatement — and
 * **3,447** new dwellings against **1,412**, which is 144%. The modifications
 * alone restate more dwellings than every new application put together.
 *
 * ## The rules
 *
 * 1. **The three classes are never added together.** There is no combined
 *    total on this summary at all, so a consumer must say which it means.
 *    The previous fields are gone rather than redefined: a number that
 *    silently changes meaning is worse than one that stops compiling.
 * 2. **An unrecognised type is never `new`.** The register may add a word
 *    this classifier does not know; it lands in `unclassified`, is reported
 *    as its own line, and cannot inflate the headline.
 * 3. **Nothing is dropped.** An amendment is real activity and a reader may
 *    want it — it is carried, counted and labelled, never silently removed.
 */
export type DaApplicationClass = 'new' | 'amendment' | 'unclassified';

export interface DaClassTotals {
  rows: number;
  /** Sum of stated costs, with how many rows stated one. */
  statedCostTotal: number;
  rowsWithCost: number;
  /** Sum of stated new dwellings, with how many rows stated one. */
  newDwellingsTotal: number;
  rowsWithDwellings: number;
}

export interface DaSummary {
  councilName: string;
  periodFrom: string;
  periodTo: string;
  /** How many applications the register states for the filter. */
  totalInPeriod: number;
  /** How many rows this summary actually read. */
  rowsRead: number;
  byStatus: Array<{ status: string; count: number }>;
  /** Genuinely new proposals — the figure a reader means by "development". */
  newApplications: DaClassTotals;
  /** Changes to a decision already made. A RESTATEMENT of a parent, never an addition. */
  amendments: DaClassTotals;
  /** A type the register used that this classifier does not recognise. */
  unclassified: DaClassTotals;
  /** The application types seen, so a new one is visible rather than silent. */
  byApplicationType: Array<{ type: string; klass: DaApplicationClass; count: number }>;
  topDevelopmentTypes: Array<{ type: string; count: number }>;
  largestByCost: Array<{
    cost: number;
    types: string[];
    suburb: string | null;
    status: string | null;
    determined: string | null;
    lodged: string | null;
    /** Carried so a modification can never be presented as a new project. */
    applicationClass: DaApplicationClass;
  }>;
}

/**
 * Classify by the register's own `ApplicationType`.
 *
 * Matched on a normalised form rather than the exact string, because the
 * register's casing is not guaranteed; matched on the WHOLE word "modification"
 * or "review" rather than a substring of a longer phrase nobody has seen, so a
 * new type reads as unclassified instead of being guessed into a bucket.
 */
export function classifyApplicationType(applicationType: unknown): DaApplicationClass {
  const t = typeof applicationType === 'string' ? applicationType.trim().toLowerCase() : '';
  if (t === '') return 'unclassified';
  if (t === 'development application') return 'new';
  if (t.startsWith('modification')) return 'amendment';
  if (t.startsWith('review of determination')) return 'amendment';
  return 'unclassified';
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/**
 * Strip the organisational dressing from a council name so `MUSWELLBROOK`
 * (a zoning layer's LGA) and `Muswellbrook Shire Council` (the DA register)
 * compare equal — and `CANTERBURY-BANKSTOWN` never matches `BANKSTOWN`.
 */
export function normaliseCouncilTokens(name: string): string {
  const DRESSING = new Set([
    'THE', 'COUNCIL', 'OF', 'CITY', 'SHIRE', 'MUNICIPAL', 'MUNICIPALITY',
    'REGIONAL', 'REGION', 'AREA', 'GREATER',
  ]);
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, ' ')
    .split(/[\s]+/)
    .filter((t) => t !== '' && !DRESSING.has(t))
    .sort()
    .join(' ');
}

/**
 * The register filters by exact name, but it accepts a LIST — so the lookup
 * sends every dressing of the LGA's own tokens and lets the register say
 * which one exists. A variant that names no real council matches nothing and
 * costs nothing; the resolved name is then read off the ANSWER's rows (the
 * answering service's own field, the same rule the jurisdiction router
 * follows) and validated by `resolveCouncilName` before it is trusted.
 */
export function councilNameCandidates(lgaName: string): string[] {
  const base = lgaName.trim().toUpperCase().replace(/\s+/g, ' ');
  if (base === '') return [];
  const variants = new Set<string>([
    `${base} COUNCIL`,
    `${base} SHIRE COUNCIL`,
    `${base} CITY COUNCIL`,
    `${base} REGIONAL COUNCIL`,
    `${base} MUNICIPAL COUNCIL`,
    `CITY OF ${base}`,
    `COUNCIL OF THE CITY OF ${base}`,
    base,
  ]);
  return [...variants];
}

/**
 * Resolve an LGA name to the register's own council name. Exactly one match
 * resolves; zero or several refuse with the candidates named, because the DA
 * filter is exact-match and a wrong council is a confidently wrong answer.
 */
export function resolveCouncilName(
  lgaName: string,
  registerCouncilNames: readonly string[],
): { resolved: string } | { resolved: null; reason: string } {
  const want = normaliseCouncilTokens(lgaName);
  if (want === '') return { resolved: null, reason: 'LGA name empty after normalisation' };
  const matches = registerCouncilNames.filter((c) => normaliseCouncilTokens(c) === want);
  if (matches.length === 1) return { resolved: matches[0] };
  if (matches.length === 0) {
    return { resolved: null, reason: `no council in the register matches "${lgaName}"` };
  }
  return {
    resolved: null,
    reason: `"${lgaName}" matches ${matches.length} councils (${matches.join('; ')})`,
  };
}

/** Summarise the rows a register returned. Pure arithmetic; nothing inferred. */
export function summariseDaRows(
  rows: readonly NswDaRow[],
  councilName: string,
  periodFrom: string,
  periodTo: string,
  totalInPeriod: number,
): DaSummary {
  const byStatus = new Map<string, number>();
  const byType = new Map<string, number>();
  const byApplicationType = new Map<string, { klass: DaApplicationClass; count: number }>();

  const blank = (): DaClassTotals => ({
    rows: 0, statedCostTotal: 0, rowsWithCost: 0, newDwellingsTotal: 0, rowsWithDwellings: 0,
  });
  const totals: Record<DaApplicationClass, DaClassTotals> = {
    new: blank(), amendment: blank(), unclassified: blank(),
  };

  const costed: DaSummary['largestByCost'] = [];

  for (const row of rows) {
    const klass = classifyApplicationType(row.ApplicationType);
    const bucket = totals[klass];
    bucket.rows += 1;

    const appType = str(row.ApplicationType) ?? 'Not stated';
    const seen = byApplicationType.get(appType);
    if (seen) seen.count += 1;
    else byApplicationType.set(appType, { klass, count: 1 });

    const status = str(row.ApplicationStatus) ?? 'Not stated';
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);

    const types = (row.DevelopmentType ?? [])
      .map((t) => str(t?.DevelopmentType))
      .filter((t): t is string => t !== null);
    for (const t of types) byType.set(t, (byType.get(t) ?? 0) + 1);

    const cost = num(row.CostOfDevelopment);
    if (cost !== null && cost > 0) {
      bucket.statedCostTotal += cost;
      bucket.rowsWithCost += 1;
      costed.push({
        cost,
        types,
        suburb: str(row.Location?.[0]?.Suburb),
        status: str(row.ApplicationStatus),
        determined: str(row.DeterminationDate)?.slice(0, 10) ?? null,
        lodged: str(row.LodgementDate)?.slice(0, 10) ?? null,
        applicationClass: klass,
      });
    }

    const dwellings = num(row.NumberOfNewDwellings);
    if (dwellings !== null && dwellings > 0) {
      bucket.newDwellingsTotal += dwellings;
      bucket.rowsWithDwellings += 1;
    }
  }

  const sortDesc = <T,>(arr: T[], key: (t: T) => number) =>
    [...arr].sort((a, b) => key(b) - key(a));
  const round = (t: DaClassTotals): DaClassTotals => ({ ...t, statedCostTotal: Math.round(t.statedCostTotal) });

  return {
    councilName,
    periodFrom,
    periodTo,
    totalInPeriod,
    rowsRead: rows.length,
    byStatus: sortDesc([...byStatus.entries()].map(([status, count]) => ({ status, count })), (e) => e.count),
    newApplications: round(totals.new),
    amendments: round(totals.amendment),
    unclassified: round(totals.unclassified),
    byApplicationType: sortDesc(
      [...byApplicationType.entries()].map(([type, v]) => ({ type, klass: v.klass, count: v.count })),
      (e) => e.count,
    ),
    topDevelopmentTypes: sortDesc([...byType.entries()].map(([type, count]) => ({ type, count })), (e) => e.count).slice(0, 6),
    largestByCost: sortDesc(costed, (c) => c.cost).slice(0, 5),
  };
}
