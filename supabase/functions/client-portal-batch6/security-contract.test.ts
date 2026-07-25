import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('client onboarding completion replay protection', () => {
  it('notifies finance assignees only after an atomic incomplete-to-complete transition', () => {
    const completionBranch = functionSource.match(
      /if \(operation === 'onboarding_complete'\) \{([\s\S]*?)\n    if \(operation === 'availability_slots'\)/,
    )?.[1];

    expect(completionBranch).toBeDefined();
    expect(completionBranch).toContain("if (step.status === 'complete') return json({ step });");
    expect(completionBranch).toContain(".eq('id', id).neq('status', 'complete').select().maybeSingle()");

    const concurrencyGuard = completionBranch?.indexOf('if (!data)');
    const notification = completionBranch?.indexOf('await notifyFinancePortalAssignees');
    expect(concurrencyGuard).toBeGreaterThan(-1);
    expect(notification).toBeGreaterThan(concurrencyGuard ?? -1);
  });
});
