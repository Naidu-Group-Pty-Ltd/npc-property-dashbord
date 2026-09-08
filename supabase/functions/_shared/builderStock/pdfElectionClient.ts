/**
 * BUILDER STOCK — HANDING THE ELECTION TO THE WORKER THAT CAN AFFORD IT.
 *
 * The Edge function keeps everything cheap and everything stateful: it fetched
 * the document through the guarded fetcher, applied the `%PDF-` and
 * image-link identity rules, and it will write the branch attempt, the
 * provenance and the image pointer afterwards. This module does one thing —
 * send the bytes to `builder-stock-pdf-service` and bring back the same
 * verdict `electFromPdfBytes` would have produced in-process.
 *
 * WHY, from the platform's own telemetry on 8 September 2026: every settler
 * kill was `reason: CPUTime`, at ≥2,031 ms against a 2,000 ms limit, while
 * memory peaked at 108 MB of 256. The election is indivisible and costs more
 * CPU than one invocation is allowed.
 *
 * A FAILURE HERE IS `unreachable`, NEVER A FINDING. If the worker is
 * unconfigured, unreachable, slow or broken, nothing has been learned about
 * the document — so the property is asked again on its own budget and nothing
 * is banked against it. That is the same reading this pipeline already gives a
 * fetch that did not complete, and it is what keeps an outage from being
 * recorded as "this builder's brochure names no image".
 */
import {
  ELECTION_CONTEXT_HEADER, ELECTION_REQUEST_ID_HEADER, ELECTION_TIMEOUT_MS,
  MAX_DOCUMENT_BYTES, PDF_ELECTION_PROTOCOL, base64ToBytes, encodeElectionContext,
} from './pdfElectionBoundary.pure.ts';
import type { ElectionContext } from './pdfElection.ts';
import type { PackageOutcome } from './packageImages.ts';

/** Configured, or the caller runs the election in-process as it always did. */
export function pdfElectionServiceConfigured(): boolean {
  return Boolean(Deno.env.get('BUILDER_STOCK_PDF_SERVICE_URL')
    && Deno.env.get('BUILDER_STOCK_PDF_SERVICE_TOKEN'));
}

/**
 * Elect through the worker.
 *
 * `requestId` correlates the call with the property and document it was made
 * for. It carries no authority — the election is a pure function of the bytes
 * and the context, so a retry with the same inputs returns the same winner
 * whatever the id says.
 */
export async function electViaService(
  bytes: Uint8Array,
  context: ElectionContext,
  requestId: string,
): Promise<PackageOutcome> {
  const base = (Deno.env.get('BUILDER_STOCK_PDF_SERVICE_URL') ?? '').replace(/\/+$/, '');
  const token = Deno.env.get('BUILDER_STOCK_PDF_SERVICE_TOKEN') ?? '';
  if (!base || !token) {
    return { status: 'unreachable', detail: 'The document reader is not configured.' };
  }
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    return {
      status: 'unreachable',
      detail: 'That document is larger than the reader accepts, so it could not be read.',
    };
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ELECTION_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/v1/elect`, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type': 'application/pdf',
        [ELECTION_CONTEXT_HEADER]: encodeElectionContext({
          protocol: PDF_ELECTION_PROTOCOL,
          label: context.label,
          identifiedBy: context.identifiedBy,
          design: context.design ?? null,
          identityHints: [...(context.identityHints ?? [])],
          documentName: context.documentName,
          url: context.url,
        }),
        [ELECTION_REQUEST_ID_HEADER]: requestId,
      },
      /*
       * Sent as-is, never copied. `fetch` accepts a Uint8Array at runtime;
       * only Deno's typings are fussy about the generic backing store. A
       * `.slice()` here would duplicate a 14 MB brochure in the isolate that
       * has the least room for it.
       */
      body: bytes as unknown as BodyInit,
    });

    if (!response.ok) {
      /*
       * Every non-200 is operational, including 400 and 413. A document the
       * reader refuses is a document we could not read — a fact about our
       * side, never about what the builder filed.
       */
      return {
        status: 'unreachable',
        detail: `That document could not be read (reader answered ${response.status}).`,
      };
    }

    const body = await response.json() as Record<string, unknown>;
    if (Number(body.protocol) !== PDF_ELECTION_PROTOCOL) {
      return {
        status: 'unreachable',
        detail: 'The document reader answered a contract this deployment does not speak.',
      };
    }

    if (body.status === 'recovered') {
      const image = body.image as Record<string, unknown> | undefined;
      if (!image || typeof image.bytes_b64 !== 'string') {
        return { status: 'unreachable', detail: 'The document reader returned no image bytes.' };
      }
      return {
        status: 'recovered',
        image: {
          bytes: base64ToBytes(image.bytes_b64),
          contentType: String(image.content_type ?? 'image/jpeg'),
          reference: String(image.reference ?? ''),
          documentName: String(image.document_name ?? context.documentName),
          documentUrl: String(image.document_url ?? context.url),
          provenance: image.provenance,
          role: image.role,
        },
      } as PackageOutcome;
    }

    if (body.status === 'not_identified' || body.status === 'unreachable') {
      return {
        status: body.status,
        detail: String(body.detail ?? 'That document could not be read.'),
      };
    }

    return { status: 'unreachable', detail: 'The document reader answered nothing usable.' };
  } catch (error) {
    const aborted = (error as { name?: string })?.name === 'AbortError';
    return {
      status: 'unreachable',
      detail: aborted
        ? 'That document took too long to read, so nothing was concluded about it.'
        : 'That document could not be sent to the reader.',
    };
  } finally {
    clearTimeout(timer);
  }
}
