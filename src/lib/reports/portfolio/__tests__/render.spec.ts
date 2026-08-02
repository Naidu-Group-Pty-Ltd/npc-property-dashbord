/**
 * What the document must be, structurally, before anyone looks at a page.
 *
 * The findings this format is being migrated away from are all structural: a
 * contents page hand-counted from a variable that starts at 3, sections listed
 * in an order they are not printed in, an inventory that resumes at a fixed row
 * index, a cover that is a raster of our letterhead on a tenant's report. None
 * of those are visible in the PDF bytes and all of them are visible here.
 */
import { describe, expect, it } from 'vitest';
import { buildPortfolioReview } from '../normalise.pure';
import { renderPortfolioFromBrand, DOCUMENT_NAME } from '../render.pure';
import { portfolioSections, portfolioSpine, validatePortfolioSpine, DETAIL_CAP } from '../sections.pure';
import { contentsEntriesFor, REPORT_ARCHETYPES, spinePageBudget } from '@/lib/reportDesign/structure.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';
import {
  parseRenderRequest,
  portfolioFileName,
  portfolioStoragePath,
} from '../route.pure';

const NOW = '2026-08-02T00:00:00.000Z';

const holding = (n: number) => ({
  propertyNumber: n,
  address: `${n} Wattle Street, Example Bay, QLD 4000`,
  propertyType: 'investment',
  value: 500_000,
  loan: 400_000,
  equity: 100_000,
  lvr: 80,
  monthlyRentalIncome: 2_000,
  monthlyExpenses: 800,
  netMonthlyCashflow: 1_200,
  grossYield: 4.8,
  isOwnerOccupied: false,
});

const review = (count = 3, analysis: Record<string, unknown> = {}) => buildPortfolioReview({
  report: {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    created_at: '2026-05-01T00:00:00.000Z',
    overall_health: 'Good',
    report_data: {
      portfolioMetrics: { totalValue: 1_500_000, totalProperties: count },
      propertyAnalyses: Array.from({ length: count }, (_, i) => holding(i + 1)),
      analysis,
    },
  },
  review: null,
  clientName: 'Sample Client',
  now: NOW,
});

// A white-label tenant, so "the cover carries the tenant's mark and not ours"
// is a claim the fixture can actually falsify.
const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', brandColour: '#B8873A', preset: 'signature' },
  contact: { company_name: 'Tenant Advisory Pty Ltd', abn: '11 222 333 444' },
  capturedAt: NOW,
});

const render = (p: ReturnType<typeof review>) =>
  renderPortfolioFromBrand({ review: p, snapshot }).html;

describe('the contents page cannot claim something that was not printed', () => {
  it('lists exactly the sections the document builds, in printed order', () => {
    const p = review(3, {
      compositionAnalysis: { assetAllocation: 'All investment.' },
      riskAssessment: { overallRiskLevel: 'Medium' },
    });
    const built = portfolioSections(p).map((s) => s.title);
    const listed = contentsEntriesFor(portfolioSpine(p)).map((e) => e.title);
    expect(listed).toEqual(built);
  });

  it('numbers them from one, with no gaps', () => {
    const entries = contentsEntriesFor(portfolioSpine(review(3)));
    expect(entries.map((e) => e.number)).toEqual(
      entries.map((_, i) => String(i + 1).padStart(2, '0')),
    );
  });

  it('prints no page numbers at all, so none of them can be wrong', () => {
    // The legacy hand-increments a counter that starts at 3 and never
    // reconciles it against the drawn page count. `@page` counters number the
    // pages here, and the contents carries titles only.
    const html = render(review(3));
    const contents = html.slice(html.indexOf('page-contents'), html.indexOf('page-chapter-opener'));
    expect(contents).not.toMatch(/\bp\.?\s?\d{1,2}\b/);
  });
});

describe('the inventory holds every property', () => {
  it('gives the holdings section a budget derived from the count', () => {
    const small = portfolioSections(review(3)).find((s) => s.id === 'holdings')!;
    const large = portfolioSections(review(40)).find((s) => s.id === 'holdings')!;
    expect(large.pageBudget).toBeGreaterThan(small.pageBudget);
  });

  it('names every property in the matrix, however many there are', () => {
    const html = render(review(40));
    for (const n of [1, 20, 40]) {
      expect(html).toContain(`${n} Wattle Street`);
    }
  });

  it('says so on the page when per-property commentary is abridged', () => {
    const many = review(40, {
      propertyRankings: Array.from({ length: 40 }, (_, i) => ({
        address: `${i + 1} Wattle Street, Example Bay, QLD 4000`,
        rank: i + 1,
        performanceRating: 'Good',
        recommendation: 'Hold.',
      })),
    });
    const html = render(many);
    expect(html).toContain('Commentary is abridged');
    expect(html).toContain(`${DETAIL_CAP} of 40 properties`);
  });

  it('says nothing about abridgement when nothing was abridged', () => {
    const html = render(review(3, {
      propertyRankings: [{
        address: '1 Wattle Street, Example Bay, QLD 4000',
        rank: 1,
        recommendation: 'Hold.',
      }],
    }));
    expect(html).not.toContain('Commentary is abridged');
  });
});

