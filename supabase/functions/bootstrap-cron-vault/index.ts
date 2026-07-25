// One-shot bootstrap: populate Vault with the service-role key + INTERNAL_EDGE_SECRET
// so pg_cron jobs can authenticate to fail-closed edge functions.
//
// Security posture:
// - Deployed with verify_jwt=false but requires an internal handshake header.
// - Refuses to run once the Vault already contains supabase_service_role_key
//   (idempotent, single-use). Subsequent calls no-op with 409.
// - Never returns the secret values themselves.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const INTERNAL_EDGE_SECRET = Deno.env.get('INTERNAL_EDGE_SECRET');

  if (!SERVICE_ROLE || !INTERNAL_EDGE_SECRET) {
    return new Response(JSON.stringify({ error: 'server_env_missing' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Handshake: caller must echo the internal secret it doesn't otherwise know.
  // This function is deployed without JWT verification for the one-shot bootstrap,
  // so the non-public secret is its sole authorization mechanism.
  const handshake = req.headers.get('x-bootstrap-handshake');
  if (handshake !== INTERNAL_EDGE_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Idempotency: refuse if already bootstrapped.
  const { data: probe } = await admin
    .from('cron_vault_bootstrap_marker')
    .select('bootstrapped_at')
    .limit(1)
    .maybeSingle();

  if (probe?.bootstrapped_at) {
    return new Response(JSON.stringify({ error: 'already_bootstrapped', at: probe.bootstrapped_at }), {
      status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { error } = await admin.rpc('bootstrap_cron_vault', {
    p_service_role_key: SERVICE_ROLE,
    p_internal_edge_secret: INTERNAL_EDGE_SECRET,
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  await admin.from('cron_vault_bootstrap_marker').insert({ bootstrapped_at: new Date().toISOString() });

  return new Response(JSON.stringify({ ok: true, stored: ['supabase_service_role_key', 'internal_edge_secret', 'supabase_url'] }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
