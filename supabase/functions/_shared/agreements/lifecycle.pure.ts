/**
 * Agreement Centre — the lifecycle state machine, in one place.
 *
 * The register's `partner_agreement_status` enum gained four values for the
 * digital issue/execution flow (`approved_for_issue`, `partner_review`,
 * `changes_requested`, `withdrawn`). This module is the single authority on
 * which moves are legal, what each status is called in front of a person, and
 * what the one obvious next action is — the server enforces `TRANSITIONS`;
 * the Command Centre and the Finance Portal both render from the same maps, so
 * the button a user sees and the transition the server permits cannot disagree.
 *
 * Two deliberate properties:
 *  - The legacy manual path stays legal. `draft → sent_for_signature` (send a
 *    DOCX out by hand, mark it) predates the Agreement Centre and existing
 *    rows rely on it; the digital lifecycle is a superset, not a replacement.
 *  - "Partner viewed" is a timestamp and an event, not a status. A status that
 *    flips on a page view makes the state machine racy for no decision value.
 *
 * The second half of the file is *disposition* — void, archive and delete.
 * Those are three different acts that all look like "remove this" in a menu,
 * and the block above them explains why the register treats them as unrelated.
 */

export type AgreementStatus =
  | 'draft'
  | 'pending_review'
  | 'approved_for_issue'
  | 'partner_review'
  | 'changes_requested'
  | 'sent_for_signature'
  | 'partially_signed'
  | 'active'
  | 'withdrawn'
  | 'terminated'
  | 'superseded'
  | 'void';

export const AGREEMENT_STATUSES: readonly AgreementStatus[] = [
  'draft', 'pending_review', 'approved_for_issue', 'partner_review',
  'changes_requested', 'sent_for_signature', 'partially_signed', 'active',
  'withdrawn', 'terminated', 'superseded', 'void',
];

/** Every legal move. The digital path plus the pre-existing manual edges. */
export const AGREEMENT_TRANSITIONS: Record<AgreementStatus, AgreementStatus[]> = {
  draft: ['pending_review', 'sent_for_signature', 'void'],
  pending_review: ['draft', 'approved_for_issue', 'sent_for_signature', 'void'],
  approved_for_issue: ['partner_review', 'draft', 'void'],
  partner_review: ['changes_requested', 'sent_for_signature', 'withdrawn', 'void'],
  changes_requested: ['draft', 'withdrawn', 'void'],
  sent_for_signature: ['partially_signed', 'active', 'draft', 'withdrawn', 'void'],
  partially_signed: ['active', 'void'],
  active: ['terminated', 'superseded'],
  withdrawn: ['draft'],
  terminated: [],
  superseded: [],
  void: [],
};

/** What each status is called in front of a person. */
export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  draft: 'Draft',
  pending_review: 'Internal Review',
  approved_for_issue: 'Ready to Issue',
  partner_review: 'Partner Review',
  changes_requested: 'Changes Requested',
  sent_for_signature: 'Awaiting Signature',
  partially_signed: 'Partially Executed',
  active: 'Fully Executed',
  withdrawn: 'Withdrawn',
  terminated: 'Terminated',
  superseded: 'Superseded',
  void: 'Void',
};

/**
 * The one obvious primary action per lifecycle stage — "the user should never
 * be wondering: what do I do next?".
 */
export const AGREEMENT_PRIMARY_ACTIONS: Record<AgreementStatus, string> = {
  draft: 'Continue Agreement',
  pending_review: 'Review & Approve',
  approved_for_issue: 'Send to Finance Partner',
  partner_review: 'Awaiting Partner',
  changes_requested: 'Review Requested Changes',
  sent_for_signature: 'View Execution Status',
  partially_signed: 'Complete Counter-Signature',
  active: 'View Executed Agreement',
  withdrawn: 'Reopen as Draft',
  terminated: 'View Agreement',
  superseded: 'View Agreement',
  void: 'View Agreement',
};

/** Statuses that count as "an agreement already in play" for duplicate alerts. */
export const IN_FLIGHT_STATUSES: readonly AgreementStatus[] = [
  'pending_review', 'approved_for_issue', 'partner_review', 'changes_requested',
  'sent_for_signature', 'partially_signed', 'active',
];

/**
 * Statuses in which the working row's fields may still be edited. Once a
 * version is in front of the partner, edits go through revise → re-approve →
 * reissue so nothing externally visible changes silently.
 */
export const EDITABLE_STATUSES: readonly AgreementStatus[] = [
  'draft', 'pending_review', 'approved_for_issue', 'changes_requested',
];

/**
 * Statuses a finance partner should see in their portal at all — paired with
 * `isPartnerVisible`, which also requires the agreement to have been issued.
 * `void` is here because a partner who was sent a document is entitled to see
 * that it was voided rather than watch it disappear; the issued-at gate is
 * what stops a never-sent voided draft appearing alongside it.
 */
