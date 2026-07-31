-- Builder / Developer Portal — Phase 0 reconciliation.
--
-- Baseline: a2ec188faa806ff97cb272f7f5a8bcf56b984cb1
--
-- Read-only. Run with a read-only role. Establishes the production baseline the
-- Builder programme starts from and surfaces the data conditions that would make
-- a later Builder migration unsafe.
--
-- Zero rows is the target for every anomaly result set. Candidate rows are
-- reported, never auto-linked or auto-resolved: this programme never infers a
-- relationship from an address (ADR-001).

BEGIN TRANSACTION READ ONLY;

-- ===========================================================================
-- 1. Confirm the Builder domain is greenfield
-- ===========================================================================

-- Expect zero rows. Any row means a Builder table already exists and the Phase 0
-- greenfield finding is stale.
SELECT 'builder_domain_table_present' AS check_name, c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname IN (
    'builder_organisations','builder_organizations','builder_portal_users',
    'builder_portal_sessions','builder_developments','builder_projects',
    'builder_project_stages','builder_project_parties','builder_user_access',
    'property_units','property_reservations','construction_cases',
    'builder_transactions','builder_variations','builder_progress_claims',
    'builder_inspections','builder_defects','builder_case_read_model'
  );

-- Expect exactly two rows: build_progress_payments and builder_invoices.
SELECT 'builder_named_table_inventory' AS check_name, c.relname AS table_name,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count,
       c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE '%build%'
ORDER BY c.relname;

-- ===========================================================================
-- 2. Scale of the construction-adjacent data that already exists
-- ===========================================================================

SELECT 'construction_deal_volume' AS check_name,
       count(*) FILTER (WHERE build_price IS NOT NULL)              AS deals_with_build_price,
       count(*) FILTER (WHERE construction_loan_type IS NOT NULL)   AS deals_with_construction_loan,
       count(*) FILTER (WHERE expected_build_start IS NOT NULL)     AS deals_with_build_start,
       count(*) FILTER (WHERE estimated_completion IS NOT NULL)     AS deals_with_est_completion,
       count(*)                                                     AS total_deals
FROM public.client_deals;

SELECT 'build_progress_payment_volume' AS check_name,
       count(*) AS payment_rows,
       count(DISTINCT deal_id) AS deals_covered,
       count(*) FILTER (WHERE is_commission_trigger) AS commission_trigger_rows,
       count(*) FILTER (WHERE funds_released) AS funds_released_rows
FROM public.build_progress_payments;

-- MIG-05: the free-text stage vocabulary that must be reconciled against the
-- proposed controlled milestone keys. Review this list before writing any
-- mapping; do not assume the ten proposed keys cover it.
SELECT 'build_stage_vocabulary' AS check_name,
       lower(btrim(stage_name)) AS stage_name_normalized,
       count(*) AS occurrences,
       min(stage_number) AS min_stage_number,
       max(stage_number) AS max_stage_number
FROM public.build_progress_payments
WHERE stage_name IS NOT NULL AND btrim(stage_name) <> ''
GROUP BY 1, 2
ORDER BY occurrences DESC, stage_name_normalized;

SELECT 'builder_invoice_volume' AS check_name,
       count(*) AS invoice_rows,
       count(DISTINCT deal_id) AS deals_covered,
       count(*) FILTER (WHERE commission_received) AS commission_received_rows,
       count(*) FILTER (WHERE commission_amount IS NOT NULL) AS rows_with_commission_amount
FROM public.builder_invoices;

-- MIG-07: deals that look like builder transactions but carry no builder,
-- project, stage or unit identity. Reported so the volume of manual linking is
-- known. These must NEVER be auto-converted into builder transactions.
SELECT 'unattributable_construction_deal' AS check_name, d.id AS deal_id, d.client_id,
       d.current_stage, d.build_price, d.construction_loan_type, d.estimated_completion
FROM public.client_deals d
WHERE (d.build_price IS NOT NULL OR d.construction_loan_type IS NOT NULL)
ORDER BY d.created_at DESC;

-- ===========================================================================
-- 3. Transaction-case backbone readiness for a fourth domain slot (GEN-09)
-- ===========================================================================

SELECT 'transaction_case_backbone_state' AS check_name,
       (SELECT count(*) FROM public.transaction_cases) AS cases,
       (SELECT count(*) FROM public.transaction_case_links) AS links,
       (SELECT count(*) FROM public.transaction_case_links WHERE legal_matter_id IS NOT NULL) AS legal_linked,
       (SELECT count(*) FROM public.transaction_case_links WHERE purchase_file_id IS NOT NULL) AS finance_linked,
       (SELECT count(*) FROM public.transaction_case_links WHERE client_deal_id IS NOT NULL) AS deal_linked,
       (SELECT count(*) FROM public.transaction_cases WHERE case_type = 'construction') AS construction_cases;

-- Expect zero rows. A pre-existing cross-client link would mean the guard
-- trigger has been bypassed, and adding a fourth slot on top of a broken
-- invariant would compound it.
SELECT 'cross_client_case_link' AS check_name, l.case_id, l.legal_matter_id, l.purchase_file_id, l.client_deal_id,
       tc.client_id AS case_client_id
