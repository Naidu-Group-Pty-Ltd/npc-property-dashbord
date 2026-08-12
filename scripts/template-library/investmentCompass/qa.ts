/**
 * Investment Compass — render QA.
 *
 * ## Why this exists on top of the spec suite
 *
 * `investmentCompassCatalogue.spec.ts` proves the templates parse, render and
 * carry their colourways. It cannot prove they FIT: `flow()`'s overflow guard
 * is arithmetic over the heights the authoring helpers declare, and a declared
 * height is a guess about how tall a paragraph of bound text will set. The only
 * honest measure of whether a block runs past the footer is to lay the document
 * out and look at the boxes.
 *
 * So this opens each rendered document in Chromium at A4, measures every
 * block's real bounding box against its page, and reports anything that
 * overflows. It also prints a PDF through the browser's own print pipeline and
 * screenshots the pages a reviewer would want to see.
 *
 * This is not a substitute for a WeasyPrint render — that engine is what
 * production uses, and it paginates differently. It is the check that catches
 * the class of defect the arithmetic cannot: text that is taller than the
 * author thought.
 *
 * Run:  npm run templates:compass:qa
 * Output: artifacts under `audit-output/investment-compass/`.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { renderTemplateToHtml } from '../../../src/lib/reportTemplate/htmlRenderer';
import { SAMPLE_REPORT_DATA } from '../../../src/lib/templateLibrary/sampleReportData';
import {
  colourwaysForFamily,
  colourwayTokenOverride,
} from '../../../supabase/functions/_shared/templateColourways.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from './templates';
import { BORROWING_CAPACITY_TEMPLATES } from './borrowingCapacity';

import { DESIGN_FAMILIES } from './family';

/**
 * Every family master, across every report format.
 *
 * The overflow measurement is the reason this exists, and it is format-blind:
 * a Borrowing Capacity income table can run past the footer exactly as an
 * investment cash-flow table can, and neither is visible from the schema.
 */
const ALL_MASTERS = [...INVESTMENT_COMPASS_TEMPLATES, ...BORROWING_CAPACITY_TEMPLATES];


const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../..');
const OUT = resolve(REPO, 'audit-output/investment-compass');

/** A4 in CSS pixels at 96dpi, which is how the browser lays out a `pt` page. */
const A4_PX = { width: 794, height: 1123 };

/** Points of slack before a box counts as overflowing. */
const TOLERANCE_PT = 2;

interface Overflow {
  template: string;
  colourway: string;
  page: number;
  pageName: string;
  block: string;
  overBy: number;
}

interface Report {
  templates: number;
  colourways: number;
  combinations: number;
  rendered: number;
  overflows: Overflow[];
  pdf: Array<{ template: string; pages: number; bytes: number }>;
  screenshots: string[];
}

/**
 * Measure every block against the page that contains it.
 *
 * Blocks are absolutely positioned, so a page's own scroll height says nothing
 * — an overflowing block is clipped by `overflow:hidden` and the page stays
 * exactly 842pt tall. The only way to see it is to compare each block's bottom
 * against the page box.
 */
async function measureOverflows(
  page: Page,
  templateName: string,
  colourwayName: string,
  pageNames: string[],
): Promise<Overflow[]> {
  const raw = await page.evaluate(({ tolerance }) => {
    const results: Array<{ page: number; block: string; overBy: number }> = [];
    const pages = Array.from(document.querySelectorAll('.tpl-page'));
    pages.forEach((pageEl, pageIndex) => {
      const pageBox = pageEl.getBoundingClientRect();
      // Direct children only: a block's own internals are its business, and a
      // table cell taller than its row is not a page overflow.
      Array.from(pageEl.children).forEach((child) => {
        const box = (child as HTMLElement).getBoundingClientRect();
        if (box.height === 0 && box.width === 0) return;
        const overBy = box.bottom - pageBox.bottom;
        if (overBy > tolerance) {
          const el = child as HTMLElement;
          const label = el.getAttribute('data-block-id')
            ?? el.className
            ?? el.tagName.toLowerCase();
          results.push({ page: pageIndex, block: String(label).slice(0, 80), overBy });
        }
      });
    });
    return results;
  }, { tolerance: (TOLERANCE_PT * 96) / 72 });

  return raw.map((r) => ({
    template: templateName,
    colourway: colourwayName,
    page: r.page + 1,
    pageName: pageNames[r.page] ?? `Page ${r.page + 1}`,
    // Back to points, which is the unit the templates are authored in.
    overBy: Math.round((r.overBy * 72) / 96),
    block: r.block,
  }));
}

