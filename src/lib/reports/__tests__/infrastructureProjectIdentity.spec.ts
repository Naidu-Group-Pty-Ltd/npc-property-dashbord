/**
 * One designation, one row — and identity confirmed before anything merges.
 *
 * S5/S6 §9: *"confirm project identity before deduplication"*. Found by
 * executing `buildInfrastructureEvidence` on 18 September 2026, because no
 * retained fixture carries `planningData` at all — all seven predate the
 * planning wiring, so this class cannot be found by replaying them.
 *
 * ## The overlap is exact, not incidental
 *
 * `QLD_INSTRUMENT_LAYERS` queries layers 25, 30, 35 and 40 of
 * `PlanningCadastre/StatePlanning/MapServer` one at a time. The constraint
 * register calls `buildQldStatePlanningIdentify`, which is `identify` on the
 * SAME MapServer with `layers: all` — so those four layers answer it too, and
 * `classify()`'s `has('priority development', 'development area')` branch
 * files the second copy under `growthArea` / `context`.
 *
 * Measured before the fix: one designation, two rows, disagreeing on every
 * cell but the name —
 *
 *   | Maryborough Priority Living Area | Priority development area | Declared  | PLA-MBH |
 *   | Maryborough Priority Living Area | Growth / priority area    | Statutory | Wide Bay Burnett Regional Plan |
 *
 * which is the legacy report's own failure, the one `compassDocumentContract`
 * exists to describe: three copies of one zoning section on one lot,
 * disagreeing on every control.
 *
 * ## Why the merge is narrow
 *
 * Merging on resemblance would delete a real project. So identity is the
 * publisher's own source string plus the publisher's own name, equal after
 * trim, case-fold and whitespace collapse — nothing else, and never across
 * sources.
 */
import { describe, expect, it } from 'vitest';
import { buildInfrastructureEvidence }
  from '../../../../supabase/functions/_shared/planning/infrastructureEvidence.pure';

const QLD = 'Queensland StatePlanning layers (PDAs, SDAs, coordinated projects, infrastructure designations)';

const instrument = (name: string, extra: Record<string, unknown> = {}) => ({
  name, kind: 'priority_development_area', status: 'Declared',
  gazetted: '2023-12-01', detail: 'Fraser Coast', reference: 'PLA-MBH', ...extra,
});
const context = (label: string, extra: Record<string, unknown> = {}) => ({
  kind: 'context', family: 'growthArea', label, standingLabel: 'Statutory',
  currencyDate: '2023-12-01', region: 'Wide Bay Burnett',
  instrument: 'Wide Bay Burnett Regional Plan', source: QLD, licence: 'CC BY 4.0', ...extra,
});
const build = (instruments: unknown[], constraints: unknown[]) => buildInfrastructureEvidence({
  planningData: {
    fetchedAt: '2026-09-18T00:00:00Z',
    developmentInstruments: { status: 'ok', source: QLD, licence: 'CC BY 4.0', instruments },
    constraints,
  },
});

describe('the same designation from both Queensland reads is one row', () => {
  it('drops the identify-all copy and keeps the layer-specific reading', () => {
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Maryborough Priority Living Area')]);
    expect(ev.items).toHaveLength(1);
    const [only] = ev.items;
    // The layer-specific read wins: it parses pda_name / pda_status /
    // gazetted_date, where the identify-all row parses what the server offered.
    expect(only.kind).toBe('Priority development area');
    expect(only.statedStatus).toBe('Declared');
    expect(only.reference).toBe('PLA-MBH');
    expect(only.dateLabel).toBe('Gazetted');
  });

  it('matches through case, padding and collapsed whitespace, and nothing else', () => {
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('  maryborough   PRIORITY living area ')]);
    expect(ev.items).toHaveLength(1);
  });

  it('a different designation is a different project, however alike it reads', () => {
    // One word apart, same publisher, same point. Merging these would delete a
    // real designation, which is the failure §9 names.
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Hervey Bay Priority Living Area')]);
    expect(ev.items).toHaveLength(2);
    expect(ev.items.map((i) => i.name)).toEqual([
      'Maryborough Priority Living Area', 'Hervey Bay Priority Living Area',
    ]);
  });

  it('a shared word is not identity', () => {
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Maryborough')]);
    expect(ev.items).toHaveLength(2);
  });

  it('nothing merges across sources — a different publisher is a different fact', () => {
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Maryborough Priority Living Area', { source: 'Fraser Coast Regional Council' })]);
    expect(ev.items).toHaveLength(2);
    expect(ev.items[1].source).toBe('Fraser Coast Regional Council');
  });

  it('the context row still carries its own source when nothing collided', () => {
    const ev = build([], [context('Wide Bay Burnett Regional Plan', { family: 'regionalPlan' })]);
    expect(ev.items).toHaveLength(1);
    expect(ev.items[0].source).toBe(QLD);
    expect(ev.items[0].kind).toBe('Regional plan');
  });

  it('suppression is silent — a client document never narrates its own production', () => {
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Maryborough Priority Living Area')]);
    // No absence, no coverage note and no reading is manufactured by a merge:
    // a duplicate that was never printed is not something a reader lost.
    expect(ev.absences).toEqual([]);
    expect(ev.readings).toEqual([]);
    expect(ev.anyEvidenced).toBe(true);
  });

  it('the rule is written down where the next reader will look', () => {
    // A merge rule that lives only in a test is one the next change re-opens.
    const src = buildInfrastructureEvidence.toString();
    expect(src).toContain('instrumentIdentities');
  });
});
