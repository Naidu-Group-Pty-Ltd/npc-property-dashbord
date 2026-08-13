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

COMMENT ON FUNCTION public.builder_admin_upsert_membership IS
  'Create or update a builder organisation membership. Clears the primary flag on any existing live membership atomically so changing primary organisation does not violate the partial unique index.';

REVOKE ALL ON FUNCTION public.builder_admin_upsert_membership(uuid, text, uuid, uuid, text, boolean, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_admin_upsert_membership(uuid, text, uuid, uuid, text, boolean, bigint, text) TO service_role;