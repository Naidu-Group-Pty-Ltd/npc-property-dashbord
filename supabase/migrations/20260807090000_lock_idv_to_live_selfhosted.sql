-- Identity verification has one production architecture: the existing selfhosted adapter.
-- There is no production simulator and no alternative provider row for IDV.
--
-- This migration deliberately leaves readiness fail-closed: setting the row live/active
-- does NOT make capture available unless AML_VERIFICATION_SERVICE_URL and
-- AML_VERIFICATION_SERVICE_TOKEN are configured and the real /healthz probe succeeds.
-- It only removes the contradictory database state where the configured IDV provider
-- remained a disabled simulator.
--
-- ROLLBACK (configuration only; does not re-enable simulation):
--   UPDATE aml.provider_configs
--   SET active = false
--   WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'selfhosted';

-- Remove the older trigger before normalising the row. The stronger trigger below
-- replaces it and rejects both simulator IDV and alternative IDV provider keys.
DROP TRIGGER IF EXISTS trg_aml_reject_active_simulator_idv ON aml.provider_configs;
DROP FUNCTION IF EXISTS aml.tg_reject_active_simulator_idv();

-- Keep exactly the locked provider for IDV. Historical alternative rows are disabled,
-- not deleted, so audit/history is preserved.
UPDATE aml.provider_configs
SET active = false,
    updated_at = now()
WHERE capability = 'idv'
  AND provider_key <> 'selfhosted'
  AND active = true;

-- The canonical selfhosted row is live and active. Runtime readiness is still decided
-- by the adapter configuration plus a successful service health probe.
UPDATE aml.provider_configs
SET mode = 'live',
    active = true,
    last_health_status = CASE
      WHEN last_health_status = 'unconfigured' THEN 'unknown'
      ELSE last_health_status
    END,
    last_health_message = CASE
      WHEN last_health_status = 'unconfigured' THEN NULL
      ELSE last_health_message
    END,
    updated_at = now()
WHERE capability = 'idv'
  AND provider_key = 'selfhosted';

CREATE OR REPLACE FUNCTION aml.tg_lock_idv_provider()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.capability = 'idv' THEN
    IF NEW.provider_key <> 'selfhosted' THEN
      RAISE EXCEPTION
        'Identity verification provider is locked to selfhosted.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.mode <> 'live' THEN
      RAISE EXCEPTION
        'Identity verification runs live only; simulator mode is not permitted.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_aml_lock_idv_provider ON aml.provider_configs;
CREATE TRIGGER trg_aml_lock_idv_provider
  BEFORE INSERT OR UPDATE ON aml.provider_configs
  FOR EACH ROW EXECUTE FUNCTION aml.tg_lock_idv_provider();
