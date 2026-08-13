-- Builder Portal Inventory — Part C: role defaults, RLS, grants, assertions

INSERT INTO public.builder_role_default_permissions(
  membership_role, permission_key, can_view, can_edit, can_delete) VALUES
  ('owner',         'inventory',    true,  true,  true),
  ('administrator', 'inventory',    true,  true,  true),
  ('manager',       'inventory',    true,  true,  false),
  ('member',        'inventory',    true,  false, false),
  ('read_only',     'inventory',    true,  false, false),
  ('owner',         'pricing',      true,  true,  false),
  ('administrator', 'pricing',      true,  true,  false),
  ('manager',       'pricing',      true,  true,  false),
  ('member',        'pricing',      true,  false, false),
  ('read_only',     'pricing',      true,  false, false),
  ('owner',         'reservations', true,  true,  true),
  ('administrator', 'reservations', true,  true,  true),
  ('manager',       'reservations', true,  true,  false),
  ('member',        'reservations', true,  true,  false),
  ('read_only',     'reservations', true,  false, false)
ON CONFLICT (membership_role, permission_key) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['builder_stages','builder_buildings','builder_lots','builder_units',
                           'builder_unit_pricing','builder_unit_holds','builder_reservations',
                           'builder_allocations','builder_unit_status_history',
                           'builder_reservation_status_history'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY %I_service ON public.%I
      AS PERMISSIVE FOR ALL TO service_role
      USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role')$p$, t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

DO $$
DECLARE f text; a text;
BEGIN
  FOR f, a IN SELECT * FROM (VALUES
    ('builder_resolve_unit_permission','uuid, uuid, text, text'),
    ('builder_accessible_units','uuid, uuid, text'),
    ('builder_upsert_stage','uuid, text, uuid, uuid, uuid, jsonb, bigint, text'),
    ('builder_upsert_building','uuid, text, uuid, uuid, uuid, uuid, jsonb, bigint, text'),
    ('builder_upsert_lot','uuid, text, uuid, uuid, uuid, uuid, jsonb, bigint, text'),
    ('builder_upsert_unit','uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, bigint, text'),
    ('builder_is_unit_availability_transition_allowed','text, text'),
    ('builder_transition_unit_availability','uuid, bigint, text, text, text, text, uuid, uuid'),
    ('builder_transition_unit_release','uuid, bigint, text, text, text, text, uuid, uuid'),
    ('builder_set_unit_price','uuid, text, uuid, uuid, numeric, text, text'),
    ('builder_create_unit_hold','uuid, text, uuid, uuid, uuid, timestamptz, text, text'),
    ('builder_release_unit_hold','uuid, text, uuid, uuid, bigint, text'),
    ('builder_create_reservation','uuid, text, uuid, uuid, uuid, jsonb, text'),
    ('builder_is_reservation_transition_allowed','text, text'),
    ('builder_transition_reservation','uuid, bigint, text, text, text, text, uuid, uuid'),
    ('builder_create_allocation','uuid, text, uuid, uuid, uuid, text, timestamptz, text, text'),
    ('builder_release_allocation','uuid, text, uuid, uuid, bigint, text')
  ) AS t(f, a) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', f, a);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', f, a);
  END LOOP;
END $$;

DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(f, ', ') INTO v_missing
  FROM unnest(ARRAY[
    'builder_resolve_unit_permission','builder_accessible_units',
    'builder_upsert_stage','builder_upsert_building','builder_upsert_lot','builder_upsert_unit',
    'builder_transition_unit_availability','builder_transition_unit_release',
    'builder_set_unit_price','builder_create_unit_hold','builder_release_unit_hold',
    'builder_create_reservation','builder_transition_reservation',
    'builder_create_allocation','builder_release_allocation',
    'builder_enforce_unit_parentage','builder_enforce_stage_parentage']) AS f
  WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname='public' AND p.proname = f);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: inventory function(s) missing: %', v_missing;
  END IF;

  SELECT string_agg(c.relname, ', ') INTO v_missing
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public'
    AND c.relname IN ('builder_stages','builder_buildings','builder_lots','builder_units',
                      'builder_unit_pricing','builder_unit_holds','builder_reservations',
                      'builder_allocations','builder_unit_status_history',
                      'builder_reservation_status_history')
    AND NOT c.relrowsecurity;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: RLS not enabled on: %', v_missing;
  END IF;

  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY['builder_stages','builder_buildings','builder_lots','builder_units',
                    'builder_unit_pricing','builder_unit_holds','builder_reservations',
                    'builder_allocations']) AS t
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=t AND column_name='row_version');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: touch-triggered table(s) without row_version: %', v_missing;
  END IF;

  SELECT string_agg(k, ', ') INTO v_missing
  FROM unnest(ARRAY['inventory','pricing','reservations']) AS k
  WHERE NOT EXISTS (SELECT 1 FROM public.builder_role_default_permissions
                    WHERE permission_key = k AND membership_role='manager' AND can_view);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: permission key(s) without a role baseline: %', v_missing;
  END IF;

  SELECT string_agg(table_name||'.'||column_name, ', ') INTO v_missing
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name LIKE 'builder_%'
    AND (column_name LIKE '%cost%' OR column_name LIKE '%margin%'
         OR column_name LIKE '%supplier%' OR column_name LIKE '%contractor_price%');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: internal commercial column(s) present: %', v_missing;
  END IF;

  RAISE NOTICE 'builder inventory: stages, buildings, lots, units, pricing, holds, reservations and allocations installed';
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