/**
 * The Client Details family catalogue — the sixth report format drawn in the
 * ten Investment Compass designs.
 *
 * The assertions that matter here are about **the empty record**. 742 of the
 * 775 clients have no property, no employment, no asset, no liability and no
 * expense, so the case the other five formats would treat as a degenerate edge
 * is this format's ordinary output. A master that renders well only for the 33
 * is a master that renders badly 96% of the time.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { evalConditional } from '@/lib/reportTemplate/bindingResolver';
import { CLIENT_DETAILS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/clientDetails';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import { PORTFOLIO_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/portfolio';
import { COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/comparison';
import { CASH_FLOW_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlow';
import { deriveEntryFacts } from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import { colourwaysForFamily, colourwayTokenOverride } from '../colourways';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

const clientDetails = SAMPLE.clientDetails as Record<string, any>;

/** Namespaces this format may bind besides its own. */
const AMBIENT = ['org', 'report', 'client'];

/** The 742: contact details and nothing else. */
const EMPTY_RECORD = {
  ...SAMPLE,
  clientDetails: {
    narrative: 'The record holds contact details and nothing further.',
    preparedOn: clientDetails.preparedOn,
    propertyCount: 0,
    hasSecondaryContact: 'No',
    contacts: [{ name: 'Alex Tran', role: 'Primary', email: 'alex@example.test', mobile: '0400 000 002' }],
    maritalStatus: 'Single',
    residence: {
      address: '18 Sample Street', suburb: 'Marrickville', state: 'NSW', postcode: '2204',
      country: 'Australia', livingSituation: 'Renting', residentialStatus: 'Australian citizen',
    },
    hasFinancials: false,
  },
  client: { name: 'Alex Tran' },
};

function boundPaths(): Set<string> {
  const paths = new Set<string>();
  for (const t of CLIENT_DETAILS_TEMPLATES) {
    for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)) paths.add(m[1]);
  }
  return paths;
}

/** The pages that survive their own conditional, for a given data object. */
function visiblePages(schema: any, data: Record<string, unknown>): any[] {
  const ctx = { data, tokens: schema.tokens ?? { colors: {}, fonts: {}, spacing: {} } } as any;
  return schema.pages.filter((p: any) => !p.conditional || evalConditional(p.conditional, ctx));
}

