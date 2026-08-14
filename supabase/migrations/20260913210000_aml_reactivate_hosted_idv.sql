-- Reactivate the provider-hosted identity verification session.
--
-- ## Why this reverses 20260911000300
--
-- That migration retired the hosted flow on a product decision: no customer is
-- sent to a verification vendor's page. The decision has been reversed, and the
-- reason is one the standalone architecture cannot satisfy at any setting.
--
-- The Standalone APIs (`/v3/id-verification/`, `/v3/passive-liveness/`,
-- `/v3/face-match/`) are called with `save_api_request=false`. Didit's published
-- contract for that flag is that NOTHING IS STORED: the call is not persisted as
-- a session, so it never appears in the Business Console under Verifications →
-- User Verifications, and no Directory → Users record is created. NPC is billed
-- and holds its own evidence, but the provider-side verification record — which
-- the business requires — does not exist.
--
-- `POST /v3/session/` is the only shape of this integration that creates one.
-- Measured against the live API on 2026-08-14 (sandbox application, workflow
-- bb4349a9…): one create produced a session AND a Directory user whose `source`
-- is `VERIFICATION` and whose `vendor_data` is the NPC key verbatim.
--
-- ## What this does NOT do
--
-- It deletes nothing, fails nobody, consumes no attempt and touches no settled
-- result. The standalone provider row and every standalone evidence row stay
-- exactly where they are, and `didit_standalone` remains seeded and rollback-
-- ready. Standalone captures already in flight settle on their own path: this
-- changes which provider NEW attempts resolve to, and nothing else.
--
-- ROLLBACK (returns new attempts to the NPC camera journey):
--   UPDATE aml.provider_configs SET active = false
--    WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';
--   UPDATE aml.provider_configs SET active = true
--    WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit_standalone';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. The provider switch.
--
-- Order matters inside the transaction: the standalone row is deactivated
-- FIRST, so there is no instant at which two rows are active and a concurrent
-- portal read could resolve either one. `resolveTenantProvider` takes the
-- single highest-priority ACTIVE row.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE aml.provider_configs
   SET active = false, updated_at = now()
 WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit_standalone';

-- The workflow id is NOT written here. It is already set on this row
-- (`config.workflow_id`), it is deployment-specific, and a migration that
-- hard-codes one would overwrite a correctly configured environment with
-- another environment's workflow. The convergence block below refuses the
-- switch if it is missing rather than activating a provider that cannot mint a
-- session.
UPDATE aml.provider_configs
   SET active = true, updated_at = now()
 WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';

-- ─────────────────────────────────────────────────────────────────────────
-- Convergence. Each of these is a way this could silently half-happen and
-- leave customers with no electronic verification at all.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_active_idv     integer;
  v_hosted_active  boolean;
  v_workflow_id    text;
BEGIN
  SELECT count(*) INTO v_active_idv
    FROM aml.provider_configs
   WHERE tenant_id = 'default' AND capability = 'idv' AND active;

  SELECT coalesce(bool_or(active), false) INTO v_hosted_active
    FROM aml.provider_configs
   WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';

  SELECT config->>'workflow_id' INTO v_workflow_id
    FROM aml.provider_configs
   WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';

  IF NOT v_hosted_active THEN
    RAISE EXCEPTION 'hosted IDV reactivation did not converge: provider_key=didit is not active, so no session can be created';
  END IF;

  IF v_active_idv <> 1 THEN
    RAISE EXCEPTION 'hosted IDV reactivation did not converge: % IDV providers are active for tenant default (exactly 1 is required)', v_active_idv;
  END IF;

  -- A hosted provider with no workflow id creates nothing: `diditConfigured`
  -- reads false, the portal answers `temporarily_unavailable`, and the customer
  -- is offered the documentary route. Better to refuse the switch here than to
  -- discover it from a customer who cannot verify.
  IF v_workflow_id IS NULL OR length(v_workflow_id) = 0 THEN
    RAISE EXCEPTION 'hosted IDV reactivation did not converge: aml.provider_configs.config.workflow_id is not set for provider_key=didit. Set it to the live Didit workflow UUID and re-run.';
  END IF;
END $$;
