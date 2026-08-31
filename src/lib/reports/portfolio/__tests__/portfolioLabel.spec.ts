/**
 * Audit item 11 — one report, three names.
 *
 *   Client portal → Request a report     "Portfolio Performance Review"
 *   Clients → a client → Reports         "Portfolio Analysis"
 *   Clients → a client → Sent Reports    "Portfolio Review"
 *
 * `PortalReports.tsx` managed two of the three by itself, in adjacent maps —
 * which is what a literal repeated at fourteen call sites does. The name is
 * imported now, and this fails any UI file that spells a variant.
 *
 * The scan is deliberately over the RENDERED source: comments may still say
 * "Portfolio Performance Review" — several must, to record what changed and
 * why — and the document's own title legitimately keeps it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PORTFOLIO_REPORT_LABEL } from '../label';

const root = join(__dirname, '..', '..', '..', '..', '..');

/** Every UI surface that names this report. */
const SURFACES = [
  'src/components/clients/ClientReportRequestsTab.tsx',
  'src/components/clients/ClientSentReportsTab.tsx',
  'src/components/clients/ClientReportsTab.tsx',
  'src/components/clients/PortfolioAnalysisReportsList.tsx',
  'src/components/clients/PortfolioReportDownloadButton.tsx',
  'src/components/clients/FollowUpFlag.tsx',
  'src/components/clients/ClientReminders.tsx',
  'src/components/clients/review-wizard/index.tsx',
  'src/components/portal/PortalRequestReportForm.tsx',
  'src/pages/ReportRequests.tsx',
  'src/pages/portal/PortalReports.tsx',
];

/** Source with prose removed — the assertions are about what is drawn. */
function code(relative: string): string {
  return readFileSync(join(root, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('the report has one name', () => {
  it('is "Portfolio Analysis"', () => {
    expect(PORTFOLIO_REPORT_LABEL).toBe('Portfolio Analysis');
  });

  it.each(SURFACES)('%s spells no variant', (relative) => {
    const source = code(relative);
    expect(source).not.toMatch(/Portfolio Performance Review/);
    expect(source).not.toMatch(/Portfolio Review/);
  });

  it.each(SURFACES)('%s imports the name rather than repeating it', (relative) => {
    expect(code(relative)).toMatch(/PORTFOLIO_REPORT_LABEL/);
  });
});

describe('what deliberately did not change', () => {
  it('leaves the stored values alone', () => {
    // `portfolio_review`, `portfolio` and `review` are what the database
    // holds and what every query matches on. Renaming a label must never
    // reach them.
    expect(code('src/pages/portal/PortalReports.tsx')).toMatch(/portfolio_review:/);
    expect(code('src/components/clients/ClientSentReportsTab.tsx')).toMatch(/value="portfolio"/);
    expect(code('src/components/clients/FollowUpFlag.tsx')).toMatch(/value: 'review'/);
  });

  it("leaves the document's own title, which is a different artefact", () => {
    // "Portfolio Performance Review" is the report's formal name on the fifty
    // Investment Compass masters, in the seeded catalogue and in
    // `render-portfolio-review-pdf`. Changing it is a template-library
    // regeneration, not a label change — so it stays, and stays deliberate.
    const adapter = readFileSync(
      join(root, 'src', 'lib', 'reportTemplate', 'adapters', 'portfolioAdapter.ts'),
      'utf8',
    );
    expect(adapter).toMatch(/title: 'Portfolio Performance Review'/);
  });
});
