/**
 * Builder stock — the PDF election's execution boundary.
 *
 * WHY IT EXISTS, from the platform's own per-execution telemetry on 8
 * September 2026. A thirteen-property cold start killed the settler thirteen
 * times and EVERY kill was `reason: CPUTime`: successful executions ended at
 * 1,828 ms of CPU or less, killed ones at 2,031 ms or more, against a 2,000 ms
 * limit, while memory peaked at 108 MB of a 256 MB ceiling. Memory was never
 * the constraint, so no scheduling rule could have helped — an indivisible
 * 2.4 s task does not fit a 2.0 s budget.
 *
 * MEASURED AFTER THE MOVE, the same two documents through the same Edge entry:
 * user CPU 2.66 s in-process against 0.07 s via the worker, and resident
 * memory 315 MB against 141 MB. The election still happens; it happens where
 * there is CPU for it.
 *
 * The rule these tests exist to hold: it is an EXECUTION-LOCATION change. One
 * implementation decides which image wins, and a failure of the boundary is
 * never a finding about a builder's document.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ELECTION_CONTEXT_HEADER, ELECTION_TIMEOUT_MS, MAX_DOCUMENT_BYTES,
  PDF_ELECTION_PROTOCOL, base64ToBytes, bytesToBase64,
  decodeElectionContext, encodeElectionContext,
} from '../../../supabase/functions/_shared/builderStock/pdfElectionBoundary.pure';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

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
  const worker = read('builder-stock-pdf-service/main.ts');
  const election = read('supabase/functions/_shared/builderStock/pdfElection.ts');

  it('the worker runs the shared module rather than its own copy', () => {
    expect(worker).toContain("from '../supabase/functions/_shared/builderStock/pdfElection.ts'");
    expect(worker).toContain('electFromPdfBytes(');
  });

  it('and the worker holds no election logic of its own', () => {
    // The judgements live in the shared modules. Anything in the CODE that
    // named a threshold, a page rule or a role would be a second extractor —
    // the prose above may of course discuss them.
    const code = stripComments(worker);
    expect(code).not.toMatch(/coverPage|floorPlan|facade|threshold|score/i);
  });

  it('the shared module is what the Edge path calls too', () => {
    const pkg = read('supabase/functions/_shared/builderStock/packageImages.ts');
    expect(pkg).toContain("from './pdfElection.ts'");
    expect(pkg).toContain('electFromPdfBytes(bytes, readPageTexts, context)');
  });

  it('the election still takes the decode slot around the whole heavy path', () => {
    const slot = election.indexOf('withPdfDecodeSlot');
    const text = election.indexOf('await readPageTexts(bytes)');
    expect(slot).toBeGreaterThan(-1);
    expect(slot).toBeLessThan(text);
  });
});

describe('the worker is not an open PDF processor', () => {
  const worker = read('builder-stock-pdf-service/main.ts');

  it('requires a bearer on everything but health', () => {
    expect(worker).toContain("if (!auth.toLowerCase().startsWith('bearer ')");
    expect(worker).toContain("json({ error: 'unauthorised' }, 401)");
  });

  it('refuses everything while the token is unset, rather than serving openly', () => {
    expect(worker).toContain("json({ error: 'service_token_not_configured' }, 503)");
  });

  it('reads the token from the environment and never from source', () => {
    expect(worker).toContain("Deno.env.get('BUILDER_STOCK_PDF_SERVICE_TOKEN')");
    // A literal token would be a secret in source; the only literals here are
    // env var names and error codes.
    expect(worker).not.toMatch(/TOKEN\s*=\s*['"][A-Za-z0-9._-]{12,}['"]/);
  });

  it('bounds the document both by the declared length and by what arrived', () => {
    expect(worker).toContain("request.headers.get('content-length')");
    expect(worker).toContain('bytes.length > MAX_DOCUMENT_BYTES');
  });

  it('answers health with an explicit version and protocol', () => {
    expect(worker).toContain("url.pathname === '/health'");
    expect(worker).toContain('version: VERSION');
    expect(worker).toContain('protocol: PDF_ELECTION_PROTOCOL');
  });

  it('writes no state anywhere', () => {
    // No database client, no storage, no service-role key: this reads a
    // document and answers. Every write stays in the Supabase path. Import
    // PATHS legitimately contain "supabase" — the shared modules live there —
    // so they are excluded and everything else is judged.
    const code = stripComments(worker)
      .split('\n').filter((line) => !line.trim().startsWith('import')
        && !line.includes("from '../supabase/")).join('\n');
    expect(code).not.toMatch(/supabase|createClient|SERVICE_ROLE|storage|\.from\(/i);
  });
});

describe('a boundary failure is never a finding about the document', () => {
  const client = read('supabase/functions/_shared/builderStock/pdfElectionClient.ts');

  it('reads every reader failure as unreachable, never not_identified', () => {
    // `not_identified` is banked and suppresses the source until a version
    // bump. An outage must never be recorded as "this brochure names no
    // image", so the client may only ever produce it by relaying the worker.
    const produced = [...client.matchAll(/status: '(\w+)'/g)].map((m) => m[1]);
    const invented = produced.filter((s) => s !== 'unreachable' && s !== 'recovered');
    expect(invented).toEqual([]);
  });

  it('relays the worker\'s own verdicts unchanged', () => {
    expect(client).toContain("body.status === 'not_identified' || body.status === 'unreachable'");
  });

  it('refuses a protocol it does not speak instead of guessing', () => {
    expect(client).toContain('Number(body.protocol) !== PDF_ELECTION_PROTOCOL');
  });

  it('bounds the wait and cleans the timer up on every path', () => {
    expect(client).toContain('ELECTION_TIMEOUT_MS');
    expect(client).toContain('} finally {');
    expect(client).toContain('clearTimeout(timer)');
  });

  it('never copies the document to send it', () => {
    // A `.slice()` would duplicate a 14 MB brochure in the isolate with the
    // least room for it.
    expect(client).not.toContain('bytes.slice()');
    expect(client).toContain('body: bytes as unknown as BodyInit');
  });
});

describe('the Edge keeps every write, and only sheds the CPU', () => {
  const pkg = read('supabase/functions/_shared/builderStock/packageImages.ts');

  it('still fetches, sniffs and applies the identity rules itself', () => {
    // From the function's own body: `electViaService` also appears in the
    // import block at the top of the file.
    const body = pkg.slice(pkg.indexOf('async function extractFromDocument'));
    const before = body.slice(0, body.indexOf('electViaService'));
    expect(before).toContain('await fetchPackage(url)');
    expect(before).toContain("String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-'");
    expect(before).toContain('That link is an image rather than a package document');
  });

  it('falls back to running it in-process when the worker is unconfigured', () => {
    expect(pkg).toContain('pdfElectionServiceConfigured()');
    expect(pkg).toContain('return await electFromPdfBytes(bytes, readPageTexts, context)');
  });

  it('keeps an injected reader in-process, so tests cannot reach the wire', () => {
    expect(pkg).toContain('readPageTexts === readPdfPageTextResult');
  });
});

/**
 * The deployment bootstrap.
 *
 * Two details that are only visible on a FIRST deploy, when nothing exists
 * yet: the gate must require every variable the auth steps consume, and the
 * service — which refuses everything while its token is unset — has no
 * environment to inherit one from. Neither is about the election; both decide
 * whether a revision that cannot answer could ever take traffic.
 */
