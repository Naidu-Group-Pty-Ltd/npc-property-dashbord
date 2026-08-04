/**
 * AML/CTF Compliance Passport — cross-portal reliance engine.
 *
 * Legal model: AML/CTF Act 2006 (Cth), Part 2 Division 7 (ss 37A–38). One
 * reporting entity may rely on the applicable customer identification
 * procedure carried out by another, under a WRITTEN customer due diligence
 * arrangement that is regularly reviewed — and the relying entity remains
 * responsible for its own compliance. That last clause is why the
 * "independent assessment" path exists: a partner who wants their own
 * determination makes it here, against internally-transferred records,
 * instead of approaching the client again.
 *
 * Staff ops (verifyAuth; agreements/attestations/grants are MLRO-only —
 * cross-entity disclosure is a restricted operation like every other
 * outward-facing act in this module):
 *   list_agreements | create_agreement | review_agreement
 *   issue_attestation | list_attestations
 *   grant_access | revoke_grant | list_grants
 *   list_assessments | list_access_log
 *
 * Partner ops (bearer token minted by grant_access; no session — mirrors the
 * finance handoff-token pattern; token stored hashed, expiring, revocable):
 *   redeem_attestation | record_independent_assessment
 *
 * Disclosure boundary (Appendix C contracts, extended outward): an
 * attestation states WHAT PROCEDURES WERE PERFORMED — parties verified, by
 * what method, when; consents held; screening performed against which lists
 * and how fresh. It NEVER carries risk ratings, screening match content,
 * reviewer notes or MLRO commentary. A partner relying on our identification
 * procedure has no entitlement to our investigation, and s 123 (tipping off)
 * forbids sharing some of it regardless.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import {
  LEGAL_ROUTES,
  evaluatePartnerLinkForReliance,
} from "../_shared/aml/relianceEligibility.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jr = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

const GRANT_TTL_DAYS = 90;

/**
 * Build the sanitised attestation payload for a case.
 *
 * Everything here answers "what procedures were performed" — nothing answers
 * "what did you conclude about this customer". The exclusion list is the
 * contract: risk_rating, risk_score, screening match content, reviewer notes
 * and MLRO commentary must never enter this object.
 */
async function buildAttestationPayload(admin: any, caseRow: any) {
  const caseId = caseRow.id;
  const [{ data: checks }, { data: consents }, { data: sections }, { data: screenings }, { data: syncs }] = await Promise.all([
    admin.schema("aml").from("verification_checks")
      .select("party_label, check_type, status, provider, completed_at, outcome_detail")
      .eq("case_id", caseId),
    admin.schema("aml").from("consents")
      .select("kind, version, accepted_at").eq("case_id", caseId),
    admin.schema("aml").from("questionnaire_responses")
      .select("section, status").eq("case_id", caseId),
    admin.schema("aml").from("screening_checks")
      .select("completed_at, scope, status").eq("case_id", caseId)
      .order("completed_at", { ascending: false }).limit(1),
    admin.schema("aml").from("sanctions_list_syncs")
      .select("list_code, completed_at").eq("status", "succeeded")
      .order("completed_at", { ascending: false }).limit(10),
  ]);

  // One line per party: verified or not, by which method, when. Sighting
  // detail keeps document type + certifier because that is precisely what a
  // relying entity's own risk assessment needs; scores stay internal.
  const partyMap = new Map<string, any>();
  for (const c of (checks ?? [])) {
    const key = c.party_label;
    const cur = partyMap.get(key) ?? { party: key, verified: false, method: null, completed_at: null, document_type: null };
    if (c.status === "passed" && ["electronic_idv", "document_sighting", "dvs"].includes(c.check_type)) {
      cur.verified = true;
      cur.method = c.check_type;
      cur.completed_at = c.completed_at;
      if (c.check_type === "document_sighting") {
        cur.document_type = c.outcome_detail?.document_type ?? null;
        cur.sighting_kind = c.outcome_detail?.sighting_kind ?? null;
        cur.certifier_capacity = c.outcome_detail?.certifier_capacity ?? null;
      }
    }
    partyMap.set(key, cur);
  }

  const latestScreening = (screenings ?? [])[0] ?? null;
  const listFreshness: Record<string, string> = {};
  for (const s of (syncs ?? [])) {
    if (!listFreshness[s.list_code]) listFreshness[s.list_code] = s.completed_at;
  }

  return {
    schema: "aml.compliance_attestation.v1",
    issuer: "NPC Services command centre",
    case_reference: caseRow.case_reference,
    subject: caseRow.subject_display_name,
    subject_type: caseRow.subject_type,
    customer_identification: {
      parties: [...partyMap.values()],
      questionnaire_version: caseRow.metadata?.questionnaire_version ?? null,
      sections_submitted: (sections ?? []).filter((s: any) =>
        ["submitted", "accepted", "complete"].includes(s.status)).length,
      consents_held: (consents ?? []).map((c: any) => ({
        code: c.kind, version: c.version, accepted_at: c.accepted_at,
      })),
    },
    screening: {
      performed: Boolean(latestScreening),
      last_performed_at: latestScreening?.completed_at ?? null,
      scope: latestScreening?.scope ?? null,
      list_freshness: listFreshness,
      // Deliberately absent: match content. A partner sees THAT screening
      // ran and how fresh the lists were, never what it surfaced.
    },
    // Same finance-safe derivation as Appendix C.2: readiness is a boolean
    // derived only from an explicitly approved gate, never the raw status.
    service_readiness: ["approved", "approved_with_controls"]
      .includes(caseRow.service_gate_status) ,
    limitations: [
      "documents_not_verified_against_issuing_authority",
      "liveness_signal_is_heuristic_only",
    ],
    reliance_basis: "AML/CTF Act 2006 (Cth) Pt 2 Div 7 — written CDD arrangement required; relying entity remains responsible for its own compliance",
  };
}

