/**
 * BUILDER STOCK — RECOVERING THE LINK TARGETS A GOOGLE SHEET WILL NOT EXPORT.
 *
 * A stock list carries its documents as hyperlinks: the cell reads "Brochure"
 * and the address is underneath it. Google puts those addresses in exactly one
 * public representation — `/export` — and a document whose owner has not
 * enabled file export answers that endpoint with a sign-in page. Measured
 * against a live sheet: `/export` (xlsx and csv) and `/pubhtml` all 401, while
 * `gviz` in every output mode returns the cell TEXT with zero anchors and zero
 * file ids. The address never reaches this product at all.
 *
 * That is not something a better parser fixes. It needs an authenticated read,
 * and this module is the contract for having one performed elsewhere: the
 * import asks a Make scenario — which holds its own authorised Google
 * connection — to read the same sheet and hand back the targets.
 *
 * WHAT THIS MODULE IS FOR. Every decision in that exchange that can be made
 * without IO: when to ask at all, what may be sent, what may be believed on
 * the way back, and how a recovered URL enters the row it belongs to. The IO
 * lives beside it; the judgement lives here so it can be tested without a
 * network, a clock or a database.
 *
 * THE SECURITY POSTURE, STATED ONCE. The callback is an inbound write path
 * that decides what a client sees on a property card. It is therefore built so
 * that the caller CANNOT NAME ITS OWN AUTHORITY: the payload carries a
 * request id and grid data, and every fact with consequences — which
 * organisation, which upload, which properties — is read from the row this
 * product wrote when it asked. A caller who forges a whole body still cannot
 * reach another organisation's stock, because nothing in the body is consulted
 * to decide whose stock is touched.
 *
 * Pure: no IO, no clock, no network. Every function that needs "now" is given
 * it.
 */
import type { HyperlinkAvailability } from './sheetHyperlinks.pure.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How long a recovery request may be answered for.
 *
 * Long enough for a Make run to retry a transient Google error; short enough
 * that a leaked request id is worthless within the hour. The window is also
 * what bounds row drift: a sheet edited between the ask and the answer is
 * matched by property identity rather than by position, so a longer window
 * would not corrupt anything — it would simply raise the number of rows that
 * no longer resolve and are therefore discarded.
 */
export const RECOVERY_REQUEST_TTL_MINUTES = 30;

/** The largest callback body that will be read. A 119-row sheet is ~300 KB. */
export const MAX_CALLBACK_BYTES = 5 * 1024 * 1024;

/** How far a signed timestamp may be from ours, either way. */
export const MAX_TIMESTAMP_SKEW_SECONDS = 300;

/** How often one upload may be refreshed by hand. */
export const MANUAL_REFRESH_WINDOW_SECONDS = 600;

/**
 * THE ONE AVAILABILITY READING THAT WARRANTS ASKING.
 *
 * `resolved` and `none_present` are readings of the SPREADSHEET — the links
 * were read, or the tab genuinely has none — and there is nothing to recover.
 * `unavailable_workbook_unreadable`, `unavailable_no_worksheet_match` and
 * `unavailable_ambiguous_worksheet` are all cases where the workbook DID
 * arrive: an authenticated re-read returns the same bytes and the same
 * problem, so asking would spend an operation to learn nothing.
 *
 * Only `unavailable_source_export` means the file itself never came, which is
 * the one thing a different, authorised reader can change.
 */
export const RECOVERABLE_AVAILABILITY: HyperlinkAvailability = 'unavailable_source_export';

/**
 * WHAT THAT SAME READING WAS CALLED BEFORE IT WAS SPLIT IN TWO.
 *
 * `unavailable_source_sharing` covered both "the document refused to hand over
 * the workbook" and "we got the workbook and could not read it" until those
 * were separated, because they have different remedies. Rows written before
 * that split still carry the old name, and they are overwhelmingly the first
 * case — the second is rare and the first is what a restricted export always
 * produced.
 *
 * IT IS ACCEPTED ONLY WHERE A STORED ROW IS BEING READ: the manual refresh and
 * the control that offers it. The automatic trigger is handed its availability
 * by the current reader, which cannot emit the old name, so widening it there
 * would be accepting a value that can no longer occur.
 */
export const RECOVERABLE_AVAILABILITY_LEGACY = 'unavailable_source_sharing';

/**
 * Does a STORED upload's recorded reason describe links worth asking for?
 *
 * For historical rows only. `shouldRequestLinkRecovery` deliberately does not
 * use this — see above.
 */
export function isRecoverableStoredAvailability(
  reason: string | null | undefined,
): boolean {
  return reason === RECOVERABLE_AVAILABILITY || reason === RECOVERABLE_AVAILABILITY_LEGACY;
}

