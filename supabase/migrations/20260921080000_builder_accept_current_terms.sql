-- @effect: select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'builder_accept_current_terms'
--
-- `public.builder_accept_current_terms`, the one object
-- `20260901000700_partner_portal_agreement_cascade.sql` declares that the
-- database does not hold. Two of its three objects exist; this is the third.
--
-- ## Why that file is not replayed to recover it
--
-- Applying it on 21 Sep 2026 failed on its FIRST statement:
--
--   23514: check constraint "portal_terms_versions_portal_check" of relation
--          "portal_terms_versions" is violated by some row
--
-- That migration widens the portal discriminator to
-- ('solicitor','builder','finance'). A LATER migration,
-- `20261001000100_portal_terms_direct_channel.sql`, has already widened it
-- again to ('solicitor','builder','finance','direct') and inserted the direct
-- channel's terms, and the live table holds two `direct` versions with one
-- live. Replaying the September file would narrow the allow-list back to three
-- values over rows that need four — which is why it fails, and why forcing it
-- would break the direct channel rather than fix anything.
--
-- Its other work is already done or superseded: the constraints are wider than
-- it asks for, and the finance portal already carries a live terms version.
-- The function is the only thing genuinely absent, so the function is what
-- comes forward.
--
-- The definition below is copied verbatim from lines 105-171 of that file,
-- including the DROP of the four-argument signature it supersedes, so what
-- lands is exactly what it declared. Neither signature exists today.
--
-- Creating it restores the Builder Portal's terms acceptance path. It does not
-- cascade the Portal Access / Confidentiality / Privacy / AML-CTF Compliance
-- Passport Agreement to the Builder and Finance portals — that is the rest of
-- the September migration, it involves live terms versions and acceptances,
-- and it is a decision about what partners have agreed to rather than a
-- missing object.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.builder_accept_current_terms(uuid, uuid, text, text, jsonb);

DROP FUNCTION IF EXISTS public.builder_accept_current_terms(uuid, uuid, text, text);

CREATE FUNCTION public.builder_accept_current_terms(
  _builder_user_id uuid,
  _session_id uuid,
  _ip_hash text DEFAULT NULL,
  _user_agent_hash text DEFAULT NULL,
  _acknowledgements jsonb DEFAULT NULL)
RETURNS TABLE (terms_version_id uuid, version text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_terms record;
BEGIN
  -- Session ownership. Without it the function trusts whatever pair of ids it
  -- is handed, so a caller holding one valid session could record an acceptance
  -- against another user, or a revoked session could still write one.
  IF NOT EXISTS (
    SELECT 1 FROM public.builder_portal_sessions
    WHERE id = _session_id AND builder_user_id = _builder_user_id AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_SESSION_NOT_FOUND';
  END IF;

  -- Aliased deliberately: this function's OUT column is also called `version`,
  -- so selecting the column under its own name makes the reference ambiguous
  -- and the function fails at runtime for every caller.
  SELECT ptv.id AS terms_id, ptv.version AS terms_version INTO v_terms
  FROM public.portal_terms_versions ptv
  WHERE ptv.portal = 'builder' AND ptv.retired_at IS NULL AND ptv.effective_at <= now()
  ORDER BY ptv.effective_at DESC LIMIT 1;

  IF v_terms.terms_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_TERMS_UNAVAILABLE';
  END IF;

  -- Bare `ON CONFLICT DO NOTHING` rather than a column inference list: this
  -- function's OUT column is also called `terms_version_id`, and an inference
  -- list is an expression context where plpgsql resolves that name to the OUT
  -- variable, making the reference ambiguous and failing at runtime.
  INSERT INTO public.portal_terms_acceptances(
    terms_version_id, portal, builder_user_id, acknowledgements, ip_hash, user_agent_hash)
  VALUES (v_terms.terms_id, 'builder', _builder_user_id, _acknowledgements, _ip_hash, _user_agent_hash)
  ON CONFLICT DO NOTHING;

  UPDATE public.builder_portal_users
  SET has_accepted_current_terms = true, terms_accepted_at = now()
  WHERE id = _builder_user_id;

  -- The Builder Portal's own activity log entry, unchanged except that it now
  -- carries which acknowledgments were asserted.
  PERFORM public.builder_log_activity(
    NULL, 'builder_user', 'builder_terms_accepted',
    'portal_user', _builder_user_id, NULL, _builder_user_id,
    NULL, jsonb_build_object(
      'terms_version_id', v_terms.terms_id,
      'version', v_terms.terms_version,
      'acknowledgements', COALESCE(_acknowledgements, '[]'::jsonb)),
    NULL, jsonb_build_object('session_id', _session_id));

  terms_version_id := v_terms.terms_id;
  version := v_terms.terms_version;
  RETURN NEXT;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.builder_accept_current_terms(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_accept_current_terms(uuid, uuid, text, text, jsonb)
  TO service_role;
