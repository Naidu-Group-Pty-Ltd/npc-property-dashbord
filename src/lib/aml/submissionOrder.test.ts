import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The production failure, as a contract.
 *
 * Nine identity documents were written to the private `aml-documents` bucket
 * and abandoned there. No selfie ever reached `aml-biometrics`, no
 * `aml.verification_checks` row was ever created, and no outbox event was ever
 * emitted — because the submission uploaded the document first and only then
 * asked for the selfie upload grant, which is the request that checks provider
 * readiness and remaining attempts. With no live provider that grant answers
 * 409 `manual_verification_required`, so every attempt cost the customer an
 * upload of their identity document and gave them an error that reads like a
 * dead end.
 *
 * Both grants must therefore be obtained before either byte is written.
 */

const step = readFileSync('src/components/portal/IdentityVerificationStep.tsx', 'utf8');
const submitBlock = step.slice(
  step.indexOf('const submit = async'),
  step.indexOf('return (', step.indexOf('const submit = async')));

const codeOnly = submitBlock.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('electronic KYC submission order', () => {
  it('asks for both upload grants before any PUT', () => {
    const selfieGrant = codeOnly.indexOf("requestVerificationUpload(caseId, 'selfie')");
    const documentGrant = codeOnly.indexOf("requestVerificationUpload(caseId, 'document')");
    const firstPut = codeOnly.search(/\bput\(/);

    expect(selfieGrant, 'the selfie grant must be requested').toBeGreaterThan(-1);
    expect(documentGrant, 'the document grant must be requested').toBeGreaterThan(-1);
    expect(firstPut, 'an upload must happen').toBeGreaterThan(-1);

    expect(selfieGrant, 'no byte may be written before the gated grant').toBeLessThan(firstPut);
    expect(documentGrant, 'no byte may be written before both grants').toBeLessThan(firstPut);
  });

  it('requests the gated selfie grant before the document grant', () => {
    // The selfie request is the provider-readiness and attempt gate. Asking
    // for it first means a refusal costs nothing at all.
    const selfieGrant = codeOnly.indexOf("requestVerificationUpload(caseId, 'selfie')");
    const documentGrant = codeOnly.indexOf("requestVerificationUpload(caseId, 'document')");
    expect(selfieGrant).toBeLessThan(documentGrant);
  });

  it('never pairs a grant with its own upload in a single helper', () => {
    // The defect was structural: one `upload()` helper did grant-then-PUT, so
    // the document was necessarily in Storage before the selfie gate ran. The
    // uploading helper must take an already-granted URL and nothing else.
    const helper = codeOnly.slice(
      codeOnly.indexOf('const put = async'),
      codeOnly.indexOf('const docPath'));
    expect(helper, 'the upload helper must exist').toContain("method: 'PUT'");
    expect(helper, 'it must not fetch its own grant')
      .not.toContain('requestVerificationUpload');
  });

  it('hands a readiness refusal back to the step instead of retrying', () => {
    expect(codeOnly).toContain('UNAVAILABLE_CODES');
    expect(codeOnly).toContain('onUnavailable');
  });
});

describe('availability gate before the camera opens', () => {
  it('re-reads status on Start rather than trusting the mount-time value', () => {
    const start = step.slice(step.indexOf('const startCapture'), step.indexOf('if (loadError)'));
    expect(start).toContain('verificationStatus(caseId)');
    expect(start).toContain("!== 'available'");
    expect(start, 'the party must still have an attempt').toContain('can_attempt');
    // The dialog only opens after both checks pass.
    expect(start.indexOf('verificationStatus(caseId)'))
      .toBeLessThan(start.indexOf('setActiveParty(party)'));
  });

  it('opens the dialog only through the gate', () => {
    // A bare onClick={() => setActiveParty(party)} would bypass the re-check.
    expect(step).not.toMatch(/onClick=\{\(\)\s*=>\s*setActiveParty\(party\)\}/);
  });
});

describe('server refusal codes reach the client', () => {
  it('carries `code` off the error response', () => {
    // Without this the portal could only match on prose, so a readiness
    // refusal looked identical to a failed capture.
    const api = readFileSync('src/lib/aml/amlPortalApi.ts', 'utf8');
    expect(api).toContain('err.code =');
    expect(api).toContain('json.code');
  });
});
