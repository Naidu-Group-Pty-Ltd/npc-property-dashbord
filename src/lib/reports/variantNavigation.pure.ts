/**
 * What a report-type button does: open the document, or say it is the one on
 * screen, or offer to create it.
 *
 * The header's Financial / Strategic / Briefing / Snapshot buttons used to
 * GENERATE on every click. Opening a Strategic report that already existed
 * re-forked it (four forks of one Compass in four minutes on 37 Bolin Street,
 * 27 Sep 2026), and asking to look at a Briefing spent a model run. A button
 * that names a document opens it; producing or refreshing a document is an act
 * taken on that document's own page (`InvestmentReportFamilyNotice`).
 *
 * Which child is "the" child matters, because history left some families with
 * more than one row per variant. The engines regenerate the NEWEST in place
 * (`condense-investment-report` orders by `updated_at` descending, the fork
 * finds its own existing row), so the newest is the one a button opens —
 * anything else is how a button comes to show a previous generation beside a
 * notice saying it has been refreshed.
 *
 * Pure: a family in, an action out.
 */
import type { FamilyChild, ReportFamily, SubReportVariant } from '@/lib/reports/investment/subReportFamily.pure';

export type VariantTarget = 'compass' | SubReportVariant;

export type VariantAction =
  /** The report on screen is this one. */
  | { kind: 'here' }
  /** Open an existing report. */
  | { kind: 'open'; reportId: string; stale: boolean; status: string | null }
  /** No such report exists in this family yet; creating it is the only act. */
  | { kind: 'generate' }
  /** The family could not be read, so nothing can be said either way. */
  | { kind: 'unknown' };

const time = (child: FamilyChild): number => {
  const row = child.row ?? {};
  for (const key of ['variant_generated_at', 'updated_at', 'created_at'] as const) {
    const value = row[key];
    if (typeof value === 'string') {
      const t = Date.parse(value);
      if (Number.isFinite(t)) return t;
    }
  }
  return Number.NEGATIVE_INFINITY;
};

/** The newest child of a variant — the one the engines regenerate in place. */
export function currentChildOf(family: ReportFamily, variant: SubReportVariant): FamilyChild | null {
  const candidates = family.children.filter((c) => c.variant === variant);
  if (!candidates.length) return null;
  return candidates.reduce((best, c) => (time(c) > time(best) ? c : best));
}

export function variantAction(
  family: ReportFamily | null | undefined,
  currentReportId: string,
  target: VariantTarget,
): VariantAction {
  if (!family || !family.parentId) return { kind: 'unknown' };
  if (target === 'compass') {
    return family.parentId === currentReportId
      ? { kind: 'here' }
      : { kind: 'open', reportId: family.parentId, stale: false, status: null };
  }
  const child = currentChildOf(family, target);
  if (!child) return { kind: 'generate' };
  // An older duplicate on screen is not "here": the button opens the current one.
  if (child.id === currentReportId) return { kind: 'here' };
  return { kind: 'open', reportId: child.id, stale: child.stale, status: child.status };
}
