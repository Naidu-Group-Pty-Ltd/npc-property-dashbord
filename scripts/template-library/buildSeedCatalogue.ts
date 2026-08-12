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
 *
 * ## Two authoring systems, one catalogue
 *
 * `SEED_TEMPLATES` are the forty *voice* templates — built from the five studio
 * voices keyed to the catalogue's `style` axis. `INVESTMENT_COMPASS_TEMPLATES`
 * are the *family* templates, built from the approved Claude Design Investment
 * Compass catalogue's manifest model. Both compile to the same
 * `ReportTemplate` schema and pass the same gates; only their authoring
 * vocabulary differs, and each gets the design-consistency check that suits it.
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
import { takeCompassOverflows } from './investmentCompass/blocks';
import { INVESTMENT_COMPASS_TEMPLATES } from './investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from './investmentCompass/borrowingCapacity';
import type { CompassSeedTemplate } from './investmentCompass/master';

/**
 * Every family master, across every report format.
 *
 * The ten designs are format-agnostic, so each format contributes its own page
 * sequence and shares the shell (`master.ts`). Adding a format here is what
 * makes its masters validated, deduplicated and seeded with the rest.
 */
const FAMILY_TEMPLATES: CompassSeedTemplate[] = [
  ...INVESTMENT_COMPASS_TEMPLATES,
  ...BORROWING_CAPACITY_TEMPLATES,
];
import { typographyFor } from './investmentCompass/family';
import {
  colourwaysForFamily,
} from '../../supabase/functions/_shared/templateColourways.pure';

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
 * stay on disk, so an environment that has never been seeded still replays the
 * full history in order.
 *
 * | Applied to production | File |
 * | --- | --- |
 * | yes — 12 templates | `20260801093000_seed_template_library.sql` |
 * | maybe — 40 templates, pre-design-system | `20260802093000_seed_template_library_v2.sql` |
 * | maybe — 40 templates in the NPC voices | `20260803090000_seed_template_library_v3.sql` |
 * | not yet — v3 plus the 5 Private Banking masters | the one below |
 *
 * v4 is a new file rather than an edit of v3 because it adds rows and writes a
 * column (`design_meta`) that v3 did not know about.
 */
const MIGRATION = resolve(
  REPO,
  'supabase/migrations/20260811120000_seed_template_library_v4_investment_compass.sql',
);

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

/** Anything the migration can emit a row for. */
type CatalogueTemplate = SeedTemplate | CompassSeedTemplate;

function isCompass(t: CatalogueTemplate): t is CompassSeedTemplate {
  return 'designMeta' in t;
}

/** Checks every catalogue entry must pass, whichever system authored it. */
function validateCommon(template: CatalogueTemplate): Problem[] {
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

  return problems;
}

