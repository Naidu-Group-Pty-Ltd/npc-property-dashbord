/**
 * The design factor is hidden product-wide.
 *
 * The premium-PDF design controls ("WeasyPrint design controls" — visual
 * preset, cover, chapter openings, tables, density, body size, visual
 * intensity, drop caps, section numbers, justification) are not a feature we
 * expose at this point in time. Every document renders from the defaults, so
 * the output is the same for every operator and every report.
 *
 * These pins hold the three things that make it a *hide* rather than a
 * deletion, and that stop it quietly coming back:
 *
 *   1. one switch decides it, and it is off;
 *   2. the shared panel refuses to render itself, so a future mount on any
 *      surface inherits the decision instead of reopening it;
 *   3. the chrome that frames it is inside the same guard, so no surface draws
 *      a bordered "Design" box over nothing;
 *   4. the renderer still receives design options — the defaults — so hiding
 *      the controls changed no document.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PremiumPdfDesignPanel } from '../PremiumPdfDesignPanel';
import { PREMIUM_PDF_DESIGN_CONTROLS_VISIBLE } from '../premiumPdfDesignVisibility';
import { DEFAULT_PDF_DESIGN_OPTIONS } from '../premiumPdfDesign';

// The export panel's siblings reach for the network and the session; this
// screen is being examined for what it DRAWS, so they stand in as markers.
vi.mock('@/components/reports/ClientPDFGenerator', () => ({
  ClientPDFGenerator: () => <div>legacy generator</div>,
}));
vi.mock('@/components/reports/PremiumPdfButton', () => ({
  PremiumPdfButton: () => <div>Premium PDF</div>,
}));
vi.mock('@/components/reports/RegenerateWithPerplexityButton', () => ({
  RegenerateWithPerplexityButton: () => <div>Regenerate</div>,
}));
vi.mock('@/components/reports/ReportTemplateSelector', () => ({
  ReportTemplateSelector: () => <div>Template</div>,
}));

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

const EXPORT_PANEL = 'src/components/reports/report-view/InvestmentReportExportPanel.tsx';

describe('the premium-PDF design controls are hidden', () => {
  it('one switch decides it, and it is off', () => {
    expect(PREMIUM_PDF_DESIGN_CONTROLS_VISIBLE).toBe(false);
  });

  it('the panel renders nothing at all', () => {
    const { container } = render(
      <PremiumPdfDesignPanel value={DEFAULT_PDF_DESIGN_OPTIONS} onChange={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('none of its controls reach the document', () => {
    const { queryByText, queryByLabelText } = render(
      <PremiumPdfDesignPanel value={DEFAULT_PDF_DESIGN_OPTIONS} onChange={() => {}} />,
    );
    for (const label of [
      'WeasyPrint design controls', 'Visual preset', 'Cover', 'Chapter openings',
      'Tables', 'Density', 'Body size', 'Visual intensity', 'Drop caps', 'Justified',
    ]) {
      expect(queryByText(label), label).toBeNull();
    }
    expect(queryByLabelText('signature')).toBeNull();
  });

  it('the panel refuses in its own body, so any mount inherits the decision', () => {
    const source = read('src/components/reports/PremiumPdfDesignPanel.tsx');
    expect(source).toContain('PREMIUM_PDF_DESIGN_CONTROLS_VISIBLE');
    expect(source).toMatch(/if \(!PREMIUM_PDF_DESIGN_CONTROLS_VISIBLE\) return null;/);
  });

  it('the export panel guards the whole Design section, not just the panel', () => {
    const source = read(EXPORT_PANEL);
    // The guard must open before the heading and the Reset button, or the
    // screen keeps a bordered box titled "Design" with nothing inside it.
    const guardAt = source.indexOf('PREMIUM_PDF_DESIGN_CONTROLS_VISIBLE &&');
    const headingAt = source.indexOf('Paintbrush className="h-3.5 w-3.5" />Design');
    const resetAt = source.indexOf('Tune premium PDF presentation settings.');
    const mountAt = source.indexOf('<PremiumPdfDesignPanel');
    expect(guardAt).toBeGreaterThan(-1);
    expect(headingAt).toBeGreaterThan(guardAt);
    expect(resetAt).toBeGreaterThan(guardAt);
    expect(mountAt).toBeGreaterThan(guardAt);
  });

  it('the real Publishing & Export screen draws no Design section', async () => {
    const { InvestmentReportExportPanel } = await import('../report-view/InvestmentReportExportPanel');
    const { queryByText, getByText } = render(
      <InvestmentReportExportPanel
        report={{ id: 'r1', property_address: '1 Test St', property_listing_id: null, report_content: '', created_at: '2026-09-05T00:00:00Z' } as never}
        includeSources
        includeScoring
        includeCharts
        includeHeroImages
        includeSparklines
        pdfDesignOptions={DEFAULT_PDF_DESIGN_OPTIONS}
        pdfGeneratorRef={{ current: null } as never}
        onIncludeSourcesChange={() => {}}
        onIncludeScoringChange={() => {}}
        onIncludeChartsChange={() => {}}
        onIncludeHeroImagesChange={() => {}}
        onIncludeSparklinesChange={() => {}}
        onPdfDesignOptionsChange={() => {}}
        onHeroImagesManage={() => {}}
        onRegenerated={() => {}}
        onDownload={() => {}}
      />,
    );
    // Gone: the section, its description, and the panel it framed.
    expect(queryByText('Design')).toBeNull();
    expect(queryByText('Tune premium PDF presentation settings.')).toBeNull();
    expect(queryByText('WeasyPrint design controls')).toBeNull();
    expect(queryByText('Reset')).toBeNull();
    // Still there: everything else the screen is for.
    expect(getByText('Publishing & Export')).toBeTruthy();
    expect(getByText('Premium PDF')).toBeTruthy();
    expect(getByText('Download raw text')).toBeTruthy();
    expect(getByText('Include scoring')).toBeTruthy();
  });

  it('hiding the controls changed no document — the renderer still gets the options', () => {
    const source = read(EXPORT_PANEL);
    expect(source).toContain('designOptions={pdfDesignOptions}');
    // And the page still holds them at the defaults.
    const page = read('src/pages/InvestmentReportView.tsx');
    expect(page).toContain('useState<PdfDesignOptions>(DEFAULT_PDF_DESIGN_OPTIONS)');
  });
});
