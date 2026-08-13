import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The hosted verification UI is gone, and must stay gone.
 *
 * ## The production defect these exist to make impossible
 *
 * On 2026-08-11 a customer's portal showed "Continue verification" and opened
 * `verify.didit.me/session/…` in a separate window. Four things were true at
 * once: the #2046 migrations were not applied, `didit_standalone` did not exist
 * as a provider row, `didit` was still `active = true`, and the two new Edge
 * Functions were not deployed. So the server resolved a hosted provider,
 * answered `provider_flow: 'hosted'`, and the portal did exactly what it was
 * written to do.
 *
 * Three of those were deployment state. The fourth — that the portal COULD obey
 * a `hosted` answer at all — is code, and it is what these tests remove the
 * possibility of. A component that is merely unreachable is one branch away
 * from being reachable.
 *
 * These are source assertions because the property is about which code exists.
 * "No state of the backend can open a window" cannot be proved by exercising
 * states; it is proved by there being nothing to exercise.
 */

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/**
 * Source with comments removed.
 *
 * Load-bearing here: these modules explain at length what they no longer do,
 * and prose describing a removed `window.open` is indistinguishable from a
 * live one to a substring match. Every "this must not appear" assertion runs
 * against code.
 */
const code = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

const STEP = read('src/components/portal/IdentityVerificationStep.tsx');
const PORTAL_API = read('src/lib/aml/amlPortalApi.ts');
const PORTAL_FN = read('supabase/functions/aml-client-portal/index.ts');
const CUTOVER = read('supabase/migrations/20260911000300_aml_retire_hosted_idv_capture.sql');

/**
 * Every client-side module a customer's identity journey can reach.
 *
 * The list is explicit rather than a glob so that adding a new portal identity
 * module is a decision somebody makes here, not something that quietly escapes
 * the guard.
 */
const CLIENT_IDV_MODULES = [
  'src/components/portal/IdentityVerificationStep.tsx',
  'src/lib/aml/amlPortalApi.ts',
  'src/lib/aml/identityDocuments.ts',
  'src/lib/aml/captureImage.ts',
];

/* ══════════════ THE CRITICAL REGRESSION GUARD ══════════════════════════ */

