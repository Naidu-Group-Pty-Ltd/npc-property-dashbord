/**
 * Phase 9 — Ongoing CDD, Monitoring, EDD & Existing-Client Remediation.
 *
 * POST { op, ...args }
 * Reads: any AML role. Writes: analyst/reviewer/mlro.
 *
 * Ops:
 *   Rules:      list_rules, upsert_rule, delete_rule, toggle_rule
 *   Events:     list_events, ingest_event
 *   Alerts:     list_alerts, upsert_alert, resolve_alert
 *   EDD:        list_edd, get_edd, upsert_edd, mlro_decision_edd
 *   SoF/SoW:    list_sof, upsert_sof, delete_sof, list_sow, upsert_sow, delete_sow
 *   Reviews:    list_reviews, upsert_review, complete_review, seed_pre_commencement
 *   Cron:       run_scheduled_scans  (no auth — pg_cron only; guarded by header token)
 *   Dashboard:  summary
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jr = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function appendCaseEvent(admin: any, caseId: string, category: string, summary: string, payload: any, actorId: string | null, actorLabel: string | null) {
  if (!caseId) return;
  const { data: prev } = await admin.schema("aml").from("case_events")
    .select("row_hash").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({ case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, created_at: now }));
  await admin.schema("aml").from("case_events").insert({ case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, row_hash: rowHash, created_at: now });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);
    const aml = admin.schema("aml");

    const body = await req.json().catch(() => ({}));
    const op = String(body?.op ?? "");

    // ── Cron entrypoint ────────────────────────────────
    if (op === "run_scheduled_scans") {
      const token = req.headers.get("x-cron-token") ?? "";
      const expected = Deno.env.get("AML_CRON_TOKEN") ?? "";
      if (!expected || token !== expected) return jr({ error: "cron token required" }, 401);
      const result = await runScheduledScans(admin);
      return jr(result);
    }

    // ── Auth ───────────────────────────────────────────
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const userLabel = auth.username ?? null;

    const { data: hasAny } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAny) return jr({ error: "AML role required" }, 403);
    const { data: roleRows } = await aml.from("role_assignments").select("role").eq("user_id", userId).is("revoked_at", null);
    const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
    const canWrite = roles.has("analyst") || roles.has("reviewer") || roles.has("mlro");
    const isMlro = roles.has("mlro");
    const requireWrite = () => { if (!canWrite) throw new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); };

    // ── RULES ─────────────────────────────────────────
    if (op === "list_rules") {
      const { data, error } = await aml.from("monitoring_rules").select("*").order("severity", { ascending: false }).order("name");
      if (error) return jr({ error: error.message }, 400);
      return jr({ rules: data ?? [] });
    }
    if (op === "upsert_rule") {
      requireWrite();
      const rule = body.rule ?? {};
      if (!rule.name || !rule.trigger_kind) return jr({ error: "name and trigger_kind required" }, 400);
      const row = { ...rule, created_by: rule.id ? rule.created_by : userId };
      const q = rule.id
        ? aml.from("monitoring_rules").update(row).eq("id", rule.id).select("*").single()
        : aml.from("monitoring_rules").insert(row).select("*").single();
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      return jr({ rule: data });
    }
    if (op === "delete_rule") {
      requireWrite();
      const { error } = await aml.from("monitoring_rules").delete().eq("id", String(body.id));
      if (error) return jr({ error: error.message }, 400);
      return jr({ ok: true });
    }
    if (op === "toggle_rule") {
      requireWrite();
      const { data, error } = await aml.from("monitoring_rules").update({ is_enabled: Boolean(body.enabled) }).eq("id", String(body.id)).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      return jr({ rule: data });
    }

    // ── EVENTS ────────────────────────────────────────
    if (op === "list_events") {
      let q = aml.from("monitoring_events").select("*").order("observed_at", { ascending: false }).limit(Number(body.limit ?? 100));
      if (body.case_id) q = q.eq("case_id", String(body.case_id));
      if (body.unprocessed) q = q.is("processed_at", null);
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      return jr({ events: data ?? [] });
    }
    if (op === "ingest_event") {
      requireWrite();
      const ev = body.event ?? {};
      if (!ev.source || !ev.event_kind) return jr({ error: "source and event_kind required" }, 400);
      const { data, error } = await aml.from("monitoring_events").insert({
        case_id: ev.case_id ?? null, source: ev.source, event_kind: ev.event_kind,
        payload: ev.payload ?? {}, observed_at: ev.observed_at ?? new Date().toISOString(),
      }).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      const alerts = await evaluateEventAgainstRules(admin, data);
      return jr({ event: data, alerts_created: alerts.length });
    }

    // ── ALERTS ────────────────────────────────────────
    if (op === "list_alerts") {
      let q = aml.from("alerts").select("*").order("created_at", { ascending: false }).limit(Number(body.limit ?? 200));
      if (body.status) q = q.eq("status", String(body.status));
      if (body.case_id) q = q.eq("case_id", String(body.case_id));
      if (body.severity) q = q.eq("severity", String(body.severity));
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      return jr({ alerts: data ?? [] });
    }
    if (op === "upsert_alert") {
      requireWrite();
      const a = body.alert ?? {};
      if (!a.title) return jr({ error: "title required" }, 400);
      const q = a.id
        ? aml.from("alerts").update(a).eq("id", a.id).select("*").single()
        : aml.from("alerts").insert(a).select("*").single();
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      if (data?.case_id) await appendCaseEvent(admin, data.case_id, "system", `Alert ${a.id ? "updated" : "opened"}: ${data.title}`, { alert_id: data.id, severity: data.severity }, userId, userLabel);
      return jr({ alert: data });
    }
    if (op === "resolve_alert") {
      requireWrite();
      const { data, error } = await aml.from("alerts").update({
        status: body.status ?? "closed",
        resolution_note: body.resolution_note ?? null,
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
      }).eq("id", String(body.id)).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      if (data?.case_id) await appendCaseEvent(admin, data.case_id, "system", `Alert resolved: ${data.title} → ${data.status}`, { alert_id: data.id, resolution_note: body.resolution_note ?? null }, userId, userLabel);
      return jr({ alert: data });
    }
    if (op === "assign_alert") {
      requireWrite();
      const assignee = body.assigned_to ? String(body.assigned_to) : userId;
      const nextStatus = String(body.status ?? "investigating");
      const { data, error } = await aml.from("alerts").update({
        status: nextStatus,
        assigned_to: assignee,
      }).eq("id", String(body.id)).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      if (data?.case_id) await appendCaseEvent(admin, data.case_id, "system", `Alert ${nextStatus}: ${data.title}`, { alert_id: data.id, assigned_to: assignee }, userId, userLabel);
      return jr({ alert: data });
    }
    if (op === "run_scans_admin") {
      if (!isMlro) return jr({ error: "MLRO role required" }, 403);
      const result = await runScheduledScans(admin);
      return jr(result);
    }

    // ── EDD ───────────────────────────────────────────
    if (op === "list_edd") {
      let q = aml.from("edd_cases").select("*").order("opened_at", { ascending: false }).limit(Number(body.limit ?? 100));
      if (body.case_id) q = q.eq("case_id", String(body.case_id));
      if (body.status) q = q.eq("status", String(body.status));
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      return jr({ edd_cases: data ?? [] });
    }
    if (op === "get_edd") {
      const id = String(body.id ?? "");
      const [{ data: edd }, { data: sof }, { data: sow }] = await Promise.all([
        aml.from("edd_cases").select("*").eq("id", id).maybeSingle(),
        aml.from("source_of_funds").select("*").eq("edd_case_id", id).order("created_at"),
        aml.from("source_of_wealth").select("*").eq("edd_case_id", id).order("created_at"),
      ]);
      return jr({ edd, sof: sof ?? [], sow: sow ?? [] });
    }
    if (op === "upsert_edd") {
      requireWrite();
      const e = body.edd ?? {};
      if (!e.case_id || !e.reason) return jr({ error: "case_id and reason required" }, 400);
      const editableStatuses = new Set(["open", "in_progress", "awaiting_client", "awaiting_mlro"]);
      if (e.status && !editableStatuses.has(String(e.status))) {
        return jr({ error: "Terminal EDD status requires an MLRO decision" }, 403);
      }
      // Never pass caller-controlled decision, completion, audit, or identity fields
      // through this generic analyst/reviewer operation.
      const row = {
        reason: e.reason,
        narrative: e.narrative ?? null,
        assigned_to: e.assigned_to ?? null,
        metadata: e.metadata ?? {},
        ...(e.status ? { status: String(e.status) } : {}),
        ...(e.id ? {} : { case_id: e.case_id, opened_by: userId }),
      };
      const q = e.id
        ? aml.from("edd_cases").update(row).eq("id", e.id).select("*").single()
        : aml.from("edd_cases").insert(row).select("*").single();
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, data.case_id, "edd_note", `EDD ${e.id ? "updated" : "opened"} (${data.reason})`, { edd_id: data.id, status: data.status }, userId, userLabel);
      return jr({ edd: data });
    }
    if (op === "mlro_decision_edd") {
      if (!isMlro) return jr({ error: "MLRO role required" }, 403);
      const { data, error } = await aml.from("edd_cases").update({
        mlro_decision: body.decision, mlro_decision_by: userId, mlro_decision_at: new Date().toISOString(),
        status: body.decision === "exit" ? "abandoned" : "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", String(body.id)).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, data.case_id, "mlro_decision", `MLRO decision on EDD: ${data.mlro_decision}`, { edd_id: data.id }, userId, userLabel);
      return jr({ edd: data });
    }

    // ── SoF / SoW ─────────────────────────────────────
    if (op === "list_sof" || op === "list_sow") {
      const table = op === "list_sof" ? "source_of_funds" : "source_of_wealth";
      let q = aml.from(table).select("*").order("created_at");
      if (body.case_id) q = q.eq("case_id", String(body.case_id));
      if (body.edd_case_id) q = q.eq("edd_case_id", String(body.edd_case_id));
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      return jr({ items: data ?? [] });
    }
    if (op === "upsert_sof" || op === "upsert_sow") {
      requireWrite();
      const table = op === "upsert_sof" ? "source_of_funds" : "source_of_wealth";
      const item = body.item ?? {};
      if (!item.case_id) return jr({ error: "case_id required" }, 400);
      if (item.verified && !item.id) { item.verified_by = userId; item.verified_at = new Date().toISOString(); }
      const q = item.id
        ? aml.from(table).update(item).eq("id", item.id).select("*").single()
        : aml.from(table).insert(item).select("*").single();
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      return jr({ item: data });
    }
    if (op === "delete_sof" || op === "delete_sow") {
      requireWrite();
      const table = op === "delete_sof" ? "source_of_funds" : "source_of_wealth";
      const { error } = await aml.from(table).delete().eq("id", String(body.id));
      if (error) return jr({ error: error.message }, 400);
      return jr({ ok: true });
    }

    // ── Existing Customer Reviews ─────────────────────
    if (op === "list_reviews") {
      let q = aml.from("existing_customer_reviews").select("*").order("due_at", { ascending: true, nullsFirst: false }).limit(Number(body.limit ?? 200));
      if (body.status) q = q.eq("status", String(body.status));
      if (body.classification) q = q.eq("classification", String(body.classification));
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      return jr({ reviews: data ?? [] });
    }
    if (op === "upsert_review") {
      requireWrite();
      const r = body.review ?? {};
      const q = r.id
        ? aml.from("existing_customer_reviews").update(r).eq("id", r.id).select("*").single()
        : aml.from("existing_customer_reviews").insert(r).select("*").single();
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      return jr({ review: data });
    }
    if (op === "complete_review") {
      requireWrite();
      const { data, error } = await aml.from("existing_customer_reviews").update({
        status: body.status ?? "complete",
        outcome: body.outcome ?? null,
        outcome_at: new Date().toISOString(),
        outcome_by: userId,
        reviewer_notes: body.reviewer_notes ?? null,
      }).eq("id", String(body.id)).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      if (data?.case_id) await appendCaseEvent(admin, data.case_id, "system", `Existing-customer review ${data.status} → ${data.outcome ?? "n/a"}`, { review_id: data.id }, userId, userLabel);
      return jr({ review: data });
    }
    if (op === "seed_pre_commencement") {
      requireWrite();
      // Seed queue entries for AML cases with no review scheduled.
      const { data: cases } = await aml.from("cases").select("id, client_id").limit(500);
      let inserted = 0;
      for (const c of cases ?? []) {
        const { count } = await aml.from("existing_customer_reviews").select("id", { count: "exact", head: true }).eq("case_id", c.id).eq("classification", "pre_commencement");
        if ((count ?? 0) > 0) continue;
        await aml.from("existing_customer_reviews").insert({
          case_id: c.id, client_id: c.client_id, classification: "pre_commencement",
          status: "queued", priority: "normal",
          due_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
        });
        inserted += 1;
      }
      return jr({ inserted });
    }

    // ── Dashboard summary ─────────────────────────────
    if (op === "summary") {
      const [openAlerts, criticalAlerts, unprocessed, openEdd, pendingReviews, overdueReviews] = await Promise.all([
        aml.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
        aml.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open").eq("severity", "critical"),
        aml.from("monitoring_events").select("id", { count: "exact", head: true }).is("processed_at", null),
        aml.from("edd_cases").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress", "awaiting_client", "awaiting_mlro"]),
        aml.from("existing_customer_reviews").select("id", { count: "exact", head: true }).in("status", ["queued", "in_progress", "remediation_required"]),
        aml.from("existing_customer_reviews").select("id", { count: "exact", head: true }).in("status", ["queued", "in_progress"]).lt("due_at", new Date().toISOString()),
      ]);
      return jr({
        open_alerts: openAlerts.count ?? 0,
        critical_alerts: criticalAlerts.count ?? 0,
        unprocessed_events: unprocessed.count ?? 0,
        open_edd: openEdd.count ?? 0,
        pending_reviews: pendingReviews.count ?? 0,
        overdue_reviews: overdueReviews.count ?? 0,
      });
    }

    return jr({ error: `Unknown op: ${op}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("aml-monitoring error", e);
    return jr({ error: (e as Error).message ?? "internal error" }, 500);
  }
});

/** Evaluate a single event against enabled rules and create alerts. */
async function evaluateEventAgainstRules(admin: any, event: any): Promise<any[]> {
  const aml = admin.schema("aml");
  const { data: rules } = await aml.from("monitoring_rules").select("*").eq("is_enabled", true);
  const alerts: any[] = [];
  for (const rule of rules ?? []) {
    if (!matches(rule, event)) continue;
    const { data: alert } = await aml.from("alerts").insert({
      case_id: event.case_id, rule_id: rule.id, event_id: event.id,
      severity: rule.severity, status: "open",
      title: `${rule.name}`, summary: `Triggered by ${event.source}/${event.event_kind}`,
      metadata: { rule: rule.name, event_payload: event.payload },
    }).select("*").single();
    if (alert) alerts.push(alert);
  }
  if (alerts.length && event.id) {
    await aml.from("monitoring_events").update({ processed_at: new Date().toISOString() }).eq("id", event.id);
  } else if (event.id) {
    await aml.from("monitoring_events").update({ processed_at: new Date().toISOString() }).eq("id", event.id);
  }
  return alerts;
}

