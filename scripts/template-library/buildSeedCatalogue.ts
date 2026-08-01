/**
 * Builds the seeded Template Library catalogue and emits it as a SQL migration.
 *
 * Templates are authored here as data, validated against the *real*
 * `ReportTemplateSchema` and the *real* production renderer allow-list, and
 * written to the database. They are deliberately not bundled into the app: the
 * Builder list already documents that PDF-imported schemas can reach hundreds
 * of megabytes, and a catalogue that ships in the JS bundle would cost every
 * user — including the ones who never open the library — on first paint.
 *
 * Run:  npx tsx scripts/template-library/buildSeedCatalogue.ts
 * (or)  npm run templates:library:seed
 *
 * The generated migration is idempotent: it upserts on (slug, version), so
 * re-running it updates the seeded entries and never duplicates them. It only
 * ever touches rows whose slug is in the seed set, so an operator's own
 * promoted entries are never disturbed.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReportTemplateSchema } from '../../src/lib/reportTemplate/templateSchema';
import {
  PRODUCTION_SAFE_BLOCK_TYPES,
} from '../../supabase/functions/_shared/productionBlockTypes';
import {
  deriveEntryFacts,
  validateForPublish,
} from '../../supabase/functions/_shared/templateLibraryCore.pure';
import { takeOverflows } from './blocks';
import { runningHeadFor, VOICES, type VoiceId } from './designSystem';
import { SEED_TEMPLATES, type SeedTemplate } from './templates';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');

/**
 * Where the generated catalogue lands.
 *
 * **Bump this filename whenever the catalogue changes after the current one has
 * been applied to production.** Supabase records a migration as applied by its
 * version prefix and never runs it again, so editing an already-applied file
 * changes the repository and nothing else — the new rows would never reach the
 * database, and the only symptom would be templates missing from the UI.
 *
 * Because the generated SQL upserts the *whole* catalogue on `(slug, version)`,
 * a new file is a complete replacement, not a delta: applying it brings a fresh
 * database and a long-running one to exactly the same state. Superseded files
 * stay on disk so an environment that has never been seeded still replays the
 * full history in order.
 *
 * | Applied to production | File |
 * | --- | --- |
 * | yes — 12 templates | `20260801093000_seed_template_library.sql` |
 * | maybe — 40 templates, pre-design-system | `20260802093000_seed_template_library_v2.sql` |
 * | not yet — 40 templates in the NPC voices | the one below |
 *
 * v3 is a new file rather than an edit of v2 because the design-system rebuild
 * changes every row, and v2's applied state is recorded in this comment rather
 * than anywhere authoritative. A new file costs one replayed upsert on a fresh
 * database and guarantees the redesign reaches one that already ran v2.
 */
const MIGRATION = resolve(REPO, 'supabase/migrations/20260803090000_seed_template_library_v3.sql');

