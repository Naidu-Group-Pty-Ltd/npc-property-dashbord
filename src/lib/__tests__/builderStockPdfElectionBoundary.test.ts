/**
 * Builder stock — the PDF election's execution boundary. AN EXPERIMENT.
 *
 * WHY IT EXISTS, from the platform's own per-execution telemetry on 8
 * September 2026. A thirteen-property cold start killed the settler thirteen
 * times and EVERY kill was `reason: CPUTime`: successful executions ended at
 * 1,828 ms of CPU or less, killed ones at 2,031 ms or more, against a 2,000 ms
 * limit, while memory peaked at 108 MB of a 256 MB ceiling. Memory was never
 * the constraint, so no scheduling rule could have helped — an indivisible
 * 2.4 s task does not fit a 2.0 s budget.
 *
 * WHAT THIS BRANCH IS, AND IS NOT. It answers one question and wires nothing:
 * can the EXACT existing election run inside a real Cloudflare Worker under
 * the actual hosted limits? So the heavy half is lifted into one named unit,
 * `electFromPdfBytes`, and a temporary probe Worker runs THAT unit — while
 * production still calls it in this process, exactly as before. The tests
 * below hold both halves of that: the probe cannot be a second extractor, and
 * the settler cannot have started routing anywhere.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ELECTION_CONTEXT_HEADER, ELECTION_TIMEOUT_MS, MAX_DOCUMENT_BYTES,
  PDF_ELECTION_PROTOCOL, base64ToBytes, bytesToBase64,
  decodeElectionContext, encodeElectionContext,
} from '../../../supabase/functions/_shared/builderStock/pdfElectionBoundary.pure';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const here = (rel: string) => existsSync(join(process.cwd(), rel));

const PROBE = 'cloudflare/builder-stock-pdf-probe/src/index.ts';

/** Source with block and line comments removed, so prose is not evidence. */
const stripComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * A hand-built payload, encoded the way the module encodes.
 *
 * `btoa` is Latin-1 only and throws on the em-dash a real builder's label
 * carries, so a test that reaches for it directly is testing `btoa`.
 */
const wire = (value: unknown) =>
  btoa(unescape(encodeURIComponent(JSON.stringify(value))));

describe('the context survives the wire exactly', () => {
  const context = {
    protocol: PDF_ELECTION_PROTOCOL,
    label: 'Lot 516 — Winterset Lodge',
    identifiedBy: 'direct_link' as const,
    design: 'Grange 19',
    identityHints: ['Winterset Lodge', 'Manor Lakes'],
    documentName: 'Winterset-Lodge-Lot-516.pdf',
    url: 'https://www.dropbox.com/scl/fi/abc/W.pdf?dl=1',
  };

  it('round-trips every field the election reads', () => {
    expect(decodeElectionContext(encodeElectionContext(context))).toEqual(context);
  });

  it('survives the non-ASCII a builder actually types', () => {
    const accented = { ...context, label: 'Lot 5 — Cœur d’Alène • 北区' };
    expect(decodeElectionContext(encodeElectionContext(accented))?.label).toBe(accented.label);
  });

  /*
   * NEVER GUESSED. An election run against the wrong property's label puts
   * another house on a client's card, which is the one failure this whole
   * pipeline exists to prevent — so anything the decoder cannot vouch for is
   * refused rather than defaulted.
   */
  it('refuses anything it cannot vouch for', () => {
    expect(decodeElectionContext('')).toBeNull();
    expect(decodeElectionContext(null)).toBeNull();
    expect(decodeElectionContext('not-base64!!')).toBeNull();
    expect(decodeElectionContext(wire({ nope: 1 }))).toBeNull();
    // A protocol this deployment does not speak.
    expect(decodeElectionContext(encodeElectionContext({ ...context, protocol: 999 }))).toBeNull();
    // A label that is not a label.
    expect(decodeElectionContext(
      wire({ ...context, label: 42 }))).toBeNull();
    // An origin this code does not recognise.
    expect(decodeElectionContext(
      wire({ ...context, identifiedBy: 'guessed' }))).toBeNull();
  });

  it('drops non-string identity hints rather than passing them through', () => {
    const decoded = decodeElectionContext(
      wire({ ...context, identityHints: ['ok', 7, null, 'fine'] }));
    expect(decoded?.identityHints).toEqual(['ok', 'fine']);
  });
});