/**
 * Phase 1 enforcement flag. Off = legacy free-text agreement behaviour is
 * preserved exactly. On = new reliance grants require a canonical partner
 * organisation and an active partner-case link (legal_route = reliance).
 * Tolerates both feature-flag value shapes used in this repo.
 */
async function partnerIdentityEnforced(admin: any): Promise<boolean> {
  const { data } = await admin.from("feature_flags")
    .select("value").eq("key", "aml_partner_identity").maybeSingle();
  const v = data?.value;
  if (v === true || v === "true") return true;
  if (v && typeof v === "object" && (v as any).enabled === true) return true;
  return false;
}

const PARTNER_ORG_TYPES = ["finance", "builder", "developer", "solicitor_conveyancer", "other"];
const PARTNER_PORTAL_TYPES = ["finance", "builder", "developer", "solicitor_conveyancer"];
const PARTNER_USER_SOURCES = ["finance_portal_users", "builder_portal_users", "solicitor_portal_users"];
const PARTNER_CLASSIFICATIONS = [
  "unclassified", "eligible_relying_reporting_entity", "eligible_foreign_equivalent",
  "reporting_entity_no_reliance", "non_reporting_commercial", "outsourcing_principal",
  "service_provider",
];

/** Resolve a partner bearer token to a live grant, or null. */
async function resolveGrant(admin: any, rawToken: string) {
  if (!rawToken || rawToken.length < 20) return null;
  const hash = await sha256Hex(rawToken);
  const { data: grant } = await admin.schema("aml").from("reliance_grants")
    .select("*, reliance_agreements:agreement_id(*), compliance_attestations:attestation_id(*)")
    .eq("access_token_hash", hash).maybeSingle();
  if (!grant) return null;
  if (grant.revoked_at) return { grant, denied: "revoked" };
  if (new Date(grant.expires_at).getTime() < Date.now()) return { grant, denied: "expired" };
  const agreement = (grant as any).reliance_agreements;
  if (!agreement || agreement.status !== "active") return { grant, denied: "agreement_inactive" };
  return { grant, denied: null };
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const op = String(body?.op ?? "");
    if (!op) return jr({ error: "op required" }, 400);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    /* ── partner ops: bearer token, no staff session ─────────────────────── */

    if (op === "redeem_attestation" || op === "record_independent_assessment") {
      const resolved = await resolveGrant(admin, String(body.access_token ?? ""));
      if (!resolved) return jr({ error: "Invalid access token" }, 401);
      if (resolved.denied) {
        return jr({ error: `Access ${resolved.denied.replace("_", " ")}`, code: resolved.denied }, 403);
      }
      const grant = resolved.grant;
      const agreement = (grant as any).reliance_agreements;
      const attestation = (grant as any).compliance_attestations;

      if (op === "redeem_attestation") {
        await admin.schema("aml").from("reliance_access_log").insert({
          grant_id: grant.id, case_id: grant.case_id, action: "view_attestation",
          actor_label: agreement.partner_org_name, ip_address: ip,
          detail: { attestation_version: attestation.version },
        });
        return jr({
          attestation: attestation.payload,
          attestation_sha256: attestation.payload_sha256,
          issued_at: attestation.issued_at,
          agreement: {
            partner_org_name: agreement.partner_org_name,
            agreement_reference: agreement.agreement_reference,
            scope: agreement.scope,
          },
          // The statutory position, restated at the point of use so a partner
          // integration cannot claim it was not told.
          notice: "You may rely on the customer identification procedures described here under your written CDD arrangement (AML/CTF Act Pt 2 Div 7). Your organisation remains responsible for its own AML/CTF compliance. To make your own determination without re-approaching the customer, record an independent assessment.",
        });
      }

      // record_independent_assessment — the partner's OWN determination,
      // made against internally-held records. Never touches our case status
      // or service gate: their compliance is theirs, ours is ours.
      const assessorName = String(body.assessor_name ?? "").trim();
      const status = String(body.status ?? "");
      const notes = String(body.decision_notes ?? "").trim();
      if (!assessorName) return jr({ error: "assessor_name is required" }, 400);
      if (!["satisfied", "not_satisfied", "records_requested"].includes(status)) {
        return jr({ error: 'status must be "satisfied", "not_satisfied" or "records_requested"' }, 400);
      }
      if (notes.length < 10) return jr({ error: "decision_notes must be at least 10 characters" }, 400);

      const { data: assessment, error } = await admin.schema("aml")
        .from("independent_assessments").insert({
          grant_id: grant.id, case_id: grant.case_id, agreement_id: agreement.id,
          assessor_name: assessorName.slice(0, 200),
          assessor_role: String(body.assessor_role ?? "").slice(0, 200) || null,
          based_on_attestation_sha256: attestation.payload_sha256,
          status, decision_notes: notes,
          decided_at: new Date().toISOString(),
        }).select("*").single();
      if (error) throw error;

      await admin.schema("aml").from("reliance_access_log").insert({
        grant_id: grant.id, case_id: grant.case_id,
        action: status === "records_requested" ? "records_request" : "independent_assessment",
        actor_label: `${agreement.partner_org_name} — ${assessorName}`, ip_address: ip,
        detail: { assessment_id: assessment.id, status },
      });
      await appendCaseEvent(admin, grant.case_id, "system",
        `Independent assessment by ${agreement.partner_org_name}: ${status.replace("_", " ")}`,
        {
          assessment_id: assessment.id, agreement_id: agreement.id,
          based_on_attestation_sha256: attestation.payload_sha256,
          // Explicit in the audit trail: this decision is the partner's.
          note: "Partner determination under its own AML/CTF obligations. Does not alter this case's status or service gate.",
        }, null, agreement.partner_org_name);

      return jr({
        assessment: { id: assessment.id, status: assessment.status, decided_at: assessment.decided_at },
        message: status === "records_requested"
          ? "Your records request has been logged. The MLRO will respond under the CDD arrangement."
          : "Your independent assessment has been recorded against the attestation you reviewed.",
      });
    }

    /* ── staff ops ───────────────────────────────────────────────────────── */

    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") {
      return jr({ error: auth.error || "Authentication required" }, 401);
    }
    const userId = auth.userId;
    const userEmail = auth.username ?? null;
    const { data: hasAny } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAny) return jr({ error: "AML role required" }, 403);
    const { data: roleRows } = await admin.schema("aml").from("role_assignments")
      .select("role").eq("user_id", userId).is("revoked_at", null);
    const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
    const isMlro = roles.has("mlro");

    switch (op) {
      case "list_agreements": {
        const { data, error } = await admin.schema("aml").from("reliance_agreements")
          .select("*").order("created_at", { ascending: false });
        if (error) throw error;
        return jr({ agreements: data ?? [] });
      }

      case "create_agreement": {
        // Cross-entity disclosure machinery is MLRO-only, like every other
        // outward-facing restricted operation in this module.
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        const name = String(body.partner_org_name ?? "").trim();
        const type = String(body.partner_org_type ?? "");
        const ref = String(body.agreement_reference ?? "").trim();
        const executed = String(body.executed_on ?? "");
        const review = String(body.next_review_due ?? "");
        if (!name) return jr({ error: "partner_org_name is required" }, 400);
        if (!["finance", "builder", "developer", "solicitor_conveyancer", "other"].includes(type)) {
          return jr({ error: "partner_org_type must be finance, builder, developer, solicitor_conveyancer or other" }, 400);
        }
        // No written agreement, no s 37A. Not a formality.
        if (!ref) return jr({ error: "agreement_reference is required — reliance without a written CDD arrangement is not available under Pt 2 Div 7" }, 400);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(executed)) return jr({ error: "executed_on must be YYYY-MM-DD" }, 400);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(review)) return jr({ error: "next_review_due must be YYYY-MM-DD — the arrangement must be reviewed regularly" }, 400);
        const { data, error } = await admin.schema("aml").from("reliance_agreements").insert({
          partner_org_name: name.slice(0, 200), partner_org_type: type,
          partner_abn: String(body.partner_abn ?? "").slice(0, 20) || null,
          agreement_reference: ref.slice(0, 200), executed_on: executed,
          next_review_due: review, notes: String(body.notes ?? "").slice(0, 2000) || null,
          created_by: userId,
        }).select("*").single();
        if (error) throw error;
        return jr({ agreement: data });
      }

      case "review_agreement": {
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        const id = String(body.agreement_id ?? "");
        const nextDue = String(body.next_review_due ?? "");
        const outcome = String(body.outcome ?? "");
        if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(nextDue)) {
          return jr({ error: "agreement_id and next_review_due (YYYY-MM-DD) are required" }, 400);
        }
        if (!["continue", "suspend", "terminate"].includes(outcome)) {
          return jr({ error: 'outcome must be "continue", "suspend" or "terminate"' }, 400);
        }
        const { data, error } = await admin.schema("aml").from("reliance_agreements").update({
          last_reviewed_at: new Date().toISOString(), last_reviewed_by: userId,
          next_review_due: nextDue,
          status: outcome === "continue" ? "active" : outcome === "suspend" ? "suspended" : "terminated",
          updated_at: new Date().toISOString(),
        }).eq("id", id).select("*").single();
        if (error) throw error;
        return jr({ agreement: data });
      }

      case "issue_attestation": {
        if (!isMlro) return jr({ error: "MLRO role required — an attestation is an outward statement of this entity's procedures" }, 403);
        const caseId = String(body.case_id ?? "");
        if (!caseId) return jr({ error: "case_id required" }, 400);
        const { data: caseRow } = await admin.schema("aml").from("cases")
          .select("*").eq("id", caseId).maybeSingle();
        if (!caseRow) return jr({ error: "Case not found" }, 404);

        const payload = await buildAttestationPayload(admin, caseRow);
        // Refuse to attest to nothing: an attestation with zero verified
        // parties is a passport for a process that has not happened.
        if (!payload.customer_identification.parties.some((p: any) => p.verified)) {
          return jr({
            error: "No verified parties on this case — complete identity verification before issuing an attestation.",
            code: "nothing_to_attest",
          }, 409);
        }
        const payloadSha = await sha256Hex(JSON.stringify(payload));

        const { data: last } = await admin.schema("aml").from("compliance_attestations")
          .select("id, version").eq("case_id", caseId)
          .order("version", { ascending: false }).limit(1).maybeSingle();
        const version = (last?.version ?? 0) + 1;
        if (last) {
          await admin.schema("aml").from("compliance_attestations")
            .update({ superseded_at: new Date().toISOString() }).eq("id", last.id);
        }
        const { data: att, error } = await admin.schema("aml").from("compliance_attestations")
          .insert({
            case_id: caseId, version, payload, payload_sha256: payloadSha,
            issued_by: userId, issued_by_email: userEmail,
          }).select("*").single();
        if (error) throw error;

        await appendCaseEvent(admin, caseId, "mlro_decision",
          `Compliance attestation v${version} issued (sha ${payloadSha.slice(0, 12)})`,
          { attestation_id: att.id, version, payload_sha256: payloadSha }, userId, userEmail);
        return jr({ attestation: att });
      }

      case "list_attestations": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("compliance_attestations")
          .select("*").eq("case_id", body.case_id).order("version", { ascending: false });
        if (error) throw error;
        return jr({ attestations: data ?? [] });
      }

      case "grant_access": {
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        const caseId = String(body.case_id ?? "");
        const agreementId = String(body.agreement_id ?? "");
        if (!caseId || !agreementId) return jr({ error: "case_id and agreement_id are required" }, 400);

        const { data: agreement } = await admin.schema("aml").from("reliance_agreements")
          .select("*").eq("id", agreementId).maybeSingle();
        if (!agreement) return jr({ error: "Agreement not found" }, 404);
        if (agreement.status !== "active") {
          return jr({ error: `Agreement is ${agreement.status}` }, 409);
        }
        // s 37A: regular review is a condition of the arrangement, so an
        // overdue review suspends NEW grants until the review is done.
        if (new Date(agreement.next_review_due).getTime() < Date.now()) {
          return jr({
            error: "This CDD arrangement's review is overdue. Review the agreement before issuing new grants.",
            code: "review_overdue",
          }, 409);
        }

        // Client consent is a precondition of disclosure (APP 6), and the
        // grant row carries the consent id so the authority is traceable.
        const { data: consent } = await admin.schema("aml").from("consents")
          .select("id, version, accepted_at").eq("case_id", caseId)
          .eq("kind", "compliance_sharing")
          .order("accepted_at", { ascending: false }).limit(1).maybeSingle();
        if (!consent) {
          return jr({
            error: "The client has not consented to sharing their completed verification. Ask them to accept the sharing consent in their portal — or the partner must approach them directly.",
            code: "sharing_consent_missing",
          }, 403);
        }

        const { data: att } = await admin.schema("aml").from("compliance_attestations")
          .select("id, version").eq("case_id", caseId).is("superseded_at", null)
          .order("version", { ascending: false }).limit(1).maybeSingle();
        if (!att) return jr({ error: "Issue an attestation for this case first", code: "no_attestation" }, 409);

        // Canonical partner identity (Phase 1). The organisation is resolved
        // from the STORED agreement row — a body-supplied partner_org_id is
        // never authority. With the aml_partner_identity flag on, a new
        // grant additionally requires an ACTIVE partner-case link with
        // legal_route = reliance for this exact case; with the flag off the
        // legacy behaviour is unchanged and the canonical ids are stamped
        // only when they already exist.
        const enforced = await partnerIdentityEnforced(admin);
        let partnerOrgRow: any = null;
        let linkForGrant: any = null;
        if (agreement.partner_org_id) {
          const { data: orgRow } = await admin.schema("aml").from("partner_organisations")
            .select("id, status").eq("id", agreement.partner_org_id).maybeSingle();
          partnerOrgRow = orgRow ?? null;
        }
        {
          const { data: caseRowForLink } = await admin.schema("aml").from("cases")
            .select("id, tenant_id").eq("id", caseId).maybeSingle();
          const caseTenant = caseRowForLink?.tenant_id ?? "default";
          let linkRows: any[] = [];
          if (partnerOrgRow) {
            const { data: links } = await admin.schema("aml").from("partner_case_links")
              .select("id, case_id, tenant_id, partner_org_id, legal_route, state")
              .eq("case_id", caseId).eq("partner_org_id", partnerOrgRow.id);
            linkRows = links ?? [];
          }
          const decision = evaluatePartnerLinkForReliance({
            caseId, caseTenantId: caseTenant,
            partnerOrg: partnerOrgRow, links: linkRows,
          });
          if (decision.ok) {
            linkForGrant = decision.link;
          } else if (enforced) {
            // Partner-safe code, operator-facing message. Independent CDD
            // remains available — this blocks the reliance grant only.
            return jr({ error: decision.message, code: decision.code }, 409);
          }
        }

        // Raw token is shown exactly once; only its hash persists.
        const rawToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
        const grantInsert: Record<string, unknown> = {
          case_id: caseId, agreement_id: agreementId, attestation_id: att.id,
          consent_id: consent.id,
          access_token_hash: await sha256Hex(rawToken),
          granted_by: userId,
          expires_at: new Date(Date.now() + GRANT_TTL_DAYS * 864e5).toISOString(),
        };
        if (agreement.partner_org_id) grantInsert.partner_org_id = agreement.partner_org_id;
        if (linkForGrant) grantInsert.partner_case_link_id = linkForGrant.id;
        let grant: any; let grantError: any;
        {
          const first = await admin.schema("aml").from("reliance_grants")
            .insert(grantInsert).select("*").single();
          grant = first.data; grantError = first.error;
          // Contract-first deploy tolerance (same convention as aml-cases):
          // if the Phase 1 columns are not applied in this environment yet,
          // retry without them rather than failing the legacy path.
          if (grantError && /partner_org_id|partner_case_link_id/.test(String(grantError.message ?? ""))) {
            delete grantInsert.partner_org_id;
            delete grantInsert.partner_case_link_id;
            const retry = await admin.schema("aml").from("reliance_grants")
              .insert(grantInsert).select("*").single();
            grant = retry.data; grantError = retry.error;
          }
        }
        if (grantError) throw grantError;

        await appendCaseEvent(admin, caseId, "mlro_decision",
          `Reliance access granted to ${agreement.partner_org_name} (attestation v${att.version})`,
          {
            grant_id: grant.id, agreement_id: agreementId,
            consent_id: consent.id, expires_at: grant.expires_at,
            partner_org_id: agreement.partner_org_id ?? null,
            partner_case_link_id: linkForGrant?.id ?? null,
          }, userId, userEmail);

        return jr({
          grant: { id: grant.id, expires_at: grant.expires_at, attestation_version: att.version },
          access_token: rawToken,
          note: "This token is shown once. Deliver it to the partner organisation through their portal channel.",
        });
      }

      case "revoke_grant": {
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        const reason = String(body.reason ?? "").trim();
        if (!body.grant_id) return jr({ error: "grant_id required" }, 400);
        if (reason.length < 10) return jr({ error: "reason must be at least 10 characters" }, 400);
        const { data, error } = await admin.schema("aml").from("reliance_grants").update({
          revoked_at: new Date().toISOString(), revoked_by: userId, revoke_reason: reason,
        }).eq("id", body.grant_id).is("revoked_at", null).select("*").single();
        if (error) throw error;
        await appendCaseEvent(admin, data.case_id, "mlro_decision",
          "Reliance access revoked", { grant_id: data.id, reason }, userId, userEmail);
        return jr({ grant: data });
      }

      case "list_grants": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("reliance_grants")
          .select("id, agreement_id, attestation_id, granted_at, expires_at, revoked_at, revoke_reason, reliance_agreements:agreement_id(partner_org_name, partner_org_type, status)")
          .eq("case_id", body.case_id).order("granted_at", { ascending: false });
        if (error) throw error;
        // The token hash never leaves the database, even to staff.
        return jr({ grants: data ?? [] });
      }

      case "list_assessments": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("independent_assessments")
          .select("*, reliance_agreements:agreement_id(partner_org_name)")
          .eq("case_id", body.case_id).order("created_at", { ascending: false });
        if (error) throw error;
        return jr({ assessments: data ?? [] });
      }

      case "list_access_log": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("reliance_access_log")
          .select("*").eq("case_id", body.case_id)
          .order("created_at", { ascending: false }).limit(200);
        if (error) throw error;
        return jr({ access_log: data ?? [] });
      }

      /* ── canonical partner identity (Phase 1) ─────────────────────────── */
      // The organisation record is CONFIGURATION plus evidence, never a
      // legal conclusion: classification values are controlled strings an
      // authorised human records, and a reliance-capable classification is
      // impossible without recorded evidence (DB CHECK). A link is the
      // access root — creating one grants no passport and no reliance by
      // itself; grant_access still requires agreement, review currency,
      // consent and a current attestation on top.

      case "list_partner_organisations": {
        const { data, error } = await admin.schema("aml").from("partner_organisations")
          .select("*").order("legal_name", { ascending: true });
        if (error) throw error;
        return jr({ partner_organisations: data ?? [] });
      }

      case "upsert_partner_organisation": {
        if (!isMlro) return jr({ error: "MLRO role required — partner identity is outward-facing configuration" }, 403);
        const legalName = String(body.legal_name ?? "").trim();
        const orgType = String(body.organisation_type ?? "");
        if (!legalName && !body.partner_org_id) return jr({ error: "legal_name is required" }, 400);
        if (!body.partner_org_id && !PARTNER_ORG_TYPES.includes(orgType)) {
          return jr({ error: `organisation_type must be one of: ${PARTNER_ORG_TYPES.join(", ")}` }, 400);
        }
        const patch: Record<string, unknown> = {};
        if (legalName) patch.legal_name = legalName.slice(0, 300);
        if (orgType && PARTNER_ORG_TYPES.includes(orgType)) patch.organisation_type = orgType;
        if (body.trading_name !== undefined) patch.trading_name = String(body.trading_name ?? "").slice(0, 300) || null;
        if (body.abn !== undefined) patch.abn = String(body.abn ?? "").replace(/\s+/g, "").slice(0, 20) || null;
        if (body.registration_reference !== undefined) patch.registration_reference = String(body.registration_reference ?? "").slice(0, 200) || null;
        if (body.registration_country !== undefined) patch.registration_country = String(body.registration_country ?? "AU").slice(0, 2).toUpperCase();
        if (Array.isArray(body.portal_types)) {
          const portals = body.portal_types.map(String).filter((p: string) => PARTNER_PORTAL_TYPES.includes(p));
          patch.portal_types = portals;
        }
        if (body.status !== undefined) {
          const status = String(body.status);
          if (!["active", "suspended", "ended"].includes(status)) return jr({ error: "status must be active, suspended or ended" }, 400);
          patch.status = status;
        }
        // Classification fields change ONLY through classify_partner_organisation.
        if (body.partner_org_id) {
          const { data, error } = await admin.schema("aml").from("partner_organisations")
            .update(patch).eq("id", String(body.partner_org_id)).select("*").single();
          if (error) throw error;
          return jr({ partner_organisation: data });
        }
        const { data, error } = await admin.schema("aml").from("partner_organisations")
          .insert({ ...patch, created_by: userId }).select("*").single();
        if (error) {
          if (String(error.code) === "23505") {
            return jr({ error: "An active partner organisation with this ABN already exists. Use it, or end it first — organisations are never merged automatically.", code: "duplicate_abn" }, 409);
          }
          throw error;
        }
        return jr({ partner_organisation: data });
      }

      case "classify_partner_organisation": {
        if (!isMlro) return jr({ error: "MLRO role required — classification is a recorded legal determination, not a system inference" }, 403);
        const orgId = String(body.partner_org_id ?? "");
        const classification = String(body.reporting_entity_classification ?? "");
        if (!orgId) return jr({ error: "partner_org_id required" }, 400);
        if (!PARTNER_CLASSIFICATIONS.includes(classification)) {
          return jr({ error: `reporting_entity_classification must be one of: ${PARTNER_CLASSIFICATIONS.join(", ")}` }, 400);
        }
        const evidence = String(body.classification_evidence_reference ?? "").trim();
        const relianceCapable = ["eligible_relying_reporting_entity", "eligible_foreign_equivalent"].includes(classification);
        if (relianceCapable && !evidence) {
          return jr({
            error: "A reliance-capable classification requires a classification evidence reference (the legal advice / determination it rests on).",
            code: "classification_evidence_required",
          }, 400);
        }
        const { data, error } = await admin.schema("aml").from("partner_organisations").update({
          reporting_entity_classification: classification,
          classification_status: classification === "unclassified" ? "unclassified" : "classified",
          classification_evidence_reference: evidence || null,
          classification_notes: String(body.classification_notes ?? "").slice(0, 2000) || null,
          regulator_reference: String(body.regulator_reference ?? "").slice(0, 200) || null,
          verified_by: userId,
          verified_at: new Date().toISOString(),
        }).eq("id", orgId).select("*").single();
        if (error) throw error;
        return jr({ partner_organisation: data });
      }

      case "list_partner_memberships": {
        if (!body.partner_org_id) return jr({ error: "partner_org_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("partner_portal_memberships")
          .select("*").eq("partner_org_id", String(body.partner_org_id))
          .order("created_at", { ascending: false });
        if (error) throw error;
        return jr({ memberships: data ?? [] });
      }

      case "upsert_partner_membership": {
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        const orgId = String(body.partner_org_id ?? "");
        const source = String(body.portal_user_source ?? "");
        const portalUserId = String(body.portal_user_id ?? "");
        const portalType = String(body.portal_type ?? "");
        if (!orgId || !source || !portalUserId) {
          return jr({ error: "partner_org_id, portal_user_source and portal_user_id are required" }, 400);
        }
        if (!PARTNER_USER_SOURCES.includes(source)) {
          return jr({ error: `portal_user_source must be one of: ${PARTNER_USER_SOURCES.join(", ")}` }, 400);
        }
        if (!PARTNER_PORTAL_TYPES.includes(portalType)) {
          return jr({ error: `portal_type must be one of: ${PARTNER_PORTAL_TYPES.join(", ")}` }, 400);
        }
        // The portal user must actually exist in its home table — a
        // membership maps a REAL portal identity, it never mints one.
        const { data: portalUser } = await admin.from(source)
          .select("id").eq("id", portalUserId).maybeSingle();
        if (!portalUser) return jr({ error: "Portal user not found in the named portal user table" }, 404);
        const { data: org } = await admin.schema("aml").from("partner_organisations")
          .select("id, status").eq("id", orgId).maybeSingle();
        if (!org) return jr({ error: "Partner organisation not found" }, 404);
        const status = String(body.status ?? "invited");
        if (!["invited", "active", "suspended", "ended"].includes(status)) {
          return jr({ error: "status must be invited, active, suspended or ended" }, 400);
        }
        const row = {
          partner_org_id: orgId, portal_type: portalType,
          portal_user_source: source, portal_user_id: portalUserId,
          organisation_role: String(body.organisation_role ?? "member").slice(0, 100),
          compliance_role: ["compliance_officer", "operations", "read_only"].includes(String(body.compliance_role)) ? String(body.compliance_role) : null,
          status,
          activated_at: status === "active" ? new Date().toISOString() : null,
          suspended_at: status === "suspended" ? new Date().toISOString() : null,
          ended_at: status === "ended" ? new Date().toISOString() : null,
          created_by: userId,
        };
        const { data, error } = await admin.schema("aml").from("partner_portal_memberships")
          .upsert(row, { onConflict: "portal_user_source,portal_user_id,partner_org_id" })
          .select("*").single();
        if (error) throw error;
        return jr({ membership: data });
      }

      case "list_partner_case_links": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("partner_case_links")
          .select("*, partner_organisations:partner_org_id(legal_name, organisation_type, classification_status, status)")
          .eq("case_id", String(body.case_id)).order("linked_at", { ascending: false });
        if (error) throw error;
        return jr({ links: data ?? [] });
      }

      case "link_partner_to_case": {
        // Creating an access root is a reviewer/MLRO act. It grants nothing
        // by itself: no passport, no reliance, no data flow.
        if (!(isMlro || roles.has("reviewer"))) {
          return jr({ error: "Reviewer or MLRO role required" }, 403);
        }
        const caseId = String(body.case_id ?? "");
        const orgId = String(body.partner_org_id ?? "");
        const portalType = String(body.portal_type ?? "");
        const relationshipRole = String(body.relationship_role ?? "").trim();
        const legalRoute = String(body.legal_route ?? "");
        const purpose = String(body.purpose ?? "").trim();
        if (!caseId || !orgId) return jr({ error: "case_id and partner_org_id are required" }, 400);
        if (![...PARTNER_PORTAL_TYPES, "other"].includes(portalType)) {
          return jr({ error: `portal_type must be one of: ${[...PARTNER_PORTAL_TYPES, "other"].join(", ")}` }, 400);
        }
        if (!relationshipRole) return jr({ error: "relationship_role is required" }, 400);
        if (!(LEGAL_ROUTES as readonly string[]).includes(legalRoute)) {
          return jr({ error: `legal_route must be one of: ${LEGAL_ROUTES.join(", ")} — the route is a recorded legal decision, never inferred from portal type` }, 400);
        }
        if (purpose.length < 10) return jr({ error: "purpose must be at least 10 characters — record why this organisation may access this matter" }, 400);

        const { data: caseRow } = await admin.schema("aml").from("cases")
          .select("id, client_id, purchase_file_id, tenant_id").eq("id", caseId).maybeSingle();
        if (!caseRow) return jr({ error: "Case not found" }, 404);
        const { data: org } = await admin.schema("aml").from("partner_organisations")
          .select("id, status, legal_name").eq("id", orgId).maybeSingle();
        if (!org) return jr({ error: "Partner organisation not found" }, 404);
        if (org.status !== "active") return jr({ error: `Partner organisation is ${org.status}` }, 409);

        // Deal-context validation: a supplied purchase file must belong to
        // this case's client and not contradict the case's own binding
        // (same rule as aml-finance import_from_purchase_file).
        const pfId = body.purchase_file_id ? String(body.purchase_file_id) : null;
        if (pfId) {
          const { data: pf } = await admin.from("purchase_files")
            .select("id, client_id").eq("id", pfId).maybeSingle();
          if (!pf) return jr({ error: "Purchase file not found" }, 404);
          if (caseRow.client_id && String(pf.client_id) !== String(caseRow.client_id)) {
            return jr({ error: "Purchase file is not linked to this AML case client" }, 403);
          }
          if (caseRow.purchase_file_id && String(caseRow.purchase_file_id) !== pfId) {
            return jr({ error: "Purchase file is not the one linked to this AML case" }, 403);
          }
        }
        const matterId = body.legal_matter_id ? String(body.legal_matter_id) : null;
        if (matterId) {
          const { data: matter } = await admin.from("legal_matters")
            .select("id").eq("id", matterId).maybeSingle();
          if (!matter) return jr({ error: "Legal matter not found" }, 404);
        }

        const { data: link, error } = await admin.schema("aml").from("partner_case_links").insert({
          tenant_id: caseRow.tenant_id ?? "default",
          case_id: caseId,
          client_id: caseRow.client_id ?? null,
          purchase_file_id: pfId,
          legal_matter_id: matterId,
          partner_org_id: orgId,
          portal_type: portalType,
          relationship_role: relationshipRole.slice(0, 100),
          legal_route: legalRoute,
          purpose: purpose.slice(0, 2000),
          linked_by: userId,
        }).select("*").single();
        if (error) {
          if (String(error.code) === "23505") {
            return jr({ error: "An active link already exists for this partner and role on this case." , code: "link_exists" }, 409);
          }
          throw error;
        }
        await appendCaseEvent(admin, caseId, "system",
          `Partner linked: ${org.legal_name} (${legalRoute.replace(/_/g, " ")})`,
          {
            partner_case_link_id: link.id, partner_org_id: orgId,
            portal_type: portalType, relationship_role: relationshipRole,
            legal_route: legalRoute,
            note: "A link is an access root only. No passport, reliance or disclosure follows from it by itself.",
          }, userId, userEmail);
        return jr({ link });
      }

      case "set_partner_case_link_state": {
        if (!(isMlro || roles.has("reviewer"))) {
          return jr({ error: "Reviewer or MLRO role required" }, 403);
        }
        const linkId = String(body.link_id ?? "");
        const state = String(body.state ?? "");
        if (!linkId) return jr({ error: "link_id required" }, 400);
        if (!["suspended", "ended", "active"].includes(state)) {
          return jr({ error: "state must be active, suspended or ended" }, 400);
        }
        const endReason = body.end_reason_code ? String(body.end_reason_code) : null;
        if (state === "ended" && !["completed", "withdrawn", "superseded", "client_declined", "other"].includes(endReason ?? "")) {
          return jr({ error: "end_reason_code must be completed, withdrawn, superseded, client_declined or other" }, 400);
        }
        const patch: Record<string, unknown> = { state };
        const nowIso = new Date().toISOString();
        if (state === "suspended") { patch.suspended_at = nowIso; patch.suspended_by = userId; }
        if (state === "ended") { patch.ended_at = nowIso; patch.ended_by = userId; patch.end_reason_code = endReason; }
        if (state === "active") { patch.suspended_at = null; patch.suspended_by = null; }
        const { data: link, error } = await admin.schema("aml").from("partner_case_links")
          .update(patch).eq("id", linkId).select("*").single();
        if (error) throw error;
        await appendCaseEvent(admin, link.case_id, "system",
          `Partner link ${state}${endReason ? ` (${endReason})` : ""}`,
          { partner_case_link_id: link.id, partner_org_id: link.partner_org_id, state, end_reason_code: endReason },
          userId, userEmail);
        return jr({ link });
      }

      case "list_partner_mappings": {
        const { data, error } = await admin.schema("aml").from("partner_org_name_mappings")
          .select("*").order("created_at", { ascending: true });
        if (error) throw error;
        return jr({ mappings: data ?? [] });
      }

      case "resolve_partner_mapping": {
        if (!isMlro) return jr({ error: "MLRO role required — mapping a legal identity is a reviewed decision" }, 403);
        const mappingId = String(body.mapping_id ?? "");
        const action = String(body.action ?? "map");
        if (!mappingId) return jr({ error: "mapping_id required" }, 400);
        const { data: mapping } = await admin.schema("aml").from("partner_org_name_mappings")
          .select("*").eq("id", mappingId).maybeSingle();
        if (!mapping) return jr({ error: "Mapping not found" }, 404);
        if (mapping.status !== "pending") return jr({ error: `Mapping already ${mapping.status}` }, 409);

        if (action === "reject") {
          const { data, error } = await admin.schema("aml").from("partner_org_name_mappings").update({
            status: "rejected", mapped_by: userId, mapped_at: new Date().toISOString(),
            note: String(body.note ?? "").slice(0, 2000) || null,
          }).eq("id", mappingId).select("*").single();
          if (error) throw error;
          return jr({ mapping: data });
        }

        const orgId = String(body.partner_org_id ?? "");
        if (!orgId) return jr({ error: "partner_org_id required to map" }, 400);
        const { data: org } = await admin.schema("aml").from("partner_organisations")
          .select("id, status, organisation_type, legal_name").eq("id", orgId).maybeSingle();
        if (!org) return jr({ error: "Partner organisation not found" }, 404);
        // Exact review, no fuzzy tolerance: an org-type mismatch between the
        // historical agreement and the canonical record must be resolved by
        // fixing one of them, not waved through.
        if (org.organisation_type !== mapping.original_org_type) {
          return jr({
            error: `Type mismatch: agreement recorded "${mapping.original_org_type}" but the organisation is "${org.organisation_type}". Correct whichever record is wrong, then map.`,
            code: "mapping_type_mismatch",
          }, 409);
        }
        const nowIso = new Date().toISOString();
        const { data: updatedMapping, error: mapErr } = await admin.schema("aml")
          .from("partner_org_name_mappings").update({
            status: "mapped", proposed_partner_org_id: orgId,
            mapped_by: userId, mapped_at: nowIso,
            note: String(body.note ?? "").slice(0, 2000) || null,
          }).eq("id", mappingId).select("*").single();
        if (mapErr) throw mapErr;
        const { error: agErr } = await admin.schema("aml").from("reliance_agreements")
          .update({ partner_org_id: orgId, updated_at: nowIso })
          .eq("id", mapping.agreement_id);
        if (agErr) throw agErr;
        return jr({ mapping: updatedMapping });
      }

      default:
        return jr({ error: `Unknown op: ${op}` }, 400);
    }
  } catch (e: any) {
    console.error("[aml-reliance] error", e);
    return jr({ error: e?.message ?? "internal_error" }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin into an allowlisted one.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
