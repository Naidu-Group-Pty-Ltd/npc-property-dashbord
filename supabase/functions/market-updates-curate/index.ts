// Operator curation for the Market Updates feed. Lets an administrator take a
// published item off the dashboard, and put it back. Writes stay behind the
// service role and a deny-by-default market_updates can_edit check, matching the
// read contract in market-updates-status.
//
// Hiding sets status='ignored' rather than deleting the row: the dedupe hash has
// to survive so a later ingestion run does not simply rediscover and republish
// the same article.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCorsHeaders, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { enforceJsonBodyLimit } from '../_shared/requestSecurity.ts';
import { logMarketEvent, marketCorrelationId } from '../_shared/marketUpdatesObservability.ts';

const UPDATE_COLUMNS = 'id,title,status,failure_reason,decisioned_at,updated_at';
const MAX_REQUEST_BYTES = 4_096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number, cors: Record<string,string>, correlationId: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type':'application/json', 'cache-control':'private, no-store', 'x-correlation-id':correlationId },
  });
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  const correlationId = marketCorrelationId(req.headers);
  if (req.method === 'OPTIONS') return new Response(null, { headers:cors });
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);
  if (req.method !== 'POST') return json({ error:'Method not allowed', correlation_id:correlationId }, 405, cors, correlationId);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth:{ persistSession:false } });

  let auth = await verifyAuth(sb, req.headers, {});
  const parsed = await enforceJsonBodyLimit<unknown>(req, MAX_REQUEST_BYTES);
  if (!parsed.ok) {
    return new Response(parsed.error.body, {
      status: parsed.error.status,
      headers: { ...Object.fromEntries(parsed.error.headers), ...cors, 'x-correlation-id':correlationId },
    });
  }
  if (parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return json({ error:'Invalid request', code:'invalid_request', correlation_id:correlationId }, 400, cors, correlationId);
  }
  const body = parsed.value as Record<string, unknown>;
  if (auth.error || !auth.userId) auth = await verifyAuth(sb, req.headers, body);
  if (auth.error || !auth.userId) return json({ error:'Authentication required', code:'market_updates_auth_required', correlation_id:correlationId, retryable:false }, 401, cors, correlationId);

  const permission = await requireModulePermission(sb, { userId:auth.userId, authMethod:auth.authMethod }, 'market_updates', 'can_edit');
  if (!permission.ok) return json({ error:'Market Updates edit permission required', code:'market_updates_edit_required', correlation_id:correlationId, retryable:false }, 403, cors, correlationId);

  const action = String(body.action ?? '');
  if (action !== 'hide' && action !== 'restore') {
    return json({ error:'Unknown action', code:'invalid_action', correlation_id:correlationId }, 400, cors, correlationId);
  }
  const updateId = typeof body.updateId === 'string' ? body.updateId : '';
  if (!UUID.test(updateId)) return json({ error:'Invalid update ID', code:'invalid_request', correlation_id:correlationId }, 400, cors, correlationId);

  const { data: existing, error: readError } = await sb.from('market_updates').select('id,status').eq('id', updateId).maybeSingle();
  if (readError) {
    console.error(JSON.stringify({ function:'market-updates-curate', stage:action, correlation_id:correlationId, error_class:'database_read_failed' }));
    return json({ error:'Market update could not be loaded.', code:'market_updates_read_failed', correlation_id:correlationId, retryable:true }, 500, cors, correlationId);
  }
  if (!existing) return json({ error:'Market update not found', code:'not_found', correlation_id:correlationId, retryable:false }, 404, cors, correlationId);

  const patch = action === 'hide'
    ? { status:'ignored', failure_reason:'hidden_by_operator', decisioned_at:new Date().toISOString(), updated_at:new Date().toISOString() }
    : { status:'published', failure_reason:null, decisioned_at:new Date().toISOString(), updated_at:new Date().toISOString() };

  const { data, error } = await sb.from('market_updates').update(patch).eq('id', updateId).select(UPDATE_COLUMNS).single();
  if (error) {
    console.error(JSON.stringify({ function:'market-updates-curate', stage:action, correlation_id:correlationId, error_class:'database_update_failed' }));
    return json({ error:'Market update visibility could not be changed.', code:'market_updates_write_failed', correlation_id:correlationId, retryable:true }, 500, cors, correlationId);
  }

  logMarketEvent('info', { function:'market-updates-curate', stage:action, correlation_id:correlationId, status:'completed', update_id:updateId, previous_status:existing.status });
  return json({ update:data, action, correlation_id:correlationId }, 200, cors, correlationId);
});
