// Archived News read + restore contract.
//
// Why this function exists rather than reusing `market-updates-status`:
// the archive surface repeatedly rendered empty because the shared, heavily
// multiplexed status function ships stale in cached bundles (the same failure
// mode that forced `notifications-feed-v2`). This is a small, single-purpose
// function with a self-contained CSRF allowlist so the archive page has an
// authoritative endpoint of its own.
//
// Actions:
//   list    { page?, pageSize?, search?, sort?, source?, category?, impact?, geography?, audience? }
//   restore { id }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createUnauthorizedResponse, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';

const ARCHIVE_COLUMNS = 'id,correlation_id,source_id,source_name,source_url,canonical_url,original_url,source_authority,source_perspective,author,public_excerpt,source_published_at,ingested_at,title,slug,category,segments,freshness_tier,geography,impact_level,audience_tags,ai_summary,key_points,why_it_matters,property_implications,finance_implications,policy_implications,risk_flags,lending_criteria_tags,legal_topics,economic_topics,legal_status,effective_date,citation_urls,status,publication_reason,ai_status,dedupe_hash,visibility,created_at,updated_at,archived_at,archived_by,pre_archive_status';

const LOVABLE_PROJECT_ID = '7976d60b-c277-4851-889b-c170285f4be2';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXACT_ORIGINS = new Set([
  'https://command-centre.npcservices.com.au',
  'https://npc-property-dashbord.lovable.app',
  'http://localhost:5173',
  'http://localhost:8080',
  ...(Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean),
]);

function originAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (EXACT_ORIGINS.has(origin)) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    const firstParty = ['.lovable.app', '.lovableproject.com', '.lovable.dev'].some((s) => host.endsWith(s));
    return firstParty && host.includes(LOVABLE_PROJECT_ID);
  } catch {
    return false;
  }
}

function csrfCheck(req: Request): { ok: boolean; reason?: string; origin?: string | null } {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return { ok: true };
  if (!req.headers.get('cookie')) return { ok: true };
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  let candidate: string | null = origin;
  if (!candidate && referer) {
    try { candidate = new URL(referer).origin; } catch { candidate = null; }
  }
  if (!candidate) return { ok: false, reason: 'origin_missing', origin: null };
  return originAllowed(candidate)
    ? { ok: true, origin: candidate }
    : { ok: false, reason: 'origin_not_allowed', origin: candidate };
}

