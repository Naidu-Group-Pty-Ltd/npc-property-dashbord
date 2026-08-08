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

/** Statuses a finance partner should see in their portal at all. */
export const PARTNER_VISIBLE_STATUSES: readonly AgreementStatus[] = [
  'partner_review', 'changes_requested', 'sent_for_signature',
  'partially_signed', 'active', 'withdrawn', 'terminated', 'superseded',
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

/** `1.0`, then `1.1` after a reissue, `2.0` on the next major row. */
export function versionLabel(majorVersion: number, issueSequence: number): string {
  return `${majorVersion}.${Math.max(0, issueSequence - 1)}`;
}
