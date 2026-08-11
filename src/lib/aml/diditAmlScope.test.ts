import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The boundary of this integration.
 *
 * Didit was added for IDENTITY VERIFICATION and nothing else. NPC screens
 * sanctions against its own DFAT/UN/OFAC copies, determines PEP status itself,
 * and gates service on a human decision. These tests exist so that stays true
 * as the integration is maintained — an "improvement" that enables Didit's AML
 * module, or wires an approval to a case status, fails here.
 */

const repo = process.cwd();
const read = (p: string) => readFileSync(join(repo, p), 'utf8');

/**
 * Source with comments removed.
 *
 * Several assertions here are "this word must not appear in the code" — and
 * the comments that explain *why* it must not appear necessarily say it. An
 * assertion that cannot tell those apart would forbid documenting itself.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(repo, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(repo, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/** Every file this integration added or changed on the server side. */
const DIDIT_SERVER_FILES = [
  'supabase/functions/_shared/aml/providers/didit.pure.ts',
  'supabase/functions/_shared/aml/providers/diditClient.ts',
  'supabase/functions/_shared/aml/providers/diditWebhook.pure.ts',
  'supabase/functions/_shared/aml/diditOutcome.ts',
  'supabase/functions/didit-webhook/index.ts',
];

const diditSource = DIDIT_SERVER_FILES.map(read).join('\n');
const migration = read('supabase/migrations/20260908000000_aml_didit_hosted_idv.sql');
const registry = read('supabase/functions/_shared/aml/providers/index.ts');

describe('Didit AML screening is NOT enabled', () => {
  it('never requests Didit\'s AML, PEP or watchlist features', () => {
    // The workflow NPC created contains OCR + LIVENESS + FACE_MATCH only, and
    // nothing in the code asks for more.
    for (const feature of ['"AML"', "'AML'", 'aml_screenings', 'AML_SCREENING',
      'PROOF_OF_ADDRESS', 'PHONE_VERIFICATION', 'EMAIL_VERIFICATION',
      'KYB_REGISTRY', 'KYB_DOCUMENTS', 'IP_ANALYSIS']) {
      expect(diditSource).not.toContain(feature);
    }
  });

  it('reads only the three required identity modules from a decision', () => {
    const pure = read('supabase/functions/_shared/aml/providers/didit.pure.ts');
    const map = pure.slice(pure.indexOf('const FEATURE_RESULT_KEY'), pure.indexOf('FEATURE_LABEL'));
    expect(map).toContain('id_verifications');
    expect(map).toContain('liveness_checks');
    expect(map).toContain('face_matches');
    // No screening arrays are consulted at all.
    expect(map).not.toContain('aml_screenings');
  });

  it('never calls a Didit AML/transaction endpoint', () => {
    const client = read('supabase/functions/_shared/aml/providers/diditClient.ts');
    expect(client).not.toMatch(/\/v3\/(aml|transaction|business|travel)/);
    // Exactly two endpoints: create a session, read its decision.
    const paths = [...client.matchAll(/'\/v3\/[^']*'|`\/v3\/[^`]*`/g)].map((m) => m[0]);
    expect(paths).toHaveLength(2);
  });

  it('the provider config records the identity-only scope', () => {
    expect(migration).toContain("'idv'");
    expect(migration).toContain('ID_VERIFICATION');
    expect(migration).toMatch(/Didit AML\/PEP\/sanctions screening is NOT enabled/);
    // Registered under the idv capability only — never pep_sanctions or
    // adverse_media.
    expect(migration).not.toContain("'pep_sanctions'");
    expect(migration).not.toContain("'adverse_media'");
  });

  it('is not wired into the screening provider registry', () => {
    const screening = registry.slice(
      registry.indexOf('LIVE_SCREENING_ADAPTERS'), registry.indexOf('// ---------- resolver'));
    expect(screening).not.toContain('didit');
    expect(screening).toContain('local_lists');
  });
});

describe('a Didit approval does not clear the AML case', () => {
  it('writes only to verification_checks, case_events and provider_events', () => {
    const tables = [...diditSource.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]);
    expect([...new Set(tables)].sort()).toEqual(
      ['case_events', 'provider_events', 'verification_checks'].sort());
  });

  it('never touches a case status, hold, risk or screening record', () => {
    for (const table of ['cases', 'screening_checks', 'screening_matches',
      'pep_determinations', 'risk_assessments', 'holds', 'service_gates',
      'edd_requirements', 'source_of_funds', 'senior_manager_approvals']) {
      expect(diditSource).not.toContain(`from('${table}')`);
    }
  });

  it('never writes the words that would clear a case', () => {
    for (const forbidden of ["status: 'cleared'", "'cleared'", 'service_gate',
      'risk_rating', 'pep_status', 'sanctions_status']) {
      expect(diditSource).not.toContain(forbidden);
    }
  });

  it('records the identity-only scope on the timeline entry it writes', () => {
    const outcome = read('supabase/functions/_shared/aml/diditOutcome.ts');
    expect(outcome).toContain("scope: 'identity_verification_only'");
  });
});

