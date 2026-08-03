CREATE OR REPLACE FUNCTION public.builder_admin_delete_user(
  _actor_user_id uuid,
  _actor_type text,
  _builder_user_id uuid,
  _expected_version bigint,
  _reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user public.builder_portal_users;
  v_blockers text[] := ARRAY[]::text[];
  v_reason text := NULLIF(btrim(_reason), '');
  v_count bigint;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_user FROM public.builder_portal_users
  WHERE id = _builder_user_id
  FOR UPDATE;

  IF v_user.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_USER_NOT_FOUND';
  END IF;

  IF _expected_version IS NULL OR v_user.row_version <> _expected_version THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STALE_WRITE',
      DETAIL = format('current_version=%s', v_user.row_version);
  END IF;

  SELECT count(*) INTO v_count FROM public.builder_organisation_memberships
    WHERE builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('organisation memberships (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_project_access
    WHERE builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('project access grants (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_portal_sessions
    WHERE builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('portal sessions (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_document_grants
    WHERE builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('document grants (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_document_versions
    WHERE uploaded_by_builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('uploaded documents (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_messages
    WHERE author_builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('messages (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_conversation_participants
    WHERE builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('conversations (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_notifications
    WHERE builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('notifications (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_reservations
    WHERE reserved_by_builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('reservations (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_unit_holds
    WHERE held_by_builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('unit holds (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_tasks
    WHERE created_by_builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('tasks (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_task_assignments
    WHERE builder_user_id = _builder_user_id
       OR assigned_by_builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('task assignments (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_construction_progress_updates
    WHERE created_by_builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('construction progress updates (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_construction_photographs
    WHERE uploaded_by_builder_user_id = _builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('construction photographs (%s)', v_count)); END IF;

  SELECT (
      (SELECT count(*) FROM public.builder_construction_status_history WHERE changed_by_builder_user_id = _builder_user_id)
    + (SELECT count(*) FROM public.builder_construction_date_history   WHERE changed_by_builder_user_id = _builder_user_id)
    + (SELECT count(*) FROM public.builder_delivery_status_history     WHERE changed_by_builder_user_id = _builder_user_id)
    + (SELECT count(*) FROM public.builder_project_status_history      WHERE changed_by_builder_user_id = _builder_user_id)
    + (SELECT count(*) FROM public.builder_reservation_status_history  WHERE changed_by_builder_user_id = _builder_user_id)
    + (SELECT count(*) FROM public.builder_transaction_status_history  WHERE changed_by_builder_user_id = _builder_user_id)
    + (SELECT count(*) FROM public.builder_unit_status_history         WHERE changed_by_builder_user_id = _builder_user_id)
  ) INTO v_count;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('status history entries (%s)', v_count)); END IF;

  IF array_length(v_blockers, 1) > 0 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_HAS_DEPENDENTS',
      DETAIL = format('dependents=%s', array_to_string(v_blockers, ', '));
  END IF;

  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type, 'builder_user_removed',
    'user', v_user.id, NULL, NULL,
    jsonb_build_object(
      'id', v_user.id, 'email', v_user.email, 'name', v_user.name,
      'status', v_user.status, 'job_title', v_user.job_title,
      'invited_at', v_user.invited_at, 'invite_accepted_at', v_user.invite_accepted_at),
    NULL, v_reason,
    jsonb_build_object('removal', 'permanent', 'dependents_checked', true));

  DELETE FROM public.builder_onboarding_steps WHERE builder_user_id = _builder_user_id;
  DELETE FROM public.builder_user_preferences WHERE builder_user_id = _builder_user_id;

  DELETE FROM public.builder_portal_users WHERE id = _builder_user_id;

  RETURN jsonb_build_object('removed', true, 'builder_user_id', _builder_user_id);
END $$;

COMMENT ON FUNCTION public.builder_admin_delete_user IS
  'Permanently removes a Builder portal user that has no protected dependants. Refuses with BUILDER_HAS_DEPENDENTS otherwise; revoke access instead. Audit is written before the delete because the activity-log link is ON DELETE SET NULL.';

REVOKE ALL ON FUNCTION public.builder_admin_delete_user(uuid, text, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_admin_delete_user(uuid, text, uuid, bigint, text) TO service_role;