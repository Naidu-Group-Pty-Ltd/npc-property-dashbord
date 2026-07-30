/**
 * Solicitor Portal — Documents, searches, requisitions & disbursements (Phase 5)
 *
 * Portal-facing register workspace. Every operation is scoped by the caller's
 * session, their client assignments AND their firm, then gated on the merged
 * permission matrix. Financial-position and AML-restricted data is never
 * selected here — tri-portal separation is enforced by the shared whitelists.
 *
 * Operations
 *   list_registers
 *   upsert_document | request_document | upload_url | attach_upload
 *   set_document_status | download_url | delete_document
 *   upsert_search | delete_search
 *   upsert_requisition | delete_requisition
 *   upsert_disbursement | delete_disbursement
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  resolveSolicitorSession,
  resolveClientPermissions,
  listAssignedClientIds,
  logSolicitorActivity,
  requestIp,
  can,
  type PermissionMatrix,
} from "../_shared/solicitorPortalAuth.ts";
import { cleanEnum, cleanText } from "../_shared/legalMatters.ts";
import {
  LEGAL_DOCUMENT_BUCKET,
  LEGAL_DOCUMENT_STATUSES,
  DOCUMENT_SELECT,
  SEARCH_SELECT,
  REQUISITION_SELECT,
  DISBURSEMENT_SELECT,
  buildDocumentPayload,
  buildSearchPayload,
  buildRequisitionPayload,
  buildDisbursementPayload,
  buildStoragePath,
  isAllowedMime,
  isAllowedSize,
  safeFileName,
  summariseRegisters,
} from "../_shared/legalDocuments.ts";

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
        .select('id, client_id, firm_id, title, status')
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

    const audit = (
      matter: any,
      action: string,
      entityType: string,
      entityId: string | null,
      metadata?: Record<string, unknown>,
    ) => logSolicitorActivity(supabase, {
      solicitor_user_id: me.id, firm_id: me.firm_id, action,
      client_id: matter.client_id, legal_matter_id: matter.id,
      entity_type: entityType, entity_id: entityId,
      metadata: metadata ?? null, ip_address: ip, user_agent: userAgent,
    });

    // ───────────────────────── REGISTERS ─────────────────────────
    if (operation === 'list_registers') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { matter, perms } = res;

      const canDocs = can(perms, 'documents', 'view');
      const canSearches = can(perms, 'searches', 'view');
      const canDisb = can(perms, 'disbursements', 'view');

      const [{ data: documents }, { data: searches }, { data: requisitions }, { data: disbursements }] =
        await Promise.all([
          canDocs
            ? supabase.from('legal_matter_documents').select(DOCUMENT_SELECT)
                .eq('legal_matter_id', matter.id)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: [] as any[] }),
          canSearches
            ? supabase.from('legal_matter_searches').select(SEARCH_SELECT)
                .eq('legal_matter_id', matter.id)
                .order('created_at', { ascending: true })
            : Promise.resolve({ data: [] as any[] }),
          canSearches
            ? supabase.from('legal_matter_requisitions').select(REQUISITION_SELECT)
                .eq('legal_matter_id', matter.id)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: [] as any[] }),
          canDisb
            ? supabase.from('legal_matter_disbursements').select(DISBURSEMENT_SELECT)
                .eq('legal_matter_id', matter.id)
                .order('created_at', { ascending: true })
            : Promise.resolve({ data: [] as any[] }),
        ]);

      return json({
        success: true,
        documents: documents || [],
        searches: searches || [],
        requisitions: requisitions || [],
        disbursements: disbursements || [],
        summary: summariseRegisters(
          (documents || []) as any[], (searches || []) as any[],
          (requisitions || []) as any[], (disbursements || []) as any[],
        ),
        permissions: perms,
      });
    }

    // ───────────────────────── DOCUMENTS ─────────────────────────
    if (operation === 'upsert_document' || operation === 'request_document') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'documents', 'edit')) {
        return json({ error: 'You do not have permission to manage documents' }, 403);
      }
      const isCreate = !body.document_id;
      const payload = buildDocumentPayload(body, { isCreate });
      if (isCreate && !payload.label) return json({ error: 'A label is required' }, 400);

      let record: any;
      if (isCreate) {
        const insert: Record<string, unknown> = {
          ...payload,
          legal_matter_id: res.matter.id,
          client_id: res.matter.client_id,
          firm_id: me.firm_id,
          status: 'requested',
          requested_at: new Date().toISOString(),
          source: operation === 'request_document' ? 'requested' : 'manual',
        };
        const { data, error } = await supabase.from('legal_matter_documents')
          .insert(insert).select(DOCUMENT_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      } else {
        const { data, error } = await supabase.from('legal_matter_documents')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', body.document_id).eq('legal_matter_id', res.matter.id)
          .select(DOCUMENT_SELECT).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Document not found' }, 404);
        record = data;
      }

      await audit(
        res.matter,
        isCreate ? 'matter_document_requested' : 'matter_document_updated',
        'legal_matter_document', record?.id ?? null,
        { label: record?.label ?? null, category: record?.category ?? null },
      );
      return json({ success: true, record });
    }

    if (operation === 'upload_url') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'documents', 'edit')) {
        return json({ error: 'You do not have permission to upload documents' }, 403);
      }
      const documentId = String(body.document_id || '');
      if (!documentId) return json({ error: 'document_id is required' }, 400);
      if (!isAllowedMime(body.mime_type)) {
        return json({ error: 'That file type is not accepted' }, 400);
      }
      if (!isAllowedSize(body.file_size)) {
        return json({ error: 'Files must be between 1 byte and 50 MB' }, 400);
      }

      const { data: doc } = await supabase.from('legal_matter_documents')
        .select('id').eq('id', documentId).eq('legal_matter_id', res.matter.id).maybeSingle();
      if (!doc) return json({ error: 'Document not found' }, 404);

      const path = buildStoragePath(res.matter.id, documentId, body.file_name);
      const { data: signed, error } = await supabase.storage
        .from(LEGAL_DOCUMENT_BUCKET)
        .createSignedUploadUrl(path);
      if (error) throw error;

      const rawSigned = signed?.signedUrl ?? '';
      const absolute = rawSigned.startsWith('http')
        ? rawSigned
        : `${Deno.env.get('SUPABASE_URL')}/storage/v1${rawSigned.startsWith('/') ? '' : '/'}${rawSigned}`;

      return json({
        success: true,
        path,
        token: signed?.token,
        signed_url: absolute,
        bucket: LEGAL_DOCUMENT_BUCKET,
      });
    }

    if (operation === 'attach_upload') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'documents', 'edit')) {
        return json({ error: 'You do not have permission to upload documents' }, 403);
      }
      const documentId = String(body.document_id || '');
      const storagePath = cleanText(body.storage_path, 500);
      if (!documentId || !storagePath) return json({ error: 'document_id and storage_path are required' }, 400);
      if (!storagePath.startsWith(`matters/${res.matter.id}/${documentId}/`)) {
        return json({ error: 'Invalid storage path' }, 400);
      }
      if (!isAllowedMime(body.mime_type) || !isAllowedSize(body.file_size)) {
        return json({ error: 'That upload was rejected' }, 400);
      }

      const { data: existing } = await supabase.from('legal_matter_documents')
        .select('id, version, storage_path').eq('id', documentId)
        .eq('legal_matter_id', res.matter.id).maybeSingle();
      if (!existing) return json({ error: 'Document not found' }, 404);

      const { data: record, error } = await supabase.from('legal_matter_documents')
        .update({
          storage_bucket: LEGAL_DOCUMENT_BUCKET,
          storage_path: storagePath,
          file_name: safeFileName(body.file_name),
          mime_type: cleanText(body.mime_type, 160),
          file_size: Number(body.file_size),
          version: (existing.version || 1) + (existing.storage_path ? 1 : 0),
          status: 'uploaded',
          uploaded_at: new Date().toISOString(),
          uploaded_by_type: 'solicitor_user',
          uploaded_by_solicitor_user_id: me.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', documentId).select(DOCUMENT_SELECT).maybeSingle();
      if (error) throw error;

      // Drop the superseded object so storage never accumulates orphans.
      if (existing.storage_path && existing.storage_path !== storagePath) {
        await supabase.storage.from(LEGAL_DOCUMENT_BUCKET).remove([existing.storage_path]);
      }

      await audit(res.matter, 'matter_document_uploaded', 'legal_matter_document', documentId, {
        file_name: record?.file_name ?? null,
      });
      return json({ success: true, record });
    }

    if (operation === 'set_document_status') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'documents', 'edit')) {
        return json({ error: 'You do not have permission to review documents' }, 403);
      }
      const status = cleanEnum(body.status, LEGAL_DOCUMENT_STATUSES);
      if (!status) return json({ error: 'A valid status is required' }, 400);

      const reviewed = status === 'accepted' || status === 'rejected' || status === 'under_review';
      const { data: record, error } = await supabase.from('legal_matter_documents')
        .update({
          status,
          review_notes: 'review_notes' in body ? cleanText(body.review_notes, 4000) : undefined,
          reviewed_at: reviewed ? new Date().toISOString() : null,
          reviewed_by_solicitor_user_id: reviewed ? me.id : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.document_id).eq('legal_matter_id', res.matter.id)
        .select(DOCUMENT_SELECT).maybeSingle();
      if (error) throw error;
      if (!record) return json({ error: 'Document not found' }, 404);

      await audit(res.matter, 'matter_document_status_changed', 'legal_matter_document', record.id, {
        status, label: record.label,
      });
      return json({ success: true, record });
    }

    if (operation === 'download_url') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'documents', 'view')) {
        return json({ error: 'You do not have permission to open documents' }, 403);
      }
      const { data: doc } = await supabase.from('legal_matter_documents')
        .select('id, storage_bucket, storage_path, file_name')
        .eq('id', body.document_id).eq('legal_matter_id', res.matter.id).maybeSingle();
      if (!doc || !doc.storage_path) return json({ error: 'No file has been uploaded yet' }, 404);

      const { data: signed, error } = await supabase.storage
        .from(doc.storage_bucket || LEGAL_DOCUMENT_BUCKET)
        .createSignedUrl(doc.storage_path, 300, { download: doc.file_name || undefined });
      if (error) throw error;

      await audit(res.matter, 'matter_document_downloaded', 'legal_matter_document', doc.id, {
        file_name: doc.file_name,
      });
      return json({ success: true, url: signed?.signedUrl ?? null });
    }

    if (operation === 'delete_document') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'documents', 'delete')) {
        return json({ error: 'You do not have permission to remove documents' }, 403);
      }
      const { data: doc } = await supabase.from('legal_matter_documents')
        .select('id, storage_path, label').eq('id', body.document_id)
        .eq('legal_matter_id', res.matter.id).maybeSingle();
      if (!doc) return json({ error: 'Document not found' }, 404);

      const { error } = await supabase.from('legal_matter_documents').delete().eq('id', doc.id);
      if (error) throw error;
      if (doc.storage_path) {
        await supabase.storage.from(LEGAL_DOCUMENT_BUCKET).remove([doc.storage_path]);
      }

      await audit(res.matter, 'matter_document_removed', 'legal_matter_document', doc.id, {
        label: doc.label,
      });
      return json({ success: true });
    }

    // ───────────────────────── SEARCHES ─────────────────────────
    if (operation === 'upsert_search') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'searches', 'edit')) {
        return json({ error: 'You do not have permission to manage searches' }, 403);
      }
      const isCreate = !body.search_id;
      const payload = buildSearchPayload(body, { isCreate });
      if (isCreate && !payload.label) return json({ error: 'A label is required' }, 400);

      let record: any;
      if (isCreate) {
        const { data, error } = await supabase.from('legal_matter_searches')
          .insert({ ...payload, legal_matter_id: res.matter.id })
          .select(SEARCH_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      } else {
        const { data, error } = await supabase.from('legal_matter_searches')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', body.search_id).eq('legal_matter_id', res.matter.id)
          .select(SEARCH_SELECT).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Search not found' }, 404);
        record = data;
      }

      await audit(res.matter, isCreate ? 'matter_search_added' : 'matter_search_updated',
        'legal_matter_search', record?.id ?? null,
        { label: record?.label ?? null, status: record?.status ?? null });
      return json({ success: true, record });
    }

    if (operation === 'delete_search') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'searches', 'delete')) {
        return json({ error: 'You do not have permission to remove searches' }, 403);
      }
      const { error } = await supabase.from('legal_matter_searches')
        .delete().eq('id', body.search_id).eq('legal_matter_id', res.matter.id);
      if (error) throw error;
      await audit(res.matter, 'matter_search_removed', 'legal_matter_search', body.search_id ?? null);
      return json({ success: true });
    }

    // ───────────────────────── REQUISITIONS ─────────────────────────
    if (operation === 'upsert_requisition') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'searches', 'edit')) {
        return json({ error: 'You do not have permission to manage requisitions' }, 403);
      }
      const isCreate = !body.requisition_id;
      const payload = buildRequisitionPayload(body, { isCreate });
      if (isCreate && !payload.subject) return json({ error: 'A subject is required' }, 400);
      if (payload.status === 'answered' || payload.status === 'satisfied') {
        payload.answered_at = new Date().toISOString();
      }

      let record: any;
      if (isCreate) {
        const { data, error } = await supabase.from('legal_matter_requisitions')
          .insert({ ...payload, legal_matter_id: res.matter.id })
          .select(REQUISITION_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      } else {
        const { data, error } = await supabase.from('legal_matter_requisitions')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', body.requisition_id).eq('legal_matter_id', res.matter.id)
          .select(REQUISITION_SELECT).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Requisition not found' }, 404);
        record = data;
      }

      await audit(res.matter, isCreate ? 'matter_requisition_added' : 'matter_requisition_updated',
        'legal_matter_requisition', record?.id ?? null,
        { subject: record?.subject ?? null, status: record?.status ?? null });
      return json({ success: true, record });
    }

    if (operation === 'delete_requisition') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'searches', 'delete')) {
        return json({ error: 'You do not have permission to remove requisitions' }, 403);
      }
      const { error } = await supabase.from('legal_matter_requisitions')
        .delete().eq('id', body.requisition_id).eq('legal_matter_id', res.matter.id);
      if (error) throw error;
      await audit(res.matter, 'matter_requisition_removed', 'legal_matter_requisition',
        body.requisition_id ?? null);
      return json({ success: true });
    }

    // ───────────────────────── DISBURSEMENTS ─────────────────────────
    if (operation === 'upsert_disbursement') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'disbursements', 'edit')) {
        return json({ error: 'You do not have permission to manage disbursements' }, 403);
      }
      const isCreate = !body.disbursement_id;
      const payload = buildDisbursementPayload(body, { isCreate });
      if (isCreate && !payload.label) return json({ error: 'A label is required' }, 400);
      if (payload.status === 'paid' && !payload.paid_on) {
        payload.paid_on = new Date().toISOString().slice(0, 10);
      }

      let record: any;
      if (isCreate) {
        const { data, error } = await supabase.from('legal_matter_disbursements')
          .insert({ ...payload, legal_matter_id: res.matter.id })
          .select(DISBURSEMENT_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      } else {
        const { data, error } = await supabase.from('legal_matter_disbursements')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', body.disbursement_id).eq('legal_matter_id', res.matter.id)
          .select(DISBURSEMENT_SELECT).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Disbursement not found' }, 404);
        record = data;
      }

      await audit(res.matter, isCreate ? 'matter_disbursement_added' : 'matter_disbursement_updated',
        'legal_matter_disbursement', record?.id ?? null,
        { label: record?.label ?? null, status: record?.status ?? null });
      return json({ success: true, record });
    }

    if (operation === 'delete_disbursement') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'disbursements', 'delete')) {
        return json({ error: 'You do not have permission to remove disbursements' }, 403);
      }
      const { error } = await supabase.from('legal_matter_disbursements')
        .delete().eq('id', body.disbursement_id).eq('legal_matter_id', res.matter.id);
      if (error) throw error;
      await audit(res.matter, 'matter_disbursement_removed', 'legal_matter_disbursement',
        body.disbursement_id ?? null);
      return json({ success: true });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (error) {
    console.error('[solicitor-portal-documents] error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error)?.message || 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
