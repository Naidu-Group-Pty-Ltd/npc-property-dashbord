-- The probe battery, run AFTER 20261204000000_property_condition_records.sql
-- has applied verbatim. One psql session; ids travel between probes as
-- session settings. Every expected refusal is caught by its SQLSTATE class
-- inside a DO block — an unexpected acceptance RAISEs, which aborts the run
-- under ON_ERROR_STOP, so the harness cannot report a pass it did not earn.
--
-- Acting users (see setup.sql):
--   …0001  admin      (user_roles: admin)   role test_admin
--   …0002  recorder   (user_roles: user)    role test_recorder
--   …0003  plain user (user_roles: user)    role test_user
-- All three are members of `authenticated`, which is what the policies name.

\echo ''
\echo '== SECTION 1: the shape function itself =='

DO $$
BEGIN
  -- The manual_stats trap, probed at the function: a key that is absent must
  -- REFUSE the element, never NULL its way to acceptance.
  IF public.condition_findings_shape_ok('[]'::jsonb) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PROBE 1a FAILED: empty array not accepted';
  END IF;
  IF public.condition_findings_shape_ok('{}'::jsonb) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'PROBE 1b FAILED: an object is not an array and must refuse';
  END IF;
  IF public.condition_findings_shape_ok(
       '[{"element":"Roof","severity":"major_defect"}]'::jsonb) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PROBE 1c FAILED: a well-formed finding must pass';
  END IF;
  IF public.condition_findings_shape_ok('[{"element":"Roof"}]'::jsonb)
       IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'PROBE 1d FAILED: an element with no severity key must refuse (the manual_stats trap)';
  END IF;
  IF public.condition_findings_shape_ok('[{"severity":"minor_defect"}]'::jsonb)
       IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'PROBE 1e FAILED: an element with no element key must refuse';
  END IF;
  IF public.condition_findings_shape_ok(
       '[{"element":"Render","severity":"moderate"}]'::jsonb) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'PROBE 1f FAILED: an unrecognised severity must refuse';
  END IF;
  IF public.condition_findings_shape_ok(
       '[{"element":"Render","severity":5}]'::jsonb) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'PROBE 1g FAILED: a non-string severity must refuse';
  END IF;
  IF public.condition_findings_shape_ok('["loose string"]'::jsonb)
       IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'PROBE 1h FAILED: a non-object element must refuse';
  END IF;
  IF public.condition_findings_shape_ok(NULL::jsonb) IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE 1i FAILED: STRICT must answer NULL on NULL (the column is NOT NULL, so one never arrives)';
  END IF;
  RAISE NOTICE 'PROBES 1a-1i PASS: shape verdicts, including the absent-key trap, all refuse or accept as declared';
END $$;

DO $$
DECLARE v char; s boolean;
BEGIN
  SELECT provolatile, proisstrict INTO v, s
  FROM pg_proc WHERE proname = 'condition_findings_shape_ok'
    AND pronamespace = 'public'::regnamespace;
  IF v IS DISTINCT FROM 'i' OR s IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PROBE 1j FAILED: expected IMMUTABLE STRICT, got volatility=% strict=%', v, s;
  END IF;
  RAISE NOTICE 'PROBE 1j PASS: condition_findings_shape_ok is IMMUTABLE STRICT in the catalog';
END $$;

\echo ''
\echo '== SECTION 2: valid and invalid records, written as the admin =='

SELECT set_config('app.test_uid', '00000000-0000-4000-8000-000000000001', false);
SET ROLE test_admin;

