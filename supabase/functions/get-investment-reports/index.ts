import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
type TableName = 'investment_reports' | 'generated_reports' | 'property_comparisons';

interface RequestBody {
  // Table selection (defaults to investment_reports for backwards compatibility)
  table?: TableName;
  
  // Single report fetch
  reportId?: string;
  
  // Multiple reports fetch
  reportIds?: string[];
  
  // List mode options
  listMode?: boolean;
  listOptions?: {
    select?: string;
    status?: string | string[];
    isArchived?: boolean;
    isClientReport?: boolean | null; // null means no filter
    clientPropertyId?: string;
    clientPropertyIds?: string[];
    orderBy?: string;
    orderAsc?: boolean;
    limit?: number;
    offset?: number;
    createdAfter?: string; // ISO date string
    createdBefore?: string; // ISO date string
    hasPropertyListingId?: boolean; // For filtering auto-generated reports
  };
  
  session_token?: string;
}

const DEFAULT_SELECTS: Record<TableName, string> = {
  investment_reports: 'id, property_address, property_listing_id, canonical_property_key, created_at, current_version, report_scope, report_tier, parent_report_id, status, is_archived, investment_score',
  // NOTE: do NOT default to '*' on generated_reports — the row contains large
  // JSONB report content that will trip the Postgres statement timeout.
  generated_reports: 'id, title, report_type, created_at, updated_at, status',
  property_comparisons: 'id, property_count, property_addresses, property_states, report_title, report_ids, created_at, analysis_summary, executive_summary, rankings, recommendations, financial_comparison, location_comparison, risk_comparison, red_flags',
};

Deno.serve(async (req) => {
  // IMPORTANT: Declare corsHeaders BEFORE try block so it's available in catch
  const origin = req.headers.get('origin') || '';
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

    // Parse body with error handling - session token may be in headers/cookies
    let body: RequestBody = {};
    try {
      body = await req.json();
    } catch (err) {
      console.log('[get-investment-reports] Body parsing failed (may be empty), continuing with empty body:', err);
      // Continue - session token should be in headers/cookies
    }

    // Validate authentication (JWT first, then session token)
    // IMPORTANT: verifyAuth checks headers/cookies first, then body
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[get-investment-reports] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    console.log(`[get-investment-reports] Authenticated user ${userId}`);

    const { table = 'investment_reports', reportId, reportIds, listMode, listOptions = {} } = body;

    // Validate table
    if (!['investment_reports', 'generated_reports', 'property_comparisons'].includes(table)) {
      return new Response(
        JSON.stringify({ error: `Invalid table: ${table}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Single report fetch
    if (reportId) {
      const selectFields = listOptions.select || (table === 'investment_reports' ? '*' : DEFAULT_SELECTS[table]);
      
      const { data: report, error: reportError } = await supabase
        .from(table)
        .select(selectFields)
        .eq('id', reportId)
        .single();

      if (reportError) {
        console.error(`[get-investment-reports] Error fetching ${table}:`, reportError);
        return new Response(
          JSON.stringify({ error: 'Report not found', details: reportError.message }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, report }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Multiple reports fetch by IDs
    if (reportIds && reportIds.length > 0) {
      const selectFields = listOptions.select || DEFAULT_SELECTS[table];
      const safeIds = reportIds.slice(0, 200);

      const { data: reports, error: reportsError } = await supabase
        .from(table)
        .select(selectFields)
        .in('id', safeIds);


      if (reportsError) {
        console.error(`[get-investment-reports] Error fetching ${table}:`, reportsError);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch reports', details: reportsError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, reports, count: reports?.length || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // List mode - fetch reports with filters
    if (listMode || !reportId) {
      const {
        select = DEFAULT_SELECTS[table],
        status,
        isArchived,
        isClientReport,
        clientPropertyId,
        clientPropertyIds,
        orderBy = 'created_at',
        orderAsc = false,
        limit, // No default limit - fetch all by default
        offset,
        createdAfter,
        createdBefore,
        hasPropertyListingId
      } = listOptions;

      let query = supabase
        .from(table)
        .select(select);

      // Apply filters based on table type
      if (table === 'investment_reports') {
        // Apply status filter
        if (status) {
          if (Array.isArray(status)) {
            query = query.in('status', status);
          } else {
            query = query.eq('status', status);
          }
        }

        // Apply archived filter
        if (typeof isArchived === 'boolean') {
          query = query.eq('is_archived', isArchived);
        }

        // Apply client report filter
        if (isClientReport === true) {
          query = query.eq('is_client_report', true);
        } else if (isClientReport === false) {
          query = query.or('is_client_report.is.null,is_client_report.eq.false');
        }

        // Apply client property filter
        if (clientPropertyId) {
          query = query.eq('client_property_id', clientPropertyId);
        } else if (clientPropertyIds && clientPropertyIds.length > 0) {
          query = query.in('client_property_id', clientPropertyIds);
        }

        // Apply date filter
        if (createdAfter) {
          query = query.gte('created_at', createdAfter);
        }
        if (createdBefore) {
          query = query.lte('created_at', createdBefore);
        }

        // Filter for auto-generated reports (have property_listing_id)
        if (hasPropertyListingId === true) {
          query = query.not('property_listing_id', 'is', null);
        } else if (hasPropertyListingId === false) {
          query = query.is('property_listing_id', null);
        }
      }

      // Apply ordering
      query = query.order(orderBy, { ascending: orderAsc });

      // Apply limit / pagination — enforce a hard ceiling to avoid statement timeouts
      const MAX_LIMIT = 200;
      const effectiveLimit = Math.min(limit ?? MAX_LIMIT, MAX_LIMIT);
      if (typeof offset === 'number' && offset > 0) {
        const rangeEnd = offset + effectiveLimit - 1;
        query = query.range(offset, rangeEnd);
      } else {
        query = query.limit(effectiveLimit);
      }

      const { data: reports, error: reportsError } = await query;

      if (reportsError) {
        console.error(`[get-investment-reports] Error fetching ${table} list:`, reportsError);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch reports', details: reportsError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, reports, count: reports?.length || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid request - provide reportId, reportIds, or use listMode' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[get-investment-reports] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
