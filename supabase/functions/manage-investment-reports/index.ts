import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createForbiddenResponse, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
// Dynamic CORS headers for credential-based requests
function createCorsHeaders(origin: string | null): Record<string, string> {
  // Support Lovable preview + published domains for credentialed requests
  const allowedOrigin = origin && (
    origin === 'https://command-centre.npcservices.com.au' ||
    origin.endsWith('.lovable.app') ||
    origin.endsWith('.lovableproject.com') ||
    origin.endsWith('.npcservices.com.au') ||
    origin.includes('localhost')
  )
    ? origin 
    : 'https://command-centre.npcservices.com.au';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token',
    'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

interface RequestBody {
  action: 'insert' | 'update' | 'delete' | 'archive' | 'unarchive' | 'archivePackage' | 'unarchivePackage' | 'bulkDelete' | 'getVersion';
  reportId?: string;
  reportIds?: string[];
  data?: Record<string, any>;
  session_token?: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: RequestBody = await req.json();

    // Validate authentication (JWT first, then session token)
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('Auth failed for manage-investment-reports:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    console.log(`Authenticated user ${userId} managing investment reports - action: ${body.action}`);

    const { action, reportId, reportIds, data } = body;

    if (action === 'archivePackage' || action === 'unarchivePackage') {
      const permission = await requireModulePermission(
        supabase,
        { userId, authMethod },
        'generated_reports',
        'can_edit',
      );
      if (!permission.ok) {
        return createForbiddenResponse(permission.error || 'Generated reports edit permission required', corsHeaders);
      }
    }

    switch (action) {
      case 'insert': {
        if (!data) {
          return new Response(
            JSON.stringify({ error: 'Data is required for insert' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: report, error: insertError } = await supabase
          .from('investment_reports')
          .insert(data)
          .select()
          .single();

        if (insertError) {
          console.error('Error inserting investment report:', insertError);
          return new Response(
            JSON.stringify({ error: 'Failed to create report', details: insertError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, report }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        if (!reportId || !data) {
          return new Response(
            JSON.stringify({ error: 'reportId and data are required for update' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Slim return payload — never re-select the huge `report_content`
        // column on update. Re-selecting the full row was contributing to
        // statement-timeouts (Postgres 57014) when combined with the
        // archive_report_version trigger + concurrent dashboard polling.
        const { data: report, error: updateError } = await supabase
          .from('investment_reports')
          .update({ ...data, updated_at: new Date().toISOString() })
          .eq('id', reportId)
          .select('id, status, current_version, last_completed_section, updated_at, error_message')
          .single();

        if (updateError) {
          console.error('Error updating investment report:', updateError);
          return new Response(
            JSON.stringify({ error: 'Failed to update report', details: updateError.message, code: (updateError as any).code }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, report }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        if (!reportId) {
          return new Response(
            JSON.stringify({ error: 'reportId is required for delete' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error: deleteError } = await supabase
          .from('investment_reports')
          .delete()
          .eq('id', reportId);

        if (deleteError) {
          console.error('Error deleting investment report:', deleteError);
          return new Response(
            JSON.stringify({ error: 'Failed to delete report', details: deleteError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, deleted: reportId }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'bulkDelete': {
        if (!reportIds || reportIds.length === 0) {
          return new Response(
            JSON.stringify({ error: 'reportIds are required for bulkDelete' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Also support status-based bulk delete
        const statusFilter = data?.statusFilter;
        
        let query = supabase.from('investment_reports').delete();
        
        if (statusFilter && Array.isArray(statusFilter)) {
          query = query.in('status', statusFilter);
        } else if (reportIds.length > 0) {
          query = query.in('id', reportIds);
        }

        const { data: deleted, error: bulkDeleteError } = await query.select('id');

        if (bulkDeleteError) {
          console.error('Error bulk deleting investment reports:', bulkDeleteError);
          return new Response(
            JSON.stringify({ error: 'Failed to bulk delete reports', details: bulkDeleteError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, deletedCount: deleted?.length || 0, deleted }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'archive': {
        if (!reportId) {
          return new Response(
            JSON.stringify({ error: 'reportId is required for archive' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: report, error: archiveError } = await supabase
          .from('investment_reports')
          .update({ is_archived: true, updated_at: new Date().toISOString() })
          .eq('id', reportId)
          .select()
          .single();

        if (archiveError) {
          console.error('Error archiving investment report:', archiveError);
          return new Response(
            JSON.stringify({ error: 'Failed to archive report', details: archiveError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, report }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'unarchive': {
        if (!reportId) {
          return new Response(
            JSON.stringify({ error: 'reportId is required for unarchive' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: report, error: unarchiveError } = await supabase
          .from('investment_reports')
          .update({ is_archived: false, updated_at: new Date().toISOString() })
          .eq('id', reportId)
          .select()
          .single();

        if (unarchiveError) {
          console.error('Error unarchiving investment report:', unarchiveError);
          return new Response(
            JSON.stringify({ error: 'Failed to unarchive report', details: unarchiveError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, report }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'archivePackage':
      case 'unarchivePackage': {
        if (!reportIds?.length || reportIds.some(id => typeof id !== 'string')) {
          return new Response(JSON.stringify({ error: 'reportIds are required for package updates' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        // Resolve membership on the server so restore includes active siblings hidden
        // by the archived filter. A listing ID is the stable key; exact address is only
        // used for legacy rows that have no listing reference.
        const uniqueIds = [...new Set(reportIds)];
        const { data: anchorRows, error: anchorError } = await supabase
          .from('investment_reports')
          .select('id, property_listing_id, property_address')
          .in('id', uniqueIds)
          .limit(1);
        const anchor = anchorRows?.[0];
        if (anchorError || !anchor) {
          console.error('Package anchor lookup failed:', anchorError, { uniqueIds });
          return new Response(JSON.stringify({ error: 'Property package was not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        let packageQuery = supabase.from('investment_reports').update({ is_archived: action === 'archivePackage', updated_at: new Date().toISOString() });
        packageQuery = anchor.property_listing_id
          ? packageQuery.eq('property_listing_id', anchor.property_listing_id)
          : packageQuery.eq('property_address', anchor.property_address);
        const { data: updated, error: packageError } = await packageQuery.select('id, is_archived');
        if (packageError || !updated?.length) {
          console.error('Error updating investment report package:', packageError);
          return new Response(JSON.stringify({ error: 'Failed to update property package' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ success: true, reports: updated }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'getVersion': {
        if (!reportId) {
          return new Response(
            JSON.stringify({ error: 'reportId is required for getVersion' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const versionNumber = data?.versionNumber;
        if (!versionNumber) {
          return new Response(
            JSON.stringify({ error: 'versionNumber is required for getVersion' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`Fetching version ${versionNumber} for report ${reportId}`);

        const { data: version, error: versionError } = await supabase
          .from('report_versions')
          .select('*')
          .eq('report_id', reportId)
          .eq('version_number', versionNumber)
          .single();

        if (versionError) {
          console.error('Error fetching version:', versionError);
          return new Response(
            JSON.stringify({ error: 'Failed to fetch version', details: versionError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!version) {
          return new Response(
            JSON.stringify({ error: 'Version not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, version }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('Error in manage-investment-reports:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
