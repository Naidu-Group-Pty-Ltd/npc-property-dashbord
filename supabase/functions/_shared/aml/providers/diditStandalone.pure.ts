/**
 * Didit **Standalone API** results: reading them, sanitising them, and turning
 * three independent provider answers into one NPC identity position.
 *
 * Pure and dependency-free. Everything here decides something about a person's
 * identity from a payload NPC did not write, so all of it has to be testable
 * without the network and without a database.
 *
 * ## Why this is not `didit.pure.ts`
 *
 * That module reads a hosted **session decision** — one JSON document in which
 * Didit has already rolled three feature results into a session status, with
 * the feature results as plural arrays. The Standalone APIs are three separate
 * authenticated calls that each answer one question and roll nothing up:
 *
 *   POST /v3/id-verification/  → `{ request_id, id_verification: {...} }`
 *   POST /v3/passive-liveness/ → `{ request_id, liveness: {...} }`
 *   POST /v3/face-match/       → `{ request_id, face_match: {...} }`
 *
 * There is no session, no workflow, no webhook and no `decision` — so there is
 * nothing to correlate against and nothing to re-fetch. **NPC** does the
 * roll-up, which is the point: the composition rule is ours, it is written
 * once, here, and it is covered by tests.
 *
 * ## The three rules the module serves
 *
 *  1. **A 200 is not a pass.** Every one of the three endpoints answers 200
 *     with `status: "Declined"` on a rejection, and 200 with warnings on a
 *     document it could not classify. Reading the HTTP status is reading the
 *     wrong field.
 *  2. **Unknown is never passed.** A missing feature block, an unparseable
 *     status, an absent score, a document Didit classified as something the
 *     customer did not claim — each of those is a referral to a human, never a
 *     verification and never (on its own) a finding against the customer.
 *  3. **Nothing image-shaped survives.** The Standalone responses carry inline
 *     base64 JPEGs when `save_api_request=false` — `portrait_image`,
 *     `front_image`, `back_image`. Those are the reference face and the
 *     customer's own document, and neither belongs in `outcome_detail`, a log
 *     line, or anything the portal can read. They are removed by NAME here
 *     before any persistence, on top of the size-based sweep in
 *     `verificationEvidence.pure.ts`.
 */

import type { IdentityDocumentChoice } from '../identityDocuments.pure.ts';
import { IDENTITY_DOCUMENT_COUNTRY } from '../identityDocuments.pure.ts';

/* ─────────────────────────── vocabulary ─────────────────────────────────── */

/** Per-feature status, as all three Standalone endpoints report it. */
export type StandaloneStatus = 'Approved' | 'Declined';

/** What NPC concluded from one provider step. */
export type StepVerdict =
  /** The provider examined the capture and accepted it. */
  | 'approved'
  /** The provider examined the capture and rejected it. */
  | 'declined'
  /** The provider could not examine the capture. Not a finding — retake. */
  | 'unreadable'
  /** A 200 whose contents NPC cannot interpret. Goes to a human. */
  | 'indeterminate';

/**
 * Typed provider failures.
 *
 * Deliberately a closed list, and deliberately never inferred by matching
 * prose: "identity failed" and "our integration sent a malformed request" are
 * the same sentence to a regex and opposite things to a customer.
 */
export type StandaloneErrorCategory =
  | 'provider_not_configured'
  | 'insufficient_credits'
  | 'rate_limited'
  | 'timeout'
  | 'provider_unavailable'
  | 'provider_rejected_request'
  | 'capture_unreadable';

/**
 * The provider's own name for "I could not read this as a document".
 *
 * A 400 carrying it is a capture problem — bad light, a thumb over the corner,
 * a photo of a photo — and NOT evidence of anything about the customer. It is
 * the single most likely 400 in normal operation and it must never consume an
 * attempt.
 */
export const COULD_NOT_RECOGNIZE_DOCUMENT = 'COULD_NOT_RECOGNIZE_DOCUMENT';

/**
 * Classify a Standalone HTTP failure.
 *
 * `status` is the HTTP status; `body` is the raw response text, already
 * truncated by the caller. The body is inspected ONLY to separate two cases the
 * status cannot: a 403 for a bad key from a 403 for an empty credit balance,
 * and a 400 for an unreadable document from a 400 for our own bad request.
 * Both distinctions are documented Didit behaviour, not guesses at wording:
 * the credit refusal carries an `error` naming credits, and the unreadable
 * document carries `{"error": "COULD_NOT_RECOGNIZE_DOCUMENT"}`.
 */
