/**
 * A partner who cannot sign in yet must not be a dead end.
 *
 * Onboarding a new finance partner used to mean: create the contact, build the
 * agreement, discover at step 8 that "digital issue needs a partner portal
 * login", abandon the agreement, find the partner in another section, invite
 * them, wait for them to accept, come back. The document that prompted the
 * invitation sat in `approved_for_issue` for the whole of it.
 *
 * An agreement is addressed to the partner ORGANISATION
 * (`finance_agent_contact_id`) and the portal resolves what a partner may see
 * by that same id — so a document issued before anybody has a login is already
 * addressed correctly. It is unread, not misfiled. These tests hold the three
 * facts that makes true:
 *
 *  - who can actually sign in, which `is_active` never answered;
 *  - that only a deliberate revocation blocks a digital issue;
 *  - that "issued" and "issued to somebody who cannot open it" stay tellable
 *    apart, because they mean opposite things about whose move it is.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PARTNER_ACCESS_LABELS,
  PARTNER_ACCESS_NOTES,
  agreementDelivery,
  agreementDeliveryNote,
  canPartnerSignIn,
  partnerIssueGate,
  partnerNotificationsAddressable,
  partnerPortalAccess,
  type PartnerPortalAccess,
} from '@/lib/agreements';

const ISSUED = '2026-08-11T00:00:00Z';
const ALL: PartnerPortalAccess[] = ['none', 'invited', 'active', 'revoked'];

describe('who can actually sign in', () => {
  it('has no access at all without a portal user row', () => {
    expect(partnerPortalAccess({ row: null })).toBe('none');
  });

  it('reads an invitation that has been sent as invited, not connected', () => {
    // `finance-portal-invite` sets `is_active: true` at the moment the email
    // goes out, with no password yet. Reading that as "connected" is what let
    // the wizard show "Portal connected" for somebody who had never opened it.
    expect(partnerPortalAccess({
      row: { is_active: true, password_hash: null, invite_sent_at: ISSUED, invite_accepted_at: null },
    })).toBe('invited');
  });

  it('needs a credential before it will say active', () => {
    expect(partnerPortalAccess({
      row: { is_active: true, password_hash: 'argon2id$...', invite_accepted_at: ISSUED },
    })).toBe('active');
  });

  it('treats an empty password hash as no credential', () => {
    expect(partnerPortalAccess({ row: { is_active: true, password_hash: '' } })).toBe('invited');
  });

  it('reads a revocation as revoked even though a credential exists', () => {
    expect(partnerPortalAccess({
      row: { is_active: false, revoked_at: ISSUED, password_hash: 'argon2id$...' },
    })).toBe('revoked');
  });

  it('reads a deactivated row as revoked without an explicit revoked_at', () => {
    // The pair `finance-portal-login` refuses on. A row the portal will not
    // admit must not be described here as one it would.
    expect(partnerPortalAccess({
      row: { is_active: false, revoked_at: null, password_hash: 'argon2id$...' },
    })).toBe('revoked');
  });

  it('returns to active on reinstatement, and to invited if never accepted', () => {
    expect(partnerPortalAccess({
      row: { is_active: true, revoked_at: null, password_hash: 'argon2id$...' },
    })).toBe('active');
    expect(partnerPortalAccess({
      row: { is_active: true, revoked_at: null, password_hash: null },
    })).toBe('invited');
  });

  it('says yes to signing in for exactly one state', () => {
    expect(ALL.filter(canPartnerSignIn)).toEqual(['active']);
  });
});

describe('what may still be issued', () => {
  it('lets an agreement go to a partner with no login at all', () => {
    expect(partnerIssueGate('none').ok).toBe(true);
  });

  it('lets an agreement go to a partner who has been invited', () => {
    expect(partnerIssueGate('invited').ok).toBe(true);
  });

  it('refuses only a deliberate revocation, and names its own remedy', () => {
    const gate = partnerIssueGate('revoked');
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('partner_portal_access_revoked');
    // Not "invite them first" — they were not merely un-onboarded, somebody
    // took their access away, and the message has to point at that.
    expect(gate.message).toMatch(/reinstate/i);
  });
});

describe('where a notification can be addressed', () => {
  it('can address an invited partner — the row exists to hold it', () => {
    expect(partnerNotificationsAddressable('invited')).toBe(true);
    expect(partnerNotificationsAddressable('active')).toBe(true);
  });

  it('cannot address a partner with no row; activation has to sweep instead', () => {
    expect(partnerNotificationsAddressable('none')).toBe(false);
  });

  it('does not address a revoked partner', () => {
    expect(partnerNotificationsAddressable('revoked')).toBe(false);
  });
});

describe('whether the counterparty can reach an issued agreement', () => {
  it('is not_issued before it is issued, whatever the access', () => {
    for (const access of ALL) {
      expect(agreementDelivery(null, access)).toBe('not_issued');
    }
  });

  it('is delivered once issued to a partner who can sign in', () => {
    expect(agreementDelivery(ISSUED, 'active')).toBe('delivered');
  });

  it('is awaiting_activation when issued to a partner who cannot yet', () => {
    expect(agreementDelivery(ISSUED, 'none')).toBe('awaiting_activation');
    expect(agreementDelivery(ISSUED, 'invited')).toBe('awaiting_activation');
  });

  it('is access_revoked when the partner was cut off after issue', () => {
    expect(agreementDelivery(ISSUED, 'revoked')).toBe('access_revoked');
  });

  it('says something only when the ordinary reading would be wrong', () => {
    // "Awaiting partner" and "awaiting a partner who cannot open it" look
    // identical in the status badge and mean opposite things about whose move
    // it is. The delivered case needs no gloss.
    expect(agreementDeliveryNote('delivered')).toBe('');
    expect(agreementDeliveryNote('not_issued')).toBe('');
    expect(agreementDeliveryNote('awaiting_activation')).toMatch(/AML\/CTF/);
    expect(agreementDeliveryNote('access_revoked')).toMatch(/reinstated/i);
  });
});

describe('one vocabulary for every surface', () => {
  it('labels and explains all four states', () => {
    for (const access of ALL) {
      expect(PARTNER_ACCESS_LABELS[access]).toBeTruthy();
      expect(PARTNER_ACCESS_NOTES[access].length).toBeGreaterThan(20);
    }
  });

  it('never tells a user that an issue is unavailable when it is not', () => {
    // The sentence this replaced said digital issue was "unavailable until they
    // are invited" and offered no way to invite them. Both halves were wrong.
    for (const access of ['none', 'invited'] as const) {
      expect(PARTNER_ACCESS_NOTES[access]).not.toMatch(/unavailable/i);
      expect(PARTNER_ACCESS_NOTES[access]).toMatch(/still issue/i);
    }
  });
});

describe('the server no longer refuses what the wizard now offers', () => {
  const issueRoute = readFileSync(
    join(process.cwd(), 'supabase/functions/manage-partner-agreements/index.ts'), 'utf8',
  );

  it('has dropped the hard block on a missing portal login', () => {
    // The 422 the wizard was mirroring. If it comes back, the button in the
    // wizard becomes a lie rather than a feature.
    expect(issueRoute).not.toContain('partner_portal_not_connected');
  });

  it('decides with the shared authority rather than reading is_active again', () => {
    expect(issueRoute).toContain('partnerIssueGate(access)');
    expect(issueRoute).toContain('agreementDelivery(');
  });

  it('reports the delivery state back so the caller can say which happened', () => {
    expect(issueRoute).toMatch(/partner_portal_access: access/);
  });
});

describe('a document issued before the login existed still arrives', () => {
  const sweep = readFileSync(
    join(process.cwd(), 'supabase/functions/_shared/agreements/pendingDelivery.ts'), 'utf8',
  );

  it('runs on both activation paths', () => {
    // `accept-invite` covers the ordinary invitation. `login` covers the
    // temp-password path, which never visits accept-invite at all, and any
    // agreement issued between an invitation and the first sign-in.
    for (const fn of ['finance-portal-accept-invite', 'finance-portal-login']) {
      const source = readFileSync(join(process.cwd(), `supabase/functions/${fn}/index.ts`), 'utf8');
      expect(source).toContain('deliverPendingAgreementNotifications');
    }
  });

  it('subtracts what the partner has already been told, so it can run on every login', () => {
    expect(sweep).toContain('announced.has');
    expect(sweep).toMatch(/notification_type[\s\S]{0,120}agreement_awaiting_you/);
  });

  it('asks the agreements what is waiting rather than keeping a second copy', () => {
    expect(sweep).toContain('PARTNER_VISIBLE_STATUSES');
    expect(sweep).toContain("from('partner_agreements')");
  });
});