async function open(browser: Browser, html: string): Promise<Page> {
  const page = await browser.newPage({ viewport: A4_PX });
  await page.setContent(html, { waitUntil: 'networkidle' });
  // Webfonts decide how tall text is. Measuring before they land would measure
  // the fallback and pass templates that overflow in the face they ship in.
  await page.evaluate(() => (document as any).fonts?.ready);
  return page;
}

/**
 * Find a Chromium this machine already has.
 *
 * Playwright resolves its browser by the build number its own version pins, so
 * a CI image carrying a different build fails with "Executable doesn't exist"
 * and a suggestion to download one. Downloading a second Chromium to render
 * five templates is not a reasonable thing for this script to do, and on a
 * sandboxed runner it will not work anyway. So: use whatever full Chromium is
 * present under `PLAYWRIGHT_BROWSERS_PATH`, and fall back to Playwright's own
 * resolution when there is nothing there.
 *
 * The full browser is preferred over `chrome-headless-shell` because the shell
 * build cannot print a PDF, which is half of what this script is for.
 */
function findChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const candidates = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort()
    .reverse()
    .map((name) => resolve(root, name, 'chrome-linux/chrome'))
    .filter((path) => existsSync(path));
  return candidates[0];
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const executablePath = findChromium();
  if (executablePath) console.log(`  using ${executablePath}`);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const report: Report = {
    templates: ALL_MASTERS.length,
    colourways: 10,
    combinations: INVESTMENT_COMPASS_TEMPLATES.length * 10,
    rendered: 0,
    overflows: [],
    pdf: [],
    screenshots: [],
  };

  /**
   * Overflow is measured once per template, in its default colourway.
   *
   * A colourway cannot change how tall a paragraph sets — and
   * `investmentCompassCatalogue.spec.ts` proves it, asserting that every
   * block's geometry is byte-identical across a family's ten palettes. So five
   * hundred browser renders would measure the same fifty layouts ten times
   * each, for about ninety minutes of wall clock and no additional coverage.
   *
   * The dark spot-check below is a different question — whether a reverse
   * ground still reads — and is answered by eye, one per family.
   */
  for (const template of ALL_MASTERS) {
    const pageNames = template.schema.pages.map((p) => p.name);
    // Variant codes repeat across formats — `pb-01` exists in both catalogues —
    // so an artifact named by code alone has one format silently overwrite the
    // other's. The first run of this after Borrowing Capacity landed reported 20
    // PDFs and left 10 on disk.
    const code = `${template.designMeta.reportFormat}-${template.designMeta.templateCode}`;
    const family = template.designMeta.familyKey;
    const colourways = colourwaysForFamily(family);
    const dflt = colourways.find((c) => c.id === template.designMeta.defaultColourway)
      ?? colourways[0];

    const { html } = renderTemplateToHtml(template.schema, {
      data: SAMPLE_REPORT_DATA,
      tokenOverrides: colourwayTokenOverride(dflt),
    });
    const page = await open(browser, html);
    report.rendered += 1;

    /**
     * Every index below is a schema index used against a rendered page.
     *
     * Those are the same list only while nothing is filtered out, and image
     * plates are conditional pages — so a template whose plates went unbound
     * would silently shift the dashboard screenshot and mislabel every overflow
     * after the first plate. `SAMPLE_REPORT_DATA` carries a photograph for
     * every slot in the catalogue, so they should match; if they ever stop
     * matching, that is the QA lying rather than a template failing, and it
     * should stop rather than report.
     */
    const renderedPages = await page.locator('.tpl-page').count();
    if (renderedPages !== pageNames.length) {
      throw new Error(
        `${template.name}: rendered ${renderedPages} pages against ${pageNames.length} in the schema — `
        + 'a conditional page was filtered out and the sample data no longer covers every slot',
      );
    }

    report.overflows.push(
      ...await measureOverflows(page, template.name, dflt.name, pageNames),
    );

    // A cover and a dashboard for every master — the cover is what the library
    // card shows, and the dashboard is where the KPI arrangement lives, which
    // is the axis the five masters in a family most visibly differ on.
    const cover = resolve(OUT, `${code}-cover.png`);
    await page.locator('.tpl-page').first().screenshot({ path: cover });
    report.screenshots.push(cover.replace(`${REPO}/`, ''));

    // The densest page, whatever the format calls it. Hardcoding 'Executive
    // dashboard' meant the Borrowing Capacity masters — whose equivalent is
    // 'Capacity summary' — were screenshotted as covers only.
    const dashboardIndex = template.schema.pages.findIndex(
      (p) => p.name === 'Executive dashboard' || p.name === 'Capacity summary',
    );
    if (dashboardIndex >= 0) {
      const dashboard = resolve(OUT, `${code}-dashboard.png`);
      await page.locator('.tpl-page').nth(dashboardIndex).screenshot({ path: dashboard });
      report.screenshots.push(dashboard.replace(`${REPO}/`, ''));
    }

    // A plate, for the two families that carry photographs. It is the page a
    // reviewer most needs to see, because it is the only one whose content an
    // operator supplies — and the one that has to disappear cleanly when they
    // do not. Index 0 is skipped: the cover's plate is a ground behind a
    // composition rather than a plate page.
    const plateIndex = template.schema.pages.findIndex(
      (p, i) => i > 0 && JSON.stringify(p.blocks).includes('property.images'),
    );
    if (plateIndex >= 0) {
      const plate = resolve(OUT, `${code}-plate.png`);
      await page.locator('.tpl-page').nth(plateIndex).screenshot({ path: plate });
      report.screenshots.push(plate.replace(`${REPO}/`, ''));
    }

    // One PDF per family reference — fifty is a lot of artefact for a reviewer,
    // and the reference is the variant the Design source actually drew.
    if (template.designMeta.isFamilyReference) {
      const pdfPath = resolve(OUT, `${code}.pdf`);
      const bytes = await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        // The template already carries its own page geometry; a browser margin
        // on top would shrink every page and invalidate the measure.
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      report.pdf.push({
        template: `${template.designMeta.familyName} — ${template.name}`,
        pages: template.schema.pages.length,
        bytes: bytes.length,
      });
    }

    await page.close();
  }

  // ── Dark-ground spot check, one per family ───────────────────────────────
  for (const family of DESIGN_FAMILIES) {
    const template = INVESTMENT_COMPASS_TEMPLATES.find(
      (t) => t.designMeta.familyKey === family.key && t.designMeta.isFamilyReference,
    );
    const dark = colourwaysForFamily(family.key).find((c) => c.ground === 'dark');
    if (!template || !dark) continue;

    const { html } = renderTemplateToHtml(template.schema, {
      data: SAMPLE_REPORT_DATA,
      tokenOverrides: colourwayTokenOverride(dark),
    });
    const page = await open(browser, html);
    report.rendered += 1;
    report.overflows.push(
      ...await measureOverflows(page, template.name, dark.name, template.schema.pages.map((p) => p.name)),
    );
    const shot = resolve(OUT, `${template.designMeta.templateCode}-dark.png`);
    const dashboardIndex = template.schema.pages.findIndex((p) => p.name === 'Executive dashboard');
    await page.locator('.tpl-page').nth(Math.max(0, dashboardIndex)).screenshot({ path: shot });
    report.screenshots.push(shot.replace(`${REPO}/`, ''));
    await page.close();
  }

  await browser.close();

  writeFileSync(resolve(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));

  console.log(`\nInvestment Compass — render QA`);
  console.log(`  ${report.templates} templates, ${report.combinations} declared combinations`);
  console.log(`  ${report.rendered} browser renders (one per master + one dark per family)`);
  console.log(`  ${report.pdf.length} PDFs, ${report.screenshots.length} screenshots → audit-output/investment-compass/`);
  for (const p of report.pdf) {
    console.log(`    ${p.template}: ${p.pages} pages, ${(p.bytes / 1024).toFixed(0)} KB`);
  }

  if (report.overflows.length > 0) {
    console.error(`\n✖ ${report.overflows.length} block(s) run past their page:\n`);
    for (const o of report.overflows.slice(0, 60)) {
      console.error(`  ${o.template} / ${o.colourway} / p${o.page} "${o.pageName}": ${o.overBy}pt — ${o.block}`);
    }
    process.exit(1);
  }
  console.log(`\n✓ no block overflows its page in any of the ${report.rendered} renders`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
