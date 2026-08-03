-- Builder Portal Inventory — Part B: access resolution and guarded commands

CREATE OR REPLACE FUNCTION public.builder_resolve_unit_permission(
  _user_id uuid, _unit_id uuid, _permission_key text, _level text DEFAULT 'view')
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project_id uuid; v_stage_id uuid; v_org uuid;
  v_base boolean; v_membership_id uuid; v_scoped text;
BEGIN
  SELECT project_id, stage_id INTO v_project_id, v_stage_id
  FROM public.builder_units WHERE id = _unit_id;
  IF v_project_id IS NULL THEN RETURN false; END IF;

  v_base := public.builder_resolve_project_permission(
    _user_id, v_project_id, _permission_key, _level);
  IF NOT v_base THEN RETURN false; END IF;

  SELECT a.organisation_id INTO v_org FROM public.builder_project_access a
  WHERE a.builder_user_id = _user_id AND a.project_id = v_project_id
    AND a.revoked_at IS NULL;
  IF v_org IS NULL THEN RETURN false; END IF;

  SELECT membership_id INTO v_membership_id
  FROM public.builder_active_membership(_user_id, v_org);
  IF v_membership_id IS NULL THEN RETURN false; END IF;

  IF v_stage_id IS NOT NULL THEN
    SELECT CASE _level WHEN 'view' THEN view_decision
                      WHEN 'edit' THEN edit_decision ELSE delete_decision END
    INTO v_scoped FROM public.builder_membership_permissions
    WHERE membership_id = v_membership_id AND permission_key = _permission_key
      AND scope_type = 'stage' AND scope_id = v_stage_id;
    IF v_scoped = 'deny' THEN RETURN false; END IF;
  END IF;

  SELECT CASE _level WHEN 'view' THEN view_decision
                    WHEN 'edit' THEN edit_decision ELSE delete_decision END
  INTO v_scoped FROM public.builder_membership_permissions
  WHERE membership_id = v_membership_id AND permission_key = _permission_key
    AND scope_type = 'unit' AND scope_id = _unit_id;
  IF v_scoped = 'deny' THEN RETURN false; END IF;

  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.builder_accessible_units(
  _user_id uuid, _organisation_id uuid DEFAULT NULL, _permission_key text DEFAULT 'inventory')
