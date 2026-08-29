/**
 * BUILDER STOCK — ONE PROPERTY'S FAILURE MUST COST ONE PROPERTY.
 *
 * PRODUCTION, 29 AUGUST 2026. Upload `d49ca895` imported 23 properties at
 * 01:53:54. Twenty-six hours later the imagery walk had reached item 13 of 23,
 * and items 14 to 23 — Lot 13 Hummock Rise and Lot 1663 Ringer Street among
 * them — had never been read even once. In one seventeen-minute window the
 * settler logged SIX `CPU Time exceeded` kills, TEN `lease_held` skips and NOT
 * ONE completed tick:
 *
 *     02:19:09  CPU Time exceeded      (claimed the lease, killed, no release)
 *     02:20:01  lease_held
 *     02:21:01  lease_held
 *     02:22:08  lease claim: canceling statement due to statement timeout
 *     02:23:07  CPU Time exceeded
 *     02:24:01  lease_held
 *     ...
 *
 * Two structures produce that between them. `repairSourceImagesForUpload` walks
 * an upload's items `ORDER BY created_at ASC` with NO CURSOR and ends the whole
 * run on the first cap it hits, so the next tick starts again from row 1 and
 * every property behind the expensive one waits for ever. And the lease is ONE
 * BOOLEAN ROW for the whole deployment, held 120 seconds — a killed worker runs
 * no `finally`, so it holds that row until it expires and the queue is shut for
 * everybody.
 *
 * This migration is the fix's foundation and is INERT: nothing in
 * `supabase/functions/**` reads it yet. It ships and is applied first so the
 * edge code that needs it can never arrive before the capability does — the
 * failure that took the marketplace down on 29 August, when a settler requiring
 * `claim_builder_stock_settlement_lease` auto-deployed on `main` while its
 * migration was still waiting to be dispatched by hand.
 *
 * WHY THESE ARE TEXT TESTS. The rules live in SQL and this repository has no
 * in-process Postgres, so they are asserted against the REAL MIGRATION TEXT —
 * the same approach, for the same reason, as `builderStockCronGate.test.ts` and
 * `builderStockAutoSourceDrain.test.ts`.
 *
 * The BEHAVIOUR was verified separately, against the live database: the DDL and
 * all three functions were applied inside a transaction over the real 23 rows
 * and rolled back, and seven assertions passed — two claims never overlap
 * (a=3, b=3, 6 distinct), the attempt count is raised in the claim, a claimed
 * property is not claimable again (17 of 23), the backoff doubles to 60s on the
 * second claim, the same stage keeps the count, a stage change resets it to 0,
 * and a settled property leaves the queue (22 of 23). Nothing leaked: 0 columns
 * and 0 functions remained afterwards.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATION =
  'supabase/migrations/20261019000000_builder_stock_item_work_claim.sql';
const sql = readFileSync(join(REPO_ROOT, MIGRATION), 'utf8');

/**
 * The migration with its prose removed.
 *
 * The comments deliberately NAME the package machinery, to explain why the
 * generic counter must never stand in for it. Asserting over the raw file
 * would therefore fail on the very sentence that states the rule, so the
 * "touches nothing" tests read the executable SQL alone.
 */
const executable = sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

/** The body of one named function as shipped. */
const bodyOf = (name: string) => {
  const at = sql.indexOf(`FUNCTION public.${name}`);
  expect(at).toBeGreaterThan(-1);
  const start = sql.indexOf('AS $$', at);
  const end = sql.indexOf('$$;', start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
};

describe('the claim removes head-of-line blocking', () => {
  it('claims with FOR UPDATE SKIP LOCKED, which is the whole mechanism', () => {
    // A row another transaction holds is STEPPED OVER rather than waited for.
    // That is what makes a property being worked on — or one whose worker was
    // killed and whose lease has not expired — simply absent from anyone
    // else's answer, instead of a wall the queue forms behind.
    expect(bodyOf('claim_builder_stock_image_work')).toMatch(/FOR UPDATE SKIP LOCKED/);
  });

  it('is the pattern this repository already uses, not a second invention', () => {
    const precedent = readFileSync(join(REPO_ROOT,
      'supabase/migrations/20260803162826_listing_enrichment.sql'), 'utf8');
    // `claim_listing_enrichment` solves exactly this shape for listing
    // enrichment. Every load-bearing element is the same one.
    for (const element of ['FOR UPDATE SKIP LOCKED', 'next_attempt_at', 'attempt_count']) {
      expect(precedent).toContain(element);
    }
    const claim = bodyOf('claim_builder_stock_image_work');
    expect(claim).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(claim).toMatch(/image_work_next_attempt_at/);
    expect(claim).toMatch(/image_work_attempts/);
  });

  it('skips a property whose lease is still live', () => {
    expect(bodyOf('claim_builder_stock_image_work'))
      .toMatch(/image_work_claim_until IS NULL OR c\.image_work_claim_until < now\(\)/);
  });

  it('never offers an archived or already-settled property', () => {
    const claim = bodyOf('claim_builder_stock_image_work');
    expect(claim).toMatch(/lifecycle_status = 'active'/);
    expect(claim).toMatch(/image_work_stage <> 'settled'/);
  });
});

describe('the attempt is durable because a kill runs no finally', () => {
  it('raises the attempt count INSIDE the claim, before any work', () => {
    /*
     * The counter has to commit with the claim. An invocation killed on a
     * resource limit emits no throw, no `finally` and no response, so a
     * counter written after the work is a counter a kill can never reach —
     * which is why Lot 104 sat at `attempts: 1` for a day while every tick
     * re-entered it.
     */
    expect(bodyOf('claim_builder_stock_image_work'))
      .toMatch(/image_work_attempts = i\.image_work_attempts \+ 1/);
  });

  it('pushes the next attempt out in the same statement', () => {
    const claim = bodyOf('claim_builder_stock_image_work');
    expect(claim).toMatch(/image_work_next_attempt_at = now\(\) \+ make_interval/);
    // Doubling from 30s, capped at an hour: long enough that a property which
    // kills its worker stops monopolising the queue, short enough that a
    // transient failure is not parked for a day.
    expect(claim).toMatch(/least\(30 \* power\(2,[^)]*\)[^,]*, 3600\)/);
  });
});

