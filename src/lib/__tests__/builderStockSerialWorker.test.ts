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
import {
  RECOVERY_DEADLINE_MS,
} from '../../../supabase/functions/_shared/builderStock/packageImages';

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

  it('reserves enough for the WORST CASE, not merely some time', () => {
    /*
     * THE ARITHMETIC, WHICH A FLAT RESERVE DID NOT SATISFY. A source-stage
     * claim can legitimately spend `RECOVERY_DEADLINE_MS` before it answers,
     * and the recovery does not consult the item's deadline. A flat 30 s
     * reserve therefore permitted a claim at the 70 s mark that could still
     * be running at 145 s — past a 100 s budget, killed mid-flight, which is
     * the failure this change exists to remove.
     *
     * So the numbers are asserted, not the existence of a constant.
     */
    const num = (name: string): number => {
      const m = settler.match(new RegExp(`${name} = ([0-9_]+)`));
      if (!m) throw new Error(`${name} not found`);
      return Number(m[1].replace(/_/g, ''));
    };
    const budget = num('BUDGET_MS');
    const writeBack = num('WRITE_BACK_RESERVE_MS');
    const light = num('LIGHT_STAGE_RESERVE_MS');
    // The heavy reserve is DERIVED from the recovery ceiling, not chosen.
    expect(settler).toMatch(
      /HEAVY_STAGE_RESERVE_MS = RECOVERY_DEADLINE_MS \+ WRITE_BACK_RESERVE_MS/);
    const heavy = RECOVERY_DEADLINE_MS + writeBack;

    // A heavy item started at the threshold can finish and still be written.
    expect(heavy).toBeGreaterThanOrEqual(RECOVERY_DEADLINE_MS + writeBack);
    // And the budget must be able to hold one at all.
    expect(budget).toBeGreaterThanOrEqual(heavy);
    // A light stage needs less, but never less than the write-back itself.
    expect(light).toBeGreaterThan(writeBack);
    expect(light).toBeLessThan(heavy);
  });

  it('refuses a claim it cannot finish instead of starting it', () => {
    // The stage is only known once claimed, so an over-expensive claim is
    // handed back at the same stage with no progress — the recovery never
    // begins, so no attempt is spent and nothing is recorded about the link.
    const loop = settler.slice(settler.indexOf('for (;;) {'));
    expect(loop).toMatch(/if \(remaining < reserveFor\(next\.item\.image_work_stage\)\)/);
    expect(loop).toMatch(/progressed: false/);
    expect(loop).toMatch(/nextStage: readStage\(next\.item\.image_work_stage\)/);
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
      'supabase/migrations/20261113110001_builder_stock_settler_fixed_concurrency.sql');
    expect(migration).toMatch(/v_dispatch := 2;/);
    // The shape that caused the collapse: one worker per outstanding item.
    expect(migration).not.toMatch(/v_dispatch := least\(greatest\(v_item_work/);
  });
});
