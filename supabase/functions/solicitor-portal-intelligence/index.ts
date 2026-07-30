/**
 * Solicitor Portal — Matter Intelligence (Phase 7)
 *
 * Portal-facing pipeline board, portfolio KPIs, at-risk detection and the AI
 * contract analyser. Every operation resolves the caller's session, their
 * assigned clients AND their firm before touching a row, then gates on the
 * merged permission matrix ('matters' for the board/KPIs, 'contract' for the
 * analyser). No financial-position or AML-restricted data is ever selected.
 *
 * AI output is always stored as a DRAFT and must be confirmed by a human before
 * it is treated as reviewed — nothing is auto-applied to the matter.
 *
 * Operations
 *   pipeline_board | move_matter | portfolio_kpis | at_risk_matters
 *   list_analyses | analyse_contract | set_analysis_status | delete_analysis
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders } from "../_shared/auth.ts";
import { csrfDenied, enforceCsrf } from "../_shared/csrfGuard.ts";
import {
  resolveSolicitorSession,
  resolveClientPermissions,
  listAssignedClientIds,
  logSolicitorActivity,
  requestIp,
  can,
  type PermissionMatrix,
} from "../_shared/solicitorPortalAuth.ts";
import { MATTER_SELECT, LEGAL_MATTER_STATUSES, cleanEnum, cleanText } from "../_shared/legalMatters.ts";
import { LEGAL_DOCUMENT_BUCKET } from "../_shared/legalDocuments.ts";
import {
  CONTRACT_ANALYSIS_SELECT,
  CONTRACT_ANALYSIS_STATUSES,
  CONTRACT_ANALYSIS_SYSTEM_PROMPT,
  CONTRACT_ANALYSIS_TOOL,
  PIPELINE_STAGES,
  assessMatterRisk,
  buildPipelineBoard,
  computePortfolioKpis,
  normaliseAnalysisPayload,
} from "../_shared/legalIntelligence.ts";

const MODEL = "google/gemini-3.6-flash";
const MAX_CONTRACT_CHARS = 240_000;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, any>));
    const operation = String(body.operation || '');

    const session = await resolveSolicitorSession(supabase, req.headers, body);
    if (!session.ok || !session.user) {
      return json({ error: session.error || 'Unauthorised' }, session.status || 401);
    }
    const me = session.user;
    const ip = requestIp(req);
    const userAgent = req.headers.get('user-agent');

    const assignedClientIds = await listAssignedClientIds(supabase, me.id);

    /** Load a matter and confirm this solicitor may see it. */
    const loadMatter = async (matterId: string): Promise<
      { ok: true; matter: any; perms: PermissionMatrix } | { ok: false; status: number; error: string }
    > => {
      if (!matterId) return { ok: false, status: 400, error: 'matter_id is required' };
      const { data: matter } = await supabase
        .from('legal_matters')
        .select(MATTER_SELECT)
        .eq('id', matterId)
        .maybeSingle();
      if (!matter) return { ok: false, status: 404, error: 'Matter not found' };
      if (matter.firm_id && matter.firm_id !== me.firm_id) {
        return { ok: false, status: 403, error: 'This matter belongs to another practice' };
      }
      if (!matter.client_id || !assignedClientIds.includes(matter.client_id)) {
        return { ok: false, status: 403, error: 'You do not have access to this matter' };
      }
      const perms = await resolveClientPermissions(supabase, me.id, matter.client_id);
      if (!perms || !can(perms, 'matters', 'view')) {
        return { ok: false, status: 403, error: 'You do not have access to this matter' };
      }
      return { ok: true, matter, perms };
    };

    /** All matters this solicitor may see, with client display names attached. */
    const loadVisibleMatters = async () => {
      if (!assignedClientIds.length) return [] as any[];
      const { data, error } = await supabase
        .from('legal_matters')
        .select(MATTER_SELECT)
        .in('client_id', assignedClientIds)
        .or(`firm_id.is.null,firm_id.eq.${me.firm_id}`)
        .limit(1000);
      if (error) throw error;
      const rows = data || [];
      const clientIds = Array.from(new Set(rows.map((r: any) => r.client_id).filter(Boolean)));
      const clientMap = new Map<string, string>();
      if (clientIds.length) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id, primary_first_name, primary_surname')
          .in('id', clientIds);
        for (const c of clients || []) {
          clientMap.set(c.id, [c.primary_first_name, c.primary_surname].filter(Boolean).join(' '));
        }
      }
      return rows.map((r: any) => ({ ...r, client_name: clientMap.get(r.client_id) ?? null }));
    };

    // ───────────────────── PIPELINE BOARD ─────────────────────
    if (operation === 'pipeline_board') {
      const matters = await loadVisibleMatters();
      const filtered = body.mine_only === true
        ? matters.filter((m: any) => m.assigned_solicitor_user_id === me.id)
        : matters;
      const assessments = filtered.map((m: any) => assessMatterRisk(m));
      const lanes = buildPipelineBoard(filtered, assessments);
      return json({
        success: true,
        stages: PIPELINE_STAGES,
        lanes,
        matters: filtered,
        risk: assessments,
      });
    }

    if (operation === 'move_matter') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { matter, perms } = res;
      if (!can(perms, 'matters', 'edit')) {
        return json({ error: 'You do not have permission to move this matter' }, 403);
      }

      const status = cleanEnum(body.status, LEGAL_MATTER_STATUSES);
      if (!status) return json({ error: 'A valid status is required' }, 400);
      const rawPosition = Number(body.position);
      const position = Number.isFinite(rawPosition)
        ? Math.max(0, Math.min(9999, Math.round(rawPosition)))
        : 0;

      const { data: updated, error } = await supabase
        .from('legal_matters')
        .update({ status, kanban_position: position, updated_at: new Date().toISOString() })
        .eq('id', matter.id)
        .select(MATTER_SELECT)
        .maybeSingle();
      if (error) throw error;

      if (matter.status !== status) {
        await supabase.from('legal_matter_status_history').insert({
          legal_matter_id: matter.id,
          from_status: matter.status,
          to_status: status,
          changed_by_type: 'solicitor_user',
          changed_by_solicitor_user_id: me.id,
          reason: cleanText(body.reason, 500) ?? 'Moved on the pipeline board',
        });
      }

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id,
        firm_id: me.firm_id,
        action: 'matter_pipeline_move',
        client_id: matter.client_id,
        legal_matter_id: matter.id,
        entity_type: 'legal_matter',
        entity_id: matter.id,
        metadata: { from: matter.status, to: status, position },
        ip_address: ip,
        user_agent: userAgent,
      });

      return json({ success: true, record: updated });
    }

    // ───────────────────── KPIs / AT RISK ─────────────────────
    if (operation === 'portfolio_kpis' || operation === 'at_risk_matters') {
      const matters = await loadVisibleMatters();
      const scoped = body.mine_only === true
        ? matters.filter((m: any) => m.assigned_solicitor_user_id === me.id)
        : matters;
      const assessments = scoped.map((m: any) => assessMatterRisk(m));

      if (operation === 'at_risk_matters') {
        const byId = new Map(scoped.map((m: any) => [String(m.id), m]));
        const records = assessments
          .filter((a) => a.level !== 'ok')
          .sort((a, b) => b.score - a.score)
          .slice(0, Number(body.limit) > 0 ? Math.min(50, Number(body.limit)) : 25)
          .map((a) => ({ ...a, matter: byId.get(a.matter_id) ?? null }));
        return json({ success: true, records });
      }

      return json({
        success: true,
        kpis: computePortfolioKpis(scoped, assessments),
        risk: assessments,
      });
    }

    // ───────────────────── CONTRACT ANALYSES ─────────────────────
    if (operation === 'list_analyses') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'contract', 'view')) {
        return json({ error: 'You do not have access to contract intelligence' }, 403);
      }
      const { data, error } = await supabase
        .from('legal_contract_analyses')
        .select(CONTRACT_ANALYSIS_SELECT)
        .eq('legal_matter_id', res.matter.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return json({ success: true, records: data || [] });
    }

    if (operation === 'analyse_contract') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { matter, perms } = res;
      if (!can(perms, 'contract', 'edit')) {
        return json({ error: 'You do not have permission to run contract intelligence' }, 403);
      }

      const apiKey = Deno.env.get('LOVABLE_API_KEY');
      if (!apiKey) return json({ error: 'AI is not configured for this project' }, 503);

      let contractText = cleanText(body.contract_text, MAX_CONTRACT_CHARS);
      let documentId: string | null = null;
      let sourceLabel = cleanText(body.source_label, 200);
      const fileParts: any[] = [];

      if (body.document_id) {
        if (!can(perms, 'documents', 'view')) {
          return json({ error: 'You do not have access to matter documents' }, 403);
        }
        const { data: doc } = await supabase
          .from('legal_matter_documents')
          .select('id, legal_matter_id, storage_bucket, storage_path, file_name, mime_type, file_size, label')
          .eq('id', String(body.document_id))
          .maybeSingle();
        if (!doc || doc.legal_matter_id !== matter.id) {
          return json({ error: 'Document not found on this matter' }, 404);
        }
        if (!doc.storage_path) return json({ error: 'That document has no uploaded file yet' }, 400);
        if (Number(doc.file_size) > MAX_DOCUMENT_BYTES) {
          return json({ error: 'That file is too large to analyse. Paste the relevant clauses instead.' }, 413);
        }

        const { data: file, error: dlError } = await supabase.storage
          .from(doc.storage_bucket || LEGAL_DOCUMENT_BUCKET)
          .download(doc.storage_path);
        if (dlError || !file) return json({ error: 'Could not read that document from storage' }, 502);

        const mime = String(doc.mime_type || '').toLowerCase();
        documentId = doc.id;
        sourceLabel = sourceLabel ?? cleanText(doc.label || doc.file_name, 200);

        if (mime.startsWith('text/') || mime === 'application/json') {
          contractText = (await file.text()).slice(0, MAX_CONTRACT_CHARS);
        } else {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          const dataUrl = `data:${mime || 'application/pdf'};base64,${btoa(binary)}`;
          if (mime.startsWith('image/')) {
            fileParts.push({ type: 'image_url', image_url: { url: dataUrl } });
          } else if (mime === 'application/pdf') {
            fileParts.push({ type: 'file', file: { filename: doc.file_name || 'contract.pdf', file_data: dataUrl } });
          } else {
            return json({
              error: 'Only PDF, image or text documents can be analysed. Paste the contract text instead.',
            }, 415);
          }
        }
      }

      if (!contractText && !fileParts.length) {
        return json({ error: 'Provide contract text or choose an uploaded document' }, 400);
      }

      const contextLines = [
        `Matter: ${matter.title ?? matter.matter_reference ?? matter.id}`,
        matter.matter_type ? `Matter type: ${matter.matter_type}` : null,
        matter.property_address
          ? `Property: ${[matter.property_address, matter.property_suburb, matter.property_state, matter.property_postcode].filter(Boolean).join(', ')}`
          : null,
        matter.property_state ? `Jurisdiction: ${matter.property_state}` : null,
      ].filter(Boolean).join('\n');

      const userContent: any[] = [
        {
          type: 'text',
          text: [
            'Review the following Australian contract of sale and record a structured analysis.',
            '',
            contextLines,
            '',
            contractText ? `Contract text:\n${contractText}` : 'The contract is supplied as an attached file.',
          ].join('\n'),
        },
        ...fileParts,
      ];

      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: CONTRACT_ANALYSIS_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          tools: [CONTRACT_ANALYSIS_TOOL],
          tool_choice: { type: 'function', function: { name: CONTRACT_ANALYSIS_TOOL.function.name } },
        }),
      });

      if (aiResponse.status === 429) {
        return json({ error: 'AI rate limit reached. Please try again in a moment.' }, 429);
      }
      if (aiResponse.status === 402) {
        return json({ error: 'AI credits exhausted. Add credits to continue using contract intelligence.' }, 402);
      }
      if (!aiResponse.ok) {
        const detail = await aiResponse.text();
        console.error('[solicitor-portal-intelligence] AI gateway error', aiResponse.status, detail.slice(0, 500));
        return json({ error: 'The contract analyser could not process that document.' }, 502);
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) return json({ error: 'The analyser returned no structured result. Try again.' }, 502);

      let parsed: any;
      try {
        parsed = JSON.parse(toolCall.function.arguments);
      } catch {
        return json({ error: 'The analyser returned an unreadable result. Try again.' }, 502);
      }
      const payload = normaliseAnalysisPayload(parsed);

      const { data: inserted, error: insertError } = await supabase
        .from('legal_contract_analyses')
        .insert({
          legal_matter_id: matter.id,
          firm_id: me.firm_id,
          document_id: documentId,
          source_label: sourceLabel ?? 'Pasted contract text',
          status: 'draft',
          model: MODEL,
          summary: payload.summary,
          parties: payload.parties,
          key_dates: payload.key_dates,
          special_conditions: payload.special_conditions,
          risk_flags: payload.risk_flags,
          financials: payload.financials,
          confidence: payload.confidence,
          created_by_type: 'solicitor_user',
          created_by_solicitor_user_id: me.id,
        })
        .select(CONTRACT_ANALYSIS_SELECT)
        .maybeSingle();
      if (insertError) throw insertError;

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id,
        firm_id: me.firm_id,
        action: 'contract_analysis_generated',
        client_id: matter.client_id,
        legal_matter_id: matter.id,
        entity_type: 'legal_contract_analysis',
        entity_id: inserted?.id ?? null,
        metadata: {
          document_id: documentId,
          model: MODEL,
          conditions: payload.special_conditions.length,
          risks: payload.risk_flags.length,
        },
        ip_address: ip,
        user_agent: userAgent,
      });

      return json({ success: true, record: inserted });
    }

    if (operation === 'set_analysis_status') {
      const status = cleanEnum(body.status, CONTRACT_ANALYSIS_STATUSES);
      if (!status) return json({ error: 'A valid status is required' }, 400);

      const { data: analysis } = await supabase
        .from('legal_contract_analyses')
        .select('id, legal_matter_id')
        .eq('id', String(body.analysis_id || ''))
        .maybeSingle();
      if (!analysis) return json({ error: 'Analysis not found' }, 404);

      const res = await loadMatter(analysis.legal_matter_id);
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'contract', 'edit')) {
        return json({ error: 'You do not have permission to review contract intelligence' }, 403);
      }

      const { data: updated, error } = await supabase
        .from('legal_contract_analyses')
        .update({
          status,
          review_notes: cleanText(body.review_notes, 2000),
          confirmed_at: status === 'confirmed' ? new Date().toISOString() : null,
          confirmed_by_type: status === 'confirmed' ? 'solicitor_user' : null,
          confirmed_by_id: status === 'confirmed' ? me.id : null,
        })
        .eq('id', analysis.id)
        .select(CONTRACT_ANALYSIS_SELECT)
        .maybeSingle();
      if (error) throw error;

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id,
        firm_id: me.firm_id,
        action: `contract_analysis_${status}`,
        client_id: res.matter.client_id,
        legal_matter_id: res.matter.id,
        entity_type: 'legal_contract_analysis',
        entity_id: analysis.id,
        ip_address: ip,
        user_agent: userAgent,
      });

      return json({ success: true, record: updated });
    }

    if (operation === 'delete_analysis') {
      const { data: analysis } = await supabase
        .from('legal_contract_analyses')
        .select('id, legal_matter_id')
        .eq('id', String(body.analysis_id || ''))
        .maybeSingle();
      if (!analysis) return json({ error: 'Analysis not found' }, 404);

      const res = await loadMatter(analysis.legal_matter_id);
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'contract', 'delete')) {
        return json({ error: 'You do not have permission to delete contract intelligence' }, 403);
      }

      const { error } = await supabase.from('legal_contract_analyses').delete().eq('id', analysis.id);
      if (error) throw error;

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id,
        firm_id: me.firm_id,
        action: 'contract_analysis_deleted',
        client_id: res.matter.client_id,
        legal_matter_id: res.matter.id,
        entity_type: 'legal_contract_analysis',
        entity_id: analysis.id,
        ip_address: ip,
        user_agent: userAgent,
      });

      return json({ success: true });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (error: any) {
    console.error('[solicitor-portal-intelligence] error:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
