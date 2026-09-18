-- The condition-record evidence path (S5/S6 §1, "Approval A").
--
-- PREPARED FOR REVIEW. Not applied to production by this branch; DDL reaches
-- production only through `apply-migration.yml` on a merged file. Confirmed
-- absent from production on 18 September 2026 — `list_tables` shows no
-- `property_condition_records`, and `list_migrations` does not carry this
-- version.
--
-- APPLIED AND PROBED in an isolated PostgreSQL cluster on 18 September 2026
-- (`scripts/verify/migration-isolated/run.sh`; transcript at
-- `docs/reports/evidence/MIGRATION_ISOLATED_TEST_2026-09-18.txt`): the
-- original inline-subquery CHECK reproduced its 0A000 apply-time refusal,
-- this file then applied verbatim, and 30 probes exercised valid and invalid
-- records, the manual_stats absent-key trap, document/report linkage with
-- ON DELETE SET NULL, the RLS matrix for admin/recorder/plain users, the
-- absence of any DELETE path, and correction behaviour under the trigger.
-- The cluster was PostgreSQL 16.13 against production's 17.4; nothing probed
-- differs between those majors, and the difference is recorded in the
-- transcript rather than assumed away.
--
-- The version is 20261204000000 and not the same-day 20260918nnnnnn it was
-- first written as. Production has 980 migrations applied and its highest is
-- 20261203010000; two same-day neighbours, 20260918090000 and 20260918100000,
-- are already applied. A new file numbered below the applied high-water mark
-- is the out-of-order case, and there is no reason to take it when a later
-- number costs nothing.
--
-- ## What this is, and what it deliberately is not
--
-- `riskModelD.pure.ts` needs observations spanning two independent categories
-- before Risk may score. An established house's schema offers `site` (hazard,
-- planning — one category however well retrieved) and `building`
-- (`condition_and_maintenance`). So every route to a fifth scored dimension
-- runs through a condition record, and nothing in this deployment can hold one.
-- This table is that gap closed.
--
-- It is NOT a second file store. The document's BYTES stay in `client_files`,
-- which already carries the bucket, the path, the content hash, the dedupe key
-- and the record-source provenance the platform audits uploads with;
-- `file_id` points at it. What is new is the STRUCTURED reading of that
-- document — who issued it, when it examined what, what it excluded, what it
-- concluded and what it found — because those are the facts
-- `assessConditionRecord` judges and none of them is derivable from a file row.
--
-- It is also NOT a new reporting entry point. No surface here replaces the
-- existing input, generation, editing or Templates workflow, and Template
-- Builder stays out of the customer journey.
--
-- ## The constraints mirror `conditionRecord.pure.ts` v2.1.0
--
-- Held at the column so a direct write cannot store what the validator would
-- refuse — the same reason `manual_stats` and the manual-screening rule are
-- constrained rather than merely validated. Three of them are worth naming:
--
--   * `inspected_on <= issued_on` is a CHECK because it is immutable. A report
--     cannot describe an examination that had not happened when it was
--     written.
--   * A date in the FUTURE cannot be a CHECK, because `now()` is not
--     IMMUTABLE and Postgres refuses it there. It is a trigger instead.
--   * `findings` is JSONB, and walking an array takes a subquery — which a
--     CHECK constraint cannot contain: Postgres refuses `EXISTS (SELECT …)`
--     inside a CHECK at apply time (0A000), an error no static guard here
--     could see because the guards read the file and never apply it. The
--     walk therefore lives in `condition_findings_shape_ok`, an IMMUTABLE
--     function of the VALUE ALONE, and the CHECK calls it — the supported
--     mechanism for a validation a CHECK expression cannot spell. Inside the
--     walk, key PRESENCE is asserted before any dereference: `->` on an
--     absent key is SQL NULL, and a NULL that reaches the top of a CHECK
--     ACCEPTS the row. `manual_stats` shipped exactly that fault for a day.
--     Here the walk's verdicts are also NULL-proof by construction — a
--     malformed element makes the WHERE clause TRUE (never NULL) whichever
--     operand evaluates first, so the row is refused, not waved through.
--
-- ## What it does not touch
--
-- No existing table, column, policy or row. No backfill. No historical
-- assessment is rewritten — a stored score keeps the grade its own run issued,
-- and a new assessment is produced by the supported regeneration path.

-- `findings` must be an ARRAY of objects, each carrying `element` and
-- `severity`, and every severity one the method can weigh. Defined BEFORE the
-- table because the table's CHECK names it. IMMUTABLE is honest here — the
-- answer depends on the argument and on nothing else — and STRICT makes a
-- NULL argument answer NULL rather than erroring; the column is NOT NULL, so
-- one never arrives. `search_path` is pinned to `pg_catalog` because every
-- name in the body is a built-in and a constraint function must not resolve
-- through whatever path the writing session carries.
CREATE OR REPLACE FUNCTION public.condition_findings_shape_ok(findings jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_typeof(findings) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(findings) AS f
      WHERE jsonb_typeof(f) <> 'object'
         OR NOT (f ? 'element')
         OR NOT (f ? 'severity')
         OR jsonb_typeof(f -> 'severity') <> 'string'
         OR (f ->> 'severity') NOT IN (
              'safety_hazard', 'major_defect', 'minor_defect', 'unfunded_liability')
    );
$$;

COMMENT ON FUNCTION public.condition_findings_shape_ok(jsonb) IS
  'Shape validation for property_condition_records.findings: an array of '
  'objects each naming element and a recognised severity. Lives in a function '
  'because a CHECK constraint cannot contain the subquery the walk needs.';

