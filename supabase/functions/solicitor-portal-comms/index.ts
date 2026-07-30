/**
 * Solicitor Portal — Communications & tri-portal sync (Phase 6)
 *
 * Matter-scoped conversations between the legal practice and the other three
 * surfaces (Command Centre, Client Portal, Finance Portal), plus the solicitor
 * notification inbox and per-user notification preferences.
 *
 * Every operation is scoped by session → firm → client assignment → merged
 * permission matrix. `firm_internal` threads never leave the solicitor portal;
 * no financial-position or AML-restricted field is ever selected.
 *
 * Operations
 *   list_threads | get_thread | ensure_thread | post_message | mark_thread_read
 *   archive_thread | unread_summary
 *   list_notifications | mark_notification_read | mark_all_notifications_read
 *   get_prefs | update_prefs
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
import {
  THREAD_SELECT,
  MESSAGE_SELECT,
  NOTIFICATION_SELECT,
  PREFS_SELECT,
  SOLICITOR_POSTABLE_SCOPES,
  SOLICITOR_NOTIFICATION_EVENTS,
  isValidScope,
  scopeLabel,
  preview,
  mirrorToClientPortal,
  mirrorToFinancePortal,
  summariseThreads,
  type LegalThreadScope,
} from "../_shared/legalComms.ts";

const MAX_BODY_LENGTH = 8000;

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
    const displayName = me.name || me.email;
    const firmLabel = me.firm?.trading_name || me.firm?.name || 'Legal practice';

    const assignedClientIds = await listAssignedClientIds(supabase, me.id);

    const loadMatter = async (matterId: string): Promise<
      { ok: true; matter: any; perms: PermissionMatrix } | { ok: false; status: number; error: string }
    > => {
      if (!matterId) return { ok: false, status: 400, error: 'matter_id is required' };
      const { data: matter } = await supabase
        .from('legal_matters')
        .select('id, client_id, firm_id, title, matter_reference')
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
      if (!perms || !can(perms, 'messages', 'view')) {
        return { ok: false, status: 403, error: 'You do not have access to matter messages' };
      }
      return { ok: true, matter, perms };
    };

    const audit = (
      matter: any,
      action: string,
      entityId: string | null,
      metadata?: Record<string, unknown>,
    ) => logSolicitorActivity(supabase, {
      solicitor_user_id: me.id, firm_id: me.firm_id, action,
      client_id: matter?.client_id ?? null, legal_matter_id: matter?.id ?? null,
      entity_type: 'legal_matter_message', entity_id: entityId,
      metadata: metadata ?? null, ip_address: ip, user_agent: userAgent,
    });

    /** Find-or-create the single thread for a matter + scope. */
    const ensureThread = async (matter: any, scope: LegalThreadScope) => {
      const { data: existing } = await supabase
        .from('legal_matter_threads')
        .select(THREAD_SELECT)
        .eq('legal_matter_id', matter.id)
        .eq('scope', scope)
        .is('finance_user_id', null)
        .maybeSingle();
      if (existing) return existing;

      const { data, error } = await supabase
        .from('legal_matter_threads')
        .insert({
          legal_matter_id: matter.id,
          client_id: matter.client_id,
          firm_id: me.firm_id,
          scope,
          subject: `${matter.matter_reference || matter.title || 'Matter'} — ${scopeLabel(scope)}`,
          created_by: null,
        })
        .select(THREAD_SELECT)
        .maybeSingle();
      if (error) throw error;
      return data;
    };

    // ───────────────────────── THREADS ─────────────────────────
    if (operation === 'list_threads') {
      const matterId = String(body.matter_id || '');
      if (matterId) {
        const res = await loadMatter(matterId);
        if (!res.ok) return json({ error: res.error }, res.status);
        const { data: threads } = await supabase
          .from('legal_matter_threads')
          .select(THREAD_SELECT)
          .eq('legal_matter_id', res.matter.id)
          .order('last_message_at', { ascending: false, nullsFirst: false });
        return json({
          success: true,
          threads: threads || [],
          summary: summariseThreads((threads || []) as any[], 'solicitor'),
          permissions: res.perms,
        });
      }

      if (assignedClientIds.length === 0) {
        return json({ success: true, threads: [], summary: summariseThreads([], 'solicitor') });
      }
      const { data: threads } = await supabase
        .from('legal_matter_threads')
        .select(`${THREAD_SELECT}, legal_matters:legal_matter_id (id, title, matter_reference)`)
        .in('client_id', assignedClientIds)
        .eq('firm_id', me.firm_id)
        .eq('is_archived', false)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(200);
      return json({
        success: true,
        threads: threads || [],
        summary: summariseThreads((threads || []) as any[], 'solicitor'),
      });
    }

    if (operation === 'ensure_thread') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const scope = isValidScope(body.scope) ? body.scope : 'solicitor_npc';
      const thread = await ensureThread(res.matter, scope);
      return json({ success: true, thread });
    }

    if (operation === 'get_thread') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const scope = isValidScope(body.scope) ? body.scope : null;
      const threadId = String(body.thread_id || '');

      let thread: any = null;
      if (threadId) {
        const { data } = await supabase
          .from('legal_matter_threads').select(THREAD_SELECT)
          .eq('id', threadId).eq('legal_matter_id', res.matter.id).maybeSingle();
        thread = data;
      } else if (scope) {
        thread = await ensureThread(res.matter, scope);
      }
      if (!thread) return json({ error: 'Thread not found' }, 404);

      const { data: messages } = await supabase
        .from('legal_matter_messages')
        .select(MESSAGE_SELECT)
        .eq('thread_id', thread.id)
        .order('created_at', { ascending: true })
        .limit(500);

      return json({ success: true, thread, messages: messages || [], permissions: res.perms });
    }

    if (operation === 'post_message') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'messages', 'edit')) {
        return json({ error: 'You do not have permission to send messages' }, 403);
      }

      const scope = isValidScope(body.scope) ? body.scope : 'solicitor_npc';
      if (!SOLICITOR_POSTABLE_SCOPES.has(scope)) {
        return json({ error: 'That conversation is not available to your practice' }, 403);
      }

      const text = String(body.body || '').trim();
      if (!text) return json({ error: 'A message body is required' }, 400);
      if (text.length > MAX_BODY_LENGTH) {
        return json({ error: `Messages are limited to ${MAX_BODY_LENGTH} characters` }, 400);
      }

      const thread = await ensureThread(res.matter, scope);
      const isInternal = scope === 'firm_internal';

      let mirroredClientId: string | null = null;
      let mirroredFinanceId: string | null = null;
      if (scope === 'solicitor_client') {
        mirroredClientId = await mirrorToClientPortal(supabase, {
          clientId: res.matter.client_id,
          senderName: `${displayName} · ${firmLabel}`,
          body: text,
        });
      } else if (scope === 'solicitor_finance') {
        mirroredFinanceId = await mirrorToFinancePortal(supabase, {
          clientId: res.matter.client_id,
          senderName: `${displayName} · ${firmLabel}`,
          body: text,
        });
      }

      const { data: message, error } = await supabase
        .from('legal_matter_messages')
        .insert({
          thread_id: thread.id,
          legal_matter_id: res.matter.id,
          client_id: res.matter.client_id,
          scope,
          sender_type: 'solicitor_user',
          sender_solicitor_user_id: me.id,
          sender_name: displayName,
          body: text,
          is_internal: isInternal,
          mirrored_client_message_id: mirroredClientId,
          mirrored_finance_message_id: mirroredFinanceId,
          read_by_solicitor_at: new Date().toISOString(),
        })
        .select(MESSAGE_SELECT)
        .maybeSingle();
      if (error) throw error;

      await audit(res.matter, 'matter_message_sent', message?.id ?? null, {
        scope,
        mirrored_client: !!mirroredClientId,
        mirrored_finance: !!mirroredFinanceId,
        preview: preview(text, 120),
      });

      return json({ success: true, message, thread_id: thread.id });
    }

    if (operation === 'mark_thread_read') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const threadId = String(body.thread_id || '');
      if (!threadId) return json({ error: 'thread_id is required' }, 400);

      const now = new Date().toISOString();
      await supabase
        .from('legal_matter_messages')
        .update({ read_by_solicitor_at: now })
        .eq('thread_id', threadId)
        .eq('legal_matter_id', res.matter.id)
        .is('read_by_solicitor_at', null);
      const { data: thread } = await supabase
        .from('legal_matter_threads')
        .update({ unread_count_solicitor: 0 })
        .eq('id', threadId)
        .eq('legal_matter_id', res.matter.id)
        .select(THREAD_SELECT)
        .maybeSingle();

      return json({ success: true, thread });
    }

    if (operation === 'archive_thread') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data: thread } = await supabase
        .from('legal_matter_threads')
        .update({ is_archived: body.archived !== false })
        .eq('id', String(body.thread_id || ''))
        .eq('legal_matter_id', res.matter.id)
        .select(THREAD_SELECT)
        .maybeSingle();
      return json({ success: true, thread });
    }

    if (operation === 'unread_summary') {
      const [{ data: threads }, { count: notificationCount }] = await Promise.all([
        assignedClientIds.length
          ? supabase.from('legal_matter_threads').select(THREAD_SELECT)
              .in('client_id', assignedClientIds).eq('firm_id', me.firm_id).eq('is_archived', false)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('solicitor_portal_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('solicitor_user_id', me.id).eq('is_read', false),
      ]);
      return json({
        success: true,
        messages: summariseThreads((threads || []) as any[], 'solicitor'),
        unread_notifications: notificationCount || 0,
      });
    }

    // ───────────────────── NOTIFICATIONS ─────────────────────
    if (operation === 'list_notifications') {
      const limit = Math.min(Number(body.limit) || 50, 200);
      let query = supabase
        .from('solicitor_portal_notifications')
        .select(NOTIFICATION_SELECT)
        .eq('solicitor_user_id', me.id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (body.unread_only) query = query.eq('is_read', false);
      const { data: notifications } = await query;
      const unread = (notifications || []).filter((n: any) => !n.is_read).length;
      return json({ success: true, notifications: notifications || [], unread });
    }

    if (operation === 'mark_notification_read') {
      const { data } = await supabase
        .from('solicitor_portal_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', String(body.notification_id || ''))
        .eq('solicitor_user_id', me.id)
        .select(NOTIFICATION_SELECT)
        .maybeSingle();
      return json({ success: true, notification: data });
    }

    if (operation === 'mark_all_notifications_read') {
      await supabase
        .from('solicitor_portal_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('solicitor_user_id', me.id)
        .eq('is_read', false);
      return json({ success: true });
    }

    // ───────────────────── PREFERENCES ─────────────────────
    if (operation === 'get_prefs') {
      const { data: rows } = await supabase
        .from('solicitor_notification_prefs')
        .select(PREFS_SELECT)
        .eq('solicitor_user_id', me.id);
      const byEvent = new Map<string, any>();
      (rows || []).forEach((r: any) => byEvent.set(r.event_type, r));
      const prefs = SOLICITOR_NOTIFICATION_EVENTS.map((event) => byEvent.get(event) ?? {
        solicitor_user_id: me.id,
        event_type: event,
        channels: ['in_app'],
        quiet_hours_start: null,
        quiet_hours_end: null,
        timezone: 'Australia/Sydney',
        is_enabled: true,
      });
      return json({ success: true, prefs, events: SOLICITOR_NOTIFICATION_EVENTS });
    }

    if (operation === 'update_prefs') {
      const eventType = String(body.event_type || '');
      if (!(SOLICITOR_NOTIFICATION_EVENTS as readonly string[]).includes(eventType)) {
        return json({ error: 'Unknown notification event' }, 400);
      }
      const channels = Array.isArray(body.channels)
        ? body.channels.filter((c: unknown) => typeof c === 'string' && ['in_app', 'email'].includes(c))
        : ['in_app'];

      const { data, error } = await supabase
        .from('solicitor_notification_prefs')
        .upsert({
          solicitor_user_id: me.id,
          event_type: eventType,
          channels: channels.length ? channels : ['in_app'],
          quiet_hours_start: body.quiet_hours_start || null,
          quiet_hours_end: body.quiet_hours_end || null,
          timezone: String(body.timezone || 'Australia/Sydney'),
          is_enabled: body.is_enabled !== false,
        }, { onConflict: 'solicitor_user_id,event_type' })
        .select(PREFS_SELECT)
        .maybeSingle();
      if (error) throw error;
      return json({ success: true, pref: data });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (error) {
    console.error('[solicitor-portal-comms] error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error)?.message || 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