function matches(rule: any, event: any): boolean {
  const c = rule.criteria ?? {};
  const p = event.payload ?? {};
  switch (rule.trigger_kind) {
    case "transaction_amount": {
      if (event.source !== "transaction") return false;
      const amt = Number(p.amount ?? 0);
      if (c.amount_gte && amt < Number(c.amount_gte)) return false;
      if (c.currency && String(p.currency ?? "") !== String(c.currency)) return false;
      if (c.channel && String(p.channel ?? "") !== String(c.channel)) return false;
      return true;
    }
    case "high_risk_geo":
      return Boolean(p.high_risk_geo || (Array.isArray(p.jurisdictions) && p.jurisdictions.some((j: string) => (c.list ?? []).includes(j))));
    case "sanctions_delta":
      return event.source === "screening" && event.event_kind === "match_delta";
    case "custom":
      return String(event.event_kind) === String(c.event_kind ?? "");
    default:
      return false;
  }
}

/** Cron scan: rescreening due + stale verification + overdue reviews → generate synthetic events + alerts. */
async function runScheduledScans(admin: any) {
  const aml = admin.schema("aml");
  const now = Date.now();
  const created: any[] = [];

  const { data: rules } = await aml.from("monitoring_rules").select("*").eq("is_enabled", true);
  const rescreen = (rules ?? []).find((r: any) => r.trigger_kind === "rescreen_due");
  const staleIdv = (rules ?? []).find((r: any) => r.trigger_kind === "stale_verification");

  if (rescreen) {
    const days = Number(rescreen.criteria?.interval_days ?? 365);
    const cutoff = new Date(now - days * 24 * 3600 * 1000).toISOString();
    const { data: stale } = await aml.from("screening_checks").select("case_id, completed_at").lt("completed_at", cutoff).order("completed_at").limit(200);
    for (const s of stale ?? []) {
      const { count } = await aml.from("alerts").select("id", { count: "exact", head: true }).eq("case_id", s.case_id).eq("status", "open").eq("rule_id", rescreen.id);
      if ((count ?? 0) > 0) continue;
      const { data: alert } = await aml.from("alerts").insert({
        case_id: s.case_id, rule_id: rescreen.id, severity: rescreen.severity, status: "open",
        title: rescreen.name, summary: `Last screening ${s.completed_at} — outside ${days}-day window`,
        metadata: { last_completed_at: s.completed_at },
      }).select("*").single();
      if (alert) created.push(alert);
    }
  }

  if (staleIdv) {
    const days = Number(staleIdv.criteria?.interval_days ?? 730);
    const cutoff = new Date(now - days * 24 * 3600 * 1000).toISOString();
    const { data: stale } = await aml.from("identity_checks").select("case_id, completed_at").lt("completed_at", cutoff).order("completed_at").limit(200);
    for (const s of stale ?? []) {
      const { count } = await aml.from("alerts").select("id", { count: "exact", head: true }).eq("case_id", s.case_id).eq("status", "open").eq("rule_id", staleIdv.id);
      if ((count ?? 0) > 0) continue;
      const { data: alert } = await aml.from("alerts").insert({
        case_id: s.case_id, rule_id: staleIdv.id, severity: staleIdv.severity, status: "open",
        title: staleIdv.name, summary: `Last IDV ${s.completed_at} — outside ${days}-day window`,
        metadata: { last_completed_at: s.completed_at },
      }).select("*").single();
      if (alert) created.push(alert);
    }
  }

  // Escalate overdue existing-customer reviews to remediation_required.
  const { data: overdue } = await aml.from("existing_customer_reviews")
    .select("id, case_id, due_at, status, priority")
    .in("status", ["queued", "in_progress"]).lt("due_at", new Date().toISOString()).limit(200);
  for (const r of overdue ?? []) {
    await aml.from("existing_customer_reviews").update({
      status: "remediation_required",
      priority: r.priority === "urgent" ? "urgent" : "high",
    }).eq("id", r.id);
  }

  return { alerts_created: created.length, reviews_escalated: (overdue ?? []).length };
}