CREATE TABLE IF NOT EXISTS public.property_condition_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Whose property. `property_address` is required because it is what the
  -- DOCUMENT identifies, and the validator compares it against the subject
  -- being assessed; the two id columns are the platform's own linkage and are
  -- nullable because a document can arrive before either is known.
  property_address      text NOT NULL CHECK (length(btrim(property_address)) > 0),
  canonical_property_key text,
  client_property_id    uuid,
  report_id             uuid REFERENCES public.investment_reports(id) ON DELETE SET NULL,

  -- The document. `document_kind` decides what it is capable of establishing;
  -- `ESTABLISHES` in the pure module is the authority and this only refuses
  -- what is outside the vocabulary entirely.
  document_kind         text NOT NULL CHECK (document_kind IN (
                          'building_inspection', 'strata_report',
                          'building_certificate', 'vendor_statement')),
  issuer                text NOT NULL CHECK (length(btrim(issuer)) > 0),
  issuer_licence        text,
  issued_on             date NOT NULL,
  inspected_on          date,
  document_reference    text,

  -- The bytes, in the store that already holds uploads.
  file_id               uuid REFERENCES public.client_files(id) ON DELETE SET NULL,

  -- What it covered. `scope` is the issuer's own words; `scope_coverage` is how
  -- wide that was, and a scope SENTENCE is not a coverage.
  scope                 text,
  scope_coverage        text CHECK (scope_coverage IS NULL OR scope_coverage IN (
                          'whole_dwelling', 'partial_dwelling', 'common_property',
                          'specified_works', 'disclosure_only')),
  exclusions            text[] NOT NULL DEFAULT '{}',

  -- The document's own conclusion. `not_concluded` is the honest default: an
  -- empty findings list is a gap in the record, never a clean dwelling.
  conclusion            text NOT NULL DEFAULT 'not_concluded' CHECK (conclusion IN (
                          'no_defects_identified', 'defects_identified', 'not_concluded')),

  findings              jsonb NOT NULL DEFAULT '[]'::jsonb,

  verification          text NOT NULL DEFAULT 'transcribed_only' CHECK (verification IN (
                          'issuer_verified', 'document_held', 'transcribed_only')),
  verified_by           uuid,
  verified_at           timestamptz,

  -- Provenance of the RECORD, as distinct from the document's own.
  recorded_by           uuid,
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- A report cannot be issued before the examination it reports.
  CONSTRAINT property_condition_records_inspection_order
    CHECK (inspected_on IS NULL OR inspected_on <= issued_on),

  -- Verification claims the document is held; that needs the file.
  CONSTRAINT property_condition_records_verified_needs_file
    CHECK (verification = 'transcribed_only' OR file_id IS NOT NULL),

  -- The walk over the findings array lives in `condition_findings_shape_ok`,
  -- because a CHECK constraint cannot contain a subquery. Key presence is
  -- asserted inside it BEFORE any dereference — the `manual_stats` rule.
  CONSTRAINT property_condition_records_findings_shape
    CHECK (public.condition_findings_shape_ok(findings))
);

COMMENT ON TABLE public.property_condition_records IS
  'Structured reading of a property condition document. The bytes live in '
  '`client_files` (`file_id`); this holds what `assessConditionRecord` judges. '
  'A stated absence of defects is a determination and only a whole-dwelling '
  'inspection can supply one — see `conditionRecord.pure.ts` ESTABLISHES.';

COMMENT ON COLUMN public.property_condition_records.conclusion IS
  'The document''s OWN conclusion. `not_concluded` is the default because an '
  'empty findings list is a gap in the record rather than a clean dwelling.';

COMMENT ON COLUMN public.property_condition_records.scope_coverage IS
  'How wide the examination was. Required before a "no defects" conclusion may '
  'be read as an observation; a scope sentence is not a coverage.';

-- A date in the future cannot be a CHECK (`now()` is not IMMUTABLE), so the
-- rule the validator enforces is held here instead.
CREATE OR REPLACE FUNCTION public.property_condition_records_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.issued_on > CURRENT_DATE THEN
    RAISE EXCEPTION 'A condition document cannot be issued in the future (issued_on = %)',
      NEW.issued_on USING ERRCODE = '23514';
  END IF;
  IF NEW.inspected_on IS NOT NULL AND NEW.inspected_on > CURRENT_DATE THEN
    RAISE EXCEPTION 'A condition document cannot record an inspection in the future (inspected_on = %)',
      NEW.inspected_on USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS property_condition_records_guard ON public.property_condition_records;
CREATE TRIGGER property_condition_records_guard
  BEFORE INSERT OR UPDATE ON public.property_condition_records
  FOR EACH ROW EXECUTE FUNCTION public.property_condition_records_guard();

CREATE INDEX IF NOT EXISTS property_condition_records_report_idx
  ON public.property_condition_records (report_id) WHERE report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS property_condition_records_property_idx
  ON public.property_condition_records (canonical_property_key)
  WHERE canonical_property_key IS NOT NULL;

-- RLS. Deliberately narrow: a condition document is a third party's report
-- about somebody's dwelling, and nothing here widens an existing grant.
ALTER TABLE public.property_condition_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY property_condition_records_read
  ON public.property_condition_records FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR public.has_role(auth.uid(), 'admin')
    OR recorded_by = auth.uid()
  );

CREATE POLICY property_condition_records_insert
  ON public.property_condition_records FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'))
    AND recorded_by = auth.uid()
  );

CREATE POLICY property_condition_records_update
  ON public.property_condition_records FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));

-- No DELETE policy. A condition record is evidence an assessment rested on;
-- withdrawing one is a correction with a reason, not a row disappearing, and
-- the surface that does it is a decision this migration does not pre-empt.
