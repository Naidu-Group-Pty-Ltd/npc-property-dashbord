import { extractSolicitorSessionToken } from './solicitorSessionToken.ts';

/**
 * Shared Solicitor Portal session resolution + permission merging.
 *
 * Every `solicitor-portal-*` edge function funnels through `resolveSolicitorSession`
 * so there is exactly ONE place that decides whether a caller is a valid,
 * non-revoked solicitor and what they are allowed to touch. Later phases
 * (matters, dates, documents) must not re-implement this.
 */

export interface SolicitorSessionUser {
  id: string;
  firm_id: string;
  email: string;
  name: string;
  phone: string | null;
  position: string | null;
  portal_role: string;
  must_change_password: boolean;
  has_accepted_terms: boolean;
  has_completed_onboarding: boolean;
  last_seen_at: string | null;
  firm: {
    id: string;
    name: string;
    trading_name: string | null;
    practising_states: string[];
    is_active: boolean;
  } | null;
}

export interface SolicitorSessionResult {
  ok: boolean;
  status: number;
  error?: string;
  user?: SolicitorSessionUser;
  token?: string;
}

/** Permission matrix shape: { key: { view, edit, delete } } */
export type PermissionMatrix = Record<string, { view?: boolean; edit?: boolean; delete?: boolean }>;

/**
 * Keys that are ALWAYS denied to solicitors, regardless of any stored matrix.
 * Tri-portal separation: legal practitioners never see the client's financial
 * position or any restricted AML/SMR record.
 */
export const SOLICITOR_FORBIDDEN_KEYS = new Set<string>([
  'income',
  'expenses',
  'assets',
  'liabilities',
  'employment',
  'borrowing_capacity',
  'commissions',
  'smr',
  'aml_restricted',
]);

export const SOLICITOR_PERMISSION_KEYS = [
  'matters',
  'critical_dates',
  'documents',
  'searches',
  'disbursements',
  'parties',
  'contract',
  'messages',
  'client_tasks',
  'settlement',
  'finance_status',
  'audit',
] as const;

/**
 * Permission keys that default to ALLOW when no matrix row exists yet. Matches
 * the Finance Portal's "null = legacy behaviour" convention so newly shipped
 * capabilities are not silently locked out for existing assignments.
 */
const DEFAULT_ALLOW_KEYS = new Set<string>(SOLICITOR_PERMISSION_KEYS);

export async function resolveSolicitorSession(
  supabase: any,
  headers: Headers,
  body?: Record<string, unknown>,
): Promise<SolicitorSessionResult> {
  const token = extractSolicitorSessionToken(headers, body);
  if (!token) {
    return { ok: false, status: 401, error: 'Session token is required' };
  }

  const { data: user, error } = await supabase
    .from('solicitor_portal_users')
    .select(`
      id, firm_id, email, name, phone, position, portal_role,
      is_active, revoked_at, session_expires_at, must_change_password,
      has_accepted_terms, has_completed_onboarding, last_seen_at,
      solicitor_firms:firm_id (id, name, trading_name, practising_states, is_active)
    `)
    .eq('session_token', token)
    .maybeSingle();

  if (error || !user) {
    return { ok: false, status: 401, error: 'Invalid or expired session' };
  }
  if (!user.is_active || user.revoked_at) {
    return { ok: false, status: 403, error: 'Your access has been revoked. Please contact your administrator.' };
  }
  if (!user.session_expires_at || new Date(user.session_expires_at) < new Date()) {
    return { ok: false, status: 401, error: 'Session expired' };
  }

  const firm = (user as any).solicitor_firms || null;
  if (!firm || !firm.is_active) {
    return { ok: false, status: 403, error: 'The linked legal practice is no longer active.' };
  }

  return {
    ok: true,
    status: 200,
    token,
    user: {
      id: user.id,
      firm_id: user.firm_id,
      email: user.email,
      name: user.name,
      phone: user.phone ?? null,
      position: user.position ?? null,
      portal_role: user.portal_role,
      must_change_password: !!user.must_change_password,
      has_accepted_terms: !!user.has_accepted_terms,
      has_completed_onboarding: !!user.has_completed_onboarding,
      last_seen_at: user.last_seen_at ?? null,
      firm: {
        id: firm.id,
        name: firm.name,
        trading_name: firm.trading_name ?? null,
        practising_states: firm.practising_states ?? [],
        is_active: !!firm.is_active,
      },
    },
  };
}