export const PARTNER_VISIBLE_STATUSES: readonly AgreementStatus[] = [
  'partner_review', 'changes_requested', 'sent_for_signature',
  'partially_signed', 'active', 'withdrawn', 'terminated', 'superseded', 'void',
];

/** Dashboard counters, in presentation order. */
export const AGREEMENT_DASHBOARD_GROUPS: readonly {
  key: string;
  label: string;
  description: string;
  statuses: readonly AgreementStatus[];
}[] = [
  { key: 'draft', label: 'Draft', description: 'Agreements currently being prepared.', statuses: ['draft'] },
  { key: 'internal_review', label: 'Internal Review', description: 'Awaiting review within the Command Centre.', statuses: ['pending_review'] },
  { key: 'ready_to_issue', label: 'Ready to Issue', description: 'Approved internally and ready for partner issuance.', statuses: ['approved_for_issue'] },
  { key: 'partner_review', label: 'Partner Review', description: 'Sitting with the Finance Partner Portal.', statuses: ['partner_review'] },
  { key: 'action_required', label: 'Action Required', description: 'The partner has requested changes to configurable terms.', statuses: ['changes_requested'] },
  { key: 'awaiting_signature', label: 'Awaiting Signature', description: 'Accepted, execution outstanding.', statuses: ['sent_for_signature'] },
  { key: 'partially_executed', label: 'Partially Executed', description: 'One required party has signed.', statuses: ['partially_signed'] },
  { key: 'fully_executed', label: 'Fully Executed', description: 'All required parties have completed execution.', statuses: ['active'] },
  { key: 'closed', label: 'Expired / Superseded', description: 'Replaced, withdrawn or no longer active.', statuses: ['withdrawn', 'terminated', 'superseded', 'void'] },
];

export function isTransitionAllowed(from: AgreementStatus, to: AgreementStatus): boolean {
  return (AGREEMENT_TRANSITIONS[from] ?? []).includes(to);
}

// ── Disposition: void, archive, delete ──────────────────────────────────────
//
// Three different things a person means by "get rid of this", and conflating
// them is how a register loses a record it was legally required to keep:
//
//   Void     A statement about the AGREEMENT: it is of no effect. A lifecycle
//            status, visible to the partner who saw it, permanent, reasoned.
//   Archive  A statement about the LIST: not my current work. Reversible,
//            changes nothing about the agreement itself, and — the property
//            that matters — never changes which agreement governs commission.
//   Delete   A statement that the record should not exist. Only ever true of
//            something that never left the building.
//
// The rules below are derived from the transition map rather than restated, so
// a status added there cannot silently acquire or lose a disposition.

/**
 * Voiding is a pre-execution act. A fully executed agreement is *terminated*
 * or *superseded* — those are real events with dates and consequences, and
 * calling one "void" would assert the parties were never bound, which is not
 * a thing an app gets to decide after execution. The transition map already
 * says this (`active: ['terminated', 'superseded']`); this derives from it.
 */
export function canVoid(status: AgreementStatus): boolean {
  return isTransitionAllowed(status, 'void');
}

/**
 * Archivable statuses: settled work, plus a draft nobody is going to finish.
 *
 * Everything in flight is excluded on purpose — archiving an agreement that is
 * sitting with the partner, or waiting on a counter-signature, hides work
 * somebody is actively waiting on, and the person waiting is not the person
 * who archived it.
 */
export const ARCHIVABLE_STATUSES: readonly AgreementStatus[] = [
  'draft', 'active', 'withdrawn', 'terminated', 'superseded', 'void',
];

export function canArchive(status: AgreementStatus): boolean {
  return ARCHIVABLE_STATUSES.includes(status);
}

/** Why archiving was refused, in the words the refusal will be shown in. */
export function archiveRefusal(status: AgreementStatus): string | null {
  if (canArchive(status)) return null;
  return `This agreement is still in progress (${AGREEMENT_STATUS_LABELS[status]}). `
    + 'Withdraw or void it first — archiving would hide work another party is waiting on.';
}

/** What the register knows about an agreement when deciding it may be deleted. */
export interface AgreementDeleteFacts {
  status: AgreementStatus;
  /** Frozen `partner_agreement_versions` rows. Any at all means it was issued. */
  issuedVersionCount: number;
  /** Signature rows across every version. */
  signatureCount: number;
  /** `issued_at` — set the first time it reached the partner's portal. */
  issuedAt: string | null;
  /** The executed master in the bucket. */
  executedPdfPath: string | null;
  /** Rows whose `supersedes_agreement_id` points at this one. */
  supersededByCount: number;
}

