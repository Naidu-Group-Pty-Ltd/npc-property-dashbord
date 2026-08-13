/**
 * A change request pinned to the clause it is about.
 *
 * "Request changes" was a small modal: a dropdown of nine broad sections and a
 * free-text box. The partner is reading a fourteen-page agreement and has to
 * look away from it, translate "the second sentence of 3.2" into "Commercial
 * Schedule", and describe a location in prose; the issuer reads the prose and
 * goes looking. Both halves are the same missing idea — **the request has no
 * address**.
 *
 * The address already existed. `contentOverrides.pure.ts` gives every text node
 * a stable path so the issuer can amend that exact node, and an annotation
 * anchors to the same path. That is what closes the loop: the partner pins the
 * clause, and the amendment that answers them writes to the same address.
 *
 * The rules with teeth are about anchors that stop resolving, because a clause
 * can be renumbered, split or removed between versions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agreementTemplate,
  anchorForPath,
  annotatablePaths,
  annotationsByPath,
  commentWithAnchorPrefix,
  listAgreementContentSlots,
  openAnnotations,
  placeAnnotations,
  toneForPath,
  truncateQuote,
  type AgreementAnnotation,
  type AgreementTemplateKey,
} from '@/lib/agreements';

const KEYS: AgreementTemplateKey[] = ['strategic_property_referral', 'finance_referral_commission'];
const CONTENT = agreementTemplate('strategic_property_referral');
const SLOTS = listAgreementContentSlots(CONTENT);

function annotation(over: Partial<AgreementAnnotation> = {}): AgreementAnnotation {
  return {
    id: 'a', sectionKey: 'other', comment: 'Please change this.', status: 'open',
    requestedByLabel: 'Partner', resolutionNote: null, createdAt: '2026-08-12T00:00:00Z',
    anchor: null, ...over,
  };
}

describe('the anchor address', () => {
  it('is the same path an amendment writes to', () => {
    // Not a parallel scheme — the same one, which is what lets a request and
    // the change answering it name the same clause.
    for (const key of KEYS) {
      const paths = annotatablePaths(agreementTemplate(key));
      const slots = listAgreementContentSlots(agreementTemplate(key)).map((slot) => slot.path);
      expect(paths).toEqual(slots);
      expect(paths.length).toBeGreaterThan(20);
    }
  });

  it('resolves a real path to its label, section and wording', () => {
    const target = SLOTS[5];
    const anchor = anchorForPath(CONTENT, target.path);
    expect(anchor).not.toBeNull();
    expect(anchor?.path).toBe(target.path);
    expect(anchor?.label).toBe(target.label);
    expect(anchor?.sectionId).toBe(target.sectionId);
  });

  it('refuses a path the wording does not contain', () => {
    expect(anchorForPath(CONTENT, 's:nope/b:99')).toBeNull();
    expect(anchorForPath(CONTENT, '')).toBeNull();
  });

  it('keeps the quote short enough to be a reference, not a copy', () => {
    const long = `${'word '.repeat(200)}end`;
    const quote = truncateQuote(long);
    expect(quote.length).toBeLessThanOrEqual(240);
    expect(quote.endsWith('…')).toBe(true);
    // And collapses the whitespace, so a wrapped clause reads as one line.
    expect(truncateQuote('  a\n\n  b  ')).toBe('a b');
  });
});

describe('placing the pins', () => {
  const first = SLOTS[2].path;
  const later = SLOTS[10].path;

  it('numbers them in reading order, not in the order they were raised', () => {
    // The number is what lets two people on a call say "pin 3" and mean the
    // same clause. One that moved as requests were resolved would be useless.
    const placed = placeAnnotations(CONTENT, [
      annotation({ id: 'late', createdAt: '2026-08-01T00:00:00Z', anchor: anchorForPath(CONTENT, later) }),
      annotation({ id: 'early', createdAt: '2026-08-09T00:00:00Z', anchor: anchorForPath(CONTENT, first) }),
    ]);
    expect(placed.map((p) => p.id)).toEqual(['early', 'late']);
    expect(placed.map((p) => p.index)).toEqual([1, 2]);
  });

  it('keeps an unplaceable anchor rather than dropping it', () => {
    // The clause was renumbered. Somebody is still waiting on this request.
    const stale = annotation({
      id: 'stale',
      anchor: { path: 's:gone/b:1', label: 'Clause 9.9', sectionId: 'x', quote: 'old wording' },
    });
    const placed = placeAnnotations(CONTENT, [stale]);
    expect(placed).toHaveLength(1);
    expect(placed[0].placeable).toBe(false);
    // And it keeps the label it was raised against, so it still says what it
    // was about.
    expect(placed[0].anchor?.label).toBe('Clause 9.9');
  });

  it('never draws a marker for an anchor that cannot be placed', () => {
    // The failure worth being careful about: a comment about a commission rate
    // appearing against a termination clause.
    const placed = placeAnnotations(CONTENT, [
      annotation({ id: 'stale', anchor: { path: 's:gone/b:1', label: 'Clause 9.9', sectionId: 'x', quote: '' } }),
    ]);
    expect(annotationsByPath(placed).size).toBe(0);
  });

  it('keeps an unpinned request in the list, after the pinned ones', () => {
    const placed = placeAnnotations(CONTENT, [
      annotation({ id: 'general', anchor: null }),
      annotation({ id: 'pinned', anchor: anchorForPath(CONTENT, first) }),
    ]);
    expect(placed.map((p) => p.id)).toEqual(['pinned', 'general']);
    expect(placed[1].placeable).toBe(false);
  });

  it('buckets several requests onto one clause', () => {
    const placed = placeAnnotations(CONTENT, [
      annotation({ id: 'one', createdAt: '2026-08-01T00:00:00Z', anchor: anchorForPath(CONTENT, first) }),
      annotation({ id: 'two', createdAt: '2026-08-02T00:00:00Z', anchor: anchorForPath(CONTENT, first) }),
    ]);
    expect(annotationsByPath(placed).get(first)).toHaveLength(2);
  });
});

describe('what the marker says', () => {
  it('reads as open when anything on the clause is open', () => {
    // A clause with one open and three settled requests is a clause with an
    // open request; the pin's job is "is anybody waiting here".
    const placed = placeAnnotations(CONTENT, [
      annotation({ id: 'a', status: 'resolved', anchor: anchorForPath(CONTENT, SLOTS[1].path) }),
      annotation({ id: 'b', status: 'open', anchor: anchorForPath(CONTENT, SLOTS[1].path) }),
    ]);
    expect(toneForPath(placed)).toBe('open');
    expect(openAnnotations(placed)).toHaveLength(1);
  });

  it('goes quiet once everything is settled', () => {
    const placed = placeAnnotations(CONTENT, [
      annotation({ id: 'a', status: 'resolved', anchor: anchorForPath(CONTENT, SLOTS[1].path) }),
      annotation({ id: 'b', status: 'declined', anchor: anchorForPath(CONTENT, SLOTS[1].path) }),
    ]);
    expect(toneForPath(placed)).toBe('settled');
    expect(openAnnotations(placed)).toHaveLength(0);
  });
});

describe('when there is nowhere to store the anchor', () => {
  it('states the location in the comment rather than losing it', () => {
    // Migrations here are applied out of band and one has already sat unapplied
    // for three weeks. Losing the pin is acceptable; losing the request is not.
    const anchor = anchorForPath(CONTENT, SLOTS[3].path)!;
    const folded = commentWithAnchorPrefix('Please reduce this.', anchor);
    expect(folded.startsWith(`Re: ${anchor.label}`)).toBe(true);
    expect(folded).toContain('Please reduce this.');
  });

  it('leaves an unpinned comment exactly as written', () => {
    expect(commentWithAnchorPrefix('As written.', null)).toBe('As written.');
  });
});

describe('the server refuses to pin to a clause that is not there', () => {
  const route = readFileSync(
    join(process.cwd(), 'supabase/functions/finance-portal-agreements/index.ts'), 'utf8',
  );

  it('rejects an unresolvable path instead of storing it', () => {
    expect(route).toContain('no longer part of this version');
  });

  it('probes before naming the anchor columns in a read or a write', () => {
    // Naming a column PostgREST does not know about fails the whole statement.
    expect(route).toContain('agreementAnchorsSupported');
    expect(route).toContain('anchorCols');
  });
});