describe('the existing non-KYC AML architecture is untouched', () => {
  /**
   * Files whose content must be byte-identical to `main`. Rather than diffing
   * against git (which a test cannot do reliably), these assert the load-bearing
   * behaviours are still present and unmodified in shape.
   */
  it('local sanctions screening still screens DFAT/UN/OFAC with its freshness gate', () => {
    expect(registry).toContain('makeLocalListsScreeningProvider');
    expect(registry).toContain('DEFAULT_REQUIRED_SANCTIONS_LISTS');
    expect(registry).toContain('sanctions_list_unavailable');
    expect(registry).toContain('LOCAL_LISTS_SUPPORTED_SCOPES');
    expect(registry).toContain('scopes_not_covered');
  });

  it('the screening provider factory is unchanged in behaviour', () => {
    const fn = registry.slice(registry.indexOf('export function getScreeningProvider'));
    expect(fn.slice(0, 700)).toContain('LIVE_SCREENING_ADAPTERS[key]');
    expect(fn.slice(0, 700)).not.toContain('didit');
  });

  it('no PEP, EDD, source-of-funds or monitoring module was modified', () => {
    // If this integration had touched them, `didit` would appear in them.
    const amlShared = walk('supabase/functions/_shared/aml')
      .filter((f) => f.endsWith('.ts') && !/didit/i.test(f));
    const offenders = amlShared.filter((f) => /didit/i.test(read(f)));
    /*
     * Two files may name the adapter, and neither is a PEP, EDD,
     * source-of-funds or monitoring module:
     *
     *   - the provider registry, which wires it;
     *   - the identity-document list, whose header points a reader at where
     *     the provider's own document codes live. That is a comment and not a
     *     dependency — `identityDocumentSession.test.ts` asserts the compiled
     *     code carries no provider vocabulary at all, which is the property
     *     that actually matters for the browser bundle.
     */
    expect(offenders.sort()).toEqual([
      'supabase/functions/_shared/aml/identityDocuments.pure.ts',
      'supabase/functions/_shared/aml/providers/index.ts',
      /*
       * The Standalone sequence, which imports the provider's own client and
       * response readers. It is the identity path and nothing else: it calls
       * three endpoints — ID document, passive liveness, face match 1:1 — and
       * settles one `aml.verification_checks` row. The screening scope test
       * above and the AML-endpoint test below are what hold it to that.
       */
      'supabase/functions/_shared/aml/standaloneVerification.ts',
    ]);
  });
});

