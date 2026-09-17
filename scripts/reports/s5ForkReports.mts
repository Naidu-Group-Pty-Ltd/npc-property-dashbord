/**
 * S5 — the Financial and Due Diligence reports, produced and drawn.
 *
 *   npx tsx scripts/reports/s5ForkReports.mts
 *
 * Two of the five client reports come out of `fork-investment-report`, and
 * until `forkSplit.pure.ts` existed neither could be produced outside a
 * deployed Deno runtime — so neither had ever been drawn as a document and
 * read. They need no model call: the composite's own sections are routed
 * through the split registry and the financial chapters are typed from the
 * recorded calculation.
 *
 * This runs the real composition for both subjects, builds the row each fork
 * would persist (the parent's record with the variant's content and tier, as
 * `upsertFork` writes it), and draws each through the supported template path
 * — `compileTemplateHtmlForPdf` then WeasyPrint on the six options the route
 * sends.
 *
 * The registry is the code default, which IS production's: `report_engine_config`
 * holds no overlay for `split_routes`, `split_metadata`,
 * `split_section_order_fin` or `split_section_order_pldd` (measured 17 Sep 2026).
 *
 * `reports/fixtures/*-row.json` is read from production and `reports/` is
 * git-ignored, so a fresh checkout has to fetch them first.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { compileTemplateHtmlForPdf } from '../../src/lib/reportTemplate/compileTemplateForPdf';
import { composeForkDocuments } from '../../supabase/functions/_shared/reports/investment/forkSplit.pure';
import { loadSplitRegistry } from '../../supabase/functions/_shared/reportSplitRegistry';
import { applyInvestmentProjection } from '../../supabase/functions/_shared/reportBindingProjection.pure';
import { applyOrganisationProjection } from '../../supabase/functions/_shared/organisationProjection.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../template-library/investmentCompass/templates';

const REPO = resolve(import.meta.dirname, '../..');
const read = (p: string) => {
  try {
    return JSON.parse(readFileSync(resolve(REPO, p), 'utf8'));
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
    throw new Error(`${p} is not present. It is read from production and \`reports/\` is git-ignored.`);
  }
};

/** A client that answers nothing, so the registry resolves to its code defaults. */
const NO_OVERLAY = { from: () => ({ select: () => ({ in: async () => ({ data: null }) }) }) } as never;
/** Fixed, so a document produced twice is the same document. */
const GENERATED_ON = '2026-09-17';

const MARK = readFileSync(resolve(REPO, 'reports/fixtures/mark-monogram.txt'), 'utf8').trim();
const SETTINGS = read('reports/fixtures/report-settings.meta.json');
const ORG = { company_name: 'Naidu Property Consulting Services' };
const flat = (o: unknown) => (o && typeof o === 'object' ? { ...(o as object) } : {});

const template = INVESTMENT_COMPASS_TEMPLATES.find(
  (t) => String((t as never as { slug?: string }).slug ?? '').includes('-pb-01-'),
)! as never as { name: string; slug?: string; schema: unknown };

mkdirSync(resolve(REPO, 'reports/html'), { recursive: true });
mkdirSync(resolve(REPO, 'reports/pdf'), { recursive: true });

const registry = await loadSplitRegistry(NO_OVERLAY);
console.log(`split registry: ${JSON.stringify(registry.source)}\n`);

interface Drawn { key: string; tier: string; sections: number; chars: number; pages: string; }
const drawn: Drawn[] = [];

for (const subject of ['annabelle', 'pallas']) {
  const parent = read(`reports/fixtures/${subject}-row.json`);
  const docs = composeForkDocuments({
    registry,
    parentContent: parent.report_content || '',
    propertyAddress: parent.property_address,
    financialCalculations: parent.financial_calculations,
    // The fork scores each variant separately; the parent's own score is what
    // the composed chapters read, and re-scoring here would be a different
    // question from "does the document draw".
    financialScore: parent.investment_score,
    composeFinancial: true,
    generatedOn: GENERATED_ON,
  });

  console.log(`${parent.property_address}`);
  console.log(`  composite: ${docs.compositeSections} sections`);
  console.log(`  composed chapters: ${docs.composedChapters.length}`);
  if (docs.replacedByComposedChapters.length) {
    console.log(`  routed prose replaced by the record: ${docs.replacedByComposedChapters.join('; ')}`);
  }

  for (const [key, out, tier] of [
    ['financial', docs.financial, 'financial'],
    ['strategic', docs.dueDiligence, 'strategic'],
  ] as const) {
    // The row the fork would persist: the parent's record, the variant's
    // content and tier. `upsertFork` writes exactly these.
    const row = {
      ...parent,
      report_content: out.markdown,
      report_tier: tier,
      report_variant: tier,
      derived_from_report_id: parent.id,
      parent_report_id: parent.id,
    };
    const data: Record<string, any> = {
      report: { id: row.id, type: 'investment', generated_at: row.updated_at },
      property: flat(row.property_specs),
      financials: flat(row.financial_calculations),
      scores: flat(row.investment_score),
      brand: { tokens: {}, logo: null },
    };
    applyInvestmentProjection(data, row);
    applyOrganisationProjection(data, ORG as never, { mark: MARK, markMono: MARK }, SETTINGS as never);
    data.narrative = { ...(data.narrative ?? {}), source: out.markdown };

    const name = `s5-${subject}-${key}`;
    const compiled = await compileTemplateHtmlForPdf(template.schema as never, { data });
    const htmlPath = resolve(REPO, `reports/html/${name}.html`);
    const pdfPath = resolve(REPO, `reports/pdf/${name}.pdf`);
    writeFileSync(htmlPath, compiled.html);
    const render = execFileSync('python3', [resolve(REPO, 'scripts/reports/renderWeasy.py'), htmlPath, pdfPath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const warnings = render.split('\n').filter((l) => l.startsWith('warning\t'));
    const pages = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' }).match(/^Pages:\s+(\d+)/m)?.[1] ?? '—';
    console.log(
      `  ${key.padEnd(10)} ${String(out.sections).padStart(2)} sections  `
      + `${String(out.markdown.length).padStart(6)} chars  ${String(pages).padStart(3)} pages  `
      + `hygiene: ${out.editorialBlocksRemoved} editorial, ${out.placeholderRowsRemoved} placeholder rows, `
      + `${out.emptyStatCardsRemoved} empty cards, ${out.duplicateDirectivesRemoved} duplicate figures`
      + (warnings.length > 2 ? `  · ${warnings.length} engine warnings` : ''),
    );
    drawn.push({ key: name, tier, sections: out.sections, chars: out.markdown.length, pages });
  }
  console.log('');
}

console.log(`${drawn.length} documents drawn · reports/pdf/s5-*.pdf`);
