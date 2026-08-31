/**
 * BUILDER STOCK — ASKING FOR THE LINK TARGETS, WITHOUT EVER DEPENDING ON THE
 * ANSWER.
 *
 * The judgement lives in `linkRecovery.pure.ts`; this is the IO around it. Its
 * whole design is governed by one rule:
 *
 *     AN AUXILIARY RECOVERY SERVICE MUST NEVER BECOME A DEPENDENCY OF STOCK
 *     INGESTION.
 *
 * The import has already succeeded and published before anything here runs. So
 * every failure mode — no webhook configured, the endpoint down, a timeout,
 * a metered plan out of operations, a malformed response — resolves to the
 * same outcome: the upload keeps the truthful `unavailable_source_export`
 * notice it already had, the fallback ladder proceeds exactly as it does
 * today, and a line is logged. Nothing throws, nothing is rolled back, and
 * nothing is retried in a loop.
 *
 * WHAT IS LOGGED, AND WHAT IS NOT. The request id, the upload, the outcome and
 * a status code. Never the webhook URL, never the shared secret, never a
 * recovered address, never a cell value, never a spreadsheet id — a document
 * identifier is a capability for anyone who can reach the document.
 */
import {
  RECOVERY_REQUEST_TTL_MINUTES, outboundRecoveryPayload, signedPayload,
  type RecoveryRequestRecord,
} from './linkRecovery.pure.ts';

const REQUEST_TABLE = 'builder_stock_link_recovery_requests';
const ALLOWLIST_TABLE = 'builder_stock_link_recovery_orgs';

/** How long we will wait for the webhook to accept the request. */
const DISPATCH_TIMEOUT_MS = 5_000;

export interface LinkRecoveryAsk {
  organisationId: string;
  uploadId: string;
  spreadsheetId: string;
  gid: string | null;
  origin: 'import' | 'manual_refresh';
}

export interface LinkRecoveryOutcome {
  requested: boolean;
  requestId?: string;
  /** Why nothing was asked. Operational only; never shown to a builder. */
  reason?: string;
}

/** Is this organisation on the internal allowlist? Absent means no. */
export async function linkRecoveryEnabledFor(
  db: any,
  organisationId: string,
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from(ALLOWLIST_TABLE)
      .select('enabled')
      .eq('organisation_id', organisationId)
      .maybeSingle();
    if (error) return false;
    return ((data ?? {}) as { enabled?: boolean }).enabled === true;
  } catch {
    /*
     * FAIL CLOSED. An allowlist we cannot read is not an allowlist that says
     * yes — this gate exists to stop one organisation spending a shared
     * metered budget, and a database blip must not open it.
     */
    return false;
  }
}

export function linkRecoveryWebhookConfigured(): boolean {
  return !!(Deno.env.get('MAKE_SHEET_LINKS_WEBHOOK_URL') ?? '').trim();
}

/**
 * Record the request, then ask.
 *
 * IN THAT ORDER, and the order is the security property. The row is the
 * authority the callback will be checked against, so it must exist before
 * anything is told the request id. Asking first and recording afterwards
 * would leave a window in which a valid id has no authority behind it.
 */
export async function requestLinkRecovery(
  db: any,
  ask: LinkRecoveryAsk,
): Promise<LinkRecoveryOutcome> {
  const webhook = (Deno.env.get('MAKE_SHEET_LINKS_WEBHOOK_URL') ?? '').trim();
  const secret = (Deno.env.get('MAKE_SHEET_LINKS_SHARED_SECRET') ?? '').trim();
  if (!webhook || !secret) return { requested: false, reason: 'not_configured' };

  let request: RecoveryRequestRecord;
  try {
    const expiresAt = new Date(Date.now() + RECOVERY_REQUEST_TTL_MINUTES * 60_000);
    const { data, error } = await db.from(REQUEST_TABLE).insert({
      organisation_id: ask.organisationId,
      upload_id: ask.uploadId,
      spreadsheet_id: ask.spreadsheetId,
      gid: ask.gid,
      origin: ask.origin,
      expires_at: expiresAt.toISOString(),
    }).select('id, organisation_id, upload_id, spreadsheet_id, gid, expires_at').single();
    if (error || !data) return { requested: false, reason: 'request_not_recorded' };
    request = data as RecoveryRequestRecord;
  } catch {
    return { requested: false, reason: 'request_not_recorded' };
  }

  const body = JSON.stringify(outboundRecoveryPayload(request));
  const timestamp = String(Math.floor(Date.now() / 1000));

  let dispatched = false;
  let status = 0;
  try {
    const signature = await hmacHex(secret, signedPayload(timestamp, body));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aurixa-timestamp': timestamp,
          'x-aurixa-signature': `v1=${signature}`,
        },
        body,
        signal: controller.signal,
      });
      status = response.status;
      dispatched = response.ok;
      // The body is not read. Make answers the request through the signed
      // callback, and anything it returns here is neither trusted nor needed.
    } finally {
      clearTimeout(timer);
    }
  } catch {
    dispatched = false;
  }

  try {
    await db.from(REQUEST_TABLE)
      .update({ status: dispatched ? 'dispatched' : 'failed' })
      .eq('id', request.id);
  } catch {
    // The row's status is diagnostics. Its AUTHORITY is already stored, which
    // is the part the callback depends on.
  }

  console.info('[builder-stock] link recovery requested', {
    phase: 'link_recovery_dispatch',
    request_id: request.id,
    upload_id: ask.uploadId,
    origin: ask.origin,
    dispatched,
    status,
  });

  return dispatched
    ? { requested: true, requestId: request.id }
    : { requested: false, requestId: request.id, reason: 'dispatch_failed' };
}

/** HMAC-SHA256, lower-case hex. The same construction the callback verifies. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signed))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
