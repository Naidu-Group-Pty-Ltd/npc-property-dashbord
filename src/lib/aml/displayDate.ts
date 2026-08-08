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

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/**
 * "8 minutes ago" for a case header, where the useful question is how stale
 * the record is rather than which calendar day it was touched. Falls back to
 * the same em dash as the others, and to "just now" inside a minute — never
 * a spurious "0 minutes ago".
 */
export function displayRelative(
  value: string | number | Date | null | undefined,
  fallback = "—",
  now: Date = new Date(),
): string {
  const parsed = parse(value);
  if (!parsed) return fallback;
  const deltaMs = parsed.getTime() - now.getTime();
  const abs = Math.abs(deltaMs);
  if (abs < 60 * 1000) return "just now";
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return format.format(Math.round(deltaMs / ms), unit);
  }
  return "just now";
}
