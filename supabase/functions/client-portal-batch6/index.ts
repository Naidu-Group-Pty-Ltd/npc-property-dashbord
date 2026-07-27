/**
 * Client Portal — Batch 6 (Onboarding + Self-Service Booking)
 *
 * Operations (client portal — x-portal-session-token):
 *   onboarding_list                 → client-visible steps for all active PFs
 *   onboarding_complete             { step_id }              → marks a client-owned step complete
 *   availability_slots              { finance_user_id, days? } → next N days of bookable slots
 *   booking_create                  { finance_user_id, start_at, end_at, ... }
 *   bookings_list                                            → client's upcoming bookings
 *   booking_cancel                  { booking_id, reason? }
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";
import { notifyFinancePortalAssignees } from "../_shared/finance-portal-notify.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function isOfferedSlot(
  window: { weekday: number; start_time: string; end_time: string; slot_duration_min: number },
  start: Date,
  end: Date,
) {
  if (window.weekday !== start.getDay()) return false;
  const [sh, sm] = window.start_time.split(':').map(Number);
  const [eh, em] = window.end_time.split(':').map(Number);
  const windowStart = new Date(start); windowStart.setHours(sh, sm, 0, 0);
  const windowEnd = new Date(start); windowEnd.setHours(eh, em, 0, 0);
  const durationMs = window.slot_duration_min * 60000;
  return start.getTime() >= windowStart.getTime()
    && end.getTime() <= windowEnd.getTime()
    && end.getTime() - start.getTime() === durationMs
    && (start.getTime() - windowStart.getTime()) % durationMs === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const operation = body.operation as string;
    const token = req.headers.get('x-portal-session-token') || body.portal_session_token;
    if (!token) return json({ error: 'Portal session token required' }, 401);

    const { data: session } = await supabase
      .from('client_portal_sessions')
      .select('user_id, expires_at, client_portal_users:user_id(client_id, status, email)')
      .eq('session_token', token).gt('expires_at', new Date().toISOString()).maybeSingle();
    const portalUser: any = (session as any)?.client_portal_users;
    if (!portalUser || portalUser.status !== 'active') return json({ error: 'Invalid session' }, 401);
    const clientId = portalUser.client_id;

    if (operation === 'assigned_partner') {
      const { data: assigns } = await supabase.from('finance_portal_client_assignments')
        .select('finance_user_id, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(1);
      const fid = assigns?.[0]?.finance_user_id;
      if (!fid) return json({ partner: null });
      const { data: u } = await supabase.from('finance_portal_users')
        .select('id, full_name, email').eq('id', fid).maybeSingle();
      return json({ partner: u || null });
    }

    if (operation === 'onboarding_list') {
      // active purchase files for this client
      const { data: pfs } = await supabase.from('purchase_files')
        .select('id, title').eq('client_id', clientId).is('archived_at', null);
      const ids = (pfs || []).map((p: any) => p.id);
      if (!ids.length) return json({ files: [] });
      const { data: steps } = await supabase.from('purchase_file_onboarding_checklist')
        .select('id, purchase_file_id, step_key, label, description, category, owner, status, position, completed_at')
        .in('purchase_file_id', ids).eq('visible_to_client', true)
        .order('position').order('created_at');
      const out = (pfs || []).map((p: any) => {
        const fileSteps = (steps || []).filter((s: any) => s.purchase_file_id === p.id);
        const completed = fileSteps.filter((s: any) => s.status === 'complete').length;
        return { id: p.id, title: p.title, steps: fileSteps, completed, total: fileSteps.length };
      });
      return json({ files: out });
    }

    if (operation === 'onboarding_complete') {
      const id = body.step_id;
      if (!id) return json({ error: 'step_id required' }, 400);
      // Must belong to this client AND be client-owned
      const { data: step } = await supabase.from('purchase_file_onboarding_checklist')
        .select('*').eq('id', id).maybeSingle();
      if (!step || step.client_id !== clientId) return json({ error: 'Not found' }, 404);
      if (step.owner === 'broker') return json({ error: 'This step is broker-owned' }, 403);
      if (step.status === 'complete') return json({ step });
      const { data, error } = await supabase.from('purchase_file_onboarding_checklist')
        .update({ status: 'complete', completed_at: new Date().toISOString(), completed_by: portalUser.email || 'client', updated_at: new Date().toISOString() })
        .eq('id', id).neq('status', 'complete').select().maybeSingle();
      if (error) return json({ error: error.message }, 500);
      // A concurrent request may have completed the step after the ownership check.
      // Return its current state without replaying the completion notification.
      if (!data) {
        const { data: current, error: currentError } = await supabase.from('purchase_file_onboarding_checklist')
          .select('*').eq('id', id).single();
        if (currentError) return json({ error: currentError.message }, 500);
        return json({ step: current });
      }

      // Wave B: tell the assigned finance partner(s) the client just finished a step.
      try {
        await notifyFinancePortalAssignees({
          client_id: clientId,
          notification_type: 'client_onboarding_step_completed',
          title: 'Client completed an onboarding step',
          body: data?.label || 'Onboarding step',
          link_path: `/finance/purchase-files/${data?.purchase_file_id}?tab=onboarding`,
          metadata: { onboarding_step_id: id, purchase_file_id: data?.purchase_file_id },
        });
      } catch (notifyErr) {
        console.error('[client-portal-batch6] onboarding notify failed', notifyErr);
      }

      return json({ step: data });
    }

    if (operation === 'availability_slots') {
      const financeUserId = body.finance_user_id;
      const days = Math.min(Math.max(parseInt(body.days || '14'), 1), 30);
      if (!financeUserId) return json({ error: 'finance_user_id required' }, 400);
      const { data: assignment, error: assignmentError } = await supabase.from('finance_portal_client_assignments')
        .select('id').eq('finance_user_id', financeUserId).eq('client_id', clientId).maybeSingle();
      if (assignmentError) return json({ error: assignmentError.message }, 500);
      if (!assignment) return json({ error: 'Finance partner is not assigned to this client' }, 403);
      const { data: windows } = await supabase.from('finance_partner_availability')
        .select('*').eq('finance_user_id', financeUserId).eq('is_active', true);
      const { data: existing } = await supabase.from('finance_partner_bookings')
        .select('start_at, end_at, status').eq('finance_user_id', financeUserId)
        .gte('start_at', new Date().toISOString()).neq('status', 'cancelled');

      const slots: Array<{ start_at: string; end_at: string }> = [];
      const now = new Date();
      for (let dOffset = 0; dOffset < days; dOffset++) {
        const day = new Date(now); day.setDate(now.getDate() + dOffset);
        const weekday = day.getDay();
        for (const w of (windows || [])) {
          if (w.weekday !== weekday) continue;
          const [sh, sm] = w.start_time.split(':').map(Number);
          const [eh, em] = w.end_time.split(':').map(Number);
          const dayStart = new Date(day); dayStart.setHours(sh, sm, 0, 0);
          const dayEnd = new Date(day); dayEnd.setHours(eh, em, 0, 0);
          for (let t = dayStart.getTime(); t + w.slot_duration_min * 60000 <= dayEnd.getTime(); t += w.slot_duration_min * 60000) {
            const s = new Date(t); const e = new Date(t + w.slot_duration_min * 60000);
            if (s.getTime() < now.getTime() + 2 * 3600000) continue; // 2h buffer
            const clash = (existing || []).some((b: any) =>
              new Date(b.start_at).getTime() < e.getTime() && new Date(b.end_at).getTime() > s.getTime());
            if (!clash) slots.push({ start_at: s.toISOString(), end_at: e.toISOString() });
          }
        }
      }
      return json({ slots: slots.slice(0, 200) });
    }

    if (operation === 'booking_create') {
      const fuid = body.finance_user_id;
      if (!fuid || !body.start_at || !body.end_at) return json({ error: 'finance_user_id, start_at, end_at required' }, 400);
      const start = new Date(body.start_at);
      const end = new Date(body.end_at);
      const now = new Date();
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.getTime() < now.getTime() + 2 * 3600000
        || end.getTime() <= start.getTime() || start.getTime() > now.getTime() + 30 * 86400000) {
        return json({ error: 'Invalid booking interval' }, 400);
      }
      const { data: assignment, error: assignmentError } = await supabase.from('finance_portal_client_assignments')
        .select('id').eq('finance_user_id', fuid).eq('client_id', clientId).maybeSingle();
      if (assignmentError) return json({ error: assignmentError.message }, 500);
      if (!assignment) return json({ error: 'Finance partner is not assigned to this client' }, 403);
      if (body.purchase_file_id) {
        const { data: purchaseFile, error: purchaseFileError } = await supabase.from('purchase_files')
          .select('id').eq('id', body.purchase_file_id).eq('client_id', clientId).is('archived_at', null).maybeSingle();
        if (purchaseFileError) return json({ error: purchaseFileError.message }, 500);
        if (!purchaseFile) return json({ error: 'Purchase file not found' }, 404);
      }
      const { data: windows, error: windowsError } = await supabase.from('finance_partner_availability')
        .select('weekday, start_time, end_time, slot_duration_min')
        .eq('finance_user_id', fuid).eq('is_active', true);
      if (windowsError) return json({ error: windowsError.message }, 500);
      if (!(windows || []).some((window) => isOfferedSlot(window, start, end))) {
        return json({ error: 'Requested interval is not an available slot' }, 400);
      }
      // re-verify no clash
      const { data: clash } = await supabase.from('finance_partner_bookings')
        .select('id').eq('finance_user_id', fuid).neq('status', 'cancelled')
        .lt('start_at', body.end_at).gt('end_at', body.start_at).limit(1);
      if (clash && clash.length) return json({ error: 'Slot just booked, please pick another' }, 409);
      const { data, error } = await supabase.from('finance_partner_bookings').insert({
        finance_user_id: fuid, client_id: clientId, purchase_file_id: body.purchase_file_id || null,
        start_at: body.start_at, end_at: body.end_at,
        timezone: body.timezone || 'Australia/Sydney',
        meeting_type: body.meeting_type || 'video',
        topic: body.topic || null, notes: body.notes || null,
        contact_email: portalUser.email || null, contact_name: body.contact_name || null,
        booked_by: 'client',
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      // Notify the finance partner
      await supabase.from('finance_portal_notifications').insert({
        portal_user_id: fuid, notification_type: 'booking_created',
        title: 'New client booking',
        body: `${portalUser.email || 'A client'} booked ${new Date(body.start_at).toLocaleString('en-AU')}`,
        link_path: '/finance/settings?tab=bookings',
        metadata: { booking_id: data.id, client_id: clientId },
      });
      return json({ booking: data });
    }

    if (operation === 'bookings_list') {
      const { data, error } = await supabase.from('finance_partner_bookings')
        .select('*').eq('client_id', clientId)
        .gte('start_at', new Date(Date.now() - 7 * 86400000).toISOString())
        .order('start_at');
      if (error) return json({ error: error.message }, 500);
      return json({ bookings: data || [] });
    }

    if (operation === 'booking_cancel') {
      const id = body.booking_id;
      if (!id) return json({ error: 'booking_id required' }, 400);
      const { data, error } = await supabase.from('finance_partner_bookings')
        .update({ status: 'cancelled', cancelled_reason: body.reason || 'Cancelled by client', updated_at: new Date().toISOString() })
        .eq('id', id).eq('client_id', clientId).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ booking: data });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (e: any) {
    console.error('[client-portal-batch6]', e);
    return json({ error: e?.message || 'Internal error' }, 500);
  }
});
