-- Re-copy the ACTIVE report_templates rows from the v15 catalogue, exactly as
-- `20261203010000` did for v14 and `20261202010000` for v13, and for the same
-- reason: adopted masters are COPIES, and nothing else updates a copy after
-- adoption. A library seed alone changes what a NEW adoption gets and leaves
-- every document people already generate drawing the old page.
--
-- What v15 changes reach those documents:
--
-- The running head names the CHAPTER a page is in, not the document. It read
-- `Part 03 · Report` on every page of a body that moves from the executive
-- verdict to demand drivers to planning controls to the risk register —
-- telling a reader they were in the report, which they knew. It binds
-- `narrative.chapters.N` now: the chapter in force when page N opens, measured
-- by the pre-pass at each template's own geometry, so the head cannot name a
-- chapter a different packing would have put there. A page before the first
-- heading resolves to nothing and prints the empty string, which is the right
-- answer — an unresolved binding is never a visible `{{…}}`.
--
-- The body's first page also loses its own section heading. It opened on
-- `As assessed / The report`, which named the document a reader was already
-- holding and then repeated itself in every running head beneath it; the
-- body's real first heading is whatever the report opens with, and the
-- markdown already sets it.
--
-- And the Commercial & Industrial Capacity constraints table printed over the
-- explanation beneath it on 4 of 50 masters. Its four value columns took a
-- fixed 330 pt, leaving the test name 87-117 pt on the families with the
-- deepest margins, while three of the ten `CONSTRAINT_LABELS` run 24 to 31
-- characters — so those rows wrapped to two lines while `table()` declared
-- one. Measured in Chromium at A4 across all fifty, for the longest string
-- each column can carry and for the column heads: Test 147.8, Permits 66.6,
-- Policy 42.0, This deal 53.8, Status 73.9. The value columns are
-- 75/48/60/82 now and the name takes the rest, at least 152 pt everywhere.
-- Re-measured: 0 of 50 overlap, 0 of 400 rows wrap.
--
-- Mechanics are identical to the v13 and v14 refreshes: the entry's current
-- schema with THIS ROW'S OWN token colours carried forward (the colourway bake
-- is exactly that merge, so no palette is invented), and the lineage's
-- entryVersion advanced so the picker keeps recognising the copy. Rows with no
-- library lineage, inactive drafts, and rows whose entry the library no longer
-- lists are untouched. Idempotent.

update public.report_templates t
set
  schema = jsonb_set(
    e.schema,
    '{tokens,colors}',
    coalesce(t.schema -> 'tokens' -> 'colors', e.schema -> 'tokens' -> 'colors', '{}'::jsonb)
  ),
  config = jsonb_set(
    t.config,
    '{libraryLineage,entryVersion}',
    to_jsonb(e.version)
  ),
  updated_at = now()
from public.template_library_entries e
where t.is_active
  and (t.config -> 'libraryLineage' ->> 'entryId') = e.id::text
  and e.status = 'published'
  and e.schema is not null;
