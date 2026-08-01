/**
 * Builder Delivery Admin — Command Centre control plane
 *
 * Mirrors `builder-construction-admin` for the delivery domain: staff callers
 * are gated deny-by-default on the `builder_portal_admin` module permission
 * (superadmin bypass preserved), and every mutation additionally requires CSRF
 * validation because the staff session is cookie-carried.
 *
 * This function serves the INTERNAL surface only. It resolves a Command Centre
 * session and never accepts a Builder Portal session cookie (ADR 018).
 *
 * Operations mirror the portal function exactly, minus the portal-only summary:
 *   list_variations | upsert_variation | list_approvals | upsert_approval
 *   list_claims | upsert_claim | list_inspections | upsert_inspection
 *   list_defects | upsert_defect | get_completion | save_completion
 *   list_warranty_claims | upsert_warranty_claim | set_status | delivery_history
 *
 * Boundary invariants enforced here, not merely documented:
 *   * A case, variation, claim, inspection or defect id supplied by the browser
 *     is never authority; the module permission is, and every child write is
 *     scoped to a re-read construction case.
 *   * Every mutation goes through a guarded database command that writes its
 *     audit row in the SAME transaction (Phase 0 NOCOPY-04).
 *   * expected_version is required on every update: missing is 400, stale 409.
 *   * `build_progress_payments` and `builder_invoices` are Finance-owned and are
 *     never read or written here. A progress claim carries a Finance POINTER
 *     only — no payment, receipt or commission.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission, type ModulePerm } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  BUILDER_VARIATION_SELECT,
  BUILDER_VARIATION_APPROVAL_SELECT,
  BUILDER_CLAIM_SELECT,
  BUILDER_INSPECTION_SELECT,
  BUILDER_DEFECT_SELECT,
  BUILDER_PC_SELECT,
  BUILDER_HANDOVER_SELECT,
  BUILDER_WARRANTY_SELECT,
  BUILDER_WARRANTY_CLAIM_SELECT,
  BUILDER_DELIVERY_HISTORY_SELECT,
  BUILDER_DELIVERY_KINDS,
  buildVariationPayload,
  buildApprovalPayload,
  buildClaimPayload,
  buildInspectionPayload,
  buildDefectPayload,
  buildDeliveryRecordPayload,
  buildWarrantyClaimPayload,
  deliveryCommandFailure,
  permissionKeyFor,
  cleanEnum,
  cleanText,
} from '../_shared/builderDelivery.ts';

const MODULE_KEY = 'builder_portal_admin';

const READ_OPERATIONS = new Set([
  'list_variations', 'list_approvals', 'list_claims', 'list_inspections',
  'list_defects', 'get_completion', 'list_warranty_claims', 'delivery_history',
]);

function requiredPermFor(operation: string): ModulePerm {
  return READ_OPERATIONS.has(operation) ? 'can_view' : 'can_edit';
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, any>));
    const operation = String(body.operation || '');

    // 1. Internal authentication. A Builder Portal cookie is not a staff session.
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return json({ error: auth.error || 'Authentication required' }, 401);
    }

    // 2. Module permission, deny by default.
    const authz = await requireModulePermission(
      supabase, { userId: auth.userId, authMethod: auth.authMethod },
      MODULE_KEY, requiredPermFor(operation),
    );
    if (!authz.ok) {
      return createForbiddenResponse(authz.error || 'Not authorized', corsHeaders);
    }

    // verifyAuth() returns the literal string 'service_role' for a verified
    // internal call. That is not a uuid (Phase 1 finding P2).
    const isServiceRoleActor = auth.userId === 'service_role';
    const adminUserId: string | null = isServiceRoleActor ? null : auth.userId;
    const actorType = isServiceRoleActor ? 'service_role' : 'command_user';

    /**
     * Re-read the construction case. The browser's id is a lookup key, never
     * authority — the module permission is what authorises a staff caller, and
     * every child write below is scoped to the case this returns.
     */
    const loadCase = async (
      caseId: string, _permissionKey: string, _level: 'view' | 'edit' | 'delete' = 'view',
    ): Promise<
      { ok: true; caseId: string } | { ok: false; status: number; error: string }
    > => {
      if (!caseId) return { ok: false, status: 400, error: 'construction_case_id is required' };
      const { data: record } = await supabase.from('builder_construction_cases')
        .select('id, project_id').eq('id', caseId).maybeSingle();
      if (!record) return { ok: false, status: 404, error: 'Construction case not found' };
      return { ok: true, caseId: record.id };
    };

    const fail = (message: string, fallbackStatus = 400, fallbackError = 'The request failed') => {
      const mapped = deliveryCommandFailure(message);
      return mapped
        ? json({ error: mapped.error, code: mapped.code }, mapped.status)
        : json({ error: fallbackError }, fallbackStatus);
    };

    /**
     * Read expected_version for an update. Missing is a hard 400: it is never
     * silently replaced with the current database value.
     */
    const requireVersion = (): number | { error: Response } => {
      const supplied = Number(body.expected_version);
      if (!Number.isInteger(supplied) || supplied < 1) {
        return {
          error: json({
            error: 'expected_version is required when updating an existing record',
            code: 'EXPECTED_VERSION_REQUIRED',
          }, 400),
        };
      }
      return supplied;
    };

    /**
     * Confirm a record belongs to the resolved case. Written out per table
     * because the generated Supabase types cannot resolve a union of table
     * names — and because this is the check that stops an id aimed at another
     * case, or at another aggregate, from matching anything.
     */
    const ownedByCase = async (kind: string, entityId: string, caseId: string) => {
      switch (kind) {
        case 'variation':
          return (await supabase.from('builder_variations').select('id')
            .eq('id', entityId).eq('construction_case_id', caseId).maybeSingle()).data;
        case 'progress_claim':
          return (await supabase.from('builder_progress_claims').select('id')
            .eq('id', entityId).eq('construction_case_id', caseId).maybeSingle()).data;
        case 'inspection':
          return (await supabase.from('builder_inspections').select('id')
            .eq('id', entityId).eq('construction_case_id', caseId).maybeSingle()).data;
        case 'defect':
          return (await supabase.from('builder_defects').select('id')
            .eq('id', entityId).eq('construction_case_id', caseId).maybeSingle()).data;
        case 'practical_completion':
          return (await supabase.from('builder_practical_completions').select('id')
            .eq('id', entityId).eq('construction_case_id', caseId).maybeSingle()).data;
        case 'handover':
          return (await supabase.from('builder_handovers').select('id')
            .eq('id', entityId).eq('construction_case_id', caseId).maybeSingle()).data;
        case 'warranty_claim':
          return (await supabase.from('builder_warranty_claims').select('id')
            .eq('id', entityId).eq('construction_case_id', caseId).maybeSingle()).data;
        default:
          return null;
      }
    };

    // ───────────────────────── VARIATIONS ─────────────────────────
    if (operation === 'list_variations') {
      const res = await loadCase(String(body.construction_case_id || ''), 'variations');
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data } = await supabase.from('builder_variations').select(BUILDER_VARIATION_SELECT)
        .eq('construction_case_id', res.caseId).order('created_at', { ascending: false }).limit(200);
      return json({ success: true, records: data || [] });
    }

    if (operation === 'upsert_variation') {
      const res = await loadCase(String(body.construction_case_id || ''), 'variations', 'edit');
      if (!res.ok) return json({ error: res.error }, res.status);

      const variationId = cleanText(body.variation_id, 64);
      let expectedVersion: number | null = null;
      if (variationId) {
        const version = requireVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
        if (!await ownedByCase('variation', variationId, res.caseId)) {
          return json({ error: 'Variation not found' }, 404);
        }
      }
      const payload = buildVariationPayload(body);
      if (!variationId && !payload.title) return json({ error: 'A title is required' }, 400);

      const { data, error } = await supabase.rpc('builder_upsert_variation', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _variation_id: variationId,
        _construction_case_id: variationId ? null : res.caseId,
        _payload: payload,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The variation could not be saved');
      return json({ success: true, record: data });
    }

    if (operation === 'list_approvals') {
      const res = await loadCase(String(body.construction_case_id || ''), 'variations');
      if (!res.ok) return json({ error: res.error }, res.status);
      const variationId = cleanText(body.variation_id, 64);
      if (!variationId) return json({ error: 'variation_id is required' }, 400);
      if (!await ownedByCase('variation', variationId, res.caseId)) {
        return json({ error: 'Variation not found' }, 404);
      }
      const { data } = await supabase.from('builder_variation_approvals')
        .select(BUILDER_VARIATION_APPROVAL_SELECT)
        .eq('variation_id', variationId).order('created_at', { ascending: true });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'upsert_approval') {
      const res = await loadCase(String(body.construction_case_id || ''), 'variations', 'edit');
      if (!res.ok) return json({ error: res.error }, res.status);

      const approvalId = cleanText(body.approval_id, 64);
      const variationId = cleanText(body.variation_id, 64);
      let expectedVersion: number | null = null;
      if (approvalId) {
        const version = requireVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
      } else {
        if (!variationId) return json({ error: 'variation_id is required' }, 400);
        if (!await ownedByCase('variation', variationId, res.caseId)) {
          return json({ error: 'Variation not found' }, 404);
        }
      }
      const payload = buildApprovalPayload(body);
      if (!approvalId && !payload.approver_name) {
        return json({ error: 'An approver name is required' }, 400);
      }

      const { data, error } = await supabase.rpc('builder_upsert_variation_approval', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _approval_id: approvalId,
        _variation_id: approvalId ? null : variationId,
        _payload: payload,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The approval could not be saved');
      return json({ success: true, record: data });
    }

    // ───────────────────────── PROGRESS CLAIMS ─────────────────────────
    if (operation === 'list_claims') {
      const res = await loadCase(String(body.construction_case_id || ''), 'progress_claims');
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data } = await supabase.from('builder_progress_claims').select(BUILDER_CLAIM_SELECT)
        .eq('construction_case_id', res.caseId).order('created_at', { ascending: false }).limit(200);
      return json({ success: true, records: data || [] });
    }

    if (operation === 'upsert_claim') {
      const res = await loadCase(String(body.construction_case_id || ''), 'progress_claims', 'edit');
      if (!res.ok) return json({ error: res.error }, res.status);

      const claimId = cleanText(body.claim_id, 64);
      let expectedVersion: number | null = null;
      if (claimId) {
        const version = requireVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
        if (!await ownedByCase('progress_claim', claimId, res.caseId)) {
          return json({ error: 'Progress claim not found' }, 404);
        }
      }

      const { data, error } = await supabase.rpc('builder_upsert_progress_claim', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _claim_id: claimId,
        _construction_case_id: claimId ? null : res.caseId,
        _milestone_id: cleanText(body.milestone_id, 64),
        _payload: buildClaimPayload(body),
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The claim could not be saved');
      return json({ success: true, record: data });
    }

    // ───────────────────────── INSPECTIONS ─────────────────────────
    if (operation === 'list_inspections') {
      const res = await loadCase(String(body.construction_case_id || ''), 'inspections');
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data } = await supabase.from('builder_inspections').select(BUILDER_INSPECTION_SELECT)
        .eq('construction_case_id', res.caseId)
        .order('scheduled_for', { ascending: false, nullsFirst: false }).limit(200);
      return json({ success: true, records: data || [] });
    }

    if (operation === 'upsert_inspection') {
      const res = await loadCase(String(body.construction_case_id || ''), 'inspections', 'edit');
      if (!res.ok) return json({ error: res.error }, res.status);

      const inspectionId = cleanText(body.inspection_id, 64);
      let expectedVersion: number | null = null;
      if (inspectionId) {
        const version = requireVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
        if (!await ownedByCase('inspection', inspectionId, res.caseId)) {
          return json({ error: 'Inspection not found' }, 404);
        }
      }
      const payload = buildInspectionPayload(body);
      if (!inspectionId && !payload.title) return json({ error: 'A title is required' }, 400);

      const { data, error } = await supabase.rpc('builder_upsert_inspection', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _inspection_id: inspectionId,
        _construction_case_id: inspectionId ? null : res.caseId,
        _construction_stage_id: cleanText(body.construction_stage_id, 64),
        _payload: payload,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The inspection could not be saved');
      return json({ success: true, record: data });
    }

    // ───────────────────────── DEFECTS ─────────────────────────
    if (operation === 'list_defects') {
      const res = await loadCase(String(body.construction_case_id || ''), 'defects');
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data } = await supabase.from('builder_defects').select(BUILDER_DEFECT_SELECT)
        .eq('construction_case_id', res.caseId).order('raised_at', { ascending: false }).limit(500);
      return json({ success: true, records: data || [] });
    }

    if (operation === 'upsert_defect') {
      const res = await loadCase(String(body.construction_case_id || ''), 'defects', 'edit');
      if (!res.ok) return json({ error: res.error }, res.status);

      const defectId = cleanText(body.defect_id, 64);
      let expectedVersion: number | null = null;
      if (defectId) {
        const version = requireVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
        if (!await ownedByCase('defect', defectId, res.caseId)) {
          return json({ error: 'Defect not found' }, 404);
        }
      }
      const payload = buildDefectPayload(body);
      if (!defectId && !payload.title) return json({ error: 'A title is required' }, 400);

      const { data, error } = await supabase.rpc('builder_upsert_defect', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _defect_id: defectId,
        _construction_case_id: defectId ? null : res.caseId,
        _inspection_id: cleanText(body.inspection_id, 64),
        _payload: payload,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The defect could not be saved');
      return json({ success: true, record: data });
    }

    // ───────────── PRACTICAL COMPLETION / HANDOVER / WARRANTY ─────────────
    if (operation === 'get_completion') {
      const res = await loadCase(String(body.construction_case_id || ''), 'handover');
      if (!res.ok) return json({ error: res.error }, res.status);
      const [{ data: pc }, { data: handover }, { data: warranty }, { data: claims }] =
        await Promise.all([
          supabase.from('builder_practical_completions').select(BUILDER_PC_SELECT)
            .eq('construction_case_id', res.caseId).maybeSingle(),
          supabase.from('builder_handovers').select(BUILDER_HANDOVER_SELECT)
            .eq('construction_case_id', res.caseId).maybeSingle(),
          supabase.from('builder_warranties').select(BUILDER_WARRANTY_SELECT)
            .eq('construction_case_id', res.caseId).maybeSingle(),
          supabase.from('builder_warranty_claims').select(BUILDER_WARRANTY_CLAIM_SELECT)
            .eq('construction_case_id', res.caseId).order('lodged_at', { ascending: false }).limit(100),
        ]);
      return json({
        success: true,
        practical_completion: pc ?? null,
        handover: handover ?? null,
        warranty: warranty ?? null,
        warranty_claims: claims || [],
      });
    }

    if (operation === 'save_completion') {
      const res = await loadCase(String(body.construction_case_id || ''), 'handover', 'edit');
      if (!res.ok) return json({ error: res.error }, res.status);

      const kind = cleanEnum(body.kind, ['practical_completion', 'handover', 'warranty'] as const);
      if (!kind) return json({ error: 'Unknown record type' }, 400);

      // The first save creates the row; every save after that carries a version.
      let expectedVersion: number | null = null;
      if (body.expected_version !== undefined && body.expected_version !== null) {
        const version = requireVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
      }

      const { data, error } = await supabase.rpc('builder_upsert_delivery_record', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _kind: kind,
        _construction_case_id: res.caseId,
        _payload: buildDeliveryRecordPayload(kind, body),
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The record could not be saved');
      return json({ success: true, record: data });
    }

    if (operation === 'list_warranty_claims') {
      const res = await loadCase(String(body.construction_case_id || ''), 'handover');
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data } = await supabase.from('builder_warranty_claims')
        .select(BUILDER_WARRANTY_CLAIM_SELECT)
        .eq('construction_case_id', res.caseId).order('lodged_at', { ascending: false }).limit(200);
      return json({ success: true, records: data || [] });
    }

    if (operation === 'upsert_warranty_claim') {
      const res = await loadCase(String(body.construction_case_id || ''), 'handover', 'edit');
      if (!res.ok) return json({ error: res.error }, res.status);

      const claimId = cleanText(body.warranty_claim_id, 64);
      let expectedVersion: number | null = null;
      if (claimId) {
        const version = requireVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
        if (!await ownedByCase('warranty_claim', claimId, res.caseId)) {
          return json({ error: 'Warranty claim not found' }, 404);
        }
      }
      const payload = buildWarrantyClaimPayload(body);
      if (!claimId && !payload.title) return json({ error: 'A title is required' }, 400);

      const { data, error } = await supabase.rpc('builder_upsert_warranty_claim', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _claim_id: claimId,
        _construction_case_id: claimId ? null : res.caseId,
        _warranty_id: cleanText(body.warranty_id, 64),
        _payload: payload,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      });
      if (error) return fail(String(error.message || ''), 400, 'The warranty claim could not be saved');
      return json({ success: true, record: data });
    }

    // ───────────────────────── STATUS ─────────────────────────
    if (operation === 'set_status') {
      const kind = cleanEnum(body.kind, BUILDER_DELIVERY_KINDS);
      if (!kind) return json({ error: 'Unknown record type' }, 400);

      const res = await loadCase(
        String(body.construction_case_id || ''), permissionKeyFor(kind), 'edit');
      if (!res.ok) return json({ error: res.error }, res.status);

      const entityId = cleanText(body.entity_id, 64);
      const expectedVersion = Number(body.expected_version);
      const reason = cleanText(body.reason, 1000);
      const from = cleanText(body.from_status, 60);
      const to = cleanText(body.status, 60);
      if (!entityId || !Number.isInteger(expectedVersion) || expectedVersion < 1
          || !reason || !from || !to) {
        return json({
          error: 'entity_id, status, from_status, expected_version and reason are required',
        }, 400);
      }

      // The record must belong to the resolved case, so an id aimed at another
      // case — or at another aggregate — matches nothing.
      if (!await ownedByCase(kind, entityId, res.caseId)) {
        return json({ error: 'Record not found' }, 404);
      }

      const { data, error } = await supabase.rpc('builder_transition_delivery', {
        _kind: kind,
        _entity_id: entityId,
        _expected_version: expectedVersion,
        _from: from,
        _to: to,
        _reason: reason,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _actor_staff_user_id: adminUserId,
      });
      if (error) return fail(String(error.message || ''), 400, 'The status could not be changed');
      return json({ success: true, record: data });
    }

    // ───────────────────────── HISTORY / SUMMARY ─────────────────────────
    if (operation === 'delivery_history') {
      const res = await loadCase(String(body.construction_case_id || ''), 'defects');
      if (!res.ok) return json({ error: res.error }, res.status);
      let query = supabase.from('builder_delivery_status_history')
        .select(BUILDER_DELIVERY_HISTORY_SELECT)
        .eq('construction_case_id', res.caseId)
        .order('created_at', { ascending: false }).limit(200);
      const kind = cleanEnum(body.kind, BUILDER_DELIVERY_KINDS);
      if (kind) query = query.eq('entity_kind', kind);
      const { data } = await query;
      return json({ success: true, records: data || [] });
    }

    return json({ error: 'Unknown operation' }, 400);
  } catch (error) {
    console.error('[builder-delivery-admin]', error);
    return json({ error: 'Internal server error' }, 500);
  }
});
