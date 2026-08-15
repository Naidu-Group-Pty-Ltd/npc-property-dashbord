import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getEffectiveGhlCredentials } from '../_shared/ghl-account.ts';
import { internalError } from '../_shared/errorResponse.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

interface GHLContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  dateAdded: string;
  customFields?: Array<{
    id: string;
    value: string;
  }>;
  tags?: string[];
}

interface GHLContactsResponse {
  contacts: GHLContact[];
  meta: {
    total: number;
    nextPageUrl: string | null;
    startAfterId: string | null;
    startAfter: number | null;
  };
}

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: 'Supabase credentials not configured', success: false }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    const _ghlCreds = await getEffectiveGhlCredentials(supabase);
    const apiKey = _ghlCreds.apiKey;
    const locationId = _ghlCreds.locationId;
    console.log(`[import-clients-from-ghl] Using GHL account: ${_ghlCreds.label}`);

    if (!apiKey || !locationId) {
      console.error('GHL credentials not configured');
      return new Response(JSON.stringify({ 
        error: 'GoHighLevel credentials not configured',
        success: false 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    
    // SECURITY: Verify authentication (admin-only for import operations)
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[import-clients-from-ghl] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log('[import-clients-from-ghl] Authenticated user:', userId);
    
    // Check if user is admin (import operations should be admin-only)
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['superadmin', 'admin'])
      .single();
    
    if (!roleData) {
      console.log('[import-clients-from-ghl] User is not admin');
      return new Response(JSON.stringify({ 
        error: 'Unauthorized: Admin access required',
        success: false 
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const {
      clearExisting = false,
      resumeFromId = null,
      resumeFrom = null,
      maxPages = 10,
    } = body;

    console.log(
      `Starting GHL contact import. Clear existing: ${clearExisting}, Resume from: ${resumeFromId || 'start'} (${resumeFrom || 'no-timestamp'}), Max pages: ${maxPages}`,
    );

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-04-15',
      'Content-Type': 'application/json',
    };

    // Clear existing clients ONLY if requested AND this is the first batch (no resumeFromId)
    if (clearExisting && !resumeFromId) {
      console.log('Clearing existing client data...');
      
      // Delete in order due to foreign key constraints
      await supabase.from('client_tag_assignments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_scores').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_activities').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_reminders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_files').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_notes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_liabilities').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_assets').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_income').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_employment').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_properties').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_import_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('clients').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      
      console.log('Existing client data cleared');
    }

    // Process contacts page by page - SAVE IMMEDIATELY after each page
    // NOTE: GHL pagination requires BOTH startAfter (timestamp cursor) and startAfterId (tie-breaker).
    let startAfterId: string | null = resumeFromId;
    let startAfter: number | null = typeof resumeFrom === 'number' ? resumeFrom : null;
    let pageCount = 0;
    let totalImported = 0;
    let totalErrors = 0;
    const errors: string[] = [];
    let totalFromApi = 0;

    while (pageCount < maxPages) {
      pageCount++;

      // Build request using both cursors (startAfter + startAfterId)
      let url = `${GHL_API_BASE}/contacts/?locationId=${locationId}&limit=100`;
      if (typeof startAfter === 'number') url += `&startAfter=${startAfter}`;
      if (startAfterId) url += `&startAfterId=${startAfterId}`;

      console.log(`Fetching GHL contacts page ${pageCount}: ${url}`);

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`GHL API error: ${response.status} - ${errorText}`);
        throw new Error(`GHL API error: ${response.status} - ${errorText}`);
      }

      const data: GHLContactsResponse = await response.json();
      const contacts = data.contacts || [];

      // Capture total from first page only if starting fresh
      if (pageCount === 1 && !resumeFromId && data.meta?.total) {
        totalFromApi = data.meta.total;
        console.log(`GHL reports total contacts: ${totalFromApi}`);
      }

      console.log(
        `Received ${contacts.length} contacts from GHL (page ${pageCount}). meta.startAfter=${data.meta?.startAfter ?? 'null'} meta.startAfterId=${data.meta?.startAfterId ?? 'null'}`,
      );

      if (contacts.length === 0) {
        console.log('No more contacts to fetch');
        startAfter = null;
        startAfterId = null;
        break;
      }

      // IMMEDIATELY save this page to DB - with email deduplication
      // First, check for existing clients by email to prevent duplicates from GHL
      let savedCount = 0;
      
      for (const contact of contacts) {
        const ghlAddress = [contact.address1, contact.city, contact.state, contact.postalCode]
          .filter(Boolean)
          .join(', ') || null;

        const clientData = {
          primary_first_name: contact.firstName || 'Unknown',
          primary_surname: contact.lastName || 'Unknown',
          primary_email: contact.email || null,
          primary_mobile: contact.phone || null,
          current_address: ghlAddress,
          current_suburb: contact.city || null,
          current_state: contact.state || null,
          current_postcode: contact.postalCode || null,
          country: contact.country || 'Australia',
          ghl_contact_id: contact.id,
          ghl_sync_status: 'synced',
          ghl_last_synced_at: new Date().toISOString(),
        };

        // Non-destructive update payload for EXISTING clients.
        // GHL is not the source of truth for a client record that staff maintain in
        // the Command Centre: a background auto-sync must never revert a locally
        // edited address, name, email or phone with a stale GHL value. Only fill
        // fields that are currently blank. New clients (insert path) seed everything.
        const buildNonDestructivePatch = (existing: Record<string, any> | null) => {
          const patch: Record<string, any> = {
            ghl_contact_id: contact.id,
            ghl_sync_status: 'synced',
            ghl_last_synced_at: new Date().toISOString(),
          };
          const candidates: Record<string, any> = {
            primary_first_name: contact.firstName || null,
            primary_surname: contact.lastName || null,
            primary_email: contact.email || null,
            primary_mobile: contact.phone || null,
            current_address: ghlAddress,
            current_suburb: contact.city || null,
            current_state: contact.state || null,
            current_postcode: contact.postalCode || null,
            country: contact.country || null,
          };
          for (const [key, value] of Object.entries(candidates)) {
            if (value === null || value === undefined || value === '') continue;
            const current = existing?.[key];
            if (current === null || current === undefined || current === '') {
              patch[key] = value;
            }
          }
          return patch;
        };

        const EXISTING_COLUMNS =
          'id, primary_first_name, primary_surname, primary_email, primary_mobile, current_address, current_suburb, current_state, current_postcode, country';

        // Check if client already exists by ghl_contact_id first
        const { data: existingByGhlId } = await supabase
          .from('clients')
          .select(EXISTING_COLUMNS)
          .eq('ghl_contact_id', contact.id)
          .maybeSingle();

        if (existingByGhlId) {
          // Update existing client by ghl_contact_id (fill blanks only)
          const { error: updateError } = await supabase
            .from('clients')
            .update(buildNonDestructivePatch(existingByGhlId))
            .eq('id', existingByGhlId.id);

          if (updateError) {
            console.error(`Error updating client ${contact.id}:`, updateError);
            errors.push(`Contact ${contact.id}: ${updateError.message}`);
            totalErrors++;
          } else {
            savedCount++;
          }
          continue;
        }

        // Check if client exists by email (to prevent GHL duplicates)
        if (contact.email) {
          const { data: existingByEmail } = await supabase
            .from('clients')
            .select(`${EXISTING_COLUMNS}, ghl_contact_id`)
            .eq('primary_email', contact.email)
            .maybeSingle();

          if (existingByEmail) {
            // Adopt the newer ghl_contact_id but never clobber local field values
            console.log(`Found existing client with email ${contact.email}, updating ghl_contact_id from ${(existingByEmail as any).ghl_contact_id} to ${contact.id}`);
            const { error: updateError } = await supabase
              .from('clients')
              .update(buildNonDestructivePatch(existingByEmail))
              .eq('id', existingByEmail.id);

            if (updateError) {
              console.error(`Error updating client by email ${contact.email}:`, updateError);
              errors.push(`Contact ${contact.id}: ${updateError.message}`);
              totalErrors++;
            } else {
              savedCount++;
            }
            continue;
          }
        }


        // Insert new client
        const { data: insertedClient, error: insertError } = await supabase
          .from('clients')
          .insert(clientData)
          .select('id')
          .single();

        if (insertError) {
          console.error(`Error inserting client ${contact.id}:`, insertError);
          errors.push(`Contact ${contact.id}: ${insertError.message}`);
          totalErrors++;
        } else {
          savedCount++;
          
          // Extract UTM attribution data from GHL custom fields
          const utmSource = contact.customFields?.find((f: any) => f.key === 'utm_source' || f.id === 'utm_source')?.value 
            || contact.source || null;
          const utmMedium = contact.customFields?.find((f: any) => f.key === 'utm_medium' || f.id === 'utm_medium')?.value || null;
          const utmCampaign = contact.customFields?.find((f: any) => f.key === 'utm_campaign' || f.id === 'utm_campaign')?.value || null;
          const utmContent = contact.customFields?.find((f: any) => f.key === 'utm_content' || f.id === 'utm_content')?.value || null;
          const utmTerm = contact.customFields?.find((f: any) => f.key === 'utm_term' || f.id === 'utm_term')?.value || null;
          
          if (insertedClient?.id && (utmSource || utmMedium || utmCampaign || utmContent || contact.source)) {
            const attributionData = {
              client_id: insertedClient.id,
              utm_source: utmSource,
              utm_medium: utmMedium,
              utm_campaign: utmCampaign,
              utm_content: utmContent,
              utm_term: utmTerm,
              source_type: 'webhook_auto',
              ghl_contact_id: contact.id,
              attributed_at: contact.dateAdded || new Date().toISOString(),
            };
            
            const { error: attrError } = await supabase
              .from('lead_source_attributions')
              .insert(attributionData);
            
            if (attrError) {
              console.warn(`Failed to save attribution for client ${insertedClient.id}:`, attrError.message);
            }
          }
        }
      }

      totalImported += savedCount;
      console.log(`Saved page ${pageCount}: ${savedCount} clients (total: ${totalImported})`)

      const nextStartAfter = data.meta?.startAfter ?? null;
      const nextStartAfterId = data.meta?.startAfterId ?? null;

      // Safety: if API returns the same cursor, stop to prevent infinite loops
      if (nextStartAfter === startAfter && nextStartAfterId === startAfterId) {
        console.warn(
          `Pagination cursor did not advance (startAfter=${startAfter}, startAfterId=${startAfterId}). Stopping to prevent infinite loop.`,
        );
        startAfter = null;
        startAfterId = null;
        break;
      }

      startAfter = nextStartAfter;
      startAfterId = nextStartAfterId;

      // If API doesn't provide a next cursor, we're done
      if (startAfter === null && !startAfterId) {
        console.log('Reached end of contacts (no next cursor)');
        break;
      }

      console.log(`Next page cursor: startAfter=${startAfter ?? 'null'}, startAfterId=${startAfterId ?? 'null'}`);
    }

    const hasMore = !!startAfterId || typeof startAfter === 'number';

    console.log(
      `Batch complete. Imported: ${totalImported}, Errors: ${totalErrors}, Has more: ${hasMore}, Next cursor: startAfter=${startAfter ?? 'null'}, startAfterId=${startAfterId ?? 'null'}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: hasMore
          ? `Imported ${totalImported} clients. More contacts available...`
          : `Import complete! Imported ${totalImported} clients.`,
        stats: {
          imported: totalImported,
          errors: totalErrors,
          totalFromApi,
          pagesProcessed: pageCount,
        },
        hasMore,
        nextResumeId: startAfterId,
        nextResume: startAfter,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );

  } catch (error) {
    console.error('Error in import-clients-from-ghl:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'import-clients-from-ghl'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