describe('the image survives the wire byte for byte', () => {
  it('round-trips bytes, including ones that break naive encoders', () => {
    const bytes = new Uint8Array(70_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7) % 256;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('handles an empty image without throwing', () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });
});

describe('the bounds are stated, not implied', () => {
  it('accepts the real corpus and refuses the absurd', () => {
    // Lot 6706's 13.9 MB brochure is the largest measured in production.
    expect(MAX_DOCUMENT_BYTES).toBeGreaterThan(14 * 1024 * 1024);
    expect(MAX_DOCUMENT_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
  });

  it('bounds the wait, so a hung reader is answered rather than awaited', () => {
    expect(ELECTION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(ELECTION_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });
});

describe('one implementation decides which image wins', () => {
  const probe = read(PROBE);
  const election = read('supabase/functions/_shared/builderStock/pdfElection.ts');

  it('the probe runs the shared election rather than its own copy', () => {
    expect(probe).toContain("from '../../../supabase/functions/_shared/builderStock/pdfElection.ts'");
    expect(probe).toContain('electFromPdfBytes(');
  });

  /*
   * AND THE SHARED READER TOO. A first version of the probe passed its own
   * `extractText` wrapper and answered `not_identified` on both documents
   * where production answers `recovered`, because `readPdfPageTextResult` also
   * appends each page's AcroForm FIELD text — which is what identifies the
   * cover page on those two brochures. A probe that reimplements the reader
   * measures its own reimplementation.
   */
  it('and the shared reader, so a verdict here is the verdict everywhere', () => {
    expect(probe).toContain("from '../../../supabase/functions/_shared/builderStock/pdfText.ts'");
    expect(probe).toContain('electFromPdfBytes(bytes, readPdfPageTextResult');
  });

  it('and the probe holds no election logic of its own', () => {
    // The judgements live in the shared modules. Anything in the CODE that
    // named a threshold, a page rule or a role would be a second extractor —
    // the prose above may of course discuss them.
    const code = stripComments(probe);
    expect(code).not.toMatch(/coverPage|floorPlan|facade|threshold|score/i);
  });

  it('the shared module is what the Edge path calls too', () => {
    const pkg = read('supabase/functions/_shared/builderStock/packageImages.ts');
    expect(pkg).toContain("from './pdfElection.ts'");
    expect(pkg).toContain('electFromPdfBytes(bytes, readPageTexts, {');
  });

  it('the election still takes the decode slot around the whole heavy path', () => {
    const slot = election.indexOf('withPdfDecodeSlot');
    const text = election.indexOf('await readPageTexts(bytes)');
    expect(slot).toBeGreaterThan(-1);
    expect(slot).toBeLessThan(text);
  });
});

describe('the probe is not an open PDF processor', () => {
  const probe = read(PROBE);

  it('requires a bearer on everything but health', () => {
    expect(probe).toContain('auth !== `Bearer ${token}`');
    expect(probe).toContain("json({ error: 'unauthorised' }, 401)");
  });

  it('refuses everything while the token is unset, rather than serving openly', () => {
    expect(probe).toContain("json({ error: 'probe_token_not_configured' }, 503)");
  });

  it('reads the token from the environment and never from source', () => {
    expect(probe).toContain('env.BUILDER_STOCK_PDF_PROBE_TOKEN');
    // A literal token would be a secret in source; the only literals here are
    // binding names and error codes.
    expect(probe).not.toMatch(/TOKEN\s*[:=]\s*['"][A-Za-z0-9._-]{12,}['"]/);
  });

  it('bounds the document by what actually arrived', () => {
    expect(probe).toContain('bytes.length > MAX_DOCUMENT_BYTES');
    expect(probe).toContain("json({ error: 'bad_document'");
  });

  it('answers health with an explicit protocol, and says it is not production', () => {
    expect(probe).toContain("url.pathname === '/health'");
    expect(probe).toContain('protocol: PDF_ELECTION_PROTOCOL');
    expect(probe).toContain('not production');
  });

  /*
   * THE INSTRUMENT CARRIES ITS OWN CONTROL. A pass under a runtime that is
   * not enforcing the memory ceiling proves nothing about the ceiling —
   * measured on 8 September 2026, `wrangler dev --local` allocated 900 MB and
   * answered 200, so the local pass is evidence of EXECUTION only. `/v1/alloc`
   * is what asks the deployed runtime whether it is enforcing, and it is
   * behind the same bearer as the election.
   */
  it('carries a calibration control, so a pass can be trusted', () => {
    expect(probe).toContain("url.pathname === '/v1/alloc'");
    // Behind the token: the bearer check precedes it.
    expect(probe.indexOf("json({ error: 'unauthorised' }, 401)"))
      .toBeLessThan(probe.indexOf("url.pathname === '/v1/alloc'"));
  });

  it('writes no state anywhere', () => {
    // No database client, no storage, no service-role key: this reads a
    // document and answers. Every write stays in the Supabase path, which is
    // where the import paths legitimately name it — so the imports are cut
    // away and the worker's own body is judged.
    const body = stripComments(probe.slice(probe.indexOf('interface Env')));
    expect(body).not.toMatch(/supabase|createClient|SERVICE_ROLE|storage|\.from\(/i);
  });
});

/*
 * THE EXPERIMENT IS AN EXPERIMENT.
 *
 * A probe that quietly became a dependency would be the worst of both: an
 * unproven platform in the settler's path, with the evidence for it still
 * being gathered. So the separation is asserted rather than intended — every
 * one of these would have to be deliberately undone to wire it up.
 */
describe('nothing in production routes anywhere', () => {
  const pkg = read('supabase/functions/_shared/builderStock/packageImages.ts');

  it('the Edge still fetches, sniffs and applies the identity rules itself', () => {
    const body = pkg.slice(pkg.indexOf('async function extractFromDocument'));
    const before = body.slice(0, body.indexOf('electFromPdfBytes('));
    expect(before).toContain('await fetchPackage(url)');
    expect(before).toContain("String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-'");
    expect(before).toContain('That link is an image rather than a package document');
  });

  it('and then runs the election in this process, with no route out', () => {
    expect(stripComments(pkg)).not.toMatch(/electViaService|pdfElectionClient|ELECTION_CONTEXT_HEADER|PDF_SERVICE_URL|PDF_ELECTION_SERVICE/);
  });

  it('there is no client module and no deployable service beside it', () => {
    expect(here('supabase/functions/_shared/builderStock/pdfElectionClient.ts')).toBe(false);
    expect(here('builder-stock-pdf-service')).toBe(false);
    expect(here('.github/workflows/deploy-builder-stock-pdf-service.yml')).toBe(false);
  });

  /*
   * AND NO RUNTIME BUMP. `RUNTIME_VERSION` is what re-arms the whole fleet
   * against a processing-reliability change; bumping it for a boundary that
   * has not been proven would spend a fleet-wide re-run on an experiment.
   */
  it('and the runtime is not re-armed for an unproven boundary', () => {
    const runtime = read('supabase/functions/_shared/builderStock/runtimeVersion.pure.ts');
    expect(runtime).toContain('export const RUNTIME_VERSION = 2;');
  });
});
