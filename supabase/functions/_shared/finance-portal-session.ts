/**
 * Shared helper for finance portal session resolution.
 * Returns the validated portal user or throws via a Response thunk.
 */
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.55.0";

export function extractFinanceToken(headers: Headers, body?: any): string | null {
  return headers.get('x-finance-session-token')
    || body?.finance_session_token
    || headers.get('x-session-token')
    || body?.session_token
    || null;
}

export function makeServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

export async function resolveFinancePartner(supabase: SupabaseClient, token: string | null) {
  if (!token) return { error: 'Session token required', status: 401 };
  // WP-11A: dual-read (hash first, plaintext fallback) and backfill.
  let hash: string | null = null;
  try {
    const mod = await import('./sessionHash.ts');
    if (mod.isSessionHashConfigured()) hash = await mod.hashSessionToken(token);
  } catch { /* pepper missing → fallback */ }

  const cols = 'id, email, is_active, revoked_at, session_expires_at, session_idle_expires_at, session_token_hash, global_permissions';
  let portalUser: any = null;
  if (hash) {
    const { data } = await supabase.from('finance_portal_users').select(cols)
      .eq('session_token_hash', hash).maybeSingle();
    portalUser = data ?? null;
  }
  if (!portalUser) {
    const { data } = await supabase.from('finance_portal_users').select(cols)
      .eq('session_token', token).maybeSingle();
    portalUser = data ?? null;
  }
  if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
    return { error: 'Invalid session', status: 401 };
  }
  if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
    return { error: 'Session expired', status: 401 };
  }
  if (portalUser.session_idle_expires_at && new Date(portalUser.session_idle_expires_at) < new Date()) {
    return { error: 'Session expired', status: 401 };
  }
  try {
    const patch: Record<string, unknown> = { session_last_used_at: new Date().toISOString() };
    if (hash && !portalUser.session_token_hash) patch.session_token_hash = hash;
    await supabase.from('finance_portal_users').update(patch).eq('id', portalUser.id);
  } catch { /* non-fatal */ }
  return { portalUser };
}
