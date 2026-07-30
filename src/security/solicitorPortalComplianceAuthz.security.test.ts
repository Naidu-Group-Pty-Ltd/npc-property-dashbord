import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/solicitor-portal-compliance/index.ts', 'utf8');
const audit = readFileSync('supabase/functions/_shared/legalAudit.ts', 'utf8');

describe('solicitor-portal-compliance authorization', () => {
  it('resolves a solicitor session before any operation', () => {
    expect(source).toContain('resolveSolicitorSession(supabase, req.headers, body)');
    expect(source).toContain("json({ error: session.error || 'Unauthorised' }, session.status || 401)");
  });

  it('scopes every matter to the caller firm AND an assigned client', () => {
    expect(source).toContain("matter.firm_id !== me.firm_id");
    expect(source).toContain('assignedClientIds.includes(matter.client_id)');
    expect(source).toContain('resolveClientPermissions(supabase, me.id, matter.client_id)');
  });

  it('gates the audit trail and export behind the audit permission key', () => {
    expect(source.match(/can\(loaded\.perms, 'audit', 'view'\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('gates conflict, closure and retention mutations behind matters edit', () => {
    expect(source.match(/can\(loaded\.perms, 'matters', 'edit'\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('limits conflict candidates to clients assigned to the caller', () => {
    expect(source).toContain(".in('client_id', assignedClientIds)");
  });

  it('never selects restricted financial or AML data into the compliance pack', () => {
    expect(source).not.toMatch(/borrowing_capacity|purchase_file_decisions|aml_/);
  });
});

describe('legal audit chain integrity', () => {
  it('is append-only and hash chained', () => {
    expect(audit).toContain('legal_matter_audit_events');
    expect(audit).toContain('verifyLegalAuditChain');
    expect(audit).toContain('prev_hash does not match the preceding entry');
  });

  it('never throws out of the recorder', () => {
    expect(audit).toContain("console.error('[legal-audit] insert failed:'");
    expect(audit).toContain("console.error('[legal-audit] insert threw:'");
  });
});