describe('the cover is the tenant’s', () => {
  const html = render(review(3));

  it('carries the tenant’s name and not ours', () => {
    expect(html).toContain('Tenant Advisory');
    expect(html).not.toContain('NPC_PDF_Template');
    expect(html).not.toContain('npc-portfolio-cover');
  });

  it('names the client as the subject', () => {
    expect(html).toContain('Sample Client');
  });
});

describe('the document refuses to render when its structure is wrong', () => {
  it('throws rather than producing a document with no holdings', () => {
    const p = { ...review(3), holdings: [] } as ReturnType<typeof review>;
    expect(() => render(p)).toThrow(/invalid structure/);
    expect(validatePortfolioSpine(p)).toContain('the portfolio has no holdings to review');
  });

  it('throws rather than addressing a review to nobody', () => {
    const p = review(3);
    const nameless = { ...p, meta: { ...p.meta, clientName: '  ' } };
    expect(() => render(nameless)).toThrow(/invalid structure/);
  });
});

describe('the spine stays inside its archetype', () => {
  const [min, max] = REPORT_ARCHETYPES['portfolio-performance'].pageBudget;

  /**
   * `report_data.analysis` is stored model output, so an empty one is a real
   * state rather than corruption. The document that produces is thin — the
   * figures and nothing else — and it must still render, because refusing turns
   * a content problem into an outage for a client whose numbers are all there.
   */
  it('renders a report whose analysis came back empty', () => {
    const bare = review(1);
    expect(validatePortfolioSpine(bare)).toEqual([]);
    expect(spinePageBudget(portfolioSpine(bare))).toBe(min);
    expect(() => render(bare)).not.toThrow();
  });

  it.each([1, 3, 4, 20, 60])('a %i-property portfolio spines inside the band', (count) => {
    const p = review(count, {
      compositionAnalysis: { assetAllocation: 'Mixed.' },
      financialHealth: { analysis: 'Healthy.' },
      riskAssessment: { overallRiskLevel: 'Medium' },
      marketConditions: { marketCycleSummary: 'Recovering.' },
      growthOpportunities: { equityReleaseOptions: ['Refinance'] },
      borrowingCapacityUtilisation: { estimatedCapacity: 250_000 },
      projections: { projectedPortfolioValue: 2_000_000 },
      propertyRankings: Array.from({ length: count }, (_, i) => ({
        address: `${i + 1} Wattle Street, Example Bay, QLD 4000`,
        rank: i + 1,
      })),
    });
    const total = spinePageBudget(portfolioSpine(p));
    expect(total).toBeGreaterThanOrEqual(min);
    expect(total).toBeLessThanOrEqual(max);
    expect(validatePortfolioSpine(p)).toEqual([]);
  });
});

describe('nothing is escaped into the page unread', () => {
  it('escapes a client name that carries markup', () => {
    const p = review(3);
    const hostile = { ...p, meta: { ...p.meta, clientName: '<script>alert(1)</script>' } };
    const html = render(hostile);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes prose the model wrote', () => {
    const p = review(3, { financialHealth: { analysis: 'Debt <b>rose</b> & held.' } });
    const html = render(p);
    expect(html).not.toContain('<b>rose</b>');
    expect(html).toContain('&amp;');
  });
});

describe('the render request', () => {
  it('accepts a uuid and nothing else about the contents', () => {
    const parsed = parseRenderRequest({ reportId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.request.includeReview).toBe(true);
      expect(parsed.request.edition).toBeNull();
    }
  });

  it('refuses anything that is not a uuid', () => {
    for (const body of [null, {}, { reportId: '' }, { reportId: 'not-a-uuid' }]) {
      expect(parseRenderRequest(body).ok).toBe(false);
    }
  });

  it('lets a caller turn the review off explicitly, and only explicitly', () => {
    const off = parseRenderRequest({ reportId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', includeReview: false });
    expect(off.ok && off.request.includeReview).toBe(false);
    const absent = parseRenderRequest({ reportId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', includeReview: undefined });
    expect(absent.ok && absent.request.includeReview).toBe(true);
  });

  it('keeps the filename shape clients already receive', () => {
    expect(portfolioFileName('Sample Client', NOW)).toBe('Portfolio_Analysis_Sample_Client_2026-08-02.pdf');
  });

  it('writes under the prefix the format already uses, without colliding with it', () => {
    const path = portfolioStoragePath('client-1', 'Portfolio_Analysis.pdf', NOW, 'uid');
    expect(path.startsWith('portfolio-reports/client-1/')).toBe(true);
    // The legacy writes `portfolio-reports/<clientId>/<name>`; the extra segment
    // is what makes a collision with a file `pdf_file_path` points at impossible.
    expect(path).toContain('/typeset/');
    expect(path).toContain('uid-');
  });
});

describe('the format writes no colour of its own', () => {
  it.each(['payload', 'normalise', 'sections', 'render', 'charts', 'route'])(
    '%s.pure.ts names no hex colour',
    async (name) => {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const source = readFileSync(
        resolve(__dirname, `../../../../../supabase/functions/_shared/reports/portfolio/${name}.pure.ts`),
        'utf8',
      ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(source, `${name}.pure.ts writes a colour instead of taking one from the palette`)
        .not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    },
  );

  it('has a document name that comes from the archetype', () => {
    expect(DOCUMENT_NAME).toBe(REPORT_ARCHETYPES['portfolio-performance'].documentName);
  });
});
