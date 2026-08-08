/**
 * The rules for getting rid of an agreement.
 *
 * Void, archive and delete all look like one button to a user and are three
 * unrelated acts to the register, so each rule here is written as the mistake
 * it exists to prevent: a fully executed agreement being declared never to
 * have bound anyone, a filing decision quietly changing what a partner gets
 * paid, and the audit trail of a document a counterparty has already read
 * being destroyed because its status happened to say "draft".
 */
import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_STATUSES,
  AGREEMENT_TRANSITIONS,
  ARCHIVABLE_STATUSES,
  IN_FLIGHT_STATUSES,
  PARTNER_VISIBLE_STATUSES,
  agreementDeleteVerdict,
  agreementDisposition,
  agreementDispositionFromRow,
  archiveRefusal,
  canArchive,
  canVoid,
  isPartnerVisible,
  type AgreementStatus,
} from '@/lib/agreements';

/** A row that is as deletable as a row gets: never issued, never seen. */
const PRISTINE_DRAFT = {
  status: 'draft' as AgreementStatus,
  issuedVersionCount: 0,
  signatureCount: 0,
  issuedAt: null,
  executedPdfPath: null,
  supersededByCount: 0,
};

describe('voiding', () => {
  it('is refused on a fully executed agreement', () => {
    // The parties WERE bound. That is terminated or superseded, never void.
    expect(canVoid('active')).toBe(false);
    expect(AGREEMENT_TRANSITIONS.active).toEqual(['terminated', 'superseded']);
  });

  it('is available at every stage before execution', () => {
    for (const status of ['draft', 'pending_review', 'approved_for_issue',
      'partner_review', 'changes_requested', 'sent_for_signature', 'partially_signed'] as const) {
      expect(canVoid(status)).toBe(true);
    }
  });

  it('is a dead end — nothing follows a void', () => {
    expect(canVoid('void')).toBe(false);
    expect(AGREEMENT_TRANSITIONS.void).toEqual([]);
  });

  it('derives from the transition map rather than a second list', () => {
    // The guarantee: a status added to the map cannot silently gain or lose
    // the ability to be voided without this agreeing.
    for (const status of AGREEMENT_STATUSES) {
      expect(canVoid(status)).toBe(AGREEMENT_TRANSITIONS[status].includes('void'));
    }
  });
});

describe('archiving', () => {
  it('refuses anything another party is waiting on', () => {
    for (const status of IN_FLIGHT_STATUSES) {
      if (status === 'active') continue; // settled — archivable, see below
      expect(canArchive(status)).toBe(false);
      expect(archiveRefusal(status)).toContain('still in progress');
    }
  });

  it('accepts settled work and abandoned drafts', () => {
    for (const status of ['draft', 'active', 'withdrawn', 'terminated', 'superseded', 'void'] as const) {
      expect(canArchive(status)).toBe(true);
      expect(archiveRefusal(status)).toBeNull();
    }
  });

  it('names the status in its refusal, so the user knows what to fix', () => {
    expect(archiveRefusal('partner_review')).toContain('Partner Review');
  });

  it('covers every status exactly once between archivable and refused', () => {
    for (const status of AGREEMENT_STATUSES) {
      expect(canArchive(status)).toBe(ARCHIVABLE_STATUSES.includes(status));
    }
  });

  it('does not offer to archive something already archived', () => {
    const archived = agreementDisposition({ ...PRISTINE_DRAFT, archivedAt: '2026-08-08T00:00:00Z' });
    expect(archived.canArchive).toBe(false);
    expect(archived.canRestore).toBe(true);
  });

  it('offers restore only to something archived', () => {
    expect(agreementDisposition({ ...PRISTINE_DRAFT }).canRestore).toBe(false);
  });
});