export function classifyStandaloneHttpError(
  status: number, body: string,
): StandaloneErrorCategory {
  const text = String(body ?? '');
  if (status === 400) {
    return text.includes(COULD_NOT_RECOGNIZE_DOCUMENT)
      ? 'capture_unreadable'
      // Anything else at 400 is OUR request being wrong — an unsupported
      // extension, an oversized file, a parameter out of range. That is an
      // integration or configuration defect and it is never the customer's
      // to have failed.
      : 'provider_rejected_request';
  }
  if (status === 401) return 'provider_not_configured';
  if (status === 403) {
    // 403 is documented for BOTH a missing/invalid/revoked key and an empty
    // credit balance. Collapsing them would tell an operator to rotate a key
    // that is fine, or to top up an account that is not the problem.
    return /credit/i.test(text) ? 'insufficient_credits' : 'provider_not_configured';
  }
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_unavailable';
}

/** Whether a category means the provider never reached a paid examination. */
export function isPreProcessingFailure(category: StandaloneErrorCategory): boolean {
  return category === 'provider_not_configured'
    || category === 'insufficient_credits'
    || category === 'rate_limited'
    || category === 'provider_rejected_request';
}

/* ─────────────────────────── thresholds ─────────────────────────────────── */

/**
 * A decline threshold, validated.
 *
 * Returns null for absent, non-numeric or out-of-range input. Null is the
 * signal that the provider is NOT READY: the endpoints both default to 30,
 * which is documented as permissive, and silently accepting that default in
 * production would mean NPC's compliance position was set by somebody else's
 * default rather than by a decision anyone made.
 */
export function parseThreshold(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null;
  }
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export interface StandaloneThresholds {
  liveness: number;
  faceMatch: number;
}

/**
 * Read both thresholds out of an environment map.
 *
 * Takes a lookup rather than reading `Deno.env` so a unit test can inject
 * deterministic values without a Deno runtime — the same reason
 * `diditWebhook.pure.ts` exists apart from `diditClient.ts`.
 */
export function readStandaloneThresholds(
  env: (key: string) => string | undefined,
): StandaloneThresholds | null {
  const liveness = parseThreshold(env('DIDIT_LIVENESS_THRESHOLD'));
  const faceMatch = parseThreshold(env('DIDIT_FACE_MATCH_THRESHOLD'));
  if (liveness === null || faceMatch === null) return null;
  return { liveness, faceMatch };
}

/* ──────────────────────────── sanitisation ──────────────────────────────── */

/**
 * Fields that carry an inline image when `save_api_request=false`.
 *
 * Removed by NAME, before size-based redaction gets a chance to disagree about
 * what "long enough to be an image" means. A short base64 string is still a
 * face; `verificationEvidence.pure.ts` would leave one under 256 characters
 * alone, and the point of this list is that it does not have to be right about
 * length to be right about content.
 */
export const STANDALONE_IMAGE_KEYS: ReadonlySet<string> = new Set([
  'portrait_image',
  'front_image',
  'back_image',
  'user_image_base64',
  'ref_image_base64',
  'front_image_camera_front',
  'back_image_camera_front',
]);

/**
 * Personal detail the Standalone ID response extracts that NPC does not put in
 * the evidence blob.
 *
 * The customer's name, address and document number already live in the case
 * record, entered by them and adjudicated by staff. Copying the OCR of them
 * into `outcome_detail` creates a second, unreviewed copy of identity data in a
 * column that four surfaces read — and `address` in particular is the field
 * whose duplication this repository has been bitten by before.
 *
 * What is kept is what an adjudicator needs to judge the CHECK: the document's
 * classification, its issuing state, whether it had expired, and the scores.
 */
export const STANDALONE_PII_KEYS: ReadonlySet<string> = new Set([
  'first_name', 'last_name', 'full_name', 'address', 'formatted_address',
  'parsed_address', 'place_of_birth', 'personal_number', 'date_of_birth',
  'mrz', 'barcodes', 'extra_fields', 'nationality', 'gender', 'marital_status',
]);

