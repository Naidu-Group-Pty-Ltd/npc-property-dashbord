import { describe, expect, it } from 'vitest';
import {
  MAX_DELETION_ABSOLUTE,
  MAX_DELETION_SHARE,
  SMALL_TABLE_FLOOR,
  cleanRecordId,
  extractCreatedTime,
  extractLastModified,
  fingerprintRecord,
  orderLooksSorted,
  planReconciliation,
  toCacheRow,
} from '../../supabase/functions/_shared/listingsCache.pure';

const NOW = '2026-08-02T00:00:00.000Z';

describe('cleanRecordId', () => {
  it('accepts an Airtable record id', () => {
    expect(cleanRecordId('rec018CevccTQUqtd')).toBe('rec018CevccTQUqtd');
    expect(cleanRecordId('  rec018CevccTQUqtd  ')).toBe('rec018CevccTQUqtd');
  });

  it('rejects anything that could not be one', () => {
    for (const value of ['', '  ', 'a', null, undefined, 42, {}, 'rec with spaces', 'x'.repeat(80)]) {
      expect(cleanRecordId(value)).toBeNull();
    }
  });
});

describe('extractCreatedTime', () => {
  it("prefers Airtable's own Created Time field", () => {
    expect(
      extractCreatedTime({
        id: 'rec1',
        createdTime: '2020-01-01T00:00:00.000Z',
        fields: { 'Created Time': '2026-06-11T07:18:31.000Z' },
      }),
    ).toBe('2026-06-11T07:18:31.000Z');
  });

  it('falls back through Created, then the record metadata', () => {
    expect(extractCreatedTime({ id: 'r', fields: { Created: '2026-01-02T00:00:00.000Z' } })).toBe(
      '2026-01-02T00:00:00.000Z',
    );
    expect(extractCreatedTime({ id: 'r', createdTime: '2026-01-03T00:00:00.000Z', fields: {} })).toBe(
      '2026-01-03T00:00:00.000Z',
    );
  });

  it('returns null rather than inventing "now" for an undated record', () => {
    // `airtable-proxy` substitutes new Date() here. Copying that would make the
    // record permanently fresh in the cache while Airtable's own 30-day window,
    // which reads the real Created Time, prunes it.
    expect(extractCreatedTime({ id: 'r', fields: {} })).toBeNull();
    expect(extractCreatedTime({ id: 'r' })).toBeNull();
    expect(extractCreatedTime({ id: 'r', fields: { 'Created Time': 'not a date' } })).toBeNull();
  });
});

describe('extractLastModified', () => {
  it('reads either spelling, or null', () => {
    expect(extractLastModified({ fields: { 'Last Modified Time': NOW } })).toBe(NOW);
    expect(extractLastModified({ fields: { 'Last Modified': NOW } })).toBe(NOW);
    expect(extractLastModified({ fields: {} })).toBeNull();
  });
});

describe('fingerprintRecord', () => {
  it('is stable across key ordering, which Airtable does not promise', () => {
    expect(fingerprintRecord({ a: 1, b: 2 })).toBe(fingerprintRecord({ b: 2, a: 1 }));
  });

  it('changes when a value changes', () => {
    expect(fingerprintRecord({ Price: 900_000 })).not.toBe(fingerprintRecord({ Price: 950_000 }));
  });

  it('changes when a field is added or removed', () => {
    expect(fingerprintRecord({ a: 1 })).not.toBe(fingerprintRecord({ a: 1, b: 2 }));
  });

  it('has a stable value for nothing', () => {
    expect(fingerprintRecord(null)).toBe(fingerprintRecord(undefined));
  });
});

describe('toCacheRow', () => {
  it('maps a record onto a row', () => {
    const row = toCacheRow(
      { id: 'rec1', fields: { 'Created Time': '2026-06-11T07:18:31.000Z', Price: 900_000 } },
      'Property Intake Master',
      NOW,
    );
    expect(row).toMatchObject({
      listing_id: 'rec1',
      table_key: 'Property Intake Master',
      created_time: '2026-06-11T07:18:31.000Z',
      last_verified_at: NOW,
    });
    expect(row?.fields).toEqual({ 'Created Time': '2026-06-11T07:18:31.000Z', Price: 900_000 });
  });

  it('drops a record with no usable id rather than caching a broken row', () => {
    expect(toCacheRow({ fields: {} }, 'tbl', NOW)).toBeNull();
    expect(toCacheRow({ id: '' }, 'tbl', NOW)).toBeNull();
  });

  it('tolerates a record with no fields at all', () => {
    expect(toCacheRow({ id: 'rec1' }, 'tbl', NOW)?.fields).toEqual({});
  });
});

/**
 * The reconciliation guard is the one piece of this feature that can destroy
 * data for every user at once, unattended, on a schedule. It gets the most
 * coverage for that reason.
 */
