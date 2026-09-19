/**
 * Two rules that live in the generator's own source, asserted there.
 *
 * Both are about writes to `investment_reports`, and neither can be reached
 * from a unit test without standing up an edge runtime and a database. They are
 * checked by reading the source for the same reason `finalRendererOnEveryFormat`
 * and `neverAPlaceholder` do: the property is structural, and a regression here
 * is silent in production for as long as it takes somebody to notice a report
 * that never finishes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GENERATOR = resolve(
  __dirname,
  '../../../../supabase/functions/generate-investment-report/index.ts',
);
const source = readFileSync(GENERATOR, 'utf8');

describe('the budget hand-off', () => {
  it('writes the row only when the invocation banked something durable', () => {
    // `investment_reports` carries a BEFORE UPDATE trigger that stamps
    // `updated_at` on ANY write, and the watchdog claims on
    // `updated_at < now() - interval '2 minutes'`. A write with nothing new in
    // it refreshes that clock and blinds the stall detector — which is exactly
    // what hid the 18 Annabelle Crescent run for 21 minutes.
    expect(source).toContain('mayTouchRow(progress)');
    // And it must classify progress BEFORE deciding, not infer it afterwards.
    expect(source).toContain('classifyProgress({');
    expect(source).toContain('sectionsWrittenThisRun: sectionDurationsMs.length');
  });

  it('reports a no-progress hand-off as an explicit state', () => {
    expect(source).toContain('durableProgress: handoff.durableProgress');
    expect(source).toContain('noProgressReason');
  });

  it('never revives a run the operator stopped', () => {
    // A run already in flight when Stop is pressed lands its write afterwards.
    // The watchdog claims exactly `status = 'processing'`, so re-writing that
    // over a cancellation resurrects work a person explicitly stopped.
    const handoffWrite = source.slice(source.indexOf('=== BUDGET HANDOFF ==='));
    expect(handoffWrite).toContain(".in('status', ['pending', 'processing'])");
  });
});

describe('every acquisition call is bounded by the run clock', () => {
  const ACQUISITION_SERVICES = [
    'sqm-rent-service',
    'financial-calculator-service',
    'financial-validation-service',
    'location-intelligence-service',
    'investment-scoring-service',
    'school-data-service',
  ];

  it.each(ACQUISITION_SERVICES)('%s goes through acquisitionFetch', (service) => {
    const callPattern = new RegExp(
      `await (fetch|acquisitionFetch)\\(\`\\$\\{Deno\\.env\\.get\\('SUPABASE_URL'\\)\\}/functions/v1/${service}\``,
      'g',
    );
    const calls = source.match(callPattern) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // A bare `fetch` here has no AbortSignal and no share of the run's clock,
      // which is how one slow provider consumed a whole invocation.
      expect(call).toContain('acquisitionFetch');
    }
  });

  it('refuses to start a call with no window rather than calling it anyway', () => {
    expect(source).toContain('acquisitionWindowMs(acquisitionBudgetFor(callClass))');
    expect(source).toContain('NO_WINDOW_STATUS');
  });

  it('reserves room for the section loop and for persisting the checkpoint', () => {
    expect(source).toContain('sectionReserveMs: SECTION_MIN_CALL_WINDOW_MS');
    expect(source).toContain('checkpointReserveMs: ACQUISITION_CHECKPOINT_RESERVE_MS');
  });
});
