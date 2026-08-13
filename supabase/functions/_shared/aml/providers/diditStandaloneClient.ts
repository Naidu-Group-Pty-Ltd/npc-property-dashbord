/**
 * Server-side Didit **Standalone API** client.
 *
 * Three authenticated, server-to-server, `multipart/form-data` calls. Nothing
 * in this module can be reached from a browser: it is imported only by the
 * verification orchestrator, which runs in the Edge Function runtime, and it
 * holds `DIDIT_API_KEY` — which never leaves it in a response, a log line, a
 * database row, or a signed URL.
 *
 * Contract read from the current published documentation on 2026-08-11 (not
 * from memory, and not from this repository's hosted-session client, which is a
 * different API):
 *
 *   POST https://verification.didit.me/v3/id-verification/
 *   POST https://verification.didit.me/v3/passive-liveness/
 *   POST https://verification.didit.me/v3/face-match/
 *   auth: `x-api-key: <key>`
 *   body: multipart/form-data
 *
 * ## Three rules this module exists to hold
 *
 *  1. **The multipart boundary is generated, never written.** Setting
 *     `Content-Type: multipart/form-data` by hand omits the boundary parameter,
 *     and the server then cannot split the body — every request fails with a
 *     400 that looks like a malformed image. `FormData` + `fetch` produce the
 *     header together; this module never sets it.
 *  2. **`save_api_request=false` on every call.** NPC's evidence store is its
 *     own private Supabase buckets. Didit is asked to answer a question, not to
 *     keep a copy of a customer's face — so no session is persisted on their
 *     side, no Manual Check exists to look up, and the authenticated response
 *     IS the result. There is no webhook to wait for and no decision to
 *     re-fetch.
 *  3. **A failure is typed, never prose.** Every non-2xx becomes a
 *     `DiditStandaloneError` carrying a `StandaloneErrorCategory`, so an outage,
 *     an empty credit balance and an unreadable photograph can never be
 *     confused with a customer who failed verification.
 *
 * ## The one thing that is deliberately NOT here
 *
 * A retry. These calls are billed per 200 response and Didit publishes no
 * idempotency key — `vendor_data` is documented as an opaque correlation
 * string and explicitly not as one. So a request that was sent but whose
 * response never arrived has an unknown billing state, and repeating it is a
 * decision about somebody's money that this layer is not entitled to make. The
 * orchestrator records `timeout` and stops; a human or a fresh customer
 * submission is the retry.
 */

import {
  classifyStandaloneHttpError,
  type StandaloneErrorCategory,
} from './diditStandalone.pure.ts';

const DIDIT_API_BASE = (Deno.env.get('DIDIT_API_BASE_URL') || 'https://verification.didit.me')
  .replace(/\/+$/, '');

/**
 * Per-call ceiling.
 *
 * Longer than the hosted client's 15s: these calls carry an image and do real
 * work, and the orchestrator runs them in the background rather than while a
 * customer waits on an open request. Short enough that three of them plus the
 * downloads stay inside an edge function's wall clock.
 */
const STANDALONE_TIMEOUT_MS = Number(Deno.env.get('DIDIT_STANDALONE_TIMEOUT_MS') ?? 30_000);

export class DiditStandaloneError extends Error {
  readonly category: StandaloneErrorCategory;
  readonly httpStatus: number | null;
  /**
   * Whether the request may have been PROCESSED AND BILLED despite this error.
   *
   * True only for a timeout or a transport failure after the request left: we
   * know what we sent and not what happened to it. Everything else is either a
   * refusal before processing or a response we actually read.
   */
  readonly billingUnknown: boolean;

  constructor(
    category: StandaloneErrorCategory,
    message: string,
    httpStatus: number | null = null,
    billingUnknown = false,
  ) {
    super(message);
    this.category = category;
    this.httpStatus = httpStatus;
    this.billingUnknown = billingUnknown;
    this.name = 'DiditStandaloneError';
  }
}

