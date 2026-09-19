/**
 * Running independent acquisition work concurrently, without flooding anyone.
 *
 * The deadline arithmetic lives in `acquisitionBudget.pure.ts` and is applied
 * by the generator's own `fetchWithTimeout`, which already carries the circuit
 * breaker — deliberately NOT duplicated here, because two fetch wrappers is how
 * one of them stops getting the fixes.
 */

/**
 * Run independent operations concurrently, bounded.
 *
 * Only ever hand this work that does not need another task's result and does
 * not write the same row. The acquisition phase has plenty of both kinds, and
 * parallelising a dependent pair is how a run starts reading its own half-built
 * state.
 *
 * The limit keeps us inside providers' own concurrency tolerance and inside
 * this deployment's shared NAT egress — the Overpass mirror already taught us
 * that a free endpoint which answers in two seconds will queue the same query
 * past twenty-five an hour later when it is asked too much at once.
 */
export async function runBounded<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  if (tasks.length === 0) return [];
  const safeLimit = Math.max(1, Math.min(limit, tasks.length));
  const results = new Array<T>(tasks.length);
  let next = 0;

  const workers = Array.from({ length: safeLimit }, async () => {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  });

  await Promise.all(workers);
  return results;
}

/** How many acquisition calls may be in flight at once. */
export const ACQUISITION_CONCURRENCY = 4;
