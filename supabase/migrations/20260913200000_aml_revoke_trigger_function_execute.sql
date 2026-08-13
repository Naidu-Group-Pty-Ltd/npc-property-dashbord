-- Revoke EXECUTE on aml.tg_emit_verification_requested() from PUBLIC.
--
-- WP-17's `secdef_execute` rule: CREATE FUNCTION grants EXECUTE to PUBLIC, and
-- `anon` — the publishable key in the browser bundle — inherits PUBLIC. The
-- Standalone capture migration (20260911000000) created this function SECURITY
-- DEFINER and never revoked, so the grant is live: that migration is already
-- applied (recorded 20260811132210), which is exactly why the remediation is a
-- new migration rather than an edit to that file. Editing an applied migration
-- changes nothing in any database that has run it.
--
-- Reachability is narrow rather than absent, and that distinction is the reason
-- this is revoked rather than waived. The function RETURNS trigger, so Postgres
-- refuses to call it directly ("trigger functions can only be called as
-- triggers") and PostgREST will not expose it. What the PUBLIC grant does leave
-- open is attachment: a role that can CREATE TRIGGER on a table it owns could
-- point this definer-rights writer at public.integration_outbox. A narrow path
-- is not no path.
--
-- The existing trigger is unaffected. EXECUTE on a trigger function is checked
-- when the trigger is CREATEd, not each time it fires, and the owner keeps its
-- grant — so trg_aml_verification_outbox keeps emitting.

REVOKE EXECUTE ON FUNCTION aml.tg_emit_verification_requested()
  FROM PUBLIC, anon, authenticated;
