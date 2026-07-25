/**
 * Phase 4 — AML Identity Verification & Screening edge function.
 *
 * Ops:
 *   IDV:       initiate_idv, get_idv, list_idv, cancel_idv
 *   Screening: run_screening, list_screening, get_screening,
 *              list_matches, resolve_match
 *
 * Every paid provider call is wrapped in Mission Control reserve → commit
 * (or cancel on failure). Reads require any AML role; writes require
 * analyst / reviewer / MLRO. Auditor is read-only.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  getIdvProvider,
  getScreeningProvider,
  resolveTenantProvider,
  runWithMetrics,
  type ScreeningScope,
} from "../_shared/aml/providers/index.ts";

const DEFAULT_TENANT = "default";
async function resolveTenantId(admin: any, caseId: string): Promise<string> {
  try {
    const { data } = await admin.schema("aml").from("cases")
      .select("tenant_id").eq("id", caseId).maybeSingle();
    return (data?.tenant_id as string) || DEFAULT_TENANT;
  } catch { return DEFAULT_TENANT; }
}
import { reserveTokens, commitTokens, cancelTokens } from "../_shared/missionControl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token, x-command-centre-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const IDV_ESTIMATED_TOKENS = 400;
const SCREENING_ESTIMATED_TOKENS = 250;

const jr = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function appendCaseEvent(admin: any, caseId: string, category: string, summary: string, payload: any, actorId: string | null, actorLabel: string | null) {
  const { data: prev } = await admin.schema("aml").from("case_events")
    .select("row_hash").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({ case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, created_at: now }));
  await admin.schema("aml").from("case_events").insert({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const userEmail = auth.username ?? null;

    const { data: hasAny } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAny) return jr({ error: "AML role required" }, 403);

    const { data: roleRows } = await admin.schema("aml").from("role_assignments")
      .select("role").eq("user_id", userId).is("revoked_at", null);
    const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
    const canWrite = roles.has("analyst") || roles.has("reviewer") || roles.has("mlro");

    const op = String(body?.op ?? "");
    if (!op) return jr({ error: "op required" }, 400);

    switch (op) {
      // ---------------- IDV ----------------
      case "initiate_idv": {
        if (!canWrite) return jr({ error: "Write role required" }, 403);
        const caseId = String(body.case_id ?? "");
        if (!caseId) return jr({ error: "case_id required" }, 400);

        const { data: caseRow } = await admin.schema("aml").from("cases")
          .select("id, subject_display_name").eq("id", caseId).maybeSingle();
        if (!caseRow) return jr({ error: "Case not found" }, 404);

        const method: "document_and_liveness" | "document_only" | "database_lookup" | "manual" =
          ["document_and_liveness", "document_only", "database_lookup", "manual"].includes(body.method)
            ? body.method : "document_and_liveness";
        const tenantId = await resolveTenantId(admin, caseId);
        const resolved = await resolveTenantProvider(admin, tenantId, "idv");
        const provider = getIdvProvider({ resolved, preferred: body.provider });

        const idempotencyKey = `aml-idv-${caseId}-${Date.now()}`;
        let reservation: { jobId: string } | null = null;
        try {
          reservation = await reserveTokens({
            kind: "aml_identity_check",
            estimatedTokens: IDV_ESTIMATED_TOKENS,
            idempotencyKey,
            userId,
            requestPayload: { case_id: caseId, method, provider: provider.name },
          });
        } catch (e: any) {
          console.warn("[aml-verification] IDV token reserve failed", e?.message);
        }

        const { data: inserted, error: insertErr } = await admin.schema("aml").from("identity_checks").insert({
          case_id: caseId,
          subject_label: caseRow.subject_display_name,
          provider: provider.name,
          method,
          status: "in_progress",
          requested_by: userId,
          mc_job_id: reservation?.jobId ?? null,
          metadata: body.metadata ?? {},
        }).select().single();
        if (insertErr) throw insertErr;

        try {
          const result = await runWithMetrics(admin, {
            tenantId, capability: "idv", providerKey: provider.name,
            costCents: resolved?.costCents ?? 0, configId: resolved?.configId ?? null,
          }, () => provider.runIdv({
            caseId, subjectLabel: caseRow.subject_display_name, method, metadata: body.metadata,
          }));

          const { data: updated } = await admin.schema("aml").from("identity_checks").update({
            status: result.status,
            overall_score: result.overallScore,
            provider_reference: result.providerReference,
            result_payload: result.raw,
            completed_at: new Date().toISOString(),
            mc_tokens_committed: IDV_ESTIMATED_TOKENS,
          }).eq("id", inserted.id).select().single();

          if (reservation) {
            await commitTokens(reservation.jobId, IDV_ESTIMATED_TOKENS, {
              provider: provider.name, provider_reference: result.providerReference, status: result.status,
            });
          }

          await appendCaseEvent(admin, caseId, "idv_result",
            `IDV ${result.status} via ${provider.name} (score ${result.overallScore.toFixed(2)})`,
            { identity_check_id: inserted.id, provider_reference: result.providerReference, checks: result.checks },
            userId, userEmail);

          return jr({ identity_check: updated, result });
        } catch (e: any) {
          if (reservation) await cancelTokens(reservation.jobId, "idv_failed");
          await admin.schema("aml").from("identity_checks").update({
            status: "failed",
            result_payload: { error: e?.message ?? "provider_failure" },
            completed_at: new Date().toISOString(),
          }).eq("id", inserted.id);
          throw e;
        }
      }

      case "get_idv": {
        const id = String(body.id ?? "");
        if (!id) return jr({ error: "id required" }, 400);
        const { data: check } = await admin.schema("aml").from("identity_checks").select("*").eq("id", id).maybeSingle();
        if (!check) return jr({ error: "not found" }, 404);
        const { data: docs } = await admin.schema("aml").from("identity_documents").select("*").eq("identity_check_id", id);
        return jr({ identity_check: check, documents: docs ?? [] });
      }

      case "list_idv": {
        const caseId = body.case_id ? String(body.case_id) : null;
        let q = admin.schema("aml").from("identity_checks").select("*").order("requested_at", { ascending: false }).limit(Math.min(Number(body.limit ?? 100), 300));
        if (caseId) q = q.eq("case_id", caseId);
        if (body.status) q = q.eq("status", body.status);
        const { data } = await q;
        return jr({ identity_checks: data ?? [] });
      }

      case "cancel_idv": {
        if (!canWrite) return jr({ error: "Write role required" }, 403);
        const id = String(body.id ?? "");
        const { data: check } = await admin.schema("aml").from("identity_checks").select("*").eq("id", id).maybeSingle();
        if (!check) return jr({ error: "not found" }, 404);
        if (check.mc_job_id) await cancelTokens(check.mc_job_id, "analyst_cancelled");
        const { data: updated } = await admin.schema("aml").from("identity_checks")
          .update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", id).select().single();
        return jr({ identity_check: updated });
      }

      // ---------------- Screening ----------------
      case "run_screening": {
        if (!canWrite) return jr({ error: "Write role required" }, 403);
        const caseId = String(body.case_id ?? "");
        if (!caseId) return jr({ error: "case_id required" }, 400);

        const { data: caseRow } = await admin.schema("aml").from("cases")
          .select("id, subject_display_name, subject_type").eq("id", caseId).maybeSingle();
        if (!caseRow) return jr({ error: "Case not found" }, 404);

        const scope: ScreeningScope[] = Array.isArray(body.scope) && body.scope.length
          ? body.scope.filter((s: string) => ["pep", "sanctions", "adverse_media", "watchlist"].includes(s))
          : ["pep", "sanctions", "adverse_media"];
        const tenantId = await resolveTenantId(admin, caseId);
        const capability = scope.length === 1 && scope[0] === "adverse_media" ? "adverse_media" : "pep_sanctions";
        const resolved = await resolveTenantProvider(admin, tenantId, capability);
        const provider = getScreeningProvider({ resolved, preferred: body.provider });

        const idempotencyKey = `aml-scr-${caseId}-${Date.now()}`;
        let reservation: { jobId: string } | null = null;
        try {
          reservation = await reserveTokens({
            kind: "aml_screening_check",
            estimatedTokens: SCREENING_ESTIMATED_TOKENS,
            idempotencyKey,
            userId,
            requestPayload: { case_id: caseId, scope, provider: provider.name },
          });
        } catch (e: any) {
          console.warn("[aml-verification] screening reserve failed", e?.message);
        }

        const { data: inserted, error: insertErr } = await admin.schema("aml").from("screening_checks").insert({
          case_id: caseId,
          subject_label: caseRow.subject_display_name,
          subject_type: caseRow.subject_type ?? "individual",
          provider: provider.name,
          scope,
          status: "in_progress",
          requested_by: userId,
          mc_job_id: reservation?.jobId ?? null,
          metadata: body.metadata ?? {},
        }).select().single();
        if (insertErr) throw insertErr;

        try {
          const result = await runWithMetrics(admin, {
            tenantId, capability, providerKey: provider.name,
            costCents: resolved?.costCents ?? 0, configId: resolved?.configId ?? null,
          }, () => provider.runScreening({
            caseId, subjectLabel: caseRow.subject_display_name,
            subjectType: caseRow.subject_type ?? "individual", scope, metadata: body.metadata,
          }));

          const { data: updated } = await admin.schema("aml").from("screening_checks").update({
            status: result.status,
            provider_reference: result.providerReference,
            result_summary: result.summary,
            completed_at: new Date().toISOString(),
            mc_tokens_committed: SCREENING_ESTIMATED_TOKENS,
          }).eq("id", inserted.id).select().single();

          if (result.matches.length > 0) {
            await admin.schema("aml").from("screening_matches").insert(
              result.matches.map((m) => ({
                screening_check_id: inserted.id,
                case_id: caseId,
                match_type: m.matchType,
                list_name: m.listName,
                matched_name: m.matchedName,
                score: m.score,
                jurisdiction: m.jurisdiction,
                details: m.details,
              })),
            );
          }

          if (reservation) {
            await commitTokens(reservation.jobId, SCREENING_ESTIMATED_TOKENS, {
              provider: provider.name, status: result.status, matches: result.matches.length,
            });
          }

          if (result.matches.length > 0) {
            await appendCaseEvent(admin, caseId, "pep_sanctions_hit",
              `${result.matches.length} match(es) found via ${provider.name}`,
              { screening_check_id: inserted.id, summary: result.summary },
              userId, userEmail);
          } else {
            await appendCaseEvent(admin, caseId, "system",
              `Screening clear via ${provider.name}`,
              { screening_check_id: inserted.id }, userId, userEmail);
          }

          return jr({ screening_check: updated, result });
        } catch (e: any) {
          if (reservation) await cancelTokens(reservation.jobId, "screening_failed");
          await admin.schema("aml").from("screening_checks").update({
            status: "failed",
            result_summary: { error: e?.message ?? "provider_failure" },
            completed_at: new Date().toISOString(),
          }).eq("id", inserted.id);
          throw e;
        }
      }

      case "list_screening": {
        const caseId = body.case_id ? String(body.case_id) : null;
        let q = admin.schema("aml").from("screening_checks").select("*").order("requested_at", { ascending: false }).limit(Math.min(Number(body.limit ?? 100), 300));
        if (caseId) q = q.eq("case_id", caseId);
        if (body.status) q = q.eq("status", body.status);
        const { data } = await q;
        return jr({ screening_checks: data ?? [] });
      }

      case "get_screening": {
        const id = String(body.id ?? "");
        const { data: check } = await admin.schema("aml").from("screening_checks").select("*").eq("id", id).maybeSingle();
        if (!check) return jr({ error: "not found" }, 404);
        const { data: matches } = await admin.schema("aml").from("screening_matches").select("*").eq("screening_check_id", id).order("score", { ascending: false });
        return jr({ screening_check: check, matches: matches ?? [] });
      }

      case "list_matches": {
        let q = admin.schema("aml").from("screening_matches").select("*").order("created_at", { ascending: false }).limit(Math.min(Number(body.limit ?? 200), 500));
        if (body.case_id) q = q.eq("case_id", body.case_id);
        if (body.status) q = q.eq("status", body.status);
        else q = q.eq("status", "open"); // default queue view
        const { data } = await q;
        return jr({ matches: data ?? [] });
      }

      case "resolve_match": {
        if (!canWrite) return jr({ error: "Write role required" }, 403);
        const matchId = String(body.match_id ?? "");
        const disposition = String(body.disposition ?? "");
        const rationale = String(body.rationale ?? "").trim();
        if (!matchId || !["confirmed", "dismissed", "escalated"].includes(disposition) || rationale.length < 3) {
          return jr({ error: "match_id, disposition (confirmed|dismissed|escalated) and rationale required" }, 400);
        }
        const { data: match } = await admin.schema("aml").from("screening_matches").select("*").eq("id", matchId).maybeSingle();
        if (!match) return jr({ error: "match not found" }, 404);

        const { data: prev } = await admin.schema("aml").from("match_resolutions")
          .select("row_hash").eq("match_id", matchId).order("created_at", { ascending: false }).limit(1).maybeSingle();
        const prevHash = prev?.row_hash ?? null;
        const now = new Date().toISOString();
        const rowHash = await sha256Hex(JSON.stringify({
          match_id: matchId, case_id: match.case_id, disposition, rationale,
          resolved_by: userId, prev_hash: prevHash, created_at: now,
        }));

        const { data: resolution } = await admin.schema("aml").from("match_resolutions").insert({
          match_id: matchId,
          case_id: match.case_id,
          disposition,
          rationale,
          resolved_by: userId,
          resolved_by_label: userEmail,
          prev_hash: prevHash,
          row_hash: rowHash,
          created_at: now,
        }).select().single();

        const nextStatus = disposition === "confirmed" ? "confirmed"
          : disposition === "dismissed" ? "dismissed" : "escalated";
        const { data: updatedMatch } = await admin.schema("aml").from("screening_matches")
          .update({ status: nextStatus }).eq("id", matchId).select().single();

        await appendCaseEvent(admin, match.case_id, "mlro_decision",
          `Match ${match.matched_name} ${disposition} (${match.list_name ?? match.match_type})`,
          { match_id: matchId, disposition, rationale, resolution_id: resolution?.id },
          userId, userEmail);

        return jr({ resolution, match: updatedMatch });
      }

      default:
        return jr({ error: `Unknown op: ${op}` }, 400);
    }
  } catch (e: any) {
    console.error("[aml-verification] error", e);
    return jr({ error: e?.message ?? "internal_error" }, 500);
  }
});
