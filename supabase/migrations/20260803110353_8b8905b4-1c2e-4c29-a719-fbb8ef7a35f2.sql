CREATE OR REPLACE FUNCTION public.builder_admin_delete_organisation(
  _actor_user_id uuid,
  _actor_type text,
  _organisation_id uuid,
  _expected_version bigint,
  _reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org public.builder_organisations;
  v_blockers text[] := ARRAY[]::text[];
  v_reason text := NULLIF(btrim(_reason), '');
  v_count bigint;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_org FROM public.builder_organisations
  WHERE id = _organisation_id
  FOR UPDATE;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_ORG_NOT_FOUND';
  END IF;

  IF _expected_version IS NULL OR v_org.row_version <> _expected_version THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STALE_WRITE',
      DETAIL = format('current_version=%s', v_org.row_version);
  END IF;

  SELECT count(*) INTO v_count FROM public.builder_organisation_memberships
    WHERE organisation_id = _organisation_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('memberships (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_projects
    WHERE builder_organisation_id = _organisation_id
       OR developer_organisation_id = _organisation_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('projects (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_project_access
    WHERE organisation_id = _organisation_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('project access grants (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_reservations
    WHERE organisation_id = _organisation_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('reservations (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_transactions
    WHERE organisation_id = _organisation_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('transactions (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_tasks
    WHERE organisation_id = _organisation_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('tasks (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_unit_holds
    WHERE organisation_id = _organisation_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('unit holds (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_documents
    WHERE organisation_id = _organisation_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('documents (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_conversations
    WHERE organisation_id = _organisation_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('conversations (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_notifications
    WHERE organisation_id = _organisation_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('notifications (%s)', v_count)); END IF;

  IF array_length(v_blockers, 1) > 0 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_HAS_DEPENDENTS',
      DETAIL = format('dependents=%s', array_to_string(v_blockers, ', '));
  END IF;

  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type, 'builder_organisation_removed',
    'organisation', v_org.id, NULL, NULL,
    jsonb_build_object(
      'id', v_org.id, 'legal_name', v_org.legal_name,
      'trading_name', v_org.trading_name, 'org_type', v_org.org_type,
      'abn', v_org.abn, 'status', v_org.status),
    NULL, v_reason,
    jsonb_build_object('removal', 'permanent', 'dependents_checked', true));

  DELETE FROM public.builder_organisation_settings WHERE organisation_id = _organisation_id;
  DELETE FROM public.builder_organisations WHERE id = _organisation_id;

  RETURN jsonb_build_object('removed', true, 'organisation_id', _organisation_id);
END $$;

COMMENT ON FUNCTION public.builder_admin_delete_organisation IS
  'Permanently removes a Builder organisation that has no protected dependants. Refuses with BUILDER_HAS_DEPENDENTS otherwise; close or suspend the organisation instead.';

REVOKE ALL ON FUNCTION public.builder_admin_delete_organisation(uuid, text, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_admin_delete_organisation(uuid, text, uuid, bigint, text) TO service_role;