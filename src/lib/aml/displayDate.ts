/**
 * Dates for AML surfaces, or an em dash — never the string "Invalid Date".
 *
 * Formatting an absent value directly renders the literal text "Invalid Date",
 * and the AML surfaces were showing exactly that to compliance staff: the
 * canonical workflow-dimension columns are nullable until backfilled, and
 * legacy `aml.identity_checks` rows predate several of the timestamps the newer
 * panels read. Both were seen in a real browser against the staging branch.
 *
 * Two helpers rather than one because the panels genuinely differ: a case
 * header wants a date, an audit line wants a date and a time.
 */

function parse(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Date only, or `fallback` (default "—"). */
export function displayDate(
  value: string | number | Date | null | undefined,
  fallback = "—",
): string {
  const parsed = parse(value);
  return parsed ? parsed.toLocaleDateString() : fallback;
}

/** Date and time, for audit and processing lines. */
export function displayDateTime(
  value: string | number | Date | null | undefined,
  fallback = "—",
): string {
  const parsed = parse(value);
  return parsed ? parsed.toLocaleString() : fallback;
}
