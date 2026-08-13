/**
 * Whether a finance partner can actually open what we send them — and what to
 * do when they cannot.
 *
 * ## The thing this module exists to separate
 *
 * An agreement is addressed to a **finance contact** (`finance_agent_contact_id`),
 * which is the partner organisation. A login is a **portal user**, which is a
 * person who can sign in. The portal resolves what a partner may see by the
 * contact id, so an agreement issued before the login exists is already
 * addressed correctly — it is simply unread, because nobody can sign in to read
 * it yet.
 *
 * That distinction was collapsed into one boolean, `portal_connected`, and the
 * wizard refused to issue without it. So onboarding a new partner meant: create
 * the contact, leave the agreement in limbo, invite them, wait for them to
 * accept, come back, issue. Five steps, four of them waiting, and the document
 * that prompted the invitation sat in `approved_for_issue` the whole time.
 *
 * The document should be able to go first and wait for them. This module is the
 * one place that says who can sign in, so the rest of the system can stop
 * guessing from `is_active`.
 *
 * ## Why `is_active` is not the answer
 *
 * `finance-portal-invite` sets `is_active: true` at the moment the invitation is
 * SENT — before the partner has done anything, with `password_hash` still null
 * and `invite_accepted_at` still null. So `is_active` means "not revoked", not
 * "can sign in", and every caller that read it as the latter was wrong: the
 * wizard's badge said **Portal connected** for somebody who had never opened the
 * email, and the issue route let a digital send through on that basis while
 * telling the next partner in the same state that it could not.
 *
 * Signing in needs a credential. That is `password_hash`, and nothing else
 * implies it.
 *
 * ## The four states
 *
 *  - `none` — no portal user row. Nothing to notify, nothing to revoke.
 *  - `invited` — a row exists, no credential yet. They cannot sign in, but the
 *    row can hold notifications, and they will meet them on first login.
 *  - `active` — a credential exists and access is not revoked. Normal case.
 *  - `revoked` — access was affirmatively withdrawn. This is the one state
 *    where "the document can wait for them" is the wrong answer: somebody
 *    decided this partner should not be in the portal, and issuing into it
 *    would quietly contradict that decision rather than surface it.
 */

export type PartnerPortalAccess = 'none' | 'invited' | 'active' | 'revoked';

/** The `finance_portal_users` columns this decision reads, and no others. */
export interface PartnerPortalUserFacts {
  /** Null when the partner has no portal user row at all. */
  row: {
    is_active?: boolean | null;
    revoked_at?: string | null;
    password_hash?: string | null;
    invite_accepted_at?: string | null;
    invite_sent_at?: string | null;
    invite_token_expires_at?: string | null;
  } | null;
}

export function partnerPortalAccess(facts: PartnerPortalUserFacts): PartnerPortalAccess {
  const row = facts.row;
  if (!row) return 'none';
  // Revocation wins over everything: it is the only state somebody chose.
  // `is_active === false` counts even without a `revoked_at` — that is exactly
  // the pair `finance-portal-login` refuses on, and a row the portal will not
  // admit must not be described here as one it would.
  if (row.revoked_at || row.is_active === false) return 'revoked';
  // A credential is what makes a login a login. `is_active` is set when the
  // invitation is sent, so it cannot stand in for this.
  const hasCredential = typeof row.password_hash === 'string' && row.password_hash.length > 0;
  if (hasCredential) return 'active';
  return 'invited';
}

/** Can this partner sign in today? Only one state means yes. */
export function canPartnerSignIn(access: PartnerPortalAccess): boolean {
  return access === 'active';
}

/**
 * Can a portal notification be addressed to this partner at all?
 *
 * `invited` counts: the row exists, so the notification has somewhere to live
 * and the partner meets it the first time they sign in. `none` does not — there
 * is no row to reference — which is why activation runs a sweep for whatever
 * was issued before the row existed.
 */
export function partnerNotificationsAddressable(access: PartnerPortalAccess): boolean {
  return access === 'invited' || access === 'active';
}

/**
 * Whether a digital issue may proceed, and why not when it may not.
 *
 * `none` and `invited` both proceed — that is this whole change. Only a
 * deliberate revocation blocks, and it names its own remedy rather than
 * suggesting the download path as though the partner were merely un-onboarded.
 */
export interface PartnerIssueGate {
  ok: boolean;
  reason?: 'partner_portal_access_revoked';
  message?: string;
}

export function partnerIssueGate(access: PartnerPortalAccess): PartnerIssueGate {
  if (access === 'revoked') {
    return {
      ok: false,
      reason: 'partner_portal_access_revoked',
      message:
        'This partner\'s Finance Portal access has been revoked, so an issued agreement would sit '
        + 'somewhere they are not permitted to reach. Reinstate their access first, or use the '
        + 'download options to send the agreement outside the portal.',
    };
  }
  return { ok: true };
}

/**
 * What has happened to an issued agreement from the partner's side.
 *
 * This is derived, never stored. The lifecycle status already says what stage
 * the agreement is at; this says whether the counterparty can currently reach
 * it, which is an independent fact and changes without the agreement changing.
 * Storing it would mean a column that goes stale the moment somebody accepts an
 * invitation.
 */
export type AgreementDelivery =
  | 'not_issued'
  | 'delivered'
  | 'awaiting_activation'
  | 'access_revoked';

export function agreementDelivery(
  issuedAt: string | null | undefined,
  access: PartnerPortalAccess,
): AgreementDelivery {
  if (!issuedAt) return 'not_issued';
  if (access === 'revoked') return 'access_revoked';
  return canPartnerSignIn(access) ? 'delivered' : 'awaiting_activation';
}

/** One vocabulary, so the wizard, the register and the server agree. */
export const PARTNER_ACCESS_LABELS: Record<PartnerPortalAccess, string> = {
  none: 'No portal login',
  invited: 'Invited',
  active: 'Portal active',
  revoked: 'Access revoked',
};

export const PARTNER_ACCESS_NOTES: Record<PartnerPortalAccess, string> = {
  none:
    'This partner has no Finance Portal login yet. You can still issue the agreement — it waits in '
    + 'their portal, and they are notified the moment they activate their account.',
  invited:
    'This partner has been invited but has not set a password yet. You can still issue the agreement '
    + '— it is waiting for them when they finish activating.',
  active: 'This partner can sign in and will be notified as soon as the agreement is issued.',
  revoked:
    'This partner\'s portal access has been revoked. Reinstate it before issuing digitally, or use '
    + 'the download options instead.',
};

/**
 * What the Command Centre should say about an issued agreement's reach.
 * Empty string when there is nothing worth saying — the ordinary delivered case.
 */
export function agreementDeliveryNote(delivery: AgreementDelivery): string {
  switch (delivery) {
    case 'awaiting_activation':
      return 'Issued and waiting. The partner cannot sign in yet, so the agreement is held in their '
        + 'portal — they are notified as soon as they activate their account and accept the AML/CTF '
        + 'compliance agreement.';
    case 'access_revoked':
      return 'Issued, but this partner\'s portal access has since been revoked. They cannot reach the '
        + 'agreement until access is reinstated.';
    default:
      return '';
  }
}
