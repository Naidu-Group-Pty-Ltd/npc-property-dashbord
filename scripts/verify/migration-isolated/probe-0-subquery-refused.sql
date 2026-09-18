-- Negative control, run BEFORE the migration under test: the constraint form
-- this migration originally carried — a subquery inside a CHECK — is refused
-- by PostgreSQL at apply time with 0A000 (feature_not_supported). The static
-- migration guards could not see this because they read the file and never
-- apply it, which is exactly why this harness exists.
--
-- The DDL below is the v1 constraint reduced to its refused shape. If
-- Postgres ever ACCEPTS it, this probe fails the run — the harness would
-- then be testing a premise that is no longer true.

\echo '== PROBE 0: the inline-subquery CHECK is refused by Postgres at apply time =='

DO $probe$
BEGIN
  BEGIN
    EXECUTE $ddl$
      CREATE TABLE public.probe_inline_subquery (
        findings jsonb NOT NULL DEFAULT '[]'::jsonb,
        CONSTRAINT probe_findings_shape CHECK (
          jsonb_typeof(findings) = 'array'
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(findings) AS f
            WHERE jsonb_typeof(f) <> 'object'
          )
        )
      )
    $ddl$;
    RAISE EXCEPTION 'PROBE 0 FAILED: a CHECK constraint containing a subquery was ACCEPTED';
  EXCEPTION WHEN feature_not_supported THEN
    RAISE NOTICE 'PROBE 0 PASS — refused with 0A000: %', SQLERRM;
  END;
END
$probe$;
