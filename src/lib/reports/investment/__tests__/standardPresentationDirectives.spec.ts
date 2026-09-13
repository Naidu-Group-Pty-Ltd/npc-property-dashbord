import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The standard presentation may not print a chart directive, and removing one
 * may not cost the document a chapter.
 *
 * The generator's prompt writes figures as `{{bars: …}}`, `{{gauge: …}}`,
 * `{{glance: …}}` and nine more kinds; `markdown.pure.ts` states the rule for
 * them — a directive is drawn or dropped, and its source is never printed.
 * This presentation had never heard of them: measured on production report
 * 783bb982, THIRTY-SIX raw directives were set as body copy, one of them
 * repeated on four consecutive pages as a table's header row. 60 of the 1,195
 * completed reports carry directives (4,652 of them), and they are the ones
 * the current generator writes.
 *
 * The second assertion is the one that matters more, because the first fix
 * broke it: removing the directives BEFORE `parseReportContent` emptied every
 * chapter whose own body is a single `{{glance: …}}` opener, and
 * `allSectionNames` drops a section under 40 characters — so four chapters,
 * their contents entries and the appendix that carries the source notes
 * disappeared from the document.
 */
vi.mock('@/hooks/useGlobalReportSettings', async (orig) => ({
  ...(await orig() as object),
  fetchGlobalReportSettings: async () => ({
    contactDetails: {
      company_name: 'Test Co', phone: '', email: '', website: '', address: '', abn: '',
    },
    disclaimer: { text: 'Test disclaimer.', font_size: 'medium', is_enabled: true },
  }),
}));

const CHAPTERS = ['Alpha Chapter', 'Beta Chapter', 'Gamma Chapter'];

/** A chapter whose OWN body is only a glance strip; its prose is in its H3. */
const CONTENT = [
  '# Investment Report: 9 Test Street, Cowra NSW 2794',
  '',
  '## Alpha Chapter',
  '',
  '{{glance: ✓ One | ◆ Two | ⚠ Three | ★ Four}}',
  '',
  '### Alpha Detail',
  '',
  'Alpha prose that is comfortably longer than the forty-character floor the section filter applies.',
  '',
  '## Beta Chapter',
  '',
  '{{gauge: 64 | Location Fundamentals | Regional town with steady growth}}',
  '',
  '### Beta Detail',
  '',
  'Beta prose that is comfortably longer than the forty-character floor the section filter applies.',
  '',
  '## Gamma Chapter',
  '',
  'Gamma prose with an inline {{bars: One 8, Two 7, Three 5 | max=10}} figure and more words after it '
  + 'so the section clears the forty-character floor with room to spare.',
  '',
].join('\n');

const REPORT = {
  id: 'test-report',
  address: '9 Test Street, Cowra NSW 2794',
  content: CONTENT,
  created_at: '2026-09-13T00:00:00.000Z',
  enhanced_data: { financialData: {}, investmentScore: {} },
};

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? input);
    if (url.startsWith('/')) {
      const file = path.resolve(process.cwd(), 'public', url.replace(/^\//, ''));
      if (!fs.existsSync(file)) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(fs.readFileSync(file)), { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

async function drawnText(
  report: unknown = REPORT, reportTier: 'compass' | 'financial' = 'compass',
): Promise<string> {
  const { generateInvestmentPdfBlob } = await import('../investmentPdfDocument');
  const { blob } = await generateInvestmentPdfBlob({ report: report as any, reportTier });
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false,
  }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out += content.items.map((it: any) => it.str ?? '').join('') + '\n';
  }
  return out;
}

describe('the standard Investment presentation and chart directives', () => {
  it('prints no directive source, and keeps every chapter it came from', async () => {
    const text = await drawnText();
    expect(text.match(/\{\{[^}\n]{0,40}/g) ?? []).toEqual([]);
    for (const chapter of CHAPTERS) {
      expect(text.replace(/\s+/g, ''), `${chapter} must survive`)
        .toContain(chapter.replace(/\s+/g, ''));
    }
    // The prose the directive sat beside is untouched — a removed figure never
    // removes a sentence.
    expect(text.replace(/\s+/g, '')).toContain('Alphaprosethatiscomfortably');
    expect(text.replace(/\s+/g, '')).toContain('figureandmorewordsafterit');
  }, 120_000);

  /**
   * The KPI band reads the key a producer actually writes.
   *
   * It asked for `keyMetrics.grossYield`, which NO producer has ever written:
   * measured over the 204 completed reports carrying a `keyMetrics` block, 188
   * hold `grossRentalYield` and zero hold `grossYield`, so the Gross Yield tile
   * could never render and the market block's `rentalYield` fell through to a
   * SCORE. The tiles are Financial-tier only, which is what kept it invisible.
   */
  it('draws the Gross Yield tile from the stored grossRentalYield', async () => {
    const text = await drawnText({
      ...REPORT,
      content: [
        '# Investment Report: 9 Test Street, Cowra NSW 2794',
        '',
        '## Financial Snapshot',
        '',
        'The holding position for this property is set out below, with the acquisition and the',
        'annual return stated against the contract price.',
        '',
      ].join('\n'),
      enhanced_data: {
        financialData: {
          keyMetrics: { grossRentalYield: 4.17, netRentalYield: 1.85, lvr: 80 },
          initialCosts: { propertyValue: 555000, stampDuty: 19162, deposit: 111000 },
          income: { weeklyRent: 445, annualRent: 23140 },
          loanDetails: { loanAmount: 444000, interestRate: 6.5, lvr: 80 },
        },
        investmentScore: {},
      },
    }, 'financial');
    const flat = text.replace(/\s+/g, '');
    expect(flat).toContain('GROSSYIELD');
    expect(flat).toContain('4.17%');
  }, 120_000);
});