// ---------------------------------------------------------------------------
// Should we ask?
// ---------------------------------------------------------------------------

export interface RecoveryTriggerInput {
  /** True only where the import itself succeeded. */
  importSucceeded: boolean;
  /** What the existing reader concluded about this source's links. */
  availability: HyperlinkAvailability | null | undefined;
  /** The document and tab, parsed from the source URL. Null for every other source. */
  spreadsheetId: string | null | undefined;
  /** Whether this organisation is on the internal allowlist. */
  organisationEnabled: boolean;
  /** Whether a webhook is configured at all. */
  webhookConfigured: boolean;
}

/**
 * Ask only where all five hold.
 *
 * Written as one expression of five named facts rather than as branching,
 * because the expensive mistake here is not refusing too often — it is asking
 * for a source that was never a Google Sheet, or for an organisation nobody
 * enabled, or when the reader already has the links. Each of those spends a
 * metered operation from a small shared budget and, worse, sends a document
 * identifier to a third party for no reason.
 */
export function shouldRequestLinkRecovery(input: RecoveryTriggerInput): boolean {
  if (!input.importSucceeded) return false;
  if (input.availability !== RECOVERABLE_AVAILABILITY) return false;
  if (!input.spreadsheetId || !input.spreadsheetId.trim()) return false;
  if (!input.organisationEnabled) return false;
  if (!input.webhookConfigured) return false;
  return true;
}

// ---------------------------------------------------------------------------
// What may be sent
// ---------------------------------------------------------------------------

export interface RecoveryRequestRecord {
  id: string;
  organisation_id: string;
  upload_id: string;
  spreadsheet_id: string;
  gid: string | null;
  expires_at: string;
  consumed_at?: string | null;
  status?: string | null;
}

export interface OutboundRecoveryPayload {
  request_id: string;
  spreadsheet_id: string;
  gid: string | null;
}

/**
 * THE WHOLE OF WHAT LEAVES THIS PRODUCT.
 *
 * Three fields: which request, which document, which tab. No organisation, no
 * upload, no property, no row, no customer, no token. Make does not need to
 * know whose sheet it is reading in order to read it, and the callback cannot
 * use any of it to claim authority, so sending it would be pure risk.
 *
 * Written as an explicit object rather than a subset of the request row, so a
 * column added to that row later cannot silently start being transmitted.
 */
export function outboundRecoveryPayload(
  request: RecoveryRequestRecord,
): OutboundRecoveryPayload {
  return {
    request_id: request.id,
    spreadsheet_id: request.spreadsheet_id,
    gid: request.gid ?? null,
  };
}

/**
 * The exact string both sides sign.
 *
 * The timestamp is inside the signature, which is what makes the skew check
 * meaningful: a replayed body with a fresh timestamp does not verify, and a
 * replayed body with its original timestamp is refused as stale.
 */
