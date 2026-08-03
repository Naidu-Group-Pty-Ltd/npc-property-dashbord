-- Builder Portal Inventory — Part A: tables, indexes, constraints, triggers

CREATE OR REPLACE FUNCTION public.builder_guard_permission_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.scope_type NOT IN ('organisation', 'project', 'stage', 'unit') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='BUILDER_SCOPE_NOT_AVAILABLE',
      DETAIL='Only organisation, project, stage and unit scopes exist.';
  END IF;

  IF NEW.scope_type = 'project' THEN
    IF NEW.scope_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.builder_projects WHERE id = NEW.scope_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',
        MESSAGE='BUILDER_SCOPE_TARGET_NOT_FOUND',
        DETAIL='a project-scoped permission must reference an existing project';
    END IF;
  ELSIF NEW.scope_type = 'stage' THEN
    IF NEW.scope_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.builder_stages WHERE id = NEW.scope_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',
        MESSAGE='BUILDER_SCOPE_TARGET_NOT_FOUND',
        DETAIL='a stage-scoped permission must reference an existing stage';
    END IF;
  ELSIF NEW.scope_type = 'unit' THEN
    IF NEW.scope_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.builder_units WHERE id = NEW.scope_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',
        MESSAGE='BUILDER_SCOPE_TARGET_NOT_FOUND',
        DETAIL='a unit-scoped permission must reference an existing unit';
    END IF;
  END IF;

  IF NEW.view_decision = 'deny' THEN
    NEW.edit_decision := 'deny';
    NEW.delete_decision := 'deny';
  ELSIF NEW.edit_decision = 'allow' OR NEW.delete_decision = 'allow' THEN
    NEW.view_decision := 'allow';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

ALTER TABLE public.builder_portal_activity_log
  DROP CONSTRAINT IF EXISTS builder_portal_activity_log_entity_type_check;
ALTER TABLE public.builder_portal_activity_log
  ADD CONSTRAINT builder_portal_activity_log_entity_type_check
  CHECK (entity_type IS NULL OR entity_type IN
    ('organisation', 'portal_user', 'membership', 'membership_permissions', 'session',
     'development', 'project', 'project_party', 'project_access',
     'stage', 'building', 'lot', 'unit', 'unit_price', 'unit_hold',
     'reservation', 'allocation'));

CREATE TABLE IF NOT EXISTS public.builder_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  stage_number text,
  description text,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','released','under_construction','completed','on_hold','cancelled')),
  estimated_completion_date date,
  actual_completion_date date,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, stage_number)
);
CREATE INDEX IF NOT EXISTS builder_stages_project_idx ON public.builder_stages(project_id);

CREATE TABLE IF NOT EXISTS public.builder_buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES public.builder_stages(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  building_code text,
  level_count integer CHECK (level_count IS NULL OR level_count > 0),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','under_construction','completed','on_hold','cancelled')),
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, building_code)
);
CREATE INDEX IF NOT EXISTS builder_buildings_project_idx ON public.builder_buildings(project_id);
CREATE INDEX IF NOT EXISTS builder_buildings_stage_idx ON public.builder_buildings(stage_id);

CREATE TABLE IF NOT EXISTS public.builder_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES public.builder_stages(id) ON DELETE SET NULL,
  lot_number text NOT NULL CHECK (length(btrim(lot_number)) > 0),
  plan_number text,
  land_area_sqm numeric(10,2) CHECK (land_area_sqm IS NULL OR land_area_sqm > 0),
  frontage_m numeric(8,2) CHECK (frontage_m IS NULL OR frontage_m > 0),
  titled boolean NOT NULL DEFAULT false,
  titled_at date,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','registered','titled','settled','withdrawn')),
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, lot_number)
);
CREATE INDEX IF NOT EXISTS builder_lots_project_idx ON public.builder_lots(project_id);
CREATE INDEX IF NOT EXISTS builder_lots_stage_idx ON public.builder_lots(stage_id);

