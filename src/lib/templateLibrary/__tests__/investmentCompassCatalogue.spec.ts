/**
 * The Private Banking pilot — five masters, ten colourways, fifty combinations.
 *
 * These tests do not stop at "the schema parses". A catalogue entry that parses
 * but renders an empty page is worse than no entry: a user spends time reading
 * it, copies it, opens the Builder and finds a blank document. So every
 * template is pushed through the **real** production HTML renderer — the same
 * `renderTemplateToHtml` that produces the customer's PDF — in every one of its
 * colourways, and the output is inspected.
 *
 * Three questions they are built to answer:
 *
 *  1. Is this the approved catalogue? (names, codes, order, manifests)
 *  2. Do the five templates actually DIFFER, or is the family five recolours?
 *  3. Does every colourway reach the page, in both light and dark?
 */
import { describe, it, expect } from 'vitest';
import { ReportTemplateSchema, parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import {
  deriveEntryFacts, validateForPublish,
} from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import { PRODUCTION_SAFE_BLOCK_TYPES } from '../../../../supabase/functions/_shared/productionBlockTypes';
import {
  INVESTMENT_COMPASS_TEMPLATES,
} from '../../../../scripts/template-library/investmentCompass/privateBanking';
import {
  PRIVATE_BANKING, resolveManifest,
} from '../../../../scripts/template-library/investmentCompass/family';
import { PRIVATE_BANKING_COLOURWAYS, colourwayTokenOverride, resolveColourway } from '../colourways';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

/** The five approved names, in the approved order. */
const APPROVED_NAMES = [
  'Chancery',
  'Chancery Compact',
  'Sovereign Folio',
  'Bullion Rail',
  'Discretion Ledger',
];

/** Visible text, with tags and whitespace collapsed. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Every colour literal the rendered document actually paints. */
function coloursIn(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/#[0-9a-f]{6}\b/gi)) out.add(m[0].toUpperCase());
  return out;
}

describe('Private Banking catalogue', () => {
  it('ships the five approved masters, in the approved order', () => {
    expect(INVESTMENT_COMPASS_TEMPLATES.map((t) => t.name)).toEqual(APPROVED_NAMES);
  });

  it('carries the approved catalogue codes', () => {
    expect(INVESTMENT_COMPASS_TEMPLATES.map((t) => t.designMeta.templateCode))
      .toEqual(['pb-01', 'pb-02', 'pb-03', 'pb-04', 'pb-05']);
  });

  it('has unique slugs', () => {
    const slugs = INVESTMENT_COMPASS_TEMPLATES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('scopes every master to the Investment Compass report type', () => {
    // Phase 9: the pilot must not accidentally activate another report type.
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      expect(t.reportType).toBe('investment_compass');
      expect(t.category).toBe('investment');
    }
  });

  it('is production-ready, because investment_compass normalises to the investment adapter', () => {
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      const facts = deriveEntryFacts({ report_type: t.reportType, schema: t.schema });
      expect(facts.production_ready, t.name).toBe(true);
    }
  });

  it('covers all seven report archetypes on every master', () => {
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      // Cover, dashboard, narrative, dense data, chart, risk, sources —
      // plus the disclaimer page, and more where density spends extra pages.
      expect(t.schema.pages.length, t.name).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('the five are structurally distinct, not five recolours', () => {
  it('gives each variant the approved override set', () => {
    const byCode = new Map(
      PRIVATE_BANKING.variants.map((v) => [v.code, v]),
    );
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      const variant = byCode.get(t.designMeta.templateCode)!;
      expect(t.designMeta.overrides).toEqual(variant.overrides);
      expect(t.designMeta.manifest).toEqual(resolveManifest(PRIVATE_BANKING, variant));
    }
  });

  it('marks exactly one master as the family reference', () => {
    const references = INVESTMENT_COMPASS_TEMPLATES.filter((t) => t.designMeta.isFamilyReference);
    expect(references).toHaveLength(1);
    expect(references[0].name).toBe('Chancery');
  });

  it('differs on the axes the catalogue says it differs on', () => {
    const manifests = INVESTMENT_COMPASS_TEMPLATES.map((t) => t.designMeta.manifest);
    // If any two resolved manifests were equal, two templates would be the same
    // document under two names — which is precisely the failure the family
    // model exists to prevent.
    const seen = new Set(manifests.map((m) => JSON.stringify(m)));
    expect(seen.size).toBe(5);
  });

  it('spends different geometry per density', () => {
    const byName = new Map(INVESTMENT_COMPASS_TEMPLATES.map((t) => [t.name, t]));
    const compact = byName.get('Chancery Compact')!;
    const balanced = byName.get('Chancery')!;
    const spacious = byName.get('Sovereign Folio')!;

    expect(compact.designMeta.manifest.page_margin_preset).toBe('16mm');
    expect(balanced.designMeta.manifest.page_margin_preset).toBe('20mm');
    expect(spacious.designMeta.manifest.page_margin_preset).toBe('26mm');

    // A spacious cut does not shrink its type to fit; it uses more pages.
    expect(spacious.schema.pages.length).toBeGreaterThan(balanced.schema.pages.length);
  });

  it('draws five different KPI arrangements', () => {
    const layouts = INVESTMENT_COMPASS_TEMPLATES.map((t) => t.designMeta.manifest.kpi_layout);
    expect(new Set(layouts).size).toBe(5);
    expect(layouts).toEqual([
      'four_column_ruled', 'six_column_ruled', 'two_by_two_display',
      'stacked_rail', 'ledger_rows',
    ]);
  });

  it('gives Bullion Rail a rail no other master has', () => {
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      const railed = t.schema.pages.some((p) => p.blocks.some(
        (b) => b.type === 'divider' && (b.props as any).orientation === 'vertical',
      ));
      expect(railed, t.name).toBe(t.name === 'Bullion Rail');
    }
  });

  it('gives Discretion Ledger the double-rule totals', () => {
    const ledger = INVESTMENT_COMPASS_TEMPLATES.find((t) => t.name === 'Discretion Ledger')!;
    expect(ledger.designMeta.manifest.table_style).toBe('double_rule_statement');
    expect(ledger.designMeta.manifest.risk_display).toBe('severity_bars');
    expect(ledger.designMeta.manifest.recommendation_style).toBe('ruled_statement');
  });
});

describe('the family typography reaches the page', () => {
  it('compiles all four approved faces', () => {
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      const fonts = t.schema.tokens.fonts as Record<string, string>;
      expect(fonts.display, t.name).toMatch(/^Cinzel,/);
      expect(fonts.heading, t.name).toMatch(/^Playfair Display,/);
      expect(fonts.body, t.name).toMatch(/^Inter,/);
      expect(fonts.mono, t.name).toMatch(/^IBM Plex Mono,/);
    }
  });

  it('loads every face it names', () => {
    // A template that names Cinzel without a loadable face renders in the
    // engine default — a serif that is not Cinzel — and nothing says so.
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      const faces = (t.schema.tokens as any).fontFaces as Array<{ family: string; cssUrl: string }>;
      const families = faces.map((f) => f.family);
      expect(families, t.name).toEqual(
        expect.arrayContaining(['Cinzel', 'Playfair Display', 'Inter', 'IBM Plex Mono']),
      );
      for (const face of faces) expect(face.cssUrl).toMatch(/^https:\/\/fonts\.googleapis\.com\//);
    }
  });

  it('emits the @import that makes the face available to WeasyPrint', () => {
    const { css } = renderTemplateToHtml(INVESTMENT_COMPASS_TEMPLATES[0].schema, { data: SAMPLE });
    expect(css).toContain('@import');
    expect(css).toContain('Cinzel');
    expect(css).toContain('Playfair+Display');
  });
});

describe.each(INVESTMENT_COMPASS_TEMPLATES.map((t) => [t.name, t] as const))('%s', (_name, template) => {
  it('parses against the live Zod schema without salvage', () => {
    const result = ReportTemplateSchema.safeParse(template.schema);
    expect(
      result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    ).toEqual([]);
  });

  it('survives a parseTemplate round-trip with its pages intact', () => {
    const parsed = parseTemplate(template.schema);
    expect(parsed.pages).toHaveLength(template.schema.pages.length);
  });

  it('uses only block types the production renderer supports', () => {
    const unsupported = template.schema.pages
      .flatMap((p) => p.blocks.map((b) => b.type))
      .filter((t) => !PRODUCTION_SAFE_BLOCK_TYPES.has(t));
    expect([...new Set(unsupported)]).toEqual([]);
  });

  it('passes the publish gate', () => {
    expect(validateForPublish({
      name: template.name, slug: template.slug, schema: template.schema,
    })).toBeNull();
  });

  it('hard-codes no colour outside the token map', () => {
    // This is what lets a colourway repaint the document at all. A literal in a
    // block prop would survive every palette and show up as one stubborn
    // element in the wrong colour.
    const facts = deriveEntryFacts({ report_type: template.reportType, schema: template.schema });
    expect(facts.brand_safe).toBe(true);
  });

  it('renders real content with sample data', () => {
    const { html } = renderTemplateToHtml(template.schema, { data: SAMPLE });
    const text = textOf(html);
    expect(text.length).toBeGreaterThan(1200);
    // The bindings actually resolved, rather than printing their own braces.
    expect(html).not.toContain('{{');
    expect(text).toContain('Leichhardt');
  });

  it('renders every page, not just the cover', () => {
    const { html } = renderTemplateToHtml(template.schema, { data: SAMPLE });
    const pages = html.match(/class="[^"]*tpl-page/g) ?? [];
    expect(pages.length).toBe(template.schema.pages.length);
  });

  it('leaves no page blank', () => {
    for (const page of template.schema.pages) {
      expect(page.blocks.length, `${template.name} / ${page.name}`).toBeGreaterThan(0);
    }
  });

  it('survives a report with whole sections missing', () => {
    // A real report populates only the namespaces its adapter emits. A template
    // that throws on an absent one would be unusable on live data.
    const sparse = { property: { address: '1 Test Street' } };
    expect(() => renderTemplateToHtml(template.schema, { data: sparse })).not.toThrow();
    const { html } = renderTemplateToHtml(template.schema, { data: sparse });
    expect(html).not.toContain('{{');
  });

  it('survives an address long enough to wrap three lines', () => {
    const long = {
      ...SAMPLE,
      property: {
        ...(SAMPLE.property as object),
        address: 'Unit 14B, Level 3, The Sebastopol Residences, 1188-1200 Wentworthville Parade, Upper Kedron Heights QLD 4055',
        suburb: 'Wallumbilla-Yuleba-Injune Statistical Area Level Two',
      },
    };
    const { html } = renderTemplateToHtml(template.schema, { data: long });
    expect(textOf(html)).toContain('Sebastopol Residences');
  });

  it('survives figures at both ends of the range', () => {
    for (const price of [0, 45_000, 98_500_000]) {
      const data = {
        ...SAMPLE,
        financials: { ...(SAMPLE.financials as object), purchasePrice: price, weeklyNet: -price / 52 },
      };
      expect(() => renderTemplateToHtml(template.schema, { data })).not.toThrow();
    }
  });

  it('renders at A4, portrait', () => {
    for (const page of template.schema.pages) {
      expect(page.size.width).toBe(595);
      expect(page.size.height).toBe(842);
    }
  });
});

describe('every colourway reaches the page', () => {
  const combos = INVESTMENT_COMPASS_TEMPLATES.flatMap((t) =>
    PRIVATE_BANKING_COLOURWAYS.map((c) => [t.name, c.name, t, c] as const));

  it('covers the full fifty combinations', () => {
    expect(combos).toHaveLength(50);
  });

  it.each(combos)('%s in %s', (_t, _c, template, colourway) => {
    const { html } = renderTemplateToHtml(template.schema, {
      data: SAMPLE,
      tokenOverrides: colourwayTokenOverride(colourway),
    });
    const resolved = resolveColourway(colourway);
    const painted = coloursIn(html);

    // The accent and the page stock are both actually on the page — not merely
    // declared in a variable the blocks never reference.
    expect(painted, `${colourway.name} accent`).toContain(resolved.primary.toUpperCase());
    expect(painted, `${colourway.name} paper`).toContain(resolved.surface.toUpperCase());
    expect(html).not.toContain('{{');
    expect(textOf(html).length).toBeGreaterThan(1200);
  });

  it('paints a genuinely different document per colourway', () => {
    // Guards the failure where token overrides are accepted and then dropped:
    // fifty identical renders would pass every other test in this file.
    const chancery = INVESTMENT_COMPASS_TEMPLATES[0];
    const rendered = PRIVATE_BANKING_COLOURWAYS.map((c) => renderTemplateToHtml(chancery.schema, {
      data: SAMPLE,
      tokenOverrides: colourwayTokenOverride(c),
    }).html);
    expect(new Set(rendered).size).toBe(PRIVATE_BANKING_COLOURWAYS.length);
  });

  it('inverts the page for a dark ground', () => {
    const chancery = INVESTMENT_COMPASS_TEMPLATES[0];
    const dark = PRIVATE_BANKING_COLOURWAYS.find((c) => c.id === 'pb-obsidian-reverse')!;
    const { html } = renderTemplateToHtml(chancery.schema, {
      data: SAMPLE,
      tokenOverrides: colourwayTokenOverride(dark),
    });
    // The content pages take the dark paper, which is the whole point of a
    // reverse colourway and the thing a token-only swap gets wrong.
    expect(coloursIn(html)).toContain(resolveColourway(dark).surface.toUpperCase());
  });
});
