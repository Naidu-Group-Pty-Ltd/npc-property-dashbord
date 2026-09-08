/**
 * BUILDER STOCK PDF WORKER — the election, where there is CPU to run it.
 *
 * WHAT THIS IS. One endpoint that runs `electFromPdfBytes` — the very module
 * the Edge settler used to run — and answers with the same verdict. It is an
 * execution-location change and nothing else: no second extractor, no Python
 * reimplementation, no Docling. Which image wins is decided by the same
 * TypeScript, at the same thresholds, in both places.
 *
 * WHY IT EXISTS, from the platform's own per-execution telemetry, 8 September
 * 2026. A thirteen-property cold start killed the settler thirteen times and
 * every kill was `reason: CPUTime` — successful executions ended at 1,828 ms
 * of CPU or less, killed ones at 2,031 ms or more, against a 2,000 ms limit,
 * while memory peaked at 108 MB of 256. Reading one brochure and electing its
 * image costs about 1.7 s of CPU on fast hardware. No scheduling rule can fit
 * an indivisible 2.4 s task into a 2.0 s budget, so the work moved.
 *
 * WHAT IT DOES NOT DO. It touches no database, mints no credential and writes
 * no state. Branch attempts, provenance, the image pointer and upload
 * settlement all stay in the Supabase path. This reads a document and answers.
 *
 * IDEMPOTENT BY CONSTRUCTION. The election is a pure function of the bytes and
 * the context, so the same request always yields the same winner. A retry can
 * therefore never produce a different image, and because this writes nothing,
 * it cannot produce a duplicate one either.
 */
import { electFromPdfBytes } from '../supabase/functions/_shared/builderStock/pdfElection.ts';
import { readPdfPageTextResult } from '../supabase/functions/_shared/builderStock/pdfText.ts';
import {
  ELECTION_CONTEXT_HEADER, ELECTION_REQUEST_ID_HEADER, MAX_DOCUMENT_BYTES,
  PDF_ELECTION_PROTOCOL, bytesToBase64, decodeElectionContext,
  type WireElectionResult,
} from '../supabase/functions/_shared/builderStock/pdfElectionBoundary.pure.ts';

/** Stamped at build time so a deployment can be told apart from its source. */
const VERSION = Deno.env.get('SERVICE_VERSION') ?? 'dev';

/**
 * The bearer every caller must present.
 *
 * Read from the environment and never from source. Absent, the service
 * refuses every request with 503 rather than accepting them unauthenticated —
 * a misconfigured deployment must not become an open PDF processor.
 */
const SERVICE_TOKEN = Deno.env.get('BUILDER_STOCK_PDF_SERVICE_TOKEN') ?? '';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Constant-time-ish comparison, so a token cannot be probed byte by byte. */
function tokenMatches(presented: string): boolean {
  if (presented.length !== SERVICE_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ SERVICE_TOKEN.charCodeAt(i);
  }
  return diff === 0;
}

async function handleElect(request: Request): Promise<Response> {
  const requestId = request.headers.get(ELECTION_REQUEST_ID_HEADER) ?? 'unknown';
  const context = decodeElectionContext(request.headers.get(ELECTION_CONTEXT_HEADER));
  if (!context) {
    // Never guessed: an election against the wrong property is the one
    // failure this pipeline exists to prevent.
    return json({ error: 'bad_context', detail: 'Election context missing or unreadable.' }, 400);
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) {
    return json({ error: 'document_too_large', detail: `Document exceeds ${MAX_DOCUMENT_BYTES} bytes.` }, 413);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return json({ error: 'empty_document' }, 400);
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    return json({ error: 'document_too_large', detail: `Document exceeds ${MAX_DOCUMENT_BYTES} bytes.` }, 413);
  }

  const startedAt = performance.now();
  const outcome = await electFromPdfBytes(bytes, readPdfPageTextResult, {
    label: context.label,
    identifiedBy: context.identifiedBy,
    design: context.design,
    identityHints: context.identityHints,
    documentName: context.documentName,
    url: context.url,
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  // PII-safe: the property label and document name are the builder's own
  // words and already travel in the request; no token, no URL, no bytes.
  console.log(JSON.stringify({
    phase: 'election', request_id: requestId, status: outcome.status,
    document_bytes: bytes.length, elapsed_ms: elapsedMs, version: VERSION,
  }));

  if (outcome.status === 'recovered') {
    const result: WireElectionResult = {
      status: 'recovered',
      protocol: PDF_ELECTION_PROTOCOL,
      version: VERSION,
      image: {
        bytes_b64: bytesToBase64(outcome.image.bytes),
        content_type: outcome.image.contentType,
        reference: outcome.image.reference,
        document_name: outcome.image.documentName,
        document_url: outcome.image.documentUrl,
        provenance: outcome.image.provenance,
        role: outcome.image.role,
      },
    };
    return json(result);
  }

  /*
   * `recovered_photograph` is produced by the FOLDER path, which never reaches
   * this boundary — `extractFromDocument` is the only caller and it cannot
   * return it. Named rather than assumed away, so a future caller that could
   * produce one is refused loudly instead of silently losing the photograph.
   */
  if (outcome.status !== 'not_identified' && outcome.status !== 'unreachable') {
    return json({ error: 'unsupported_outcome', detail: String(outcome.status) }, 500);
  }

  const result: WireElectionResult = {
    status: outcome.status,
    detail: outcome.detail,
    protocol: PDF_ELECTION_PROTOCOL,
    version: VERSION,
  };
  return json(result);
}

Deno.serve({ port: Number(Deno.env.get('PORT') ?? 8080) }, async (request) => {
  const url = new URL(request.url);

  if (url.pathname === '/health') {
    return json({
      ok: SERVICE_TOKEN.length > 0,
      service: 'builder-stock-pdf-service',
      version: VERSION,
      protocol: PDF_ELECTION_PROTOCOL,
      max_document_bytes: MAX_DOCUMENT_BYTES,
      // Says WHY it is not ok, without disclosing anything about the token.
      token_configured: SERVICE_TOKEN.length > 0,
    }, SERVICE_TOKEN.length > 0 ? 200 : 503);
  }

  if (!SERVICE_TOKEN) {
    return json({ error: 'service_token_not_configured' }, 503);
  }
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ') || !tokenMatches(auth.slice(7).trim())) {
    return json({ error: 'unauthorised' }, 401);
  }

  if (url.pathname === '/v1/elect' && request.method === 'POST') {
    try {
      return await handleElect(request);
    } catch (error) {
      console.error(JSON.stringify({
        phase: 'election_failed',
        message: String((error as { message?: string })?.message ?? error).slice(0, 300),
      }));
      // The caller reads a failure here exactly as it reads any document it
      // could not finish: operational, retried, nothing banked.
      return json({ error: 'election_failed' }, 500);
    }
  }

  return json({ error: 'not_found' }, 404);
});