CREATE TABLE IF NOT EXISTS public.builder_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES public.builder_stages(id) ON DELETE SET NULL,
  building_id uuid REFERENCES public.builder_buildings(id) ON DELETE SET NULL,
  lot_id uuid REFERENCES public.builder_lots(id) ON DELETE SET NULL,

  unit_number text NOT NULL CHECK (length(btrim(unit_number)) > 0),
  unit_type text NOT NULL DEFAULT 'house'
    CHECK (unit_type IN ('house','townhouse','apartment','duplex','land','terrace','other')),

  bedrooms smallint CHECK (bedrooms IS NULL OR bedrooms BETWEEN 0 AND 20),
  bathrooms numeric(3,1) CHECK (bathrooms IS NULL OR bathrooms BETWEEN 0 AND 20),
  car_spaces smallint CHECK (car_spaces IS NULL OR car_spaces BETWEEN 0 AND 20),
  internal_area_sqm numeric(10,2) CHECK (internal_area_sqm IS NULL OR internal_area_sqm > 0),
  external_area_sqm numeric(10,2) CHECK (external_area_sqm IS NULL OR external_area_sqm >= 0),
  level_number smallint,
  aspect text CHECK (aspect IS NULL OR aspect IN ('N','NE','E','SE','S','SW','W','NW')),

  availability_status text NOT NULL DEFAULT 'available'
    CHECK (availability_status IN ('available','on_hold','reserved','contracted','settled','withdrawn')),
  release_status text NOT NULL DEFAULT 'unreleased'
    CHECK (release_status IN ('unreleased','coming_soon','released','sold_out')),
  released_at timestamptz,

  estimated_completion_date date,
  description text,

  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, unit_number)
);
CREATE INDEX IF NOT EXISTS builder_units_project_idx ON public.builder_units(project_id);
CREATE INDEX IF NOT EXISTS builder_units_stage_idx ON public.builder_units(stage_id);
CREATE INDEX IF NOT EXISTS builder_units_availability_idx
  ON public.builder_units(project_id, availability_status);
CREATE INDEX IF NOT EXISTS builder_units_release_idx
  ON public.builder_units(project_id, release_status);