export interface AgreementDeleteVerdict {
  ok: boolean;
  /** Machine-readable refusal, for the API. */
  code: string | null;
  /** The refusal as a person should read it, naming what to do instead. */
  reason: string | null;
}

/**
 * Permanent deletion, and the narrow case it is allowed in.
 *
 * A row may be destroyed only if it never left the building: never issued,
 * never signed, no executed copy, and no later version standing on it. The
 * moment a partner has seen a document, the register's job is to remember —
 * and `partner_agreement_versions`, `_events` and `_signatures` all cascade on
 * delete, so destroying the row destroys the proof of what that partner saw.
 *
 * This is deliberately stricter than "status is draft". A draft can be a
 * *reverted* agreement — `sent_for_signature → draft` is a legal move — and
 * the older status-only rule would have deleted the audit trail of a document
 * that had already been in front of a counterparty.
 */
export function agreementDeleteVerdict(facts: AgreementDeleteFacts): AgreementDeleteVerdict {
  const refuse = (code: string, reason: string) => ({ ok: false, code, reason });

  if (facts.status !== 'draft' && facts.status !== 'void') {
    return refuse('status_not_deletable',
      `Only a draft or a void agreement can be deleted. Archive it instead — it stays on the register and out of your way.`);
  }
  if (facts.issuedVersionCount > 0 || facts.issuedAt) {
    return refuse('already_issued',
      'This agreement has been issued to the partner, so the register has to keep it. Archive it instead.');
  }
  if (facts.signatureCount > 0) {
    return refuse('already_signed',
      'This agreement carries a signature. Signed records are never deleted — archive it instead.');
  }
  if (facts.executedPdfPath) {
    return refuse('executed_copy_exists',
      'An executed copy of this agreement is stored. Archive it instead.');
  }
  if (facts.supersededByCount > 0) {
    return refuse('has_successor',
      'A later version was drafted from this agreement. Deleting it would break that version\'s history — archive it instead.');
  }
  return { ok: true, code: null, reason: null };
}

/** Every disposition decision for one row, as the UI and the server both see it. */
export interface AgreementDisposition {
  canVoid: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canDelete: boolean;
  /** Set when `canDelete` is false — the sentence to show beside a disabled action. */
  deleteRefusal: string | null;
  archiveRefusal: string | null;
}

export function agreementDisposition(
  facts: AgreementDeleteFacts & { archivedAt?: string | null },
): AgreementDisposition {
  const archived = Boolean(facts.archivedAt);
  const verdict = agreementDeleteVerdict(facts);
  return {
    canVoid: canVoid(facts.status),
    // An archived agreement is restored before it is archived again.
    canArchive: !archived && canArchive(facts.status),
    canRestore: archived,
    canDelete: verdict.ok,
    deleteRefusal: verdict.reason,
    archiveRefusal: archived ? null : archiveRefusal(facts.status),
  };
}

/**
 * The same verdict from a register row alone — what a list page has.
 *
 * The row cannot count signatures or successors, so this reads the columns
 * that stand in for them: signatures only exist after an issue, and an issue
 * always stamps `issued_at`, so the issued-at gate already covers them. A
 * successor can only be drafted from an `active` agreement, and `active` is
 * not a deletable status in the first place.
 *
 * Where that reasoning could ever fail, it fails safe — the server counts the
 * child rows properly and refuses with the sentence the dialog then shows. The
 * UI is allowed to be optimistic; it is not allowed to be the authority.
 */
export function agreementDispositionFromRow(row: {
  status: string;
  issued_at?: string | null;
  issued_version_id?: string | null;
  executed_pdf_storage_path?: string | null;
  archived_at?: string | null;
}): AgreementDisposition {
  return agreementDisposition({
    status: row.status as AgreementStatus,
    issuedVersionCount: row.issued_version_id ? 1 : 0,
    signatureCount: 0,
    issuedAt: row.issued_at ?? null,
    executedPdfPath: row.executed_pdf_storage_path ?? null,
    supersededByCount: 0,
    archivedAt: row.archived_at ?? null,
  });
}

/**
 * Whether a partner may see this agreement in their portal.
 *
 * Status alone was the rule, which was safe only by accident: no never-issued
 * agreement could reach a partner-visible status. `void` breaks that — a draft
 * can be voided without ever being sent — so visibility now also requires the
 * agreement to have actually been issued. A partner sees what they were sent,
 * including the fact that it was later voided, and nothing else.
 */
export function isPartnerVisible(status: AgreementStatus, issuedAt: string | null | undefined): boolean {
  return PARTNER_VISIBLE_STATUSES.includes(status) && Boolean(issuedAt);
}

/** `1.0`, then `1.1` after a reissue, `2.0` on the next major row. */
export function versionLabel(majorVersion: number, issueSequence: number): string {
  return `${majorVersion}.${Math.max(0, issueSequence - 1)}`;
}