DO $$
DECLARE rid uuid;
BEGIN
  INSERT INTO public.property_condition_records
    (property_address, document_kind, issuer, issuer_licence, issued_on, inspected_on,
     document_reference, scope, scope_coverage, conclusion, findings, verification, recorded_by)
  VALUES
    ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
     'Hunter Building Consultants', 'NSW 123456C', '2026-06-02', '2026-05-29',
     'HBC-2026-4417',
     'Interior, exterior, roof void and subfloor of the dwelling, and the detached garage.',
     'whole_dwelling', 'no_defects_identified', '[]'::jsonb, 'transcribed_only',
     '00000000-0000-4000-8000-000000000001')
  RETURNING id INTO rid;
  PERFORM set_config('probe.admin_row', rid::text, false);
  RAISE NOTICE 'PROBE 2a PASS: a valid whole-dwelling inspection is accepted (%)', rid;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, verification, recorded_by)
    VALUES ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
            'Hunter Building Consultants', '2027-06-02', 'transcribed_only',
            '00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'PROBE 2b FAILED: a future issued_on was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PROBE 2b PASS — future issued_on refused by the trigger (23514): %', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, inspected_on, verification, recorded_by)
    VALUES ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
            'Hunter Building Consultants', '2026-03-01', '2026-05-29', 'transcribed_only',
            '00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'PROBE 2c FAILED: an inspection dated after its report was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PROBE 2c PASS — inspected_on after issued_on refused: %', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, findings, verification, recorded_by)
    VALUES ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
            'Hunter Building Consultants', '2026-06-02', '{}'::jsonb, 'transcribed_only',
            '00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'PROBE 2d FAILED: a findings OBJECT was accepted where an array is required';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PROBE 2d PASS — non-array findings refused: %', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, findings, verification, recorded_by)
    VALUES ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
            'Hunter Building Consultants', '2026-06-02',
            '[{"element":"Roof"}]'::jsonb, 'transcribed_only',
            '00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'PROBE 2e FAILED: a finding with no severity key was ACCEPTED — the manual_stats trap is open';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PROBE 2e PASS — absent severity key refused at the row, not NULLed through: %', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, findings, verification, recorded_by)
    VALUES ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
            'Hunter Building Consultants', '2026-06-02',
            '[{"element":"Render cracking","severity":"moderate"}]'::jsonb, 'transcribed_only',
            '00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'PROBE 2f FAILED: an unrecognised severity was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PROBE 2f PASS — unrecognised severity refused: %', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, verification, recorded_by)
    VALUES ('   ', 'building_inspection', 'Hunter Building Consultants', '2026-06-02',
            'transcribed_only', '00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'PROBE 2g FAILED: a blank property_address was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PROBE 2g PASS — a record that names no property is refused: %', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, verification, recorded_by)
    VALUES ('18 Annabelle Crescent, Kellyville NSW 2155', 'typed_construction_year',
            'operator', '2026-06-02', 'transcribed_only',
            '00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'PROBE 2h FAILED: an inadmissible document kind was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PROBE 2h PASS — document kind outside the vocabulary refused: %', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, verification, recorded_by)
    VALUES ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
            'Hunter Building Consultants', '2026-06-02', 'document_held',
            '00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'PROBE 2i FAILED: verification=document_held with no file was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PROBE 2i PASS — a verification claim needs the file it claims: %', SQLERRM;
  END;
END $$;

DO $$
DECLARE rid uuid;
BEGIN
  INSERT INTO public.property_condition_records
    (property_address, document_kind, issuer, issued_on, scope, scope_coverage,
     conclusion, findings, verification, recorded_by)
  VALUES
    ('262 Pallas Street, Maryborough QLD 4650', 'building_inspection',
     'Wide Bay Building Reports', '2026-08-14',
     'Interior, exterior, roof space and subfloor of the dwelling.', 'whole_dwelling',
     'defects_identified',
     '[{"element":"Subfloor bearer","severity":"major_defect","note":"as stated"},
       {"element":"Balustrade","severity":"safety_hazard"},
       {"element":"Sinking fund","severity":"unfunded_liability"},
       {"element":"Window seals","severity":"minor_defect"}]'::jsonb,
     'transcribed_only', '00000000-0000-4000-8000-000000000001')
  RETURNING id INTO rid;
  RAISE NOTICE 'PROBE 2j PASS: all four recognised severities accepted in one findings array (%)', rid;
END $$;

RESET ROLE;

\echo ''
\echo '== SECTION 3: linkage to the document store and the report =='

DO $$
DECLARE fid uuid; repid uuid; rid uuid; got uuid;
BEGIN
  INSERT INTO public.client_files DEFAULT VALUES RETURNING id INTO fid;
  INSERT INTO public.investment_reports DEFAULT VALUES RETURNING id INTO repid;
  -- Written as the platform's own service path (RLS-bypassing owner), the
  -- way the future edge operation writes: a held document, linked both ways.
  INSERT INTO public.property_condition_records
    (property_address, document_kind, issuer, issued_on, scope, scope_coverage,
     conclusion, findings, verification, file_id, report_id, recorded_by)
  VALUES
    ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
     'Hunter Building Consultants', '2026-06-02',
     'Interior, exterior, roof void and subfloor of the dwelling.', 'whole_dwelling',
     'no_defects_identified', '[]'::jsonb, 'document_held', fid, repid,
     '00000000-0000-4000-8000-000000000002')
  RETURNING id INTO rid;
  PERFORM set_config('probe.linked_row', rid::text, false);
  PERFORM set_config('probe.report_row', repid::text, false);
  RAISE NOTICE 'PROBE 3a PASS: document_held with a real client_files row and a real report accepted (%)', rid;

  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, verification, file_id, recorded_by)
    VALUES ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
            'Hunter Building Consultants', '2026-06-02', 'document_held',
            gen_random_uuid(), '00000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'PROBE 3b FAILED: a file_id pointing at nothing was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PROBE 3b PASS — file_id must name a real client_files row: %', SQLERRM;
  END;

  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, verification, report_id, recorded_by)
    VALUES ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
            'Hunter Building Consultants', '2026-06-02', 'transcribed_only',
            gen_random_uuid(), '00000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'PROBE 3c FAILED: a report_id pointing at nothing was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PROBE 3c PASS — report_id must name a real investment_reports row: %', SQLERRM;
  END;

  -- History: deleting the report must not delete the evidence — the link is
  -- severed (SET NULL) and the record survives.
  DELETE FROM public.investment_reports WHERE id = repid;
  SELECT report_id INTO got FROM public.property_condition_records WHERE id = rid;
  IF got IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE 3d FAILED: report deletion left report_id = %', got;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.property_condition_records WHERE id = rid) THEN
    RAISE EXCEPTION 'PROBE 3d FAILED: deleting the report deleted the evidence';
  END IF;
  RAISE NOTICE 'PROBE 3d PASS: deleting the linked report severs the link and keeps the record';