export function signedPayload(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

// ---------------------------------------------------------------------------
// What may be believed on the way back
// ---------------------------------------------------------------------------

export interface CallbackBody {
  request_id?: unknown;
  spreadsheet_id?: unknown;
  sheets?: unknown;
}

export type CallbackRefusal =
  | { code: 'malformed_payload'; status: 400 }
  | { code: 'unknown_request'; status: 404 }
  | { code: 'request_already_consumed'; status: 409 }
  | { code: 'request_expired'; status: 409 }
  | { code: 'spreadsheet_mismatch'; status: 409 };

/**
 * May this body be acted on for this stored request?
 *
 * Order matters and is deliberate: shape, then existence, then single-use,
 * then freshness, then binding. Each refusal writes nothing, and none of them
 * reveals which of the later checks would also have failed.
 *
 * THE BINDING CHECK IS THE POINT. Make is told which spreadsheet to read; if
 * what comes back names a different document then either the scenario is
 * misconfigured or somebody is replaying one builder's answer at another
 * builder's request. Neither is a state in which a brochure should be attached
 * to a property, so it is refused outright rather than reconciled.
 */
export function callbackRefusal(
  request: RecoveryRequestRecord | null | undefined,
  body: CallbackBody,
  nowMs: number,
): CallbackRefusal | null {
  const requestId = typeof body.request_id === 'string' ? body.request_id.trim() : '';
  const spreadsheetId = typeof body.spreadsheet_id === 'string'
    ? body.spreadsheet_id.trim() : '';
  if (!requestId || !spreadsheetId) return { code: 'malformed_payload', status: 400 };
  if (!Array.isArray(body.sheets)) return { code: 'malformed_payload', status: 400 };

  if (!request || request.id !== requestId) return { code: 'unknown_request', status: 404 };
  if (request.consumed_at) return { code: 'request_already_consumed', status: 409 };

  const expiresAt = Date.parse(request.expires_at ?? '');
  if (!Number.isFinite(expiresAt) || nowMs > expiresAt) {
    return { code: 'request_expired', status: 409 };
  }

  if (request.spreadsheet_id !== spreadsheetId) {
    return { code: 'spreadsheet_mismatch', status: 409 };
  }
  return null;
}

/** Is a signed timestamp close enough to now to be acted on? */
export function timestampWithinSkew(timestamp: string, nowMs: number): boolean {
  const seconds = Number.parseInt(String(timestamp ?? '').trim(), 10);
  if (!Number.isFinite(seconds)) return false;
  return Math.abs(nowMs / 1000 - seconds) <= MAX_TIMESTAMP_SKEW_SECONDS;
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

export interface RecoveredRow {
  /** Column heading -> displayed cell text, exactly as the sheet shows it. */
  values: Record<string, string>;
  /** Column heading -> link target, for the cells that carry one. */
  links: Record<string, string>;
}

/**
 * Turn one worksheet of Google's grid into headed rows.
 *
 * THE TAB IS CHOSEN BY ITS OWN ID, never by position. A workbook's first sheet
 * is not the tab a `gid` names, and a stock list frequently sits behind other
 * tabs. Where the request named no gid, the documented behaviour of a link
 * without one is the first tab, and that is what is used.
 *
 * Only http(s) targets are kept. A cell may legitimately link to a place
 * within the workbook, to a local file, or to a mail address, and none of
 * those is a document this pipeline can open — carrying them forward would
 * mean failing later with a worse message.
 */
export function recoveredRowsFromGrid(
  sheets: unknown,
  gid: string | null,
): RecoveredRow[] {
  if (!Array.isArray(sheets) || sheets.length === 0) return [];

  const wanted = gid === null || gid === undefined || gid === ''
    ? null
    : Number.parseInt(String(gid), 10);

  const sheet = (wanted === null || !Number.isFinite(wanted))
    ? sheets[0]
    : sheets.find((candidate) => {
      const id = (candidate as { properties?: { sheetId?: unknown } })?.properties?.sheetId;
      return Number(id) === wanted;
    });
  if (!sheet) return [];

  const rowData = ((sheet as { data?: Array<{ rowData?: unknown }> }).data ?? [])
    .flatMap((block) => (Array.isArray(block?.rowData) ? block.rowData : []));
  if (rowData.length < 2) return [];

  const headerCells = cellsOf(rowData[0]);
  const headings = headerCells.map((cell) => String(cell?.formattedValue ?? '').trim());

  const rows: RecoveredRow[] = [];
  for (let index = 1; index < rowData.length; index += 1) {
    const cells = cellsOf(rowData[index]);
    const values: Record<string, string> = {};
    const links: Record<string, string> = {};
    let sawAnything = false;

    for (let column = 0; column < headings.length; column += 1) {
      const heading = headings[column];
      if (!heading) continue;
      const cell = cells[column];
      const text = String(cell?.formattedValue ?? '').trim();
      if (text) { values[heading] = text; sawAnything = true; }
      const target = String(cell?.hyperlink ?? '').trim();
      if (target && /^https?:\/\//i.test(target)) links[heading] = target;
    }
    if (sawAnything) rows.push({ values, links });
  }
  return rows;
}

function cellsOf(row: unknown): Array<{ formattedValue?: unknown; hyperlink?: unknown }> {
  const values = (row as { values?: unknown })?.values;
  return Array.isArray(values) ? values : [];
}

// ---------------------------------------------------------------------------
// How a recovered URL enters the row it belongs to
// ---------------------------------------------------------------------------

/**
 * Add a recovered target to the cell it came from, under its own heading.
 *
 * THIS IS DELIBERATELY NOT A NEW MODEL. `rowSourceBranches` already walks
 * `source_row.unmapped` and treats any http(s) token it finds as a builder
 * source, carrying the column heading through as provenance. So a recovered
 * link is stored by making the cell look the way it would have looked if the
 * builder had typed the URL beside the label — which is a shape the pipeline
 * has always understood, and which needs no stage-1 change whatsoever.
 *
 * The display text is KEPT. It is what the sheet actually shows, it is what an
 * operator reading the audit record expects to see, and `rowSourceBranches`
 * ignores any token that is not a URL, so nothing is confused by its presence.
 *
 * Returns null where there is nothing to do — no target, or a target the cell
 * already carries — which is what makes a duplicate callback harmless.
 */
export function mergeRecoveredLink(
  existing: string | null | undefined,
  target: string,
): string | null {
  const url = String(target ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const current = String(existing ?? '').trim();
  if (!current) return url;
  // Already present — as the whole value or as one of its tokens.
  if (current.split(/\s+/).some((token) => token.replace(/[),.]+$/, '') === url)) return null;
  return `${current} ${url}`;
}
