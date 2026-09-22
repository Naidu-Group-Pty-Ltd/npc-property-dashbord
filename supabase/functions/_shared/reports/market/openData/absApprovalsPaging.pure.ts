/**
 * How a register too wide for one invocation is loaded in several.
 *
 * ## The measurement — and the axis it has to be taken on
 *
 * Measured from CI against the Bureau's own bytes, 21 Sep 2026. At SA2 grain
 * — the finest the scorer prices — with the query narrowed to what this
 * register reads:
 *
 *     33 months   111.6 MB   past the ceiling
 *     12 months    26.0 MB   past the ceiling
 *      6 months    12.2 MB   workable
 *
 * **Every one of those is a fact about the WIRE, and the wire is not what
 * binds.** This constant was 6 on the strength of that table, and the first
 * real run in production answered `546` — the edge worker's resource limit —
 * on exactly the six-month window it describes. The download was never the
 * problem: the stage holds the whole body as one string, then every row as an
 * object, then the upsert payload, all live at once.
 *
 * Re-measured 22 Sep 2026 IN THE WORKER, using the explicit operator window
 * the stage already accepts, at SA2 grain against the deployed function:
 *
 *      1 month     5,814 rows   HTTP 200
 *      3 months   17,442 rows   HTTP 200
 *      6 months  ~34,884 rows   HTTP 546
 *
 * 5,814 rows a month, dead flat (17,442 is 5,814 x 3 exactly), so the cliff
 * lies between 17,442 and ~34,884 rows. Three is therefore the largest
 * window PROVEN to fit, and 4 and 5 are deliberately not taken: the failure
 * mode of sitting at an unmeasured edge is a nightly 546 that pg_cron reports
 * as green, which is the one shape this register's own header warns about.
 *
 * The lesson generalises past this file. **A bound must be measured on the
 * quantity that binds** — bytes over the wire answered a different question
 * from resources to process, and the smaller number was the one measured.
 *
 * So a full load is several requests, and `market-sales-ingest` has been one
 * heavy read per invocation since five DCJ workbooks in one call exhausted an
 * edge worker's compute allowance. At three months a walk of the 33 the
 * Bureau holds is eleven nightly pages.
 *
 * ## It pages by PERIOD, and that correction is the point
 *
 * `SUPPLY_EVIDENCE.md` first said SA2 "pages by state", because the SA2
 * code's leading digit is its state. That is true, it is how
 * `stateOfAreaCode` labels a row, and it is useless here: an SDMX key selects
 * EXACT CODES, so asking for one state's SA2s means enumerating three hundred
 * of them in a URL. Reading a state off a code and requesting one are
 * different operations. A period is two parameters whatever the geography.
 *
 * ## Newest first, then backwards — so the frontier is measured, not assumed
 *
 * The newest page is ALWAYS short, because the ABS publishes with a lag: a
 * six-month window asked on 21 Sep 2026 returned four months, to 2026-07.
 * Judging that as a truncated body would refuse every healthy load, and
 * hard-coding "expect two months' lag" is a constant nobody here can verify
 * and that the Bureau can change without telling us.
 *
 * So the FIRST page is read at the frontier and whatever it returns defines
 * `latestPeriod`. Every later page lies wholly in the past, so it must be
 * full — short means truncated, and refuses. The loader learns the lag from
 * the publisher instead of being told it.
 */

/**
 * Three months: the largest window measured to fit at the finest grain, and
 * measured in the WORKER rather than on the wire. See the table above — 6
 * answered HTTP 546 in production on the very window the byte measurement
 * called workable.
 */
export const APPROVALS_PAGE_MONTHS = 3;

export interface ApprovalsPage {
  /** 0 is the frontier page; 1 is the six months before it, and so on. */
  index: number;
  startPeriod: string;
  endPeriod: string;
  /**
   * How many months this page must carry to be believed.
   *
   * Null at the frontier, where the publisher's own lag decides and any
   * answer is the answer. A number everywhere else, because a past window
   * that comes back short is a truncated body.
   */
  minPeriods: number | null;
}

/** `YYYY-MM` arithmetic, with no `Date` and so no timezone to get wrong. */
export function shiftMonth(period: string, by: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!m) throw new Error(`period must be YYYY-MM, not "${period}" — refused`);
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + by;
  if (total < 0) throw new Error(`shifting ${period} by ${by} months goes before year 0 — refused`);
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Inclusive months from `from` to `to`; negative where `to` precedes `from`. */
export function monthSpan(from: string, to: string): number {
  const a = /^(\d{4})-(\d{2})$/.exec(from.trim());
  const b = /^(\d{4})-(\d{2})$/.exec(to.trim());
  if (!a || !b) throw new Error(`both periods must be YYYY-MM ("${from}", "${to}") — refused`);
  return (Number(b[1]) * 12 + Number(b[2])) - (Number(a[1]) * 12 + Number(a[2])) + 1;
}

/**
 * The page a given invocation should read.
 *
 * `frontier` is the newest month the register has seen from this flow, or
 * null on the very first run. Page 0 asks forward from `asOf` and takes what
 * the publisher has; every later page steps back a whole window from the
 * frontier and must be complete.
 */
export function approvalsPage(
  index: number,
  asOf: string,
  frontier: string | null,
  months: number = APPROVALS_PAGE_MONTHS,
): ApprovalsPage {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`page index must be a non-negative integer, not ${index} — refused`);
  }
  if (months < 1) throw new Error(`a page must be at least one month, not ${months} — refused`);

  if (index === 0 || frontier === null) {
    /*
     * The frontier. Asked forward from `asOf` so the request always reaches
     * past what is published — and whatever comes back IS the frontier, with
     * no floor, because the lag belongs to the publisher.
     */
    const start = shiftMonth(asOf, -(months - 1));
    return { index, startPeriod: start, endPeriod: asOf, minPeriods: null };
  }
  const end = shiftMonth(frontier, -((index - 1) * months) - 1);
  const start = shiftMonth(end, -(months - 1));
  return { index, startPeriod: start, endPeriod: end, minPeriods: months };
}

/**
 * How many pages reach back to `floor` from a known frontier, so a run can
 * say what remains rather than leaving an operator to work it out.
 */
export function pagesToCover(
  frontier: string,
  floor: string,
  months: number = APPROVALS_PAGE_MONTHS,
): number {
  const span = monthSpan(floor, frontier);
  if (span <= 0) return 1;
  return Math.max(1, Math.ceil(span / months));
}