FROM public.transaction_case_links l
JOIN public.transaction_cases tc ON tc.id = l.case_id
LEFT JOIN public.legal_matters m ON m.id = l.legal_matter_id
LEFT JOIN public.purchase_files pf ON pf.id = l.purchase_file_id
LEFT JOIN public.client_deals cd ON cd.id = l.client_deal_id
WHERE (l.legal_matter_id IS NOT NULL AND m.client_id IS DISTINCT FROM tc.client_id)
   OR (l.purchase_file_id IS NOT NULL AND pf.client_id IS DISTINCT FROM tc.client_id)
   OR (l.client_deal_id IS NOT NULL AND cd.client_id IS DISTINCT FROM tc.client_id);

-- Expect zero rows. Each domain record may belong to at most one case; a
-- duplicate would break the unique-slot assumption the Builder slot copies.
SELECT 'duplicate_domain_case_slot' AS check_name, 'legal_matter' AS domain_type,
       legal_matter_id::text AS domain_record_id, count(*) AS slot_count
FROM public.transaction_case_links WHERE legal_matter_id IS NOT NULL
GROUP BY 2, 3 HAVING count(*) > 1
UNION ALL
SELECT 'duplicate_domain_case_slot', 'purchase_file', purchase_file_id::text, count(*)
FROM public.transaction_case_links WHERE purchase_file_id IS NOT NULL
GROUP BY 2, 3 HAVING count(*) > 1
UNION ALL
SELECT 'duplicate_domain_case_slot', 'client_deal', client_deal_id::text, count(*)
FROM public.transaction_case_links WHERE client_deal_id IS NOT NULL
GROUP BY 2, 3 HAVING count(*) > 1;

-- Open reconciliation issues inherited from the Solicitor programme. These
-- should be at zero, or explained, before a fourth domain joins the backbone.
SELECT 'open_case_reconciliation_issue' AS check_name, issue_type, count(*) AS open_count
FROM public.transaction_case_reconciliation_issues
WHERE status = 'open'
GROUP BY issue_type
ORDER BY open_count DESC;

-- ===========================================================================
-- 4. Shared-primitive widening readiness (GEN-01 … GEN-13)
-- ===========================================================================

-- The exact CHECK definitions the Builder widenings must replace. Compare the
-- output against docs/builder-portal/03-shared-service-inventory.md before
-- writing any widening migration.
SELECT 'shared_check_constraint' AS check_name,
       rel.relname AS table_name, con.conname AS constraint_name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public' AND con.contype = 'c'
  AND rel.relname IN (
    'portal_terms_versions','portal_terms_acceptances','case_milestones','case_tasks',
    'case_task_assignments','conversation_participants','document_access_grants',
    'transaction_case_links','transaction_case_link_history'
  )
ORDER BY rel.relname, con.conname;

-- GEN-02: the NOT NULL that must be dropped, and the composite unique that must
-- be reconstructed. This is the highest-risk widening (MIG-01).
SELECT 'terms_acceptance_owner_shape' AS check_name,
       (SELECT count(*) FROM public.portal_terms_acceptances) AS acceptance_rows,
       (SELECT count(DISTINCT portal) FROM public.portal_terms_versions) AS distinct_portals,
       (SELECT bool_and(attnotnull) FROM pg_attribute
         WHERE attrelid = 'public.portal_terms_acceptances'::regclass
           AND attname = 'solicitor_user_id') AS solicitor_user_id_not_null;

-- GEN-10: every foreign key from the cutover control plane into solicitor_firms.
-- All of these must be generalised before a Builder rollout can be flag-controlled.
SELECT 'cutover_plane_solicitor_coupling' AS check_name,
       rel.relname AS table_name, con.conname AS constraint_name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public' AND con.contype = 'f'
  AND pg_get_constraintdef(con.oid) LIKE '%solicitor_firms%'
ORDER BY rel.relname, con.conname;

-- Feature-flag inventory. Builder rows are inserts, not schema change, but the
-- table they land in is solicitor-coupled through cross_portal_firm_rollouts.
SELECT 'cross_portal_feature_inventory' AS check_name,
       feature_key, default_mode, minimum_stable_days, legacy_removal_target
FROM public.cross_portal_feature_definitions
ORDER BY feature_key;

-- ===========================================================================
-- 5. Security baseline (SEC-06)
-- ===========================================================================

-- The permissive policies on the commission-bearing tables. Acceptable while
-- these are reached only from the internal staff dashboard; the Builder Portal
-- must never read them.
SELECT 'permissive_policy_on_commission_table' AS check_name,
       rel.relname AS table_name, pol.polname AS policy_name,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression
FROM pg_policy pol
JOIN pg_class rel ON rel.oid = pol.polrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname IN ('builder_invoices','build_progress_payments')
ORDER BY rel.relname, pol.polname;

-- Confirm the internal module registry state behind finding NOCOPY-03 / MIG-10.
-- Expect finance_portal_admin present; solicitor_portal_admin expected absent.
SELECT 'portal_admin_module_registration' AS check_name, module_key, is_active, route
FROM public.dashboard_modules
WHERE module_key IN ('finance_portal_admin','solicitor_portal_admin','builder_portal_admin')
ORDER BY module_key;

COMMIT;
