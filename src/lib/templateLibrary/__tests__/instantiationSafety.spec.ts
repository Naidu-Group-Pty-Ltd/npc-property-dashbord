/**
 * The instantiation payload is the one place the Template Library writes to
 * `report_templates`, so it is the one place it could damage the existing
 * reporting engine. These tests read the edge function's source and assert the
 * payload it constructs can never produce a row that:
 *
 *   - is resolvable by `resolve_report_template()` (needs `is_active = true`),
 *   - is the default template for a report type,
 *   - violates the `created_by → auth.users` foreign key,
 *   - or leaves `config` null, which the column forbids.
 *
 * Source-level assertions rather than behavioural ones, because the function is
 * Deno code with `https://` imports that Vitest cannot load. That is a real
 * limitation — it catches a changed literal, not a changed control flow — so
 * these run alongside, not instead of, the manual verification checklist in
 * `docs/template-library/04-implementation.md`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FN = resolve(
  __dirname, '../../../..', 'supabase/functions/manage-template-library/index.ts',
);
const source = readFileSync(FN, 'utf8');

/** The object literal passed to the report_templates insert. */
function instantiationPayload(): string {
  const start = source.indexOf('const insertPayload = {');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n      };', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('working-copy insert payload', () => {
  const payload = instantiationPayload();

  it('never creates an active template', () => {
    expect(payload).toContain('is_active: false');
    expect(payload).not.toMatch(/is_active:\s*true/);
  });

  it('never creates a default template', () => {
    expect(payload).toContain('is_default: false');
    expect(payload).not.toMatch(/is_default:\s*true/);
  });

  it('starts in draft and unapproved, so the activation gate still applies', () => {
    expect(payload).toContain("approval_status: 'draft'");
    expect(payload).toContain('is_draft: true');
  });

  it('starts unlocked at version 1', () => {
    expect(payload).toContain('version: 1');
    expect(payload).toContain('locked_for_review: false');
  });

  it('leaves created_by null — the column is an FK to auth.users', () => {
    expect(payload).toContain('created_by: null');
  });

  it('always supplies config, which is NOT NULL on the column', () => {
    expect(payload).toMatch(/config:\s*entry\.config\s*\?\?\s*\{\}/);
  });

  it('scopes the copy to the caller so it is not visible deployment-wide', () => {
    expect(payload).toContain("scope: 'user'");
    expect(payload).toContain('owner_user_id: userId');
  });

  it('does not set parent_template_id — that FK points at report_templates', () => {
    expect(payload).toContain('parent_template_id: null');
  });

  it('takes ownership from the verified session, never from the request body', () => {
    // `userId` comes from verifyAuth; `body.*` is caller-controlled.
    expect(payload).not.toMatch(/owner_user_id:\s*body\./);
    expect(payload).not.toMatch(/scope:\s*body\./);
  });
});

describe('authorisation gates', () => {
  it('requires templates:can_edit to create a working copy', () => {
    expect(source).toContain("EDIT_OPERATIONS = new Set<Operation>(['instantiate'])");
    expect(source).toMatch(/requireModulePermission\(supabase, actor, 'templates', 'can_edit'\)/);
  });

  it('requires templates:can_view to browse', () => {
    expect(source).toMatch(/READ_OPERATIONS = new Set<Operation>\(\['list', 'get'\]\)/);
    expect(source).toMatch(/requireModulePermission\(supabase, actor, 'templates', 'can_view'\)/);
  });

  it('falls through to superadmin for every other operation', () => {
    // The else branch is the default, so a new operation is superadmin-only
    // until it is deliberately added to a lower-privilege set.
    expect(source).toMatch(/} else \{\s*\/\/[^\n]*\n\s*authz = await requireSuperadmin\(supabase, actor\);/);
  });

  it('only ever copies a published entry', () => {
    expect(source).toMatch(/\.eq\('status', 'published'\)/);
  });

  it('enforces CSRF and authentication before anything else', () => {
    const csrf = source.indexOf('enforceCsrf(req)');
    const auth = source.indexOf('await verifyAuth(');
    const firstDbWrite = source.indexOf(".from('report_templates')");
    expect(csrf).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(csrf);
    expect(firstDbWrite).toBeGreaterThan(auth);
  });
});

describe('list projection', () => {
  it('never selects the heavy schema payload', () => {
    const start = source.indexOf('const LIST_SELECT = [');
    const end = source.indexOf('].join(', start);
    const select = source.slice(start, end);
    expect(select).not.toMatch(/'schema'/);
    expect(select).toContain("'preview_schema'");
  });
});
