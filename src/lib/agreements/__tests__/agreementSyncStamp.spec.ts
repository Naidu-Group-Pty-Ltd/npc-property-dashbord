/**
 * The cross-portal cursor.
 *
 * The defect this covers was reported as "agreements are not being issued to
 * the Finance Portal" and was not a delivery defect at all — one production
 * agreement went from issued to opened by the partner in eleven seconds. What
 * was missing is that every agreement surface on both sides fetched once, on
 * mount, and never again. An agreement issued into a tab that had been open for
 * an hour was invisible until somebody reloaded, which from the outside is
 * indistinguishable from an agreement that never arrived.
 *
 * So the tests here are about the two ways a cursor silently stops being one:
 * a stamp that fails to move when something the viewer can see has changed
 * (the portal stays stale, which is the original bug), and a stamp that moves
 * when nothing has (every tick refetches everything, which is a self-inflicted
 * load problem on a table both portals read).
 *
 * The last block reads the two edge functions' source. Both had the operation
 * added in the same change, and the partner-scoping predicate in one of them is
 * the only thing standing between a partner's cursor and another partner's
 * agreements — a regression there would leak a count, not a row, which is
 * exactly the sort of thing that survives review.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_SYNC_INTERVAL_MS,
  EMPTY_SYNC_STAMP,
  ISSUER_ATTENTION_STATUSES,
  PARTNER_ATTENTION_STATUSES,
  AGREEMENT_STATUSES,
  agreementPortalReceipt,
  PORTAL_RECEIPT_LABELS,
  PORTAL_RECEIPT_NOTES,
  portalReceiptNeedsAttention,
  stampKey,
  stampsDiffer,
  type AgreementSyncStamp,
  type PortalReceiptState,
} from '@/lib/agreements';

const BASE: AgreementSyncStamp = { count: 3, latest: '2026-08-13T04:00:00Z', openRequests: 1, attention: 2 };

function repoFile(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

describe('stampKey', () => {
  it('is stable for an unchanged stamp', () => {
    expect(stampKey({ ...BASE })).toBe(stampKey({ ...BASE }));
  });

  it('carries all four scalars, so support can read which one moved', () => {
    const key = stampKey(BASE);
    expect(key).toContain('3');
    expect(key).toContain('2026-08-13T04:00:00Z');
    // Four fields, three separators — an opaque digest would pass every other
    // test in this file and be useless in a support conversation.
    expect(key.split(':').length).toBeGreaterThanOrEqual(4);
  });

  it('has a distinct form for "no stamp yet"', () => {
    expect(stampKey(null)).toBe('none');
    expect(stampKey(undefined)).toBe('none');
    expect(stampKey(EMPTY_SYNC_STAMP)).not.toBe('none');
  });
});

describe('stampsDiffer', () => {
  it('is false for an identical stamp — the steady state costs no refetch', () => {
    expect(stampsDiffer(BASE, { ...BASE })).toBe(false);
  });

  it('is false against a null previous — the first poll is a baseline', () => {
    // Otherwise every mount would invalidate the queries it has just fetched,
    // doubling the cost of opening any agreement page.
    expect(stampsDiffer(null, BASE)).toBe(false);
    expect(stampsDiffer(undefined, BASE)).toBe(false);
  });

  it('is false when the current poll produced nothing', () => {
    // A failed poll is not news. Treating it as a change would refetch
    // everything each time the network hiccuped.
    expect(stampsDiffer(BASE, null)).toBe(false);
  });

  it.each([
    ['an agreement arriving', { count: 4 }],
    ['an agreement disappearing', { count: 2 }],
    ['any field or status edit', { latest: '2026-08-13T04:05:00Z' }],
    ['a change request being raised', { openRequests: 2 }],
    ['a change request being answered', { openRequests: 0 }],
    ['something needing this viewer', { attention: 3 }],
  ])('detects %s', (_label, patch) => {
    expect(stampsDiffer(BASE, { ...BASE, ...patch })).toBe(true);
  });

  it('detects the first agreement ever issued to a partner', () => {
    // The empty-to-one transition is the reported scenario, and the one a
    // naive `latest`-only cursor gets wrong: there is no previous timestamp to
    // compare against.
    expect(stampsDiffer(EMPTY_SYNC_STAMP, { count: 1, latest: '2026-08-13T04:00:00Z', openRequests: 0, attention: 1 }))
      .toBe(true);
  });
});

describe('attention statuses', () => {
  it('never puts the same status on both sides', () => {
    // "Needs attention" is a claim about whose move it is. A status counted for
    // both would light an ACTION REQUIRED badge in front of whichever party is
    // actually waiting — the exact failure `AgreementActionCard` was written to
    // avoid for `changes_requested`.
    const overlap = PARTNER_ATTENTION_STATUSES.filter((s) => ISSUER_ATTENTION_STATUSES.includes(s));
    expect(overlap).toEqual([]);
  });

  it('only names statuses the lifecycle actually has', () => {
    for (const status of [...PARTNER_ATTENTION_STATUSES, ...ISSUER_ATTENTION_STATUSES]) {
      expect(AGREEMENT_STATUSES).toContain(status);
    }
  });

  it('leaves terminal statuses out of both', () => {
    for (const status of ['active', 'terminated', 'superseded', 'void', 'withdrawn']) {
      expect(PARTNER_ATTENTION_STATUSES).not.toContain(status);
      expect(ISSUER_ATTENTION_STATUSES).not.toContain(status);
    }
  });

  it('puts the partner\'s own question on the issuer\'s side', () => {
    expect(ISSUER_ATTENTION_STATUSES).toContain('changes_requested');
    expect(PARTNER_ATTENTION_STATUSES).not.toContain('changes_requested');
  });
});

describe('poll interval', () => {
  it('is short enough to feel live and long enough to be free', () => {
    expect(AGREEMENT_SYNC_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
    expect(AGREEMENT_SYNC_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });
});

describe('portal receipt', () => {
  const ISSUED = { issuedAt: '2026-08-13T13:30:52Z', canSignIn: true, notifications: 1, firstViewedAt: null };

  it('says nothing about an agreement that was never issued', () => {
    expect(agreementPortalReceipt({ ...ISSUED, issuedAt: null })).toBe('not_issued');
    // …even if the row somehow carries a notification, which would mean a bug
    // upstream and still is not a claim this function should make.
    expect(agreementPortalReceipt({ ...ISSUED, issuedAt: null, notifications: 3 })).toBe('not_issued');
  });

  it('treats a partner opening the document as the strongest evidence', () => {
    // Stronger than the notification count, which can go to zero when a row is
    // purged and never means the partner did not receive it.
    expect(agreementPortalReceipt({ ...ISSUED, notifications: 0, firstViewedAt: '2026-08-13T13:31:00Z' }))
      .toBe('opened');
  });

  it('separates "no login yet" from "told nobody"', () => {
    // The distinction the whole module exists for. Both have zero
    // notifications; only one is a fault.
    expect(agreementPortalReceipt({ ...ISSUED, notifications: 0, canSignIn: false }))
      .toBe('awaiting_activation');
    expect(agreementPortalReceipt({ ...ISSUED, notifications: 0, canSignIn: true }))
      .toBe('unnotified');
  });

  it('flags only the fault for attention', () => {
    const states: PortalReceiptState[] = [
      'not_issued', 'opened', 'notified', 'awaiting_activation', 'unnotified',
    ];
    expect(states.filter(portalReceiptNeedsAttention)).toEqual(['unnotified']);
  });

  it('names and explains every state', () => {
    const states: PortalReceiptState[] = [
      'not_issued', 'opened', 'notified', 'awaiting_activation', 'unnotified',
    ];
    for (const state of states) {
      expect(PORTAL_RECEIPT_LABELS[state]?.length ?? 0).toBeGreaterThan(0);
      // The note is what somebody reads to decide whether to chase the partner,
      // so a bare label is not enough.
      expect(PORTAL_RECEIPT_NOTES[state]?.length ?? 0).toBeGreaterThan(30);
    }
  });
});

describe('the server halves of the cursor', () => {
  const PARTNER_FN = repoFile('supabase', 'functions', 'finance-portal-agreements', 'index.ts');
  const ISSUER_FN = repoFile('supabase', 'functions', 'manage-partner-agreements', 'index.ts');

  it('both expose the operation the client polls', () => {
    expect(PARTNER_FN).toContain("operation === 'sync'");
    expect(ISSUER_FN).toContain("action === 'sync'");
  });

  it('scopes the partner cursor to the caller\'s own organisation', () => {
    // Everything between `operation === 'sync'` and the response. A count is
    // still a disclosure: without this predicate a partner would learn how many
    // agreements every other partner holds, and watch that number move.
    const block = PARTNER_FN.split("operation === 'sync'")[1]?.split('return json({ stamp })')[0] ?? '';
    expect(block).toContain('finance_agent_contact_id');
    expect(block).toContain('PARTNER_VISIBLE_STATUSES');
    expect(block).toContain("not('issued_at', 'is', null)");
  });

  it('counts only change requests belonging to those agreements', () => {
    const block = PARTNER_FN.split("operation === 'sync'")[1]?.split('return json({ stamp })')[0] ?? '';
    expect(block).toContain("in('agreement_id', ids)");
    // `in.()` on an empty list is not a query PostgREST accepts, and the answer
    // is knowably zero — this guard is why the whole poll does not 500 for a
    // partner who has been sent nothing yet.
    expect(block).toContain('if (ids.length)');
  });

  it('lets the issuer read the cursor without edit rights', () => {
    // `sync` is a read. Gating it behind can_edit would make the register go
    // quiet for every view-only user rather than fail loudly.
    const gate = ISSUER_FN.split('const READ_ACTIONS')[1]?.split(']);')[0] ?? '';
    expect(gate).toContain("'sync'");
  });

  it('reports the outcome of the partner notification rather than discarding it', () => {
    // The regression this guards: `notifyPartner` swallowed its own errors and
    // returned void, so an issue whose notification never wrote produced the
    // same success toast as one that landed.
    expect(ISSUER_FN).toContain('Promise<PartnerNotifyOutcome>');
    expect(ISSUER_FN).toContain('portal_notify: portalNotify');
    expect(ISSUER_FN).toContain("portalNotify === 'failed'");
  });

  it('counts receipts on the key every writer actually sets', () => {
    // `related_entity_id` is null on every agreement notification in
    // production; `metadata->>agreement_id` is set by all three writers. Using
    // the tidier column would report zero for everything.
    expect(ISSUER_FN).toContain("filter('metadata->>agreement_id', 'eq', agreementId)");
  });
});