/**
 * OR-merge the solicitor's global baseline with their per-client override.
 * `null` on either side means "not configured" and falls back to the
 * default-allow behaviour for known keys.
 */
export function mergePermissions(
  baseline: PermissionMatrix | null | undefined,
  perClient: PermissionMatrix | null | undefined,
): PermissionMatrix {
  const out: PermissionMatrix = {};
  for (const key of SOLICITOR_PERMISSION_KEYS) {
    const b = baseline?.[key];
    const c = perClient?.[key];
    if (!b && !c) {
      const allow = DEFAULT_ALLOW_KEYS.has(key);
      out[key] = { view: allow, edit: allow && key !== 'finance_status' && key !== 'audit', delete: false };
      continue;
    }
    out[key] = {
      view: !!(b?.view || c?.view),
      edit: !!(b?.edit || c?.edit),
      delete: !!(b?.delete || c?.delete),
    };
  }
  return out;
}

/**
 * Resolve the effective permission matrix for one solicitor + client pair, and
 * confirm the client is actually assigned to them. Returns `null` when the
 * solicitor has no assignment for that client (treat as 403).
 */
export async function resolveClientPermissions(
  supabase: any,
  solicitorUserId: string,
  clientId: string,
): Promise<PermissionMatrix | null> {
  const [{ data: assignment }, { data: baselineRow }] = await Promise.all([
    supabase
      .from('solicitor_portal_client_assignments')
      .select('permissions')
      .eq('solicitor_user_id', solicitorUserId)
      .eq('client_id', clientId)
      .maybeSingle(),
    supabase
      .from('solicitor_portal_default_permissions')
      .select('permissions')
      .eq('solicitor_user_id', solicitorUserId)
      .maybeSingle(),
  ]);

  if (!assignment) return null;
  return mergePermissions(baselineRow?.permissions ?? null, assignment.permissions ?? null);
}

export function can(
  matrix: PermissionMatrix | null,
  key: string,
  level: 'view' | 'edit' | 'delete' = 'view',
): boolean {
  if (SOLICITOR_FORBIDDEN_KEYS.has(key)) return false;
  if (!matrix) return false;
  return !!matrix[key]?.[level];
}

/** List every client_id this solicitor is assigned to. */
export async function listAssignedClientIds(
  supabase: any,
  solicitorUserId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('solicitor_portal_client_assignments')
    .select('client_id')
    .eq('solicitor_user_id', solicitorUserId);
  return (data || []).map((r: any) => r.client_id);
}

/** Append an entry to the solicitor activity log. Never throws. */
export async function logSolicitorActivity(
  supabase: any,
  entry: {
    solicitor_user_id?: string | null;
    firm_id?: string | null;
    actor_user_id?: string | null;
    actor_type?: string;
    action: string;
    client_id?: string | null;
    legal_matter_id?: string | null;
    entity_type?: string | null;
    entity_id?: string | null;
    metadata?: Record<string, unknown> | null;
    ip_address?: string | null;
    user_agent?: string | null;
    visible_to_client?: boolean;
  },
): Promise<void> {
  try {
    await supabase.from('solicitor_portal_activity_log').insert({
      actor_type: 'solicitor_user',
      ...entry,
    });
  } catch (e) {
    console.error('[solicitor-portal] activity log failed:', e);
  }
}

export function requestIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}
