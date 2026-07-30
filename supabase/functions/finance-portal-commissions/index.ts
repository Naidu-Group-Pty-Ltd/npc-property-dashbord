/**
 * Finance Portal Commissions Edge Function (Phase 7A)
 *
 * Operations
 *   list_commissions          (admin)  filters: partner_id, status, period_start/end, search
 *   get_commission            (admin)  single record
 *   create_manual             (admin)  manual ad-hoc commission line
 *   update_commission         (admin)  edit basis/rate/amounts/notes/status
 *   set_status                (admin)  bulk status change (pending/invoiced/paid/clawback/void)
 *   delete_commission         (admin)  hard delete (only if not on issued statement)
 *
 *   list_statements           (admin)  with filters
 *   generate_statement        (admin)  partner + period → statement + lines
 *   issue_statement           (admin)  draft → issued, generate PDF + remittance CSV
 *   mark_statement_paid       (admin)  set paid
 *   void_statement            (admin)  void + release lines
 *
 *   partner_summary           (partner) KPIs + recent commissions (uses session token)
 *   partner_commissions       (partner) list scoped to caller
 *   partner_statements        (partner) list scoped to caller
 *   partner_statement_pdf_url (partner) signed url for own statement
 *
 * Auth model
 *   Admin ops require a custom_users JWT (verifyAuth via Authorization).
 *   Partner ops require a finance portal session token in body.finance_session_token.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders, verifyAuth } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getBrandConfig } from "../_shared/brand-config.ts";

const STATEMENT_BUCKET = 'finance-portal-statements';

// ── Small helpers ────────────────────────────────────────────────────────────
async function ensureBucket(supabase: any) {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b: any) => b.name === STATEMENT_BUCKET)) {
      await supabase.storage.createBucket(STATEMENT_BUCKET, { public: false });
    }
  } catch (_) { /* swallow */ }
}

function fmtMoney(n: number) {
  return `$${(Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(s: any) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function buildStatementHtml(statement: any, lines: any[], brandName: string) {
  const rows = lines.map((l, i) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #1f2a44">${i + 1}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2a44">${escapeHtml(l.client_name_snapshot || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2a44">${escapeHtml(l.deal_type_snapshot || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2a44">${escapeHtml(l.trigger_event_snapshot || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2a44;text-align:right">${escapeHtml(l.rate_pct_snapshot ?? '—')}%</td>
      <td style="padding:8px;border-bottom:1px solid #1f2a44;text-align:right">${fmtMoney(l.gross_snapshot)}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2a44;text-align:right">${fmtMoney(l.gst_snapshot)}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2a44;text-align:right;color:#BF9B50;font-weight:600">${fmtMoney(l.net_snapshot)}</td>
    </tr>
  `).join('');

  return `<!doctype html><html><head><meta charset="utf-8"/><title>Commission Statement</title></head>
<body style="margin:0;padding:0;background:#0D264D;color:#e8ecf3;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:840px;margin:0 auto;padding:48px 56px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #BF9B50;padding-bottom:24px;margin-bottom:32px">
      <div>
        <div style="color:#BF9B50;letter-spacing:.18em;font-size:11px;text-transform:uppercase">${brandName}</div>
        <div style="font-size:28px;font-weight:600;margin-top:6px">Commission Statement</div>
        <div style="color:#94a3b8;margin-top:8px">${escapeHtml(statement.partner_company_snapshot || '')}</div>
        <div style="font-weight:600">${escapeHtml(statement.partner_name_snapshot || '')}</div>
      </div>
      <div style="text-align:right">
        <div style="color:#94a3b8;font-size:12px">Statement Period</div>
        <div style="font-weight:600">${statement.period_start} → ${statement.period_end}</div>
        <div style="color:#94a3b8;font-size:12px;margin-top:8px">Issued</div>
        <div style="font-weight:600">${statement.issued_at ? new Date(statement.issued_at).toLocaleDateString('en-AU') : 'Draft'}</div>
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="color:#BF9B50;text-align:left;border-bottom:1px solid #BF9B50">
          <th style="padding:8px">#</th>
          <th style="padding:8px">Client</th>
          <th style="padding:8px">Deal</th>
          <th style="padding:8px">Trigger</th>
          <th style="padding:8px;text-align:right">Rate</th>
          <th style="padding:8px;text-align:right">Gross</th>
          <th style="padding:8px;text-align:right">GST</th>
          <th style="padding:8px;text-align:right">Net</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="8" style="padding:24px;text-align:center;color:#94a3b8">No commission lines</td></tr>'}</tbody>
    </table>

    <div style="margin-top:32px;display:flex;justify-content:flex-end">
      <table style="font-size:14px">
        <tr><td style="padding:6px 16px;color:#94a3b8">Lines</td><td style="padding:6px 0;text-align:right;font-weight:600">${statement.line_count}</td></tr>
        <tr><td style="padding:6px 16px;color:#94a3b8">Total Gross</td><td style="padding:6px 0;text-align:right;font-weight:600">${fmtMoney(statement.total_gross)}</td></tr>
        <tr><td style="padding:6px 16px;color:#94a3b8">Total GST</td><td style="padding:6px 0;text-align:right;font-weight:600">${fmtMoney(statement.total_gst)}</td></tr>
        <tr><td style="padding:10px 16px;color:#BF9B50;border-top:1px solid #BF9B50">Total Net Payable</td><td style="padding:10px 0;text-align:right;font-weight:700;font-size:18px;color:#BF9B50;border-top:1px solid #BF9B50">${fmtMoney(statement.total_net)}</td></tr>
      </table>
    </div>

    <div style="margin-top:48px;padding-top:18px;border-top:1px solid #1f2a44;color:#94a3b8;font-size:11px;text-align:center">
      This statement is generated by ${brandName} Command Centre. Payments are processed per the partner agreement on file.
    </div>
  </div>
</body></html>`;
}

