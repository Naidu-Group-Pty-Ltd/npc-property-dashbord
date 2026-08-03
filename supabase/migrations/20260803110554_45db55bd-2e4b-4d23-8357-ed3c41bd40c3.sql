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

  IF v_membership.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_MEMBERSHIP_ALREADY_REVOKED';
  END IF;

  IF _expected_version IS NULL OR v_membership.row_version <> _expected_version THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STALE_WRITE',
      DETAIL = format('current_version=%s', v_membership.row_version);
  END IF;

  SELECT count(*) INTO v_count FROM public.builder_project_access
    WHERE builder_user_id = v_membership.builder_user_id
      AND project_id IN (
        SELECT id FROM public.builder_projects
        WHERE builder_organisation_id = v_membership.organisation_id
           OR developer_organisation_id = v_membership.organisation_id
      );
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('project access grants (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_reservations
    WHERE organisation_id = v_membership.organisation_id
      AND reserved_by_builder_user_id = v_membership.builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('active reservations (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_unit_holds
    WHERE organisation_id = v_membership.organisation_id
      AND held_by_builder_user_id = v_membership.builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('active unit holds (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_transactions
    WHERE organisation_id = v_membership.organisation_id
      AND created_by_builder_user_id = v_membership.builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('transactions (%s)', v_count)); END IF;

  SELECT count(*) INTO v_count FROM public.builder_tasks
    WHERE organisation_id = v_membership.organisation_id
      AND created_by_builder_user_id = v_membership.builder_user_id;
  IF v_count > 0 THEN v_blockers := array_append(v_blockers, format('tasks (%s)', v_count)); END IF;

  IF array_length(v_blockers, 1) > 0 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_HAS_DEPENDENTS',
      DETAIL = format('dependents=%s', array_to_string(v_blockers, ', '));
  END IF;

  PERFORM public.builder_log_activity(
    _actor_user_id, _actor_type, 'builder_membership_revoked',
    'membership', v_membership.id, v_membership.organisation_id, v_membership.builder_user_id,
    jsonb_build_object(
      'membership_role', v_membership.membership_role,
      'is_primary', v_membership.is_primary,
      'status', v_membership.status),
    NULL, v_reason,
    jsonb_build_object('revocation', 'permanent', 'dependents_checked', true));

  UPDATE public.builder_organisation_memberships
  SET revoked_at = now(), status = 'revoked', revoked_reason = v_reason, revoked_by = _actor_user_id
  WHERE id = _membership_id;

  RETURN jsonb_build_object('revoked', true, 'membership_id', _membership_id);
END $$;

COMMENT ON FUNCTION public.builder_admin_delete_membership IS
  'Permanently revokes a Builder organisation membership. Refuses with BUILDER_HAS_DEPENDENTS when the user still has active assignments or holds for that organisation; reassign or release them first.';

REVOKE ALL ON FUNCTION public.builder_admin_delete_membership(uuid, text, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_admin_delete_membership(uuid, text, uuid, bigint, text) TO service_role;