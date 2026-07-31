/**
 * Builder Inventory Admin — Command Centre control plane
 *
 * Mirrors `builder-projects-admin` — which mirrors `legal-matters-admin` — for
 * the inventory domain: staff callers are gated deny-by-default on the
 * `builder_portal_admin` module permission (superadmin bypass preserved), and
 * every mutation additionally requires CSRF validation because the staff session
 * is cookie-carried.
 *
 * This function serves the INTERNAL surface only. It resolves a Command Centre
 * session and never accepts a Builder Portal session cookie (ADR 018).
 *
 * Operations
 *   Structure:    list_stages | upsert_stage | list_buildings | upsert_building
 *                 list_lots | upsert_lot
 *   Units:        list_units | get_unit | create_unit | update_unit
 *                 set_availability | set_release | set_price
 *   Commercial:   list_holds | release_hold
 *                 list_reservations | set_reservation_status
 *                 list_allocations | create_allocation | release_allocation
 *
 * Boundary invariants enforced here, not merely documented:
 *   * A project, stage, unit or organisation id supplied by the browser is never
 *     authority; the module permission is, and every child write is scoped to a
 *     re-read parent.
 *   * Every mutation goes through a guarded database command that writes its
 *     audit row in the SAME transaction — a failed audit rolls the change back
 *     (Phase 0 NOCOPY-04).
 *   * Mutable aggregates require expected_version; missing is 400, stale is 409.
 *   * `builder_invoices` and `build_progress_payments` are Finance-owned and are
 *     never read or written here.
 *   * No cost, margin, supplier price or contractor price column is selected,
 *     because none exists — the migration asserts that at apply time.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission, type ModulePerm } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  BUILDER_UNIT_COMMAND_CENTRE_SELECT,
  BUILDER_STAGE_SELECT,
  BUILDER_BUILDING_SELECT,
  BUILDER_LOT_SELECT,
  BUILDER_PRICING_SELECT,
  BUILDER_HOLD_SELECT,
  BUILDER_RESERVATION_SELECT,
  BUILDER_ALLOCATION_SELECT,
  BUILDER_UNIT_HISTORY_SELECT,
  BUILDER_AVAILABILITY_STATUSES,
  BUILDER_RELEASE_STATUSES,
  BUILDER_RESERVATION_STATUSES,
  BUILDER_ALLOCATION_TYPES,
  BUILDER_PRICE_BASES,
  BUILDER_UNIT_TYPES,
  buildUnitPayload,
  buildStagePayload,
  buildBuildingPayload,
  buildLotPayload,
  cleanEnum,
  cleanNumber,
  cleanText,
  inventoryCommandFailure,
} from '../_shared/builderInventory.ts';

const MODULE_KEY = 'builder_portal_admin';

const READ_OPERATIONS = new Set([
  'list_stages', 'list_buildings', 'list_lots',
  'list_units', 'get_unit',
  'list_holds', 'list_reservations', 'list_allocations',
]);

function requiredPermFor(operation: string): ModulePerm {
  return READ_OPERATIONS.has(operation) ? 'can_view' : 'can_edit';
}

const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });


Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, any>));
    const operation = String(body.operation || '');

    // 1. Internal authentication. A Builder Portal cookie is not a staff session
    //    and cannot satisfy this.
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return json({ error: auth.error || 'Authentication required' }, 401, cors);
    }

    // 2. Module permission, deny by default.
    const authz = await requireModulePermission(
      supabase, { userId: auth.userId, authMethod: auth.authMethod },
      MODULE_KEY, requiredPermFor(operation),
    );
    if (!authz.ok) {
      return createForbiddenResponse(authz.error || 'Not authorized', cors);
    }

    // verifyAuth() returns the literal string 'service_role' for a verified
    // internal call. That is not a uuid, so it must never reach a uuid column or
    // a uuid RPC argument (Phase 1 finding P2).
    const isServiceRoleActor = auth.userId === 'service_role';
    const adminUserId: string | null = isServiceRoleActor ? null : auth.userId;
    const actorType = isServiceRoleActor ? 'service_role' : 'command_user';

    /** Re-read a project. The browser's id is a lookup key, never authority. */
    const requireProject = async (projectId: string | null) => {
      if (!projectId) return null;
      const { data } = await supabase.from('builder_projects')
        .select('id, developer_organisation_id, builder_organisation_id, name, project_reference')
        .eq('id', projectId).maybeSingle();
      return data ?? null;
    };

    /** Re-read a unit and its project so every child write is parent-scoped. */
    const requireUnit = async (unitId: string | null) => {
      if (!unitId) return null;
      const { data } = await supabase.from('builder_units')
        .select(BUILDER_UNIT_COMMAND_CENTRE_SELECT).eq('id', unitId).maybeSingle();
      return data ?? null;
    };

    /**
     * Read expected_version for an update. Missing is a hard 400: it is never
     * silently replaced with the current database value.
     */
    const requireExpectedVersion = (): number | { error: Response } => {
      const supplied = Number(body.expected_version);
      if (!Number.isInteger(supplied) || supplied < 1) {
        return {
          error: json({
            error: 'expected_version is required when updating an existing record',
            code: 'EXPECTED_VERSION_REQUIRED',
          }, 400, cors),
        };
      }
      return supplied;
    };

    // ───────────────────────── STRUCTURE ─────────────────────────
    if (operation === 'list_stages' || operation === 'list_buildings' || operation === 'list_lots') {
      const project = await requireProject(cleanText(body.project_id, 64));
      if (!project) return json({ error: 'project_id is required' }, 400, cors);
      // Written out per table rather than through a computed table name: the
      // generated Supabase types cannot resolve a union of table names.
      const rows = operation === 'list_stages'
        ? await supabase.from('builder_stages').select(BUILDER_STAGE_SELECT)
          .eq('project_id', project.id).order('created_at', { ascending: true }).limit(1000)
        : operation === 'list_buildings'
          ? await supabase.from('builder_buildings').select(BUILDER_BUILDING_SELECT)
            .eq('project_id', project.id).order('created_at', { ascending: true }).limit(1000)
          : await supabase.from('builder_lots').select(BUILDER_LOT_SELECT)
            .eq('project_id', project.id).order('created_at', { ascending: true }).limit(1000);
      if (rows.error) throw rows.error;
      return json({ success: true, records: rows.data || [] }, 200, cors);
    }

    if (operation === 'upsert_stage' || operation === 'upsert_building' || operation === 'upsert_lot') {
      const idField = operation === 'upsert_stage' ? 'stage_id'
        : operation === 'upsert_building' ? 'building_id' : 'lot_id';
      const recordId = cleanText(body[idField], 64);

      let expectedVersion: number | null = null;
      let projectId: string | null = null;
      if (recordId) {
        const version = requireExpectedVersion();
        if (typeof version !== 'number') return version.error;
        expectedVersion = version;
      } else {
        const project = await requireProject(cleanText(body.project_id, 64));
        if (!project) return json({ error: 'A valid project_id is required' }, 400, cors);
        projectId = project.id;
      }

      const rpcName = operation === 'upsert_stage' ? 'builder_upsert_stage'
        : operation === 'upsert_building' ? 'builder_upsert_building' : 'builder_upsert_lot';
      const payload = operation === 'upsert_stage' ? buildStagePayload(body)
        : operation === 'upsert_building' ? buildBuildingPayload(body) : buildLotPayload(body);

      const args: Record<string, unknown> = {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _project_id: projectId,
        _payload: payload,
        _expected_version: expectedVersion,
        _reason: cleanText(body.reason, 500),
      };
      if (operation === 'upsert_stage') args._stage_id = recordId;
      if (operation === 'upsert_building') {
        args._building_id = recordId;
        args._stage_id = cleanText(body.stage_id, 64);
      }
      if (operation === 'upsert_lot') {
        args._lot_id = recordId;
        args._stage_id = cleanText(body.stage_id, 64);
      }

      // Guarded command: the write and its trusted audit row share one
      // transaction, so a failed audit rolls the change back.
      const { data, error } = await supabase.rpc(rpcName, args);
      if (error) {
        const mapped = inventoryCommandFailure(String(error.message || ''));
        if (mapped) return json({ error: mapped.error, code: mapped.code }, mapped.status, cors);
        throw error;
      }
      return json({ success: true, record: data }, 200, cors);
    }

    // ───────────────────────── UNITS ─────────────────────────
    if (operation === 'list_units') {
      const page = Math.max(1, Math.floor(Number(body.page) || 1));
      const pageSize = Math.min(200, Math.max(10, Math.floor(Number(body.page_size) || 50)));
      const from = (page - 1) * pageSize;

      let query = supabase.from('builder_units')
        .select(BUILDER_UNIT_COMMAND_CENTRE_SELECT, { count: 'exact' })
        .order('created_at', { ascending: false });

      const projectId = cleanText(body.project_id, 64);
      if (projectId) query = query.eq('project_id', projectId);
      const stageId = cleanText(body.stage_id, 64);
      if (stageId) query = query.eq('stage_id', stageId);
      const availability = cleanEnum(body.availability_status, BUILDER_AVAILABILITY_STATUSES);
      if (availability) query = query.eq('availability_status', availability);
      const release = cleanEnum(body.release_status, BUILDER_RELEASE_STATUSES);
      if (release) query = query.eq('release_status', release);
      const unitType = cleanEnum(body.unit_type, BUILDER_UNIT_TYPES);
      if (unitType) query = query.eq('unit_type', unitType);
      const search = cleanText(body.search, 120);
      if (search) {
        const escaped = search.replace(/[%_,()]/g, ' ');
        query = query.or(`unit_number.ilike.%${escaped}%,description.ilike.%${escaped}%`);
      }

      const { data, error, count } = await query.range(from, from + pageSize - 1);
      if (error) throw error;
      return json({
        success: true,
        records: data || [],
        pagination: {
          page, page_size: pageSize, total: count || 0,
          total_pages: Math.max(1, Math.ceil((count || 0) / pageSize)),
        },
      }, 200, cors);
    }

    if (operation === 'get_unit') {
      const unit = await requireUnit(cleanText(body.unit_id, 64));
      if (!unit) return json({ error: 'Unit not found' }, 404, cors);

      const [{ data: price }, { data: history }, { data: holds },
        { data: reservations }, { data: allocations }] = await Promise.all([
        supabase.from('builder_unit_pricing').select(BUILDER_PRICING_SELECT)
          .eq('unit_id', unit.id).order('effective_from', { ascending: false }).limit(50),
        supabase.from('builder_unit_status_history').select(BUILDER_UNIT_HISTORY_SELECT)
          .eq('unit_id', unit.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('builder_unit_holds').select(BUILDER_HOLD_SELECT)
          .eq('unit_id', unit.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('builder_reservations').select(BUILDER_RESERVATION_SELECT)
          .eq('unit_id', unit.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('builder_allocations').select(BUILDER_ALLOCATION_SELECT)
          .eq('unit_id', unit.id).order('created_at', { ascending: false }).limit(50),
      ]);

      return json({
        success: true, unit,
        pricing: price || [], status_history: history || [],
        holds: holds || [], reservations: reservations || [], allocations: allocations || [],
      }, 200, cors);
    }

    if (operation === 'create_unit') {
      const project = await requireProject(cleanText(body.project_id, 64));
      if (!project) return json({ error: 'A valid project_id is required' }, 400, cors);
      const payload = buildUnitPayload(body, { isCreate: true });
      if (!payload.unit_number) return json({ error: 'unit_number is required' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_upsert_unit', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _unit_id: null,
        _project_id: project.id,
        _stage_id: cleanText(body.stage_id, 64),
        _building_id: cleanText(body.building_id, 64),
        _lot_id: cleanText(body.lot_id, 64),
        _payload: payload,
        _expected_version: null,
        _reason: cleanText(body.reason, 500),
      });
      if (error) {
        const mapped = inventoryCommandFailure(String(error.message || ''));
        if (mapped) return json({ error: mapped.error, code: mapped.code }, mapped.status, cors);
        throw error;
      }
      return json({ success: true, unit: data }, 200, cors);
    }

    if (operation === 'update_unit') {
      const unit = await requireUnit(cleanText(body.unit_id, 64));
      if (!unit) return json({ error: 'Unit not found' }, 404, cors);
      const version = requireExpectedVersion();
      if (typeof version !== 'number') return version.error;

      const payload = buildUnitPayload(body, { isCreate: false });
      if (!Object.keys(payload).length) return json({ error: 'Nothing to update' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_upsert_unit', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _unit_id: unit.id,
        _project_id: null,
        _stage_id: cleanText(body.stage_id, 64),
        _building_id: cleanText(body.building_id, 64),
        _lot_id: cleanText(body.lot_id, 64),
        _payload: payload,
        _expected_version: version,
        _reason: cleanText(body.reason, 500),
      });
      if (error) {
        const mapped = inventoryCommandFailure(String(error.message || ''));
        if (mapped) return json({ error: mapped.error, code: mapped.code }, mapped.status, cors);
        throw error;
      }
      return json({ success: true, unit: data }, 200, cors);
    }

    if (operation === 'set_availability' || operation === 'set_release') {
      const unit = await requireUnit(cleanText(body.unit_id, 64));
      if (!unit) return json({ error: 'Unit not found' }, 404, cors);
      const version = requireExpectedVersion();
      if (typeof version !== 'number') return version.error;

      const isAvailability = operation === 'set_availability';
      const next = cleanEnum(
        body.status, isAvailability ? BUILDER_AVAILABILITY_STATUSES : BUILDER_RELEASE_STATUSES);
      const reason = cleanText(body.reason, 1000);
      if (!next || !reason) return json({ error: 'status and reason are required' }, 400, cors);

      const { data, error } = await supabase.rpc(
        isAvailability ? 'builder_transition_unit_availability' : 'builder_transition_unit_release', {
          _unit_id: unit.id,
          _expected_version: version,
          _from: isAvailability ? unit.availability_status : unit.release_status,
          _to: next,
          _reason: reason,
          _actor_type: actorType,
          _actor_builder_user_id: null,
          _actor_staff_user_id: adminUserId,
        });
      if (error) {
        const mapped = inventoryCommandFailure(String(error.message || ''));
        if (mapped) return json({ error: mapped.error, code: mapped.code }, mapped.status, cors);
        return json({ error: 'Unable to change the unit status' }, 400, cors);
      }
      return json({ success: true, unit: data }, 200, cors);
    }

    if (operation === 'set_price') {
      const unit = await requireUnit(cleanText(body.unit_id, 64));
      if (!unit) return json({ error: 'Unit not found' }, 404, cors);
      const listPrice = cleanNumber(body.list_price);
      if (listPrice === null || listPrice < 0) return json({ error: 'list_price is required' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_set_unit_price', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _unit_id: unit.id,
        _list_price: listPrice,
        _price_basis: cleanEnum(body.price_basis, BUILDER_PRICE_BASES, 'fixed'),
        _reason: cleanText(body.reason, 500),
      });
      if (error) {
        const mapped = inventoryCommandFailure(String(error.message || ''));
        if (mapped) return json({ error: mapped.error, code: mapped.code }, mapped.status, cors);
        throw error;
      }
      return json({ success: true, price: data }, 200, cors);
    }

    // ───────────────────────── HOLDS ─────────────────────────
    if (operation === 'list_holds') {
      const unitId = cleanText(body.unit_id, 64);
      let query = supabase.from('builder_unit_holds').select(BUILDER_HOLD_SELECT)
        .order('created_at', { ascending: false }).limit(200);
      if (unitId) query = query.eq('unit_id', unitId);
      const { data, error } = await query;
      if (error) throw error;
      return json({ success: true, records: data || [] }, 200, cors);
    }

    if (operation === 'release_hold') {
      const holdId = cleanText(body.hold_id, 64);
      if (!holdId) return json({ error: 'hold_id is required' }, 400, cors);
      const version = requireExpectedVersion();
      if (typeof version !== 'number') return version.error;

      const { data, error } = await supabase.rpc('builder_release_unit_hold', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _hold_id: holdId,
        _expected_version: version,
        _reason: cleanText(body.reason, 500),
      });
      if (error) {
        const mapped = inventoryCommandFailure(String(error.message || ''));
        if (mapped) return json({ error: mapped.error, code: mapped.code }, mapped.status, cors);
        throw error;
      }
      return json({ success: true, hold: data }, 200, cors);
    }

    // ───────────────────────── RESERVATIONS ─────────────────────────
    if (operation === 'list_reservations') {
      const unitId = cleanText(body.unit_id, 64);
      const status = cleanEnum(body.status, BUILDER_RESERVATION_STATUSES);
      let query = supabase.from('builder_reservations').select(BUILDER_RESERVATION_SELECT)
        .order('created_at', { ascending: false }).limit(200);
      if (unitId) query = query.eq('unit_id', unitId);
      if (status) query = query.eq('status', status);
      const { data, error } = await query;
      if (error) throw error;
      return json({ success: true, records: data || [] }, 200, cors);
    }

    if (operation === 'set_reservation_status') {
      const reservationId = cleanText(body.reservation_id, 64);
      if (!reservationId) return json({ error: 'reservation_id is required' }, 400, cors);
      const { data: reservation } = await supabase.from('builder_reservations')
        .select('id, status').eq('id', reservationId).maybeSingle();
      if (!reservation) return json({ error: 'Reservation not found' }, 404, cors);
      const version = requireExpectedVersion();
      if (typeof version !== 'number') return version.error;

      const next = cleanEnum(body.status, BUILDER_RESERVATION_STATUSES);
      const reason = cleanText(body.reason, 1000);
      if (!next || !reason) return json({ error: 'status and reason are required' }, 400, cors);

      const { data, error } = await supabase.rpc('builder_transition_reservation', {
        _reservation_id: reservation.id,
        _expected_version: version,
        _from: reservation.status,
        _to: next,
        _reason: reason,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _actor_staff_user_id: adminUserId,
      });
      if (error) {
        const mapped = inventoryCommandFailure(String(error.message || ''));
        if (mapped) return json({ error: mapped.error, code: mapped.code }, mapped.status, cors);
        return json({ error: 'Unable to change the reservation status' }, 400, cors);
      }
      return json({ success: true, reservation: data }, 200, cors);
    }

    // ───────────────────────── ALLOCATIONS ─────────────────────────
    if (operation === 'list_allocations') {
      const unitId = cleanText(body.unit_id, 64);
      let query = supabase.from('builder_allocations').select(BUILDER_ALLOCATION_SELECT)
        .order('created_at', { ascending: false }).limit(200);
      if (unitId) query = query.eq('unit_id', unitId);
      const { data, error } = await query;
      if (error) throw error;
      return json({ success: true, records: data || [] }, 200, cors);
    }

    if (operation === 'create_allocation') {
      const unit = await requireUnit(cleanText(body.unit_id, 64));
      if (!unit) return json({ error: 'Unit not found' }, 404, cors);
      const organisationId = cleanText(body.allocated_to_organisation_id, 64);
      if (!organisationId) {
        return json({ error: 'allocated_to_organisation_id is required' }, 400, cors);
      }
      // Re-read the parent organisation. The browser's id is not authority; the
      // guarded command re-checks status again as a backstop.
      const { data: organisation } = await supabase.from('builder_organisations')
        .select('id, status').eq('id', organisationId).maybeSingle();
      if (!organisation) return json({ error: 'Organisation not found' }, 404, cors);
      if (organisation.status === 'closed') return json({ error: 'Organisation is closed' }, 409, cors);

      const { data, error } = await supabase.rpc('builder_create_allocation', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _unit_id: unit.id,
        _allocated_to_organisation_id: organisation.id,
        _allocation_type: cleanEnum(body.allocation_type, BUILDER_ALLOCATION_TYPES, 'sales_channel'),
        _expires_at: body.expires_at ? String(body.expires_at) : null,
        _reference: cleanText(body.reference, 60),
        _reason: cleanText(body.reason, 500),
      });
      if (error) {
        const mapped = inventoryCommandFailure(String(error.message || ''));
        if (mapped) return json({ error: mapped.error, code: mapped.code }, mapped.status, cors);
        if (String(error.message || '').includes('builder_allocations_one_active')) {
          return json({ error: 'This unit already has an active allocation', code: 'ALLOCATION_EXISTS' }, 409, cors);
        }
        throw error;
      }
      return json({ success: true, allocation: data }, 200, cors);
    }

    if (operation === 'release_allocation') {
      const allocationId = cleanText(body.allocation_id, 64);
      if (!allocationId) return json({ error: 'allocation_id is required' }, 400, cors);
      const version = requireExpectedVersion();
      if (typeof version !== 'number') return version.error;

      const { data, error } = await supabase.rpc('builder_release_allocation', {
        _actor_user_id: adminUserId,
        _actor_type: actorType,
        _actor_builder_user_id: null,
        _allocation_id: allocationId,
        _expected_version: version,
        _reason: cleanText(body.reason, 500),
      });
      if (error) {
        const mapped = inventoryCommandFailure(String(error.message || ''));
        if (mapped) return json({ error: mapped.error, code: mapped.code }, mapped.status, cors);
        throw error;
      }
      return json({ success: true, allocation: data }, 200, cors);
    }

    return json({ error: 'Unknown operation' }, 400, cors);
  } catch (error) {
    console.error('[builder-inventory-admin]', error);
    return json({ error: 'Internal server error' }, 500, cors);
  }
});
