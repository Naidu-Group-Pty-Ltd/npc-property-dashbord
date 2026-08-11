/**
 * The source's classification, all the way to a parsed template.
 *
 * `mapDoclingToRawBlocks` has always read Docling's labels — they pick a
 * default weight, a default size, a block type, and they route page furniture
 * to a master page. `blockToOverlay` then carried `groupId` across and nothing
 * else, so a stored template knew the geometry of every box on the page and the
 * meaning of none of them.
 *
 * These assert the whole path, including `parseTemplate`: a field the Zod schema
 * does not declare is stripped silently, which is how `containedRegions` was
 * lost in an earlier stage of this programme.
 */
import { describe, expect, it } from 'vitest';
import type { DoclingDocument } from '../doclingTypes';
import { mapDoclingToPagePlan } from '../mapDoclingToPagePlan';
import { applyTemplateImportPlan } from '@/lib/reportTemplate/ingestion/reconciliation/applyPlan';
import { parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { SEMANTIC_ANNOTATION_VERSION } from '../../semanticRole.pure';

const at = (t: number, b: number) => [{ page_no: 1, bbox: { l: 60, t, r: 535, b, coord_origin: 'TOPLEFT' as const } }];

const DOC: DoclingDocument = {
  pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
  texts: [
    { label: 'title', text: 'Borrowing Capacity Snapshot', prov: at(60, 100), confidence: 0.95 },
    { label: 'section_header', text: 'Executive Summary', level: 2, prov: at(120, 145), confidence: 0.95 },
    { label: 'paragraph', text: 'Based on the financial information provided…', prov: at(150, 200), confidence: 0.9 },
    { label: 'section_header', text: 'Income Analysis', level: 3, prov: at(210, 235), confidence: 0.95 },
    { label: 'list_item', text: 'Gross annual income', prov: at(240, 258), confidence: 0.9 },
    { label: 'list_item', text: 'Shaded annual income', prov: at(260, 278), confidence: 0.9 },
    { self_ref: '#/texts/6', label: 'caption', text: 'Figure 1. Income by source.', prov: at(430, 448), confidence: 0.9 },
    { label: 'page_footer', text: 'PRIVATE AND CONFIDENTIAL', prov: at(800, 812), confidence: 0.9 },
  ],
  pictures: [
    {
      self_ref: '#/pictures/0',
      prov: at(290, 420),
      captions: [{ $ref: '#/texts/6' }],
      classification: { predicted_class: 'bar_chart' },
      annotations: [{ kind: 'description', text: 'Bar chart of gross versus shaded income.' }],
    } as DoclingDocument['pictures'] extends (infer U)[] ? U : never,
  ],
};

function overlaysOf(doc: DoclingDocument = DOC) {
  return mapDoclingToPagePlan(doc, { importId: 'imp-sem', mode: 'semantic' }).pages[0].overlays as Array<
    Record<string, unknown> & { id: string; semantics?: { role: string; headingLevel?: number; readingOrder?: number } }
  >;
}

const byId = (fragment: string) => overlaysOf().find((o) => o.id.includes(fragment))!;

describe('the Docling label reaches the overlay', () => {
  it('annotates a title and a section header with their levels', () => {
    expect(byId('title').semantics).toMatchObject({
      version: SEMANTIC_ANNOTATION_VERSION, role: 'title', headingLevel: 1,
    });
    const headings = overlaysOf().filter((o) => o.semantics?.role === 'heading');
    expect(headings.map((h) => h.semantics!.headingLevel)).toEqual([2, 3]);
  });

  it('annotates body copy, list items, captions and page furniture', () => {
    const roles = overlaysOf().map((o) => o.semantics?.role);
    expect(roles).toContain('body');
    expect(roles).toContain('listItem');
    expect(roles).toContain('caption');
    expect(roles).toContain('pageFooter');
    expect(roles).toContain('figure');
  });

  it('carries the SOURCE reading order, which paint order does not preserve', () => {
    // Paint order groups every image below every text run, so the stored order
    // is not the order the document reads in.
    const orders = overlaysOf().map((o) => o.semantics?.readingOrder);
    expect(orders.every((n) => typeof n === 'number')).toBe(true);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('shares one list group across a contiguous run of items', () => {
    const items = overlaysOf().filter((o) => o.semantics?.role === 'listItem');
    expect(items).toHaveLength(2);
    const groups = new Set(items.map((i) => (i.semantics as { listGroupId?: string }).listGroupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeTruthy();
  });

  it('gives the figure the source\'s own description as alternative text', () => {
    // A /Figure with no /Alt is a hard PDF/UA failure, and this description was
    // already extracted — it was spent on the Layers-panel name and nowhere else.
    expect(byId('picture').alt).toBe('Bar chart of gross versus shaded income.');
  });

  it('falls back to the caption, then the classified kind, then nothing', () => {
    const noDescription = { ...DOC, pictures: [{ ...DOC.pictures![0], annotations: [] }] } as DoclingDocument;
    expect(overlaysOf(noDescription).find((o) => o.id.includes('picture'))!.alt)
      .toBe('Figure 1. Income by source.');

    const bare = {
      ...DOC,
      texts: DOC.texts!.filter((t) => t.label !== 'caption'),
      pictures: [{ ...DOC.pictures![0], annotations: [], captions: [] }],
    } as DoclingDocument;
    expect(overlaysOf(bare).find((o) => o.id.includes('picture'))!.alt).toBe('Bar chart');

    const unclassified = {
      ...bare,
      pictures: [{ ...DOC.pictures![0], annotations: [], captions: [], classification: undefined }],
    } as DoclingDocument;
    expect(overlaysOf(unclassified).find((o) => o.id.includes('picture'))!.alt).toBeUndefined();
  });
});

describe('the annotation survives the schema', () => {
  it('is still there after parseTemplate', () => {
    // A field the Zod object does not declare is stripped without an error.
    const plan = mapDoclingToPagePlan(DOC, { importId: 'imp-sem', mode: 'semantic' });
    const applied = applyTemplateImportPlan(plan as never, undefined as never);
    const parsed = parseTemplate(applied as never);
    const overlays = parsed.pages.flatMap((p) => p.blocks.flatMap((b) => (b as { overlays?: unknown[] }).overlays ?? []));
    const annotated = overlays.filter((o) => (o as { semantics?: unknown }).semantics);
    expect(annotated.length).toBeGreaterThan(0);
    expect((overlays.find((o) => (o as { id: string }).id.includes('title')) as { semantics: { role: string } }).semantics)
      .toMatchObject({ role: 'title', headingLevel: 1 });
    expect((overlays.find((o) => (o as { id: string }).id.includes('picture')) as { alt?: string }).alt)
      .toBe('Bar chart of gross versus shaded income.');
  });
});
