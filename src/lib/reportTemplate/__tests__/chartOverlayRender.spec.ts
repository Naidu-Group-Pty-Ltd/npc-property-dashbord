/**
 * W3 — the chart overlay renders through the SAME renderers as chart blocks.
 *
 * Imported charts were flattened to an image overlay even when Docling had
 * classified the picture as `bar_chart` — the class was carried in meta and
 * then dropped. This suite covers the destination that makes one editable.
 *
 * The delegation matters as much as the output: eleven data-bound chart
 * renderers already existed as blocks, and duplicating them for overlays would
 * have produced two implementations that drift. An imported chart and an
 * authored chart must be the same pixels.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { parseTemplate, type ReportTemplate } from '@/lib/reportTemplate/templateSchema';

function templateWithChart(overlay: Record<string, unknown>): ReportTemplate {
  return parseTemplate({
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    slots: {},
    meta: {},
    pages: [{
      id: 'p1',
      name: 'Page 1',
      size: { width: 595, height: 842 },
      background: {},
      blocks: [{
        id: 'b1', type: 'free', props: {}, locked: false, name: 'free',
        overlays: [{
          id: 'chart1', type: 'chart',
          x: 24, y: 80, width: 400, height: 200,
          rotation: 0, opacity: 1,
          ...overlay,
        }],
      }],
    }],
  });
}

const SERIES = [
  { label: 'Sales', value: 120 },
  { label: 'Rentals', value: 80 },
  { label: 'Managed', value: 45 },
];

describe('chart overlay — schema', () => {
  it('parses with inline series and defaults to a bar chart', () => {
    const t = templateWithChart({ series: SERIES });
    const o = t.pages[0].blocks[0].overlays[0] as unknown as Record<string, unknown>;
    expect(o.type).toBe('chart');
    expect(o.chartKind).toBe('bar');
    expect(o.series).toHaveLength(3);
  });

  it('carries the preservation stamp that records how it got here', () => {
    const t = templateWithChart({
      series: SERIES,
      chartPreservation: {
        version: 'chart-arbitration-v1',
        renderMode: 'verified-native-chart',
        defects: [],
        manualReviewRequired: false,
        sourceCropUrl: 'https://example.test/crop.png',
        axisScaleR2: 0.9999,
      },
    });
    const o = t.pages[0].blocks[0].overlays[0] as unknown as {
      chartPreservation: { renderMode: string; sourceCropUrl: string };
    };
    // The crop is retained even when the chart renders natively, so review can
    // compare the reconstruction against the pixels it came from.
    expect(o.chartPreservation.renderMode).toBe('verified-native-chart');
    expect(o.chartPreservation.sourceCropUrl).toBe('https://example.test/crop.png');
  });

  it('never admits a chart kind that has no renderer behind it', () => {
    // parseTemplate salvages rather than throws — "salvage is for age, not for
    // attacks" — so the guarantee is that an unrenderable kind cannot survive
    // parsing and reach the renderer, not that parsing explodes.
    const t = templateWithChart({ chartKind: 'sankey', series: SERIES });
    const overlays = t.pages[0]?.blocks?.[0]?.overlays ?? [];
    const survivor = overlays.find((o) => o.type === 'chart') as
      | { chartKind?: string } | undefined;
    expect(survivor?.chartKind).not.toBe('sankey');
  });

  it('a chart kind with no renderer produces no output rather than broken markup', () => {
    // Belt and braces: even if such an overlay were constructed directly, the
    // renderer lookup misses and emits nothing.
    const t = templateWithChart({ series: SERIES });
    (t.pages[0].blocks[0].overlays[0] as unknown as Record<string, unknown>).chartKind = 'sankey';
    const { html } = renderTemplateToHtml(t, { data: {} });
    expect(html).not.toContain('Sales');
  });
});

describe('chart overlay — rendering', () => {
  it('emits real SVG from the existing bar renderer, not a placeholder', () => {
    const { html } = renderTemplateToHtml(templateWithChart({ series: SERIES }), { data: {} });
    expect(html).toContain('<svg');
    // Labels from the inline series must reach the output.
    expect(html).toContain('Sales');
    expect(html).toContain('Rentals');
    // Bars are rects; a placeholder would have none.
    expect(html).toMatch(/<rect[^>]*>/);
  });

  it('renders each supported kind through its own renderer', () => {
    for (const chartKind of ['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'radar'] as const) {
      const { html } = renderTemplateToHtml(
        templateWithChart({ chartKind, series: SERIES }), { data: {} },
      );
      expect(html, chartKind).toContain('<svg');
    }
  });

  it('renders a title when one was captured from the source', () => {
    const { html } = renderTemplateToHtml(
      templateWithChart({ series: SERIES, title: 'Portfolio mix' }), { data: {} },
    );
    expect(html).toContain('Portfolio mix');
  });

  it('an empty series degrades to empty output rather than throwing', () => {
    expect(() => renderTemplateToHtml(templateWithChart({ series: [] }), { data: {} })).not.toThrow();
  });

  it('is vector output — no raster embedded', () => {
    // WeasyPrint gets real SVG, which is the whole reason these renderers exist.
    const { html } = renderTemplateToHtml(templateWithChart({ series: SERIES }), { data: {} });
    expect(html).not.toContain('data:image/png');
    expect(html).not.toContain('<img');
  });
});