CREATE TABLE IF NOT EXISTS public.builder_unit_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  list_price numeric(14,2) NOT NULL CHECK (list_price >= 0),
  price_basis text NOT NULL DEFAULT 'fixed'
    CHECK (price_basis IN ('fixed','from','indicative','on_application')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  is_current boolean NOT NULL DEFAULT true,
  reason text,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT builder_unit_pricing_window_valid
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX IF NOT EXISTS builder_unit_pricing_unit_idx ON public.builder_unit_pricing(unit_id);
CREATE UNIQUE INDEX IF NOT EXISTS builder_unit_pricing_one_current
  ON public.builder_unit_pricing(unit_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS public.builder_unit_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.builder_organisations(id) ON DELETE CASCADE,
  held_by_builder_user_id uuid REFERENCES public.builder_portal_users(id) ON DELETE SET NULL,
  hold_reference text,
  reason text,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','released','expired','converted')),
  released_at timestamptz,
  released_reason text,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS builder_unit_holds_unit_idx ON public.builder_unit_holds(unit_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS builder_unit_holds_one_active
  ON public.builder_unit_holds(unit_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.builder_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.builder_organisations(id) ON DELETE CASCADE,
  reservation_reference text,
  purchaser_name text NOT NULL CHECK (length(btrim(purchaser_name)) > 0),
  purchaser_email text,
  purchaser_phone text,
  reserved_by_builder_user_id uuid REFERENCES public.builder_portal_users(id) ON DELETE SET NULL,
  reservation_fee numeric(14,2) CHECK (reservation_fee IS NULL OR reservation_fee >= 0),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','contracted','cancelled','expired','lapsed')),
  cancelled_reason text,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT builder_reservations_window_valid
    CHECK (expires_at IS NULL OR expires_at > reserved_at)
);
CREATE INDEX IF NOT EXISTS builder_reservations_unit_idx ON public.builder_reservations(unit_id, status);
CREATE INDEX IF NOT EXISTS builder_reservations_org_idx ON public.builder_reservations(organisation_id);
CREATE UNIQUE INDEX IF NOT EXISTS builder_reservations_one_active
  ON public.builder_reservations(unit_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.builder_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  allocated_to_organisation_id uuid NOT NULL
    REFERENCES public.builder_organisations(id) ON DELETE CASCADE,
  allocation_type text NOT NULL DEFAULT 'sales_channel'
    CHECK (allocation_type IN ('sales_channel','display','staff','investor','other')),
  reference text,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','released','expired')),
  released_at timestamptz,
  released_reason text,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS builder_allocations_unit_idx ON public.builder_allocations(unit_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS builder_allocations_one_active
  ON public.builder_allocations(unit_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.builder_unit_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.builder_units(id) ON DELETE CASCADE,
  status_kind text NOT NULL CHECK (status_kind IN ('availability','release')),
  from_status text,
  to_status text NOT NULL,
  changed_by_type text NOT NULL DEFAULT 'system'
    CHECK (changed_by_type IN ('builder_user','command_user','service_role','system')),
  changed_by_builder_user_id uuid REFERENCES public.builder_portal_users(id) ON DELETE SET NULL,
  changed_by_user_id uuid,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS builder_unit_status_history_unit_idx
  ON public.builder_unit_status_history(unit_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.builder_reservation_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.builder_reservations(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by_type text NOT NULL DEFAULT 'system'
    CHECK (changed_by_type IN ('builder_user','command_user','service_role','system')),
  changed_by_builder_user_id uuid REFERENCES public.builder_portal_users(id) ON DELETE SET NULL,
  changed_by_user_id uuid,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS builder_reservation_status_history_idx
  ON public.builder_reservation_status_history(reservation_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.builder_inventory_history_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='P0001',
    MESSAGE='BUILDER_INVENTORY_HISTORY_APPEND_ONLY',
    DETAIL='inventory status history rows cannot be updated or deleted';
END $$;

DROP TRIGGER IF EXISTS trg_builder_unit_status_history_append_only ON public.builder_unit_status_history;
CREATE TRIGGER trg_builder_unit_status_history_append_only
  BEFORE UPDATE OR DELETE ON public.builder_unit_status_history
  FOR EACH ROW EXECUTE FUNCTION public.builder_inventory_history_append_only();
DROP TRIGGER IF EXISTS trg_builder_reservation_status_history_append_only
  ON public.builder_reservation_status_history;
CREATE TRIGGER trg_builder_reservation_status_history_append_only
  BEFORE UPDATE OR DELETE ON public.builder_reservation_status_history
  FOR EACH ROW EXECUTE FUNCTION public.builder_inventory_history_append_only();

CREATE OR REPLACE FUNCTION public.builder_enforce_unit_parentage()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_parent uuid;
BEGIN
  IF NEW.stage_id IS NOT NULL THEN
    SELECT project_id INTO v_parent FROM public.builder_stages WHERE id = NEW.stage_id;
    IF v_parent IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_PARENT_MISMATCH',
        DETAIL='the stage belongs to a different project';
    END IF;
  END IF;
  IF NEW.building_id IS NOT NULL THEN
    SELECT project_id INTO v_parent FROM public.builder_buildings WHERE id = NEW.building_id;
    IF v_parent IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_PARENT_MISMATCH',
        DETAIL='the building belongs to a different project';
    END IF;
  END IF;
  IF NEW.lot_id IS NOT NULL THEN
    SELECT project_id INTO v_parent FROM public.builder_lots WHERE id = NEW.lot_id;
    IF v_parent IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_PARENT_MISMATCH',
        DETAIL='the lot belongs to a different project';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_builder_enforce_unit_parentage ON public.builder_units;
CREATE TRIGGER trg_builder_enforce_unit_parentage
  BEFORE INSERT OR UPDATE OF project_id, stage_id, building_id, lot_id
  ON public.builder_units FOR EACH ROW
  EXECUTE FUNCTION public.builder_enforce_unit_parentage();

CREATE OR REPLACE FUNCTION public.builder_enforce_stage_parentage()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_parent uuid;
BEGIN
  IF NEW.stage_id IS NULL THEN RETURN NEW; END IF;
  SELECT project_id INTO v_parent FROM public.builder_stages WHERE id = NEW.stage_id;
  IF v_parent IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STAGE_PARENT_MISMATCH',
      DETAIL='the stage belongs to a different project';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_builder_buildings_parentage ON public.builder_buildings;
CREATE TRIGGER trg_builder_buildings_parentage
  BEFORE INSERT OR UPDATE OF project_id, stage_id ON public.builder_buildings
  FOR EACH ROW EXECUTE FUNCTION public.builder_enforce_stage_parentage();
DROP TRIGGER IF EXISTS trg_builder_lots_parentage ON public.builder_lots;
CREATE TRIGGER trg_builder_lots_parentage
  BEFORE INSERT OR UPDATE OF project_id, stage_id ON public.builder_lots
  FOR EACH ROW EXECUTE FUNCTION public.builder_enforce_stage_parentage();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['builder_stages','builder_buildings','builder_lots',
                           'builder_units','builder_unit_pricing','builder_unit_holds',
                           'builder_reservations','builder_allocations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_touch ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_touch BEFORE UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.builder_touch_row()', t, t);
  END LOOP;
END $$;

COMMENT ON TABLE public.builder_stages IS
  'A project subdivides into stages. Reached through the parent project''s access grant.';
COMMENT ON TABLE public.builder_units IS
  'Sellable inventory. Holds the customer-facing position only: no build cost, margin, supplier price or contractor price column exists on this table or any of its children.';
COMMENT ON TABLE public.builder_unit_pricing IS
  'Customer-facing list price history. Deliberately holds NO cost, margin, supplier or contractor price.';