/**
 * Compose the Crime & Safety statistics block for the generator prompt from
 * the recorded reading — replacing a template that was fabrication-shaped:
 * `overallRating || 'Medium'`, `ratePer100k || 'X,XXX'`, an invented
 * "Safety Score XX/100" and placeholder trends, all printed whenever the
 * service had nothing to say.
 *
 * Rules:
 *  - counts and their arithmetic only — no score, no rating, no adjective
 *    the data does not carry (a spec bans the old vocabulary);
 *  - every figure sits under the register's own reference period and
 *    source, and a per-100k rate keeps its named denominator;
 *  - QLD's division rows are the partition and its category rows sit
 *    beneath them — the two levels are never summed together;
 *  - law 2: a labelled row is a promise a figure follows it; with no data
 *    the block is one honest line and an instruction not to invent.
 */

interface NumericishReading { [key: string]: unknown }

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const fmtInt = (v: number) => v.toLocaleString('en-AU');
const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v}%`;

export interface CrimePromptInput {
  crimeStatistics?: NumericishReading;
}

export function crimeStatBlocks(input: CrimePromptInput): string {
  const c = input.crimeStatistics;
  const total = num(c?.['totalLast12Months']);
  if (!c || total === null) {
    return 'No recorded-crime register is integrated for this location. State that plainly in one sentence; do NOT print a crime table, a safety score, a rating or an estimated rate.';
  }

  const parts: string[] = [];
  const areaKind = str(c['areaKind']) ?? 'area';
  const area = str(c['area']) ?? '';
  const source = str(c['source']) ?? 'the state register';
  const period = str(c['referencePeriod']) ?? '';

  const prior = num(c['totalPrevious12Months']);
  const changePct = num(c['totalChangePct']);
  const headline = [
    `Recorded offences in ${areaKind} ${area}, ${period}: **${fmtInt(total)}**`,
    prior !== null ? `(previous 12 months: ${fmtInt(prior)}${changePct !== null ? `, ${fmtPct(changePct)}` : ''})` : null,
  ].filter((p): p is string => p !== null).join(' ');
  parts.push(`**Recorded crime (${source}):**\n\n${headline}`);

  const stateCtx = c['stateContext'] as NumericishReading | null | undefined;
  const statePct = num(stateCtx?.['totalChangePct']);
  if (statePct !== null) {
    parts.push(`State-wide movement over the same window: ${fmtPct(statePct)} — a count comparison from the same register.`);
  }

  const rate = c['ratePer100k'] as NumericishReading | null | undefined;
  const rateArea = num(rate?.['area']);
  if (rateArea !== null) {
    const rateState = num(rate?.['state']);
    const denominator = str(rate?.['denominator']) ?? 'denominator not stated';
    parts.push(
      `Rate: ${fmtInt(rateArea)} recorded offences per 100,000 residents` +
      (rateState !== null ? ` (state-wide: ${fmtInt(rateState)})` : '') +
      `. Denominator: ${denominator} — the population vintage differs from the offence window and must be presented with that caveat.`,
    );
  }

  const categories = Array.isArray(c['categories']) ? (c['categories'] as NumericishReading[]) : [];
  const rows = categories
    .map((cat) => {
      const offence = str(cat['offence']);
      const now = num(cat['last12Months']);
      const before = num(cat['previous12Months']);
      if (!offence || now === null) return null;
      const change = num(cat['changePct']);
      return `| ${offence} | ${fmtInt(now)} | ${before !== null ? fmtInt(before) : ''} | ${change !== null ? fmtPct(change) : '—'} |`;
    })
    .filter((r): r is string => r !== null)
    .slice(0, 14);
  if (rows.length > 0) {
    parts.push(
      `| Offence | Last 12 months | Previous 12 months | Change |\n|---|---|---|---|\n${rows.join('\n')}`,
    );
  }
  if (str(c['state']) === 'QLD') {
    parts.push('The first three rows (Offences Against the Person / Against Property / Other Offences) are the register’s own divisions and together make up the total; the rows beneath are categories inside them — never add the two levels together.');
  }

  parts.push(
    'Discuss only the recorded figures above, attributed to their source and reference period. Do NOT compute or assert a safety score, a rating, a ranking, or any figure not in this table; a change percentage is movement in recorded counts, not a statement about safety.',
  );
  return parts.join('\n\n');
}