// PostgREST `or` expressions treat comma/parentheses as syntax and ilike uses
// percent/underscore as wildcards. Archive search is literal and bounded.
function archiveSearch(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 120).replace(/[,%_()\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...cors, 'Content-Type': 'application/json', 'cache-control': 'private, no-store' } },
  );

  const csrf = csrfCheck(req);
  if (!csrf.ok) return json({ error: 'CSRF check failed', code: 'csrf_denied', reason: csrf.reason, origin: csrf.origin ?? null }, 403);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sb = admin();

    let auth = await verifyAuth(sb, req.headers, {});
    if (auth.error || !auth.userId) auth = await verifyAuth(sb, req.headers, body as { session_token?: string });
    if (auth.error || !auth.userId || auth.userId === 'service_role') {
      return createUnauthorizedResponse(auth.error ?? 'Authentication required', cors);
    }

    const view = await requireModulePermission(sb, { userId: auth.userId, authMethod: auth.authMethod }, 'market_updates', 'can_view');
    if (!view.ok) return json({ error: 'Market Updates view permission required', code: 'market_updates_view_required' }, 403);

    const action = String(body.action ?? 'list');

    if (action === 'restore') {
      const id = String(body.id ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'id_required', code: 'invalid_request' }, 400);
      const edit = await requireModulePermission(sb, { userId: auth.userId, authMethod: auth.authMethod }, 'market_updates', 'can_edit');
      if (!edit.ok) return json({ error: 'Market Updates edit permission required', code: 'market_updates_edit_required' }, 403);
      const { data: row, error: readError } = await sb.from('market_updates').select('id,archived_at,pre_archive_status').eq('id', id).maybeSingle();
      if (readError) return json({ error: 'Archive restore failed', code: 'market_updates_write_failed' }, 500);
      if (!row) return json({ error: 'not_found', code: 'not_found' }, 404);
      if (!row.archived_at) return json({ outcome: 'already_restored', id }, 200);
      const { error: updateError } = await sb.from('market_updates')
        .update({ archived_at: null, archived_by: null, status: row.pre_archive_status ?? 'published', pre_archive_status: null })
        .eq('id', id);
      if (updateError) return json({ error: 'Archive restore failed', code: 'market_updates_write_failed' }, 500);
      return json({ outcome: 'restored', id }, 200);
    }

    // Archiving lives here too, so the operator flow does not depend on the
    // multiplexed curate function staying in step with the frontend contract.
    if (action === 'archive' || action === 'hide' || action === 'publish') {
      const id = String(body.id ?? body.updateId ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'id_required', code: 'invalid_request' }, 400);
      const edit = await requireModulePermission(sb, { userId: auth.userId, authMethod: auth.authMethod }, 'market_updates', 'can_edit');
      if (!edit.ok) return json({ error: 'Market Updates edit permission required', code: 'market_updates_edit_required' }, 403);
      const { data: row, error: readError } = await sb.from('market_updates').select('id,status,archived_at,visibility').eq('id', id).maybeSingle();
      if (readError) return json({ error: 'Market update could not be loaded', code: 'market_updates_read_failed' }, 500);
      if (!row) return json({ error: 'not_found', code: 'not_found' }, 404);
      const now = new Date().toISOString();

      if (action === 'publish') {
        if (row.status === 'published' && !row.archived_at) return json({ outcome: 'already_published', id }, 200);
        if (row.status !== 'candidate' || row.archived_at || row.visibility !== 'public') {
          return json({ error: 'Only a live held candidate can be published.', code: 'invalid_state_transition' }, 409);
        }
        const { error: publishError } = await sb.from('market_updates')
          .update({ status: 'published', publication_reason: 'operator_manual_publication', candidate_reason: null, decisioned_at: now, updated_at: now })
          .eq('id', id).eq('status', 'candidate').is('archived_at', null);
        if (publishError) return json({ error: 'Market update could not be published.', code: 'market_updates_write_failed' }, 500);
        return json({ outcome: 'published', id }, 200);
      }

      if (row.archived_at) return json({ outcome: 'already_archived', id }, 200);
      const { error: archiveError } = await sb.from('market_updates')
        .update({ archived_at: now, archived_by: auth.userId, pre_archive_status: row.status, decisioned_at: now, updated_at: now })
        .eq('id', id).is('archived_at', null);
      if (archiveError) return json({ error: 'Market update could not be archived.', code: 'market_updates_write_failed' }, 500);
      return json({ outcome: 'archived', id }, 200);
    }

    if (action !== 'list') return json({ error: 'Unknown action', code: 'invalid_request' }, 400);


    const page = Math.max(1, Math.floor(Number(body.page) || 1));
    const pageSize = Math.max(10, Math.min(50, Math.floor(Number(body.pageSize) || 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const search = archiveSearch(body.search);
    const sort = body.sort === 'published_desc' ? 'published_desc' : 'archived_desc';

    let query = sb.from('market_updates').select(ARCHIVE_COLUMNS, { count: 'exact' }).not('archived_at', 'is', null);
    if (search) query = query.or(`title.ilike.%${search}%,source_name.ilike.%${search}%,ai_summary.ilike.%${search}%`);
    if (typeof body.source === 'string' && body.source !== 'all') query = query.eq('source_name', body.source);
    if (typeof body.category === 'string' && body.category !== 'all') query = query.eq('category', body.category);
    if (typeof body.impact === 'string' && body.impact !== 'all') query = query.eq('impact_level', body.impact);
    if (typeof body.geography === 'string' && body.geography !== 'all') query = query.contains('geography', [body.geography]);
    if (typeof body.audience === 'string' && body.audience !== 'all') query = query.contains('audience_tags', [body.audience]);
    query = query
      .order(sort === 'published_desc' ? 'source_published_at' : 'archived_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(from, to);

    const { data, count, error } = await query;
    if (error) {
      console.error(JSON.stringify({ function: 'market-updates-archive', stage: 'list', error: error.message }));
      return json({ error: 'Archived News could not be loaded.', code: 'market_updates_read_failed', retryable: true }, 500);
    }

    const items = data ?? [];
    return json({
      archive: { items, count: count ?? 0, page, pageSize, hasMore: to + 1 < (count ?? 0) },
    }, 200);
  } catch (error) {
    console.error(JSON.stringify({ function: 'market-updates-archive', error: String((error as Error)?.message ?? error) }));
    return json({ error: 'Archived News could not be loaded.', code: 'market_updates_read_failed', retryable: true }, 500);
  }
});
