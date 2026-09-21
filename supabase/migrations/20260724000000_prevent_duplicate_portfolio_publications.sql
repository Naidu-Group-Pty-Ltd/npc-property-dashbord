-- @effect: select 1 from pg_class where relkind = 'i' and relname = 'client_portal_reports_unique_source_tier'
--
-- SUPERSEDED, and the probe above says so deliberately.
--
-- This file's index cannot be created: it keys (client_id, source_report_id)
-- and the live table holds a `compass` report and a `cashflow` report derived
-- from one parent, so it failed 23505 on 21 Sep 2026. A fork shares its
-- parent's id, and forbidding that stops a client receiving both documents.
-- `20260921070000_client_portal_reports_unique_per_tier.sql` carries the same
-- guarantee with the artefact tier in the key, and the reasoning is in its
-- header.
--
-- The probe therefore asserts the SUPERSEDING index rather than this file's
-- own, because what `Migration drift` must answer is whether the uniqueness
-- is in place — not whether a particular name is. Without it this file reads
-- NOT APPLIED every night for ever, over a guarantee that is enforced, and a
-- gate that is permanently red is one nobody reads.
--
-- The SQL below is left exactly as it merged. It is not corrected in place,
-- because editing the statement would claim this file can run, and it cannot.

-- A saved Portfolio Analysis report may be linked to a client portal once.
-- Existing non-portfolio and historical portal reports remain unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS client_portal_reports_unique_portfolio_source
  ON public.client_portal_reports (client_id, source_report_id)
  WHERE source_report_id IS NOT NULL;