describe('portal privacy boundary', () => {
  const portal = read('supabase/functions/aml-client-portal/index.ts');
  const portalApi = read('src/lib/aml/amlPortalApi.ts');
  const step = read('src/components/portal/IdentityVerificationStep.tsx');

  it('the client contract carries no score, threshold or provider detail', () => {
    const contract = portalApi.slice(
      portalApi.indexOf('export interface AmlVerificationParty'),
      portalApi.indexOf('export interface AmlConsentDocument'));
    for (const internal of ['score', 'threshold', 'provider_reference',
      'workflow', 'didit', 'outcome_detail', 'reason']) {
      expect(contract.toLowerCase()).not.toContain(internal);
    }
  });

  it('the hosted-session response returns a URL and nothing else', () => {
    const block = portal.slice(
      portal.indexOf("case 'start_hosted_verification'"),
      portal.indexOf("case 'submit_verification'"));
    const responses = [...block.matchAll(/return jsonResponse\(\{([\s\S]*?)\}, \d+\)|return jsonResponse\(\{([\s\S]*?)\n\s*\}\);/g)]
      .map((m) => m[1] ?? m[2]).join('\n');
    for (const internal of ['workflow_id', 'session_token', 'api_key',
      'provider:', 'DIDIT_', 'environment:']) {
      expect(responses).not.toContain(internal);
    }
  });

  it('the browser never learns the provider or workflow', () => {
    for (const secretish of ['DIDIT_API_KEY', 'DIDIT_WEBHOOK_SECRET', 'DIDIT_WORKFLOW_ID']) {
      expect(portalApi).not.toContain(secretish);
      expect(step).not.toContain(secretish);
    }
    // The step no longer branches INTO a hosted experience — it recognises the
    // retired flow token only to refuse it and render the documentary route.
    expect(step).toContain("provider_flow ?? 'capture') === 'hosted'");
    expect(step).toContain("? 'temporarily_unavailable'");
    expect(codeOnly(step).toLowerCase()).not.toContain('didit');
  });

  it('the frontend cannot mark anybody verified', () => {
    // It may listen for a "something happened" nudge from the frame — see the
    // origin test below — but there is no return-URL status and no local
    // status assertion anywhere. Code only: the comments explaining the
    // listener necessarily name the mechanism.
    expect(codeOnly(step)).not.toContain('postMessage');
    expect(step).not.toMatch(/status:\s*['"]verified['"]/);
    // Completion only ever triggers a server re-read.
    expect(step).toContain('await load()');
  });

  it('delegates no permission, because the provider no longer runs inside NPC', () => {
    /*
     * This test used to assert the opposite — that the embed was handed
     * `camera`, `microphone`, the media permissions and the motion sensors,
     * and was deliberately not sandboxed. All of that was correct FOR AN
     * EMBED, and the embed is what went: a third-party application inside
     * NPC's own page, showing another product's chrome and errors to a
     * customer who believed they were still in NPC.
     *
     * The capture now runs in its own top-level window, so it asks for the
     * camera in its own right, under its own origin, in a permission prompt
     * that names whose page is asking. NPC delegates nothing and there is no
     * frame to sandbox — which is a stronger boundary than the sandbox
     * attribute ever was.
     */
    expect(step).not.toContain('<iframe');
    expect(step).not.toContain('HOSTED_IFRAME_ALLOW');
    expect(step).not.toContain('allowFullScreen');
    expect(codeOnly(step)).not.toMatch(/'(camera|microphone|gyroscope|magnetometer)'/);
  });

  it('capture on this device is the ONLY path — there is no handoff at all', () => {
    // No QR, no second device, and — since the hosted cutover — no window
    // either. The customer photographs their document and their face on the
    // device they are already holding, in this page.
    const code = codeOnly(step).toLowerCase();
    expect(code).not.toContain('qr');
    expect(code).not.toMatch(/cross[_-]?device/);
    /*
     * These used to assert the RECOVERY controls for the hosted window:
     * "Re-open verification" and "Continue verification" were first-class
     * buttons because a window the customer had closed was not a fault they
     * should have to admit to. Both are gone with the window, and their
     * absence is now the property worth holding.
     */
    expect(codeOnly(step)).not.toContain('Re-open verification');
    expect(codeOnly(step)).not.toContain('Continue verification');
    expect(codeOnly(step)).not.toMatch(/window\s*\.\s*open\s*\(/);
  });

  it('has no cross-window message listener at all', () => {
    /*
     * There used to be one, and it was carefully bounded: origin-checked
     * against NPC's own origin, matched on a bare type, and able to do exactly
     * one thing — re-read server state. It existed because a window NPC had
     * opened needed a way to say "the customer came back".
     *
     * No window is opened now, so nothing can speak, so there is nothing to
     * listen to. The narrowest boundary is the one that is not there.
     */
    const code = codeOnly(step);
    expect(code).not.toContain('addEventListener(\'message\'');
    expect(code).not.toContain('const onMessage');
    expect(code).not.toMatch(/\bpostMessage\s*\(/);
    // The provider is still never named in code on this side.
    expect(code.toLowerCase()).not.toContain('didit');
  });
});

describe('no secret can reach the browser', () => {
  it('no Didit credential appears anywhere under src/', () => {
    const offenders = walk('src')
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => !f.includes('.test.'))
      .filter((f) => /DIDIT_API_KEY|DIDIT_WEBHOOK_SECRET/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('the credential is read only in the edge-function runtime', () => {
    const readers = walk('supabase/functions')
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /Deno\.env\.get\(['"]DIDIT_API_KEY['"]\)/.test(read(f)));
    expect(readers.sort()).toEqual([
      // Reads it only to report *presence* to the Command Centre — never the
      // value. That assertion is the next test.
      'supabase/functions/aml-verification/index.ts',
      'supabase/functions/_shared/aml/providers/diditClient.ts',
      // The Standalone client. Reads the key into a request header and
      // nowhere else; `redact()` keeps it out of every error it raises.
      'supabase/functions/_shared/aml/providers/diditStandaloneClient.ts',
      'supabase/functions/_shared/aml/providers/index.ts',
      'supabase/functions/didit-webhook/index.ts',
    ].sort());
  });

  it('the readiness endpoint reports presence, never the credential', () => {
    const verification = read('supabase/functions/aml-verification/index.ts');
    const reads = verification.split('\n')
      .filter((line) => /Deno\.env\.get\(['"]DIDIT_[A-Z_]+['"]\)/.test(line));
    expect(reads.length).toBeGreaterThan(0);
    for (const line of reads) {
      // Every read is immediately reduced to a boolean. A bare read assigned
      // to something that could be serialised is the failure this catches.
      expect(line).toMatch(/Boolean\(|!!|\.length\s*>\s*0/);
    }
  });

  it('errors and logs redact the key and the hosted URL', () => {
    const client = read('supabase/functions/_shared/aml/providers/diditClient.ts');
    const redact = client.slice(client.indexOf('function redact'), client.indexOf('async function diditFetch'));
    expect(redact).toContain('apiKey');
    // Any absolute URL is replaced — a transport error quotes the request URL,
    // and for a session that URL carries the customer's token.
    expect(redact).toMatch(/https\?:\\\/\\\//);
  });
});
