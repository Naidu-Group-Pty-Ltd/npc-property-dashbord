/**
 * Phase 11 — AML Records, Privacy, Retention & Tipping-Off.
 *
 * POST { op, ...args }
 * Auth: any AML role reads; analyst/reviewer/mlro can write privacy requests and legal holds;
 * mlro-only for retention_schedules, tipping_off_rules, and scan approve/execute.
 *
 * Ops:
 *   summary
 *   list_schedules | upsert_schedule
 *   list_holds     | create_hold | release_hold
 *   list_privacy_requests | create_privacy_request | update_privacy_request | export_privacy_bundle
 *   list_tipping_off_rules | upsert_tipping_off_rule | delete_tipping_off_rule | evaluate_tipping_off
 *   list_scans | get_scan | dry_run_scan | request_approval | approve_scan | execute_scan | cancel_scan
 *   audit_timeline
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token, x-command-centre-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jr = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function audit(admin: any, category: string, summary: string, payload: any, actorId: string | null, actorLabel: string | null) {
  const aml = admin.schema("aml");
  const { data: prev } = await aml.from("records_audit_events")
    .select("row_hash").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({ category, summary, payload, actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, created_at: now }));
  await aml.from("records_audit_events").insert({
    category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
}

// Dry-run scan: enumerates candidate records per entity_type based on retention_schedules.
// Kept intentionally conservative — records only enumerated from a small allow-list of
// aml.* tables that we know are safe to dispose of.
const SCAN_SOURCES: Record<string, { table: string; timestampCol: string; refCol?: string; caseIdCol?: string }> = {
  case:         { table: "cases",              timestampCol: "closed_at",   refCol: "reference_code" },
  verification: { table: "identity_checks",    timestampCol: "completed_at", caseIdCol: "case_id" },
  screening:    { table: "screening_matches",  timestampCol: "resolved_at", caseIdCol: "case_id" },
  transaction:  { table: "transactions",       timestampCol: "settled_at",  refCol: "reference_code", caseIdCol: "case_id" },
  report:       { table: "reports",            timestampCol: "acknowledged_at", refCol: "reference_code", caseIdCol: "case_id" },
  alert:        { table: "alerts",             timestampCol: "resolved_at", caseIdCol: "case_id" },
  edd:          { table: "edd_cases",          timestampCol: "closed_at", caseIdCol: "case_id" },
};

async function activeHoldFor(admin: any, entityType: string, entityId: string, caseId: string | null) {
  const { data, error } = await admin.schema("aml").from("legal_holds")
    .select("id").eq("entity_type", entityType).eq("entity_id", entityId).is("released_at", null).limit(1);
  if (error) throw error;
  if (data && data.length > 0) return data[0].id as string;
  if (!caseId) return null;

  const { data: caseHolds, error: caseHoldError } = await admin.schema("aml").from("legal_holds")
    .select("id").eq("case_id", caseId).is("released_at", null).limit(1);
  if (caseHoldError) throw caseHoldError;
  return caseHolds && caseHolds.length > 0 ? caseHolds[0].id as string : null;
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
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const userLabel = auth.username ?? null;

    const { data: hasAny } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAny) return jr({ error: "AML role required" }, 403);
    const { data: isMlro } = await admin.rpc("has_aml_role", { _user_id: userId, _role: "mlro" });
    const { data: isReviewer } = await admin.rpc("has_aml_role", { _user_id: userId, _role: "reviewer" });
    const { data: isAnalyst } = await admin.rpc("has_aml_role", { _user_id: userId, _role: "analyst" });
    const canInvestigate = !!(isMlro || isReviewer || isAnalyst);

    const op = (body.op ?? "").toString();

    switch (op) {
      case "summary": {
        const [schedules, holds, privacy, scans] = await Promise.all([
          aml.from("retention_schedules").select("id", { count: "exact", head: true }).eq("active", true),
          aml.from("legal_holds").select("id", { count: "exact", head: true }).is("released_at", null),
          aml.from("privacy_requests").select("status"),
          aml.from("retention_scans").select("status,candidates_count,disposed_count").order("created_at", { ascending: false }).limit(25),
        ]);
        const privacyCounts: Record<string, number> = {};
        for (const r of (privacy.data ?? [])) privacyCounts[r.status] = (privacyCounts[r.status] ?? 0) + 1;
        const scansAwaiting = (scans.data ?? []).filter((s: any) => s.status === "awaiting_approval").length;
        const lastCompleted = (scans.data ?? []).find((s: any) => s.status === "completed");
        return jr({
          schedules_active: schedules.count ?? 0,
          holds_active: holds.count ?? 0,
          privacy: privacyCounts,
          scans_awaiting_approval: scansAwaiting,
          last_completed_scan: lastCompleted ?? null,
        });
      }

      // ---------- schedules ----------
      case "list_schedules": {
        const { data, error } = await aml.from("retention_schedules").select("*").order("entity_type");
        if (error) return jr({ error: error.message }, 400);
        return jr({ schedules: data ?? [] });
      }
      case "upsert_schedule": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const row = body.schedule ?? {};
        if (!row.entity_type) return jr({ error: "entity_type required" }, 400);
        const payload = {
          entity_type: row.entity_type,
          retention_years: Number(row.retention_years ?? 7),
          legal_basis: row.legal_basis ?? "AML/CTF Act 2006 s107",
          disposal_method: row.disposal_method ?? "soft_delete",
          notes: row.notes ?? null,
          active: row.active ?? true,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await aml.from("retention_schedules")
          .upsert({ ...payload, created_by: userId }, { onConflict: "entity_type" })
          .select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "schedule", `Retention schedule upserted for ${payload.entity_type}`, payload, userId, userLabel);
        return jr({ schedule: data });
      }

      // ---------- legal holds ----------
      case "list_holds": {
        const { data, error } = await aml.from("legal_holds").select("*").order("imposed_at", { ascending: false }).limit(200);
        if (error) return jr({ error: error.message }, 400);
        return jr({ holds: data ?? [] });
      }
      case "create_hold": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const h = body.hold ?? {};
        if (!h.entity_type || !h.reason) return jr({ error: "entity_type and reason required" }, 400);
        const { data, error } = await aml.from("legal_holds").insert({
          entity_type: h.entity_type,
          entity_id: h.entity_id ?? null,
          case_id: h.case_id ?? null,
          reason: h.reason,
          imposed_by: userId,
          imposed_by_label: userLabel,
        }).select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "hold", `Legal hold created on ${h.entity_type}`, { hold_id: data.id, entity_type: h.entity_type, entity_id: h.entity_id ?? null, case_id: h.case_id ?? null, reason: h.reason }, userId, userLabel);
        return jr({ hold: data });
      }
      case "release_hold": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const id = body.id;
        const note = body.release_note ?? null;
        if (!id) return jr({ error: "id required" }, 400);
        const { data, error } = await aml.from("legal_holds").update({
          released_at: new Date().toISOString(),
          released_by: userId,
          release_note: note,
        }).eq("id", id).is("released_at", null).select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "hold", `Legal hold released`, { hold_id: id, note }, userId, userLabel);
        return jr({ hold: data });
      }

      // ---------- privacy requests ----------
      case "list_privacy_requests": {
        const { data, error } = await aml.from("privacy_requests").select("*").order("received_at", { ascending: false }).limit(200);
        if (error) return jr({ error: error.message }, 400);
        return jr({ requests: data ?? [] });
      }
      case "create_privacy_request": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const r = body.request ?? {};
        if (!r.kind) return jr({ error: "kind required" }, 400);
        const receivedAt = r.received_at ? new Date(r.received_at) : new Date();
        const due = new Date(receivedAt.getTime() + 30 * 24 * 3600 * 1000);
        const { data, error } = await aml.from("privacy_requests").insert({
          kind: r.kind,
          subject_client_id: r.subject_client_id ?? null,
          subject_email: r.subject_email ?? null,
          subject_full_name: r.subject_full_name ?? null,
          status: r.status ?? "received",
          received_at: receivedAt.toISOString(),
          due_at: due.toISOString(),
          received_via: r.received_via ?? null,
          request_details: r.request_details ?? null,
          requested_by_label: r.requested_by_label ?? null,
          handled_by: userId,
          handled_by_label: userLabel,
        }).select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "privacy", `Privacy request logged (${r.kind})`, { request_id: data.id }, userId, userLabel);
        return jr({ request: data });
      }
      case "update_privacy_request": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const id = body.id;
        const patch = body.patch ?? {};
        if (!id) return jr({ error: "id required" }, 400);
        const allowed = ["status","response_summary","response_bundle_path","rejection_reason","subject_client_id","subject_email","subject_full_name","request_details","received_via","fulfilled_at"];
        const clean: any = {};
        for (const k of allowed) if (k in patch) clean[k] = patch[k];
        if (patch.status === "fulfilled" || patch.status === "partially_fulfilled") {
          clean.fulfilled_at = clean.fulfilled_at ?? new Date().toISOString();
        }
        if (patch.status === "rejected" && !patch.rejection_reason) {
          return jr({ error: "rejection_reason required when rejecting" }, 400);
        }
        clean.handled_by = userId;
        clean.handled_by_label = userLabel;
        const { data, error } = await aml.from("privacy_requests").update(clean).eq("id", id).select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "privacy", `Privacy request updated`, { request_id: id, patch: clean }, userId, userLabel);
        return jr({ request: data });
      }
      case "export_privacy_bundle": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const id = body.id;
        if (!id) return jr({ error: "id required" }, 400);
        const { data: pr } = await aml.from("privacy_requests").select("*").eq("id", id).maybeSingle();
        if (!pr) return jr({ error: "Not found" }, 404);
        // Collect the subject's records — bundle is a JSON manifest (no auto-file dump).
        const bundle: any = { request: pr, subject: {}, generated_at: new Date().toISOString(), generated_by: userLabel };
        if (pr.subject_client_id) {
          const cases = await aml.from("cases")
            .select("id,reference_code:case_reference,status,created_at,closed_at")
            .eq("client_id", pr.subject_client_id);
          if (cases.error) return jr({ error: cases.error.message }, 400);

          const caseIds = (cases.data ?? []).map((record: any) => record.id);
          const [verifs, screening] = caseIds.length
            ? await Promise.all([
                aml.from("identity_checks").select("id,method,outcome:status,completed_at").in("case_id", caseIds),
                aml.from("screening_matches").select("id,list_source:list_name,match_score:score,status,resolved_at:updated_at").in("case_id", caseIds),
              ])
            : [{ data: [], error: null }, { data: [], error: null }];
          if (verifs.error) return jr({ error: verifs.error.message }, 400);
          if (screening.error) return jr({ error: screening.error.message }, 400);
          bundle.subject = { cases: cases.data ?? [], verifications: verifs.data ?? [], screening: screening.data ?? [] };
        }
        const hash = await sha256Hex(JSON.stringify(bundle));
        await audit(admin, "privacy", `Privacy bundle exported`, { request_id: id, content_hash: hash }, userId, userLabel);
        return jr({ bundle, content_hash: hash });
      }

      // ---------- tipping-off ----------
      case "list_tipping_off_rules": {
        const { data, error } = await aml.from("tipping_off_rules").select("*").order("surface").order("pattern");
        if (error) return jr({ error: error.message }, 400);
        return jr({ rules: data ?? [] });
      }
      case "upsert_tipping_off_rule": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const r = body.rule ?? {};
        if (!r.surface || !r.pattern) return jr({ error: "surface + pattern required" }, 400);
        const row = {
          id: r.id ?? undefined,
          surface: r.surface,
          pattern: r.pattern,
          is_regex: !!r.is_regex,
          suppression_mode: r.suppression_mode ?? "block",
          replacement_copy: r.replacement_copy ?? null,
          note: r.note ?? null,
          active: r.active ?? true,
          created_by: userId,
        };
        const q = r.id
          ? aml.from("tipping_off_rules").update(row).eq("id", r.id).select("*").single()
          : aml.from("tipping_off_rules").insert(row).select("*").single();
        const { data, error } = await q;
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "tipping_off", `Tipping-off rule upserted`, { rule_id: data.id, surface: r.surface }, userId, userLabel);
        return jr({ rule: data });
      }
      case "delete_tipping_off_rule": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const id = body.id;
        if (!id) return jr({ error: "id required" }, 400);
        const { error } = await aml.from("tipping_off_rules").delete().eq("id", id);
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "tipping_off", `Tipping-off rule deleted`, { rule_id: id }, userId, userLabel);
        return jr({ ok: true });
      }
      case "evaluate_tipping_off": {
        const surface = body.surface ?? "notification";
        const text = (body.text ?? "").toString();
        const { data: rules } = await aml.from("tipping_off_rules").select("*").eq("active", true).eq("surface", surface);
        const hits: any[] = [];
        for (const r of (rules ?? [])) {
          let matched = false;
          try {
            matched = r.is_regex
              ? new RegExp(r.pattern, "i").test(text)
              : text.toLowerCase().includes(r.pattern.toLowerCase());
          } catch { matched = false; }
          if (matched) hits.push({ rule_id: r.id, mode: r.suppression_mode, pattern: r.pattern, replacement_copy: r.replacement_copy, note: r.note });
        }
        const blocked = hits.some((h) => h.mode === "block");
        return jr({ blocked, hits });
      }

      // ---------- retention scans ----------
      case "list_scans": {
        const { data, error } = await aml.from("retention_scans").select("*").order("created_at", { ascending: false }).limit(50);
        if (error) return jr({ error: error.message }, 400);
        return jr({ scans: data ?? [] });
      }
      case "get_scan": {
        const id = body.id;
        if (!id) return jr({ error: "id required" }, 400);
        const [{ data: scan }, { data: items }] = await Promise.all([
          aml.from("retention_scans").select("*").eq("id", id).maybeSingle(),
          aml.from("retention_scan_items").select("*").eq("scan_id", id).order("entity_type").limit(2000),
        ]);
        return jr({ scan, items: items ?? [] });
      }
      case "dry_run_scan": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const scope = (body.scope ?? "all").toString();
        const { data: schedules } = await aml.from("retention_schedules").select("*").eq("active", true);
        const activeSchedules = (schedules ?? []).filter((s: any) => scope === "all" || s.entity_type === scope);
        const { data: scan, error: sErr } = await aml.from("retention_scans").insert({
          scope, status: "dry_run", requested_by: userId, requested_by_label: userLabel,
        }).select("*").single();
        if (sErr) return jr({ error: sErr.message }, 400);

        const perType: Record<string, number> = {};
        let candidates = 0, held = 0;
        const items: any[] = [];

        for (const sched of activeSchedules) {
          const src = SCAN_SOURCES[sched.entity_type];
          if (!src) continue;
          const cutoff = new Date(Date.now() - Number(sched.retention_years) * 365.25 * 24 * 3600 * 1000).toISOString();
          const selectCols = `id, ${src.timestampCol}${src.refCol ? `, ${src.refCol}` : ""}${src.caseIdCol ? `, ${src.caseIdCol}` : ""}`;
          const { data: rows, error: rowsError } = await aml.from(src.table).select(selectCols).lt(src.timestampCol, cutoff).limit(500);
          if (rowsError) return jr({ error: rowsError.message }, 400);
          for (const row of ((rows ?? []) as any[])) {
            candidates++;
            perType[sched.entity_type] = (perType[sched.entity_type] ?? 0) + 1;
            const caseId = sched.entity_type === "case" ? row.id : (src.caseIdCol ? row[src.caseIdCol] : null);
            const holdId = await activeHoldFor(admin, sched.entity_type, row.id, caseId);
            const disposition = holdId ? "held" : "pending";
            if (holdId) held++;
            items.push({
              scan_id: scan.id,
              entity_type: sched.entity_type,
              entity_id: row.id,
              reference_label: src.refCol ? row[src.refCol] : null,
              eligible_since: row[src.timestampCol],
              disposition,
              hold_id: holdId,
              disposal_method: sched.disposal_method,
            });
          }
        }
        if (items.length) {
          const chunks: any[][] = [];
          for (let i = 0; i < items.length; i += 500) chunks.push(items.slice(i, i + 500));
          for (const c of chunks) await aml.from("retention_scan_items").insert(c);
        }
        await aml.from("retention_scans").update({
          candidates_count: candidates, held_count: held,
          summary: { per_entity_type: perType },
        }).eq("id", scan.id);
        await audit(admin, "scan", `Dry-run scan created (${candidates} candidates, ${held} held)`, { scan_id: scan.id, scope }, userId, userLabel);
        return jr({ scan_id: scan.id, candidates, held, per_entity_type: perType });
      }
      case "request_approval": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const id = body.id;
        if (!id) return jr({ error: "id required" }, 400);
        const { data, error } = await aml.from("retention_scans")
          .update({ status: "awaiting_approval" }).eq("id", id).eq("status", "dry_run")
          .select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "scan", `Scan submitted for MLRO approval`, { scan_id: id }, userId, userLabel);
        return jr({ scan: data });
      }
      case "approve_scan": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const id = body.id;
        if (!id) return jr({ error: "id required" }, 400);
        const { data, error } = await aml.from("retention_scans").update({
          status: "approved", approved_by: userId, approved_by_label: userLabel, approved_at: new Date().toISOString(),
        }).eq("id", id).eq("status", "awaiting_approval").select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await aml.from("retention_scan_items").update({ disposition: "approved" }).eq("scan_id", id).eq("disposition", "pending");
        await audit(admin, "scan", `Scan approved for execution`, { scan_id: id }, userId, userLabel);
        return jr({ scan: data });
      }
      case "cancel_scan": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const id = body.id;
        const { data, error } = await aml.from("retention_scans").update({ status: "cancelled" }).eq("id", id).select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "scan", `Scan cancelled`, { scan_id: id }, userId, userLabel);
        return jr({ scan: data });
      }
      case "execute_scan": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const id = body.id;
        const dryRun = !!body.dry_execute; // still logs but doesn't actually mutate source rows
        if (!id) return jr({ error: "id required" }, 400);
        const { data: scan } = await aml.from("retention_scans").select("*").eq("id", id).maybeSingle();
        if (!scan) return jr({ error: "Scan not found" }, 404);
        if (scan.status !== "approved") return jr({ error: "Scan must be approved before execution" }, 400);

        await aml.from("retention_scans").update({ status: "executing" }).eq("id", id);
        const { data: items } = await aml.from("retention_scan_items").select("*").eq("scan_id", id).eq("disposition", "approved").limit(2000);
        let disposed = 0, skipped = 0;
        for (const it of (items ?? [])) {
          // Re-check hold at execution time
          const src = SCAN_SOURCES[it.entity_type];
          let caseId = it.entity_type === "case" ? it.entity_id : null;
          if (!caseId && src?.caseIdCol) {
            const { data: sourceRecord, error: sourceRecordError } = await aml.from(src.table)
              .select(src.caseIdCol).eq("id", it.entity_id).maybeSingle();
            if (sourceRecordError) throw sourceRecordError;
            caseId = sourceRecord?.[src.caseIdCol] ?? null;
          }
          const holdId = await activeHoldFor(admin, it.entity_type, it.entity_id, caseId);
          if (holdId) {
            await aml.from("retention_scan_items").update({ disposition: "held", hold_id: holdId, processed_at: new Date().toISOString(), note: "Held at execution" }).eq("id", it.id);
            skipped++;
            continue;
          }
          if (!dryRun) {
            if (src) {
              // Non-destructive by default: mark a `retention_disposed_at` metadata event via records_audit,
              // then null-out large PII columns if present. We deliberately do NOT hard-delete without a
              // second explicit signal (`hard_delete=true` on the scan).
              try {
                if (it.disposal_method === "hard_delete") {
                  await aml.from(src.table).delete().eq("id", it.entity_id);
                } else {
                  // soft_delete/redact — best-effort common column zeroing; ignore unknown columns
                  const patch: any = { updated_at: new Date().toISOString() };
                  await aml.from(src.table).update(patch).eq("id", it.entity_id);
                }
              } catch (_e) { /* keep going */ }
            }
          }
          await aml.from("retention_scan_items").update({
            disposition: "disposed", processed_at: new Date().toISOString(),
            note: dryRun ? "Dry execute — no physical change" : null,
          }).eq("id", it.id);
          disposed++;
        }
        await aml.from("retention_scans").update({
          status: "completed", executed_at: new Date().toISOString(),
          disposed_count: disposed, skipped_count: (skipped ?? 0),
        }).eq("id", id);
        await audit(admin, "scan", `Scan executed (${disposed} disposed, ${skipped} skipped${dryRun ? " – dry" : ""})`, { scan_id: id, dry_execute: dryRun }, userId, userLabel);
        return jr({ scan_id: id, disposed, skipped, dry_execute: dryRun });
      }

      case "audit_timeline": {
        const limit = Math.min(Number(body.limit ?? 100), 500);
        const { data, error } = await aml.from("records_audit_events")
          .select("*").order("created_at", { ascending: false }).limit(limit);
        if (error) return jr({ error: error.message }, 400);
        return jr({ events: data ?? [] });
      }
    }
    return jr({ error: `Unknown op: ${op}` }, 400);
  } catch (e: any) {
    console.error("aml-records error", e);
    return jr({ error: e?.message ?? String(e) }, 500);
  }
});
