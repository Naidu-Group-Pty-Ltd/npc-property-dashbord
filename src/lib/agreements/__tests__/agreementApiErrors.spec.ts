/**
 * What the user is told when an Agreement Centre call fails.
 *
 * These exist because of a real incident. Void, Archive and Delete Permanently
 * shipped in the app, were merged, and then every one of them answered
 * `unknown_action` in production — because the Edge Function deploy workflow
 * stops and stays green without a `SUPABASE_ACCESS_TOKEN`, so the browser was
 * running new code against a server that had never heard of those actions.
 *
 * The feature was correct. The message was the problem: a raw slug that reads
 * like a broken feature and sends whoever gets it looking in the wrong place.
 */
import { describe, expect, it } from 'vitest';
import {
  agreementErrorMessage,
  detectSkew,
} from '@/lib/agreements/apiErrors.pure';

describe('detecting a deployment that is behind the app', () => {
  it('recognises an action the server has never heard of', () => {
    expect(detectSkew({ code: 'unknown_action' })).toBe('function_behind');
    // The hook copies the slug into `message` when there is no prose.
    expect(detectSkew({ message: 'unknown_action' })).toBe('function_behind');
  });

  it('recognises a column the migration never created', () => {
    expect(detectSkew({ code: '42703' })).toBe('schema_behind');
    expect(detectSkew({ message: 'column partner_agreements.archived_at does not exist' }))
      .toBe('schema_behind');
    expect(detectSkew({ code: '42P01' })).toBe('schema_behind');
  });

  it('leaves an ordinary refusal alone', () => {
    expect(detectSkew({ code: 'not_archivable', message: 'This agreement is still in progress.' }))
      .toBeNull();
    expect(detectSkew({})).toBeNull();
  });
});

describe('the sentence shown to the user', () => {
  it('explains an undeployed function instead of printing its slug', () => {
    const message = agreementErrorMessage({ code: 'unknown_action', message: 'unknown_action' });
    expect(message).not.toContain('unknown_action');
    expect(message).toContain('not available on the server yet');
    // Names the artefact an operator has to ship, and says nothing changed.
    expect(message).toContain('manage-partner-agreements');
    expect(message).toContain('Nothing was changed');
  });

  it('explains an unapplied migration', () => {
    const message = agreementErrorMessage({
      code: '42703',
      message: 'column partner_agreements.archived_at does not exist',
    });
    expect(message).toContain('migration');
    expect(message).toContain('Nothing was changed');
  });

  it('keeps a refusal the server wrote for a person', () => {
    // The disposition refusals name the alternative — never paraphrase them.
    const written = 'This agreement has been issued to the partner, so the register has to keep it. Archive it instead.';
    expect(agreementErrorMessage({ code: 'already_issued', message: written })).toBe(written);
  });

  it('never shows a bare slug, even one it has no wording for', () => {
    const message = agreementErrorMessage({ code: 'some_new_refusal', message: 'some_new_refusal' });
    expect(message).not.toBe('some_new_refusal');
    expect(message).toContain('some new refusal');
    expect(message).toContain('Nothing was changed');
  });

  it('copes with a failure carrying nothing at all', () => {
    expect(agreementErrorMessage({})).toContain('rejected this action');
  });
});