describe('the client portal cannot open a window for identity verification', () => {
  it('contains no executable window.open anywhere in the IDV path', () => {
    // THE test. If this fails, a customer can be sent to a vendor's page.
    for (const file of CLIENT_IDV_MODULES) {
      expect(code(read(file)), `${file} must not call window.open`)
        .not.toMatch(/window\s*\.\s*open\s*\(/);
      expect(code(read(file)), `${file} must not call open() bare`)
        .not.toMatch(/(^|[^.\w])open\s*\(\s*['"`]https?:/);
    }
  });

  it('cannot navigate or embed either', () => {
    const step = code(STEP);
    for (const forbidden of [
      /location\s*\.\s*(replace|assign|href)\s*[=(]/,
      /<iframe/i,
      /document\s*\.\s*write\s*\(/,
      /\bpostMessage\s*\(/,
    ]) {
      expect(step, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it('cannot ask the server for a hosted session', () => {
    // Removed from the client API entirely: a client that cannot form the
    // request is a stronger guarantee than a server that refuses it.
    for (const file of CLIENT_IDV_MODULES) {
      expect(code(read(file)), file).not.toContain('startHostedVerification');
      expect(code(read(file)), file).not.toContain('start_hosted_verification');
    }
  });

  it('carries no hosted-window machinery at all', () => {
    const step = code(STEP);
    for (const gone of [
      'SecureIdentityCheck', 'CHECK_WINDOW_TARGET', 'checkWindowFeatures',
      'paintPlaceholder', 'RETURN_NOTICE_TYPE', 'verification_url',
      'npc:identity-return',
    ]) {
      expect(step, gone).not.toContain(gone);
    }
  });

  it('never names the provider host, so no customer action can produce one', () => {
    // Against CODE, not prose: these modules document at length what they no
    // longer do, and one comment legitimately names `didit-webhook` as the
    // server-side path that survives. Comments do not ship — a production
    // build strips them — and the guard is about what executes and what the
    // customer can see.
    for (const file of CLIENT_IDV_MODULES) {
      const source = code(read(file));
      expect(source, file).not.toContain('verify.didit.me');
      expect(source, file).not.toContain('didit.me');
      expect(source.toLowerCase(), file).not.toContain('didit');
    }
  });

  it('shows no "Continue verification" wording — the button that opened it', () => {
    // Same reasoning: the only surviving mention is a comment recording which
    // label was removed and why.
    const step = code(STEP);
    expect(step).not.toContain('Continue verification');
    expect(step).not.toContain('Re-open verification');
    expect(step).not.toContain('Open verification');
  });
});

/* ══════════════ DEFENCE IN DEPTH: a stale backend says `hosted` ════════ */

describe('a backend that still says hosted is not obeyed', () => {
  it('treats hosted as unavailable rather than as an experience to render', () => {
    expect(STEP).toContain("const hostedRetired = (state.provider_flow ?? 'capture') === 'hosted'");
    expect(STEP).toContain("? 'temporarily_unavailable'");
    // …and the condition is reported for an operator rather than acted on.
    expect(STEP).toContain('reportRetiredHostedFlow(caseId)');
  });

  it('has exactly one branch left when the check screen renders', () => {
    // There is no ternary choosing between two experiences any more, because
    // there is only one experience.
    const at = STEP.indexOf('if (checking) {');
    expect(at).toBeGreaterThan(0);
    const block = code(STEP.slice(at, STEP.indexOf('\n  return (\n    <Card>', at)));
    expect(block).toContain('<SecureCaptureCheck');
    expect(block).not.toContain('<SecureIdentityCheck');
    expect(block).not.toContain("=== 'hosted'");
  });

  it('lands the customer somewhere real, not on an error', () => {
    // `temporarily_unavailable` renders the documentary route, which the step
    // already had: upload your identity document, adviser takes it from there.
    expect(STEP).toContain('Upload identity document');
    expect(STEP).toContain('nothing has been used up');
  });
});

/* ══════════════ THE SERVER SIDE ════════════════════════════════════════ */

describe('the server never answers hosted, and never mints a session', () => {
  it('always reports provider_flow: capture', () => {
    const status = PORTAL_FN.slice(PORTAL_FN.indexOf("case 'verification_status':"));
    const body = status.slice(0, status.indexOf("case 'start_hosted_verification':"));
    expect(body).toContain("provider_flow: 'capture'");
    expect(code(body)).not.toContain("=== 'hosted_session' ? 'hosted'");
  });

  it('answers a hosted-configured tenant with the manual route, not a session', () => {
    const fn = PORTAL_FN.slice(PORTAL_FN.indexOf('async function clientSafeIdvState'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(
      /if \(flow === 'hosted_session'\) \{[\s\S]{0,200}availability: 'manual_verification_required'/);
    // The hosted adapter is never constructed for a customer any more.
    expect(code(body)).not.toContain('getHostedIdvProvider(');
  });

  it('refuses start_hosted_verification unconditionally, before any other check', () => {
    const at = PORTAL_FN.indexOf("case 'start_hosted_verification': {");
    expect(at).toBeGreaterThan(0);
    const block = PORTAL_FN.slice(at, PORTAL_FN.indexOf("case '__retired_start_hosted_verification'"));
    expect(block).toContain("code: 'hosted_flow_retired'");
    const executable = code(block);
    // The refusal is the FIRST statement: no case lookup, no consent load, no
    // provider resolution, and above all no session creation can precede it.
    expect(executable).not.toContain('resolveCase(');
    expect(executable).not.toContain('createSession');
    expect(executable).not.toContain('getHostedIdvProvider');
    expect(executable.indexOf('return jsonResponse(')).toBeGreaterThan(-1);
  });

  it('reports no verification as in-progress on the strength of a hosted row', () => {
    // `activeHostedCheck` is what produced "Continue verification".
    const status = PORTAL_FN.slice(PORTAL_FN.indexOf("case 'verification_status':"));
    const body = code(status.slice(0, status.indexOf("case 'start_hosted_verification':")));
    expect(body).not.toContain('activeHostedCheck(');
  });
});

/* ══════════════ LEGACY EVIDENCE IS PRESERVED ═══════════════════════════ */

describe('hosted RESULTS are not touched', () => {
  it('leaves the webhook and its decision path in place', () => {
    // A late signed outcome for a session that already ran must still settle.
    const webhook = read('supabase/functions/didit-webhook/index.ts');
    expect(webhook).toContain('verifyDiditWebhook');
    expect(webhook.length).toBeGreaterThan(1000);
    expect(read('supabase/functions/_shared/aml/diditOutcome.ts'))
      .toContain('applyDiditDecision');
  });

  it('retires only unconsumed, unsettled hosted attempts', () => {
    // Every clause below is a thing the cutover must NOT touch.
    expect(CUTOVER).toContain('AND attempt_consumed = false');
    expect(CUTOVER).toContain("AND status = 'pending'");
    expect(CUTOVER).toContain("AND processing_status IN ('submitted', 'queued', 'processing', 'retry_scheduled')");
    expect(CUTOVER).toContain('AND superseded_at IS NULL');
  });

  it('never writes an identity outcome, an attempt or a deletion', () => {
    const statements = CUTOVER.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    // No DELETE anywhere: historical Didit evidence is compliance evidence.
    expect(statements).not.toMatch(/\bDELETE\b/i);
    // `status` and `attempt_consumed` are read in the WHERE clause and never
    // assigned — retiring a session is housekeeping, not a finding.
    const setClause = statements.slice(
      statements.indexOf('SET processing_status'), statements.indexOf('WHERE check_type'));
    expect(setClause).not.toMatch(/\bstatus\s*=/);
    expect(setClause).not.toContain('attempt_consumed');
  });

  it('uses the existing supersession vocabulary rather than a new one', () => {
    expect(CUTOVER).toContain("processing_status  = 'cancelled'");
    expect(CUTOVER).toContain('superseded_at      = now()');
    expect(CUTOVER).toContain('superseded_reason  =');
    // No second verification domain.
    expect(CUTOVER).not.toMatch(/CREATE TABLE/i);
  });

  it('is idempotent and reversible', () => {
    // `superseded_at IS NULL` makes a second apply a no-op.
    expect(CUTOVER).toContain('ROLLBACK:');
    expect(CUTOVER).toContain('superseded_reason = ');
  });
});

/* ══════════════ EXACTLY ONE ACTIVE IDV PROVIDER ════════════════════════ */

describe('the provider switch', () => {
  it('deactivates hosted and activates standalone, in that order', () => {
    const deactivate = CUTOVER.indexOf("SET active = false, updated_at = now()");
    const activate = CUTOVER.indexOf("SET active = true, updated_at = now()");
    expect(deactivate).toBeGreaterThan(0);
    expect(activate).toBeGreaterThan(deactivate);
  });

  it('fails the deploy if hosted is somehow still active afterwards', () => {
    expect(CUTOVER).toContain('is still active, so the portal would still resolve a hosted session');
    expect(CUTOVER).toContain('IDV providers are active for tenant default');
  });

  it('fails the deploy if any unconsumed hosted attempt survives', () => {
    expect(CUTOVER).toContain('unconsumed hosted attempts are still in flight');
  });

  it('warns rather than fails when standalone is not activatable', () => {
    // Zero active providers is SAFE — the portal renders the documentary route
    // — so it must not block a deploy whose whole purpose is removing the
    // popup. It must still be loud in the deploy log.
    expect(CUTOVER).toContain('RAISE WARNING');
    expect(CUTOVER).toContain('customers will be offered the documentary route');
  });
});

/* ══════════════ MISSING CONFIG STILL MEANS NO POPUP ════════════════════ */

describe('a misconfigured Standalone provider never falls back to hosted', () => {
  it('has no fallback path from standalone to hosted anywhere', () => {
    const fn = code(PORTAL_FN.slice(
      PORTAL_FN.indexOf('async function clientSafeIdvState'),
      PORTAL_FN.indexOf('async function clientSafeIdvAvailability')));
    // The standalone branch returns or throws; the catch maps to availability
    // words. There is no assignment of the hosted flow after a standalone
    // failure, which is the shape a fallback would have.
    expect(fn).not.toMatch(/flow\s*=\s*['"]hosted_session['"]/);
    expect(fn).toContain("availability: 'temporarily_unavailable'");
    expect(fn).toContain("? 'temporarily_unavailable'");
  });

  it('collects no biometric when the provider cannot judge it', () => {
    // prepare_verification_attempt gates every upload grant on availability.
    const prepare = PORTAL_FN.slice(
      PORTAL_FN.indexOf("case 'prepare_verification_attempt':"),
      PORTAL_FN.indexOf("case 'submit_verification_attempt':"));
    expect(prepare.indexOf("availability !== 'available'"))
      .toBeLessThan(prepare.indexOf('createSignedUploadUrl'));
  });
});