END $$;

\echo ''
\echo '== SECTION 4: row-level security — who may read, write and change =='

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.property_condition_records;
  PERFORM set_config('probe.total_rows', n::text, false);
  RAISE NOTICE 'Baseline (RLS-exempt owner): % rows stored', n;
END $$;

-- The admin sees everything.
SELECT set_config('app.test_uid', '00000000-0000-4000-8000-000000000001', false);
SET ROLE test_admin;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.property_condition_records;
  IF n <> current_setting('probe.total_rows')::int THEN
    RAISE EXCEPTION 'PROBE 4a FAILED: admin sees % of % rows', n, current_setting('probe.total_rows');
  END IF;
  RAISE NOTICE 'PROBE 4a PASS: an admin reads the full register (% rows)', n;
END $$;

-- An admin cannot file a record as somebody else.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, verification, recorded_by)
    VALUES ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
            'Hunter Building Consultants', '2026-06-02', 'transcribed_only',
            '00000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'PROBE 4b FAILED: an admin inserted a record attributed to another user';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PROBE 4b PASS — recorded_by must be the acting user (42501): %', SQLERRM;
  END;
END $$;
RESET ROLE;

-- The recorder (no admin role) sees only their own row and can write nothing.
SELECT set_config('app.test_uid', '00000000-0000-4000-8000-000000000002', false);
SET ROLE test_recorder;
DO $$
DECLARE n int; own int;
BEGIN
  SELECT count(*) INTO n FROM public.property_condition_records;
  SELECT count(*) INTO own FROM public.property_condition_records
    WHERE recorded_by = '00000000-0000-4000-8000-000000000002';
  IF n <> own OR n < 1 THEN
    RAISE EXCEPTION 'PROBE 4c FAILED: recorder sees % rows, % of them their own', n, own;
  END IF;
  RAISE NOTICE 'PROBE 4c PASS: the recorder sees exactly their own rows (%) and nobody else''s', n;

  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, verification, recorded_by)
    VALUES ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
            'Hunter Building Consultants', '2026-06-02', 'transcribed_only',
            '00000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'PROBE 4d FAILED: a non-admin inserted a condition record';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PROBE 4d PASS — insert needs the admin or superadmin role (42501): %', SQLERRM;
  END;
END $$;

DO $$
DECLARE n int;
BEGIN
  UPDATE public.property_condition_records SET scope = 'rewritten'
    WHERE recorded_by = '00000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'PROBE 4e FAILED: a non-admin updated % of their own rows', n;
  END IF;
  RAISE NOTICE 'PROBE 4e PASS: the recorder may read their row and may not change it (0 rows updated)';
