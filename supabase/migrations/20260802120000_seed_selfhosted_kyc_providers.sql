-- Seed the zero-cost KYC providers with the production IDV architecture spelled out.
--
-- Identity verification is always the existing `selfhosted` provider in live mode.
-- Runtime readiness still fails closed until the service URL/token are configured and
-- the real service health probe succeeds, so an active row cannot manufacture a result.
-- Screening keeps its separate simulator behaviour; that is not on the customer IDV path.
--
-- Priority is placed AFTER any provider the tenant already has. A later forward migration
-- locks IDV to `selfhosted` and disables historical alternative IDV rows.
--
-- Additive and idempotent (UNIQUE (tenant_id, capability, provider_key)).
--
-- ROLLBACK:
--   DELETE FROM aml.provider_configs
--   WHERE provider_key IN ('selfhosted', 'local_lists');

INSERT INTO aml.provider_configs (
  tenant_id, capability, provider_key, display_label, priority,
  cost_per_unit_cents, currency, active, mode, secret_ref, config
)
SELECT
  t.tenant_id,
  'idv',
  'selfhosted',
  'NPC Verification Service (self-hosted)',
  COALESCE((SELECT MAX(p.priority) FROM aml.provider_configs p
            WHERE p.tenant_id = t.tenant_id AND p.capability = 'idv'), 0) + 1,
  0,
  'AUD',
  true,
  'live',
  'AML_VERIFICATION_SERVICE_TOKEN',
  jsonb_build_object(
    'stack', 'zero-cost',
    'models', jsonb_build_array('SFace (Apache-2.0)', 'YuNet (Apache-2.0)'),
    'limitations', jsonb_build_array(
      'no_issuing_authority_check',
      'liveness_is_heuristic_only'
    )
  )
FROM aml.tenant_settings t
ON CONFLICT (tenant_id, capability, provider_key) DO NOTHING;

INSERT INTO aml.provider_configs (
  tenant_id, capability, provider_key, display_label, priority,
  cost_per_unit_cents, currency, active, mode, secret_ref, config
)
SELECT
  t.tenant_id,
  'pep_sanctions',
  'local_lists',
  'Official lists (DFAT / UN / OFAC)',
  COALESCE((SELECT MAX(p.priority) FROM aml.provider_configs p
            WHERE p.tenant_id = t.tenant_id AND p.capability = 'pep_sanctions'), 0) + 1,
  0,
  'AUD',
  true,
  'simulator',
  NULL,
  jsonb_build_object(
    'match_threshold', 0.72,
    'threshold_rationale',
      'Tuned for recall over precision. Without a commercial alias/transliteration '
      || 'corpus, under-matching is a compliance failure while over-referring costs '
      || 'reviewer minutes. Every match above this threshold is adjudicated by a person.',
    'lists', jsonb_build_array('dfat', 'un', 'ofac'),
    'adverse_media_covered', false
  )
FROM aml.tenant_settings t
ON CONFLICT (tenant_id, capability, provider_key) DO NOTHING;
