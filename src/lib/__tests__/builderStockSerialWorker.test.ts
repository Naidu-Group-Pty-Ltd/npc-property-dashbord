/**
 * Builder stock — one lease at a time, and the whole document behind one slot.
 *
 * MEASURED, 7 SEPTEMBER 2026, upload `bd7a0ef5` (78 properties):
 *
 *   one 8 MB brochure alone     50–68 MB, elects its facade in ~1 s
 *   five of them concurrently   429 MB peak against a 256 MB ceiling → killed
 *   the upload end to end        161 minutes, 0.48 properties a minute
 *
 * The dispatcher was starting one invocation per outstanding property (capped
 * at ten), so concurrency scaled with the backlog and a large import created
 * maximum memory pressure. Throughput was 20× below that dispatcher's own
 * ceiling because every kill discarded all the work in flight.
 *
 * Both fixes are ORDERING properties — that a claim happens after a
 * completion, that a slot is taken before a text read — and ordering cannot be
 * asserted from outside without a live worker. So they are pinned at the
 * source, in the same spirit as the guard-order tests this repository already
 * keeps for the decode slot.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('the settler claims serially and never pre-claims a batch', () => {
  const settler = read('supabase/functions/builder-stock-image-settler/index.ts');

  it('claims the next property only AFTER completing the previous one', () => {
    // The safety rule the old one-per-invocation shape existed for: claiming
    // A, B, C, D and dying on A strands three leases held by a process that no
    // longer exists. Order is the whole guarantee.
    const loop = settler.slice(settler.indexOf('for (;;) {'));
    const completed = loop.indexOf('await completeItemWork(');
    const claimedNext = loop.indexOf('await claimOneImageWorkItem(');
    expect(completed).toBeGreaterThan(-1);
    expect(claimedNext).toBeGreaterThan(-1);
    expect(completed).toBeLessThan(claimedNext);
  });

  it('claims exactly one property per turn — no batch call anywhere', () => {
    expect(settler).not.toMatch(/claim(Many|Batch|Several)ImageWorkItems?/);
    // One claim inside the loop, one before it. Never a list.
    const claims = settler.match(/claimOneImageWorkItem\(/g) ?? [];
    expect(claims.length).toBe(2);
  });

  it('stops before starting work it cannot finish inside the budget', () => {
    // A linked package may spend up to the recovery deadline before it
    // answers, so starting one with little time left would guarantee the very
    // mid-flight kill this change removes.
    expect(settler).toMatch(/RESERVE_FOR_ANOTHER_MS/);
    expect(settler).toMatch(/if \(Date\.now\(\) > startedAt \+ BUDGET_MS - RESERVE_FOR_ANOTHER_MS\) break;/);
  });
});

describe('the whole heavy PDF path is behind one slot', () => {
  const pkg = read('supabase/functions/_shared/builderStock/packageImages.ts');

  it('takes the slot BEFORE the text read, not just before the election', () => {
    // The hole that let the six die: the text read runs first, parses the same
    // multi-megabyte document (400–1,029 ms against the election's
    // 670–1,215 ms), and was never behind the slot at all.
    const slot = pkg.indexOf('withPdfDecodeSlot');
    const textRead = pkg.indexOf('await readPageTexts(bytes)');
    expect(slot).toBeGreaterThan(-1);
    expect(textRead).toBeGreaterThan(-1);
    expect(slot).toBeLessThan(textRead);
  });

  it('uses the non-re-entrant election inside it, or the slot self-deadlocks', () => {
    expect(pkg).toMatch(/selectPdfPropertyPrimaryHoldingSlot\(bytes/);
    // The wrapping variant would take the slot a second time in one call
    // stack, which is a deadlock rather than a bound.
    expect(pkg).not.toMatch(/await selectPdfPropertyPrimary\(bytes/);
  });

  it('so one document is read end to end before another begins', () => {
    const body = pkg.slice(pkg.indexOf('withPdfDecodeSlot'));
    const textRead = body.indexOf('await readPageTexts(bytes)');
    const election = body.indexOf('selectPdfPropertyPrimaryHoldingSlot(bytes');
    // The closure's own end, searched from after the election so an earlier
    // block's brace cannot stand in for it.
    const close = body.indexOf('\n  });', election);
    expect(textRead).toBeLessThan(election);
    expect(close).toBeGreaterThan(election);
  });
});

describe('concurrency is a property of the runtime, never of the backlog', () => {
  it('the dispatcher starts a fixed small number of workers', () => {
    const migration = read(
      'supabase/migrations/20260907053708_builder_stock_settler_fixed_concurrency.sql');
    expect(migration).toMatch(/v_dispatch := 2;/);
    // The shape that caused the collapse: one worker per outstanding item.
    expect(migration).not.toMatch(/v_dispatch := least\(greatest\(v_item_work/);
  });
});