export const STANDALONE_REDACTED = '[redacted: not stored by NPC]';

const MAX_DEPTH = 8;

/**
 * Strip images and extracted personal detail from a Standalone payload.
 *
 * Structure is preserved and removals are marked rather than deleted, so an
 * adjudicator can see that a field existed and was withheld — a silently
 * missing key reads as "the provider did not return one", which is a different
 * and misleading statement.
 */
export function scrubStandalonePayload<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => scrubStandalonePayload(item, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (STANDALONE_IMAGE_KEYS.has(key) || STANDALONE_PII_KEYS.has(key)) {
      if (item !== null && item !== undefined) out[key] = STANDALONE_REDACTED;
      continue;
    }
    out[key] = scrubStandalonePayload(item, depth + 1);
  }
  return out as unknown as T;
}

/* ──────────────────────── response readers ──────────────────────────────── */

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function statusOf(entry: Record<string, unknown> | null): StandaloneStatus | null {
  const raw = entry?.['status'];
  return raw === 'Approved' || raw === 'Declined' ? raw : null;
}

function scoreOf(entry: Record<string, unknown> | null): number | null {
  const raw = entry?.['score'];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export interface StandaloneWarning {
  risk: string;
  log_type: string;
  short_description?: string;
}

function warningsOf(entry: Record<string, unknown> | null): StandaloneWarning[] {
  const raw = entry?.['warnings'];
  if (!Array.isArray(raw)) return [];
  const out: StandaloneWarning[] = [];
  for (const item of raw) {
    const w = record(item);
    if (!w) continue;
    const risk = typeof w['risk'] === 'string' ? w['risk'] : '';
    if (!risk) continue;
    out.push({
      risk,
      log_type: typeof w['log_type'] === 'string' ? w['log_type'] : 'information',
      short_description: typeof w['short_description'] === 'string'
        ? w['short_description'].slice(0, 200)
        : undefined,
    });
  }
  return out;
}

/**
 * Warnings that mean "the image could not be examined", not "the person
 * failed".
 *
 * Every one of these is fixed by taking the photograph again, and none of them
 * is a statement about the customer — so a result carrying one is a retake and
 * consumes nothing. `PORTRAIT_IMAGE_NOT_DETECTED` sits here rather than with
 * the fraud signals for the same reason: no face was found on the document
 * image, which is a photography outcome.
 */
const RETAKE_RISKS: ReadonlySet<string> = new Set([
  'COULD_NOT_DETECT_DOCUMENT_TYPE',
  'PORTRAIT_IMAGE_NOT_DETECTED',
  'NAME_NOT_DETECTED',
  'DATE_OF_BIRTH_NOT_DETECTED',
  'DOCUMENT_NUMBER_NOT_DETECTED',
  'NO_FACE_DETECTED',
  'NO_REFERENCE_IMAGE',
]);

/**
 * Warnings NPC refuses to let the provider settle on its own.
 *
 * Both are configured to `NO_ACTION` on the request so that Didit does not
 * DECLINE on them, and both are mapped here to a referral instead. The reason
 * is specific and Australian: an Australian driver licence carries no ICAO
 * machine-readable zone at all, and `invalid_mrz_action` defaults to DECLINE —
 * so leaving the default in place risks declining a valid licence for not
 * having a feature it was never issued with. Referring is strictly safer than
 * declining (a human looks, no attempt is spent on a provider default) and it
 * cannot produce a false pass, which is the only outcome that would be worse.
 */
const REFER_RISKS: ReadonlySet<string> = new Set([
  'MRZ_VALIDATION_FAILED',
  'MRZ_NOT_DETECTED',
  'DATA_INCONSISTENT',
  'MRZ_AND_DATA_EXTRACTED_FROM_OCR_NOT_SAME',
  'EXPIRATION_DATE_NOT_DETECTED',
  'POSSIBLE_DUPLICATED_USER',
  'POSSIBLE_DUPLICATED_FACE',
  'POSSIBLE_FACE_IN_BLOCKLIST',
  'MULTIPLE_FACES_DETECTED',
]);

function classifyWarnings(warnings: StandaloneWarning[]): {
  retake: boolean; refer: boolean;
} {
  let retake = false;
  let refer = false;
  for (const w of warnings) {
    if (RETAKE_RISKS.has(w.risk)) retake = true;
    else if (REFER_RISKS.has(w.risk)) refer = true;
  }
  return { retake, refer };
}

export interface IdVerificationReading {
  verdict: StepVerdict;
  requestId: string | null;
  /** Didit's own classification. Never what the customer claimed. */
  documentType: string | null;
  documentSubtype: string | null;
  issuingState: string | null;
  issuingStateName: string | null;
  expirationDate: string | null;
  warnings: StandaloneWarning[];
  /**
   * The cropped face from the document, as returned inline.
   *
   * Present ONLY on the value returned to the orchestrator, never on anything
   * persisted: `sanitised` below is what goes to the database, and this field
   * is not in it. It exists so Face Match has a reference image without a
   * second paid ID call.
   */
  portraitBase64: string | null;
  /** Image-free, PII-free evidence for `outcome_detail`. */
  sanitised: Record<string, unknown>;
}

export function readIdVerification(body: unknown): IdVerificationReading {
  const root = record(body);
  const block = record(root?.['id_verification']);
  const warnings = warningsOf(block);
  const status = statusOf(block);
  const { retake, refer } = classifyWarnings(warnings);

  // Order matters. A capture nobody could read is a retake even when the
  // provider declined on it, because "we could not see your document" is not a
  // finding about the document.
  const verdict: StepVerdict = retake
    ? 'unreadable'
    : status === 'Approved'
      ? (refer ? 'indeterminate' : 'approved')
      : status === 'Declined'
        ? 'declined'
        // A 200 with no readable status block. Never a pass.
        : 'indeterminate';

  const portrait = block?.['portrait_image'];

  return {
    verdict,
    requestId: typeof root?.['request_id'] === 'string' ? root['request_id'] as string : null,
    documentType: typeof block?.['document_type'] === 'string' ? block['document_type'] as string : null,
    documentSubtype: typeof block?.['document_subtype'] === 'string'
      ? block['document_subtype'] as string : null,
    issuingState: typeof block?.['issuing_state'] === 'string' ? block['issuing_state'] as string : null,
    issuingStateName: typeof block?.['issuing_state_name'] === 'string'
      ? block['issuing_state_name'] as string : null,
    expirationDate: typeof block?.['expiration_date'] === 'string'
      ? block['expiration_date'] as string : null,
    warnings,
    portraitBase64: typeof portrait === 'string' && portrait.length > 0 ? portrait : null,
    sanitised: scrubStandalonePayload(root ?? {}),
  };
}

export interface LivenessReading {
  verdict: StepVerdict;
  requestId: string | null;
  score: number | null;
  faceQuality: number | null;
  warnings: StandaloneWarning[];
  sanitised: Record<string, unknown>;
}

export function readLiveness(body: unknown): LivenessReading {
  const root = record(body);
  const block = record(root?.['liveness']);
  const warnings = warningsOf(block);
  const status = statusOf(block);
  const { retake, refer } = classifyWarnings(warnings);

  const verdict: StepVerdict = retake
    ? 'unreadable'
    : status === 'Approved'
      ? (refer ? 'indeterminate' : 'approved')
      : status === 'Declined' ? 'declined' : 'indeterminate';

  return {
    verdict,
    requestId: typeof root?.['request_id'] === 'string' ? root['request_id'] as string : null,
    score: scoreOf(block),
    faceQuality: typeof block?.['face_quality'] === 'number' ? block['face_quality'] as number : null,
    warnings,
    sanitised: scrubStandalonePayload(root ?? {}),
  };
}

export interface FaceMatchReading {
  verdict: StepVerdict;
  requestId: string | null;
  score: number | null;
  warnings: StandaloneWarning[];
  sanitised: Record<string, unknown>;
}

export function readFaceMatch(body: unknown): FaceMatchReading {
  const root = record(body);
  const block = record(root?.['face_match']);
  const warnings = warningsOf(block);
  const status = statusOf(block);
  const { retake, refer } = classifyWarnings(warnings);

  const verdict: StepVerdict = retake
    ? 'unreadable'
    : status === 'Approved'
      ? (refer ? 'indeterminate' : 'approved')
      : status === 'Declined' ? 'declined' : 'indeterminate';

  return {
    verdict,
    requestId: typeof root?.['request_id'] === 'string' ? root['request_id'] as string : null,
    score: scoreOf(block),
    warnings,
    sanitised: scrubStandalonePayload(root ?? {}),
  };
}

/* ─────────────────────── document consistency ───────────────────────────── */

/**
 * What the customer said, against what the provider detected.
 *
 * This is the check the hosted flow never needed and the Standalone flow
 * cannot do without. NPC restricted the hosted session with
 * `expected_details`, so the provider enforced the country and the document
 * type on its own capture screen. The Standalone ID endpoint has no such
 * parameter — it CLASSIFIES the document and tells us what it found — so the
 * restriction has to become a comparison after the fact.
 *
 * The comparison is deliberately one-directional and never automatic:
 * a mismatch cannot become Verified, and it is not, on its own, a finding
 * against the customer either. Somebody who photographed their passport after
 * selecting "driver licence" has made an ordinary mistake; somebody presenting
 * a document from another country has not necessarily done anything wrong
 * either. Both go to a human.
 */
export type DocumentConsistency = 'consistent' | 'mismatch' | 'unknown';

/**
 * Didit's `document_type` vocabulary mapped onto NPC's four choices.
 *
 * Matched case-insensitively on normalised words rather than on an exact
 * string: the field is documentation-described as free text and the live
 * values observed across vendors of this kind vary in punctuation
 * ("Driver's License", "Drivers Licence", "DRIVING_LICENCE"). A value that
 * matches nothing is `unknown`, which refers — it never passes and it never
 * fails.
 */
const DETECTED_TYPE_PATTERNS: Record<IdentityDocumentChoice, RegExp> = {
  passport: /passport/i,
  driver_licence: /driv/i,
  identity_card: /identity|id[\s_-]?card|proof[\s_-]?of[\s_-]?age/i,
  residence_permit: /residen|immi/i,
};

export interface DocumentConsistencyResult {
  outcome: DocumentConsistency;
  /** Why, in one machine-readable token. Never shown to a customer. */
  reason: 'match' | 'type_mismatch' | 'country_mismatch' | 'not_classified';
  detectedType: string | null;
  detectedCountry: string | null;
}

export function documentConsistency(
  claimed: IdentityDocumentChoice,
  detectedType: string | null,
  detectedCountry: string | null,
): DocumentConsistencyResult {
  const base = { detectedType, detectedCountry };

  // The country is checked first and independently of the type. NPC verifies
  // Australian documents; a foreign passport is a policy question regardless
  // of whether the customer named "passport" correctly.
  if (typeof detectedCountry === 'string' && detectedCountry.trim()) {
    if (detectedCountry.trim().toUpperCase() !== IDENTITY_DOCUMENT_COUNTRY) {
      return { ...base, outcome: 'mismatch', reason: 'country_mismatch' };
    }
  }

  if (typeof detectedType !== 'string' || !detectedType.trim()) {
    return { ...base, outcome: 'unknown', reason: 'not_classified' };
  }
  if (DETECTED_TYPE_PATTERNS[claimed].test(detectedType)) {
    return { ...base, outcome: 'consistent', reason: 'match' };
  }
  // Detected as something else — including something outside NPC's accepted
  // list. Both are the same answer: a person decides.
  return { ...base, outcome: 'mismatch', reason: 'type_mismatch' };
}

/* ───────────────────────── the roll-up ──────────────────────────────────── */

/**
 * Statuses in the vocabulary `verificationOutcome.pure.ts` already consumes, so
 * the Standalone path settles the canonical row through exactly the same
 * function as the self-hosted path and the staff re-run.
 */
export type StandaloneProviderStatus = 'verified' | 'failed' | 'manual_review' | 'pending';

export interface StandaloneCheckSummary {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail?: string;
}

export interface StandaloneComposition {
  status: StandaloneProviderStatus;
  checks: StandaloneCheckSummary[];
  /** The score an adjudicator sees first. Never sent to the portal. */
  overallScore: number;
  consistency: DocumentConsistencyResult;
}

export interface StandaloneCompositionInput {
  claimed: IdentityDocumentChoice;
  id: IdVerificationReading;
  /** Absent when the fail-fast sequence stopped before this step. */
  liveness?: LivenessReading | null;
  faceMatch?: FaceMatchReading | null;
}

/**
 * One identity position from three provider answers.
 *
 * The composition rule, stated once:
 *
 *   verified        ⟸ all three Approved AND the detected document is
 *                     consistent with what the customer selected
 *   failed          ⟸ any step Declined on evidence (a document that failed
 *                     its security checks, a liveness rejection, a face that
 *                     did not match)
 *   pending         ⟸ any step could not examine the capture. Not an outcome:
 *                     `canonicalOutcome` reads this as `capture_unusable`, so
 *                     it consumes NO attempt and asks for a retake
 *   manual_review   ⟸ everything else — an indeterminate step, a step that did
 *                     not run, a document classification that disagrees with
 *                     the customer's selection
 *
 * `pending` is checked before `failed` on purpose. A selfie the liveness model
 * could not find a face in is a photography problem, and charging somebody an
 * attempt for it — and recording a liveness failure against them — is the
 * confusion this whole model exists to prevent.
 */
export function composeStandaloneOutcome(
  input: StandaloneCompositionInput,
): StandaloneComposition {
  const { claimed, id } = input;
  const liveness = input.liveness ?? null;
  const faceMatch = input.faceMatch ?? null;

  const consistency = documentConsistency(claimed, id.documentType, id.issuingState);

  const checks: StandaloneCheckSummary[] = [];
  const verdictToCheck = (v: StepVerdict): 'pass' | 'fail' | 'warn' =>
    v === 'approved' ? 'pass' : v === 'declined' ? 'fail' : 'warn';

  checks.push({
    name: 'id_document',
    status: verdictToCheck(id.verdict),
    detail: id.warnings.map((w) => w.risk).join(', ') || undefined,
  });
  checks.push({
    name: 'document_classification',
    status: consistency.outcome === 'consistent' ? 'pass' : 'warn',
    detail: consistency.outcome === 'consistent'
      ? undefined
      : `${consistency.reason}: detected ${consistency.detectedType ?? 'unclassified'}`
        + ` (${consistency.detectedCountry ?? 'no issuing state'})`,
  });
  if (liveness) {
    checks.push({
      name: 'passive_liveness',
      status: verdictToCheck(liveness.verdict),
      detail: liveness.warnings.map((w) => w.risk).join(', ') || undefined,
    });
  } else {
    checks.push({
      name: 'passive_liveness', status: 'warn', detail: 'not reached',
    });
  }
  if (faceMatch) {
    checks.push({
      name: 'face_match',
      status: verdictToCheck(faceMatch.verdict),
      detail: faceMatch.warnings.map((w) => w.risk).join(', ') || undefined,
    });
  } else {
    checks.push({ name: 'face_match', status: 'warn', detail: 'not reached' });
  }

  const verdicts: StepVerdict[] = [
    id.verdict,
    ...(liveness ? [liveness.verdict] : []),
    ...(faceMatch ? [faceMatch.verdict] : []),
  ];

  // Unreadable wins over everything: it is the only outcome that costs the
  // customer nothing, and a capture nobody could examine cannot also be a
  // finding.
  if (verdicts.includes('unreadable')) {
    return { status: 'pending', checks, overallScore: 0, consistency };
  }

  const allApproved = id.verdict === 'approved'
    && liveness?.verdict === 'approved'
    && faceMatch?.verdict === 'approved';

  const overallScore = typeof faceMatch?.score === 'number'
    ? Math.max(0, Math.min(100, faceMatch.score)) / 100
    : 0;

  if (allApproved && consistency.outcome === 'consistent') {
    return { status: 'verified', checks, overallScore, consistency };
  }
  if (verdicts.includes('declined')) {
    return { status: 'failed', checks, overallScore, consistency };
  }
  // Approved-but-inconsistent, indeterminate, or a step that never ran.
  return { status: 'manual_review', checks, overallScore, consistency };
}

/**
 * Whether the sequence may proceed to the next (chargeable) step.
 *
 * Fail-fast, and precisely: a conclusive rejection stops the sequence so NPC
 * does not buy a liveness check for a document that already failed. An
 * unreadable or indeterminate step ALSO stops it, because there is nothing
 * useful the later steps could add to a result that is already going to a
 * human or back to the camera. Only `approved` continues.
 */
export function mayProceed(verdict: StepVerdict): boolean {
  return verdict === 'approved';
}
