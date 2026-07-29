// Web Push dispatcher — invoked by the `dispatch_web_push_on_notification` DB trigger.
// WP-04 hardened: caller supplies only `notification_id`; every user-visible
// field is derived from the notifications row via service role. URL is
// validated against an allowlist. Idempotency is enforced against
// push_delivery_log so retries never fan out duplicate pushes.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import webpush from 'https://esm.sh/web-push@3.6.7';
import { verifyRequiredCronSecret, securityJsonError } from '../_shared/requestSecurity.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-internal-edge-secret',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SubscriberType = 'staff' | 'client_portal' | 'finance_portal';
const VALID_SUBSCRIBERS: readonly SubscriberType[] = ['staff', 'client_portal', 'finance_portal'];

interface DispatchPayload {
  notification_id: string;
  attempt_id?: string;
}

/**
 * URL allowlist: accept in-app paths ("/foo/bar"), same-app absolute URLs, and
 * reject dangerous schemes (javascript:, data:, vbscript:, file:) plus
 * external origins. Fails closed to "/" if the persisted metadata is unsafe.
 */
function sanitizeUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return '/';
  const trimmed = raw.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '/';
    // Restrict to the app's own public host, if configured. Otherwise reject
    // any absolute URL (relative in-app paths are the intended shape).
    const allowedHost = (Deno.env.get('WEB_PUSH_ALLOWED_HOST') || '').trim().toLowerCase();
    if (!allowedHost) return '/';
    return u.hostname.toLowerCase() === allowedHost ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}

function clamp(text: unknown, max: number): string {
  const s = typeof text === 'string' ? text : '';
  return s.length > max ? s.slice(0, max) : s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: signed internal caller only. DB trigger path forwards
    // x-internal-edge-secret via _shared/internalCall.ts.
    if (!verifyRequiredCronSecret(Deno.env.get('INTERNAL_EDGE_SECRET'), req.headers.get('x-internal-edge-secret'))) {
      return securityJsonError(401, 'unauthorized');
    }

    const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY');
    const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY');
    const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT_EMAIL') || 'admin@example.com';
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      console.error('[send-web-push] VAPID keys not configured');
      return securityJsonError(503, 'service_unavailable');
    }
    webpush.setVapidDetails(
      VAPID_SUBJECT.startsWith('mailto:') ? VAPID_SUBJECT : `mailto:${VAPID_SUBJECT}`,
      VAPID_PUBLIC,
      VAPID_PRIVATE,
    );

    let payload: DispatchPayload;
    try {
      payload = await req.json();
    } catch {
      return securityJsonError(400, 'invalid_request');
    }
    const notificationId = typeof payload?.notification_id === 'string' ? payload.notification_id.trim() : '';
    if (!/^[0-9a-fA-F-]{16,64}$/.test(notificationId)) {
      return securityJsonError(400, 'invalid_request');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Derive every field server-side from the persisted notification row.
    const { data: notif, error: notifErr } = await supabase
      .from('notifications')
      .select('id, type, title, message, target_user_id, metadata')
      .eq('id', notificationId)
      .maybeSingle();

    if (notifErr) {
      console.error('[send-web-push] notification lookup failed', notifErr.message);
      return securityJsonError(503, 'service_unavailable');
    }
    if (!notif || !notif.target_user_id) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: 'No target' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // subscriber_type is derived from notification metadata (never trusted from caller).
    const metaSub = (notif.metadata && typeof notif.metadata === 'object' ? (notif.metadata as any).subscriber_type : null);
    const subscriberType: SubscriberType = VALID_SUBSCRIBERS.includes(metaSub) ? metaSub : 'staff';
    const title = clamp(notif.title, 120) || 'Notification';
    const body = clamp(notif.message, 400);
    const url = sanitizeUrl((notif.metadata as any)?.link_path);
    const category = clamp(notif.type, 64) || null;
    const targetUserId = notif.target_user_id as string;

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', targetUserId)
      .eq('subscriber_type', subscriberType)
      .eq('is_active', true);

    if (error) throw error;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: 'No subscriptions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Idempotency: skip subscriptions that already have a successful delivery
    // recorded for this notification_id. Protects retries + duplicate trigger fires.
    const { data: existing } = await supabase
      .from('push_delivery_log')
      .select('subscription_id')
      .eq('notification_id', notificationId)
      .eq('status', 'sent');
    const already = new Set((existing ?? []).map((r: any) => r.subscription_id));
    const targets = subs.filter((s) => !already.has(s.id));

    if (targets.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, total: subs.length, skipped: 'idempotent' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pushPayload = JSON.stringify({
      title,
      body,
      url,
      category,
      notification_id: notificationId,
    });

    const results = await Promise.all(
      targets.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            pushPayload,
          );
          await supabase.from('push_delivery_log').insert({
            subscription_id: sub.id,
            user_id: targetUserId,
            notification_id: notificationId,
            status: 'sent',
            status_code: 201,
            payload_title: title,
          });
          return { id: sub.id, ok: true };
        } catch (err: any) {
          const code = err?.statusCode || 0;
          if (code === 404 || code === 410) {
            await supabase.from('push_subscriptions').update({ is_active: false }).eq('id', sub.id);
          }
          await supabase.from('push_delivery_log').insert({
            subscription_id: sub.id,
            user_id: targetUserId,
            notification_id: notificationId,
            status: 'failed',
            status_code: code,
            // Redact provider error details from client-visible responses; only log server-side.
            error_message: String(err?.body || err?.message || err).slice(0, 500),
            payload_title: title,
          });
          return { id: sub.id, ok: false };
        }
      }),
    );

    const sent = results.filter((r) => r.ok).length;
    return new Response(JSON.stringify({ success: true, sent, total: subs.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-web-push] error', err);
    return securityJsonError(503, 'service_unavailable');
  }
});
