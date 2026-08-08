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
    // Only the provider registry legitimately references the new adapter.
    expect(offenders).toEqual(['supabase/functions/_shared/aml/providers/index.ts']);
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
    // The step branches on the two-word flow token, not a provider name.
    expect(step).toContain("provider_flow ?? 'capture') === 'hosted'");
    expect(step.toLowerCase()).not.toContain('didit');
  });

  it('the frontend cannot mark anybody verified', () => {
    // No message listener, no return-URL status, no local status assertion.
    expect(step).not.toContain('postMessage');
    expect(step).not.toContain('addEventListener(\'message\'');
    expect(step).not.toMatch(/status:\s*['"]verified['"]/);
    // Completion only ever triggers a server re-read.
    expect(step).toContain('await load()');
  });

  it('delegates the camera to the embed and offers a new-tab fallback', () => {
    const from = step.indexOf('<iframe');
    const iframe = step.slice(from, step.indexOf('/>', from));
    expect(from).toBeGreaterThan(-1);
    // Without delegating `camera` the provider's capture step fails with a
    // permission error the customer cannot act on.
    expect(iframe).toContain('allow="camera');
    expect(iframe).toContain('sandbox=');
    // Embedded camera permission is genuinely unreliable, so the new-tab route
    // is offered up front rather than behind an undetectable failure.
    expect(step).toContain('target="_blank"');
    expect(step).toContain('rel="noopener noreferrer"');
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
      'supabase/functions/_shared/aml/providers/diditClient.ts',
      'supabase/functions/_shared/aml/providers/index.ts',
      'supabase/functions/didit-webhook/index.ts',
    ]);
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