describe('the catalogue', () => {
  it('ships fifty masters across the same ten families', () => {
    expect(CLIENT_DETAILS_TEMPLATES).toHaveLength(50);
    expect(new Set(CLIENT_DETAILS_TEMPLATES.map((t) => t.designMeta.familyKey)).size).toBe(10);
  });

  it('is production-ready, because the format has a real adapter', () => {
    for (const t of CLIENT_DETAILS_TEMPLATES) {
      expect(t.reportType, t.name).toBe('client_details');
      expect(deriveEntryFacts({ report_type: t.reportType, schema: t.schema }).production_ready, t.name)
        .toBe(true);
    }
  });

  it('does not collide with any of the other five family catalogues', () => {
    const mine = CLIENT_DETAILS_TEMPLATES.map((t) => t.slug);
    const others = [
      ...INVESTMENT_COMPASS_TEMPLATES, ...BORROWING_CAPACITY_TEMPLATES,
      ...PORTFOLIO_TEMPLATES, ...COMPARISON_TEMPLATES, ...CASH_FLOW_COMPASS_TEMPLATES,
    ].map((t) => t.slug);
    expect(new Set(mine).size).toBe(50);
    expect(mine.filter((s) => others.includes(s))).toEqual([]);
    for (const t of CLIENT_DETAILS_TEMPLATES) {
      expect(t.designMeta.reportFormat).toBe('client-details-form');
    }
  });

  it('parses against the live schema contract', () => {
    for (const t of CLIENT_DETAILS_TEMPLATES) {
      expect(() => parseTemplate(t.schema), t.name).not.toThrow();
    }
  });

  it('binds nothing outside `clientDetails` and the ambient namespaces', () => {
    const namespaces = new Set([...boundPaths()].map((p) => p.split('.')[0]));
    expect([...namespaces].filter((ns) => ns !== 'clientDetails' && !AMBIENT.includes(ns)).sort())
      .toEqual([]);
  });

  it('publishes every leaf the masters bind', () => {
    const flat = new Set<string>();
    const walk = (value: unknown, path: string) => {
      flat.add(path);
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(clientDetails, 'clientDetails');
    walk(SAMPLE.report, 'report');
    walk(SAMPLE.org, 'org');
    walk(SAMPLE.client, 'client');

    // Indexed leaves resolve through the arrays the projection publishes; a
    // path whose index is past the sample's own length is a capped row, not a
    // missing binding.
    const missing = [...boundPaths()].filter(
      (p) => !flat.has(p) && !flat.has(p.replace(/\.\d+\./g, '.0.')),
    ).sort();
    expect(missing).toEqual([]);
  });
});

describe('the 742 clients whose record holds nothing', () => {
  it('drops every financial page and keeps the document intact', () => {
    for (const t of CLIENT_DETAILS_TEMPLATES) {
      const full = visiblePages(t.schema, SAMPLE);
      const bare = visiblePages(t.schema, EMPTY_RECORD);

      expect(bare.length, `${t.name} keeps something`).toBeGreaterThanOrEqual(4);
      expect(bare.length, `${t.name} drops pages`).toBeLessThan(full.length);

      const names = bare.map((p: any) => p.name);
      // The pages every client has.
      expect(names, t.name).toContain('Cover');
      expect(names, t.name).toContain('Who this is about');
      expect(names, t.name).toContain('Where they stand');
      expect(names, t.name).toContain('Important information');
      // And none of the financial ones.
      for (const gone of [
        'Work and income', 'What they own', 'What they owe', 'What they spend',
        'The property portfolio', 'Each property in turn',
      ]) {
        expect(names, `${t.name} still draws ${gone}`).not.toContain(gone);
      }
    }
  });

  it('says the record is incomplete, in the words the contract specifies', () => {
    const t = CLIENT_DETAILS_TEMPLATES[0];
    const { html } = renderTemplateToHtml(t.schema as any, { data: EMPTY_RECORD });
    expect(html).toContain('No financial information is recorded for this client');
    expect(html).toContain('This document is complete');
    // And not the summary, which is the same position under the opposite
    // conditional.
    expect(html).not.toContain('Where this client stands');
  });

  it('says where they stand when there is something to say', () => {
    const t = CLIENT_DETAILS_TEMPLATES[0];
    const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
    expect(html).toContain('Where this client stands');
    expect(html).not.toContain('No financial information is recorded');
  });

  it('renders without an unresolved binding on the page, either way', () => {
    for (const t of CLIENT_DETAILS_TEMPLATES) {
      for (const [label, data] of [['full', SAMPLE], ['empty', EMPTY_RECORD]] as const) {
        const { html } = renderTemplateToHtml(t.schema as any, { data });
        expect(html, `${t.name} / ${label}`).not.toContain('{{');
      }
    }
  });
});

describe('the bounding is said out loud', () => {
  it('warns only when a cap actually bites', () => {
    const t = CLIENT_DETAILS_TEMPLATES[0];
    const under = renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html;
    expect(under).not.toContain('This page does not show every asset');

    const over = renderTemplateToHtml(t.schema as any, {
      data: { ...SAMPLE, clientDetails: { ...clientDetails, assetCount: 18 } },
    }).html;
    expect(over).toContain('This page does not show every asset');
  });

  it('groups expenses on the page rather than listing them', () => {
    const t = CLIENT_DETAILS_TEMPLATES[0];
    const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
    // The category and its line count, not the individual expense names.
    expect(html).toContain('Groceries');
    expect(html).not.toContain('Butcher and greengrocer');
  });
});

describe('rendering', () => {
  it('names the client, which this format alone can do', () => {
    // `clients` is the source table. The Borrowing Capacity, Comparison and
    // Cash Flow masters name their subject because their tables carry none.
    for (const t of CLIENT_DETAILS_TEMPLATES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
      expect(html, t.name).toContain('Jordan &amp; Sarah Nguyen');
    }
  });

  it('carries the organisation on the disclaimer page', () => {
    // `org.*` had no producer at all until August 2026; every seeded template
    // printed a blank letterhead. See `organisationProjection.pure.ts`.
    const { html } = renderTemplateToHtml(CLIENT_DETAILS_TEMPLATES[0].schema as any, { data: SAMPLE });
    expect(html.toUpperCase()).toContain('MERIDIAN');
  });

  /**
   * 550 renders: fifty masters against their base palette and each of their ten
   * colourways. Exhaustive on purpose — a colourway that moved a block would
   * move it on exactly one family — and slow enough to need saying so, because
   * the 5s default passes when this file runs alone and times out when it runs
   * beside the other catalogues.
   */
  it('changes the colour and never the layout', () => {
    const geometry = (html: string) => (html.match(/left:[\d.]+pt;top:[\d.]+pt/g) ?? []).join('|');
    for (const t of CLIENT_DETAILS_TEMPLATES) {
      const base = geometry(renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html);
      for (const cw of colourwaysForFamily(t.designMeta.familyKey)) {
        const other = geometry(renderTemplateToHtml(t.schema as any, {
          data: SAMPLE, tokenOverrides: colourwayTokenOverride(cw),
        }).html);
        expect(other, `${t.name} / ${cw.name}`).toBe(base);
      }
    }
  }, 60_000);

  it('carries no emoji, which the legacy headings are built from', () => {
    // `🏠 Owner Occupied`, `📈 Investment`, `🏛️ SMSF`, `💸`, `✓ ✗ ⏳ ▲ ▼ ●`.
    // Harmless when every page is a raster of the browser's own rendering;
    // tofu the moment the page is real text, because these families' faces
    // carry no emoji coverage.
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{25A0}-\u{25FF}]/u;
    for (const t of CLIENT_DETAILS_TEMPLATES) {
      const source = JSON.stringify(t.schema);
      expect(emoji.test(source), `${t.name} carries an emoji`).toBe(false);
    }
  });
});
