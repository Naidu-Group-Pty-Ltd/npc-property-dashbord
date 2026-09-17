/**
 * S5 — the Executive Briefing and the Snapshot, produced and drawn.
 *
 *   npx tsx scripts/reports/s5CondenseReports.mts
 *
 * The last two of the five client reports. They come out of
 * `condense-investment-report`, which makes ONE model call and then runs a
 * long deterministic composition over the answer — and until
 * `condenseCompose.pure.ts` existed that composition could not run outside a
 * deployed Deno runtime, so neither document had ever been drawn as a
 * document and read.
 *
 * This runs the real composition for both subjects, builds the row the
 * function would persist (`report_tier`, `report_variant`, both linkage
 * columns, the parent's record copied across — exactly the insert at
 * `condense-investment-report/index.ts:463`), and draws each through the
 * supported template path: `compileTemplateHtmlForPdf` then WeasyPrint on the
 * six options the production route sends.
 *
 * ## The one stand-in, named
 *
 * The model call is stood in for by `_condenseStandIn.mts`, which excerpts the
 * parent's own blocks whole. Read that file's header for why that is a fair
 * substitute and what it refuses to do — the short version is that it copies
 * and never composes, so it cannot invent a figure, which is the one failure
 * that would make a finding here ambiguous.
 *
 * Everything downstream of the model call is the production implementation,
 * unmodified: the recorded-facts block, the composed financial chapters, the
 * score breakdown, the SWOT, the verdict, the registry trim, the
 * declared-order assembly and all five hygiene passes.
 *
 * `runQAValidation` is run here exactly as the handler runs it, against the
 * same recorded score set, because a document nobody validated is not the
 * document production ships.
 *
 * `reports/fixtures/*-row.json` is read from production and `reports/` is
 * git-ignored, so a fresh checkout has to fetch them first.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { compileTemplateHtmlForPdf } from '../../src/lib/reportTemplate/compileTemplateForPdf';
import {
  composeCondensedDocument, type CondensedTier,
} from '../../supabase/functions/_shared/reports/investment/condenseCompose.pure';
import { runQAValidation } from '../../supabase/functions/_shared/compassQAValidator';
import { applyInvestmentProjection } from '../../supabase/functions/_shared/reportBindingProjection.pure';
import { applyOrganisationProjection } from '../../supabase/functions/_shared/organisationProjection.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../template-library/investmentCompass/templates';
import { STAND_IN_NOTE, condenseStandIn } from './_condenseStandIn.mts';

const REPO = resolve(import.meta.dirname, '../..');
const read = (p: string) => {
  try {
    return JSON.parse(readFileSync(resolve(REPO, p), 'utf8'));
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
    throw new Error(`${p} is not present. It is read from production and \`reports/\` is git-ignored.`);
  }
};

const MARK = readFileSync(resolve(REPO, 'reports/fixtures/mark-monogram.txt'), 'utf8').trim();
const SETTINGS = read('reports/fixtures/report-settings.meta.json');
const ORG = { company_name: 'Naidu Property Consulting Services' };
const flat = (o: unknown) => (o && typeof o === 'object' ? { ...(o as object) } : {});

const template = INVESTMENT_COMPASS_TEMPLATES.find(
  (t) => String((t as never as { slug?: string }).slug ?? '').includes('-pb-01-'),
)! as never as { name: string; slug?: string; schema: unknown };

mkdirSync(resolve(REPO, 'reports/html'), { recursive: true });
mkdirSync(resolve(REPO, 'reports/pdf'), { recursive: true });

console.log(`STAND-IN: ${STAND_IN_NOTE}\n`);

const headingsOf = (md: string) => [...md.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);

interface Drawn { key: string; tier: string; sections: number; chars: number; pages: string; }
const drawn: Drawn[] = [];

for (const subject of ['annabelle', 'pallas']) {
  const parent = read(`reports/fixtures/${subject}-row.json`);
  console.log(`${parent.property_address}`);
  console.log(`  parent: ${String(parent.report_content ?? '').length} chars, `
    + `${headingsOf(parent.report_content ?? '').length} H2 sections`);

  for (const tier of ['briefing', 'snapshot'] as CondensedTier[]) {
    const standIn = condenseStandIn(String(parent.report_content ?? ''), tier);
    const composed = composeCondensedDocument({
      tier,
      modelMarkdown: standIn.markdown,
      investmentScore: parent.investment_score,
      financialCalculations: parent.financial_calculations,
      parentContent: typeof parent.report_content === 'string' ? parent.report_content : undefined,
    });
    const qa = runQAValidation(composed.markdown, 'compass-40', { recordedScores: composed.recordedScores });

    // The row the function would persist: the parent's record, the tier's
    // content, both linkage columns.
    const row = {
      ...parent,
      report_content: composed.markdown,
      report_tier: tier,
      report_variant: tier,
      parent_report_id: parent.id,
      derived_from_report_id: parent.id,
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
    data.narrative = { ...(data.narrative ?? {}), source: composed.markdown };

    const name = `s5-${subject}-${tier}`;
    const compiled = await compileTemplateHtmlForPdf(template.schema as never, { data });
    const htmlPath = resolve(REPO, `reports/html/${name}.html`);
    const pdfPath = resolve(REPO, `reports/pdf/${name}.pdf`);
    writeFileSync(htmlPath, compiled.html);
    writeFileSync(resolve(REPO, `reports/html/${name}.md`), composed.markdown);
    const render = execFileSync('python3', [resolve(REPO, 'scripts/reports/renderWeasy.py'), htmlPath, pdfPath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const warnings = render.split('\n').filter((l) => l.startsWith('warning\t'));
    const pages = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' }).match(/^Pages:\s+(\d+)/m)?.[1] ?? '—';
    const sections = headingsOf(composed.markdown);

    console.log(`  ${tier}`);
    console.log(`    stand-in   ${String(standIn.markdown.length).padStart(6)} chars, `
      + `${standIn.trace.length} of ${standIn.trace.length + standIn.omitted.length} declared headings filled`
      + (standIn.omitted.length ? `; omitted (nothing in the parent to copy): ${standIn.omitted.join(', ')}` : ''));
    for (const t of standIn.trace) console.log(`      ${t.heading.padEnd(22)} ← ${t.from.join(' + ')}`);
    console.log(`    composed   ${String(composed.markdown.length).padStart(6)} chars, ${sections.length} sections`);
    console.log(`      ${sections.join(' · ')}`);
    console.log(`    hygiene    ${JSON.stringify(composed.hygiene)}`);
    if (composed.postProcessReport) {
      console.log(`    postproc   ${JSON.stringify(composed.postProcessReport)}`);
    }
    console.log(`    QA         ${JSON.stringify(qa)}`);
    console.log(`    drawn      ${String(pages).padStart(3)} pages`
      + (warnings.length > 2 ? `  · ${warnings.length} engine warnings` : ''));
    drawn.push({ key: name, tier, sections: sections.length, chars: composed.markdown.length, pages });
  }
  console.log('');
}

console.log(`${drawn.length} documents drawn · reports/pdf/s5-*.pdf`);
