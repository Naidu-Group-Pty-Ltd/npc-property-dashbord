import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { verifyLegalAuditChain } from '../../supabase/functions/_shared/legalAudit';

const source = readFileSync('supabase/functions/solicitor-portal-compliance/index.ts', 'utf8');
const audit = readFileSync('supabase/functions/_shared/legalAudit.ts', 'utf8');

describe('solicitor-portal-compliance authorization', () => {
  it('resolves a solicitor session before any operation', () => {
    expect(source).toContain('resolveSolicitorSession(supabase, req.headers, body)');
    expect(source).toContain("json({ error: session.error || 'Unauthorised' }, session.status || 401)");
  });

  it('scopes every matter to an exact non-null firm and explicit matter grant', () => {
    expect(source).toContain("!matter.firm_id || matter.firm_id !== me.firm_id");
    expect(source).toContain('resolveSolicitorMatterAccess(supabase, me.id, me.firm_id, matter.id)');
    expect(source).toContain('resolveMatterPermissions(supabase, access)');
    expect(source).not.toContain('assignedClientIds.includes(matter.client_id)');
  });

  it('gates the audit trail and export behind the audit permission key', () => {
    expect(source.match(/can\(loaded\.perms, 'audit', 'view'\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('gates conflict, closure and retention mutations behind matters edit', () => {
    expect(source.match(/can\(loaded\.perms, 'matters', 'edit'\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('limits conflict searches to assigned clients', () => {
    expect(source).toContain(".in('client_id', assignedClientIds)");
  });

  it('sanitizes conflict terms before enforcing the minimum length', () => {
    expect(source).toContain("String(v).replace(/[%_(),]/g, '').trim()");
    expect(source).toContain('body.terms.map(conflictTerm).filter((t: string) => t.length >= 3)');
    expect(source).not.toContain("t.replace(/[%,()]/g, '')");
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

  it('rejects a row hash mismatch when the event has metadata', async () => {
    const rows = [{
      id: 'event-1',
      legal_matter_id: 'matter-1',
      actor_type: 'solicitor_user',
      actor_solicitor_user_id: 'user-1',
      category: 'document',
      action: 'DELETE_DOCUMENT',
      target_type: 'document',
      target_id: 'document-1',
      metadata: { source: 'portal' },
      prev_hash: null,
      row_hash: 'stored-hash-for-different-content',
      created_at: '2026-07-30T12:00:00.000Z',
    }];
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    const supabase = { from: () => query };

    const result = await verifyLegalAuditChain(supabase, 'matter-1');

    expect(result).toMatchObject({
      verified: false,
      broken_at: 'event-1',
      broken_reason: 'row_hash does not match the recorded content',
    });
  });
});
