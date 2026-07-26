/**
 * Phase 7.5 — Forecasting & Earnings
 *
 * Operations (partner-scoped via finance portal session token):
 *  - forecast              { horizon_days = 90|180|365 }   → monthly projected commission inflow
 *  - clawback_radar        {}                              → at-risk deals with retention plays
 *  - goal_progress         { month_start?: YYYY-MM-01 }    → current vs target + 3-month avg
 *  - set_goal              { month_start, settlement_target_count?, settlement_target_amount?, commission_target_net?, notes? }
 *  - list_goals            { months = 12 }
 *
 * Auth: x-finance-session-token (or body.finance_session_token).
 * Service-role internally to bypass RLS.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.55.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token, x-portal-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function extractToken(req: Request, body: any): string | null {
  return (
    req.headers.get('x-finance-session-token') ||
    req.headers.get('x-session-token') ||
    body?.finance_session_token ||
    body?.session_token ||
    null
  );
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthStart(d: Date): string {
  return `${monthKey(d)}-01`;
}

// Upfront commission estimate when we don't have a real ledger entry yet.
// Conservative: 0.6% of loan amount × 0.55 net of GST/aggregator split.
const DEFAULT_UPFRONT_RATE = 0.006;
const DEFAULT_NET_RATIO = 0.55;

function estimateNetFromLoan(loanAmount: number): number {
  return Math.round(loanAmount * DEFAULT_UPFRONT_RATE * DEFAULT_NET_RATIO);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const { operation = 'forecast' } = body || {};

    const token = extractToken(req, body);
    if (!token) return json({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, finance_contact_id, is_active, revoked_at, session_expires_at')
      .eq('session_token', token)
      .maybeSingle();

    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return json({ error: 'Invalid session' }, 401);
    }
    if (
      !portalUser.session_expires_at ||
      new Date(portalUser.session_expires_at) < new Date()
    ) {
      return json({ error: 'Session expired' }, 401);
    }

    const partnerId = portalUser.finance_contact_id;
    if (!partnerId) return json({ error: 'Partner not linked to a finance contact' }, 400);

    // ─────────────────────────────────────────────────────────────────────
    if (operation === 'forecast') {
      const horizonDays = Math.min(Math.max(Number(body.horizon_days) || 90, 30), 365);
      const horizonEnd = new Date();
      horizonEnd.setUTCDate(horizonEnd.getUTCDate() + horizonDays);
      const horizonEndIso = horizonEnd.toISOString().slice(0, 10);
      const todayIso = new Date().toISOString().slice(0, 10);

      // 1) Real commission ledger entries (pending / invoiced) with expected_date in window.
      const { data: commissions } = await supabase
        .from('finance_partner_commissions')
        .select('id, client_id, client_name_snapshot, deal_id, build_payment_id, gross_amount, net_amount, status, invoice_date, trigger_event, purchase_file_id, milestone')
        .eq('finance_contact_id', partnerId)
        .in('status', ['pending', 'invoiced'])
        .gte('invoice_date', todayIso)
        .lte('invoice_date', horizonEndIso);

      // 2) Purchase files settling within horizon that don't already have a settlement-trigger commission row.
      const { data: settlements } = await supabase
        .from('purchase_files')
        .select('id, client_id, title, lender, loan_amount, purchase_price, settlement_date, finance_status, risk_level')
        .eq('assigned_finance_user_id', portalUser.id)
        .gte('settlement_date', todayIso)
        .lte('settlement_date', horizonEndIso)
        .is('archived_at', null);

      // Buckets by month
      const buckets: Record<string, {
        month_start: string;
        committed_net: number;
        projected_net: number;
        committed_gross: number;
        projected_gross: number;
        ledger_ids: string[];
        purchase_file_ids: string[];
      }> = {};
      const ensureBucket = (dateStr: string) => {
        const ms = monthStart(new Date(dateStr));
        if (!buckets[ms]) {
          buckets[ms] = {
            month_start: ms,
            committed_net: 0,
            projected_net: 0,
            committed_gross: 0,
            projected_gross: 0,
            ledger_ids: [],
            purchase_file_ids: [],
          };
        }
        return buckets[ms];
      };

      for (const c of commissions || []) {
        if (!c.invoice_date) continue;
        const b = ensureBucket(c.invoice_date);
        b.committed_net += Number(c.net_amount || 0);
        b.committed_gross += Number(c.gross_amount || 0);
        b.ledger_ids.push(c.id);
      }

      // Build a set of (purchase_file_id, milestone='settlement') already in ledger so we don't double count.
      const existingSettlementPFs = new Set(
        (commissions || [])
          .filter((c: any) => c.purchase_file_id && (c.milestone === 'settlement' || c.trigger_event === 'settlement'))
          .map((c: any) => c.purchase_file_id),
      );

      for (const pf of settlements || []) {
        if (!pf.settlement_date) continue;
        if (existingSettlementPFs.has(pf.id)) continue;
        const loan = Number(pf.loan_amount || pf.purchase_price || 0);
        if (loan <= 0) continue;
        const netEst = estimateNetFromLoan(loan);
        const grossEst = Math.round(loan * DEFAULT_UPFRONT_RATE);
        const b = ensureBucket(pf.settlement_date);
        b.projected_net += netEst;
        b.projected_gross += grossEst;
        b.purchase_file_ids.push(pf.id);
      }

      const series = Object.values(buckets).sort((a, b) =>
        a.month_start.localeCompare(b.month_start),
      );

      const summary = series.reduce(
        (acc, b) => {
          acc.total_committed_net += b.committed_net;
          acc.total_projected_net += b.projected_net;
          acc.total_committed_gross += b.committed_gross;
          acc.total_projected_gross += b.projected_gross;
          return acc;
        },
        { total_committed_net: 0, total_projected_net: 0, total_committed_gross: 0, total_projected_gross: 0 },
      );

      return json({
        horizon_days: horizonDays,
        series,
        summary,
        assumptions: {
          default_upfront_rate: DEFAULT_UPFRONT_RATE,
          default_net_ratio: DEFAULT_NET_RATIO,
          note: 'Projected rows estimate net commission as loan_amount × 0.6% × 55% when no ledger entry exists.',
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    if (operation === 'clawback_radar') {
      // Find this partner's clients (via purchase_files assignment) then their deals at clawback risk.
      const { data: pfs } = await supabase
        .from('purchase_files')
        .select('client_id')
        .eq('assigned_finance_user_id', portalUser.id);
      const clientIds = Array.from(new Set((pfs || []).map((p: any) => p.client_id).filter(Boolean)));

      if (!clientIds.length) return json({ deals: [], totals: { count: 0, amount_at_risk: 0 } });

      const { data: deals } = await supabase
        .from('client_deals')
        .select('id, client_id, loan_amount, commission_estimate, clawback_period_months, clawback_expiry_date, clawback_risk_active, settlement_date, lender, risk_status')
        .in('client_id', clientIds)
        .eq('clawback_risk_active', true);

      const { data: clients } = await supabase
        .from('clients')
        .select('id, first_name, last_name')
        .in('id', clientIds);
      const clientMap = new Map((clients || []).map((c: any) => [c.id, `${c.first_name || ''} ${c.last_name || ''}`.trim()]));

      const today = new Date();
      const enriched = (deals || []).map((d: any) => {
        const expiry = d.clawback_expiry_date ? new Date(d.clawback_expiry_date) : null;
        const daysToExpiry = expiry
          ? Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        const amountAtRisk = Number(d.commission_estimate || 0);
        // Crude bucket
        let urgency: 'critical' | 'high' | 'medium' | 'low' = 'low';
        if (daysToExpiry != null) {
          if (daysToExpiry <= 30) urgency = 'critical';
          else if (daysToExpiry <= 60) urgency = 'high';
          else if (daysToExpiry <= 120) urgency = 'medium';
        }
        return {
          deal_id: d.id,
          client_id: d.client_id,
          client_name: clientMap.get(d.client_id) || 'Client',
          lender: d.lender,
          loan_amount: d.loan_amount,
          amount_at_risk: amountAtRisk,
          clawback_expiry_date: d.clawback_expiry_date,
          days_to_expiry: daysToExpiry,
          settlement_date: d.settlement_date,
          urgency,
          retention_plays: [
            { id: 'rate_review', label: 'Send rate review offer' },
            { id: 'top_up', label: 'Propose top-up / equity release' },
            { id: 'check_in', label: 'Schedule check-in call' },
          ],
        };
      });

      enriched.sort((a, b) => (a.days_to_expiry ?? 9999) - (b.days_to_expiry ?? 9999));

      const totals = enriched.reduce(
        (acc, d) => {
          acc.count += 1;
          acc.amount_at_risk += d.amount_at_risk;
          return acc;
        },
        { count: 0, amount_at_risk: 0 },
      );

      return json({ deals: enriched, totals });
    }

    // ─────────────────────────────────────────────────────────────────────
    if (operation === 'goal_progress') {
      const ms = body.month_start || monthStart(new Date());
      const monthDate = new Date(`${ms}T00:00:00Z`);
      const nextMonth = new Date(monthDate);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

      const { data: goal } = await supabase
        .from('finance_partner_goals')
        .select('*')
        .eq('finance_contact_id', partnerId)
        .eq('month_start', ms)
        .maybeSingle();

      // Actuals — settlements this month
      const { data: settled } = await supabase
        .from('purchase_files')
        .select('id, loan_amount, purchase_price, settlement_date, finance_status')
        .eq('assigned_finance_user_id', portalUser.id)
        .gte('settlement_date', ms)
        .lt('settlement_date', monthStart(nextMonth));

      const actualCount = (settled || []).length;
      const actualAmount = (settled || []).reduce(
        (s: number, p: any) => s + Number(p.loan_amount || p.purchase_price || 0),
        0,
      );

      // Commission actuals (paid + invoiced in month)
      const { data: comm } = await supabase
        .from('finance_partner_commissions')
        .select('net_amount, status, invoice_date, paid_at')
        .eq('finance_contact_id', partnerId)
        .or(`invoice_date.gte.${ms},paid_at.gte.${ms}T00:00:00Z`);

      const commissionEarned = (comm || [])
        .filter((c: any) => {
          const d = c.paid_at || c.invoice_date;
          if (!d) return false;
          const dt = new Date(d);
          return dt >= monthDate && dt < nextMonth;
        })
        .reduce((s: number, c: any) => s + Number(c.net_amount || 0), 0);

      // Last 3 months average
      const threeMonthsAgo = new Date(monthDate);
      threeMonthsAgo.setUTCMonth(threeMonthsAgo.getUTCMonth() - 3);
      const { data: last3 } = await supabase
        .from('purchase_files')
        .select('id, settlement_date')
        .eq('assigned_finance_user_id', portalUser.id)
        .gte('settlement_date', monthStart(threeMonthsAgo))
        .lt('settlement_date', ms);
      const last3Avg = (last3 || []).length / 3;

      return json({
        month_start: ms,
        goal,
        actuals: {
          settlement_count: actualCount,
          settlement_amount: actualAmount,
          commission_net: commissionEarned,
        },
        last_3_months_avg_settlements: Math.round(last3Avg * 10) / 10,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    if (operation === 'set_goal') {
      const ms = body.month_start;
      if (!ms) return json({ error: 'month_start required (YYYY-MM-01)' }, 400);

      const row = {
        finance_contact_id: partnerId,
        month_start: ms,
        settlement_target_count:
          body.settlement_target_count != null ? Number(body.settlement_target_count) : null,
        settlement_target_amount:
          body.settlement_target_amount != null ? Number(body.settlement_target_amount) : null,
        commission_target_net:
          body.commission_target_net != null ? Number(body.commission_target_net) : null,
        notes: body.notes ?? null,
        created_by_finance_user_id: portalUser.id,
      };

      const { data, error } = await supabase
        .from('finance_partner_goals')
        .upsert(row, { onConflict: 'finance_contact_id,month_start' })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);

      return json({ goal: data });
    }

    // ─────────────────────────────────────────────────────────────────────
    if (operation === 'list_goals') {
      const months = Math.min(Number(body.months) || 12, 36);
      const since = new Date();
      since.setUTCMonth(since.getUTCMonth() - months);
      const { data } = await supabase
        .from('finance_partner_goals')
        .select('*')
        .eq('finance_contact_id', partnerId)
        .gte('month_start', monthStart(since))
        .order('month_start', { ascending: false });
      return json({ goals: data || [] });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (err: any) {
    return json({ error: err?.message || 'Unhandled error' }, 500);
  }
});
