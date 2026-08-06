/**
 * Cookie-authenticated data gateway (ES256 remediation).
 *
 * ## Why this exists
 *
 * `_shared/jwt.ts` mints HS256 tokens signed with `JWT_SECRET`. Both Supabase
 * projects moved to ES256 signing keys (JWKS publishes ES256; the HS256 key is
 * `previously_used`), so those tokens are rejected. The browser therefore holds
 * no usable RLS token, `clientForToken(null)` sends no Authorization header at
 * all, and every direct PostgREST query from the 16 affected modules runs as
 * `anon` against tables whose RLS is enabled — silently returning empty instead
 * of failing.
 *
 * The fix is not to re-sign tokens. It is to stop the browser needing one: the
 * browser keeps its existing secure custom-session cookie, and protected reads
 * and writes come through here, where the session is verified and authority is
 * resolved server-side.
 *
 * ## What this is NOT
 *
 * It is not a generic service-role proxy. A generic proxy would hand every
 * caller full service-role authority and delete RLS as a control. Instead each
 * table is listed explicitly below with the authority rule that its RLS policy
 * already expresses, and anything not listed is refused. Adding a table here is
 * a deliberate, reviewable act.
 *
 * ## The rules, taken from the live policies
 *
 *   - module permission  -> `requireModulePermission`, the same primitive every
 *     other Edge Function uses. Mirrors `current_user_can_view/edit/delete(...)`.
 *   - owner scoped       -> a mandatory server-side filter on the owning column,
 *     appended to whatever the caller sent. PostgREST ANDs repeated filters, so
 *     a caller cannot widen it.
 *   - staff role         -> membership of `user_roles` in the named roles.
 *
 * ## Deliberately excluded
 *
 *   - `email_copilot_emails`: its SELECT policy is a four-branch predicate over
 *     `clients.created_by`, `created_by`, `owner_user_id`, `mailbox_source` and
 *     null-ness. Reproducing that as filters would be an approximation, and an
 *     approximation of an access rule is a security defect. It stays on its
 *     existing path until it is modelled properly.
 *   - `agency_agreements`: RLS is enabled with ZERO policies, so it is deny-all
 *     except service-role. Routing it through here would silently grant access
 *     that no policy ever authorised. It needs an intended rule first.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';

type Action = 'can_view' | 'can_edit' | 'can_delete';

interface TableRule {
  /** Module permission required, mirroring current_user_can_*(). */
  module?: string;
  /** Column that must equal the resolved user id. Applied as a mandatory filter. */
  ownerColumn?: string;
  /** Reads allowed to any verified session (policy is `true`). */
  openRead?: boolean;
  /** Staff roles permitted, checked against user_roles. */
  roles?: string[];
}

/** Every table reachable through this gateway. Absent table => refused. */
const TABLES: Record<string, TableRule> = {
  charts:                  { module: 'charts' },
  depreciation_comps:      { module: 'depreciation_comps' },
  generated_reports:       { module: 'generated_reports' },
  global_report_settings:  { module: 'settings', openRead: true },
  whitelabel_settings:     { module: 'white_label', openRead: true },
  chart_configurations:    { openRead: true, module: 'charts' },
  template_components:     { module: 'templates', ownerColumn: 'created_by', openRead: true },
  template_comments:       { ownerColumn: 'author_id', openRead: true },
  workflows:               { roles: ['superadmin', 'admin'] },
  workflow_runs:           { roles: ['superadmin', 'admin'] },
  workflow_run_steps:      { roles: ['superadmin', 'admin'] },
  workflow_trigger_events: { roles: ['superadmin', 'admin'] },
};

const READ_METHODS = new Set(['GET', 'HEAD']);

function actionFor(method: string): Action {
  if (READ_METHODS.has(method)) return 'can_view';
  if (method === 'DELETE') return 'can_delete';
  return 'can_edit';
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const cors = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  // Cookie-authenticated mutations must carry an allow-listed Origin.
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Identity comes only from the session cookie. Nothing in the body or query
  // string is trusted to name a user, a role or a tenant.
  const auth = await verifyAuth(admin, req.headers, {});
  if (auth.error || !auth.userId || auth.userId === 'service_role') {
    return json({ error: auth.error || 'Authentication required', code: 'auth_required' }, 401);
  }
  const userId = auth.userId;

  const url = new URL(req.url);
  const table = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const rule = TABLES[table];
  if (!rule) return json({ error: 'Resource not available through this gateway', table }, 404);

  const action = actionFor(req.method);
  const isRead = READ_METHODS.has(req.method);

  if (rule.roles) {
    const { data: roleRows } = await admin
      .from('user_roles').select('role').eq('user_id', userId);
    const held = new Set((roleRows ?? []).map((r: { role: string }) => r.role));
    if (!rule.roles.some((r) => held.has(r))) {
      return json({ error: 'Forbidden', code: 'role_required' }, 403);
    }
  }

  // `openRead` mirrors a policy of `true` for SELECT; writes still need the module.
  if (rule.module && !(isRead && rule.openRead)) {
    const permitted = await requireModulePermission(
      admin, { userId, authMethod: auth.authMethod ?? 'session' }, rule.module, action,
    );
    if (!permitted.ok) return json({ error: 'Forbidden', code: 'module_permission_required' }, 403);
  }

  // Rebuild the PostgREST request. The caller's filters are preserved, then the
  // mandatory ownership filter is APPENDED — PostgREST ANDs repeated params, so
  // a caller cannot widen its own scope by sending a competing filter.
  const target = new URL(`${Deno.env.get('SUPABASE_URL')}/rest/v1/${table}`);
  url.searchParams.forEach((v, k) => target.searchParams.append(k, v));
  if (rule.ownerColumn && !isRead) target.searchParams.append(rule.ownerColumn, `eq.${userId}`);

  const forwardHeaders: Record<string, string> = {
    apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
    'Content-Type': req.headers.get('content-type') ?? 'application/json',
  };
  for (const h of ['prefer', 'range', 'range-unit', 'accept', 'accept-profile', 'content-profile']) {
    const v = req.headers.get(h);
    if (v) forwardHeaders[h] = v;
  }

  // A write that sets the owning column must set it to the caller, never to a
  // value the browser chose.
  let body: string | undefined;
  if (!isRead && req.body) {
    const raw = await req.text();
    if (raw && rule.ownerColumn) {
      try {
        const parsed = JSON.parse(raw);
        const stamp = (row: Record<string, unknown>) => ({ ...row, [rule.ownerColumn!]: userId });
        body = JSON.stringify(Array.isArray(parsed) ? parsed.map(stamp) : stamp(parsed));
      } catch { body = raw; }
    } else {
      body = raw;
    }
  }

  const upstream = await fetch(target.toString(), { method: req.method, headers: forwardHeaders, body });
  const text = await upstream.text();
  const out = new Headers(cors);
  for (const h of ['content-type', 'content-range', 'content-location', 'prefer-applied']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(text, { status: upstream.status, headers: out });
});