RETURNS TABLE (unit_id uuid, project_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.project_id
  FROM public.builder_units u
  JOIN public.builder_accessible_projects(_user_id, _organisation_id, _permission_key) p
    ON p.project_id = u.project_id
  WHERE public.builder_resolve_unit_permission(_user_id, u.id, _permission_key, 'view');
$$;

CREATE OR REPLACE FUNCTION public.builder_upsert_stage(
  _actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid,
  _stage_id uuid, _project_id uuid, _payload jsonb DEFAULT '{}'::jsonb,
  _expected_version bigint DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS public.builder_stages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing public.builder_stages; v_row public.builder_stages; v_org uuid;
BEGIN
  IF _stage_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.builder_stages WHERE id = _stage_id FOR UPDATE;
    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STAGE_NOT_FOUND';
    END IF;
    IF _expected_version IS NULL OR v_existing.row_version <> _expected_version THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STALE_WRITE',
        DETAIL = format('current_version=%s', v_existing.row_version);
    END IF;
    UPDATE public.builder_stages SET
      name         = CASE WHEN _payload ? 'name' THEN _payload->>'name' ELSE name END,
      stage_number = CASE WHEN _payload ? 'stage_number' THEN _payload->>'stage_number' ELSE stage_number END,
      description  = CASE WHEN _payload ? 'description' THEN _payload->>'description' ELSE description END,
      status       = CASE WHEN _payload ? 'status' THEN _payload->>'status' ELSE status END,
      estimated_completion_date = CASE WHEN _payload ? 'estimated_completion_date'
        THEN (_payload->>'estimated_completion_date')::date ELSE estimated_completion_date END,
      actual_completion_date = CASE WHEN _payload ? 'actual_completion_date'
        THEN (_payload->>'actual_completion_date')::date ELSE actual_completion_date END
    WHERE id = v_existing.id RETURNING * INTO v_row;
  ELSE
    IF _project_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_PROJECT_REQUIRED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.builder_projects WHERE id = _project_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_PROJECT_NOT_FOUND';
    END IF;
    INSERT INTO public.builder_stages(project_id, name, stage_number, description,
      status, estimated_completion_date)
    VALUES (_project_id, _payload->>'name', _payload->>'stage_number', _payload->>'description',
      COALESCE(_payload->>'status','planned'), (_payload->>'estimated_completion_date')::date)
    RETURNING * INTO v_row;
  END IF;

  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = v_row.project_id;

  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type,
    CASE WHEN _stage_id IS NULL THEN 'builder_stage_created' ELSE 'builder_stage_updated' END,
    'stage', v_row.id, v_org, _actor_builder_user_id,
    CASE WHEN _stage_id IS NULL THEN NULL
         ELSE jsonb_build_object('name', v_existing.name, 'status', v_existing.status) END,
    jsonb_build_object('name', v_row.name, 'status', v_row.status, 'row_version', v_row.row_version),
    _reason, jsonb_build_object('project_id', v_row.project_id));
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.builder_upsert_building(
  _actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid,
  _building_id uuid, _project_id uuid, _stage_id uuid DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb,
  _expected_version bigint DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS public.builder_buildings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing public.builder_buildings; v_row public.builder_buildings; v_org uuid;
BEGIN
  IF _building_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.builder_buildings WHERE id = _building_id FOR UPDATE;
    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_BUILDING_NOT_FOUND';
    END IF;
    IF _expected_version IS NULL OR v_existing.row_version <> _expected_version THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STALE_WRITE',
        DETAIL = format('current_version=%s', v_existing.row_version);
    END IF;
    UPDATE public.builder_buildings SET
      name          = CASE WHEN _payload ? 'name' THEN _payload->>'name' ELSE name END,
      building_code = CASE WHEN _payload ? 'building_code' THEN _payload->>'building_code' ELSE building_code END,
      level_count   = CASE WHEN _payload ? 'level_count' THEN (_payload->>'level_count')::integer ELSE level_count END,
      status        = CASE WHEN _payload ? 'status' THEN _payload->>'status' ELSE status END,
      stage_id      = COALESCE(_stage_id, stage_id)
    WHERE id = v_existing.id RETURNING * INTO v_row;
  ELSE
    IF _project_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_PROJECT_REQUIRED';
    END IF;
    INSERT INTO public.builder_buildings(project_id, stage_id, name, building_code, level_count, status)
    VALUES (_project_id, _stage_id, _payload->>'name', _payload->>'building_code',
            (_payload->>'level_count')::integer, COALESCE(_payload->>'status','planned'))
    RETURNING * INTO v_row;
  END IF;

  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = v_row.project_id;
  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type,
    CASE WHEN _building_id IS NULL THEN 'builder_building_created' ELSE 'builder_building_updated' END,
    'building', v_row.id, v_org, _actor_builder_user_id,
    CASE WHEN _building_id IS NULL THEN NULL ELSE jsonb_build_object('name', v_existing.name) END,
    jsonb_build_object('name', v_row.name, 'row_version', v_row.row_version),
    _reason, jsonb_build_object('project_id', v_row.project_id));
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.builder_upsert_lot(
  _actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid,
  _lot_id uuid, _project_id uuid, _stage_id uuid DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb,
  _expected_version bigint DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS public.builder_lots
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing public.builder_lots; v_row public.builder_lots; v_org uuid;
BEGIN
  IF _lot_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.builder_lots WHERE id = _lot_id FOR UPDATE;
    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_LOT_NOT_FOUND';
    END IF;
    IF _expected_version IS NULL OR v_existing.row_version <> _expected_version THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STALE_WRITE',
        DETAIL = format('current_version=%s', v_existing.row_version);
    END IF;
    UPDATE public.builder_lots SET
      lot_number    = CASE WHEN _payload ? 'lot_number' THEN _payload->>'lot_number' ELSE lot_number END,
      plan_number   = CASE WHEN _payload ? 'plan_number' THEN _payload->>'plan_number' ELSE plan_number END,
      land_area_sqm = CASE WHEN _payload ? 'land_area_sqm' THEN (_payload->>'land_area_sqm')::numeric ELSE land_area_sqm END,
      frontage_m    = CASE WHEN _payload ? 'frontage_m' THEN (_payload->>'frontage_m')::numeric ELSE frontage_m END,
      titled        = CASE WHEN _payload ? 'titled' THEN (_payload->>'titled')::boolean ELSE titled END,
      titled_at     = CASE WHEN _payload ? 'titled_at' THEN (_payload->>'titled_at')::date ELSE titled_at END,
      status        = CASE WHEN _payload ? 'status' THEN _payload->>'status' ELSE status END,
      stage_id      = COALESCE(_stage_id, stage_id)
    WHERE id = v_existing.id RETURNING * INTO v_row;
  ELSE
    IF _project_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_PROJECT_REQUIRED';
    END IF;
    INSERT INTO public.builder_lots(project_id, stage_id, lot_number, plan_number,
      land_area_sqm, frontage_m, titled, status)
    VALUES (_project_id, _stage_id, _payload->>'lot_number', _payload->>'plan_number',
      (_payload->>'land_area_sqm')::numeric, (_payload->>'frontage_m')::numeric,
      COALESCE((_payload->>'titled')::boolean, false), COALESCE(_payload->>'status','planned'))
    RETURNING * INTO v_row;
  END IF;

  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = v_row.project_id;
  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type,
    CASE WHEN _lot_id IS NULL THEN 'builder_lot_created' ELSE 'builder_lot_updated' END,
    'lot', v_row.id, v_org, _actor_builder_user_id,
    CASE WHEN _lot_id IS NULL THEN NULL ELSE jsonb_build_object('lot_number', v_existing.lot_number) END,
    jsonb_build_object('lot_number', v_row.lot_number, 'row_version', v_row.row_version),
    _reason, jsonb_build_object('project_id', v_row.project_id));
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.builder_upsert_unit(
  _actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid,
  _unit_id uuid, _project_id uuid,
  _stage_id uuid DEFAULT NULL, _building_id uuid DEFAULT NULL, _lot_id uuid DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb,
  _expected_version bigint DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS public.builder_units
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing public.builder_units; v_row public.builder_units; v_org uuid;
BEGIN
  IF _unit_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.builder_units WHERE id = _unit_id FOR UPDATE;
    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_NOT_FOUND';
    END IF;
    IF _expected_version IS NULL OR v_existing.row_version <> _expected_version THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STALE_WRITE',
        DETAIL = format('current_version=%s', v_existing.row_version);
    END IF;
    UPDATE public.builder_units SET
      unit_number       = CASE WHEN _payload ? 'unit_number' THEN _payload->>'unit_number' ELSE unit_number END,
      unit_type         = CASE WHEN _payload ? 'unit_type' THEN _payload->>'unit_type' ELSE unit_type END,
      bedrooms          = CASE WHEN _payload ? 'bedrooms' THEN (_payload->>'bedrooms')::smallint ELSE bedrooms END,
      bathrooms         = CASE WHEN _payload ? 'bathrooms' THEN (_payload->>'bathrooms')::numeric ELSE bathrooms END,
      car_spaces        = CASE WHEN _payload ? 'car_spaces' THEN (_payload->>'car_spaces')::smallint ELSE car_spaces END,
      internal_area_sqm = CASE WHEN _payload ? 'internal_area_sqm' THEN (_payload->>'internal_area_sqm')::numeric ELSE internal_area_sqm END,
      external_area_sqm = CASE WHEN _payload ? 'external_area_sqm' THEN (_payload->>'external_area_sqm')::numeric ELSE external_area_sqm END,
      level_number      = CASE WHEN _payload ? 'level_number' THEN (_payload->>'level_number')::smallint ELSE level_number END,
      aspect            = CASE WHEN _payload ? 'aspect' THEN _payload->>'aspect' ELSE aspect END,
      estimated_completion_date = CASE WHEN _payload ? 'estimated_completion_date'
        THEN (_payload->>'estimated_completion_date')::date ELSE estimated_completion_date END,
      description       = CASE WHEN _payload ? 'description' THEN _payload->>'description' ELSE description END,
      stage_id          = COALESCE(_stage_id, stage_id),
      building_id       = COALESCE(_building_id, building_id),
      lot_id            = COALESCE(_lot_id, lot_id)
    WHERE id = v_existing.id RETURNING * INTO v_row;
  ELSE
    IF _project_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_PROJECT_REQUIRED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.builder_projects WHERE id = _project_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_PROJECT_NOT_FOUND';
    END IF;
    INSERT INTO public.builder_units(project_id, stage_id, building_id, lot_id,
      unit_number, unit_type, bedrooms, bathrooms, car_spaces,
      internal_area_sqm, external_area_sqm, level_number, aspect,
      estimated_completion_date, description)
    VALUES (_project_id, _stage_id, _building_id, _lot_id,
      _payload->>'unit_number', COALESCE(_payload->>'unit_type','house'),
      (_payload->>'bedrooms')::smallint, (_payload->>'bathrooms')::numeric,
      (_payload->>'car_spaces')::smallint, (_payload->>'internal_area_sqm')::numeric,
      (_payload->>'external_area_sqm')::numeric, (_payload->>'level_number')::smallint,
      _payload->>'aspect', (_payload->>'estimated_completion_date')::date,
      _payload->>'description')
    RETURNING * INTO v_row;
  END IF;

  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = v_row.project_id;
  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type,
    CASE WHEN _unit_id IS NULL THEN 'builder_unit_created' ELSE 'builder_unit_updated' END,
    'unit', v_row.id, v_org, _actor_builder_user_id,
    CASE WHEN _unit_id IS NULL THEN NULL
         ELSE jsonb_build_object('unit_number', v_existing.unit_number) END,
    jsonb_build_object('unit_number', v_row.unit_number, 'row_version', v_row.row_version),
    _reason, jsonb_build_object('project_id', v_row.project_id));
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.builder_is_unit_availability_transition_allowed(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _from = _to THEN false
    WHEN _from = 'settled' THEN false
    WHEN _to = 'withdrawn' THEN _from IN ('available','on_hold','reserved')
    WHEN _from = 'withdrawn' THEN _to = 'available'
    WHEN _from = 'available' THEN _to IN ('on_hold','reserved')
    WHEN _from = 'on_hold' THEN _to IN ('available','reserved')
    WHEN _from = 'reserved' THEN _to IN ('available','contracted')
    WHEN _from = 'contracted' THEN _to IN ('settled','available')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.builder_transition_unit_availability(
  _unit_id uuid, _expected_version bigint, _from text, _to text, _reason text,
  _actor_type text, _actor_builder_user_id uuid DEFAULT NULL,
  _actor_staff_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.builder_units; v_history_id uuid; v_org uuid;
BEGIN
  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='REASON_REQUIRED';
  END IF;
  SELECT * INTO u FROM public.builder_units WHERE id = _unit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_NOT_FOUND'; END IF;
  IF u.row_version <> _expected_version THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='STALE_VERSION'; END IF;
  IF u.availability_status <> _from THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='STALE_STATUS'; END IF;
  IF NOT public.builder_is_unit_availability_transition_allowed(_from, _to) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INVALID_TRANSITION'; END IF;

  UPDATE public.builder_units SET availability_status = _to
  WHERE id = _unit_id RETURNING * INTO u;

  INSERT INTO public.builder_unit_status_history(unit_id, status_kind, from_status, to_status,
    changed_by_type, changed_by_builder_user_id, changed_by_user_id, reason, metadata)
  VALUES (_unit_id, 'availability', _from, _to, _actor_type,
    _actor_builder_user_id, _actor_staff_user_id, left(btrim(_reason),1000),
    jsonb_build_object('row_version', u.row_version))
  RETURNING id INTO v_history_id;

  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = u.project_id;
  PERFORM public.builder_log_activity(
    _actor_staff_user_id, _actor_type, 'builder_unit_availability_changed',
    'unit', u.id, v_org, _actor_builder_user_id,
    jsonb_build_object('availability_status', _from),
    jsonb_build_object('availability_status', _to, 'row_version', u.row_version),
    left(btrim(_reason),1000), jsonb_build_object('history_id', v_history_id));
  RETURN to_jsonb(u);
END $$;

CREATE OR REPLACE FUNCTION public.builder_transition_unit_release(
  _unit_id uuid, _expected_version bigint, _from text, _to text, _reason text,
  _actor_type text, _actor_builder_user_id uuid DEFAULT NULL,
  _actor_staff_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.builder_units; v_history_id uuid; v_org uuid;
BEGIN
  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='REASON_REQUIRED';
  END IF;
  IF _to NOT IN ('unreleased','coming_soon','released','sold_out') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INVALID_TRANSITION'; END IF;
  IF _from = _to THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INVALID_TRANSITION'; END IF;

  SELECT * INTO u FROM public.builder_units WHERE id = _unit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_NOT_FOUND'; END IF;
  IF u.row_version <> _expected_version THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='STALE_VERSION'; END IF;
  IF u.release_status <> _from THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='STALE_STATUS'; END IF;

  IF _to = 'released' AND NOT EXISTS (
    SELECT 1 FROM public.builder_unit_pricing WHERE unit_id = _unit_id AND is_current) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_PRICE_REQUIRED',
      DETAIL='a unit cannot be released without a current price';
  END IF;

  UPDATE public.builder_units SET release_status = _to,
    released_at = CASE WHEN _to = 'released' THEN COALESCE(released_at, now()) ELSE released_at END
  WHERE id = _unit_id RETURNING * INTO u;

  INSERT INTO public.builder_unit_status_history(unit_id, status_kind, from_status, to_status,
    changed_by_type, changed_by_builder_user_id, changed_by_user_id, reason, metadata)
  VALUES (_unit_id, 'release', _from, _to, _actor_type,
    _actor_builder_user_id, _actor_staff_user_id, left(btrim(_reason),1000),
    jsonb_build_object('row_version', u.row_version))
  RETURNING id INTO v_history_id;

  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = u.project_id;
  PERFORM public.builder_log_activity(
    _actor_staff_user_id, _actor_type, 'builder_unit_release_changed',
    'unit', u.id, v_org, _actor_builder_user_id,
    jsonb_build_object('release_status', _from),
    jsonb_build_object('release_status', _to, 'row_version', u.row_version),
    left(btrim(_reason),1000), jsonb_build_object('history_id', v_history_id));
  RETURN to_jsonb(u);
END $$;

CREATE OR REPLACE FUNCTION public.builder_set_unit_price(
  _actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid,
  _unit_id uuid, _list_price numeric, _price_basis text DEFAULT 'fixed',
  _reason text DEFAULT NULL)
RETURNS public.builder_unit_pricing
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_previous public.builder_unit_pricing; v_row public.builder_unit_pricing; v_org uuid; v_project uuid;
BEGIN
  SELECT project_id INTO v_project FROM public.builder_units WHERE id = _unit_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_NOT_FOUND';
  END IF;
  IF _list_price IS NULL OR _list_price < 0 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_INVALID_PRICE';
  END IF;
  IF _price_basis NOT IN ('fixed','from','indicative','on_application') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_INVALID_PRICE_BASIS';
  END IF;

  SELECT * INTO v_previous FROM public.builder_unit_pricing
  WHERE unit_id = _unit_id AND is_current FOR UPDATE;
  IF v_previous.id IS NOT NULL THEN
    UPDATE public.builder_unit_pricing
    SET is_current = false, effective_to = now()
    WHERE id = v_previous.id;
  END IF;

  INSERT INTO public.builder_unit_pricing(unit_id, list_price, price_basis, reason)
  VALUES (_unit_id, _list_price, _price_basis, _reason)
  RETURNING * INTO v_row;

  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = v_project;
  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type, 'builder_unit_price_set',
    'unit_price', v_row.id, v_org, _actor_builder_user_id,
    CASE WHEN v_previous.id IS NULL THEN NULL
         ELSE jsonb_build_object('list_price', v_previous.list_price) END,
    jsonb_build_object('list_price', v_row.list_price, 'price_basis', v_row.price_basis),
    _reason, jsonb_build_object('unit_id', _unit_id));
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.builder_create_unit_hold(
  _actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid,
  _unit_id uuid, _organisation_id uuid, _expires_at timestamptz,
  _hold_reference text DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS public.builder_unit_holds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.builder_unit_holds; u public.builder_units; v_org uuid;
BEGIN
  SELECT * INTO u FROM public.builder_units WHERE id = _unit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_NOT_FOUND'; END IF;
  IF _expires_at IS NULL OR _expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_HOLD_EXPIRY_INVALID';
  END IF;
  IF u.availability_status <> 'available' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_NOT_AVAILABLE',
      DETAIL=format('unit is %s', u.availability_status);
  END IF;

  INSERT INTO public.builder_unit_holds(unit_id, organisation_id, held_by_builder_user_id,
    hold_reference, reason, expires_at)
  VALUES (_unit_id, _organisation_id, _actor_builder_user_id, _hold_reference, _reason, _expires_at)
  RETURNING * INTO v_row;

  PERFORM public.builder_transition_unit_availability(
    _unit_id, u.row_version, 'available', 'on_hold',
    COALESCE(_reason, 'Unit placed on hold'), _actor_type, _actor_builder_user_id, _actor_user_id);

  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = u.project_id;
  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type, 'builder_unit_hold_created',
    'unit_hold', v_row.id, v_org, _actor_builder_user_id,
    NULL, jsonb_build_object('expires_at', v_row.expires_at),
    _reason, jsonb_build_object('unit_id', _unit_id));
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.builder_release_unit_hold(
  _actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid,
  _hold_id uuid, _expected_version bigint, _reason text DEFAULT NULL)
RETURNS public.builder_unit_holds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing public.builder_unit_holds; v_row public.builder_unit_holds;
        u public.builder_units; v_org uuid;
BEGIN
  SELECT * INTO v_existing FROM public.builder_unit_holds WHERE id = _hold_id FOR UPDATE;
  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_HOLD_NOT_FOUND'; END IF;
  IF v_existing.status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_HOLD_NOT_ACTIVE'; END IF;
  IF _expected_version IS NULL OR v_existing.row_version <> _expected_version THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STALE_WRITE',
      DETAIL = format('current_version=%s', v_existing.row_version); END IF;

  UPDATE public.builder_unit_holds
  SET status='released', released_at=now(), released_reason=_reason
  WHERE id = v_existing.id RETURNING * INTO v_row;

  SELECT * INTO u FROM public.builder_units WHERE id = v_row.unit_id FOR UPDATE;
  IF u.availability_status = 'on_hold' THEN
    PERFORM public.builder_transition_unit_availability(
      u.id, u.row_version, 'on_hold', 'available',
      COALESCE(_reason, 'Hold released'), _actor_type, _actor_builder_user_id, _actor_user_id);
  END IF;

  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = u.project_id;
  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type, 'builder_unit_hold_released',
    'unit_hold', v_row.id, v_org, _actor_builder_user_id,
    jsonb_build_object('status', v_existing.status),
    jsonb_build_object('status', v_row.status),
    _reason, jsonb_build_object('unit_id', v_row.unit_id));
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.builder_create_reservation(
  _actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid,
  _unit_id uuid, _organisation_id uuid, _payload jsonb,
  _reason text DEFAULT NULL)
RETURNS public.builder_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.builder_reservations; u public.builder_units; v_org uuid; v_expires timestamptz;
BEGIN
  SELECT * INTO u FROM public.builder_units WHERE id = _unit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_NOT_FOUND'; END IF;
  IF NULLIF(btrim(COALESCE(_payload->>'purchaser_name','')), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_PURCHASER_REQUIRED'; END IF;
  IF u.availability_status NOT IN ('available','on_hold') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_NOT_RESERVABLE',
      DETAIL=format('unit is %s', u.availability_status); END IF;

  v_expires := (_payload->>'expires_at')::timestamptz;
  IF v_expires IS NOT NULL AND v_expires <= now() THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_RESERVATION_EXPIRY_INVALID'; END IF;

  INSERT INTO public.builder_reservations(unit_id, organisation_id, reservation_reference,
    purchaser_name, purchaser_email, purchaser_phone, reserved_by_builder_user_id,
    reservation_fee, expires_at)
  VALUES (_unit_id, _organisation_id, _payload->>'reservation_reference',
    _payload->>'purchaser_name', _payload->>'purchaser_email', _payload->>'purchaser_phone',
    _actor_builder_user_id, (_payload->>'reservation_fee')::numeric, v_expires)
  RETURNING * INTO v_row;

  INSERT INTO public.builder_reservation_status_history(reservation_id, from_status, to_status,
    changed_by_type, changed_by_builder_user_id, changed_by_user_id, reason)
  VALUES (v_row.id, NULL, 'active', _actor_type, _actor_builder_user_id, _actor_user_id,
    COALESCE(_reason, 'Reservation created'));

  PERFORM public.builder_transition_unit_availability(
    _unit_id, u.row_version, u.availability_status, 'reserved',
    COALESCE(_reason, 'Unit reserved'), _actor_type, _actor_builder_user_id, _actor_user_id);

  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = u.project_id;
  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type, 'builder_reservation_created',
    'reservation', v_row.id, v_org, _actor_builder_user_id,
    NULL, jsonb_build_object('purchaser_name', v_row.purchaser_name, 'status', v_row.status),
    _reason, jsonb_build_object('unit_id', _unit_id));
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.builder_is_reservation_transition_allowed(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _from = _to THEN false
    WHEN _from <> 'active' THEN false
    WHEN _to IN ('contracted','cancelled','expired','lapsed') THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.builder_transition_reservation(
  _reservation_id uuid, _expected_version bigint, _from text, _to text, _reason text,
  _actor_type text, _actor_builder_user_id uuid DEFAULT NULL,
  _actor_staff_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.builder_reservations; u public.builder_units; v_org uuid; v_history_id uuid;
BEGIN
  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='REASON_REQUIRED'; END IF;
  SELECT * INTO r FROM public.builder_reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_RESERVATION_NOT_FOUND'; END IF;
  IF r.row_version <> _expected_version THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='STALE_VERSION'; END IF;
  IF r.status <> _from THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='STALE_STATUS'; END IF;
  IF NOT public.builder_is_reservation_transition_allowed(_from, _to) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INVALID_TRANSITION'; END IF;

  UPDATE public.builder_reservations
  SET status = _to,
      cancelled_reason = CASE WHEN _to IN ('cancelled','lapsed','expired')
        THEN left(btrim(_reason),1000) ELSE cancelled_reason END
  WHERE id = _reservation_id RETURNING * INTO r;

  INSERT INTO public.builder_reservation_status_history(reservation_id, from_status, to_status,
    changed_by_type, changed_by_builder_user_id, changed_by_user_id, reason, metadata)
  VALUES (_reservation_id, _from, _to, _actor_type, _actor_builder_user_id,
    _actor_staff_user_id, left(btrim(_reason),1000),
    jsonb_build_object('row_version', r.row_version))
  RETURNING id INTO v_history_id;

  SELECT * INTO u FROM public.builder_units WHERE id = r.unit_id FOR UPDATE;
  IF _to = 'contracted' AND u.availability_status = 'reserved' THEN
    PERFORM public.builder_transition_unit_availability(u.id, u.row_version, 'reserved',
      'contracted', left(btrim(_reason),1000), _actor_type, _actor_builder_user_id, _actor_staff_user_id);
  ELSIF _to IN ('cancelled','expired','lapsed') AND u.availability_status = 'reserved' THEN
    PERFORM public.builder_transition_unit_availability(u.id, u.row_version, 'reserved',
      'available', left(btrim(_reason),1000), _actor_type, _actor_builder_user_id, _actor_staff_user_id);
  END IF;

  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = u.project_id;
  PERFORM public.builder_log_activity(
    _actor_staff_user_id, _actor_type, 'builder_reservation_status_changed',
    'reservation', r.id, v_org, _actor_builder_user_id,
    jsonb_build_object('status', _from), jsonb_build_object('status', _to),
    left(btrim(_reason),1000), jsonb_build_object('history_id', v_history_id));
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.builder_create_allocation(
  _actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid,
  _unit_id uuid, _allocated_to_organisation_id uuid,
  _allocation_type text DEFAULT 'sales_channel',
  _expires_at timestamptz DEFAULT NULL, _reference text DEFAULT NULL,
  _reason text DEFAULT NULL)
RETURNS public.builder_allocations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.builder_allocations; v_project uuid; v_org uuid;
BEGIN
  SELECT project_id INTO v_project FROM public.builder_units WHERE id = _unit_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_UNIT_NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.builder_organisations
                 WHERE id = _allocated_to_organisation_id AND status <> 'closed') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_ORG_NOT_FOUND'; END IF;
  IF _allocation_type NOT IN ('sales_channel','display','staff','investor','other') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_INVALID_ALLOCATION_TYPE'; END IF;
  IF _expires_at IS NOT NULL AND _expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_ALLOCATION_EXPIRY_INVALID'; END IF;

  INSERT INTO public.builder_allocations(unit_id, allocated_to_organisation_id,
    allocation_type, reference, expires_at)
  VALUES (_unit_id, _allocated_to_organisation_id, _allocation_type, _reference, _expires_at)
  RETURNING * INTO v_row;

  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = v_project;
  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type, 'builder_allocation_created',
    'allocation', v_row.id, v_org, _actor_builder_user_id,
    NULL, jsonb_build_object('allocated_to', v_row.allocated_to_organisation_id,
                             'allocation_type', v_row.allocation_type),
    _reason, jsonb_build_object('unit_id', _unit_id));
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.builder_release_allocation(
  _actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid,
  _allocation_id uuid, _expected_version bigint, _reason text DEFAULT NULL)
RETURNS public.builder_allocations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing public.builder_allocations; v_row public.builder_allocations;
        v_project uuid; v_org uuid;
BEGIN
  SELECT * INTO v_existing FROM public.builder_allocations WHERE id = _allocation_id FOR UPDATE;
  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_ALLOCATION_NOT_FOUND'; END IF;
  IF v_existing.status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_ALLOCATION_NOT_ACTIVE'; END IF;
  IF _expected_version IS NULL OR v_existing.row_version <> _expected_version THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STALE_WRITE',
      DETAIL = format('current_version=%s', v_existing.row_version); END IF;

  UPDATE public.builder_allocations
  SET status='released', released_at=now(), released_reason=_reason
  WHERE id = v_existing.id RETURNING * INTO v_row;

  SELECT project_id INTO v_project FROM public.builder_units WHERE id = v_row.unit_id;
  SELECT COALESCE(developer_organisation_id, builder_organisation_id) INTO v_org
  FROM public.builder_projects WHERE id = v_project;
  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type, 'builder_allocation_released',
    'allocation', v_row.id, v_org, _actor_builder_user_id,
    jsonb_build_object('status', v_existing.status), jsonb_build_object('status', v_row.status),
    _reason, jsonb_build_object('unit_id', v_row.unit_id));
  RETURN v_row;
END $$;