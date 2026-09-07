/**
 * Builder stock — "we never read it" is not "it has no picture".
 *
 * THE REPORT, VERBATIM: the card said "No picture in the documents" with the
 * tooltip "Every document on this row was read and none of them presents a
 * photograph of this property" — about six brochures that each hold a facade
 * render this same extractor elects in about a second. Every one of those
 * statements was false. The worker had died reading them, and the failure was
 * reported as the builder's document being empty.
 *
 * The operator's rule for the fix: a genuine inspected exhaustion may say "no
 * picture in the supplied documents"; an operational retirement must say
 * something else entirely — and neither may ever expose a crash, a memory
 * error, a CPU limit or a retry count to the front end.
 */
import { describe, expect, it } from 'vitest';
import {
  STOCK_IMAGE_PROGRESS_DETAIL, STOCK_IMAGE_PROGRESS_LABEL,
  stockImageProgress, unreadDocumentCount,
} from '../../../supabase/functions/_shared/builderStock/imageProgress.pure';

const settled = { hasImage: false, sourceDocuments: 3, workStage: 'settled' };

describe('the four states a pictureless row can honestly be in', () => {
  it('a row still being worked says so', () => {
    expect(stockImageProgress({ ...settled, workStage: 'source' })).toBe('working');
  });

  it('a row with no documents names the act that would fix it', () => {
    expect(stockImageProgress({ ...settled, sourceDocuments: 0 })).toBe('no_document');
  });

  it('documents READ and empty is the only state that may claim so', () => {
    expect(stockImageProgress({ ...settled, unreadDocuments: 0 })).toBe('none_found');
  });

  it('a document we could not read is its OWN state, never "no picture"', () => {
    expect(stockImageProgress({ ...settled, unreadDocuments: 1 })).toBe('unreadable');
  });

  it('one unread document among several outranks the others being empty', () => {
    // The row has NOT established that its documents name no picture while one
    // of them has never been opened.
    expect(stockImageProgress({ ...settled, sourceDocuments: 4, unreadDocuments: 1 }))
      .toBe('unreadable');
  });
});

describe('what those states are allowed to say out loud', () => {
  it('the unread state never claims the documents were checked', () => {
    const detail = STOCK_IMAGE_PROGRESS_DETAIL.unreadable;
    expect(detail).not.toMatch(/was read|were read|none of them presents/i);
    expect(STOCK_IMAGE_PROGRESS_LABEL.unreadable).not.toMatch(/no picture/i);
  });

  it('and never names a mechanism, a limit or a count', () => {
    // The operator's condition, asserted as a rule rather than trusted: none
    // of this pipeline's vocabulary may reach a builder's screen.
    const forbidden = [
      /crash/i, /memory/i, /\bCPU\b/i, /timed? ?out/i, /timeout/i, /worker/i,
      /isolate/i, /retry|retries|attempt/i, /\b\d+ ?MB\b/i, /resource limit/i,
      /exception/i, /stack/i, /5\d\d\b/,
    ];
    for (const [state, text] of Object.entries(STOCK_IMAGE_PROGRESS_DETAIL)) {
      for (const pattern of forbidden) {
        expect(text, `${state} detail must not match ${pattern}`).not.toMatch(pattern);
      }
    }
    for (const [state, text] of Object.entries(STOCK_IMAGE_PROGRESS_LABEL)) {
      for (const pattern of forbidden) {
        expect(text, `${state} label must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('it tells the reader it is being retried, so the state is not read as final', () => {
    expect(STOCK_IMAGE_PROGRESS_DETAIL.unreadable).toMatch(/automatically/i);
  });

  it('the inspected state keeps its claim, because there it is true', () => {
    expect(STOCK_IMAGE_PROGRESS_DETAIL.none_found).toMatch(/was read|were read/i);
  });
});

describe('counting unread documents from stored provenance', () => {
  const branch = (over: Record<string, unknown>) => ({
    package_reference: 'https://drive.google.com/file/d/x/view',
    source_anchor: null, provenance_version: 23, ...over,
  });

  it('counts a killed branch — the shape the six were left in', () => {
    const stored = { branches: { a: branch({ result: 'package_recovery_attempt', attempts: 4 }) } };
    expect(unreadDocumentCount(stored)).toBe(1);
  });

  it('counts an operational retirement', () => {
    const stored = { branches: {
      a: branch({ result: 'no_deterministic_image', exhaustion: 'operational' }),
    } };
    expect(unreadDocumentCount(stored)).toBe(1);
  });

  it('does NOT count a document that answered', () => {
    const stored = { branches: {
      a: branch({ result: 'no_deterministic_image', exhaustion: 'inspected' }),
      b: branch({ result: 'no_deterministic_image', exhaustion: 'inspected' }),
    } };
    expect(unreadDocumentCount(stored)).toBe(0);
  });

  it('is silent on anything it does not recognise rather than guessing', () => {
    expect(unreadDocumentCount(null)).toBe(0);
    expect(unreadDocumentCount({})).toBe(0);
    expect(unreadDocumentCount({ branches: null })).toBe(0);
    expect(unreadDocumentCount('nonsense')).toBe(0);
  });
});
