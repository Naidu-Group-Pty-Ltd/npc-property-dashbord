CREATE OR REPLACE FUNCTION public.builder_admin_upsert_membership(
  _actor_user_id uuid,
  _actor_type text,
  _builder_user_id uuid,
  _organisation_id uuid,
  _membership_role text,
  _is_primary boolean,
  _expected_version bigint DEFAULT NULL,
  _reason text DEFAULT NULL)
RETURNS public.builder_organisation_memberships
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing public.builder_organisation_memberships;
  v_row public.builder_organisation_memberships;
  v_org_status text;
  v_user_status text;
BEGIN
  SELECT status INTO v_org_status FROM public.builder_organisations WHERE id = _organisation_id;
  IF v_org_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_ORG_NOT_FOUND';
  END IF;
  IF v_org_status = 'closed' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_ORG_CLOSED';
  END IF;

  SELECT status INTO v_user_status FROM public.builder_portal_users WHERE id = _builder_user_id;
  IF v_user_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_USER_NOT_FOUND';
  END IF;
  IF v_user_status = 'revoked' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_USER_REVOKED';
  END IF;

  SELECT * INTO v_existing FROM public.builder_organisation_memberships
  WHERE builder_user_id = _builder_user_id AND organisation_id = _organisation_id
    AND revoked_at IS NULL
  FOR UPDATE;

  IF COALESCE(_is_primary, false) THEN
    UPDATE public.builder_organisation_memberships
    SET is_primary = false
    WHERE builder_user_id = _builder_user_id
      AND revoked_at IS NULL
      AND is_primary
      AND (v_existing.id IS NULL OR id <> v_existing.id);
  END IF;

  IF v_existing.id IS NOT NULL THEN
    IF _expected_version IS NULL OR v_existing.row_version <> _expected_version THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STALE_WRITE',
        DETAIL = format('current_version=%s', v_existing.row_version);
    END IF;

    UPDATE public.builder_organisation_memberships
    SET membership_role = _membership_role, is_primary = COALESCE(_is_primary, false)
    WHERE id = v_existing.id
    RETURNING * INTO v_row;

    PERFORM public.builder_log_activity(
      _actor_user_id, _actor_type, 'builder_membership_role_changed',
      'membership', v_row.id, _organisation_id, _builder_user_id,
      jsonb_build_object('membership_role', v_existing.membership_role,
                         'is_primary', v_existing.is_primary,
                         'status', v_existing.status),
      jsonb_build_object('membership_role', v_row.membership_role,
                         'is_primary', v_row.is_primary,
                         'status', v_row.status),
      _reason, '{}'::jsonb);
  ELSE
    INSERT INTO public.builder_organisation_memberships(
      builder_user_id, organisation_id, membership_role, is_primary, status, granted_by)
    VALUES (_builder_user_id, _organisation_id, _membership_role,
            COALESCE(_is_primary, false), 'active', _actor_user_id)
    RETURNING * INTO v_row;

    PERFORM public.builder_log_activity(
      _actor_user_id, _actor_type, 'builder_membership_granted',
      'membership', v_row.id, _organisation_id, _builder_user_id,
      NULL,
      jsonb_build_object('membership_role', v_row.membership_role,
                         'is_primary', v_row.is_primary,
                         'status', v_row.status),
      _reason, '{}'::jsonb);
  END IF;

  RETURN v_row;
END $$;

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

CREATE OR REPLACE FUNCTION public.builder_admin_delete_membership(
  _actor_user_id uuid,
  _actor_type text,
  _membership_id uuid,
  _expected_version bigint,
  _reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_membership public.builder_organisation_memberships;
  v_blockers text[] := ARRAY[]::text[];
  v_reason text := NULLIF(btrim(_reason), '');
  v_count bigint;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_membership FROM public.builder_organisation_memberships
  WHERE id = _membership_id
  FOR UPDATE;

  IF v_membership.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_MEMBERSHIP_NOT_FOUND';
  END IF;

  IF _expected_version IS NULL OR v_membership.row_version <> _expected_version THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STALE_WRITE',
      DETAIL = format('current_version=%s', v_membership.row_version);
  END IF;

  IF v_membership.revoked_at IS NOT NULL THEN
    v_blockers := array_append(v_blockers, 'a revoked membership is retained as audit evidence');
  END IF;

  SELECT count(*) INTO v_count FROM public.builder_membership_permissions
    WHERE membership_id = _membership_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('permission overrides (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_project_access
    WHERE builder_user_id = v_membership.builder_user_id
      AND organisation_id = v_membership.organisation_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('project access grants (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_portal_activity_log
    WHERE entity_type = 'membership' AND entity_id = _membership_id
      AND action <> 'builder_membership_granted';
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('membership history entries (%s)', v_count)); END IF;

  IF array_length(v_blockers, 1) > 0 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_HAS_DEPENDENTS',
      DETAIL = format('dependents=%s', array_to_string(v_blockers, ', '));
  END IF;

  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type, 'builder_membership_removed',
    'membership', v_membership.id,
    v_membership.organisation_id, v_membership.builder_user_id,
    jsonb_build_object(
      'id', v_membership.id, 'membership_role', v_membership.membership_role,
      'is_primary', v_membership.is_primary, 'status', v_membership.status),
    NULL, v_reason,
    jsonb_build_object('removal', 'permanent', 'dependents_checked', true));

  DELETE FROM public.builder_organisation_memberships WHERE id = _membership_id;

  RETURN jsonb_build_object('removed', true, 'membership_id', _membership_id);
END $$;

REVOKE ALL ON FUNCTION public.builder_admin_delete_user(uuid, text, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_admin_delete_organisation(uuid, text, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_admin_delete_membership(uuid, text, uuid, bigint, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.builder_admin_delete_user IS
  'Permanently removes a Builder portal user that has no protected dependants. Refuses with BUILDER_HAS_DEPENDENTS otherwise; revoke access instead. Audit is written before the delete because the activity-log link is ON DELETE SET NULL.';
COMMENT ON FUNCTION public.builder_admin_delete_organisation IS
  'Permanently removes a Builder organisation that has no protected dependants. Refuses with BUILDER_HAS_DEPENDENTS otherwise; close the organisation instead.';
COMMENT ON FUNCTION public.builder_admin_delete_membership IS
  'Permanently removes a live Builder membership that never conferred access. Refuses with BUILDER_HAS_DEPENDENTS otherwise; revoke the membership instead. Never deletes the user or the organisation. Blocker reasons are appended with array_append so a bare text reason cannot be misread as an array literal.';