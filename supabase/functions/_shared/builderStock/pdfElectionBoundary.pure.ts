/**
 * BUILDER STOCK — THE WIRE BETWEEN THE SETTLER AND THE PDF WORKER.
 *
 * ONE MODULE, BOTH ENDS. The Edge client encodes with it and the Cloud Run
 * worker decodes with it, so the two cannot disagree about the contract. This
 * repository has paid for the alternative more than once: a rule written twice
 * is a rule that drifts.
 *
 * WHY THE DOCUMENT TRAVELS AS A RAW BODY. The Edge function already holds the
 * bytes — it fetched them through the guarded fetcher and applied the identity
 * rules — and base64 of a 14 MB brochure is about 19 MB and real CPU spent in
 * exactly the isolate that has none to spare. So the PDF is the request body
 * verbatim and the small context rides in a header. The ANSWER comes back as
 * JSON with the elected image base64-encoded, because that image is small
 * (a facade render, not the document) and decoding it costs the Edge almost
 * nothing.
 *
 * Pure: no IO, no clock, no network.
 */

/** The contract's own version. Sent by the client, echoed by the worker. */
export const PDF_ELECTION_PROTOCOL = 1;

/** Where the context rides, since the body is the document itself. */
export const ELECTION_CONTEXT_HEADER = 'x-election-context';
/** Correlates a call with the property and document it was made for. */
export const ELECTION_REQUEST_ID_HEADER = 'x-election-request-id';

/**
 * The largest document the worker will accept, in bytes.
 *
 * 32 MB against the largest measured in production — Lot 6706's 13.9 MB
 * brochure — so the bound is a refusal of the absurd rather than a limit on
 * the real corpus. A document past it is answered, not dropped: the caller
 * reads it as `unreachable` and the property is asked again, exactly as it
 * would be for any other document that could not be read.
 */
export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;

/** How long the worker may spend on one document before it answers. */
export const ELECTION_TIMEOUT_MS = 90_000;

/** The context the election needs, as it travels. */
export interface WireElectionContext {
  protocol: number;
  label: string;
  identifiedBy: 'folder_structure' | 'direct_link';
  design: string | null;
  identityHints: string[];
  documentName: string;
  url: string;
}

export function encodeElectionContext(context: WireElectionContext): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(context))));
}

/**
 * The context as the worker reads it.
 *
 * Returns null for anything it cannot vouch for — a body that is not JSON, a
 * protocol it does not speak, a label that is not a string. The worker answers
 * 400 on null rather than guessing, because a guessed label elects against the
 * wrong property and that is the one failure this whole pipeline exists to
 * prevent.
 */
export function decodeElectionContext(raw: unknown): WireElectionContext | null {
  if (typeof raw !== 'string' || !raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(escape(atob(raw))));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const c = parsed as Record<string, unknown>;
  if (Number(c.protocol) !== PDF_ELECTION_PROTOCOL) return null;
  if (typeof c.label !== 'string') return null;
  if (c.identifiedBy !== 'folder_structure' && c.identifiedBy !== 'direct_link') return null;
  if (typeof c.documentName !== 'string' || typeof c.url !== 'string') return null;
  const hints = Array.isArray(c.identityHints)
    ? c.identityHints.filter((h): h is string => typeof h === 'string')
    : [];
  return {
    protocol: PDF_ELECTION_PROTOCOL,
    label: c.label,
    identifiedBy: c.identifiedBy,
    design: typeof c.design === 'string' ? c.design : null,
    identityHints: hints,
    documentName: c.documentName,
    url: c.url,
  };
}

/** The elected image, as it travels back. */
export interface WireElectedImage {
  bytes_b64: string;
  content_type: string;
  reference: string;
  document_name: string;
  document_url: string;
  provenance: unknown;
  role: unknown;
}

export type WireElectionResult =
  | { status: 'recovered'; image: WireElectedImage; version: string; protocol: number }
  | { status: 'not_identified' | 'unreachable'; detail: string; version: string; protocol: number };

/** Bytes to base64 without a 14 MB intermediate string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
