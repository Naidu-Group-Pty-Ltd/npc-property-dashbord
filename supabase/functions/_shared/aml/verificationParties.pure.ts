/**
 * Projecting a party's electronic-verification state for the Client Portal.
 *
 * ## The defect this exists to fix
 *
 * Attempts used to be reported as `max(attempt_number)` — but `attempt_number`
 * is a **capture sequence**, not a consumed attempt. That is the same
 * conflation `nextCaptureSequence` was written to avoid on the write side, and
 * it survived on the read side.
 *
 * The consequence was a lockout. A capture the provider cannot examine — no
 * face found, too blurred — consumes no attempt by design, but it still
 * creates a row. After three such captures the portal reported "0 of 3
 * attempts left" and hid every button, while the server's own gate
 * (`aml.verification_attempts_used()`, which counts consumed attempts) would
 * still have accepted a submission. The two disagreed and the client was shut
 * out of a flow that was open to them, having failed nothing.
 *
 * So: attempts are counted from `attempt_consumed`, and an unusable capture is
 * surfaced as the retake it is rather than as "with our team" — which is what
 * the client was previously told while nobody was reviewing anything.
 *
 * Pure and dependency-free so both of those are testable without a database.
 */

export interface VerificationCheckRow {
  party_id?: string | null;
  check_type?: string | null;
  status?: string | null;
  attempt_number?: number | null;
  /** Canonical model. Absent on the pre-migration schema. */
  attempt_consumed?: boolean | null;
  processing_status?: string | null;
  capture_sequence?: number | null;
}

export interface PartyTarget {
  id: string | null;
  label: string;
}

export type PartyClientStatus =
  | 'not_started' | 'in_review' | 'verified' | 'action_required' | 'contact_adviser';

export interface ProjectedParty {
  party_id: string | null;
  label: string;
  status: PartyClientStatus;
  attempts_used: number;
  attempts_remaining: number;
  can_attempt: boolean;
  /** The last capture could not be examined — ask for a new one. */
  retake_required: boolean;
}

/**
 * Internal states collapse to what the client can act on. No score, no
 * threshold, no reason for a referral (Appendix C.1).
 */
const CLIENT_VISIBLE: Record<string, PartyClientStatus> = {
  passed: 'verified',
  failed: 'action_required',
  referred: 'in_review',
  exhausted: 'contact_adviser',
  pending: 'in_review',
  in_progress: 'in_review',
  abandoned: 'not_started',
};

/** Statuses that mean the provider reached an authoritative identity outcome. */
const AUTHORITATIVE = ['passed', 'failed', 'referred', 'exhausted'];

function sequenceOf(row: VerificationCheckRow): number {
  return Number(row.capture_sequence ?? row.attempt_number ?? 0);
}

export function projectParty(
  target: PartyTarget,
  rows: VerificationCheckRow[],
  maxAttempts: number,
  /** False on the pre-migration schema, where `attempt_consumed` is absent. */
  canonicalColumns: boolean,
): ProjectedParty {
  const mine = rows.filter((r) =>
    (target.id === null ? r.party_id == null : String(r.party_id) === target.id));
  const electronic = mine.filter((r) => r.check_type === 'electronic_idv');

  const used = canonicalColumns
    ? electronic.filter((r) => r.attempt_consumed === true).length
    // Pre-migration: an authoritative outcome is one that left `pending`.
    : electronic.filter((r) => AUTHORITATIVE.includes(String(r.status ?? ''))).length;

  // A staff document sighting settles the party regardless of attempts.
  const sighted = mine.some((r) => r.check_type === 'document_sighting' && r.status === 'passed');

  const latestElectronic = electronic.slice().sort((a, b) => sequenceOf(b) - sequenceOf(a))[0];
  const latest = mine.slice().sort((a, b) => sequenceOf(b) - sequenceOf(a))[0];

  // An unusable capture is not an identity outcome and leaves `status` at
  // `pending`, which reads as "With our team" — so the client waits for a
  // review that will never come.
  const captureUnusable = latestElectronic?.processing_status === 'capture_unusable';

  const rawStatus = sighted ? 'passed' : String(latest?.status ?? 'not_started');
  const status: PartyClientStatus = sighted
    ? 'verified'
    : captureUnusable
      ? 'action_required'
      : (CLIENT_VISIBLE[rawStatus] ?? 'not_started');

  return {
    party_id: target.id,
    label: target.label,
    status,
    attempts_used: used,
    attempts_remaining: Math.max(0, maxAttempts - used),
    can_attempt: !sighted && used < maxAttempts && rawStatus !== 'passed',
    retake_required: !sighted && captureUnusable,
  };
}
