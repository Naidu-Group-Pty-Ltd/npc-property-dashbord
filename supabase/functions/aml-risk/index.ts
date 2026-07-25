/**
 * Phase 5 — AML Risk Engine, Mandatory Holds, Decisions & Purchase-Ready Gate.
 *
 * Ops (single POST endpoint, {op, ...args}):
 *   Config:     list_factors, upsert_factor, list_triggers, upsert_trigger
 *   Assess:     evaluate, list_assessments, get_assessment
 *   Overrides:  request_override, resolve_override, list_overrides
 *   Decisions:  decide, list_decisions, latest_decision
 *   Approvals:  list_approvals, resolve_approval
 *   Conditions: list_conditions, upsert_condition, resolve_condition
 *   Gate:       gate_status  (feature-flag-guarded soft check)
 *
 * Read: any AML role. Write assessments/overrides/conditions: analyst/reviewer/mlro.
 * Approvals + decisions: reviewer/mlro. Configuration writes: mlro only.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token, x-command-centre-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jr = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function appendCaseEvent(
  admin: any, caseId: string, category: string, summary: string,
  payload: any, actorId: string | null, actorLabel: string | null,
) {
  const { data: prev } = await admin.schema("aml").from("case_events")
    .select("row_hash").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, created_at: now,
  }));
  await admin.schema("aml").from("case_events").insert({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
}

type Factor = { key: string; label: string; category: string; weight: number; scoring: Record<string, number>; active: boolean };
type Trigger = { key: string; label: string; severity: "block" | "hold"; rule: Record<string, any>; active: boolean };

function pickScore(scoring: Record<string, number>, value: unknown): number {
  if (value == null) return 0;
  const key = String(value).toLowerCase();
  if (typeof scoring[key] === "number") return scoring[key];
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function ratingFor(score: number): "low" | "medium" | "high" | "prohibited" {
  if (score >= 80) return "prohibited";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function evaluateFactors(factors: Factor[], inputs: Record<string, any>) {
  const completion: any[] = []; const verification: any[] = []; const mltf: any[] = [];
  let cW = 0, cS = 0, vW = 0, vS = 0, mW = 0, mS = 0;
  for (const f of factors) {
    if (!f.active) continue;
    const raw = inputs[f.key];
    const score = pickScore(f.scoring, raw);
    const weighted = score * (f.weight || 1);
    const entry = { key: f.key, label: f.label, input: raw ?? null, score, weight: f.weight, weighted };
    if (f.category === "completion") { completion.push(entry); cW += f.weight; cS += weighted; }
    else if (f.category === "verification") { verification.push(entry); vW += f.weight; vS += weighted; }
    else { mltf.push(entry); mW += f.weight; mS += weighted; }
  }
  const norm = (s: number, w: number) => (w > 0 ? Math.min(100, Math.max(0, s / w)) : 0);
  return {
    completion_score: norm(cS, cW),
    verification_score: norm(vS, vW),
    mltf_score: norm(mS, mW),
    factor_breakdown: [...mltf, ...completion, ...verification],
  };
}

function evaluateTriggers(triggers: Trigger[], inputs: Record<string, any>) {
  const holds: any[] = [];
  for (const t of triggers) {
    if (!t.active) continue;
    const rule = t.rule ?? {};
    let match = true;
    for (const [k, expected] of Object.entries(rule)) {
      const actual = inputs[k];
      if (expected && typeof expected === "object" && !Array.isArray(expected)) {
        for (const [sk, sv] of Object.entries(expected as any)) {
          const inner = actual && typeof actual === "object" ? (actual as any)[sk] : undefined;
          if (inner !== sv) { match = false; break; }
        }
      } else if (String(actual ?? "").toLowerCase() !== String(expected).toLowerCase()) {
        match = false;
      }
      if (!match) break;
    }
    if (match) holds.push({ key: t.key, label: t.label, severity: t.severity });
  }
  return holds;
}

async function authoritativeMandatoryInputs(admin: any, caseId: string): Promise<Record<string, any>> {
  const [{ data: failedIdv }, { data: confirmedSanctions }] = await Promise.all([
    admin.schema("aml").from("identity_checks")
      .select("id, status, completed_at, updated_at")
      .eq("case_id", caseId)
      .eq("status", "failed")
      .limit(1),
    admin.schema("aml").from("screening_matches")
      .select("id, match_type, status, updated_at")
      .eq("case_id", caseId)
      .eq("match_type", "sanctions")
      .eq("status", "confirmed")
      .limit(1),
  ]);

  const inputs: Record<string, any> = {};
  if ((failedIdv ?? []).length > 0) inputs.idv = "failed";
  if ((confirmedSanctions ?? []).length > 0) inputs.screening = { confirmed_match: true };
  return inputs;
}

function blockingHolds(assessment: any): any[] {
  return ((assessment?.triggered_holds ?? []) as any[]).filter((h) => h?.severity === "block");
}

async function clearanceBlockReasons(admin: any, caseId: string, assessment: any, openConditions: any[] = []): Promise<string[]> {
  const authoritativeInputs = await authoritativeMandatoryInputs(admin, caseId);
  const { data: triggers } = await admin.schema("aml").from("mandatory_triggers").select("*").eq("active", true);
  const authoritativeHolds = evaluateTriggers((triggers ?? []) as Trigger[], authoritativeInputs);
  const reasons: string[] = [];

  if (!assessment) reasons.push("no_assessment");
  if (openConditions.length > 0) reasons.push(`${openConditions.length}_open_conditions`);

  const assessmentBlocks = blockingHolds(assessment);
  if (assessmentBlocks.length > 0) reasons.push(`${assessmentBlocks.length}_blocking_holds`);

  const authoritativeBlocks = authoritativeHolds.filter((h) => h.severity === "block");
  for (const hold of authoritativeBlocks) reasons.push(`authoritative_${hold.key}`);

  return Array.from(new Set(reasons));
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
    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const userLabel = auth.username ?? null;
    const { data: hasAny } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAny) return jr({ error: "AML role required" }, 403);

    const { data: roleRows } = await admin.schema("aml").from("role_assignments")
      .select("role").eq("user_id", userId).is("revoked_at", null);
    const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
    const canWrite = roles.has("analyst") || roles.has("reviewer") || roles.has("mlro");
    const canReview = roles.has("reviewer") || roles.has("mlro");
    const isMlro = roles.has("mlro");

    const op = String(body?.op ?? "");

    // ─── Configuration ─────────────────────────────────────────────
    if (op === "list_factors") {
      const { data } = await admin.schema("aml").from("risk_factors").select("*").order("category").order("label");
      return jr({ factors: data ?? [] });
    }
    if (op === "list_triggers") {
      const { data } = await admin.schema("aml").from("mandatory_triggers").select("*").order("severity").order("label");
      return jr({ triggers: data ?? [] });
    }
    if (op === "upsert_factor") {
      if (!isMlro) return jr({ error: "MLRO required" }, 403);
      const patch = body.factor ?? {};
      const { data, error } = await admin.schema("aml").from("risk_factors")
        .upsert({ ...patch, created_by: patch.id ? undefined : userId }, { onConflict: "key" })
        .select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ factor: data });
    }
    if (op === "upsert_trigger") {
      if (!isMlro) return jr({ error: "MLRO required" }, 403);
      const patch = body.trigger ?? {};
      const { data, error } = await admin.schema("aml").from("mandatory_triggers")
        .upsert({ ...patch, created_by: patch.id ? undefined : userId }, { onConflict: "key" })
        .select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ trigger: data });
    }

    // ─── Assessments ───────────────────────────────────────────────
    if (op === "evaluate") {
      if (!canWrite) return jr({ error: "Insufficient permissions" }, 403);
      const caseId = String(body.case_id ?? "");
      const inputs = (body.inputs ?? {}) as Record<string, any>;
      if (!caseId) return jr({ error: "case_id required" }, 400);

      // Resolve tenant policy for this case
      const { data: caseRow } = await admin.schema("aml").from("cases")
        .select("id, tenant_id, status").eq("id", caseId).maybeSingle();
      const tenantId = (caseRow?.tenant_id as string) || "default";
      const { data: tenant } = await admin.schema("aml").from("tenant_settings")
        .select("risk_program_version, straight_through_config").eq("tenant_id", tenantId).maybeSingle();
      const programVersion = (tenant?.risk_program_version as string) || "v1";
      const stConfig = (tenant?.straight_through_config as any) || { enabled: false };

      const [{ data: fs }, { data: ts }] = await Promise.all([
        admin.schema("aml").from("risk_factors").select("*").eq("active", true),
        admin.schema("aml").from("mandatory_triggers").select("*").eq("active", true),
      ]);

      const authoritativeInputs = await authoritativeMandatoryInputs(admin, caseId);
      const effectiveInputs = { ...inputs, ...authoritativeInputs };
      const scored = evaluateFactors((fs ?? []) as Factor[], effectiveInputs);
      const holds = evaluateTriggers((ts ?? []) as Trigger[], effectiveInputs);
      const blocking = holds.some((h) => h.severity === "block");
      const rating = blocking ? "prohibited" : ratingFor(scored.mltf_score);

      // Explainability: top ± contributors + trigger reasons
      const sortedFactors = [...scored.factor_breakdown].sort((a, b) => Math.abs(b.weighted) - Math.abs(a.weighted));
      const explanation = {
        top_positive: sortedFactors.filter((f) => f.weighted > 0).slice(0, 5),
        top_neutral_missing: sortedFactors.filter((f) => f.input == null).slice(0, 5),
        trigger_reasons: holds.map((h) => ({ key: h.key, label: h.label, severity: h.severity })),
        rating_band: rating,
        thresholds: { medium: 30, high: 60, prohibited: 80 },
      };

      // Policy provenance hash — captures the active factor+trigger set at eval time
      const policySnapshotHash = await sha256Hex(JSON.stringify({
        program_version: programVersion,
        factors: (fs ?? []).map((f: any) => ({ k: f.key, w: f.weight, s: f.scoring, a: f.active })).sort((a, b) => a.k.localeCompare(b.k)),
        triggers: (ts ?? []).map((t: any) => ({ k: t.key, s: t.severity, r: t.rule, a: t.active })).sort((a, b) => a.k.localeCompare(b.k)),
      }));

      // Straight-through eligibility
      const stEnabled = Boolean(stConfig?.enabled);
      const stEligible = canReview
        && stEnabled
        && rating === "low"
        && holds.length === 0
        && scored.mltf_score <= (Number(stConfig?.max_mltf_score) || 25)
        && scored.completion_score <= (Number(stConfig?.require_completion_score) || 70)
        && scored.verification_score <= (Number(stConfig?.require_verification_score) || 70);

      const { data: ass, error } = await admin.schema("aml").from("risk_assessments").insert({
        case_id: caseId,
        completion_score: scored.completion_score,
        verification_score: scored.verification_score,
        mltf_score: scored.mltf_score,
        risk_rating: rating,
        triggered_holds: holds,
        factor_breakdown: scored.factor_breakdown,
        inputs: effectiveInputs,
        computed_by: userId,
        program_version: programVersion,
        policy_snapshot_hash: policySnapshotHash,
        explanation,
        straight_through: stEligible,
      }).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);

      // reflect on case
      await admin.schema("aml").from("cases").update({
        risk_rating: rating,
        risk_score: Math.round(scored.mltf_score),
      }).eq("id", caseId);

      await appendCaseEvent(admin, caseId, "risk_rescored",
        `Risk assessment computed — ${rating.toUpperCase()} (${Math.round(scored.mltf_score)}) [policy ${programVersion}]`,
        { assessment_id: ass?.id, holds, scores: scored, program_version: programVersion, policy_snapshot_hash: policySnapshotHash },
        userId, userLabel);

      // Straight-through auto-decision (low risk, clean, tenant-enabled)
      let auto_decision: any = null;
      if (stEligible) {
        const snapshot = {
          version: 1, decided_at: new Date().toISOString(), decided_by: userId,
          outcome: "cleared", rationale: `Straight-through auto-clearance under policy ${programVersion}`,
          case: caseRow, assessment: ass, open_conditions: [], approved_overrides: [],
          straight_through: true, straight_through_config: stConfig,
        };
        const snapshot_hash = await sha256Hex(JSON.stringify(snapshot));
        const { data: dec } = await admin.schema("aml").from("decisions").insert({
          case_id: caseId, assessment_id: ass?.id ?? null, outcome: "cleared",
          rationale: `Straight-through auto-clearance (policy ${programVersion}) — low MLTF, no holds, thresholds met.`,
          snapshot, snapshot_hash, decided_by: userId,
          program_version: programVersion, is_straight_through: true,
        }).select("*").maybeSingle();
        auto_decision = dec;
        await admin.schema("aml").from("cases").update({ status: "cleared" }).eq("id", caseId);
        await appendCaseEvent(admin, caseId, "mlro_decision",
          `Straight-through auto-cleared (policy ${programVersion})`,
          { decision_id: dec?.id, snapshot_hash, straight_through: true }, userId, userLabel);
      }

      return jr({ assessment: ass, auto_decision, program_version: programVersion, straight_through: stEligible });
    }


    if (op === "list_assessments") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const { data } = await admin.schema("aml").from("risk_assessments")
        .select("*").eq("case_id", caseId).order("created_at", { ascending: false }).limit(50);
      return jr({ assessments: data ?? [] });
    }

    if (op === "get_assessment") {
      const id = String(body.assessment_id ?? "");
      const { data } = await admin.schema("aml").from("risk_assessments").select("*").eq("id", id).maybeSingle();
      return jr({ assessment: data });
    }

    // ─── Overrides ─────────────────────────────────────────────────
    if (op === "request_override") {
      if (!canWrite) return jr({ error: "Insufficient permissions" }, 403);
      const { case_id, assessment_id, requested_reason, requested_rating } = body;
      if (!case_id || !requested_reason) return jr({ error: "case_id and requested_reason required" }, 400);
      const { data, error } = await admin.schema("aml").from("risk_overrides").insert({
        case_id, assessment_id: assessment_id ?? null, requested_by: userId,
        requested_reason, requested_rating: requested_rating ?? null, status: "pending",
      }).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, case_id, "edd_note", `Risk override requested`, { override_id: data?.id, requested_rating }, userId, userLabel);
      return jr({ override: data });
    }

    if (op === "resolve_override") {
      if (!canReview) return jr({ error: "Reviewer/MLRO required" }, 403);
      const { override_id, status, reviewer_note } = body;
      if (!override_id || !["approved", "rejected"].includes(status)) return jr({ error: "invalid" }, 400);
      const { data, error } = await admin.schema("aml").from("risk_overrides").update({
        status, reviewer_id: userId, reviewer_note: reviewer_note ?? null, decided_at: new Date().toISOString(),
      }).eq("id", override_id).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (data) {
        if (status === "approved" && data.requested_rating) {
          await admin.schema("aml").from("cases").update({ risk_rating: data.requested_rating }).eq("id", data.case_id);
        }
        await appendCaseEvent(admin, data.case_id, "mlro_decision",
          `Risk override ${status}`, { override_id, reviewer_note }, userId, userLabel);
      }
      return jr({ override: data });
    }

    if (op === "list_overrides") {
      const caseId = body.case_id ? String(body.case_id) : null;
      let q = admin.schema("aml").from("risk_overrides").select("*").order("created_at", { ascending: false }).limit(200);
      if (caseId) q = q.eq("case_id", caseId);
      if (body.status) q = q.eq("status", body.status);
      const { data } = await q;
      return jr({ overrides: data ?? [] });
    }

    // ─── Decisions ─────────────────────────────────────────────────
    if (op === "decide") {
      if (!canReview) return jr({ error: "Reviewer/MLRO required" }, 403);
      const { case_id, assessment_id, outcome, rationale } = body;
      if (!case_id || !outcome) return jr({ error: "case_id and outcome required" }, 400);
      const [{ data: caseRow }, { data: ass }, { data: conds }, { data: overs }] = await Promise.all([
        admin.schema("aml").from("cases").select("*").eq("id", case_id).maybeSingle(),
        assessment_id
          ? admin.schema("aml").from("risk_assessments").select("*").eq("id", assessment_id).maybeSingle()
          : admin.schema("aml").from("risk_assessments").select("*").eq("case_id", case_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        admin.schema("aml").from("case_conditions").select("*").eq("case_id", case_id).eq("status", "open"),
        admin.schema("aml").from("risk_overrides").select("*").eq("case_id", case_id).eq("status", "approved"),
      ]);

      const tenantId = (caseRow?.tenant_id as string) || "default";
      const { data: tenant } = await admin.schema("aml").from("tenant_settings")
        .select("risk_program_version").eq("tenant_id", tenantId).maybeSingle();
      const programVersion = (tenant?.risk_program_version as string) || (ass?.program_version as string) || "v1";

      const clearanceReasons = outcome === "cleared"
        ? await clearanceBlockReasons(admin, case_id, ass, conds ?? [])
        : [];
      if (clearanceReasons.length > 0) {
        return jr({ error: "Cannot clear AML case with unresolved mandatory holds", reasons: clearanceReasons }, 409);
      }

      const snapshot = {
        version: 1, decided_at: new Date().toISOString(), decided_by: userId,
        outcome, rationale: rationale ?? null, program_version: programVersion,
        case: caseRow, assessment: ass, open_conditions: conds ?? [], approved_overrides: overs ?? [],
      };
      const snapshot_hash = await sha256Hex(JSON.stringify(snapshot));

      const { data: dec, error } = await admin.schema("aml").from("decisions").insert({
        case_id, assessment_id: ass?.id ?? null, outcome, rationale: rationale ?? null,
        snapshot, snapshot_hash, decided_by: userId,
        program_version: programVersion, is_straight_through: false,
      }).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);

      // Reflect on case status
      let toStatus: string | null = null;
      if (outcome === "cleared") toStatus = "cleared";
      else if (outcome === "blocked") toStatus = "blocked";
      else if (outcome === "escalated") toStatus = "escalated_mlro";
      if (toStatus) await admin.schema("aml").from("cases").update({ status: toStatus }).eq("id", case_id);

      await appendCaseEvent(admin, case_id, "mlro_decision",
        `Decision recorded: ${outcome} [policy ${programVersion}]`,
        { decision_id: dec?.id, snapshot_hash, program_version: programVersion }, userId, userLabel);
      return jr({ decision: dec });
    }

    if (op === "policy_snapshot") {
      const tenantId = String(body.tenant_id ?? "default");
      const [{ data: tenant }, { data: fs }, { data: ts }] = await Promise.all([
        admin.schema("aml").from("tenant_settings")
          .select("risk_program_version, straight_through_config").eq("tenant_id", tenantId).maybeSingle(),
        admin.schema("aml").from("risk_factors").select("*").eq("active", true).order("category").order("label"),
        admin.schema("aml").from("mandatory_triggers").select("*").eq("active", true).order("severity").order("label"),
      ]);
      const programVersion = (tenant?.risk_program_version as string) || "v1";
      const snapshotHash = await sha256Hex(JSON.stringify({
        program_version: programVersion,
        factors: (fs ?? []).map((f: any) => ({ k: f.key, w: f.weight, s: f.scoring, a: f.active })).sort((a, b) => a.k.localeCompare(b.k)),
        triggers: (ts ?? []).map((t: any) => ({ k: t.key, s: t.severity, r: t.rule, a: t.active })).sort((a, b) => a.k.localeCompare(b.k)),
      }));
      return jr({
        program_version: programVersion,
        straight_through_config: tenant?.straight_through_config ?? { enabled: false },
        policy_snapshot_hash: snapshotHash,
        factors: fs ?? [],
        triggers: ts ?? [],
        tenant_id: tenantId,
      });
    }

    if (op === "update_risk_policy") {
      if (!isMlro) return jr({ error: "MLRO required" }, 403);
      const tenantId = String(body.tenant_id ?? "default");
      const patch: Record<string, any> = {};
      if (typeof body.risk_program_version === "string") patch.risk_program_version = body.risk_program_version;
      if (body.straight_through_config && typeof body.straight_through_config === "object") {
        patch.straight_through_config = body.straight_through_config;
      }
      if (Object.keys(patch).length === 0) return jr({ error: "Nothing to update" }, 400);
      const { data, error } = await admin.schema("aml").from("tenant_settings")
        .update(patch).eq("tenant_id", tenantId).select("tenant_id, risk_program_version, straight_through_config").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ tenant: data });
    }


    if (op === "list_decisions") {
      const caseId = String(body.case_id ?? "");
      const { data } = await admin.schema("aml").from("decisions")
        .select("*").eq("case_id", caseId).order("decided_at", { ascending: false });
      return jr({ decisions: data ?? [] });
    }

    if (op === "latest_decision") {
      const caseId = String(body.case_id ?? "");
      const { data } = await admin.schema("aml").from("decisions")
        .select("*").eq("case_id", caseId).order("decided_at", { ascending: false }).limit(1).maybeSingle();
      return jr({ decision: data });
    }

    // ─── Approvals (senior authority sign-off queue) ───────────────
    if (op === "list_approvals") {
      let q = admin.schema("aml").from("approvals").select("*").order("requested_at", { ascending: false }).limit(200);
      if (body.case_id) q = q.eq("case_id", body.case_id);
      if (body.status) q = q.eq("status", body.status);
      const { data } = await q;
      return jr({ approvals: data ?? [] });
    }
    if (op === "resolve_approval") {
      if (!canReview) return jr({ error: "Reviewer/MLRO required" }, 403);
      const { approval_id, status, note } = body;
      if (!approval_id || !["approved", "rejected"].includes(status)) return jr({ error: "invalid" }, 400);
      const { data, error } = await admin.schema("aml").from("approvals").update({
        status, approver_id: userId, note: note ?? null, resolved_at: new Date().toISOString(),
      }).eq("id", approval_id).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (data) await appendCaseEvent(admin, data.case_id, "mlro_decision", `Approval ${status}`, { approval_id, note }, userId, userLabel);
      return jr({ approval: data });
    }

    // ─── Conditions ────────────────────────────────────────────────
    if (op === "list_conditions") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const { data } = await admin.schema("aml").from("case_conditions")
        .select("*").eq("case_id", caseId).order("created_at", { ascending: false });
      return jr({ conditions: data ?? [] });
    }
    if (op === "upsert_condition") {
      if (!canWrite) return jr({ error: "Insufficient permissions" }, 403);
      const patch = body.condition ?? {};
      const row = { ...patch, created_by: patch.id ? undefined : userId };
      const { data, error } = await admin.schema("aml").from("case_conditions")
        .upsert(row).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (data) await appendCaseEvent(admin, data.case_id, "edd_note",
        `Case condition ${patch.id ? "updated" : "added"}: ${data.label}`, { condition_id: data.id }, userId, userLabel);
      return jr({ condition: data });
    }
    if (op === "resolve_condition") {
      if (!canWrite) return jr({ error: "Insufficient permissions" }, 403);
      const { condition_id, status } = body;
      const { data, error } = await admin.schema("aml").from("case_conditions").update({
        status: status ?? "resolved", resolved_by: userId, resolved_at: new Date().toISOString(),
      }).eq("id", condition_id).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (data) await appendCaseEvent(admin, data.case_id, "edd_note", `Condition ${data.status}: ${data.label}`, { condition_id }, userId, userLabel);
      return jr({ condition: data });
    }

    // ─── Purchase-Ready Gate (soft, flag-guarded) ──────────────────
    if (op === "gate_status") {
      const caseId = body.case_id ? String(body.case_id) : null;
      const purchaseFileId = body.purchase_file_id ? String(body.purchase_file_id) : null;
      const { data: flag } = await admin.from("feature_flags").select("value").eq("key", "aml_purchase_ready_gate").maybeSingle();
      const enabled = Boolean((flag?.value as any)?.enabled);

      let effectiveCaseId = caseId;
      if (!effectiveCaseId && purchaseFileId) {
        const { data: c } = await admin.schema("aml").from("cases")
          .select("id").eq("purchase_file_id", purchaseFileId).order("opened_at", { ascending: false }).limit(1).maybeSingle();
        effectiveCaseId = c?.id ?? null;
      }
      if (!effectiveCaseId) return jr({ enabled, gate: "no_case", purchase_ready: !enabled, reasons: enabled ? ["no_aml_case"] : [] });

      const [{ data: dec }, { data: cond }, { data: ass }] = await Promise.all([
        admin.schema("aml").from("decisions").select("*").eq("case_id", effectiveCaseId).order("decided_at", { ascending: false }).limit(1).maybeSingle(),
        admin.schema("aml").from("case_conditions").select("*").eq("case_id", effectiveCaseId).eq("status", "open"),
        admin.schema("aml").from("risk_assessments").select("*").eq("case_id", effectiveCaseId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      const reasons: string[] = [];
      if (!dec) reasons.push("no_decision");
      else if (dec.outcome !== "cleared") reasons.push(`decision_${dec.outcome}`);
      reasons.push(...await clearanceBlockReasons(admin, effectiveCaseId, ass, cond ?? []));

      const purchase_ready = reasons.length === 0;
      // If gate flag disabled we still return the diagnostic but purchase_ready defaults to true.
      return jr({
        enabled,
        purchase_ready: enabled ? purchase_ready : true,
        diagnostic: { purchase_ready, reasons, latest_decision: dec, open_conditions: cond ?? [], latest_assessment: ass },
      });
    }

    return jr({ error: `Unknown op: ${op}` }, 400);
  } catch (e) {
    console.error("aml-risk error", e);
    return jr({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
