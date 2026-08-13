/**
 * Flag-off classification — the server's `passport_disabled` answer must
 * always read as "disabled", never as an error, on every Passport surface.
 *
 * This is the unit-level half of the flag-off acceptance. The render-level
 * half is CommandPassportSection.test.tsx ("renders NOTHING when the server
 * answers passport_disabled"). The client booklet's rejection path uses the
 * same classifier, asserted here rather than through a page render: a
 * mocked rejection inside the full PortalPassport graph is mis-attributed
 * as an unhandled error by the runner even when demonstrably caught
 * (verified by instrumentation; minimal reproductions of the same state
 * machine, the same JSX and the same mock all pass), so the page suite
 * covers the resolved paths and this file pins the rejection semantics.
 */
import { describe, expect, it } from 'vitest';
import { classifyPassportLoadFailure } from './loadState';

describe('classifyPassportLoadFailure', () => {
  it('treats the server disabled answer as disabled, not an error', () => {
    expect(classifyPassportLoadFailure(new Error('The Compliance Passport is not available yet.')).kind)
      .toBe('disabled');
    expect(classifyPassportLoadFailure(new Error('The Compliance Passport view is not available.')).kind)
      .toBe('disabled');
    expect(classifyPassportLoadFailure(new Error('passport_disabled')).kind).toBe('disabled');
  });

  it('treats anything else as an error to surface with retry', () => {
    expect(classifyPassportLoadFailure(new Error('network unreachable')).kind).toBe('error');
    expect(classifyPassportLoadFailure('boom').kind).toBe('error');
  });

  it('never throws on non-Error inputs', () => {
    expect(classifyPassportLoadFailure(undefined).kind).toBe('error');
    expect(classifyPassportLoadFailure({ code: 'x' }).kind).toBe('error');
  });
});
