import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Contract for the cookie-authenticated data gateway that replaces the
 * unusable HS256 browser token.
 *
 * These assert the properties that make the gateway safe to exist at all. The
 * gateway holds service-role credentials, so the difference between "a narrow
 * authority-checked door" and "a service-role proxy that deletes RLS as a
 * control" is exactly the code these tests pin.
 */

const gateway = readFileSync('supabase/functions/authenticated-data/index.ts', 'utf8');
const jwtHelper = readFileSync('supabase/functions/_shared/jwt.ts', 'utf8');

/**
 * Several assertions below are "this string must NOT appear". The gateway's
 * header comment discusses `JWT_SECRET` and anon fallback precisely because it
 * is documenting the defect it removes, so those checks run against the code
 * with comments stripped — otherwise the documentation would fail the test it
 * exists to explain.
 */
const code = gateway
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('ES256 remediation — the HS256 token is the defect', () => {
  it('the helper the browser depended on really does sign HS256', () => {
    // The root cause, pinned so nobody "fixes" this by changing the projects.
    expect(jwtHelper).toContain('alg: "HS256"');
  });

  it('the gateway does not mint, import or depend on any project token', () => {
    expect(code).not.toContain('generateSupabaseJWT');
    expect(code).not.toContain('JWT_SECRET');
    expect(code).not.toContain('SUPABASE_JWT_SECRET');
    expect(code).not.toMatch(/HS256|ES256/);
  });

  it('requires no private signing key', () => {
    expect(code).not.toMatch(/privateKey|importKey|sign\(/);
  });
});

describe('identity is resolved server-side only', () => {
  it('takes identity from the session, never from the request body', () => {
    expect(gateway).toContain('const auth = await verifyAuth(admin, req.headers, {})');
    // The empty object is the point: no body-supplied session material.
    expect(code).not.toMatch(/body\.(user_id|userId|role|tenant_id|tenantId)/);
  });

  it('refuses an unauthenticated caller and refuses service_role impersonation', () => {
    expect(gateway).toContain("auth.userId === 'service_role'");
    expect(gateway).toContain("code: 'auth_required'");
  });

  it('fails visibly rather than degrading to anon', () => {
    // The whole defect being remediated was a silent anon fallback.
    // No anon key, and no client constructed without the service-role credential.
    expect(code).not.toMatch(/ANON_KEY/);
    expect(gateway).toMatch(/return json\(\{ error: auth\.error \|\| 'Authentication required'/);
  });
});

describe('authority', () => {
  it('enforces CSRF on cookie-authenticated requests', () => {
    expect(gateway).toContain('enforceCsrf(req)');
    expect(gateway).toContain('csrfDenied(cors, csrf)');
  });

  it('uses exact-origin CORS from the shared helper', () => {
    expect(gateway).toContain('createCorsHeaders(origin)');
  });

  it('reuses the repository module-permission primitive rather than reimplementing it', () => {
    expect(gateway).toContain('requireModulePermission');
    expect(gateway).toContain("code: 'module_permission_required'");
  });

  it('checks staff roles against user_roles for the role-gated tables', () => {
    expect(gateway).toContain("from('user_roles')");
    expect(gateway).toContain("code: 'role_required'");
  });
});

describe('the allow-list is the security boundary', () => {
  it('refuses any table not explicitly listed', () => {
    expect(gateway).toContain('const rule = TABLES[table]');
    expect(gateway).toContain("error: 'Resource not available through this gateway'");
  });

  it('lists exactly the tables whose policies were modelled', () => {
    for (const t of [
      'charts', 'depreciation_comps', 'generated_reports', 'global_report_settings',
      'whitelabel_settings', 'chart_configurations', 'template_components',
      'template_comments', 'workflows', 'workflow_runs', 'workflow_run_steps',
      'workflow_trigger_events',
    ]) {
      expect(gateway).toContain(`${t}:`);
    }
  });

  it('does NOT expose the two tables whose rules were not modelled', () => {
    // email_copilot_emails has a four-branch ownership predicate; approximating
    // an access rule is a security defect, so it is not routed here.
    // agency_agreements has RLS on with zero policies — deny-all — so routing it
    // would grant access no policy ever authorised.
    expect(gateway).not.toMatch(/^\s*email_copilot_emails:/m);
    expect(gateway).not.toMatch(/^\s*agency_agreements:/m);
  });
});

describe('ownership cannot be widened by the caller', () => {
  it('appends the mandatory owner filter after the caller of its own filters', () => {
    expect(gateway).toContain("target.searchParams.append(rule.ownerColumn, `eq.${userId}`)");
  });

  it('stamps the owning column on writes from the resolved user', () => {
    expect(gateway).toContain('[rule.ownerColumn!]: userId');
  });

  it('forwards to PostgREST rather than hand-rolling SQL', () => {
    expect(gateway).toContain('/rest/v1/');
    expect(gateway).not.toMatch(/\bselect\s+\*\s+from\b/i);
  });
});
