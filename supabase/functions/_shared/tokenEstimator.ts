// Token estimation heuristics. Reserve generously — commit reconciles.
//
// UNIT: these are billing credits (the same unit as the token balance, plan
// allowances and top-up packs), NOT raw LLM tokens. One report costs a handful
// of credits. Keep them in this scale so usage stays consistent with the
// plans/packs sold on the Aurixa Systems pricing page — do not paste raw LLM
// token counts (~thousands per report) in here.
import type { TokenKind } from "./missionControl.ts";

const BASE: Record<TokenKind, number> = {
  "report.investment.compass": 12,
  "report.investment.executive": 8,
  "report.investment.snapshot": 4,
  "report.suburb.compass": 10,
  "report.postcode.compass": 10,
  "report.market-intelligence": 6,
  "report.portfolio-review": 8,
  "report.bulk-item": 8, // averaged; caller should override per-item
  "report.chart-analysis": 2,
  "report.qualitative-regen": 3,
  "aml_identity_check": 4,
  "aml_screening_check": 4,
};

export interface EstimateOptions {
  extraSections?: number;       // +20% each
  aiNarrative?: boolean;        // +50%
  multiplier?: number;          // arbitrary multiplier (e.g. bulk count)
}

export function estimateTokens(kind: TokenKind, opts: EstimateOptions = {}): number {
  let n = BASE[kind] ?? 5;
  if (opts.extraSections && opts.extraSections > 0) {
    n = n * (1 + 0.2 * opts.extraSections);
  }
  if (opts.aiNarrative) n = n * 1.5;
  if (opts.multiplier && opts.multiplier > 0) n = n * opts.multiplier;
  return Math.ceil(n);
}

export function estimateBulk(items: Array<{ kind: TokenKind; opts?: EstimateOptions }>): number {
  return items.reduce((sum, it) => sum + estimateTokens(it.kind, it.opts), 0);
}

/** Heuristic for actual usage when no model usage object is returned. */
export function fallbackActual(estimated: number, success: boolean): number {
  // Assume ~80% of estimate on success, 0 on failure (cancel path handles that).
  return success ? Math.ceil(estimated * 0.8) : 0;
}
