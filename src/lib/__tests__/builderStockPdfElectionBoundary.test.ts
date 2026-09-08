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

  /*
   * AND IT SAYS WHICH ISOLATE ANSWERED. Cloudflare's ceiling is per-isolate,
   * and exceeding it does not necessarily fail: the runtime "lets in-flight
   * requests complete and creates a new isolate for subsequent requests". So
   * four sequential 200s can hide four silent recycles, and a status code
   * cannot tell the difference. One isolate across every run is the pass; two
   * is the ceiling biting quietly.
   */
  it('reports which isolate answered, so a silent recycle cannot read as a pass', () => {
    expect(probe).toContain('isolate: isolate(), invocation,');
    // Minted lazily: workerd refuses `crypto.randomUUID()` at module scope.
    expect(stripComments(probe)).not.toMatch(/^const \w+ = crypto\.randomUUID/m);
  });

  /*
   * AND THE NUMBER IDENTIFIES ITS OWN REQUEST. The handler awaits for over a
   * second between taking a number and answering, so reading the shared
   * counter when the response is built reports whatever it has become since:
   * measured on the first concurrent round this instrument ever ran, two
   * requests both said 17 and 16 appeared nowhere. A number that cannot
   * identify its request cannot show whether an isolate was recycled between
   * two of them, which is the whole reading the memory question turns on.
   */
  it('takes its invocation number at entry rather than reading it at exit', () => {
    expect(probe).toContain('invocations += 1;\n    const invocation = invocations;');
    // Only `/health`, which runs before the counter, may read the shared value —
    // and it says `served`, because a snapshot is not an identity.
    const afterCounter = probe.slice(probe.indexOf('const invocation = invocations;'));
    expect(afterCounter).not.toMatch(/invocation: invocations/);
    expect(probe).toContain('served: invocations');
  });

  it('answers with a real digest, not a length, so identity is byte-for-byte', () => {
    expect(probe).toContain("crypto.subtle.digest('SHA-256'");
    expect(probe).toContain('image_sha256: await sha256Hex(');
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
/*
 * THE HOSTED TEST IS SEQUENTIAL *AND* CONCURRENT.
 *
 * Cloudflare's ceiling is per-ISOLATE — "a single isolate can handle many
 * concurrent requests" — so one document in flight may never approach it while
 * two together do. A sequential-only pass would answer a question nobody
 * asked. And exceeding the ceiling does not necessarily fail: the runtime
 * "lets in-flight requests complete and creates a new isolate for subsequent
 * requests", so the reading is not only whether the requests succeeded but
 * whether the isolate that served them survived them.
 */
describe('the hosted acceptance exercises the isolate, not just the request', () => {
  const runner = read('cloudflare/builder-stock-pdf-probe/run-probe.mjs');

  it('runs the documents together for several rounds, after the sequential pass', () => {
    expect(runner).toContain('Promise.all(LOTS.map((doc) => elect(doc,');
    expect(runner).toContain("const rounds = Number(arg('rounds', '4'));");
    // Concurrency after a sequential failure measures nothing new, and a second
    // failure would read as a concurrency finding when it is not.
    expect(runner).toContain('if (!seqPass)');
    expect(runner).toContain('PHASE 3 — CONCURRENT: SKIPPED');
  });

  it('applies one acceptance rule to both phases rather than two', () => {
    // Two implementations of "did this pass" is how two phases come to
    // disagree about what they measured.
    expect(runner.match(/const accepts = /g)).toHaveLength(1);
    expect(runner.match(/async function elect\(/g)).toHaveLength(1);
    expect(runner).toContain("r.status === 'recovered' && r.identical === true");
  });

  /*
   * AND THE DETECTOR IS WHAT IS JUDGED, NOT THE PROSE AROUND IT. A first
   * version of this test asserted the file merely CONTAINED `exceededMemory`,
   * and both words also appear in the comment above the pattern and in the
   * Workers Logs guidance — so removing either from the pattern itself left
   * the test green. Two mutations survived on it. The pattern is read out of
   * the source and matched on its own.
   */
  it('names a resource kill for what it is, including the hosted outcomes', () => {
    const pattern = stripComments(runner)
      .split('\n').find((l) => l.startsWith('const KILL = '));
    expect(pattern).toBeDefined();
    for (const outcome of ['exceededMemory', 'exceededCpu', '1102', 'exceeded resource limits']) {
      expect(pattern).toContain(outcome);
    }
  });

  it('records whether the isolate was recycled under load', () => {
    expect(runner).toContain('isolates not seen in the sequential phase');
    expect(runner).toContain('RECYCLED UNDER LOAD');
  });

  it('sends the reader to Workers Logs with the windows to look at', () => {
    // A kill returns no body of ours; the invocation outcome exists only there.
    expect(runner).toContain('WORKERS LOGS');
    expect(runner).toContain('sequential: ');
    expect(runner).toContain('concurrent: ');
    expect(runner).toContain('wrangler tail builder-stock-pdf-probe');
  });
});

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
  /*
   * THE DRIVER MAY NOT INVENT A CONTEXT EITHER. A plausible hand-written label
   * with no design and no identity hints answered `not_identified` on both
   * documents in ~300 ms rather than `recovered` in ~1,200 ms — no estate name
   * to corroborate by, so no cover page is recognised, nothing is decoded, and
   * the CPU-heavy half never runs. That is a correct answer to the wrong
   * question, and it would have been recorded as a fact about Cloudflare.
   */
  it('the probe driver reads its context rather than inventing one', () => {
    const runner = read('cloudflare/builder-stock-pdf-probe/run-probe.mjs');
    expect(here('cloudflare/builder-stock-pdf-probe/contexts.json')).toBe(true);
    expect(runner).toContain("readFileSync(new URL('./contexts.json'");
    expect(runner).toContain('refusing to guess');
    const contexts = JSON.parse(read('cloudflare/builder-stock-pdf-probe/contexts.json'));
    for (const lot of ['516', '6706']) {
      expect(contexts[lot].design).toBeTruthy();
      expect(contexts[lot].identityHints.length).toBeGreaterThan(0);
    }
  });

  /*
   * THE PROBE IS EXCLUDED FROM THE WORKER TYPE GATE, AND ONLY THE PROBE.
   *
   * `tsconfig.worker.json` exists for `builder-stock-image-worker`, whose
   * premise — stated in its own comment — is that it imports nothing. The
   * probe breaks that on purpose: importing the shared election is the point,
   * so it carries Deno-style `.ts` specifiers and a remote `esm.sh` import
   * that this compiler cannot resolve. 59 errors, not one of them a defect.
   * It is checked instead by `deno check` and by the wrangler build, the two
   * toolchains that actually compile it.
   *
   * What must never happen is that exclusion widening. A gate switched off for
   * the worker it was written for is worse than no gate, because the config
   * still looks like one.
   */
  it('the worker type gate excludes the probe and nothing else', () => {
    const worker = JSON.parse(read('tsconfig.worker.json'));
    expect(worker.include).toEqual(['cloudflare']);
    expect(worker.exclude).toEqual(['cloudflare/builder-stock-pdf-probe']);
    // The real worker is still inside the gate.
    expect(here('cloudflare/builder-stock-image-worker/src/index.ts')).toBe(true);
  });

  /*
   * AND THE REPLACEMENT CHECK IS ACTUALLY WIRED.
   *
   * This repo has already recorded the failure this guards: "a guard nobody
   * runs still reads as coverage" — the Cloudflare worker's own test file sat
   * beside a CI step that did not name it, and every proof in it ran on no
   * runner. Excluding the probe from `tsconfig.worker.json` is only safe
   * BECAUSE something else checks it, so the something else is asserted here
   * rather than assumed.
   */
  it('CI validates the probe with the toolchains that actually compile it', () => {
    const ci = read('.github/workflows/ci.yml');
    const step = ci.slice(ci.indexOf('TEMPORARY -- Builder Stock PDF probe'));
    expect(step).toContain('deno check cloudflare/builder-stock-pdf-probe/src/index.ts');
    /*
     * WITHOUT THIS THE CHECK DOES NOT RUN AT ALL. Deno walks up to the root
     * `package.json`, switches to bring-your-own-node_modules resolution, and
     * dies on `Could not find "@types/node" in a node_modules folder` —
     * because this job never runs `npm ci` at the root. `deno check` then
     * exits 1 having type-checked nothing, which is this repo's own recorded
     * failure mode: a gate that "was passing by not running", one dependency
     * along. Verified by reproducing it with the root install removed.
     */
    expect(step).toContain('DENO_NO_PACKAGE_JSON: "1"');
    expect(step).toContain('npm ci --prefix cloudflare/builder-stock-pdf-probe');
    expect(step).toContain('wrangler@');
    expect(step).toContain('deploy --dry-run');
    expect(step).toContain('-c cloudflare/builder-stock-pdf-probe/wrangler.jsonc');
    // The wrangler build resolves the esm.sh -> npm alias from the probe's own
    // dependency, so the lockfile `npm ci` reads has to be in the repository.
    expect(here('cloudflare/builder-stock-pdf-probe/package-lock.json')).toBe(true);
  });

  /*
   * AND THE EXISTING WORKER'S GATE IS UNTOUCHED. The rule this whole exercise
   * runs on: adapt the experiment to the architecture, never the architecture
   * to the experiment.
   */
  it('leaves the existing image worker under the strict typecheck', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('npx tsc --noEmit -p tsconfig.worker.json');
    const worker = JSON.parse(read('tsconfig.worker.json'));
    expect(worker.compilerOptions.strict).toBe(true);
    expect(worker.compilerOptions.allowImportingTsExtensions).toBeUndefined();
  });

  it('and the runtime is not re-armed for an unproven boundary', () => {
    const runtime = read('supabase/functions/_shared/builderStock/runtimeVersion.pure.ts');
    expect(runtime).toContain('export const RUNTIME_VERSION = 2;');
  });
});
