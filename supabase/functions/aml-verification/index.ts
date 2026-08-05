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
  currentEnvironment,
  ProviderResolutionError,
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

async function hasCaseAccess(
  admin: any,
  userId: string,
  caseId: string,
  requireWriteRole = false,
): Promise<boolean> {
  const { data: caseRow, error: caseError } = await admin.schema("aml").from("cases")
    .select("tenant_id").eq("id", caseId).maybeSingle();
  if (caseError || !caseRow?.tenant_id) return false;

  const aml = admin.schema("aml");
  if (!requireWriteRole) {
    const { data, error } = await aml.rpc("has_any_tenant_aml_role", {
      _user_id: userId,
      _tenant_id: caseRow.tenant_id,
    });
    return !error && data === true;
  }

  for (const role of ["analyst", "reviewer", "mlro"]) {
    const { data, error } = await aml.rpc("has_tenant_aml_role", {
      _user_id: userId,
      _tenant_id: caseRow.tenant_id,
      _role: role,
    });
    if (!error && data === true) return true;
  }
  return false;
}
import { reserveTokens, commitTokens, cancelTokens } from "../_shared/missionControl.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Owner decision of 2026-07-28: one attempt plus two retries. */
const MAX_VERIFICATION_ATTEMPTS = 3;

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

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
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
        // Provider resolution happens BEFORE anything is written: a refusal
        // (production simulator block, missing configuration) must never
        // create an identity_checks row, consume an attempt, or read as a
        // customer failure. It is an operator condition, answered as 409.
        let provider;
        try {
          provider = getIdvProvider({ resolved, preferred: body.provider });
        } catch (resolutionErr: any) {
          if (resolutionErr instanceof ProviderResolutionError) {
            return jr({
              error: resolutionErr.message.replace(/^\[aml\/providers\]\s*/, ""),
              code: resolutionErr.code,
              environment: currentEnvironment(),
            }, 409);
          }
          throw resolutionErr;
        }

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
          // An infrastructure/provider failure is NOT a verification result.
          // The row records that a request never produced an outcome —
          // "failed" is reserved for a provider that actually examined the
          // subject and said no.
          await admin.schema("aml").from("identity_checks").update({
            status: "pending",
            result_payload: {
              error_category: "provider_unavailable",
              error: String(e?.message ?? "provider_failure").slice(0, 300),
              attempt_not_consumed: true,
            },
            completed_at: new Date().toISOString(),
          }).eq("id", inserted.id);
          return jr({
            error: "The verification provider could not be reached. The request was recorded and no result was produced — try again once Integration Health shows the provider is available.",
            code: "provider_unavailable",
          }, 502);
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
        let provider;
        try {
          provider = getScreeningProvider({ resolved, preferred: body.provider });
        } catch (resolutionErr: any) {
          if (resolutionErr instanceof ProviderResolutionError) {
            return jr({
              error: resolutionErr.message.replace(/^\[aml\/providers\]\s*/, ""),
              code: resolutionErr.code,
              environment: currentEnvironment(),
            }, 409);
          }
          throw resolutionErr;
        }

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
          // Same contract as IDV: an unreachable provider is not a screening
          // outcome and never renders as a failure against the subject.
          await admin.schema("aml").from("screening_checks").update({
            status: "pending",
            result_summary: {
              error_category: "provider_unavailable",
              error: String(e?.message ?? "provider_failure").slice(0, 300),
            },
            completed_at: new Date().toISOString(),
          }).eq("id", inserted.id);
          return jr({
            error: "The screening provider could not be reached. No result was produced — try again once Integration Health shows the provider is available.",
            code: "provider_unavailable",
          }, 502);
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

      // ---------------- self-hosted verification (zero-cost stack) ----------
      //
      // docs/aml/kyc-zero-cost-solution.md. The portal captures; these ops
      // adjudicate. Nothing here moves the service gate — that stays an
      // explicit, reasoned human decision in aml-risk.

      case "list_verification_checks": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        if (!await hasCaseAccess(admin, userId, String(body.case_id))) {
          return jr({ error: "Tenant AML role required" }, 403);
        }
        const { data, error } = await admin.schema("aml").from("verification_checks")
          .select("*").eq("case_id", body.case_id)
          .order("requested_at", { ascending: false });
        if (error) throw error;
        // Never ship the storage path to the browser: a biometric is fetched
        // only through `get_biometric_url`, which writes the access log.
        const checks = (data ?? []).map((c: any) => {
          const { biometric_storage_path, ...safe } = c;
          return { ...safe, has_biometric: Boolean(biometric_storage_path) };
        });
        return jr({ checks, max_attempts: MAX_VERIFICATION_ATTEMPTS });
      }

      case "run_verification": {
        // Adjudicate a pending portal submission through the self-hosted
        // service. Staff-triggered so that a customer cannot spend compute,
        // and so the result is attributable.
        if (!canWrite) return jr({ error: "Analyst, reviewer or MLRO role required" }, 403);
        const checkId = String(body.check_id ?? "");
        if (!checkId) return jr({ error: "check_id required" }, 400);

        const { data: check } = await admin.schema("aml").from("verification_checks")
          .select("*").eq("id", checkId).maybeSingle();
        if (!check) return jr({ error: "Not found" }, 404);
        if (!await hasCaseAccess(admin, userId, check.case_id, true)) {
          return jr({ error: "Tenant write role required" }, 403);
        }
        if (!["pending", "in_progress"].includes(check.status)) {
          return jr({ error: `Check is already ${check.status}`, code: "not_pending" }, 409);
        }

        const tenantId = await resolveTenantId(admin, check.case_id);
        const resolved = await resolveTenantProvider(admin, tenantId, "idv");
        const provider = getIdvProvider({ resolved, preferred: "selfhosted", admin });

        const download = async (bucket: string, path: string) => {
          const { data, error } = await admin.storage.from(bucket).download(path);
          if (error) throw new Error(`could not read ${bucket}/${path}: ${error.message}`);
          const buf = new Uint8Array(await data.arrayBuffer());
          let binary = "";
          for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
          return btoa(binary);
        };

        await admin.schema("aml").from("verification_checks")
          .update({ status: "in_progress", updated_at: new Date().toISOString() })
          .eq("id", checkId);

        let result;
        try {
          const [documentB64, selfieB64] = await Promise.all([
            check.document_reference ? download("aml-documents", check.document_reference) : Promise.resolve(""),
            check.biometric_storage_path ? download("aml-biometrics", check.biometric_storage_path) : Promise.resolve(""),
          ]);
          result = await runWithMetrics(admin, {
            tenantId, capability: "idv",
            providerKey: resolved?.providerKey ?? "selfhosted",
            costCents: resolved?.costCents ?? 0, configId: resolved?.configId ?? null,
          }, () => provider.runIdv({
            caseId: check.case_id,
            subjectLabel: check.party_label,
            method: "document_and_liveness",
            metadata: { document_image_b64: documentB64, selfie_image_b64: selfieB64 },
          }));
        } catch (e: any) {
          // A service failure is OUR failure. Return the attempt to pending so
          // it does not consume one of the customer's three.
          await admin.schema("aml").from("verification_checks").update({
            status: "pending",
            failure_reason: `service_error: ${String(e?.message ?? e).slice(0, 300)}`,
            updated_at: new Date().toISOString(),
          }).eq("id", checkId);
          return jr({ error: `Verification service unavailable: ${e?.message ?? e}`, code: "service_unavailable" }, 503);
        }

        // 'unusable' capture (no face found, too small) is a capture problem,
        // not an identity failure — leave the attempt open for a retake.
        const unusable = (result.raw as any)?.face?.verdict === "unusable";
        const status = unusable ? "pending"
          : result.status === "failed" ? "failed"
          : result.status === "verified" ? "passed"
          : "referred";

        const attemptsUsed = Number(check.attempt_number ?? 1);
        const finalStatus = (status === "failed" && attemptsUsed >= MAX_VERIFICATION_ATTEMPTS)
          ? "exhausted" : status;

        const { data: updated, error: upErr } = await admin.schema("aml")
          .from("verification_checks").update({
            status: finalStatus,
            provider: result.provider,
            provider_reference: result.providerReference,
            outcome_detail: {
              ...(check.outcome_detail ?? {}),
              checks: result.checks,
              overall_score: result.overallScore,
              raw: result.raw,
              adjudicated_by: userId,
            },
            failure_reason: status === "failed"
              ? result.checks.filter((c: any) => c.status === "fail").map((c: any) => c.name).join(", ")
              : null,
            completed_at: ["passed", "failed", "exhausted"].includes(finalStatus)
              ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          }).eq("id", checkId).select("*").single();
        if (upErr) throw upErr;

        await appendCaseEvent(admin, check.case_id, "idv_result",
          `Identity verification for ${check.party_label}: ${finalStatus} (attempt ${attemptsUsed} of ${MAX_VERIFICATION_ATTEMPTS})`,
          {
            verification_check_id: checkId, status: finalStatus,
            provider: result.provider, provider_reference: result.providerReference,
            checks: result.checks,
            limitations: (result.raw as any)?.limitations ?? [],
          }, userId, userEmail);

        const { biometric_storage_path: _bp, ...safe } = updated as any;
        return jr({ check: { ...safe, has_biometric: Boolean(_bp) } });
      }

      case "record_document_sighting": {
        // The documentary path — under the zero-cost design this is the
        // primary evidence, not a fallback for edge cases.
        if (!canWrite) return jr({ error: "Analyst, reviewer or MLRO role required" }, 403);
        const caseId = String(body.case_id ?? "");
        const partyLabel = String(body.party_label ?? "").trim();
        const documentType = String(body.document_type ?? "").trim();
        const sightingKind = String(body.sighting_kind ?? "");
        const notes = String(body.notes ?? "").trim();

        if (!caseId || !partyLabel) return jr({ error: "case_id and party_label are required" }, 400);
        if (!documentType) return jr({ error: "document_type is required" }, 400);
        if (!["original", "certified_copy"].includes(sightingKind)) {
          return jr({ error: 'sighting_kind must be "original" or "certified_copy"' }, 400);
        }
        // A certified copy is only evidence if we recorded who certified it.
        const certifierName = String(body.certifier_name ?? "").trim();
        const certifierCapacity = String(body.certifier_capacity ?? "").trim();
        if (sightingKind === "certified_copy" && (!certifierName || !certifierCapacity)) {
          return jr({
            error: "certifier_name and certifier_capacity are required for a certified copy",
          }, 400);
        }
        if (notes.length < 10) {
          return jr({ error: "notes must be at least 10 characters" }, 400);
        }
        if (!await hasCaseAccess(admin, userId, caseId, true)) {
          return jr({ error: "Tenant write role required" }, 403);
        }

        const { data: created, error } = await admin.schema("aml")
          .from("verification_checks").insert({
            case_id: caseId,
            party_id: body.party_id ?? null,
            party_label: partyLabel.slice(0, 200),
            check_type: "document_sighting",
            attempt_number: 1,
            status: "passed",
            provider: "manual",
            verified_by: userId,
            verified_by_type: "staff",
            outcome_detail: {
              document_type: documentType,
              sighting_kind: sightingKind,
              certifier_name: certifierName || null,
              certifier_capacity: certifierCapacity || null,
              notes,
              sighted_by_email: userEmail,
            },
            completed_at: new Date().toISOString(),
          }).select("*").single();
        if (error) {
          if (error.code === "23505") {
            return jr({ error: "A document sighting is already recorded for this party" }, 409);
          }
          throw error;
        }

        await appendCaseEvent(admin, caseId, "idv_result",
          `Document sighting recorded for ${partyLabel} (${sightingKind.replace("_", " ")}, ${documentType})`,
          {
            verification_check_id: created.id, sighting_kind: sightingKind,
            document_type: documentType, certifier_name: certifierName || null,
          }, userId, userEmail);

        return jr({ check: created });
      }

      case "get_biometric_url": {
        // Every read of a retained biometric is logged. That log is the
        // APP 11 answer to "who looked at this, and why".
        if (!canWrite) return jr({ error: "Analyst, reviewer or MLRO role required" }, 403);
        const checkId = String(body.check_id ?? "");
        const reason = String(body.reason ?? "").trim();
        if (!checkId) return jr({ error: "check_id required" }, 400);
        if (reason.length < 10) {
          return jr({ error: "A reason of at least 10 characters is required to view a biometric" }, 400);
        }

        const { data: check } = await admin.schema("aml").from("verification_checks")
          .select("id, case_id, biometric_storage_path, party_label").eq("id", checkId).maybeSingle();
        if (!check) return jr({ error: "No biometric on this check" }, 404);
        if (!await hasCaseAccess(admin, userId, check.case_id, true)) {
          return jr({ error: "Tenant write role required" }, 403);
        }
        if (!check.biometric_storage_path) return jr({ error: "No biometric on this check" }, 404);

        const { data: signed, error } = await admin.storage.from("aml-biometrics")
          .createSignedUrl(check.biometric_storage_path, 120);
        if (error) throw error;

        await admin.schema("aml").from("biometric_access_log").insert({
          verification_check_id: checkId,
          case_id: check.case_id,
          actor_id: userId,
          actor_label: userEmail,
          action: "view",
          reason,
          ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        });

        await appendCaseEvent(admin, check.case_id, "system",
          `Biometric image viewed for ${check.party_label}`,
          { verification_check_id: checkId, reason }, userId, userEmail);

        // Short expiry on purpose: a long-lived URL is an unlogged copy.
        return jr({ url: signed.signedUrl, expires_in_seconds: 120 });
      }

      case "list_biometric_access": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        if (!await hasCaseAccess(admin, userId, String(body.case_id))) {
          return jr({ error: "Tenant AML role required" }, 403);
        }
        const { data, error } = await admin.schema("aml").from("biometric_access_log")
          .select("*").eq("case_id", body.case_id)
          .order("created_at", { ascending: false }).limit(200);
        if (error) throw error;
        return jr({ access_log: data ?? [] });
      }

      case "sanctions_list_status": {
        const { data, error } = await admin.schema("aml").from("sanctions_list_syncs")
          .select("*").order("started_at", { ascending: false }).limit(20);
        if (error) throw error;
        const { count } = await admin.schema("aml").from("sanctions_entries")
          .select("id", { count: "exact", head: true });
        return jr({ syncs: data ?? [], entry_count: count ?? 0 });
      }

      // Read-only provider readiness: what would actually run if staff asked
      // for a verification right now, and why. Booleans only for secrets —
      // never values. This is the operator preflight for the IDV workflow.
      case "provider_readiness": {
        const environment = currentEnvironment();
        const tenantId = String(body.tenant_id ?? DEFAULT_TENANT);

        async function capabilityReadiness(capability: "idv" | "pep_sanctions") {
          const resolved = await resolveTenantProvider(admin, tenantId, capability);
          const mode = resolved?.mode ??
            ((Deno.env.get("AML_PROVIDER_MODE") || "").toLowerCase() === "live" ? "live" : "simulator");
          const key = (resolved?.providerKey ?? "simulator").toLowerCase();
          const secrets = capability === "idv" ? {
            AML_VERIFICATION_SERVICE_URL: Boolean(Deno.env.get("AML_VERIFICATION_SERVICE_URL")),
            AML_VERIFICATION_SERVICE_TOKEN: Boolean(Deno.env.get("AML_VERIFICATION_SERVICE_TOKEN")),
          } : {};
          const wired = capability === "idv" ? key === "selfhosted" : key === "local_lists";
          const configured = capability === "idv"
            ? Boolean(Deno.env.get("AML_VERIFICATION_SERVICE_URL")) && Boolean(Deno.env.get("AML_VERIFICATION_SERVICE_TOKEN"))
            : true;
          const wantsSimulator = mode === "simulator" || key === "simulator";
          let state: string;
          if (wantsSimulator) {
            state = environment === "production" ? "not_configured" : "simulator_non_production";
          } else if (!wired || !configured) {
            state = "misconfigured";
          } else if (resolved && ["failing", "unhealthy"].includes(String((resolved as any).lastHealthStatus ?? ""))) {
            state = "unavailable";
          } else {
            state = "ready_live";
          }
          const { data: cfg } = resolved?.configId
            ? await admin.schema("aml").from("provider_configs")
              .select("last_health_at, last_health_status, last_health_message")
              .eq("id", resolved.configId).maybeSingle()
            : { data: null };
          return {
            capability,
            configured_provider: resolved?.providerKey ?? null,
            mode,
            adapter_wired: wired,
            secrets_present: secrets,
            last_health: cfg ? {
              at: cfg.last_health_at, status: cfg.last_health_status,
              message: cfg.last_health_message,
            } : null,
            state,
          };
        }

        return jr({
          environment,
          simulator_blocked: environment === "production",
          note: "Recorded configuration and runtime booleans — not a claim that any provider call has been made.",
          idv: await capabilityReadiness("idv"),
          screening: await capabilityReadiness("pep_sanctions"),
        });
      }

      default:
        return jr({ error: `Unknown op: ${op}` }, 400);
    }
  } catch (e: any) {
    console.error("[aml-verification] error", e);
    return jr({ error: e?.message ?? "internal_error" }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
