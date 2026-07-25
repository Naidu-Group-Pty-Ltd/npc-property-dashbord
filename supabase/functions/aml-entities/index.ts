/**
 * Phase 6 — Entities & Beneficial Owners.
 *
 * Ops (POST {op, ...args}):
 *   Entities:  list_entities, get_entity, upsert_entity, delete_entity
 *   Owners:    list_owners, upsert_owner, delete_owner
 *   Reps:      list_reps, upsert_rep, delete_rep
 *   Linking:   list_case_links, link_case, unlink_case, list_entities_for_case
 *   Insights:  ownership_summary
 *
 * Read: any AML role. Writes: analyst/reviewer/mlro.
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

async function appendCaseEvent(
  admin: any, caseId: string, category: string, summary: string,
  payload: any, actorId: string | null, actorLabel: string | null,
) {
  const { data: prev } = await admin.schema("aml").from("case_events")
    .select("row_hash").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, created_at: now,
  }));
  const { error } = await admin.schema("aml").from("case_events").insert({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
  if (error) throw new Error(`Failed to append case event: ${error.message}`);
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

    const op = String(body?.op ?? "");
    const requireWrite = () => { if (!canWrite) throw new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); };

    const aml = admin.schema("aml");

    // ── ENTITIES ─────────────────────────────────────────────
    if (op === "list_entities") {
      const q = String(body.search ?? "").trim();
      const type = body.entity_type ? String(body.entity_type) : null;
      const limit = Math.min(Number(body.limit ?? 100), 500);
      const offset = Number(body.offset ?? 0);
      let query = aml.from("entities").select("*", { count: "exact" })
        .order("updated_at", { ascending: false }).range(offset, offset + limit - 1);
      if (type) query = query.eq("entity_type", type);
      if (q) query = query.or(`legal_name.ilike.%${q}%,trading_name.ilike.%${q}%,abn.ilike.%${q}%,acn.ilike.%${q}%`);
      const { data, count, error } = await query;
      if (error) return jr({ error: error.message }, 400);
      return jr({ entities: data ?? [], total: count ?? 0 });
    }

    if (op === "get_entity") {
      const id = String(body.entity_id ?? "");
      if (!id) return jr({ error: "entity_id required" }, 400);
      const [{ data: entity }, { data: owners }, { data: reps }, { data: links }] = await Promise.all([
        aml.from("entities").select("*").eq("id", id).maybeSingle(),
        aml.from("beneficial_owners").select("*").eq("entity_id", id).order("ownership_percent", { ascending: false }),
        aml.from("authorised_representatives").select("*").eq("entity_id", id).order("role_title"),
        aml.from("entity_case_links").select("*, case:cases(id,case_reference,subject_display_name,status,risk_rating)").eq("entity_id", id),
      ]);
      if (!entity) return jr({ error: "Not found" }, 404);
      return jr({ entity, owners: owners ?? [], reps: reps ?? [], links: links ?? [] });
    }

    if (op === "upsert_entity") {
      requireWrite();
      const patch = body.entity ?? {};
      const isNew = !patch.id;
      const row = { ...patch };
      if (isNew) row.created_by = userId;
      const { data, error } = await aml.from("entities")
        .upsert(row).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ entity: data });
    }

    if (op === "delete_entity") {
      requireWrite();
      const id = String(body.entity_id ?? "");
      if (!id) return jr({ error: "entity_id required" }, 400);
      const [{ data: entity }, { data: owners }, { data: reps }, { data: links }] = await Promise.all([
        aml.from("entities").select("id, legal_name, trading_name, entity_type").eq("id", id).maybeSingle(),
        aml.from("beneficial_owners").select("id").eq("entity_id", id),
        aml.from("authorised_representatives").select("id").eq("entity_id", id),
        aml.from("entity_case_links").select("id, case_id, link_role").eq("entity_id", id),
      ]);
      if (!entity) return jr({ error: "Not found" }, 404);
      const affectedLinks = links ?? [];
      for (const link of affectedLinks) {
        await appendCaseEvent(admin, link.case_id, "system", `Entity deletion requested: ${entity.legal_name ?? entity.trading_name ?? id}`,
          {
            entity_id: id,
            link_id: link.id,
            link_role: link.link_role,
            entity_type: entity.entity_type,
            beneficial_owner_count: owners?.length ?? 0,
            authorised_representative_count: reps?.length ?? 0,
          }, userId, userLabel);
      }
      const { error } = await aml.from("entities").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      return jr({ ok: true, audited_case_count: affectedLinks.length });
    }

    // ── OWNERS ───────────────────────────────────────────────
    if (op === "list_owners") {
      const eid = String(body.entity_id ?? "");
      if (!eid) return jr({ error: "entity_id required" }, 400);
      const { data } = await aml.from("beneficial_owners").select("*").eq("entity_id", eid)
        .order("ownership_percent", { ascending: false });
      return jr({ owners: data ?? [] });
    }
    if (op === "upsert_owner") {
      requireWrite();
      const patch = body.owner ?? {};
      if (!patch.entity_id) return jr({ error: "entity_id required" }, 400);
      const isNew = !patch.id;
      const row = { ...patch };
      if (isNew) row.created_by = userId;
      const { data, error } = await aml.from("beneficial_owners").upsert(row).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ owner: data });
    }
    if (op === "delete_owner") {
      requireWrite();
      const id = String(body.owner_id ?? "");
      if (!id) return jr({ error: "owner_id required" }, 400);
      const { data: existing } = await aml.from("beneficial_owners")
        .select("id, entity_id, full_name, ownership_percent, is_ubo, verification_state").eq("id", id).maybeSingle();
      if (!existing) return jr({ error: "Not found" }, 404);
      const { data: links } = await aml.from("entity_case_links").select("id, case_id, link_role").eq("entity_id", existing.entity_id);
      for (const link of links ?? []) {
        await appendCaseEvent(admin, link.case_id, "system", `Beneficial owner deletion requested: ${existing.full_name ?? id}`,
          { owner_id: id, entity_id: existing.entity_id, link_id: link.id, link_role: link.link_role, ownership_percent: existing.ownership_percent, is_ubo: existing.is_ubo, verification_state: existing.verification_state }, userId, userLabel);
      }
      const { error } = await aml.from("beneficial_owners").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      return jr({ ok: true, audited_case_count: links?.length ?? 0 });
    }

    // ── REPS ─────────────────────────────────────────────────
    if (op === "list_reps") {
      const eid = String(body.entity_id ?? "");
      if (!eid) return jr({ error: "entity_id required" }, 400);
      const { data } = await aml.from("authorised_representatives").select("*").eq("entity_id", eid).order("role_title");
      return jr({ reps: data ?? [] });
    }
    if (op === "upsert_rep") {
      requireWrite();
      const patch = body.rep ?? {};
      if (!patch.entity_id) return jr({ error: "entity_id required" }, 400);
      const isNew = !patch.id;
      const row = { ...patch };
      if (isNew) row.created_by = userId;
      const { data, error } = await aml.from("authorised_representatives").upsert(row).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ rep: data });
    }
    if (op === "delete_rep") {
      requireWrite();
      const id = String(body.rep_id ?? "");
      if (!id) return jr({ error: "rep_id required" }, 400);
      const { data: existing } = await aml.from("authorised_representatives")
        .select("id, entity_id, full_name, role_title, verification_state").eq("id", id).maybeSingle();
      if (!existing) return jr({ error: "Not found" }, 404);
      const { data: links } = await aml.from("entity_case_links").select("id, case_id, link_role").eq("entity_id", existing.entity_id);
      for (const link of links ?? []) {
        await appendCaseEvent(admin, link.case_id, "system", `Authorised representative deletion requested: ${existing.full_name ?? id}`,
          { rep_id: id, entity_id: existing.entity_id, link_id: link.id, link_role: link.link_role, role_title: existing.role_title, verification_state: existing.verification_state }, userId, userLabel);
      }
      const { error } = await aml.from("authorised_representatives").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      return jr({ ok: true, audited_case_count: links?.length ?? 0 });
    }

    // ── CASE LINKS ───────────────────────────────────────────
    if (op === "list_entities_for_case") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const { data } = await aml.from("entity_case_links")
        .select("*, entity:entities(*)").eq("case_id", caseId);
      return jr({ links: data ?? [] });
    }
    if (op === "link_case") {
      requireWrite();
      const caseId = String(body.case_id ?? "");
      const entityId = String(body.entity_id ?? "");
      const linkRole = String(body.link_role ?? "subject");
      if (!caseId || !entityId) return jr({ error: "case_id + entity_id required" }, 400);
      const { data, error } = await aml.from("entity_case_links")
        .upsert({ case_id: caseId, entity_id: entityId, link_role: linkRole, notes: body.notes ?? null, created_by: userId },
          { onConflict: "case_id,entity_id,link_role" })
        .select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      const { data: ent } = await aml.from("entities").select("legal_name").eq("id", entityId).maybeSingle();
      await appendCaseEvent(admin, caseId, "system", `Entity linked (${linkRole}): ${ent?.legal_name ?? entityId}`,
        { entity_id: entityId, link_role: linkRole }, userId, userLabel);
      return jr({ link: data });
    }
    if (op === "unlink_case") {
      requireWrite();
      const id = String(body.link_id ?? "");
      if (!id) return jr({ error: "link_id required" }, 400);
      const { data: existing } = await aml.from("entity_case_links").select("*").eq("id", id).maybeSingle();
      const { error } = await aml.from("entity_case_links").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      if (existing?.case_id) {
        await appendCaseEvent(admin, existing.case_id, "system", `Entity unlinked`,
          { link_id: id, entity_id: existing.entity_id }, userId, userLabel);
      }
      return jr({ ok: true });
    }

    // ── INSIGHTS ─────────────────────────────────────────────
    if (op === "ownership_summary") {
      const eid = String(body.entity_id ?? "");
      if (!eid) return jr({ error: "entity_id required" }, 400);
      const { data: owners } = await aml.from("beneficial_owners").select("*").eq("entity_id", eid);
      const list = owners ?? [];
      const total = list.reduce((s: number, o: any) => s + Number(o.ownership_percent || 0), 0);
      const ubo = list.filter((o: any) => Number(o.ownership_percent || 0) >= 25 || o.is_ubo);
      const pep = list.filter((o: any) => o.is_pep);
      const sanctioned = list.filter((o: any) => o.is_sanctioned);
      const unverified = list.filter((o: any) => o.verification_state !== "verified" && o.verification_state !== "waived");
      return jr({
        summary: {
          total_owners: list.length,
          total_ownership_percent: Number(total.toFixed(3)),
          ubo_count: ubo.length,
          pep_count: pep.length,
          sanctioned_count: sanctioned.length,
          unverified_count: unverified.length,
          missing_ownership_percent: Math.max(0, 100 - total),
        },
      });
    }

    return jr({ error: `Unknown op: ${op}` }, 400);
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("aml-entities error", e);
    return jr({ error: e?.message ?? "Unhandled error" }, 500);
  }
});
