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
  bytesToBase64, decodeElectionContext,
} from '../../../supabase/functions/_shared/builderStock/pdfElectionBoundary.pure.ts';

interface Env { BUILDER_STOCK_PDF_PROBE_TOKEN?: string }

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
        note: 'temporary probe; not production',
      }, env.BUILDER_STOCK_PDF_PROBE_TOKEN ? 200 : 503);
    }

    const token = env.BUILDER_STOCK_PDF_PROBE_TOKEN ?? '';
    if (!token) return json({ error: 'probe_token_not_configured' }, 503);
    const auth = request.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${token}`) return json({ error: 'unauthorised' }, 401);

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
      return json({ allocated_mb: held.length, first: held[0][0] });
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
        reference: outcome.image.reference,
        content_type: outcome.image.contentType,
        image_bytes: outcome.image.bytes.length,
        // Hashed rather than returned whole: the probe is comparing winners,
        // not moving pictures around.
        image_b64_sha_prefix: bytesToBase64(outcome.image.bytes).slice(0, 44),
      });
    }
    return json({
      status: outcome.status, elapsed_ms: elapsedMs, document_bytes: bytes.length,
      detail: 'detail' in outcome ? outcome.detail : undefined,
    });
  },
};
