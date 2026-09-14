-- ============================================================================
-- Builders Network Phase 5 — release the nine inbound FKs (prime → builder)
-- (docs/builder-portal/45-network-extraction-plan.md §7 Phase 5;
--  the measured edge list is docs/builder-portal/44-network-extraction-boundary.md)
--
-- The builder tables leave this database in Phase 7. Every prime-side table
-- that references one must stop doing so first, or Phase 7's drops either
-- fail on the constraint or CASCADE into non-builder rows — five
-- cross_portal_* tables the Solicitor cutover also lives in, and
-- portal_terms_acceptances, which holds EVERY portal's consent records.
--
-- The COLUMNS stay. After this migration each is an opaque remote reference
-- to an entity whose home is now the network: the Phase 4 move preserved
-- organisation ids, so aml.partner_organisations' two builder links and the
-- three builder consent records keep naming the same entities. No row is
-- touched; only the nine constraints go, each by its measured name, never
-- by CASCADE.
--
-- Measured on the live prime at authoring (2026-09-14): nine inbound FKs
-- exactly, matching the boundary doc with zero drift; referencing rows
-- E4 = 2 / E5 = 3, every other edge 0; orphans 0 on every edge.
--
-- Replay safety: a fresh clone provisioned AFTER Phase 7 never creates the
-- builder tables, so every check and drop below is guarded by to_regclass —
-- a missing builder table means there is nothing to orphan-check and no
-- constraint to drop, and the file is a clean no-op. Re-application on a
-- database that already ran it is likewise a no-op (DROP CONSTRAINT
-- IF EXISTS).
--
-- Reversal: re-adding these constraints is valid only until Phase 7 removes
-- the builder tables. That window is a hard gate — after it, the columns are
-- remote references permanently.
-- ============================================================================

DO $phase5$
DECLARE
  v_bad bigint;
BEGIN
  -- ---------------------------------------------------------------------
  -- Orphan gate: a constraint may be released only while it provably holds.
  -- A dangling reference hidden by the release would surface later as a
  -- silent wrong answer, so any orphan stops the phase here, loudly.
  -- Each gate runs only where both ends of the edge exist.
  -- ---------------------------------------------------------------------

  IF to_regclass('aml.partner_organisations') IS NOT NULL
     AND to_regclass('public.builder_organisations') IS NOT NULL THEN
    SELECT count(*) INTO v_bad FROM aml.partner_organisations p
      WHERE p.builder_organisation_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.builder_organisations b
                        WHERE b.id = p.builder_organisation_id);
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'phase5 orphan gate: aml.partner_organisations carries % dangling builder_organisation_id row(s)', v_bad;
    END IF;
  END IF;

  IF to_regclass('public.portal_terms_acceptances') IS NOT NULL
     AND to_regclass('public.builder_portal_users') IS NOT NULL THEN
    SELECT count(*) INTO v_bad FROM public.portal_terms_acceptances t
      WHERE t.builder_user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.builder_portal_users u
                        WHERE u.id = t.builder_user_id);
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'phase5 orphan gate: portal_terms_acceptances carries % dangling builder_user_id row(s)', v_bad;
    END IF;
  END IF;

  IF to_regclass('public.transaction_case_links') IS NOT NULL
     AND to_regclass('public.builder_transactions') IS NOT NULL THEN
    SELECT count(*) INTO v_bad FROM public.transaction_case_links l
      WHERE l.builder_transaction_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.builder_transactions bt
                        WHERE bt.id = l.builder_transaction_id);
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'phase5 orphan gate: transaction_case_links carries % dangling builder_transaction_id row(s)', v_bad;
    END IF;
  END IF;

  IF to_regclass('public.document_processing_jobs') IS NOT NULL
     AND to_regclass('public.builder_document_versions') IS NOT NULL THEN
    SELECT count(*) INTO v_bad FROM public.document_processing_jobs j
      WHERE j.builder_document_version_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.builder_document_versions v
                        WHERE v.id = j.builder_document_version_id);
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'phase5 orphan gate: document_processing_jobs carries % dangling builder_document_version_id row(s)', v_bad;
    END IF;
  END IF;

  IF to_regclass('public.builder_organisations') IS NOT NULL THEN
    SELECT
      (SELECT count(*) FROM public.cross_portal_firm_rollouts r
        WHERE r.builder_organisation_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.builder_organisations b WHERE b.id = r.builder_organisation_id))
    + (SELECT count(*) FROM public.cross_portal_rollout_history h
        WHERE h.builder_organisation_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.builder_organisations b WHERE b.id = h.builder_organisation_id))
    + (SELECT count(*) FROM public.cross_portal_cutover_approvals a
        WHERE a.builder_organisation_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.builder_organisations b WHERE b.id = a.builder_organisation_id))
    + (SELECT count(*) FROM public.cross_portal_dual_read_comparisons d
        WHERE d.builder_organisation_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.builder_organisations b WHERE b.id = d.builder_organisation_id))
    + (SELECT count(*) FROM public.cross_portal_reconciliation_runs n
        WHERE n.builder_organisation_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.builder_organisations b WHERE b.id = n.builder_organisation_id))
    INTO v_bad;
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'phase5 orphan gate: cross_portal_* carries % dangling builder_organisation_id row(s)', v_bad;
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- Release the nine constraints, each by its measured production name.
  -- Never CASCADE: what each drop removes is exactly one constraint.
  -- ---------------------------------------------------------------------

  IF to_regclass('aml.partner_organisations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE aml.partner_organisations DROP CONSTRAINT IF EXISTS partner_organisations_builder_organisation_id_fkey';
  END IF;
  IF to_regclass('public.portal_terms_acceptances') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.portal_terms_acceptances DROP CONSTRAINT IF EXISTS portal_terms_acceptances_builder_user_id_fkey';
  END IF;
  IF to_regclass('public.transaction_case_links') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.transaction_case_links DROP CONSTRAINT IF EXISTS transaction_case_links_builder_transaction_id_fkey';
  END IF;
  IF to_regclass('public.document_processing_jobs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.document_processing_jobs DROP CONSTRAINT IF EXISTS document_processing_jobs_builder_document_version_id_fkey';
  END IF;
  IF to_regclass('public.cross_portal_firm_rollouts') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cross_portal_firm_rollouts DROP CONSTRAINT IF EXISTS cross_portal_firm_rollouts_builder_organisation_id_fkey';
  END IF;
  IF to_regclass('public.cross_portal_rollout_history') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cross_portal_rollout_history DROP CONSTRAINT IF EXISTS cross_portal_rollout_history_builder_organisation_id_fkey';
  END IF;
  IF to_regclass('public.cross_portal_cutover_approvals') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cross_portal_cutover_approvals DROP CONSTRAINT IF EXISTS cross_portal_cutover_approvals_builder_organisation_id_fkey';
  END IF;
  IF to_regclass('public.cross_portal_dual_read_comparisons') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cross_portal_dual_read_comparisons DROP CONSTRAINT IF EXISTS cross_portal_dual_read_comparisons_builder_organisation_id_fkey';
  END IF;
  IF to_regclass('public.cross_portal_reconciliation_runs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cross_portal_reconciliation_runs DROP CONSTRAINT IF EXISTS cross_portal_reconciliation_runs_builder_organisation_id_fkey';
  END IF;
END
$phase5$;