function buildRemittanceCsv(statement: any, lines: any[]) {
  const header = 'line,client,deal_type,trigger,rate_pct,gross,gst,net,accrual_date';
  const body = lines.map((l, i) => [
    i + 1,
    JSON.stringify(l.client_name_snapshot || ''),
    JSON.stringify(l.deal_type_snapshot || ''),
    JSON.stringify(l.trigger_event_snapshot || ''),
    l.rate_pct_snapshot ?? '',
    l.gross_snapshot ?? 0,
    l.gst_snapshot ?? 0,
    l.net_snapshot ?? 0,
    l.accrual_date ?? '',
  ].join(',')).join('\n');
  const totals = `\n,,,,TOTAL,${statement.total_gross},${statement.total_gst},${statement.total_net},`;
  return header + '\n' + body + totals;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function resolvePartnerFromSession(supabase: any, sessionToken?: string) {
  if (!sessionToken) return null;
  const { data: user, error } = await supabase
    .from('finance_portal_users')
    .select('id, finance_contact_id, is_active, session_expires_at')
    .eq('session_token', sessionToken)
    .maybeSingle();
  if (error || !user || !user.is_active) return null;
  if (user.session_expires_at && new Date(user.session_expires_at) < new Date()) return null;
  return user;
}

// ── Server ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const { operation } = body;

    const PARTNER_OPS = new Set([
      'partner_summary', 'partner_commissions', 'partner_statements', 'partner_statement_pdf_url',
      'partner_statement_detail', 'partner_raise_dispute', 'partner_disputes',
    ]);


    let adminUserId: string | null = null;
    let partner: any = null;

    if (PARTNER_OPS.has(operation)) {
      partner = await resolvePartnerFromSession(supabase, body.finance_session_token);
      if (!partner) {
        return new Response(JSON.stringify({ error: 'Invalid partner session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      const auth = await verifyAuth(supabase, req.headers, body);
      if (auth.error || !auth.userId) {
        return new Response(JSON.stringify({ error: 'Authentication required' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      adminUserId = auth.userId === 'service_role' ? null : auth.userId;
    }

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN OPS
    // ════════════════════════════════════════════════════════════════════════
    if (operation === 'list_commissions') {
      let q = supabase
        .from('finance_partner_commissions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (body.partner_id) q = q.eq('finance_contact_id', body.partner_id);
      if (body.status) q = q.eq('status', body.status);
      if (body.period_start) q = q.gte('created_at', body.period_start);
      if (body.period_end) q = q.lte('created_at', body.period_end);

      const { data, error } = await q;
      if (error) throw error;

      let rows = data || [];
      if (body.search) {
        const s = String(body.search).toLowerCase();
        rows = rows.filter(r =>
          (r.partner_name_snapshot || '').toLowerCase().includes(s) ||
          (r.client_name_snapshot || '').toLowerCase().includes(s) ||
          (r.notes || '').toLowerCase().includes(s)
        );
      }
      return new Response(JSON.stringify({ success: true, commissions: rows }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'get_commission') {
      const { data, error } = await supabase
        .from('finance_partner_commissions')
        .select('*')
        .eq('id', body.id)
        .maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, commission: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'create_manual') {
      const partnerId = body.finance_contact_id;
      if (!partnerId) throw new Error('finance_contact_id required');

      const { data: pc } = await supabase
        .from('finance_agent_contacts')
        .select('name, company, gst_registered, default_commission_rate_pct')
        .eq('id', partnerId).maybeSingle();

      const rate = Number(body.rate_pct ?? pc?.default_commission_rate_pct ?? 0);
      const basis = Number(body.basis_amount ?? 0);
      const gross = body.gross_amount != null ? Number(body.gross_amount) : Math.round(basis * rate / 100 * 100) / 100;
      const gst = pc?.gst_registered ? Math.round(gross * 0.10 * 100) / 100 : 0;
      const net = Math.round((gross - gst) * 100) / 100;

      let clientName: string | null = null;
      if (body.client_id) {
        const { data: c } = await supabase.from('clients').select('first_name,last_name').eq('id', body.client_id).maybeSingle();
        clientName = c ? [c.first_name, c.last_name].filter(Boolean).join(' ') : null;
      }

      const { data, error } = await supabase
        .from('finance_partner_commissions')
        .insert({
          finance_contact_id: partnerId,
          client_id: body.client_id || null,
          deal_id: body.deal_id || null,
          partner_name_snapshot: pc?.name || null,
          partner_company_snapshot: pc?.company || null,
          client_name_snapshot: clientName,
          deal_type_snapshot: body.deal_type || null,
          commission_basis: body.commission_basis || 'manual',
          basis_amount: basis,
          rate_pct: rate,
          gross_amount: gross,
          gst_amount: gst,
          net_amount: net,
          trigger_event: 'manual',
          status: body.status || 'pending',
          notes: body.notes || null,
          created_by: adminUserId,
        })
        .select('*')
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, commission: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'update_commission') {
      const patch: Record<string, any> = {};
      ['basis_amount','rate_pct','gross_amount','gst_amount','net_amount',
       'commission_basis','status','invoice_ref','invoice_date','paid_at',
       'notes','client_id','deal_id'].forEach(k => { if (k in body) patch[k] = body[k]; });

      // Auto-recalc gross/gst/net if basis or rate changed but gross not supplied
      if (('basis_amount' in body || 'rate_pct' in body) && !('gross_amount' in body)) {
        const basis = Number(patch.basis_amount ?? 0);
        const rate = Number(patch.rate_pct ?? 0);
        patch.gross_amount = Math.round(basis * rate / 100 * 100) / 100;
      }

      const { data, error } = await supabase
        .from('finance_partner_commissions')
        .update(patch)
        .eq('id', body.id)
        .select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, commission: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'set_status') {
      const ids: string[] = body.ids || [];
      const status: string = body.status;
      const patch: Record<string, any> = { status };
      if (status === 'paid') patch.paid_at = new Date().toISOString();
      const { error } = await supabase
        .from('finance_partner_commissions')
        .update(patch)
        .in('id', ids);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, count: ids.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'delete_commission') {
      const { data: row } = await supabase
        .from('finance_partner_commissions')
        .select('statement_id').eq('id', body.id).maybeSingle();
      if (row?.statement_id) {
        const { data: stmt } = await supabase
          .from('finance_partner_statements')
          .select('status').eq('id', row.statement_id).maybeSingle();
        if (stmt && stmt.status !== 'draft') {
          throw new Error('Cannot delete: commission is on an issued statement');
        }
      }
      const { error } = await supabase.from('finance_partner_commissions').delete().eq('id', body.id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'list_statements') {
      let q = supabase.from('finance_partner_statements').select('*')
        .order('period_end', { ascending: false }).limit(200);
      if (body.partner_id) q = q.eq('finance_contact_id', body.partner_id);
      if (body.status) q = q.eq('status', body.status);
      const { data, error } = await q;
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, statements: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Phase 4: agreement-derived commercial terms ────────────────────────
    if (operation === 'resolve_terms') {
      const { partner_id, direction } = body;
      if (!partner_id) throw new Error('partner_id required');
      const { data, error } = await supabase.rpc('fp_resolve_partner_agreement', {
        _finance_contact_id: partner_id,
        _direction: direction || 'outbound_finance_referral',
      });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, terms: (data || [])[0] || null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Record (or clear) receipt of cleared funds for one or more commissions.
    if (operation === 'set_cleared_funds') {
      const ids: string[] = body.ids || (body.id ? [body.id] : []);
      if (!ids.length) throw new Error('ids required');
      const received = body.received !== false;
      const { data, error } = await supabase
        .from('finance_partner_commissions')
        .update({
          cleared_funds_received_at: received ? (body.received_at || new Date().toISOString()) : null,
          cleared_funds_reference: received ? (body.reference || null) : null,
        })
        .in('id', ids)
        .select('id, cleared_funds_received_at');
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, commissions: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Phase 4: disputes (clause 5.3) ─────────────────────────────────────
    if (operation === 'list_disputes') {
      let q = supabase.from('finance_partner_statement_disputes').select('*')
        .order('raised_at', { ascending: false }).limit(300);
      if (body.statement_id) q = q.eq('statement_id', body.statement_id);
      if (body.partner_id) q = q.eq('finance_contact_id', body.partner_id);
      if (body.status) q = q.eq('status', body.status);
      const { data, error } = await q;
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, disputes: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'raise_dispute' || operation === 'partner_raise_dispute') {
      const statementId = body.statement_id;
      if (!statementId) throw new Error('statement_id required');
      if (!body.reason) throw new Error('reason required');

      const { data: stmt } = await supabase.from('finance_partner_statements')
        .select('id, finance_contact_id, status, dispute_deadline')
        .eq('id', statementId).maybeSingle();
      if (!stmt) throw new Error('Statement not found');

      const isPartner = operation === 'partner_raise_dispute';
      if (isPartner && stmt.finance_contact_id !== partner.finance_contact_id) {
        return new Response(JSON.stringify({ error: 'Not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (isPartner && stmt.status === 'draft') {
        return new Response(JSON.stringify({ error: 'Statement not yet issued' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const withinWindow = !stmt.dispute_deadline
        || new Date().toISOString().slice(0, 10) <= stmt.dispute_deadline;

      const { data, error } = await supabase.from('finance_partner_statement_disputes')
        .insert({
          statement_id: statementId,
          finance_contact_id: stmt.finance_contact_id,
          commission_id: body.commission_id || null,
          raised_by_type: isPartner ? 'partner' : 'staff',
          raised_by_id: isPartner ? partner.id : adminUserId,
          raised_by_name: body.raised_by_name || null,
          within_window: withinWindow,
          reason_category: body.reason_category || 'other',
          reason: String(body.reason).slice(0, 4000),
          disputed_amount: body.disputed_amount != null ? Number(body.disputed_amount) : null,
        })
        .select('*').single();
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, dispute: data, within_window: withinWindow }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'resolve_dispute') {
      const { id, status } = body;
      if (!id) throw new Error('id required');
      const next = status || 'resolved';
      const terminal = ['resolved', 'withdrawn', 'rejected'].includes(next);
      const { data, error } = await supabase.from('finance_partner_statement_disputes')
        .update({
          status: next,
          resolution_outcome: body.resolution_outcome || null,
          resolution_notes: body.resolution_notes || null,
          adjustment_amount: body.adjustment_amount != null ? Number(body.adjustment_amount) : null,
          resolved_at: terminal ? new Date().toISOString() : null,
          resolved_by: terminal ? adminUserId : null,
          resolved_by_name: terminal ? (body.resolved_by_name || null) : null,
        })
        .eq('id', id).select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, dispute: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'partner_disputes') {
      const { data, error } = await supabase.from('finance_partner_statement_disputes')
        .select('*')
        .eq('finance_contact_id', partner.finance_contact_id)
        .order('raised_at', { ascending: false }).limit(200);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, disputes: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'generate_statement') {
      const { partner_id, period_start, period_end } = body;
      if (!partner_id || !period_start || !period_end) throw new Error('partner_id, period_start, period_end required');

      const { data: pc } = await supabase.from('finance_agent_contacts')
        .select('name, company').eq('id', partner_id).maybeSingle();

      // Agreement-derived terms drive the dispute window and provenance.
      const { data: termsRows } = await supabase.rpc('fp_resolve_partner_agreement', {
        _finance_contact_id: partner_id,
        _direction: 'outbound_finance_referral',
      });
      const terms = (termsRows || [])[0] || null;

      // Pull eligible commissions (pending or invoiced, not on a statement)
      const { data: commissions, error: cErr } = await supabase
        .from('finance_partner_commissions')
        .select('*')
        .eq('finance_contact_id', partner_id)
        .is('statement_id', null)
        .in('status', ['pending', 'invoiced'])
        .gte('created_at', period_start)
        .lte('created_at', period_end + 'T23:59:59')
        .order('created_at', { ascending: true });
      if (cErr) throw cErr;

      // Cleared-funds gate (Doc 2 §5): a commission that requires cleared funds
      // cannot be statemented until the funds have actually been received.
      const all = commissions || [];
      const lines = body.include_uncleared === true
        ? all
        : all.filter(c => !c.cleared_funds_required || !!c.cleared_funds_received_at);
      const withheld = all.filter(c => c.cleared_funds_required && !c.cleared_funds_received_at);

      const round2 = (n: number) => Math.round(n * 100) / 100;
      const totalGross = round2(lines.reduce((s, c) => s + Number(c.gross_amount || 0), 0));
      const totalGst = round2(lines.reduce((s, c) => s + Number(c.gst_amount || 0), 0));
      const totalNet = round2(lines.reduce((s, c) => s + Number(c.net_amount || 0) + Number(c.adjustment_amount || 0), 0));

      const disputeWindowDays = terms?.dispute_window_days ?? null;
      const deadline = disputeWindowDays
        ? new Date(Date.now() + disputeWindowDays * 86400000).toISOString().slice(0, 10)
        : null;

      const { data: stmt, error: sErr } = await supabase
        .from('finance_partner_statements')
        .insert({
          finance_contact_id: partner_id,
          partner_name_snapshot: pc?.name || null,
          partner_company_snapshot: pc?.company || null,
          period_start, period_end,
          total_gross: totalGross, total_gst: totalGst, total_net: totalNet,
          line_count: lines.length,
          status: 'draft',
          agreement_id: terms?.agreement_id || null,
          agreement_version: terms?.agreement_version || null,
          dispute_window_days: disputeWindowDays,
          dispute_deadline: deadline,
        })
        .select('*').single();
      if (sErr) throw sErr;

      if (lines.length) {
        const lineRows = lines.map(c => ({
          statement_id: stmt.id,
          commission_id: c.id,
          client_name_snapshot: c.client_name_snapshot,
          deal_type_snapshot: c.deal_type_snapshot,
          trigger_event_snapshot: c.trigger_event,
          basis_snapshot: c.commission_basis,
          rate_pct_snapshot: c.rate_pct,
          gross_snapshot: c.gross_amount,
          gst_snapshot: c.gst_amount,
          net_snapshot: c.net_amount,
          accrual_date: (c.created_at || '').slice(0, 10),
          agreement_id: c.agreement_id || terms?.agreement_id || null,
          agreement_version_snapshot: c.agreement_version || terms?.agreement_version || null,
          rate_source_snapshot: c.rate_source || null,
          gst_treatment_snapshot: c.gst_treatment || terms?.gst_treatment || null,
          qualifying_event_snapshot: c.qualifying_event || terms?.qualifying_event || null,
          basis_amount_snapshot: c.basis_amount ?? null,
          cleared_funds_received_at_snapshot: c.cleared_funds_received_at || null,
          adjustment_snapshot: Number(c.adjustment_amount || 0),
          adjustment_reason_snapshot: c.adjustment_reason || null,
        }));
        await supabase.from('finance_partner_statement_lines').insert(lineRows);
        await supabase.from('finance_partner_commissions')
          .update({ statement_id: stmt.id })
          .in('id', lines.map(l => l.id));
      }

      return new Response(JSON.stringify({
        success: true,
        statement: stmt,
        line_count: lines.length,
        withheld_count: withheld.length,
        withheld_net: round2(withheld.reduce((s, c) => s + Number(c.net_amount || 0), 0)),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'issue_statement') {

      const { id } = body;
      const { data: stmt, error: sErr } = await supabase
        .from('finance_partner_statements').select('*').eq('id', id).maybeSingle();
      if (sErr || !stmt) throw new Error('Statement not found');

      const { data: lines } = await supabase
        .from('finance_partner_statement_lines').select('*')
        .eq('statement_id', id).order('created_at', { ascending: true });

      await ensureBucket(supabase);

      const _brandCfg = await getBrandConfig();
      const html = buildStatementHtml(stmt, lines || [], _brandCfg.companyName);
      const csv = buildRemittanceCsv(stmt, lines || []);

      const folder = `${stmt.finance_contact_id}/${stmt.id}`;
      const htmlPath = `${folder}/statement.html`;
      const csvPath = `${folder}/remittance.csv`;

      await supabase.storage.from(STATEMENT_BUCKET)
        .upload(htmlPath, new Blob([html], { type: 'text/html' }), { upsert: true, contentType: 'text/html' });
      await supabase.storage.from(STATEMENT_BUCKET)
        .upload(csvPath, new Blob([csv], { type: 'text/csv' }), { upsert: true, contentType: 'text/csv' });

      const { data: updated, error: uErr } = await supabase
        .from('finance_partner_statements')
        .update({
          status: 'issued',
          issued_at: new Date().toISOString(),
          issued_by: adminUserId,
          pdf_storage_path: htmlPath,
          remittance_csv_path: csvPath,
        })
        .eq('id', id).select('*').single();
      if (uErr) throw uErr;

      // Move all member commissions to "invoiced" if still pending
      await supabase.from('finance_partner_commissions')
        .update({ status: 'invoiced' })
        .eq('statement_id', id).eq('status', 'pending');

      return new Response(JSON.stringify({ success: true, statement: updated }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'mark_statement_paid') {
      const { id, paid_reference } = body;

      // Clause 5.3 — an open dispute blocks payment unless explicitly overridden.
      const { data: openDisputes } = await supabase
        .from('finance_partner_statement_disputes')
        .select('id').eq('statement_id', id).in('status', ['open', 'under_review']);
      if ((openDisputes?.length || 0) > 0 && body.override_dispute !== true) {
        return new Response(JSON.stringify({
          error: 'Statement has an open dispute — resolve it or pass override_dispute',
          open_dispute_count: openDisputes?.length || 0,
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: updated, error } = await supabase
        .from('finance_partner_statements')
        .update({ status: 'paid', paid_at: new Date().toISOString(), paid_reference: paid_reference || null })
        .eq('id', id).select('*').single();
      if (error) throw error;


      await supabase.from('finance_partner_commissions')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('statement_id', id).neq('status', 'void');

      return new Response(JSON.stringify({ success: true, statement: updated }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'void_statement') {
      const { id } = body;
      const { error } = await supabase.from('finance_partner_statements')
        .update({ status: 'void' }).eq('id', id);
      if (error) throw error;
      // Release lines (set statement_id null, restore status to pending unless already paid)
      await supabase.from('finance_partner_commissions')
        .update({ statement_id: null, status: 'pending' })
        .eq('statement_id', id).neq('status', 'paid');
      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'admin_get_signed_url') {
      const { path, expires_in } = body;
      const { data, error } = await supabase.storage.from(STATEMENT_BUCKET)
        .createSignedUrl(path, expires_in || 600);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, url: data.signedUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ════════════════════════════════════════════════════════════════════════
    // PARTNER OPS  (scoped by session token)
    // ════════════════════════════════════════════════════════════════════════
    if (operation === 'partner_summary') {
      const partnerId = partner.finance_contact_id;
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

      const { data: all } = await supabase.from('finance_partner_commissions')
        .select('status, gross_amount, net_amount, paid_at, created_at')
        .eq('finance_contact_id', partnerId);

      const list = all || [];
      const ytdGross = list.filter(c => c.created_at >= yearStart).reduce((s, c) => s + Number(c.gross_amount || 0), 0);
      const ytdNet = list.filter(c => c.created_at >= yearStart).reduce((s, c) => s + Number(c.net_amount || 0), 0);
      const pending = list.filter(c => c.status === 'pending' || c.status === 'invoiced').reduce((s, c) => s + Number(c.net_amount || 0), 0);
      const paidThisMonth = list.filter(c => c.status === 'paid' && c.paid_at && c.paid_at >= monthStart).reduce((s, c) => s + Number(c.net_amount || 0), 0);

      const { data: recent } = await supabase.from('finance_partner_commissions')
        .select('*').eq('finance_contact_id', partnerId)
        .order('created_at', { ascending: false }).limit(10);

      return new Response(JSON.stringify({
        success: true,
        kpis: { ytd_gross: ytdGross, ytd_net: ytdNet, pending_net: pending, paid_this_month: paidThisMonth, total_lines: list.length },
        recent_commissions: recent || [],
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'partner_commissions') {
      let q = supabase.from('finance_partner_commissions').select('*')
        .eq('finance_contact_id', partner.finance_contact_id)
        .order('created_at', { ascending: false }).limit(500);
      if (body.status) q = q.eq('status', body.status);
      const { data, error } = await q;
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, commissions: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'partner_statements') {
      const { data, error } = await supabase.from('finance_partner_statements')
        .select('*').eq('finance_contact_id', partner.finance_contact_id)
        .neq('status', 'draft')
        .order('period_end', { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, statements: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'partner_statement_detail') {
      const { statement_id } = body;
      const { data: stmt, error: stmtErr } = await supabase.from('finance_partner_statements')
        .select('*')
        .eq('id', statement_id)
        .eq('finance_contact_id', partner.finance_contact_id)
        .neq('status', 'draft')
        .maybeSingle();
      if (stmtErr) throw stmtErr;
      if (!stmt) {
        return new Response(JSON.stringify({ error: 'Not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: lines, error: linesErr } = await supabase.from('finance_partner_statement_lines')
        .select('*')
        .eq('statement_id', statement_id)
        .order('accrual_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (linesErr) throw linesErr;

      return new Response(JSON.stringify({ success: true, statement: stmt, lines: lines || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'partner_statement_pdf_url') {
      const { statement_id } = body;
      const { data: stmt } = await supabase.from('finance_partner_statements')
        .select('id, finance_contact_id, pdf_storage_path, remittance_csv_path, status')
        .eq('id', statement_id).maybeSingle();
      if (!stmt || stmt.finance_contact_id !== partner.finance_contact_id || stmt.status === 'draft') {
        return new Response(JSON.stringify({ error: 'Not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const out: any = {};
      if (stmt.pdf_storage_path) {
        const { data } = await supabase.storage.from(STATEMENT_BUCKET).createSignedUrl(stmt.pdf_storage_path, 600);
        out.pdf_url = data?.signedUrl;
      }
      if (stmt.remittance_csv_path) {
        const { data } = await supabase.storage.from(STATEMENT_BUCKET).createSignedUrl(stmt.remittance_csv_path, 600);
        out.csv_url = data?.signedUrl;
      }
      return new Response(JSON.stringify({ success: true, ...out }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: `Unknown operation: ${operation}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[finance-portal-commissions] error', e);
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