/** Postgres string literal, dollar-quoted so JSON never has to be escaped. */
function sqlJson(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  // Pick a tag that cannot appear in the payload.
  let tag = 'tlj';
  while (json.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${json}$${tag}$::jsonb`;
}

function sqlText(value: string | null): string {
  if (value === null) return 'NULL';
  let tag = 'tlt';
  while (value.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${value}$${tag}$`;
}

function sqlTextArray(values: string[]): string {
  if (values.length === 0) return `ARRAY[]::text[]`;
  return `ARRAY[${values.map((v) => sqlText(v)).join(', ')}]::text[]`;
}

interface Problem { template: string; message: string }

function validate(template: SeedTemplate): Problem[] {
  const problems: Problem[] = [];
  const label = template.slug;

  // 1. The schema must parse against the live Zod contract, not a lookalike.
  const parsed = ReportTemplateSchema.safeParse(template.schema);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 8)) {
      problems.push({ template: label, message: `schema: ${issue.path.join('.')} — ${issue.message}` });
    }
    return problems;
  }

  // 2. Every block must be renderable by the production pipeline. A catalogue
  //    entry that cannot render is worse than no entry: it wastes the user's
  //    time before failing.
  for (const page of parsed.data.pages) {
    for (const block of page.blocks) {
      if (!PRODUCTION_SAFE_BLOCK_TYPES.has(block.type)) {
        problems.push({ template: label, message: `unsupported block type "${block.type}" on page "${page.name}"` });
      }
    }
  }

  // 3. It must pass the same gate the publish endpoint applies.
  const publishProblem = validateForPublish({
    name: template.name,
    slug: template.slug,
    schema: template.schema,
  });
  if (publishProblem) {
    problems.push({ template: label, message: `publish gate: ${publishProblem.message}` });
  }

  // 4. Pages must be non-empty — a blank page in a premium catalogue is a bug.
  parsed.data.pages.forEach((page, i) => {
    if (page.blocks.length === 0) {
      problems.push({ template: label, message: `page ${i + 1} ("${page.name}") has no blocks` });
    }
  });

  // 5. The declared `style` must be the voice the template was actually built
  //    in. The two are set in different places — `beginTemplate()` at the top
  //    of the builder, `style` in the returned metadata — and if they drift the
  //    library filters a user to "editorial" and hands back a technical layout.
  //    Comparing the compiled display face catches it at build time.
  const voice = VOICES[template.style as VoiceId];
  if (!voice) {
    problems.push({ template: label, message: `unknown style "${template.style}"` });
  } else if (!template.schema.tokens.fonts.heading.startsWith(`${voice.display},`)) {
    // Compares the leading family: the compiled value carries a generic
    // fallback ("Playfair Display, serif").
    problems.push({
      template: label,
      message: `style "${template.style}" expects the ${voice.display} voice, but the `
        + `template was built in ${template.schema.tokens.fonts.heading}`,
    });
  }

  // 6. Every running head must name this template's own category. The eyebrow
  //    is set from `beginTemplate()`'s third argument, several hundred lines
  //    from the `category` it has to agree with — during the design-system
  //    rebuild the shared market factories were briefly hard-coded to
  //    'suburb', which would have printed "Suburb market study" across a
  //    Statewide Snapshot.
  //    Scoped to `text-block`: a `cover` also carries an `eyebrow`, but that one
  //    names the specific report ("Feasibility", "Customer Due Diligence") and
  //    is deliberately not the running head.
  const expectedHead = runningHeadFor(template.category);
  for (const page of parsed.data.pages) {
    for (const block of page.blocks) {
      if (block.type !== 'text-block') continue;
      const eyebrow = (block.props as Record<string, unknown>).eyebrow;
      if (typeof eyebrow === 'string' && eyebrow !== expectedHead) {
        problems.push({
          template: label,
          message: `running head "${eyebrow}" on page "${page.name}" does not match `
            + `category "${template.category}" (expected "${expectedHead}")`,
        });
      }
    }
  }

  return problems;
}

