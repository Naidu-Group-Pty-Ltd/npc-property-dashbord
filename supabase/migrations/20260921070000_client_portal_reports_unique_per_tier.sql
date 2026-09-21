-- @effect: select 1 from pg_class where relkind = 'i' and relname = 'client_portal_reports_unique_source_tier'
--
-- The uniqueness `20260724000000_prevent_duplicate_portfolio_publications.sql`
-- meant, keyed so it can actually be created.
--
-- ## What the original index asserts, and why it cannot be built
--
-- It declares UNIQUE (client_id, source_report_id) WHERE source_report_id IS
-- NOT NULL, and applying it on 21 Sep 2026 failed:
--
--   23505: could not create unique index
--          "client_portal_reports_unique_portfolio_source"
--   DETAIL: Key (client_id, source_report_id)=
--           (4d2743bf-..., 56c20855-...) is duplicated.
--
-- The two rows behind that are not a duplicate publication. They are two
-- different documents derived from one parent report, published 62 seconds
-- apart:
--
--   report_tier 'compass'  — "Lot 33, 39 Pats Road and 10 Scheiwe Road ..."
--                            in investment-reports/
--   report_tier 'cashflow' — "Cash Flow Analysis - Lot 33, ..."
--                            in cashflow-analysis/, and already READ by the
--                            client
--
-- A fork shares its parent's id, so one source report legitimately yields more
-- than one published artefact. The original key forbids that, which would stop
-- a client ever receiving both the Compass and the Cash Flow analysis for one
-- property. Deleting either row to satisfy the index would remove a document a
-- client has been sent, one of which they have opened.
--
-- ## Why this is a correction rather than a widening
--
-- The original overreaches its own stated purpose. Its comment says "A saved
-- Portfolio Analysis report may be linked to a client portal once", but it
-- keys every row with a source. Measured on the live table, EVERY `portfolio`
-- row carries source_report_id NULL, so the index never constrained a
-- portfolio publication at all — the only rows it ever bound were `investment`
-- ones, which is the case it gets wrong.
--
-- Adding the tier keeps the guarantee where it belongs — one publication per
-- (client, source report, artefact) — and permits the fork. Measured before
-- writing: grouping the live table on (client_id, source_report_id,
-- report_tier) yields ZERO groups with more than one row, so this index builds
-- against the data as it stands and no row is touched.
--
-- COALESCE because report_tier is NULL on six of thirteen rows and a unique
-- index treats NULLs as distinct, which would leave exactly the rows with no
-- tier unconstrained — the same technique `20260728120000` uses for
-- COALESCE(party_id, case_id), and for the same reason.
--
-- The original index is left declared and unapplied. It is not dropped here
-- because it does not exist to drop.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.client_portal_reports_unique_source_tier;

CREATE UNIQUE INDEX IF NOT EXISTS client_portal_reports_unique_source_tier
  ON public.client_portal_reports (client_id, source_report_id, COALESCE(report_tier, ''))
  WHERE source_report_id IS NOT NULL;

COMMENT ON INDEX public.client_portal_reports_unique_source_tier IS
  'One publication per (client, source report, artefact tier). Supersedes the unbuildable client_portal_reports_unique_portfolio_source, which keyed (client_id, source_report_id) alone and so forbade a Cash Flow fork being published beside its Compass parent.';