/** Checks specific to the voice system. */
function validateVoice(template: SeedTemplate): Problem[] {
  const problems: Problem[] = [];
  const label = template.slug;
  const parsed = ReportTemplateSchema.safeParse(template.schema);
  if (!parsed.success) return problems;

  // 5. The declared `style` must be the voice the template was actually built
  //    in. The two are set in different places — `beginTemplate()` at the top
  //    of the builder, `style` in the returned metadata — and if they drift the
  //    library filters a user to "editorial" and hands back a technical layout.
  //    Comparing the compiled display face catches it at build time.
  const voice = VOICES[template.style as VoiceId];
  if (!voice) {
    problems.push({ template: label, message: `unknown style "${template.style}"` });
  } else if (!template.schema.tokens.fonts.heading.startsWith(`${voice.display},`)) {
    problems.push({
      template: label,
      message: `style "${template.style}" expects the ${voice.display} voice, but the `
        + `template was built in ${template.schema.tokens.fonts.heading}`,
    });
  }

  // 6. Every running head must name this template's own category. The eyebrow
  //    is set from `beginTemplate()`'s third argument, several hundred lines
  //    from the `category` it has to agree with.
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

/**
 * Checks specific to the family system.
 *
 * The voice system's running-head rule deliberately does NOT apply here. Under
 * the approved Investment Compass catalogue a section eyebrow names the
 * *section* ("The verdict", "Projections", "Risk register") and the document is
 * named by the running head across the top of the page — `section_header_style:
 * eyebrow_rule_display` is exactly that arrangement. Asserting the voice rule
 * would reject every one of these templates for following its own spec.
 *
 * What replaces it is stricter in the way that matters: the compiled type must
 * be the family's, the declared density must be the manifest's, and every
 * colourway the entry offers must exist in that family's curated set.
 */
function validateCompass(template: CompassSeedTemplate): Problem[] {
  const problems: Problem[] = [];
  const label = template.slug;
  const meta = template.designMeta;

  const type = typographyFor(meta.familyKey);
  const fonts = template.schema.tokens.fonts as Record<string, string> | undefined;
  const expected: Array<[string, string]> = [
    ['display', type.display],
    ['heading', type.heading],
    ['body', type.body],
    ['mono', type.mono],
  ];
  for (const [role, face] of expected) {
    if (!fonts?.[role]?.startsWith(`${face},`)) {
      problems.push({
        template: label,
        message: `family "${meta.familyKey}" sets ${face} for ${role}, `
          + `but the template compiled ${fonts?.[role]}`,
      });
    }
  }

  // Every face the template NAMES must also be loadable, or WeasyPrint renders
  // the engine default and nothing says so.
  const faces = (template.schema.tokens as Record<string, unknown>).fontFaces as
    Array<{ family: string; cssUrl: string }> | undefined;
  const loaded = new Set((faces ?? []).map((f) => f.family));
  for (const [, face] of expected) {
    if (!loaded.has(face)) {
      problems.push({ template: label, message: `names ${face} but does not load it` });
    }
  }

  // The manifest is the design decision; the metadata the library filters on
  // has to agree with it, or a user filtering to "compact" gets a spacious page.
  if (meta.density !== meta.manifest.density) {
    problems.push({
      template: label,
      message: `density "${meta.density}" disagrees with the resolved manifest `
        + `("${meta.manifest.density}")`,
    });
  }

  const known = new Set(colourwaysForFamily(meta.familyKey).map((c) => c.id));
  if (known.size === 0) {
    problems.push({ template: label, message: `no colourways registered for family "${meta.familyKey}"` });
  }
  for (const id of meta.colourways) {
    if (!known.has(id)) {
      problems.push({ template: label, message: `unknown colourway "${id}"` });
    }
  }
  if (!known.has(meta.defaultColourway)) {
    problems.push({
      template: label,
      message: `default colourway "${meta.defaultColourway}" is not in the family's set`,
    });
  }

  return problems;
}

/** The row values shared by both systems. */
function rowFor(t: CatalogueTemplate): string {
  const facts = deriveEntryFacts({ report_type: t.reportType, schema: t.schema });
  const designMeta = isCompass(t) ? t.designMeta : {};
  return `  (
    ${sqlText(t.slug)}, 1, ${sqlText(t.name)}, ${sqlText(t.description)},
    ${sqlText(t.longDescription)}, ${sqlText(t.category)}, ${sqlText(t.reportType)},
    ${sqlText(t.tier ?? null)}, ${sqlTextArray(t.industry)}, ${sqlTextArray(t.tags)},
    ${sqlText(t.style)}, ${sqlText(facts.orientation)}, 'A4', ${facts.page_count},
    ${sqlJson(t.schema)}, ${sqlJson({})}, ${sqlText(t.accessTier)},
    ${sqlTextArray(facts.supported_modules)}, ${sqlTextArray(facts.required_bindings)},
    ${facts.brand_safe}, ${facts.production_ready}, ${facts.compatibility_version},
    ${sqlJson(facts.preview_schema)}, ${sqlJson(designMeta)}
  )`;
}

function main(): void {
  const problems: Problem[] = [];
  const slugs = new Set<string>();

  // Drained before validation so the log holds only what building the
  // catalogues produced. Importing the modules is what runs the builders.
  for (const o of takeOverflows()) {
    problems.push({
      template: `page "${o.page}"`,
      message: `content runs ${o.overBy}pt past the footer (ends at ${Math.round(o.bottom)}pt, `
        + 'limit 774pt) — shorten a block or move it to the next page',
    });
  }
  for (const o of takeCompassOverflows()) {
    problems.push({
      template: `${o.template} page "${o.page}"`,
      message: `content runs ${o.overBy}pt past the footer (ends at ${Math.round(o.bottom)}pt) `
        + '— shorten a block or move it to the next page',
    });
  }

  const all: CatalogueTemplate[] = [...SEED_TEMPLATES, ...FAMILY_TEMPLATES];

  for (const template of all) {
    if (slugs.has(template.slug)) {
      problems.push({ template: template.slug, message: 'duplicate slug' });
    }
    slugs.add(template.slug);
    problems.push(...validateCommon(template));
    problems.push(...(isCompass(template)
      ? validateCompass(template)
      : validateVoice(template)));
  }

  if (problems.length > 0) {
    console.error(`\n✖ ${problems.length} problem(s) — no migration written:\n`);
    for (const p of problems) console.error(`  ${p.template}: ${p.message}`);
    process.exit(1);
  }

  const rows = all.map(rowFor).join(',\n');

  const readyCount = all.filter(
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
-- ${all.length} templates, of which ${readyCount} are production-ready (their report type has a
-- Template Builder adapter). The rest are browsable, previewable and copyable
-- but cannot be activated for live report generation — that limitation belongs
-- to the adapter registry, not to the library, and is surfaced on each card.
--
-- ${FAMILY_TEMPLATES.length} of them are design-family masters (${INVESTMENT_COMPASS_TEMPLATES.length} Investment Compass,
-- ${BORROWING_CAPACITY_TEMPLATES.length} Borrowing Capacity), which additionally carry
-- \`design_meta\` (family, variant axis, density, resolved manifest, colourway
-- set). Requires 20260811110000_template_library_design_meta.sql.
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
  preview_schema, design_meta
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
  design_meta = EXCLUDED.design_meta,
  updated_at = now();

-- Publish them. Done as a separate statement so a re-run republishes anything
-- an operator archived without resurrecting their own entries.
UPDATE public.template_library_entries
SET status = 'published',
    published_at = COALESCE(published_at, now())
WHERE version = 1
  AND status = 'draft'
  AND slug IN (${all.map((t) => sqlText(t.slug)).join(', ')});
`;

  mkdirSync(dirname(MIGRATION), { recursive: true });
  writeFileSync(MIGRATION, sql);

  console.log(`✓ ${all.length} templates validated against the live schema`);
  console.log(
    `  ${SEED_TEMPLATES.length} voice, ${INVESTMENT_COMPASS_TEMPLATES.length} Investment Compass, `
    + `${BORROWING_CAPACITY_TEMPLATES.length} Borrowing Capacity`,
  );
  console.log(`  ${readyCount} production-ready, ${all.length - readyCount} preview-only`);
  console.log(`  → ${MIGRATION.replace(REPO + '/', '')} (${(sql.length / 1024).toFixed(0)} KB)`);
}

main();
