/**
 * The recorded figures a condensed report must be written against.
 *
 * `condense-investment-report` hands a model the PARENT'S PROSE and a
 * structure guide demanding tables — Key Market Stats, Investment Score,
 * Score Breakdown, Financial Snapshot — and told it to "copy all numerical
 * values EXACTLY". But a Compass-40 parent deliberately carries no purchase
 * price, yield, loan or cash-flow figures (the tier is the data-minimisation
 * boundary), and it argues its score in prose rather than restating the
 * components. So the model, forced to fill a table from a document that never
 * states the numbers, wrote **N/A** — nineteen times on a real snapshot
 * (1/27D Mitchell Street, 2026-09-04) whose OWN ROW held every one of those
 * figures: score 62, grade B, a complete `financial_calculations` block.
 *
 * This module renders that record into a compact, authoritative facts block
 * for the condense prompt. The caller hands it `projectInvestmentReport`'s
 * result — the same reconciled projection every templated document binds, so
 * the condensed prose and the typeset scorecard around it cannot disagree
 * about a figure; taking the projection rather than performing it keeps this
 * module inside the investment format's closed import set (the
 * source-of-truth suite's rule), and the edge function already holds the
 * projection for its own binding. A metric the record does not hold is
 * simply absent from the block, and the prompt's rule (see the tier guides)
 * is that an absent metric's ROW is omitted — never written as N/A, because
 * a labelled row is a promise that a figure follows.
 */

/** The slice of the investment projection the facts block reads. */
export interface RecordedFactsSource {
  property?: Record<string, unknown>;
  recommendation?: Record<string, unknown>;
  financials?: Record<string, unknown>;
  assumptions?: Record<string, unknown>;
  assessment?: ReadonlyArray<{ label?: unknown; score?: unknown }>;
}

const num = (v: unknown): number | undefined =>
  (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined =>
  (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// Thousands separation without consulting the runtime locale — the same
// prompt is composed in Deno and asserted in Node, and their ICU grouping
// need not agree (the rule `financialEngine.pure.ts` formats under).
const groupThousands = (n: number): string =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const money = (v: unknown): string | undefined => {
  const n = num(v);
  if (n === undefined) return undefined;
  const r = Math.round(n);
  return r < 0 ? `-$${groupThousands(Math.abs(r))}` : `$${groupThousands(r)}`;
};
const pct = (v: unknown): string | undefined => {
  const n = num(v);
  if (n === undefined) return undefined;
  return `${n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`;
};

/**
 * Render the projection's recorded figures as a Markdown facts block, or
 * null when the record carries nothing recordable (nothing is better than an
 * empty heading). Every line is `label: value`; absent facts produce no line.
 */
export function buildRecordedFactsBlock(p: RecordedFactsSource): string | null {
  const rec = (p.recommendation ?? {}) as Record<string, unknown>;
  const fin = (p.financials ?? {}) as Record<string, unknown>;
  const asm = (p.assumptions ?? {}) as Record<string, unknown>;
  const prop = (p.property ?? {}) as Record<string, unknown>;
  const assessment = p.assessment ?? [];

  const lines: string[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value) lines.push(`- ${label}: ${value}`);
  };

  add('Address', str(prop.address));
  add('Property type', str(prop.type));
  add('Configuration', str(prop.configuration));

  add('Investment grade', str(rec.grade));
  add('Investment score', num(rec.score) !== undefined ? `${Math.round(num(rec.score)!)}/100` : undefined);
  add('Recommendation', str(rec.headline) ?? str(rec.action));

  for (const dim of assessment) {
    const label = str(dim.label);
    const score = num(dim.score);
    if (label && score !== undefined) add(`${label} score`, `${Math.round(score)}/100`);
  }

  add('Purchase price', money(fin.purchasePrice));
  add('Weekly rent', money(fin.weeklyRent));
  add('Annual rent', money(fin.annualRent));
  add('Gross yield', pct(fin.grossYield));
  add('Net yield', pct(fin.netYield));
  add('Weekly cash position', money(fin.weeklyNet));
  add('Annual cash position (pre-tax)', money(fin.annualNet));
  add('Loan amount', money(fin.loanAmount));
  add('Annual repayment', money(fin.annualRepayment));
  add('Total acquisition cost', money(fin.totalCost));
  add('Cash-on-cash return', pct(fin.cashOnCash));
  add('Interest rate assumed', pct(asm.interestRate));
  add('Capital growth assumed', pct(asm.capitalGrowth));
  add('Vacancy allowance', pct(asm.vacancy));

  if (!lines.length) return null;
  return [
    'RECORDED FIGURES (authoritative — from this report\'s stored assessment):',
    ...lines,
    '',
    'Every table value in your output MUST come from these recorded figures',
    'or from an explicit figure in the report above. A metric that appears in',
    'neither is OMITTED — drop that table row entirely. Never write "N/A",',
    '"TBD" or a placeholder: a labelled row is a promise that a figure',
    'follows it.',
  ].join('\n');
}