function main(): void {
  const problems: Problem[] = [];
  const slugs = new Set<string>();

  // Drained before validation so the log holds only what building
  // SEED_TEMPLATES produced. Importing the module is what runs the builders.
  for (const o of takeOverflows()) {
    problems.push({
      template: `page "${o.page}"`,
      message: `content runs ${o.overBy}pt past the footer (ends at ${Math.round(o.bottom)}pt, `
        + 'limit 774pt) — shorten a block or move it to the next page',
    });
  }

  for (const template of SEED_TEMPLATES) {
    if (slugs.has(template.slug)) {
      problems.push({ template: template.slug, message: 'duplicate slug' });
    }
    slugs.add(template.slug);
    problems.push(...validate(template));
  }

  if (problems.length > 0) {
    console.error(`\n✖ ${problems.length} problem(s) — no migration written:\n`);
    for (const p of problems) console.error(`  ${p.template}: ${p.message}`);
    process.exit(1);
  }

  const rows = SEED_TEMPLATES.map((t) => {
    // Derived facts come from the same function the server uses, so a seeded
    // entry is indistinguishable from a promoted-and-published one.
    const facts = deriveEntryFacts({ report_type: t.reportType, schema: t.schema });
    return `  (
    ${sqlText(t.slug)}, 1, ${sqlText(t.name)}, ${sqlText(t.description)},
    ${sqlText(t.longDescription)}, ${sqlText(t.category)}, ${sqlText(t.reportType)},
    ${sqlText(t.tier ?? null)}, ${sqlTextArray(t.industry)}, ${sqlTextArray(t.tags)},
    ${sqlText(t.style)}, ${sqlText(facts.orientation)}, 'A4', ${facts.page_count},
    ${sqlJson(t.schema)}, ${sqlJson({})}, ${sqlText(t.accessTier)},
    ${sqlTextArray(facts.supported_modules)}, ${sqlTextArray(facts.required_bindings)},
    ${facts.brand_safe}, ${facts.production_ready}, ${facts.compatibility_version},
    ${sqlJson(facts.preview_schema)}
  )`;
  }).join(',\n');

  const readyCount = SEED_TEMPLATES.filter(
    (t) => deriveEntryFacts({ report_type: t.reportType, schema: t.schema }).production_ready,
  ).length;

  const sql = `-- =====================================================================
-- Template Library — seeded catalogue.
--
-- Generated by scripts/template-library/buildSeedCatalogue.ts. Do not hand-edit:
-- edit the template definitions and re-run \`npm run templates:library:seed\`,
-- which re-validates every schema against the live Zod contract and the
-- production renderer allow-list before it writes anything.
--
-- ${SEED_TEMPLATES.length} templates, of which ${readyCount} are production-ready (their report type has a
-- Template Builder adapter). The rest are browsable, previewable and copyable
-- but cannot be activated for live report generation — that limitation belongs
-- to the adapter registry, not to the library, and is surfaced on each card.
--
-- IDEMPOTENT: upserts on (slug, version). Re-running updates the seeded rows
-- and never duplicates them. Rows an operator promoted themselves are matched
-- by neither slug nor version and are therefore never touched.
-- =====================================================================

INSERT INTO public.template_library_entries (
  slug, version, name, description,
  long_description, category, report_type,
  tier, industry, tags,
  style, orientation, page_size, page_count,
  schema, config, access_tier,
  supported_modules, required_bindings,
  brand_safe, production_ready, compatibility_version,
  preview_schema
)
VALUES
${rows}
ON CONFLICT (slug, version) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  long_description = EXCLUDED.long_description,
  category = EXCLUDED.category,
  report_type = EXCLUDED.report_type,
  tier = EXCLUDED.tier,
  industry = EXCLUDED.industry,
  tags = EXCLUDED.tags,
  style = EXCLUDED.style,
  orientation = EXCLUDED.orientation,
  page_count = EXCLUDED.page_count,
  schema = EXCLUDED.schema,
  access_tier = EXCLUDED.access_tier,
  supported_modules = EXCLUDED.supported_modules,
  required_bindings = EXCLUDED.required_bindings,
  brand_safe = EXCLUDED.brand_safe,
  production_ready = EXCLUDED.production_ready,
  compatibility_version = EXCLUDED.compatibility_version,
  preview_schema = EXCLUDED.preview_schema,
  updated_at = now();

-- Publish them. Done as a separate statement so a re-run republishes anything
-- an operator archived without resurrecting their own entries.
UPDATE public.template_library_entries
SET status = 'published',
    published_at = COALESCE(published_at, now())
WHERE version = 1
  AND status = 'draft'
  AND slug IN (${SEED_TEMPLATES.map((t) => sqlText(t.slug)).join(', ')});
`;

  mkdirSync(dirname(MIGRATION), { recursive: true });
  writeFileSync(MIGRATION, sql);

  console.log(`✓ ${SEED_TEMPLATES.length} templates validated against the live schema`);
  console.log(`  ${readyCount} production-ready, ${SEED_TEMPLATES.length - readyCount} preview-only`);
  console.log(`  → ${MIGRATION.replace(REPO + '/', '')} (${(sql.length / 1024).toFixed(0)} KB)`);
}

main();
