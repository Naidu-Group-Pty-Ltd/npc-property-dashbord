import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getEffectiveGhlCredentials } from '../_shared/ghl-account.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

interface GHLOpportunity {
  id: string;
  name: string;
  monetaryValue: number;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  contact: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  };
  notes?: string;
  createdAt: string;
  updatedAt: string;
  followUpDate?: string;
  customFields?: Array<{
    id: string;
    key?: string;
    value: any;
  }>;
}

interface GHLPipeline {
  id: string;
  name: string;
  stages: Array<{
    id: string;
    name: string;
    position: number;
  }>;
}

interface GHLOpportunitiesResponse {
  opportunities: GHLOpportunity[];
  meta: {
    total: number;
    nextPageUrl?: string;
    startAfterId?: string;
    startAfter?: number;
  };
}

// Default colors for pipeline stages based on position
const STAGE_COLORS = [
  '#6B7280', // gray
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#A855F7', // purple
  '#EC4899', // pink
  '#EF4444', // red
  '#F97316', // orange
  '#F59E0B', // amber
  '#EAB308', // yellow
  '#84CC16', // lime
  '#22C55E', // green
  '#14B8A6', // teal
  '#06B6D4', // cyan
];

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
    // Capture run start so we can purge any rows not touched by this sync
    const syncRunStartedAt = new Date().toISOString();
    const _ghlCreds = await getEffectiveGhlCredentials(supabase);
    const apiKey = _ghlCreds.apiKey;
    const locationId = _ghlCreds.locationId;
    console.log(`[sync-ghl-pipelines] Using GHL account: ${_ghlCreds.label}`);
    
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
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[sync-ghl-pipelines] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[sync-ghl-pipelines] Authenticated user: ${userId}`);

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
    };

    console.log('Fetching GHL pipelines...');

    // Step 1: Fetch all pipelines from GHL
    const pipelinesResponse = await fetch(
      `${GHL_API_BASE}/opportunities/pipelines?locationId=${locationId}`,
      { headers }
    );

    if (!pipelinesResponse.ok) {
      const errorText = await pipelinesResponse.text();
      console.error(`GHL pipelines API error: ${pipelinesResponse.status} - ${errorText}`);
      throw new Error(`GHL API error: ${pipelinesResponse.status} - ${errorText}`);
    }

    const pipelinesData = await pipelinesResponse.json();
    const ghlPipelines: GHLPipeline[] = pipelinesData.pipelines || [];
    console.log(`Found ${ghlPipelines.length} pipelines from GHL`);

    // Step 2: Sync pipelines to database
    const pipelineIdMap: Record<string, string> = {}; // ghl_id -> supabase uuid
    const stageIdMap: Record<string, { uuid: string; stageName: string; pipelineName: string; pipelineUuid: string; pipelinePosition: number; stagePosition: number }> = {};

    for (let pIdx = 0; pIdx < ghlPipelines.length; pIdx++) {
      const pipeline = ghlPipelines[pIdx];
      
      // Upsert pipeline
      const { data: pipelineData, error: pipelineError } = await supabase
        .from('ghl_pipelines')
        .upsert({
          ghl_id: pipeline.id,
          name: pipeline.name,
          position: pIdx,
          location_id: locationId,
          is_active: true,
          synced_at: new Date().toISOString(),
        }, { onConflict: 'ghl_id' })
        .select('id')
        .single();

      if (pipelineError) {
        console.error(`Error upserting pipeline ${pipeline.name}:`, pipelineError);
        continue;
      }

      const pipelineUuid = pipelineData.id;
      pipelineIdMap[pipeline.id] = pipelineUuid;
      console.log(`Synced pipeline: ${pipeline.name} (${pipeline.id}) -> ${pipelineUuid}`);

      // Upsert stages for this pipeline
      for (const stage of pipeline.stages || []) {
        const colorIndex = stage.position % STAGE_COLORS.length;
        
        const { data: stageData, error: stageError } = await supabase
          .from('ghl_pipeline_stages')
          .upsert({
            ghl_id: stage.id,
            pipeline_id: pipelineUuid,
            name: stage.name,
            position: stage.position,
            color: STAGE_COLORS[colorIndex],
            synced_at: new Date().toISOString(),
          }, { onConflict: 'ghl_id' })
          .select('id')
          .single();

        if (stageError) {
          console.error(`Error upserting stage ${stage.name}:`, stageError);
          continue;
        }

        stageIdMap[stage.id] = {
          uuid: stageData.id,
          stageName: stage.name,
          pipelineName: pipeline.name,
          pipelineUuid: pipelineUuid,
          pipelinePosition: pIdx,
          stagePosition: stage.position,
        };
      }
    }

    console.log(`Synced ${Object.keys(stageIdMap).length} pipeline stages to database`);

    // Purge stale pipelines & stages from previous accounts/locations or removed in GHL.
    // Anything not touched by this run is stale.
    let stalePipelinesDeleted = 0;
    let staleStagesDeleted = 0;
    try {
      const { data: deletedStages } = await supabase
        .from('ghl_pipeline_stages')
        .delete()
        .lt('synced_at', syncRunStartedAt)
        .select('id');
      staleStagesDeleted = deletedStages?.length || 0;

      const { data: deletedPipelines } = await supabase
        .from('ghl_pipelines')
        .delete()
        .lt('synced_at', syncRunStartedAt)
        .select('id');
      stalePipelinesDeleted = deletedPipelines?.length || 0;
      console.log(`Purged ${stalePipelinesDeleted} stale pipelines and ${staleStagesDeleted} stale stages`);
    } catch (e) {
      console.error('Stale pipeline purge failed:', e);
    }

    // Step 3: Fetch all opportunities from GHL - increased limit to ensure all are fetched
    let allOpportunities: GHLOpportunity[] = [];
    let startAfterId: string | null = null;
    let startAfter: number | null = null;
    let pageCount = 0;
    const maxPages = 50; // Increased from 20 to handle more opportunities (up to 5000)

    while (pageCount < maxPages) {
      pageCount++;

      // GHL v2021-07-28 opportunities/search uses GET with query params.
      // POST body validation rejects startAfterId/startAfter as "unknown properties".
      const params = new URLSearchParams({
        location_id: locationId,
        limit: '100',
      });
      if (startAfterId) params.set('startAfterId', startAfterId);
      if (startAfter) params.set('startAfter', String(startAfter));

      const searchUrl = `${GHL_API_BASE}/opportunities/search?${params.toString()}`;
      console.log(`Fetching opportunities page ${pageCount} via GET to ${searchUrl}`);

      const oppResponse = await fetch(searchUrl, {
        method: 'GET',
        headers,
      });

      if (!oppResponse.ok) {
        const errorText = await oppResponse.text();
        console.error(`GHL opportunities SEARCH error: ${oppResponse.status} - ${errorText}`);
        throw new Error(`GHL API error: ${oppResponse.status} - ${errorText}`);
      }

      const oppData: GHLOpportunitiesResponse = await oppResponse.json();
      const opportunities = oppData.opportunities || [];

      console.log(`Received ${opportunities.length} opportunities on page ${pageCount} (meta.total: ${oppData.meta?.total ?? 'n/a'})`);

      if (opportunities.length === 0) break;

      allOpportunities = [...allOpportunities, ...opportunities];

      // Check for pagination (GHL may return either cursor fields or nextPageUrl)
      let advanced = false;

      if (oppData.meta?.nextPageUrl) {
        // Some responses provide a fully qualified URL; others may be relative.
        const nextUrl = oppData.meta.nextPageUrl.startsWith('http')
          ? oppData.meta.nextPageUrl
          : `${GHL_API_BASE}${oppData.meta.nextPageUrl}`;

        startAfterId = null;
        startAfter = null;

        try {
          const parsed = new URL(nextUrl);
          startAfterId = parsed.searchParams.get('startAfterId');
          const startAfterStr = parsed.searchParams.get('startAfter');
          startAfter = startAfterStr ? Number(startAfterStr) : null;
          if (startAfterId || startAfter) advanced = true;
        } catch (_e) {
          advanced = false;
        }
      }

      if (!advanced && oppData.meta?.startAfterId) {
        startAfterId = oppData.meta.startAfterId;
        startAfter = oppData.meta.startAfter || null;
        advanced = true;
      }

      // FALLBACK: GHL sometimes omits pagination metadata even when more pages exist.
      // If we received a full page (>=limit) but no cursor was provided, manually
      // construct cursor from the last opportunity (id + createdAt epoch ms).
      if (!advanced && opportunities.length >= 100) {
        const last = opportunities[opportunities.length - 1];
        const lastCreatedMs = last.createdAt ? new Date(last.createdAt).getTime() : null;
        if (last?.id && lastCreatedMs) {
          startAfterId = last.id;
          startAfter = lastCreatedMs;
          advanced = true;
          console.log(`Pagination meta missing — falling back to manual cursor: startAfterId=${startAfterId}, startAfter=${startAfter}`);
        }
      }

      if (!advanced) break;
      // Stop early if we've collected everything GHL says exists
      if (oppData.meta?.total && allOpportunities.length >= oppData.meta.total) {
        console.log(`Collected ${allOpportunities.length} >= meta.total ${oppData.meta.total}, stopping.`);
        break;
      }
    }

    console.log(`========================================`);
    console.log(`SYNC SUMMARY - OPPORTUNITIES FROM GHL`);
    console.log(`========================================`);
    console.log(`Total opportunities fetched from GHL: ${allOpportunities.length}`);
    console.log(`Pages fetched: ${pageCount}`);
    
    // Count opportunities by pipeline for debugging
    const oppByPipeline: Record<string, number> = {};
    const oppByStage: Record<string, number> = {};
    for (const opp of allOpportunities) {
      const pipelineInfo = pipelineIdMap[opp.pipelineId] ? ghlPipelines.find(p => p.id === opp.pipelineId)?.name : opp.pipelineId;
      const stageInfo = stageIdMap[opp.pipelineStageId];
      const pipelineName = pipelineInfo || 'Unknown Pipeline';
      const stageName = stageInfo?.stageName || 'Unknown Stage';
      
      oppByPipeline[pipelineName] = (oppByPipeline[pipelineName] || 0) + 1;
      oppByStage[`${pipelineName} / ${stageName}`] = (oppByStage[`${pipelineName} / ${stageName}`] || 0) + 1;
    }
    
    console.log(`Opportunities by pipeline:`);
    for (const [pipeline, count] of Object.entries(oppByPipeline)) {
      console.log(`  - ${pipeline}: ${count}`);
    }
    
    console.log(`Opportunities by stage (top 20):`);
    const sortedStages = Object.entries(oppByStage).sort((a, b) => b[1] - a[1]).slice(0, 20);
    for (const [stage, count] of sortedStages) {
      console.log(`  - ${stage}: ${count}`);
    }

    // Step 4: Store ALL opportunities in ghl_client_opportunities table
    // Also track the "best" opportunity per contact for the legacy clients table fields
    const contactBestOpportunity: Record<string, { 
      opp: GHLOpportunity; 
      pipelinePosition: number; 
      stagePosition: number;
    }> = {};

    // Group all opportunities by contact for bulk processing
    const contactAllOpportunities: Record<string, GHLOpportunity[]> = {};

    for (const opp of allOpportunities) {
      const contactId = opp.contact?.id;
      if (!contactId) {
        console.log(`Opportunity ${opp.id} has no contact, skipping`);
        continue;
      }

      // Track all opportunities per contact
      if (!contactAllOpportunities[contactId]) {
        contactAllOpportunities[contactId] = [];
      }
      contactAllOpportunities[contactId].push(opp);

      // Track best opportunity for legacy client table update
      const stageInfo = stageIdMap[opp.pipelineStageId];
      const pipelinePosition = stageInfo?.pipelinePosition ?? -1;
      const stagePosition = stageInfo?.stagePosition ?? -1;

      const existing = contactBestOpportunity[contactId];
      const shouldReplace = !existing || 
        pipelinePosition > existing.pipelinePosition ||
        (pipelinePosition === existing.pipelinePosition && stagePosition > existing.stagePosition);

      if (shouldReplace) {
        contactBestOpportunity[contactId] = { opp, pipelinePosition, stagePosition };
      }
    }

    const uniqueContacts = Object.keys(contactAllOpportunities).length;
    const totalOpps = allOpportunities.length;
    console.log(`========================================`);
    console.log(`OPPORTUNITY MAPPING`);
    console.log(`========================================`);
    console.log(`Total opportunities: ${totalOpps}`);
    console.log(`Unique contacts with opportunities: ${uniqueContacts}`);
    console.log(`========================================`);

    // Step 5: Upsert ALL opportunities into ghl_client_opportunities table
    let opportunitiesUpserted = 0;
    let opportunitiesSkipped = 0;

    for (const [contactId, opps] of Object.entries(contactAllOpportunities)) {
      // First find the client by ghl_contact_id
      const { data: clientData, error: clientLookupError } = await supabase
        .from('clients')
        .select('id')
        .eq('ghl_contact_id', contactId)
        .single();

      if (clientLookupError || !clientData) {
        opportunitiesSkipped += opps.length;
        continue;
      }

      for (const opp of opps) {
        const stageInfo = stageIdMap[opp.pipelineStageId];
        
        const oppRecord: Record<string, any> = {
          client_id: clientData.id,
          ghl_opportunity_id: opp.id,
          ghl_contact_id: contactId,
          pipeline_id: stageInfo?.pipelineUuid || pipelineIdMap[opp.pipelineId] || null,
          stage_id: stageInfo?.uuid || null,
          pipeline_name: stageInfo?.pipelineName || ghlPipelines.find(p => p.id === opp.pipelineId)?.name || null,
          stage_name: stageInfo?.stageName || opp.status || 'Unknown Stage',
          opportunity_status: opp.status || 'open',
          monetary_value: opp.monetaryValue || 0,
          opportunity_name: opp.name || null,
          follow_up_date: opp.followUpDate || null,
          notes: opp.notes || null,
          custom_fields: opp.customFields ? JSON.stringify(opp.customFields) : null,
          ghl_created_at: opp.createdAt || null,
          ghl_updated_at: opp.updatedAt || null,
          synced_at: new Date().toISOString(),
        };

        const { error: upsertError } = await supabase
          .from('ghl_client_opportunities')
          .upsert(oppRecord, { onConflict: 'client_id,ghl_opportunity_id' });

        if (upsertError) {
          console.error(`Error upserting opportunity ${opp.id}:`, upsertError);
        } else {
          opportunitiesUpserted++;
        }
      }
    }

    console.log(`Opportunities upserted: ${opportunitiesUpserted}, skipped (no client): ${opportunitiesSkipped}`);

    // Step 5b: Purge stale opportunities (legacy rows from old GHL account or deleted opps)
    // Any row not touched by this sync run (synced_at < syncRunStartedAt) no longer exists in GHL.
    let staleOpportunitiesDeleted = 0;
    {
      const { data: deleted, error: purgeError } = await supabase
        .from('ghl_client_opportunities')
        .delete()
        .lt('synced_at', syncRunStartedAt)
        .select('id');
      if (purgeError) {
        console.error('Error purging stale opportunities:', purgeError);
      } else {
        staleOpportunitiesDeleted = deleted?.length || 0;
        console.log(`Purged ${staleOpportunitiesDeleted} stale opportunities not present in current GHL account`);
      }
    }


    // Step 6: Update clients table with the "best" opportunity (legacy fields)
    let updatedCount = 0;
    let notFoundCount = 0;
    const notFoundContacts: string[] = [];

    for (const [contactId, { opp }] of Object.entries(contactBestOpportunity)) {
      const stageInfo = stageIdMap[opp.pipelineStageId];
      const pipelineStatus = stageInfo 
        ? stageInfo.stageName
        : opp.status || 'Unknown Stage';

      let borrowingCapacity: number | null = null;
      let proposedRentalIncome: number | null = null;
      let equityRelease: number | null = null;

      if (opp.customFields) {
        for (const field of opp.customFields) {
          const key = (field.key || '').toLowerCase();
          if (key.includes('borrowing') || key.includes('capacity')) {
            borrowingCapacity = parseFloat(field.value) || null;
          } else if (key.includes('rental') || key.includes('income')) {
            proposedRentalIncome = parseFloat(field.value) || null;
          } else if (key.includes('equity') || key.includes('release')) {
            equityRelease = parseFloat(field.value) || null;
          }
        }
      }

      if (!borrowingCapacity && opp.monetaryValue) {
        borrowingCapacity = opp.monetaryValue;
      }

      const updateData: Record<string, any> = {
        pipeline_status: pipelineStatus,
        pipeline_updated_at: new Date().toISOString(),
        ghl_opportunity_id: opp.id,
        opportunity_status: opp.status || 'open',
      };

      if (stageInfo) {
        updateData.current_pipeline_id = stageInfo.pipelineUuid;
        updateData.current_stage_id = stageInfo.uuid;
      } else if (pipelineIdMap[opp.pipelineId]) {
        updateData.current_pipeline_id = pipelineIdMap[opp.pipelineId];
      }

      if (opp.followUpDate) updateData.follow_up_date = opp.followUpDate;
      if (borrowingCapacity) updateData.borrowing_capacity = borrowingCapacity;
      if (proposedRentalIncome) updateData.proposed_rental_income = proposedRentalIncome;
      if (equityRelease) updateData.equity_release = equityRelease;
      if (opp.notes) updateData.pipeline_notes = opp.notes;

      const { data: updatedClient, error: updateError } = await supabase
        .from('clients')
        .update(updateData)
        .eq('ghl_contact_id', contactId)
        .select('id, primary_first_name, primary_surname')
        .single();

      if (updateError) {
        if (updateError.code === 'PGRST116') {
          notFoundCount++;
          notFoundContacts.push(opp.contact.name || contactId);
        } else {
          console.error(`Error updating client for contact ${contactId}:`, updateError);
        }
      } else {
        updatedCount++;
      }
    }

    console.log(`Pipeline sync complete. Updated: ${updatedCount}, Not found: ${notFoundCount}, Opportunities stored: ${opportunitiesUpserted}`);

    // Build response with full pipeline structure
    const pipelinesWithStages = ghlPipelines.map(p => ({
      id: pipelineIdMap[p.id] || p.id,
      ghl_id: p.id,
      name: p.name,
      stages: (p.stages || []).map(s => ({
        id: stageIdMap[s.id]?.uuid || s.id,
        ghl_id: s.id,
        name: s.name,
        position: s.position,
        color: STAGE_COLORS[s.position % STAGE_COLORS.length],
      })),
    }));

    // Step 6b: Clear stale pipeline fields on clients whose ghl_opportunity_id no longer exists
    let orphanClientsCleared = 0;
    {
      const { data: orphans, error: orphanErr } = await supabase
        .from('clients')
        .update({
          pipeline_status: null,
          ghl_opportunity_id: null,
          opportunity_status: null,
          current_pipeline_id: null,
          current_stage_id: null,
          pipeline_updated_at: new Date().toISOString(),
        })
        .not('ghl_opportunity_id', 'is', null)
        .not('ghl_opportunity_id', 'in', `(${
          allOpportunities.map(o => `"${o.id}"`).join(',') || '""'
        })`)
        .select('id');
      if (orphanErr) {
        console.error('Error clearing orphan client pipeline fields:', orphanErr);
      } else {
        orphanClientsCleared = orphans?.length || 0;
        console.log(`Cleared pipeline fields on ${orphanClientsCleared} orphan clients`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Pipeline sync complete! Synced ${ghlPipelines.length} pipelines, ${opportunitiesUpserted} opportunities stored, ${updatedCount} clients updated, ${staleOpportunitiesDeleted} stale opps purged.`,
        stats: {
          pipelinesFound: ghlPipelines.length,
          stagesSynced: Object.keys(stageIdMap).length,
          opportunitiesFound: allOpportunities.length,
          opportunitiesStored: opportunitiesUpserted,
          opportunitiesSkippedNoClient: opportunitiesSkipped,
          staleOpportunitiesDeleted,
          orphanClientsCleared,
          clientsUpdated: updatedCount,
          contactsNotFound: notFoundCount,
        },
        pipelines: pipelinesWithStages,
        notFoundContacts: notFoundContacts.slice(0, 10),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in sync-ghl-pipelines:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