describe('deleting', () => {
  it('allows a draft that never left the building', () => {
    expect(agreementDeleteVerdict(PRISTINE_DRAFT).ok).toBe(true);
  });

  it('allows a void agreement that was never issued', () => {
    expect(agreementDeleteVerdict({ ...PRISTINE_DRAFT, status: 'void' }).ok).toBe(true);
  });

  it('refuses a draft the partner has already seen — the regression this guards', () => {
    // `sent_for_signature → draft` is a legal move, so "status is draft" was
    // never proof the document had stayed inside. The old rule checked only
    // that, and would have cascade-deleted the versions, events and
    // signatures proving what the partner was sent.
    const reverted = { ...PRISTINE_DRAFT, issuedVersionCount: 1, issuedAt: '2026-08-01T00:00:00Z' };
    const verdict = agreementDeleteVerdict(reverted);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('already_issued');
    expect(verdict.reason).toContain('Archive it instead');
  });

  it('refuses on an issued-at stamp even with no version rows', () => {
    expect(agreementDeleteVerdict({ ...PRISTINE_DRAFT, issuedAt: '2026-08-01T00:00:00Z' }).code)
      .toBe('already_issued');
  });

  it('refuses anything carrying a signature', () => {
    expect(agreementDeleteVerdict({ ...PRISTINE_DRAFT, signatureCount: 1 }).code).toBe('already_signed');
  });

  it('refuses when an executed copy is stored', () => {
    expect(agreementDeleteVerdict({ ...PRISTINE_DRAFT, executedPdfPath: 'partner-agreements/x.pdf' }).code)
      .toBe('executed_copy_exists');
  });

  it('refuses when a later version stands on it', () => {
    // supersedes_agreement_id is ON DELETE SET NULL — deleting the parent
    // silently orphans the successor's history rather than failing.
    expect(agreementDeleteVerdict({ ...PRISTINE_DRAFT, supersededByCount: 1 }).code).toBe('has_successor');
  });

  it('refuses every status other than draft and void', () => {
    for (const status of AGREEMENT_STATUSES) {
      if (status === 'draft' || status === 'void') continue;
      const verdict = agreementDeleteVerdict({ ...PRISTINE_DRAFT, status });
      expect(verdict.ok).toBe(false);
      expect(verdict.code).toBe('status_not_deletable');
    }
  });

  it('always names archiving as the alternative', () => {
    for (const facts of [
      { ...PRISTINE_DRAFT, status: 'active' as AgreementStatus },
      { ...PRISTINE_DRAFT, issuedAt: '2026-08-01T00:00:00Z' },
      { ...PRISTINE_DRAFT, signatureCount: 1 },
      { ...PRISTINE_DRAFT, executedPdfPath: 'x' },
      { ...PRISTINE_DRAFT, supersededByCount: 1 },
    ]) {
      expect(agreementDeleteVerdict(facts).reason).toMatch(/[Aa]rchive it instead/);
    }
  });
});

describe('the row-level verdict the list page uses', () => {
  it('agrees with the counted verdict on a pristine draft', () => {
    expect(agreementDispositionFromRow({ status: 'draft' }).canDelete).toBe(true);
  });

  it('refuses a row that carries an issued version', () => {
    expect(agreementDispositionFromRow({ status: 'draft', issued_version_id: 'v1' }).canDelete).toBe(false);
  });

  it('refuses a row that has ever been issued', () => {
    expect(agreementDispositionFromRow({ status: 'draft', issued_at: '2026-08-01T00:00:00Z' }).canDelete)
      .toBe(false);
  });

  it('refuses a row with an executed copy', () => {
    expect(agreementDispositionFromRow({ status: 'void', executed_pdf_storage_path: 'x.pdf' }).canDelete)
      .toBe(false);
  });

  it('reads archived state off the row', () => {
    const archived = agreementDispositionFromRow({ status: 'active', archived_at: '2026-08-08T00:00:00Z' });
    expect(archived.canRestore).toBe(true);
    expect(archived.canArchive).toBe(false);
  });

  it('never offers to void an executed agreement from a list row', () => {
    expect(agreementDispositionFromRow({ status: 'active' }).canVoid).toBe(false);
  });
});

describe('what the partner sees', () => {
  it('shows a voided agreement they were actually sent', () => {
    expect(isPartnerVisible('void', '2026-08-01T00:00:00Z')).toBe(true);
  });

  it('hides a voided draft that never reached them — the leak this closes', () => {
    // A draft can be voided without ever being issued. Status alone was the
    // old rule, and it would have put that row in the partner's portal.
    expect(isPartnerVisible('void', null)).toBe(false);
  });

  it('hides internal stages whatever the issue stamp says', () => {
    for (const status of ['draft', 'pending_review', 'approved_for_issue'] as const) {
      expect(isPartnerVisible(status, '2026-08-01T00:00:00Z')).toBe(false);
    }
  });

  it('requires an issue stamp for every partner-visible status', () => {
    for (const status of PARTNER_VISIBLE_STATUSES) {
      expect(isPartnerVisible(status, null)).toBe(false);
      expect(isPartnerVisible(status, '2026-08-01T00:00:00Z')).toBe(true);
    }
  });
});