END $$;
RESET ROLE;

-- A user with no role and no rows sees nothing and writes nothing.
SELECT set_config('app.test_uid', '00000000-0000-4000-8000-000000000003', false);
SET ROLE test_user;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.property_condition_records;
  IF n <> 0 THEN
    RAISE EXCEPTION 'PROBE 4f FAILED: a plain user sees % rows', n;
  END IF;
  RAISE NOTICE 'PROBE 4f PASS: a plain authenticated user sees no rows';

  BEGIN
    INSERT INTO public.property_condition_records
      (property_address, document_kind, issuer, issued_on, verification, recorded_by)
    VALUES ('18 Annabelle Crescent, Kellyville NSW 2155', 'building_inspection',
            'Hunter Building Consultants', '2026-06-02', 'transcribed_only',
            '00000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'PROBE 4g FAILED: a plain user inserted a condition record';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PROBE 4g PASS — insert refused for a plain user (42501): %', SQLERRM;
  END;
END $$;
RESET ROLE;

-- No DELETE policy exists, so no authenticated member deletes anything —
-- evidence an assessment rested on is corrected, never disappeared.
SELECT set_config('app.test_uid', '00000000-0000-4000-8000-000000000001', false);
SET ROLE test_admin;
DO $$
DECLARE n int;
BEGIN
  DELETE FROM public.property_condition_records;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'PROBE 4h FAILED: an admin deleted % condition records', n;
  END IF;
  RAISE NOTICE 'PROBE 4h PASS: even an admin deletes nothing — there is no DELETE policy';
END $$;
RESET ROLE;

DO $$
DECLARE n int; d int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'property_condition_records';
  SELECT count(*) INTO d FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'property_condition_records'
      AND cmd = 'DELETE';
  IF n <> 3 OR d <> 0 THEN
    RAISE EXCEPTION 'PROBE 4i FAILED: expected 3 policies and no DELETE policy, found % with % DELETE', n, d;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class
      WHERE oid = 'public.property_condition_records'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'PROBE 4i FAILED: row security is not enabled';
  END IF;
  RAISE NOTICE 'PROBE 4i PASS: RLS enabled; SELECT/INSERT/UPDATE policies exist and no DELETE policy does';
END $$;

\echo ''
\echo '== SECTION 5: correction and history behaviour =='

SELECT set_config('app.test_uid', '00000000-0000-4000-8000-000000000001', false);
SET ROLE test_admin;
DO $$
DECLARE rid uuid; t0 timestamptz; t1 timestamptz;
BEGIN
  rid := current_setting('probe.admin_row')::uuid;
  SELECT updated_at INTO t0 FROM public.property_condition_records WHERE id = rid;
  -- A correction: the extraction was wrong, the document did record findings.
  UPDATE public.property_condition_records
    SET conclusion = 'defects_identified',
        findings = '[{"element":"Roof","severity":"major_defect"}]'::jsonb
    WHERE id = rid;
  SELECT updated_at INTO t1 FROM public.property_condition_records WHERE id = rid;
  IF t1 IS NULL OR t0 IS NULL OR t1 <= t0 THEN
    RAISE EXCEPTION 'PROBE 5a FAILED: updated_at did not advance (% -> %)', t0, t1;
  END IF;
  RAISE NOTICE 'PROBE 5a PASS: an admin correction lands and updated_at advances (% -> %)', t0, t1;

  -- The shape constraint holds on UPDATE too — a correction cannot smuggle in
  -- what an insert would refuse.
  BEGIN
    UPDATE public.property_condition_records
      SET findings = '[{"element":"Roof"}]'::jsonb WHERE id = rid;
    RAISE EXCEPTION 'PROBE 5b FAILED: an UPDATE stored a finding with no severity';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PROBE 5b PASS — the findings shape holds on UPDATE as well: %', SQLERRM;
  END;

  BEGIN
    UPDATE public.property_condition_records
      SET issued_on = '2027-06-02' WHERE id = rid;
    RAISE EXCEPTION 'PROBE 5c FAILED: an UPDATE moved issued_on into the future';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PROBE 5c PASS — the future-date guard holds on UPDATE as well: %', SQLERRM;
  END;
END $$;
RESET ROLE;

\echo ''
\echo '== All probes passed =='