describe('planReconciliation', () => {
  const plan = (over: Partial<Parameters<typeof planReconciliation>[0]> = {}) =>
    planReconciliation({ walkComplete: true, fetchedCount: 1441, previousCount: 1441, ...over });

  it('allows a clean run that saw everything', () => {
    expect(plan()).toMatchObject({ allowed: true, decision: 'reconcile' });
  });

  it('refuses when the walk did not finish', () => {
    // Records the walk never reached are indistinguishable from deleted ones.
    const verdict = plan({ walkComplete: false, fetchedCount: 300 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.decision).toBe('skip_incomplete');
  });

  it('refuses to act on an empty read', () => {
    const verdict = plan({ fetchedCount: 0 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.decision).toBe('skip_empty');
  });

  it('refuses an implausible collapse', () => {
    // 1441 -> 100 fails both allowances: 1341 missing and 93% of the table.
    const verdict = plan({ fetchedCount: 100 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.decision).toBe('skip_implausible');
    expect(verdict.reason).toContain('100 of 1441');
  });

  it('allows the nightly prune it exists to propagate', () => {
    // The whole point. Airtable's automation removes up to 1000 records a night;
    // against 1441 held that is 69% of the table, so a purely proportional guard
    // would refuse it and the cache would silently stop mirroring deletions.
    expect(plan({ fetchedCount: 1441 - 1000 })).toMatchObject({ allowed: true });
    expect(plan({ fetchedCount: 1441 - 50 })).toMatchObject({ allowed: true });
  });

  it('lets a proportionate loss through on a large table', () => {
    // 3000 missing is well past the absolute allowance, but 60% of a 5000-record
    // table is a plausible change rather than a failed read.
    expect(plan({ previousCount: 5000, fetchedCount: 2000 })).toMatchObject({ allowed: true });
  });

  it('refuses only when both allowances are exceeded', () => {
    // Past the absolute allowance but proportionate -> allowed.
    expect(plan({ previousCount: 10_000, fetchedCount: 8_000 })).toMatchObject({ allowed: true });
    // Disproportionate but within the absolute allowance -> allowed.
    expect(plan({ previousCount: 1_000, fetchedCount: 100 })).toMatchObject({ allowed: true });
    // Both exceeded -> refused.
    expect(plan({ previousCount: 10_000, fetchedCount: 500 })).toMatchObject({ allowed: false });
  });

  it('sits the boundary exactly where the constants say', () => {
    const previousCount = 10_000;
    const shareLimit = previousCount * (1 - MAX_DELETION_SHARE);
    expect(plan({ previousCount, fetchedCount: shareLimit })).toMatchObject({ allowed: true });
    expect(plan({ previousCount, fetchedCount: shareLimit - 1 })).toMatchObject({ allowed: false });
    // And the absolute allowance rescues a loss the share test would refuse.
    expect(
      plan({ previousCount: 1_500, fetchedCount: 1_500 - MAX_DELETION_ABSOLUTE }),
    ).toMatchObject({ allowed: true });
  });

  it('allows a first sync, which has no cache to protect', () => {
    expect(plan({ previousCount: null, fetchedCount: 5 })).toMatchObject({
      allowed: true,
      reason: 'first sync for this table',
    });
    expect(plan({ previousCount: 0, fetchedCount: 5 })).toMatchObject({ allowed: true });
  });

  it('skips the proportional test on a table too small for it to mean anything', () => {
    // One record of three is 33%, of two is 50% — proportion is noise down here.
    const verdict = plan({ previousCount: SMALL_TABLE_FLOOR - 1, fetchedCount: 1 });
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toContain('small table');
  });

  it('allows growth without complaint', () => {
    expect(plan({ previousCount: 100, fetchedCount: 400 })).toMatchObject({ allowed: true });
  });

  it('always explains itself', () => {
    for (const input of [
      { walkComplete: false, fetchedCount: 0, previousCount: 10 },
      { walkComplete: true, fetchedCount: 0, previousCount: 10 },
      { walkComplete: true, fetchedCount: 1, previousCount: 1000 },
      { walkComplete: true, fetchedCount: 999, previousCount: 1000 },
    ]) {
      expect(planReconciliation(input).reason.length).toBeGreaterThan(10);
    }
  });
});

describe('orderLooksSorted', () => {
  const at = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();

  it('accepts a newest-first run', () => {
    expect(orderLooksSorted([at(9), at(8), at(7), at(6), at(5)])).toBe(true);
  });

  it('flags a run that lost its ordering', () => {
    // `airtable-proxy` silently retries without the sort when a table rejects
    // the field, and tells the caller nothing.
    expect(orderLooksSorted([at(1), at(9), at(3), at(7), at(2), at(8)])).toBe(false);
  });

  it('tolerates ties and a single stray', () => {
    expect(orderLooksSorted([at(9), at(9), at(8), at(8), at(7), at(6), at(5), at(4), at(3), at(4)])).toBe(true);
  });

  it('still flags a mostly-shuffled run', () => {
    expect(orderLooksSorted([at(3), at(9), at(1), at(8), at(2), at(7), at(4)])).toBe(false);
  });

  it('does not judge a sample too small to judge', () => {
    expect(orderLooksSorted([])).toBe(true);
    expect(orderLooksSorted([at(1), at(9)])).toBe(true);
    expect(orderLooksSorted([null, null])).toBe(true);
  });
});
