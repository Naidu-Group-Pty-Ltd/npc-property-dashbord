import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // SECURITY: Verify authentication and admin role (cleanup should be admin-only)
    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[cleanup-stale-calls] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    
    // Check if user has admin role
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['superadmin', 'admin'])
      .single();

    if (roleError || !roleData) {
      console.warn(`User ${userId} attempted to cleanup stale calls without admin role.`);
      return createForbiddenResponse('Forbidden: Admin access required', corsHeaders);
    }
    console.log(`[cleanup-stale-calls] Admin user ${userId} cleaning up stale calls`);

    console.log('[Cleanup Stale Calls] Starting cleanup...');

    // Find calls stuck in active states for more than 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // Update stale calls to 'ended' status
    const { data: staleCalls, error: updateError } = await supabase
      .from('vapi_call_logs')
      .update({ 
        call_status: 'ended',
        call_outcome: 'timeout'
      })
      .in('call_status', ['ringing', 'in-progress', 'queued'])
      .lt('started_at', twoHoursAgo)
      .select('id, vapi_call_id, call_status, started_at');

    if (updateError) {
      console.error('[Cleanup Stale Calls] Error updating stale calls:', updateError);
      throw updateError;
    }

    const updatedCount = staleCalls?.length || 0;
    console.log(`[Cleanup Stale Calls] Cleaned up ${updatedCount} stale calls`);

    if (staleCalls && staleCalls.length > 0) {
      console.log('[Cleanup Stale Calls] Cleaned call IDs:', staleCalls.map(c => c.vapi_call_id));
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Cleaned up ${updatedCount} stale calls`,
        cleanedCalls: staleCalls || []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Cleanup Stale Calls] Error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'cleanup-stale-calls'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
