/**
 * Reading a stored `property_comparisons` row back into the modal.
 *
 * Exists because of what a timed-out comparison request actually is: the
 * browser aborts at 150s, but the abort never reaches the edge function, which
 * keeps generating, stores the row and charges for it. On 2026-08-26 the row
 * landed 19 seconds after the client gave up, and the person who asked was
 * told "Request timed out" about an analysis that existed. The modal now polls
 * for that row before reporting failure, and these helpers are the one reading
 * of a stored row it shares with the History loader — two readers of the same
 * row disagreeing is how 30 damaged rows once rendered as raw JSON on screen
 * (see docs/reports/COMPARISON.md §12).
 *
 * Pure on purpose: no imports, no client, testable without the component tree.
 */

/** The modal's analysis shape, rebuilt from a stored row's columns. */
export interface RecoveredComparisonAnalysis {
  executiveSummary: string;
  rankings: unknown[];
  financialComparison: Record<string, unknown>;
  locationComparison: Record<string, unknown>;
  riskComparison: Record<string, unknown>;
  investorMatches: unknown[];
  competitiveAdvantages: unknown[];
  redFlags: unknown[];
  finalRecommendation: Record<string, unknown>;
}

/**
 * Rebuild the analysis object the modal renders from a stored row. One
 * mapping, shared by the History loader and the post-timeout recovery, so the
 * two cannot disagree about what a stored row means.
 */
export function analysisFromComparisonRow(row: Record<string, any>): RecoveredComparisonAnalysis {
  return {
    executiveSummary: row.executive_summary || '',
    rankings: Array.isArray(row.rankings) ? row.rankings : [],
    financialComparison: row.financial_comparison || {},
    locationComparison: row.location_comparison || {},
    riskComparison: row.risk_comparison || {},
    investorMatches: Array.isArray(row.investor_matches) ? row.investor_matches : [],
    competitiveAdvantages: [], // Not stored separately
    redFlags: Array.isArray(row.red_flags) ? row.red_flags : [],
    finalRecommendation: row.recommendations || {},
  };
}

/**
 * A stored row this modal can display inline: the structured columns are
 * populated with a ranking of at least two properties — the same "a ranking is
 * what makes it a comparison" rule the producer enforces. A raw-blob row (the
 * columns NULL, the model's text kept whole for salvage) is real but belongs
 * to the viewer, which knows how to read it back.
 */
export function isDisplayableComparisonRow(row: Record<string, any> | null | undefined): boolean {
  return Array.isArray(row?.rankings) && row.rankings.length >= 2;
}

/**
 * Does a stored row's `report_ids` name exactly the reports selected here?
 * Order-insensitive, because the producer stores them in request order and the
 * matcher must not care which card was ticked first.
 */
export function matchesSelectedReportIds(
  rowReportIds: unknown,
  selectedReportIds: readonly string[],
): boolean {
  if (!Array.isArray(rowReportIds)) return false;
  if (rowReportIds.length !== selectedReportIds.length) return false;
  const sortedRow = [...rowReportIds].sort();
  const sortedSelected = [...selectedReportIds].sort();
  return sortedRow.every((id, index) => id === sortedSelected[index]);
}
