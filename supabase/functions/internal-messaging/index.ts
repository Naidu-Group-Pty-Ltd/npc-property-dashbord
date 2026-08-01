// Internal staff messaging (Command Centre only).
//
// Supports:
//   • direct     — private 1:1 conversation between two active staff members
//   • broadcast  — one-to-all system-wide announcement thread
//
// All access is mediated here: the underlying tables are service_role-only, so
// participation is verified in-function for every read and write.
//
// Actions:
//   list_staff                                  → active staff directory (excl. caller)
//   list_threads                                → caller's threads + unread counts
//   unread_count                                → total unread for badge
//   get_thread   { thread_id }                  → messages for a participating thread
//   start_direct { user_id }                    → find-or-create direct thread
//   send_message { thread_id, body }            → post into an existing thread
//                { recipient_user_id, body }    → post into (or open) a direct thread
//                { broadcast: true, body, title } → new broadcast to all active staff
//   mark_read    { thread_id }                  → stamp last_read_at

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCorsHeaders, createUnauthorizedResponse, verifyAuth } from '../_shared/auth.ts';

const MAX_BODY = 4000;

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

function json(payload: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function directKey(a: string, b: string) {
  return [a, b].sort().join(':');
}

function preview(body: string) {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = String(body.action ?? 'list_threads');
    const sb = admin();

    const auth = await verifyAuth(sb, req.headers, body);
    if (auth.error || !auth.userId) {
      return createUnauthorizedResponse(auth.error ?? 'Authentication required', corsHeaders);
    }
    const me = auth.userId as string;

    // ── Staff directory ──────────────────────────────────────────────
    if (action === 'list_staff') {
      const { data, error } = await sb
        .from('custom_users')
        .select('id, username, email, role')
        .eq('is_active', true)
        .order('username');
      if (error) throw error;
      return json({ success: true, staff: (data ?? []).filter((u) => u.id !== me) }, 200, corsHeaders);
    }

    // ── Helper: caller's active participant rows ──────────────────────
    const myParticipation = async () => {
      const { data, error } = await sb
        .from('internal_thread_participants')
        .select('thread_id, last_read_at')
        .eq('user_id', me)
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    };

    // ── Threads list ─────────────────────────────────────────────────
    if (action === 'list_threads' || action === 'unread_count') {
      const rows = await myParticipation();
      if (rows.length === 0) {
        return json(
          action === 'unread_count' ? { success: true, unread: 0 } : { success: true, threads: [] },
          200,
          corsHeaders,
        );
      }
      const ids = rows.map((r) => r.thread_id);
      const readMap = new Map(rows.map((r) => [r.thread_id, r.last_read_at as string | null]));

      const { data: threads, error: tErr } = await sb
        .from('internal_message_threads')
        .select('id, kind, title, created_by, last_message_at, last_message_preview, created_at')
        .in('id', ids)
        .order('last_message_at', { ascending: false, nullsFirst: false });
      if (tErr) throw tErr;

      // Unread per thread: messages after last_read_at not sent by me.
      const { data: recent, error: mErr } = await sb
        .from('internal_messages')
        .select('thread_id, sender_id, created_at')
        .in('thread_id', ids)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (mErr) throw mErr;

      const unreadByThread = new Map<string, number>();
      for (const m of recent ?? []) {
        if (m.sender_id === me) continue;
        const lastRead = readMap.get(m.thread_id);
        if (lastRead && new Date(m.created_at) <= new Date(lastRead)) continue;
        unreadByThread.set(m.thread_id, (unreadByThread.get(m.thread_id) ?? 0) + 1);
      }

      if (action === 'unread_count') {
        let total = 0;
        for (const n of unreadByThread.values()) total += n;
        return json({ success: true, unread: total }, 200, corsHeaders);
      }

      // Counterparty labels for direct threads.
      const { data: parts } = await sb
        .from('internal_thread_participants')
        .select('thread_id, user_id')
        .in('thread_id', ids);
      const otherIds = new Set<string>();
      for (const p of parts ?? []) if (p.user_id !== me) otherIds.add(p.user_id);
      const { data: users } = otherIds.size
        ? await sb.from('custom_users').select('id, username').in('id', [...otherIds])
        : { data: [] as any[] };
      const nameById = new Map((users ?? []).map((u: any) => [u.id, u.username]));

      const enriched = (threads ?? []).map((t) => {
        const others = (parts ?? [])
          .filter((p) => p.thread_id === t.id && p.user_id !== me)
          .map((p) => nameById.get(p.user_id) ?? 'Unknown');
        return {
          ...t,
          unread: unreadByThread.get(t.id) ?? 0,
          participant_count: (parts ?? []).filter((p) => p.thread_id === t.id).length,
          display_title:
            t.kind === 'broadcast'
              ? t.title || 'Company announcement'
              : others[0] ?? t.title ?? 'Direct message',
        };
      });

      return json({ success: true, threads: enriched }, 200, corsHeaders);
    }

    // ── Read a thread ────────────────────────────────────────────────
    if (action === 'get_thread') {
      const threadId = String(body.thread_id ?? '');
      if (!threadId) return json({ success: false, error: 'thread_id required' }, 400, corsHeaders);

      const { data: part } = await sb
        .from('internal_thread_participants')
        .select('id')
        .eq('thread_id', threadId)
        .eq('user_id', me)
        .eq('is_active', true)
        .maybeSingle();
      if (!part) return json({ success: false, error: 'not_a_participant' }, 403, corsHeaders);

      const { data: msgs, error } = await sb
        .from('internal_messages')
        .select('id, thread_id, sender_id, body, is_system, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw error;

      const senderIds = [...new Set((msgs ?? []).map((m) => m.sender_id).filter(Boolean))] as string[];
      const { data: users } = senderIds.length
        ? await sb.from('custom_users').select('id, username').in('id', senderIds)
        : { data: [] as any[] };
      const nameById = new Map((users ?? []).map((u: any) => [u.id, u.username]));

      await sb
        .from('internal_thread_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .eq('user_id', me);

      return json(
        {
          success: true,
          messages: (msgs ?? []).map((m) => ({
            ...m,
            sender_name: m.sender_id === me ? 'You' : nameById.get(m.sender_id!) ?? 'System',
            mine: m.sender_id === me,
          })),
        },
        200,
        corsHeaders,
      );
    }

    // ── Mark read ────────────────────────────────────────────────────
    if (action === 'mark_read') {
      const threadId = String(body.thread_id ?? '');
      if (!threadId) return json({ success: false, error: 'thread_id required' }, 400, corsHeaders);
      await sb
        .from('internal_thread_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .eq('user_id', me);
      return json({ success: true }, 200, corsHeaders);
    }

    // ── Find-or-create a direct thread ───────────────────────────────
    const ensureDirect = async (otherId: string) => {
      if (otherId === me) throw new Error('cannot_message_self');
      const { data: other } = await sb
        .from('custom_users')
        .select('id, is_active')
        .eq('id', otherId)
        .maybeSingle();
      if (!other || other.is_active === false) throw new Error('recipient_not_found');

      const key = directKey(me, otherId);
      const { data: existing } = await sb
        .from('internal_message_threads')
        .select('id')
        .eq('direct_key', key)
        .maybeSingle();
      if (existing) {
        // Re-activate participation in case a side previously left.
        await sb
          .from('internal_thread_participants')
          .update({ is_active: true })
          .eq('thread_id', existing.id);
        return existing.id as string;
      }

      const { data: created, error } = await sb
        .from('internal_message_threads')
        .insert({ kind: 'direct', direct_key: key, created_by: me })
        .select('id')
        .single();
      if (error) throw error;
      const { error: pErr } = await sb.from('internal_thread_participants').insert([
        { thread_id: created.id, user_id: me },
        { thread_id: created.id, user_id: otherId },
      ]);
      if (pErr) throw pErr;
      return created.id as string;
    };

    if (action === 'start_direct') {
      const otherId = String(body.user_id ?? '');
      if (!otherId) return json({ success: false, error: 'user_id required' }, 400, corsHeaders);
      const threadId = await ensureDirect(otherId);
      return json({ success: true, thread_id: threadId }, 200, corsHeaders);
    }

    // ── Send ─────────────────────────────────────────────────────────
    if (action === 'send_message') {
      const text = String(body.body ?? '').trim();
      if (!text) return json({ success: false, error: 'body required' }, 400, corsHeaders);
      if (text.length > MAX_BODY) {
        return json({ success: false, error: 'body_too_long' }, 400, corsHeaders);
      }

      let threadId = String(body.thread_id ?? '');
      let kind = 'direct';

      if (body.broadcast === true) {
        const { data: staff, error: sErr } = await sb
          .from('custom_users')
          .select('id')
          .eq('is_active', true);
        if (sErr) throw sErr;
        const { data: created, error: cErr } = await sb
          .from('internal_message_threads')
          .insert({
            kind: 'broadcast',
            title: String(body.title ?? '').trim() || 'Company announcement',
            created_by: me,
          })
          .select('id')
          .single();
        if (cErr) throw cErr;
        threadId = created.id;
        kind = 'broadcast';
        const rows = (staff ?? []).map((u) => ({ thread_id: threadId, user_id: u.id }));
        if (rows.length) {
          const { error: pErr } = await sb.from('internal_thread_participants').insert(rows);
          if (pErr) throw pErr;
        }
      } else if (!threadId) {
        const recipient = String(body.recipient_user_id ?? '');
        if (!recipient) {
          return json({ success: false, error: 'thread_id or recipient_user_id required' }, 400, corsHeaders);
        }
        threadId = await ensureDirect(recipient);
      }

      // Participation gate for existing threads.
      const { data: part } = await sb
        .from('internal_thread_participants')
        .select('id')
        .eq('thread_id', threadId)
        .eq('user_id', me)
        .eq('is_active', true)
        .maybeSingle();
      if (!part) return json({ success: false, error: 'not_a_participant' }, 403, corsHeaders);

      const { data: msg, error: mErr } = await sb
        .from('internal_messages')
        .insert({ thread_id: threadId, sender_id: me, body: text })
        .select('id, thread_id, sender_id, body, created_at')
        .single();
      if (mErr) throw mErr;

      const now = new Date().toISOString();
      await sb
        .from('internal_message_threads')
        .update({ last_message_at: now, last_message_preview: preview(text), updated_at: now })
        .eq('id', threadId);
      await sb
        .from('internal_thread_participants')
        .update({ last_read_at: now })
        .eq('thread_id', threadId)
        .eq('user_id', me);

      // Notify every other participant.
      const { data: recipients } = await sb
        .from('internal_thread_participants')
        .select('user_id')
        .eq('thread_id', threadId)
        .eq('is_active', true);
      const { data: senderRow } = await sb
        .from('custom_users')
        .select('username')
        .eq('id', me)
        .maybeSingle();
      const senderName = senderRow?.username ?? 'A team member';

      const notifications = (recipients ?? [])
        .filter((r) => r.user_id !== me)
        .map((r) => ({
          type: 'internal_message',
          title: kind === 'broadcast' ? `Announcement from ${senderName}` : `New message from ${senderName}`,
          message: preview(text),
          target_user_id: r.user_id,
          entity_id: threadId,
        }));
      if (notifications.length) {
        const { error: nErr } = await sb.from('notifications').insert(notifications);
        if (nErr) console.error('[internal-messaging] notification insert failed:', nErr.message);
      }

      return json({ success: true, thread_id: threadId, message: msg }, 200, corsHeaders);
    }

    return json({ success: false, error: `unknown action: ${action}` }, 400, corsHeaders);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    const known = ['cannot_message_self', 'recipient_not_found'];
    return json({ success: false, error: message }, known.includes(message) ? 400 : 500, corsHeaders);
  }
});