describe('the deploy workflow can bootstrap without promoting a blind revision', () => {
  const workflow = read('.github/workflows/deploy-builder-stock-pdf-service.yml');
  const deploy = read('builder-stock-pdf-service/DEPLOY.md');
  /*
   * The JOBS, not the `workflow_dispatch` input that shares the word
   * "promote" — slicing on the bare name matched that input first and
   * produced an empty range that passed nothing.
   */
  const verifyJob = workflow.slice(
    workflow.indexOf('  verify:'), workflow.indexOf("  # ── Promotion is a person's decision"));
  const promoteJob = workflow.slice(workflow.indexOf("  # ── Promotion is a person's decision"));
  /** Commands only: the header prose discusses the flags it refuses to use. */
  const commands = workflow.split('\n')
    .filter((line) => !line.trim().startsWith('#')).join('\n');

  it('gates on every variable the auth steps actually use', () => {
    // Gating on two of three lets the build start and fail at the auth step
    // instead of saying plainly that the deployment is not configured.
    for (const name of [
      'GCP_PROJECT_ID',
      'GCP_WORKLOAD_IDENTITY_PROVIDER',
      'GCP_DEPLOY_SERVICE_ACCOUNT',
    ]) {
      expect(workflow, `${name} must be gated on`)
        .toContain(`missing="$missing ${name}"`);
    }
    // And each is required by a step that would otherwise fail late.
    expect(workflow).toContain('service_account: ${{ vars.GCP_DEPLOY_SERVICE_ACCOUNT }}');
  });

  it('only ever MERGES environment, never replaces it', () => {
    /*
     * `--set-env-vars` and `--set-secrets` replace the whole environment, so
     * naming one variable silently drops every other one somebody configured
     * on the service — including the token itself.
     */
    expect(commands).not.toContain('--set-env-vars');
    expect(commands).not.toContain('--set-secrets');
    expect(commands).toContain('--update-secrets');
  });

  it('stops rather than warns while the service holds no token', () => {
    // A revision that cannot answer an election is not a verified revision.
    expect(verifyJob).toContain("grep -q '\"token_configured\":true'");
    expect(verifyJob).toContain('exit 1');
    expect(verifyJob).not.toContain('::warning title=Token unset');
  });

  it('reads the health body even when it answers 503', () => {
    // `curl -f` discards the body on an error status — which is exactly the
    // body that says the token is missing.
    expect(verifyJob).toContain("-o /tmp/health.json -w '%{http_code}'");
    expect(verifyJob).not.toMatch(/curl -sf[^\n]*health/);
  });

  it('will not accept a 503 as proof that the bearer is enforced', () => {
    expect(verifyJob).toContain('[ "$code" = "401" ]');
    expect(verifyJob).not.toContain('|| [ "$code" = "503" ]');
  });

  it('promotes only after verification, and only when a person asks', () => {
    expect(promoteJob).toContain('needs: [gate, stage, verify]');
    expect(promoteJob).toContain('inputs.promote');
  });

  it('documents both bootstrap routes, including the deliberate first failure', () => {
    expect(deploy).toContain('BUILDER_STOCK_PDF_SECRET');
    expect(deploy).toContain('--update-secrets');
    expect(deploy).toContain('--update-env-vars');
    expect(deploy).toMatch(/two-pass bootstrap/i);
    expect(deploy).toMatch(/failing first pass is the designed outcome/i);
  });

  it('says the settler keeps working while the service is absent', () => {
    expect(deploy).toContain('pdfElectionServiceConfigured()');
    expect(deploy).toMatch(/runs in-process exactly as it always has/i);
  });
});