describe('the generic attempt count is NOT a package retirement counter', () => {
  it('resets when the stage changes, so it is stage-scoped by construction', () => {
    /*
     * A property legitimately needs several claims to move through its stages.
     * The dangerous operation that must be retired after a fixed number of
     * attempts is the linked-package recovery, and it counts ITSELF — in
     * `source_provenance_result`, keyed by provenance version, package
     * reference and source anchor, at MAX_PACKAGE_ATTEMPTS = 2, written before
     * the download begins. Spending that allowance on an eligibility sweep or
     * a Street View call would retire a package nobody had opened.
     */
    expect(bodyOf('complete_builder_stock_image_work')).toMatch(
      /WHEN p_next_stage IS NOT NULL AND p_next_stage IS DISTINCT FROM i\.image_work_stage\s*\n?\s*THEN 0/);
  });

  it('leaves the package attempt machinery completely alone', () => {
    // Not one of these appears in this migration. The package counter is the
    // edge code's, unchanged, and this must never become a second opinion
    // about when a package has had its chances.
    for (const untouched of [
      'source_provenance_result', 'package_recovery_attempt', 'enrichment_status',
    ]) {
      expect(executable).not.toContain(untouched);
    }
  });

  it('says in the file itself that the counter must never retire a package', () => {
    // The rule is only as durable as its reason. A future reader reaching for
    // a ready-made attempt counter has to meet this first.
    expect(sql).toMatch(/NOT A RETIREMENT COUNTER AND MUST NEVER BE USED AS ONE/);
  });
});

describe('the scheduler can tell "nothing due" from "nothing left"', () => {
  it('answers both counts, because they license different decisions', () => {
    const pending = bodyOf('builder_stock_image_work_pending');
    // Nothing claimable with work outstanding means every candidate is leased
    // or backing off — keep the job alive and do nothing this minute. Nothing
    // outstanding means the job may retire. Collapsing the two is how a sweep
    // goes permanently quiet with work still to do.
    expect(pending).toMatch(/claimable/);
    expect(pending).toMatch(/count\(\*\) AS outstanding/);
  });
});

describe('the schema is hardened and inert', () => {
  it('revokes every function from PUBLIC first, then anon and authenticated', () => {
    /*
     * `CREATE FUNCTION` grants EXECUTE to PUBLIC and `anon` inherits it, so a
     * SECURITY DEFINER function ships reachable by the publishable key in the
     * browser bundle until PUBLIC is revoked. Revoking from `anon` alone is a
     * no-op — the RLS-W5 lesson. These three write to stock rows.
     */
    for (const fn of [
      'claim_builder_stock_image_work',
      'complete_builder_stock_image_work',
      'builder_stock_image_work_pending',
    ]) {
      const revoke = new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*FROM PUBLIC, anon, authenticated`);
      expect(sql).toMatch(revoke);
      expect(sql).toMatch(new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*TO postgres, service_role`));
    }
  });

  it('pins search_path on every SECURITY DEFINER function', () => {
    const definers = sql.match(/SECURITY DEFINER/g) ?? [];
    const pinned = sql.match(/SET search_path = public, pg_temp/g) ?? [];
    expect(definers.length).toBe(3);
    expect(pinned.length).toBe(definers.length);
  });

  it('is additive only — it drops and rewrites nothing', () => {
    // An inert migration that drops something is not inert. Applying this to
    // production before its edge code exists has to be a no-op for behaviour.
    expect(executable).not.toMatch(/\bDROP\s+(TABLE|COLUMN|FUNCTION|TRIGGER|INDEX)\b/i);
    expect(executable).not.toMatch(/\bDELETE FROM\b/i);
    expect(executable).not.toMatch(/\bTRUNCATE\b/i);
    // The only UPDATEs are the ones inside the two claim functions.
    expect((executable.match(/\bUPDATE public\.builder_stock_items\b/g) ?? []).length).toBe(2);
  });

  it('adds every column IF NOT EXISTS, so re-applying is safe', () => {
    const added = sql.match(/ADD COLUMN IF NOT EXISTS image_work_\w+/g) ?? [];
    expect(added.length).toBe(7);
  });

  it('is not referenced by any edge function yet', () => {
    /*
     * THE DEPLOYMENT RULE, ASSERTED. Edge functions ship automatically when
     * `main` moves; migrations here are dispatched by hand. A PR that adds the
     * schema and the code that needs it in one step is a PR that can deploy
     * the code first — which is exactly what answered 503 on every settler
     * tick and blanked the marketplace on 29 August. This test fails the
     * moment somebody wires the two together in this migration's own PR.
     */
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const hits = execSync(
      'grep -rl "claim_builder_stock_image_work\\|complete_builder_stock_image_work\\|'
      + 'builder_stock_image_work_pending\\|image_work_stage" supabase/functions/ || true',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim();
    expect(hits).toBe('');
  });
});
