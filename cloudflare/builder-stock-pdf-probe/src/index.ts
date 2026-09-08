/**
 * TEMPORARY PROBE — measures whether a Cloudflare Worker can run the election.
 *
 * NOT PRODUCTION. It is not wired to the settler, holds no Supabase secret,
 * touches no database and stores nothing. Delete it once the question it
 * exists to answer has been answered.
 *
 * THE QUESTION. An Edge Function allows 2,000 ms of CPU and one election costs
 * more, so the work has to run somewhere else. A Workers isolate allows 128 MB
 * — LESS than the Edge Function's 256 MB — while the same election was
 * measured at 107-252 MB peak under Deno. Whether that measurement transfers
 * to workerd is not something local numbers can answer, so this asks the
 * runtime itself.
 *
 * THE ELECTION IS THE SHARED ONE. `electFromPdfBytes` is imported, not
 * reimplemented, so a winner here is the winner everywhere.
 *
 * THE READER IS THE SHARED ONE TOO. A first version of this probe passed its
 * own `extractText` wrapper and got `not_identified` on both documents where
 * production gets `recovered` — because `readPdfPageTextResult` also appends
 * each page's AcroForm FIELD text, which the cover-page identification for
 * these brochures depends on. That is precisely the reimplementation trap this
 * exercise exists to avoid, so the real reader is imported and the esm.sh
 * specifier is resolved to the same pinned npm package by a build alias in
 * `wrangler.jsonc`.
 */
import { electFromPdfBytes } from '../../../supabase/functions/_shared/builderStock/pdfElection.ts';
import { readPdfPageTextResult } from '../../../supabase/functions/_shared/builderStock/pdfText.ts';
import {
  ELECTION_CONTEXT_HEADER, MAX_DOCUMENT_BYTES, PDF_ELECTION_PROTOCOL,
  decodeElectionContext,
} from '../../../supabase/functions/_shared/builderStock/pdfElectionBoundary.pure.ts';

interface Env { BUILDER_STOCK_PDF_PROBE_TOKEN?: string }

/*
 * WHICH ISOLATE ANSWERED — the instrument the memory question actually needs.
 *
 * Cloudflare's own limits page: "Each isolate can consume up to 128 MB ... This
 * limit is per-isolate, not per-invocation. A single isolate can handle many
 * concurrent requests. When an isolate exceeds 128 MB, the Workers runtime lets
 * IN-FLIGHT REQUESTS COMPLETE and creates a new isolate for subsequent
 * requests."
 *
 * So a run that exceeds the ceiling does not necessarily fail. Four sequential
 * elections could each return 200 with the right winner while the runtime
 * silently discarded and rebuilt the isolate after every one — a pass that
 * would collapse the moment two documents were in flight together. That is the
 * isolate-versus-invocation distinction #2555 was blocked on, and a status code
 * cannot see it.
 *
 * These two values can. They live at module scope, so they are minted when an
 * isolate is created and survive as long as it does. Four elections reporting
 * ONE `isolate` with `invocation` 1,2,3,4 is a real pass. Four different
 * `isolate` values is the ceiling biting quietly.
 */
/*
 * MINTED LAZILY, and that is workerd telling us something. `crypto.randomUUID()`
 * at module scope is refused outright — "Asynchronous I/O ..., setting a
 * timeout, and generating random values are not allowed within global scope" —
 * which is the first hard difference this exercise has found between the two
 * runtimes, and exactly the kind a local Deno run cannot show. So the id is
 * minted on the isolate's first request instead. Same property: one value per
 * isolate, for as long as that isolate lives.
 */
let isolateId: string | null = null;
let invocations = 0;
const isolate = () => (isolateId ??= crypto.randomUUID().slice(0, 8));

const sha256Hex = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        ok: Boolean(env.BUILDER_STOCK_PDF_PROBE_TOKEN),
        service: 'builder-stock-pdf-probe',
        protocol: PDF_ELECTION_PROTOCOL,
        // Health runs BEFORE the counter and takes no number of its own: this
        // is how many this isolate has served so far, which is what a reader
        // of `/health` wants and is a snapshot rather than an identity.
        isolate: isolate(), served: invocations,
        note: 'temporary probe; not production',
      }, env.BUILDER_STOCK_PDF_PROBE_TOKEN ? 200 : 503);
    }

    const token = env.BUILDER_STOCK_PDF_PROBE_TOKEN ?? '';
    if (!token) return json({ error: 'probe_token_not_configured' }, 503);
    const auth = request.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${token}`) return json({ error: 'unauthorised' }, 401);
    /*
     * CAPTURED AT ENTRY, not read at exit. The handler awaits for over a
     * second between here and its response, and under concurrency a second
     * request increments the shared counter in that gap — so reading
     * `invocations` when the answer is built made two concurrent requests
     * both report 17 while 16 appeared nowhere. Measured on the very first
     * concurrent round this instrument ever ran, which is the point of
     * running it: a number that does not identify its own request cannot
     * show whether an isolate was recycled between two of them.
     */
    invocations += 1;
    const invocation = invocations;

    /*
     * A CONTROL, so the instrument can be trusted. A pass under a runtime
     * that does not enforce the 128 MB cap would prove nothing, so this
     * allocates on demand: if the runtime is enforcing, a large enough
     * request dies, and the election's pass beside it means something.
     */
    if (url.pathname === '/v1/alloc') {
      const mb = Math.max(1, Math.min(Number(url.searchParams.get('mb') ?? '64'), 2048));
      const held: Uint8Array[] = [];
      for (let i = 0; i < mb; i += 1) {
        const block = new Uint8Array(1024 * 1024);
        // Touched, so it is really resident rather than lazily mapped.
        block[0] = i & 0xff; block[block.length - 1] = i & 0xff;
        held.push(block);
      }
      return json({
        allocated_mb: held.length, first: held[0][0],
        isolate: isolate(), invocation,
      });
    }

    if (url.pathname !== '/v1/elect' || request.method !== 'POST') {
      return json({ error: 'not_found' }, 404);
    }

    const context = decodeElectionContext(request.headers.get(ELECTION_CONTEXT_HEADER));
    if (!context) return json({ error: 'bad_context' }, 400);

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) {
      return json({ error: 'bad_document', bytes: bytes.length }, 413);
    }

    const startedAt = Date.now();
    const outcome = await electFromPdfBytes(bytes, readPdfPageTextResult, {
      label: context.label,
      identifiedBy: context.identifiedBy,
      design: context.design,
      identityHints: context.identityHints,
      documentName: context.documentName,
      url: context.url,
    });
    const elapsedMs = Date.now() - startedAt;

    if (outcome.status === 'recovered') {
      return json({
        status: 'recovered', elapsed_ms: elapsedMs, document_bytes: bytes.length,
        isolate: isolate(), invocation,
        reference: outcome.image.reference,
        content_type: outcome.image.contentType,
        image_bytes: outcome.image.bytes.length,
        /*
         * DIGESTED RATHER THAN RETURNED WHOLE. The probe is comparing winners,
         * not moving pictures around — and a length alone is not the
         * byte-for-byte identity the acceptance asks for, so this is the real
         * SHA-256 of the elected image and is compared against the digest of
         * the deterministic output.
         */
        image_sha256: await sha256Hex(outcome.image.bytes),
      });
    }
    return json({
      status: outcome.status, elapsed_ms: elapsedMs, document_bytes: bytes.length,
      isolate: isolate(), invocation,
      detail: 'detail' in outcome ? outcome.detail : undefined,
    });
  },
};
