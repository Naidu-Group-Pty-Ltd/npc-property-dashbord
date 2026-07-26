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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-cron-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
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
      // Phase 10: completing a periodic review closes the cycle and books the
      // next one from the case's current risk rating, so ongoing CDD never
      // lapses silently. Ended relationships are left alone.
      let next_review_at: string | null = null;
      if (data?.case_id && data.classification === "periodic" && data.status === "complete") {
        const { data: caseRow } = await aml.from("cases")
          .select("id, tenant_id, risk_rating, monitoring_status").eq("id", data.case_id).maybeSingle();
        if (caseRow && caseRow.monitoring_status !== "ended") {
          const { data: tenant } = await aml.from("tenant_settings")
            .select("review_interval_config").eq("tenant_id", (caseRow.tenant_id as string) || "default").maybeSingle();
          const defaults: Record<string, number> = { prohibited: 3, high: 12, medium: 24, low: 36, unrated: 12 };
          const cfg = { ...defaults, ...((tenant?.review_interval_config as Record<string, number>) ?? {}) };
          const months = Number(cfg[String(caseRow.risk_rating ?? "") || "unrated"] ?? 12) || 12;
          const next = new Date();
          next.setUTCMonth(next.getUTCMonth() + months);
          next_review_at = next.toISOString();
          await aml.from("cases").update({
            last_periodic_review_at: new Date().toISOString(),
            next_periodic_review_at: next_review_at,
          }).eq("id", data.case_id);
          await appendCaseEvent(admin, data.case_id, "system",
            `Next periodic review booked for ${next_review_at.slice(0, 10)} (${months}-month cycle)`,
            { previous_review_id: data.id, interval_months: months }, userId, userLabel);
        }
      }
      return jr({ review: data, next_review_at });
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

    // ── ONGOING CDD (Phase 10, directive §12.9) ───────
    // Reviews are scheduled from the internal risk rating, raised by material
    // trigger events, assigned with deadlines, and stop when the business
    // relationship formally ends. Every state change is audited; nothing is
    // inferred and no monitoring history is removed.
    const DEFAULT_REVIEW_INTERVALS: Record<string, number> = {
      prohibited: 3, high: 12, medium: 24, low: 36, unrated: 12,
    };
    const TRIGGER_KINDS: Record<string, { label: string; days: number; priority: string }> = {
      risk_increase:            { label: "Risk rating increased",            days: 14, priority: "high" },
      screening_match:          { label: "New screening match",              days: 7,  priority: "urgent" },
      adverse_media:            { label: "Adverse media identified",         days: 14, priority: "high" },
      ownership_change:         { label: "Ownership or control changed",     days: 30, priority: "normal" },
      transaction_change:       { label: "Material transaction change",      days: 30, priority: "normal" },
      counterparty_uncooperative: { label: "Counterparty uncooperative",     days: 14, priority: "high" },
      client_circumstances:     { label: "Client circumstances changed",     days: 30, priority: "normal" },
      other:                    { label: "Other trigger",                    days: 30, priority: "normal" },
    };
    const canReview = roles.has("reviewer") || isMlro;
    const OPEN_REVIEW_STATUSES = ["queued", "in_progress", "remediation_required"];

    async function reviewIntervalMonths(caseRow: any): Promise<number> {
      const { data: tenant } = await aml.from("tenant_settings")
        .select("review_interval_config").eq("tenant_id", (caseRow?.tenant_id as string) || "default").maybeSingle();
      const cfg = { ...DEFAULT_REVIEW_INTERVALS, ...((tenant?.review_interval_config as Record<string, number>) ?? {}) };
      const rating = String(caseRow?.risk_rating ?? "") || "unrated";
      const months = Number(cfg[rating] ?? cfg.unrated ?? 12);
      return Number.isFinite(months) && months > 0 ? months : 12;
    }

    function addMonths(from: Date, months: number): Date {
      const d = new Date(from.getTime());
      d.setUTCMonth(d.getUTCMonth() + months);
      return d;
    }

    if (op === "schedule_periodic_review") {
      requireWrite();
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const { data: caseRow } = await aml.from("cases")
        .select("id, client_id, tenant_id, risk_rating, monitoring_status").eq("id", caseId).maybeSingle();
      if (!caseRow) return jr({ error: "Case not found" }, 404);
      if (caseRow.monitoring_status === "ended") {
        return jr({ error: "The business relationship has ended — ongoing CDD is closed for this case", code: "relationship_ended" }, 409);
      }

      const { data: existing } = await aml.from("existing_customer_reviews")
        .select("id, status, due_at").eq("case_id", caseId).eq("classification", "periodic")
        .in("status", OPEN_REVIEW_STATUSES).limit(1).maybeSingle();
      if (existing) return jr({ review: existing, already_scheduled: true });

      const months = await reviewIntervalMonths(caseRow);
      const dueAt = (body.due_at ? new Date(String(body.due_at)) : addMonths(new Date(), months)).toISOString();
      const { data: review, error } = await aml.from("existing_customer_reviews").insert({
        case_id: caseId, client_id: caseRow.client_id ?? null,
        classification: "periodic", status: "queued",
        priority: caseRow.risk_rating === "high" || caseRow.risk_rating === "prohibited" ? "high" : "normal",
        due_at: dueAt, original_due_at: dueAt,
        assigned_to: body.assigned_to ? String(body.assigned_to) : null,
      }).select("*").single();
      if (error) return jr({ error: error.message }, 400);

      await aml.from("cases").update({ next_periodic_review_at: dueAt }).eq("id", caseId);
      await appendCaseEvent(admin, caseId, "system",
        `Periodic review scheduled for ${new Date(dueAt).toISOString().slice(0, 10)} (${months}-month cycle)`,
        { review_id: review.id, interval_months: months, risk_rating: caseRow.risk_rating ?? null },
        userId, userLabel);
      return jr({ review, interval_months: months });
    }

    if (op === "record_trigger_review") {
      requireWrite();
      const caseId = String(body.case_id ?? "");
      const triggerKind = String(body.trigger_kind ?? "");
      const detail = String(body.detail ?? "").trim();
      if (!caseId) return jr({ error: "case_id required" }, 400);
      if (!TRIGGER_KINDS[triggerKind]) return jr({ error: "trigger_kind invalid" }, 400);
      if (detail.length < 10) return jr({ error: "detail must be at least 10 characters" }, 400);
      const { data: caseRow } = await aml.from("cases")
        .select("id, client_id, monitoring_status").eq("id", caseId).maybeSingle();
      if (!caseRow) return jr({ error: "Case not found" }, 404);
      if (caseRow.monitoring_status === "ended") {
        return jr({ error: "The business relationship has ended — ongoing CDD is closed for this case", code: "relationship_ended" }, 409);
      }

      const spec = TRIGGER_KINDS[triggerKind];
      const dueAt = new Date(Date.now() + spec.days * 24 * 3600 * 1000).toISOString();
      const { data: review, error } = await aml.from("existing_customer_reviews").insert({
        case_id: caseId, client_id: caseRow.client_id ?? null,
        classification: "trigger_based", status: "queued", priority: spec.priority,
        due_at: dueAt, original_due_at: dueAt,
        trigger_kind: triggerKind,
        trigger_event_id: body.trigger_event_id ? String(body.trigger_event_id) : null,
        assigned_to: body.assigned_to ? String(body.assigned_to) : null,
        reviewer_notes: detail,
      }).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, caseId, "system",
        `Trigger-event review raised: ${spec.label}`,
        { review_id: review.id, trigger_kind: triggerKind, detail, due_at: dueAt }, userId, userLabel);
      return jr({ review });
    }

    if (op === "assign_review") {
      requireWrite();
      const id = String(body.id ?? "");
      const assignee = body.assigned_to ? String(body.assigned_to) : userId;
      if (!id) return jr({ error: "id required" }, 400);
      const { data, error } = await aml.from("existing_customer_reviews")
        .update({ assigned_to: assignee, status: body.status ? String(body.status) : "in_progress" })
        .eq("id", id).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      if (data?.case_id) {
        await appendCaseEvent(admin, data.case_id, "system",
          `Review assigned (${data.classification})`,
          { review_id: data.id, assigned_to: assignee, status: data.status }, userId, userLabel);
      }
      return jr({ review: data });
    }

    // Deadlines never move silently: the original date is preserved, each
    // extension is counted, and the reason is recorded on the case timeline.
    if (op === "extend_review_deadline") {
      requireWrite();
      const id = String(body.id ?? "");
      const newDue = String(body.due_at ?? "");
      const reason = String(body.reason ?? "").trim();
      if (!id || !newDue) return jr({ error: "id and due_at required" }, 400);
      if (reason.length < 10) return jr({ error: "reason must be at least 10 characters" }, 400);
      const parsed = new Date(newDue);
      if (Number.isNaN(parsed.getTime())) return jr({ error: "due_at must be a valid date" }, 400);
      const { data: existing } = await aml.from("existing_customer_reviews")
        .select("id, case_id, due_at, original_due_at, extension_count, classification, status").eq("id", id).maybeSingle();
      if (!existing) return jr({ error: "Review not found" }, 404);
      if (!OPEN_REVIEW_STATUSES.includes(String(existing.status))) {
        return jr({ error: "Only an open review can have its deadline extended" }, 400);
      }
      if (existing.due_at && parsed.getTime() <= new Date(existing.due_at).getTime()) {
        return jr({ error: "The new deadline must be later than the current one" }, 400);
      }

      const { data, error } = await aml.from("existing_customer_reviews").update({
        due_at: parsed.toISOString(),
        original_due_at: existing.original_due_at ?? existing.due_at,
        extension_count: Number(existing.extension_count ?? 0) + 1,
        extension_reason: reason,
      }).eq("id", id).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      if (data?.case_id) {
        await appendCaseEvent(admin, data.case_id, "system",
          `Review deadline extended to ${parsed.toISOString().slice(0, 10)}`,
          {
            review_id: id, previous_due_at: existing.due_at,
            original_due_at: data.original_due_at, extension_count: data.extension_count, reason,
          }, userId, userLabel);
      }
      if (data?.classification === "periodic" && data?.case_id) {
        await aml.from("cases").update({ next_periodic_review_at: parsed.toISOString() }).eq("id", data.case_id);
      }
      return jr({ review: data });
    }

    // Relationship end (§18 retention trigger): terminal, reasoned and
    // audited. Scheduled ongoing-CDD work is cancelled, never deleted — the
    // completed history and evidence stay exactly as recorded.
    if (op === "end_relationship") {
      if (!canReview) return jr({ error: "Reviewer/MLRO required" }, 403);
      const caseId = String(body.case_id ?? "");
      const reason = String(body.reason ?? "").trim();
      const endedAt = body.ended_at ? new Date(String(body.ended_at)) : new Date();
      if (!caseId) return jr({ error: "case_id required" }, 400);
      if (reason.length < 10) return jr({ error: "reason must be at least 10 characters" }, 400);
      if (Number.isNaN(endedAt.getTime())) return jr({ error: "ended_at must be a valid date" }, 400);

      const { data: caseRow } = await aml.from("cases")
        .select("id, monitoring_status").eq("id", caseId).maybeSingle();
      if (!caseRow) return jr({ error: "Case not found" }, 404);
      if (caseRow.monitoring_status === "ended") return jr({ error: "The relationship is already recorded as ended" }, 400);

      // Outstanding regulatory work must be resolved before the relationship
      // is closed off — otherwise obligations would be silently abandoned.
      const [{ count: openEdd }, { count: openAlerts }] = await Promise.all([
        aml.from("edd_cases").select("id", { count: "exact", head: true })
          .eq("case_id", caseId).in("status", ["open", "in_progress", "awaiting_client", "awaiting_mlro"]),
        aml.from("alerts").select("id", { count: "exact", head: true })
          .eq("case_id", caseId).in("status", ["open", "investigating"]),
      ]);
      if (((openEdd ?? 0) > 0 || (openAlerts ?? 0) > 0) && !isMlro) {
        return jr({
          error: "Outstanding enhanced due diligence or alerts must be resolved, or an MLRO must record the end",
          code: "open_obligations",
          open_edd: openEdd ?? 0, open_alerts: openAlerts ?? 0,
        }, 409);
      }

      const { data: cancelled } = await aml.from("existing_customer_reviews")
        .update({ status: "exited", outcome: "relationship_ended", outcome_at: new Date().toISOString(), outcome_by: userId })
        .eq("case_id", caseId).in("status", OPEN_REVIEW_STATUSES).select("id");

      const { data: updated, error } = await aml.from("cases").update({
        monitoring_status: "ended",
        monitoring_status_reason: reason,
        relationship_ended_at: endedAt.toISOString(),
        relationship_end_reason: reason,
        relationship_end_recorded_by: userId,
        next_periodic_review_at: null,
      }).eq("id", caseId).select("id, monitoring_status, relationship_ended_at").maybeSingle();
      if (error) return jr({ error: error.message }, 400);

      await appendCaseEvent(admin, caseId, "system",
        `Business relationship ended ${endedAt.toISOString().slice(0, 10)} — ongoing CDD closed`,
        {
          reason, ended_at: endedAt.toISOString(),
          reviews_cancelled: (cancelled ?? []).length,
          open_edd_at_close: openEdd ?? 0, open_alerts_at_close: openAlerts ?? 0,
        }, userId, userLabel);
      return jr({ case: updated, reviews_cancelled: (cancelled ?? []).length });
    }

    if (op === "set_monitoring_status") {
      const caseId = String(body.case_id ?? "");
      const status = String(body.status ?? "");
      const reason = String(body.reason ?? "").trim();
      if (!caseId) return jr({ error: "case_id required" }, 400);
      if (!["active", "paused"].includes(status)) {
        return jr({ error: "status must be active or paused — ending a relationship uses end_relationship" }, 400);
      }
      if (reason.length < 10) return jr({ error: "reason must be at least 10 characters" }, 400);
      const { data: caseRow } = await aml.from("cases")
        .select("id, monitoring_status").eq("id", caseId).maybeSingle();
      if (!caseRow) return jr({ error: "Case not found" }, 404);
      // Reinstating monitoring on an ended relationship reverses a regulatory
      // record — MLRO only.
      if (caseRow.monitoring_status === "ended" && !isMlro) {
        return jr({ error: "Only the MLRO can reinstate monitoring on an ended relationship" }, 403);
      }
      if (caseRow.monitoring_status !== "ended") requireWrite();

      const patch: Record<string, unknown> = { monitoring_status: status, monitoring_status_reason: reason };
      if (caseRow.monitoring_status === "ended" && status === "active") {
        patch.relationship_ended_at = null;
        patch.relationship_end_reason = null;
        patch.relationship_end_recorded_by = null;
      }
      const { data, error } = await aml.from("cases").update(patch)
        .eq("id", caseId).select("id, monitoring_status").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, caseId, "system",
        `Ongoing monitoring ${status === "paused" ? "paused" : "resumed"}`,
        { previous_status: caseRow.monitoring_status, status, reason }, userId, userLabel);
      return jr({ case: data });
    }

    // Per-case ongoing-CDD rollup for the Command Centre workspace.
    if (op === "case_monitoring_summary") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const nowIso = new Date().toISOString();
      const [caseRes, reviewsRes, alertsRes, eddRes, screenRes] = await Promise.all([
        aml.from("cases").select(
          "id, risk_rating, tenant_id, monitoring_status, monitoring_status_reason, relationship_ended_at, relationship_end_reason, next_periodic_review_at, last_periodic_review_at",
        ).eq("id", caseId).maybeSingle(),
        aml.from("existing_customer_reviews").select("*").eq("case_id", caseId)
          .order("due_at", { ascending: true, nullsFirst: false }).limit(50),
        aml.from("alerts").select("id, title, severity, status, created_at, assigned_to")
          .eq("case_id", caseId).in("status", ["open", "investigating"]).order("created_at", { ascending: false }).limit(20),
        aml.from("edd_cases").select("id, reason, status, opened_at, assigned_to")
          .eq("case_id", caseId).in("status", ["open", "in_progress", "awaiting_client", "awaiting_mlro"]).limit(20),
        aml.from("screening_checks").select("completed_at").eq("case_id", caseId)
          .not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const caseRow = caseRes.data;
      if (!caseRow) return jr({ error: "Case not found" }, 404);

      const reviews = reviewsRes.data ?? [];
      const openReviews = reviews.filter((r: any) => OPEN_REVIEW_STATUSES.includes(String(r.status)));
      const overdueReviews = openReviews.filter((r: any) => r.due_at && r.due_at < nowIso);

      // Rescreening cadence follows the enabled rescreen rule, defaulting to
      // an annual cycle when no rule is configured.
      const { data: rescreenRule } = await aml.from("monitoring_rules")
        .select("criteria").eq("trigger_kind", "rescreen_due").eq("is_enabled", true).limit(1).maybeSingle();
      const rescreenDays = Number((rescreenRule?.criteria as any)?.interval_days ?? 365);
      const lastScreened = screenRes.data?.completed_at ?? null;
      const rescreenDueAt = lastScreened
        ? new Date(new Date(lastScreened).getTime() + rescreenDays * 24 * 3600 * 1000).toISOString()
        : null;

      return jr({
        monitoring: {
          monitoring_status: caseRow.monitoring_status ?? "active",
          monitoring_status_reason: caseRow.monitoring_status_reason ?? null,
          relationship_ended_at: caseRow.relationship_ended_at ?? null,
          relationship_end_reason: caseRow.relationship_end_reason ?? null,
          risk_rating: caseRow.risk_rating ?? null,
          review_interval_months: await reviewIntervalMonths(caseRow),
          next_periodic_review_at: caseRow.next_periodic_review_at ?? null,
          last_periodic_review_at: caseRow.last_periodic_review_at ?? null,
          last_screened_at: lastScreened,
          rescreen_due_at: rescreenDueAt,
          rescreen_overdue: Boolean(rescreenDueAt && rescreenDueAt < nowIso),
          open_reviews: openReviews,
          overdue_review_count: overdueReviews.length,
          recent_reviews: reviews.slice(0, 10),
          open_alerts: alertsRes.data ?? [],
          open_edd: eddRes.data ?? [],
        },
      });
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

  // Phase 10: ongoing CDD runs for the applicable relationship period only.
  // Cases whose relationship has ended must not keep generating monitoring
  // work — their history stays intact, but no new obligations are raised.
  const { data: endedCases } = await aml.from("cases")
    .select("id").eq("monitoring_status", "ended").limit(2000);
  const endedIds = new Set<string>((endedCases ?? []).map((c: any) => String(c.id)));
  const isEnded = (caseId: unknown) => endedIds.has(String(caseId));

  const { data: rules } = await aml.from("monitoring_rules").select("*").eq("is_enabled", true);
  const rescreen = (rules ?? []).find((r: any) => r.trigger_kind === "rescreen_due");
  const staleIdv = (rules ?? []).find((r: any) => r.trigger_kind === "stale_verification");

  if (rescreen) {
    const days = Number(rescreen.criteria?.interval_days ?? 365);
    const cutoff = new Date(now - days * 24 * 3600 * 1000).toISOString();
    const { data: stale } = await aml.from("screening_checks").select("case_id, completed_at").lt("completed_at", cutoff).order("completed_at").limit(200);
    for (const s of stale ?? []) {
      if (isEnded(s.case_id)) continue;
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
      if (isEnded(s.case_id)) continue;
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

  // Phase 10: raise the periodic review when its scheduled date arrives, so
  // the risk-based cycle keeps running without manual scheduling.
  const nowIso = new Date().toISOString();
  const { data: dueCases } = await aml.from("cases")
    .select("id, client_id, risk_rating, next_periodic_review_at")
    .eq("monitoring_status", "active")
    .not("next_periodic_review_at", "is", null)
    .lte("next_periodic_review_at", nowIso)
    .limit(200);
  let periodicRaised = 0;
  for (const c of dueCases ?? []) {
    const { count } = await aml.from("existing_customer_reviews")
      .select("id", { count: "exact", head: true })
      .eq("case_id", c.id).eq("classification", "periodic")
      .in("status", ["queued", "in_progress", "remediation_required"]);
    if ((count ?? 0) > 0) continue;
    const { error } = await aml.from("existing_customer_reviews").insert({
      case_id: c.id, client_id: c.client_id ?? null,
      classification: "periodic", status: "queued",
      priority: c.risk_rating === "high" || c.risk_rating === "prohibited" ? "high" : "normal",
      due_at: c.next_periodic_review_at, original_due_at: c.next_periodic_review_at,
    });
    if (!error) periodicRaised += 1;
  }

  return {
    alerts_created: created.length,
    reviews_escalated: (overdue ?? []).length,
    periodic_reviews_raised: periodicRaised,
  };
}
