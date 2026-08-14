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

/**
 * The same question from the partner's side of the wall.
 *
 * `AGREEMENT_PRIMARY_ACTIONS` above answers "what does the issuer do next",
 * and the Finance Portal had no equivalent — so a partner logging in met a
 * list of documents with statuses on them and no indication which one was
 * theirs to act on. `Partner Review` and `Partially Executed` look equally
 * like something is happening; only one of them is waiting for them.
 *
 * `awaitingPartner` is the field that matters. It is what the dashboard counts
 * to decide whether to interrupt somebody, and it is deliberately false for
 * `changes_requested` — the partner asked for something and the ball is on our
 * side, so chasing them for it would be both wrong and annoying.
 */
export type PartnerAgreementAction = 'review' | 'sign' | 'waiting_on_issuer' | 'none';

export interface PartnerActionView {
  action: PartnerAgreementAction;
  /** What the button says. */
  label: string;
  /** One line on why this is in front of them. */
  detail: string;
  /** True when the partner is the one holding the agreement up. */
  awaitingPartner: boolean;
}

export function partnerAgreementAction(status: AgreementStatus): PartnerActionView {
  switch (status) {
    case 'partner_review':
      return {
        action: 'review',
        label: 'Review agreement',
        detail: 'Read it, request changes, or accept it to move to signing.',
        awaitingPartner: true,
      };
    case 'sent_for_signature':
      return {
        action: 'sign',
        label: 'Sign agreement',
        detail: 'You have accepted the terms — the agreement is ready for your signature.',
        awaitingPartner: true,
      };
    case 'changes_requested':
      return {
        action: 'waiting_on_issuer',
        label: 'View your request',
        detail: 'Your requested changes are with the issuer. You will be notified when they respond.',
        awaitingPartner: false,
      };
    case 'partially_signed':
      return {
        action: 'waiting_on_issuer',
        label: 'View agreement',
        detail: 'You have signed. Awaiting the counter-signature.',
        awaitingPartner: false,
      };
    case 'active':
      return {
        action: 'none',
        label: 'View executed agreement',
        detail: 'Fully executed. Your copy is available to download.',
        awaitingPartner: false,
      };
    default:
      return {
        action: 'none',
        label: 'View agreement',
        detail: 'No action is needed from you.',
        awaitingPartner: false,
      };
  }
}

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

// ── Continuity: an agreement is never in "no stage" ─────────────────────────
//
// Reported as "the agreement disappears from the originating portal once it is
// issued". It does not: the row is measured present in the database, returned
// by `list`, and rendered by both portals. What happens is narrower and worse
// for being invisible — the register's counters partition the register BY
// STATUS, and issuing changes the status.
//
// So the user stands on "Ready to Issue" (the only stage whose primary action
// is "Send to Finance Partner"), issues, and the row moves to `partner_review`.
// The filter is component state and does not move with it. The stage they are
// standing in empties, and the empty state says "Nothing in this stage" over a
// Create Agreement button — which is indistinguishable, to the person who has
// just issued something, from the agreement having been destroyed.
//
// The fix is that the filter has to know where an agreement went, which means
// the mapping from status to stage has to exist somewhere both the counters and
// the transition can read. It did not: `AGREEMENT_DASHBOARD_GROUPS` was a
// presentation array the register searched by hand, so nothing could answer
// "which stage is this row in now" and nothing could notice a status that
// belongs to no stage at all.

/**
 * The stage a status is filed under, or null if no group claims it.
 *
 * Derived from `AGREEMENT_DASHBOARD_GROUPS` rather than restated, so a status
 * added to the lifecycle cannot acquire a second home or quietly lose its
 * only one. A null here means the register would render that agreement in the
 * "All" view and in no stage — findable, but not where anybody would look for
 * it. `agreementStagesCoverEveryStatus` is the assertion that keeps it null.
 */
export function dashboardGroupForStatus(status: AgreementStatus): string | null {
  for (const group of AGREEMENT_DASHBOARD_GROUPS) {
    if ((group.statuses as readonly string[]).includes(status)) return group.key;
  }
  return null;
}

/** Every status has exactly one stage. Asserted in a spec, not assumed. */
export function agreementStagesCoverEveryStatus(): { ok: boolean; unstaged: AgreementStatus[]; duplicated: AgreementStatus[] } {
  const unstaged: AgreementStatus[] = [];
  const duplicated: AgreementStatus[] = [];
  for (const status of AGREEMENT_STATUSES) {
    const homes = AGREEMENT_DASHBOARD_GROUPS
      .filter((group) => (group.statuses as readonly string[]).includes(status));
    if (homes.length === 0) unstaged.push(status);
    if (homes.length > 1) duplicated.push(status);
  }
  return { ok: unstaged.length === 0 && duplicated.length === 0, unstaged, duplicated };
}

/**
 * Where a filtered register should be looking after an agreement moves.
 *
 * Returns the stage to switch to, or null to stay put. Staying put is correct
 * far more often than not — the whole point is to follow the ONE agreement the
 * user just acted on, not to reshuffle the view every time a poll notices a
 * partner did something on the other side of the wall.
 */
export function stageToFollow(
  activeGroup: string,
  nextStatus: AgreementStatus,
): string | null {
  // "All" already shows it, and the executed vault is a deliberate destination
  // somebody chose rather than a stage an agreement passes through.
  if (activeGroup === 'all' || activeGroup === 'executed_vault') return null;
  const destination = dashboardGroupForStatus(nextStatus);
  if (!destination || destination === activeGroup) return null;
  return destination;
}

/**
 * Has this agreement been issued to the partner portal at all?
 *
 * `issued_at` and not the status, deliberately. The status says where the
 * agreement is *now* — a withdrawn or voided agreement was still issued, and a
 * partner who saw it is entitled to the record of that. Every surface that
 * wants to say "this has been sent" must ask this rather than test a status,
 * which is how `partner_review` came to be the only visible evidence of
 * issuance and why nothing in the product ever said the word "Issued".
 */
export function isIssued(row: { issued_at?: string | null } | null | undefined): boolean {
  return Boolean(row?.issued_at);
}

/**
 * Statuses an agreement can only be in AFTER it has been issued.
 *
 * Distinct from `PARTNER_VISIBLE_STATUSES`, which additionally has to answer
 * the issued-at question because `void` and `withdrawn` are reachable without
 * ever having been sent.
 */
export const POST_ISSUE_STATUSES: readonly AgreementStatus[] = [
  'partner_review', 'changes_requested', 'sent_for_signature',
  'partially_signed', 'active',
];

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
