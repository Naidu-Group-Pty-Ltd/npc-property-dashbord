import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { INTEGRATION_SECRET_MAP } from '../_shared/integrationSecrets.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

// Integration ID → Supabase secret names, generated from src/lib/integrations/registry.ts.
// Previously hand-maintained here, which had drifted from the registry for 37 integrations
// (mostly missing secondary fields), so the page's status badges under-reported what those
// integrations actually need. See scripts/generate-integration-secrets.mjs.
const integrationSecretMap: Record<string, string[]> = INTEGRATION_SECRET_MAP;


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
    // SECURITY: Verify authentication and admin role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body: { integrationId?: string } = await req.json().catch(() => ({}));
    
    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error) {
      console.log('[check-integration-secrets] Auth failed:', authResult.error);
      return createUnauthorizedResponse(authResult.error, corsHeaders);
    }
    
    // Check if user has superadmin role
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', authResult.userId)
      .eq('role', 'superadmin')
      .single();

    if (roleError || !roleData) {
      console.warn(`User ${authResult.userId} attempted to check integration secrets without superadmin role.`);
      return createForbiddenResponse('Forbidden: Superadmin access required', corsHeaders);
    }
    console.log(`Superadmin ${authResult.userId} is checking integration secrets.`);

    // If specific integration requested, return just that one with extra info
    if (body.integrationId) {
      const integrationId = body.integrationId;
      // Own-property check only: a bare index would resolve inherited keys such as
      // 'constructor' or 'toString' to a non-array and fall through to the loop below.
      const secretNames = Object.hasOwn(integrationSecretMap, integrationId)
        ? integrationSecretMap[integrationId]
        : undefined;

      if (!secretNames) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unknown integration' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const configuredSecrets: string[] = [];
      const missingSecrets: string[] = [];

      for (const secretName of secretNames) {
        const value = Deno.env.get(secretName);
        if (value && value.trim() !== '') {
          configuredSecrets.push(secretName);
        } else {
          missingSecrets.push(secretName);
        }
      }

      const response: Record<string, unknown> = {
        success: true,
        configured: configuredSecrets.length === secretNames.length,
        configuredSecrets,
        missingSecrets,
      };

      // For GHL, also return the location ID (non-sensitive, needed for building URLs)
      if (integrationId === 'gohighlevel') {
        response.locationId = Deno.env.get('GOHIGHLEVEL_LOCATION_ID') || null;
      }

      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default: return all integrations status
    const results: Record<string, { configured: boolean; configuredSecrets: string[]; missingSecrets: string[] }> = {};

    for (const [integrationId, secretNames] of Object.entries(integrationSecretMap)) {
      const configuredSecrets: string[] = [];
      const missingSecrets: string[] = [];

      for (const secretName of secretNames) {
        const value = Deno.env.get(secretName);
        if (value && value.trim() !== '') {
          configuredSecrets.push(secretName);
        } else {
          missingSecrets.push(secretName);
        }
      }

      results[integrationId] = {
        configured: configuredSecrets.length === secretNames.length,
        configuredSecrets,
        missingSecrets,
      };
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        integrations: results,
        message: 'These are display-only statuses from Supabase secrets'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error checking integration secrets:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