/** Server-side configuration. Read from the function environment only. */
export function readStandaloneEnvConfig(): {
  apiKey: string | null;
  livenessThreshold: string | null;
  faceMatchThreshold: string | null;
} {
  return {
    apiKey: Deno.env.get('DIDIT_API_KEY') || null,
    livenessThreshold: Deno.env.get('DIDIT_LIVENESS_THRESHOLD') || null,
    faceMatchThreshold: Deno.env.get('DIDIT_FACE_MATCH_THRESHOLD') || null,
  };
}

/**
 * Remove anything that must not reach a log line, a response or the case
 * record.
 *
 * The key is the obvious one. Absolute URLs are the subtle one: a media host
 * returned in an error body can embed a signed token, and `failure_reason` is
 * persisted onto the check and read by staff.
 */
function redact(text: string, apiKey: string): string {
  let out = String(text ?? '');
  if (apiKey) out = out.split(apiKey).join('[redacted]');
  return out.replace(/https?:\/\/[^\s"')]+/gi, '[didit]').slice(0, 300);
}

export interface StandaloneCallResult {
  body: Record<string, unknown>;
  httpStatus: number;
}

async function postMultipart(
  apiKey: string, path: string, form: FormData,
): Promise<StandaloneCallResult> {
  let res: Response;
  try {
    res = await fetch(`${DIDIT_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
        // Content-Type is deliberately ABSENT. `fetch` derives
        // `multipart/form-data; boundary=…` from the FormData body; writing it
        // here would drop the boundary and make every request unparseable.
      },
      body: form,
      signal: AbortSignal.timeout(STANDALONE_TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error;
    const aborted = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    // Both branches are billing-unknown: the request had already left when it
    // failed, and Didit bills on a 200 we never got to read.
    throw new DiditStandaloneError(
      aborted ? 'timeout' : 'provider_unavailable',
      aborted
        ? `didit ${path} timed out after ${STANDALONE_TIMEOUT_MS}ms`
        : `didit ${path} unreachable: ${redact(String(err?.message ?? e), apiKey)}`,
      null,
      true,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const category = classifyStandaloneHttpError(res.status, detail);
    throw new DiditStandaloneError(
      category,
      `didit ${path} returned ${res.status}${detail ? `: ${redact(detail, apiKey)}` : ''}`,
      res.status,
      // A non-2xx is a decision Didit made and told us about; the documented
      // billing unit is a 200 response.
      false,
    );
  }

  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    // A 200 we cannot read HAS been billed. Say so, so nothing retries it.
    throw new DiditStandaloneError(
      'provider_unavailable', `didit ${path} returned an unparseable body`, res.status, true,
    );
  }
  return { body: body as Record<string, unknown>, httpStatus: res.status };
}

/** Bytes → a multipart part with a filename the API will accept. */
function imagePart(bytes: Uint8Array, filename: string): Blob {
  // `type` is what the receiving end reads; the extension in `filename` is what
  // its extension allow-list reads. Both say JPEG because every capture that
  // reaches here has been re-encoded to JPEG by `captureImage.ts`.
  return new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' });
}

/**
 * Common fields.
 *
 * `save_api_request=false` is set here rather than per call site so no future
 * endpoint can be added without it. `metadata` carries internal correlation
 * only and is never given a name, an email or a document number — it is echoed
 * back verbatim and would otherwise put customer PII in a third party's
 * response body for no purpose.
 */
function baseForm(vendorData: string, metadata: Record<string, unknown>): FormData {
  const form = new FormData();
  form.append('save_api_request', 'false');
  form.append('vendor_data', vendorData);
  form.append('metadata', JSON.stringify(metadata));
  return form;
}

export interface VerifyIdentityDocumentArgs {
  apiKey: string;
  frontImage: Uint8Array;
  backImage?: Uint8Array | null;
  /** Opaque `npc:<case>:<party>:<sequence>` handle. Never PII. */
  vendorData: string;
  metadata: Record<string, unknown>;
}

export async function verifyIdentityDocument(
  args: VerifyIdentityDocumentArgs,
): Promise<StandaloneCallResult> {
  const form = baseForm(args.vendorData, args.metadata);
  form.append('front_image', imagePart(args.frontImage, 'front.jpg'), 'front.jpg');
  if (args.backImage && args.backImage.byteLength > 0) {
    form.append('back_image', imagePart(args.backImage, 'back.jpg'), 'back.jpg');
  }
  // Screen captures, printed copies and portrait manipulation. This is the
  // document-fraud signal and NPC pays for it deliberately.
  form.append('perform_document_liveness', 'true');
  /**
   * MRZ and data-consistency handling is NPC's, not the provider default.
   *
   * Both default to DECLINE. An Australian driver licence carries no ICAO
   * machine-readable zone at all, so a DECLINE default risks rejecting a valid
   * licence for lacking a feature it was never issued with — and a decline is
   * a consumed attempt and a recorded identity failure. Set to NO_ACTION here
   * and mapped to a REFERRAL in `diditStandalone.pure.ts`, which cannot
   * produce a false pass and cannot spend a customer's allowance on a default
   * nobody chose.
   */
  form.append('invalid_mrz_action', 'NO_ACTION');
  form.append('inconsistent_data_action', 'NO_ACTION');
  form.append('expiration_date_not_detected_action', 'NO_ACTION');
  return await postMultipart(args.apiKey, '/v3/id-verification/', form);
}

export interface PassiveLivenessArgs {
  apiKey: string;
  userImage: Uint8Array;
  /** Server configuration. There is no path by which a browser reaches this. */
  declineThreshold: number;
  vendorData: string;
  metadata: Record<string, unknown>;
}

export async function checkPassiveLiveness(
  args: PassiveLivenessArgs,
): Promise<StandaloneCallResult> {
  const form = baseForm(args.vendorData, args.metadata);
  form.append('user_image', imagePart(args.userImage, 'selfie.jpg'), 'selfie.jpg');
  form.append('face_liveness_score_decline_threshold', String(args.declineThreshold));
  return await postMultipart(args.apiKey, '/v3/passive-liveness/', form);
}

export interface FaceMatchArgs {
  apiKey: string;
  /** The customer's selfie, captured by NPC. */
  userImage: Uint8Array;
  /**
   * The reference face.
   *
   * The portrait Didit cropped from the identity document on the ID call —
   * held in memory for the length of this sequence and never persisted, never
   * logged and never sent to a browser. Using the whole document photograph
   * instead would hand the matcher a page rather than a face.
   */
  refImage: Uint8Array;
  declineThreshold: number;
  vendorData: string;
  metadata: Record<string, unknown>;
}

export async function compareFaces(args: FaceMatchArgs): Promise<StandaloneCallResult> {
  const form = baseForm(args.vendorData, args.metadata);
  form.append('user_image', imagePart(args.userImage, 'selfie.jpg'), 'selfie.jpg');
  form.append('ref_image', imagePart(args.refImage, 'portrait.jpg'), 'portrait.jpg');
  form.append('face_match_score_decline_threshold', String(args.declineThreshold));
  return await postMultipart(args.apiKey, '/v3/face-match/', form);
}

/**
 * Decode the inline portrait into bytes.
 *
 * Returns null rather than throwing on anything unexpected: a portrait we
 * cannot decode means Face Match has no reference image, which is a referral,
 * and it must not be able to take down the whole sequence with an exception.
 * The `data:` prefix is tolerated because the field is documented as "url or
 * base64" and only the base64 form appears when `save_api_request=false`.
 */
export function decodeInlineImage(value: string | null): Uint8Array | null {
  if (typeof value !== 'string' || !value) return null;
  // A media URL, not an inline image — that is the `save_api_request=true`
  // shape and NPC never sends true. Refuse rather than fetch it: following a
  // URL out of a provider response is a request this code did not intend.
  if (/^https?:\/\//i.test(value)) return null;
  const comma = value.indexOf(',');
  const payload = value.startsWith('data:') && comma > -1 ? value.slice(comma + 1) : value;
  try {
    const binary = atob(payload.replace(/\s+/g, ''));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out.byteLength > 0 ? out : null;
  } catch {
    return null;
  }
}
