/**
 * Builder Collaboration Admin — Command Centre control plane
 *
 * Mirrors `builder-delivery-admin` for the collaboration domain: staff callers
 * are gated deny-by-default on the `builder_portal_admin` module permission
 * (superadmin bypass preserved), and every mutation additionally requires CSRF
 * validation because the staff session is cookie-carried.
 *
 * This function serves the INTERNAL surface only. It resolves a Command Centre
 * session and never accepts a Builder Portal session cookie (ADR 018).
 *
 * Operations mirror the portal function, minus the portal-only per-user views
 * (my_tasks, unread_counts, collaboration_summary — those are a Builder user's
 * own state and have no staff meaning):
 *   list_documents | get_document | upsert_document | add_document_version
 *   document_url | set_document_grant
 *   list_conversations | get_conversation | create_conversation | post_message
 *   list_tasks | upsert_task | set_task_assignment
 *   list_notifications | collaboration_stats
 *
 * Boundary invariants enforced here, not merely documented:
 *   * A scope pair, document, conversation or task id supplied by the browser is
 *     never authority; the module permission is, and every child write is scoped
 *     to a re-read parent row.
 *   * A scope type outside the closed list is refused before any lookup.
 *   * Every mutation goes through a guarded database command that writes its
 *     audit row in the SAME transaction (Phase 0 NOCOPY-04).
 *   * expected_version is required on every update: missing is 400, stale 409.
 *   * A document's storage path never leaves the server. Staff receive the same
 *     short-lived signed URL a portal user would.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission, type ModulePerm } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  BUILDER_DOCUMENT_SELECT,
  BUILDER_DOCUMENT_VERSION_SELECT,
  BUILDER_DOCUMENT_GRANT_SELECT,
  BUILDER_CONVERSATION_SELECT,
  BUILDER_PARTICIPANT_SELECT,
  BUILDER_MESSAGE_SELECT,
  BUILDER_TASK_SELECT,
  BUILDER_TASK_ASSIGNMENT_SELECT,
  BUILDER_NOTIFICATION_SELECT,
  BUILDER_SCOPE_TYPES,
  BUILDER_DOCUMENT_BUCKET,
  BUILDER_DOCUMENT_URL_TTL_SECONDS,
  buildDocumentPayload,
  buildVersionPayload,
  buildConversationPayload,
  buildTaskPayload,
  collaborationCommandFailure,
  isAcceptableStoragePath,
  cleanEnum,
  cleanText,
  type BuilderScopeType,
} from '../_shared/builderCollaboration.ts';

const MODULE_KEY = 'builder_portal_admin';

const READ_OPERATIONS = new Set([
  'list_documents', 'get_document', 'document_url', 'list_conversations',
  'get_conversation', 'list_tasks', 'list_notifications', 'collaboration_stats',
]);

function requiredPermFor(operation: string): ModulePerm {
  return READ_OPERATIONS.has(operation) ? 'can_view' : 'can_edit';
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

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

    // 1. Internal authentication. A Builder Portal cookie is not a staff session.
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return json({ error: auth.error || 'Authentication required' }, 401);
    }

    // 2. Module permission, deny by default.
    const authz = await requireModulePermission(
      supabase, { userId: auth.userId, authMethod: auth.authMethod },
      MODULE_KEY, requiredPermFor(operation),
    );
    if (!authz.ok) {
      return createForbiddenResponse(authz.error || 'Not authorized', corsHeaders);
    }

    // verifyAuth() returns the literal string 'service_role' for a verified
    // internal call. That is not a uuid (Phase 1 finding P2).
    const isServiceRoleActor = auth.userId === 'service_role';
    const adminUserId: string | null = isServiceRoleActor ? null : auth.userId;
    const actorType = isServiceRoleActor ? 'service_role' : 'command_user';

    /**
     * Re-read the scope the browser named. The id is a lookup key, never
     * authority — the module permission is what authorises a staff caller — but
     * the scope type must still be inside the closed list, and the row must
     * exist, before anything is written against it.
     */
    const loadScope = async (): Promise<
      { ok: true; scopeType: BuilderScopeType; scopeId: string }
      | { ok: false; status: number; error: string }
    > => {
      const scopeType = cleanEnum(body.scope_type, BUILDER_SCOPE_TYPES);
      const scopeId = cleanText(body.scope_id, 64);
      if (!scopeType || !scopeId) {
        return { ok: false, status: 400, error: 'scope_type and scope_id are required' };
      }
      const { data: exists, error } = await supabase.rpc('builder_scope_exists', {
        _scope_type: scopeType, _scope_id: scopeId,
      });
      if (error) throw error;
      if (exists !== true) return { ok: false, status: 404, error: 'That record does not exist' };
      return { ok: true, scopeType, scopeId };
    };

    const loadDocument = async (): Promise<
      { ok: true; document: any } | { ok: false; status: number; error: string }
    > => {
      const documentId = cleanText(body.document_id, 64);
      if (!documentId) return { ok: false, status: 400, error: 'document_id is required' };
      const { data: document } = await supabase.from('builder_documents')
        .select(BUILDER_DOCUMENT_SELECT).eq('id', documentId).maybeSingle();
      if (!document) return { ok: false, status: 404, error: 'Document not found' };
      return { ok: true, document };
    };

    const loadConversation = async (): Promise<
      { ok: true; conversation: any } | { ok: false; status: number; error: string }
    > => {
      const conversationId = cleanText(body.conversation_id, 64);
      if (!conversationId) return { ok: false, status: 400, error: 'conversation_id is required' };
      const { data: conversation } = await supabase.from('builder_conversations')
        .select(BUILDER_CONVERSATION_SELECT).eq('id', conversationId).maybeSingle();
      if (!conversation) return { ok: false, status: 404, error: 'Conversation not found' };
      return { ok: true, conversation };
    };

    const loadTask = async (): Promise<
      { ok: true; task: any } | { ok: false; status: number; error: string }
    > => {
      const taskId = cleanText(body.task_id, 64);
      if (!taskId) return { ok: false, status: 400, error: 'task_id is required' };
      const { data: task } = await supabase.from('builder_tasks')
        .select(BUILDER_TASK_SELECT).eq('id', taskId).maybeSingle();
      if (!task) return { ok: false, status: 404, error: 'Task not found' };
      return { ok: true, task };
    };

    const fail = (message: string, fallbackStatus = 400, fallbackError = 'The request failed') => {
      const mapped = collaborationCommandFailure(message);
      return mapped
        ? json({ error: mapped.error, code: mapped.code }, mapped.status)
        : json({ error: fallbackError }, fallbackStatus);
    };

    /**
     * Read expected_version for an update. Missing is a hard 400: it is never
     * silently replaced with the current database value.
     */
    const requireVersion = (): number | { error: Response } => {
      const supplied = Number(body.expected_version);
      if (!Number.isInteger(supplied) || supplied < 1) {
        return {
          error: json({
            error: 'expected_version is required when updating an existing record',
            code: 'EXPECTED_VERSION_REQUIRED',
          }, 400),
        };
      }
      return supplied;
    };

    // ───────────────────────── DOCUMENTS ─────────────────────────
    if (operation === 'list_documents') {
      const res = await loadScope();
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data } = await supabase.from('builder_documents').select(BUILDER_DOCUMENT_SELECT)
        .eq('scope_type', res.scopeType).eq('scope_id', res.scopeId)
        .order('created_at', { ascending: false }).limit(200);
      return json({ success: true, records: data || [] });
    }

    if (operation === 'get_document') {
      const res = await loadDocument();
      if (!res.ok) return json({ error: res.error }, res.status);
      const [{ data: versions }, { data: grants }] = await Promise.all([
        supabase.from('builder_document_versions').select(BUILDER_DOCUMENT_VERSION_SELECT)
          .eq('document_id', res.document.id).order('version_number', { ascending: false }).limit(100),
        supabase.from('builder_document_grants').select(BUILDER_DOCUMENT_GRANT_SELECT)
          .eq('document_id', res.document.id).order('granted_at', { ascending: true }).limit(200),
      ]);
      return json({
        success: true, document: res.document,
        versions: versions || [], grants: grants || [],
      });
    }

    if (operation === 'upsert_document') {
      const documentId = cleanText(body.document_id, 64);
      let expectedVersion: number | null = null;
      let scopeType: BuilderScopeType | null = null;
      let scopeId: string | null = null;

      if (documentId) {
        const version = requireVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
        const existing = await loadDocument();
        if (!existing.ok) return json({ error: existing.error }, existing.status);
      } else {
        const res = await loadScope();
        if (!res.ok) return json({ error: res.error }, res.status);
        scopeType = res.scopeType;
        scopeId = res.scopeId;
      }

      const payload = buildDocumentPayload(body);
      if (!documentId && !payload.title) return json({ error: 'A title is required' }, 400);

      const { data, error } = await supabase.rpc('builder_upsert_document', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _document_id: documentId,
        _scope_type: scopeType,
        _scope_id: scopeId,
        _payload: payload,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The document could not be saved');
      return json({ success: true, record: data });
    }

    if (operation === 'add_document_version') {
      const res = await loadDocument();
      if (!res.ok) return json({ error: res.error }, res.status);

      const payload = buildVersionPayload(body);
      if (!payload.storage_path || !payload.file_name) {
        return json({ error: 'A file is required' }, 400);
      }
      if (!isAcceptableStoragePath(payload.storage_path as string)) {
        return json({ error: 'That file location is not allowed' }, 400);
      }

      const { data, error } = await supabase.rpc('builder_add_document_version', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _document_id: res.document.id,
        _payload: payload,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The version could not be added');
      const { storage_path: _path, ...safe } = (data || {}) as any;
      return json({ success: true, record: safe });
    }

    if (operation === 'document_url') {
      const res = await loadDocument();
      if (!res.ok) return json({ error: res.error }, res.status);
      const versionId = cleanText(body.version_id, 64) || res.document.current_version_id;
      if (!versionId) return json({ error: 'This document has no file yet' }, 404);

      const { data: version } = await supabase.from('builder_document_versions')
        .select('id, storage_path, file_name').eq('id', versionId)
        .eq('document_id', res.document.id).maybeSingle();
      if (!version) return json({ error: 'Version not found' }, 404);

      const { data: signed, error } = await supabase.storage
        .from(BUILDER_DOCUMENT_BUCKET)
        .createSignedUrl(version.storage_path, BUILDER_DOCUMENT_URL_TTL_SECONDS);
      if (error || !signed?.signedUrl) {
        return json({ error: 'The document could not be prepared' }, 502);
      }
      return json({
        success: true, url: signed.signedUrl,
        file_name: version.file_name, expires_in: BUILDER_DOCUMENT_URL_TTL_SECONDS,
      });
    }

    if (operation === 'set_document_grant') {
      const res = await loadDocument();
      if (!res.ok) return json({ error: res.error }, res.status);

      const builderUserId = cleanText(body.builder_user_id, 64);
      if (!builderUserId) return json({ error: 'builder_user_id is required' }, 400);

      const { data: existing } = await supabase.from('builder_document_grants')
        .select('id').eq('document_id', res.document.id)
        .eq('builder_user_id', builderUserId).maybeSingle();

      let expectedVersion: number | null = null;
      if (existing) {
        const version = requireVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
      }

      const { data, error } = await supabase.rpc('builder_set_document_grant', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _document_id: res.document.id,
        _builder_user_id: builderUserId,
        _can_download: body.can_download !== false,
        _revoke: !!body.revoke,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The permission could not be saved');
      return json({ success: true, record: data });
    }

    // ───────────────────────── CONVERSATIONS ─────────────────────────
    if (operation === 'list_conversations') {
      const res = await loadScope();
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data } = await supabase.from('builder_conversations').select(BUILDER_CONVERSATION_SELECT)
        .eq('scope_type', res.scopeType).eq('scope_id', res.scopeId)
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(200);
      return json({ success: true, records: data || [] });
    }

    if (operation === 'get_conversation') {
      const res = await loadConversation();
      if (!res.ok) return json({ error: res.error }, res.status);
      const [{ data: participants }, { data: messages }] = await Promise.all([
        supabase.from('builder_conversation_participants').select(BUILDER_PARTICIPANT_SELECT)
          .eq('conversation_id', res.conversation.id).order('joined_at', { ascending: true }).limit(100),
        supabase.from('builder_messages').select(BUILDER_MESSAGE_SELECT)
          .eq('conversation_id', res.conversation.id).order('created_at', { ascending: true }).limit(500),
      ]);
      return json({
        success: true, conversation: res.conversation,
        participants: participants || [], messages: messages || [],
      });
    }

    if (operation === 'create_conversation') {
      const res = await loadScope();
      if (!res.ok) return json({ error: res.error }, res.status);

      const payload = buildConversationPayload(body);
      if (!payload.subject) return json({ error: 'A subject is required' }, 400);

      const requested = Array.isArray(body.participant_ids)
        ? body.participant_ids.map((id: unknown) => cleanText(id, 64)).filter(Boolean).slice(0, 50)
        : [];
      // Even a staff caller may only enrol real portal users; an unknown id is
      // dropped rather than creating a dangling participant.
      let participantIds: string[] = [];
      if (requested.length) {
        const { data: users } = await supabase.from('builder_portal_users')
          .select('id').in('id', requested);
        participantIds = (users || []).map((u: any) => u.id);
      }

      const { data, error } = await supabase.rpc('builder_create_conversation', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _scope_type: res.scopeType,
        _scope_id: res.scopeId,
        _payload: payload,
        _participant_ids: participantIds.length ? participantIds : null,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The conversation could not be started');
      return json({ success: true, record: data });
    }

    if (operation === 'post_message') {
      const res = await loadConversation();
      if (!res.ok) return json({ error: res.error }, res.status);

      const messageBody = cleanText(body.body, 8000);
      if (!messageBody) return json({ error: 'A message cannot be empty' }, 400);

      const { data, error } = await supabase.rpc('builder_post_message', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _conversation_id: res.conversation.id,
        _body: messageBody,
        _display_name: cleanText(body.display_name, 120) || 'Aurixa Systems',
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The message could not be sent');
      return json({ success: true, record: data });
    }

    // ───────────────────────── TASKS ─────────────────────────
    if (operation === 'list_tasks') {
      const res = await loadScope();
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data: tasks } = await supabase.from('builder_tasks').select(BUILDER_TASK_SELECT)
        .eq('scope_type', res.scopeType).eq('scope_id', res.scopeId)
        .order('due_date', { ascending: true, nullsFirst: false }).limit(300);
      const ids = (tasks || []).map((t: any) => t.id);
      const { data: assignments } = ids.length
        ? await supabase.from('builder_task_assignments').select(BUILDER_TASK_ASSIGNMENT_SELECT)
          .in('task_id', ids).is('unassigned_at', null).limit(600)
        : { data: [] as any[] };
      return json({ success: true, records: tasks || [], assignments: assignments || [] });
    }

    if (operation === 'upsert_task') {
      const taskId = cleanText(body.task_id, 64);
      let expectedVersion: number | null = null;
      let scopeType: BuilderScopeType | null = null;
      let scopeId: string | null = null;

      if (taskId) {
        const version = requireVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
        const existing = await loadTask();
        if (!existing.ok) return json({ error: existing.error }, existing.status);
      } else {
        const res = await loadScope();
        if (!res.ok) return json({ error: res.error }, res.status);
        scopeType = res.scopeType;
        scopeId = res.scopeId;
      }

      const payload = buildTaskPayload(body);
      if (!taskId && !payload.title) return json({ error: 'A title is required' }, 400);

      const { data, error } = await supabase.rpc('builder_upsert_task', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _task_id: taskId,
        _scope_type: scopeType,
        _scope_id: scopeId,
        _payload: payload,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The task could not be saved');
      return json({ success: true, record: data });
    }

    if (operation === 'set_task_assignment') {
      const res = await loadTask();
      if (!res.ok) return json({ error: res.error }, res.status);

      const builderUserId = cleanText(body.builder_user_id, 64);
      if (!builderUserId) return json({ error: 'builder_user_id is required' }, 400);
      const { data: portalUser } = await supabase.from('builder_portal_users')
        .select('id').eq('id', builderUserId).maybeSingle();
      if (!portalUser) return json({ error: 'That portal user does not exist' }, 404);

      const { data: existing } = await supabase.from('builder_task_assignments')
        .select('id').eq('task_id', res.task.id)
        .eq('builder_user_id', builderUserId).maybeSingle();

      let expectedVersion: number | null = null;
      if (existing) {
        const version = requireVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
      }

      const { data, error } = await supabase.rpc('builder_set_task_assignment', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _task_id: res.task.id,
        _builder_user_id: builderUserId,
        _unassign: !!body.unassign,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The assignment could not be saved');
      return json({ success: true, record: data });
    }

    // ───────────────────────── NOTIFICATIONS / STATS ─────────────────────────
    if (operation === 'list_notifications') {
      const builderUserId = cleanText(body.builder_user_id, 64);
      if (!builderUserId) return json({ error: 'builder_user_id is required' }, 400);
      const { data } = await supabase.from('builder_notifications')
        .select(BUILDER_NOTIFICATION_SELECT)
        .eq('builder_user_id', builderUserId)
        .order('created_at', { ascending: false }).limit(100);
      return json({ success: true, records: data || [] });
    }

    if (operation === 'collaboration_stats') {
      const res = await loadScope();
      if (!res.ok) return json({ error: res.error }, res.status);
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: documents }, { data: conversations }, { data: tasks }] = await Promise.all([
        supabase.from('builder_documents').select('status')
          .eq('scope_type', res.scopeType).eq('scope_id', res.scopeId).limit(2000),
        supabase.from('builder_conversations').select('status')
          .eq('scope_type', res.scopeType).eq('scope_id', res.scopeId).limit(2000),
        supabase.from('builder_tasks').select('status, due_date')
          .eq('scope_type', res.scopeType).eq('scope_id', res.scopeId).limit(2000),
      ]);
      const openTasks = (tasks || []).filter(
        (t: any) => !['done', 'cancelled'].includes(t.status));
      return json({
        success: true,
        documents: (documents || []).filter((d: any) => d.status === 'active').length,
        open_conversations: (conversations || []).filter((c: any) => c.status === 'open').length,
        open_tasks: openTasks.length,
        overdue_tasks: openTasks.filter((t: any) => t.due_date && t.due_date < today).length,
      });
    }

    return json({ error: 'Unknown operation' }, 400);
  } catch (error) {
    console.error('[builder-collaboration-admin]', error);
    return json({ error: 'Internal server error' }, 500);
  }
});
