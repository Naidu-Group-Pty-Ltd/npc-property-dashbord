/**
 * What the semantic annotation changes in the rendered document.
 *
 * `render-template-pdf` asks WeasyPrint for `pdf/ua-1` with `tagged: true`, and
 * WeasyPrint builds the structure tree from the ELEMENT NAME. Verified against
 * WeasyPrint 69 on the pages this suite describes:
 *
 *     before   /Document → [ /Div /Div /Figure /Div … ]        (flat, no headings)
 *     after    /Document → [ /H1 /H2 /Div /H3 /Figure(/Alt) …]
 *     pixels   identical, SHA-256 of the 300 DPI raster
 *
 * The pixel result is the constraint, not a bonus: this stage may add meaning
 * and must not move a single point.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { SEMANTIC_ANNOTATION_VERSION } from '@/lib/reportTemplate/pdfImport/semanticRole.pure';

const W = 595;
const H = 842;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const text = (over: Record<string, unknown> = {}) => ({
  id: 'ov', type: 'text', x: 48, y: 96, width: 400, height: 24, rotation: 0, opacity: 1,
  content: 'Executive Summary', fontFamily: 'Helvetica', fontSize: 14, fontWeight: 'bold',
  fontStyle: 'normal', color: '#111111', align: 'left', lineHeight: 1.3, letterSpacing: 0,
  ...over,
});

const semantics = (role: string, headingLevel?: number) => ({
  semantics: { version: SEMANTIC_ANNOTATION_VERSION, role, ...(headingLevel ? { headingLevel } : {}) },
});

function render(overlays: unknown[]): string {
  return renderTemplateToHtml({
    id: 't', name: 'semantics', version: 1,
    page: { width: W, height: H, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    theme: { colors: { background: '#FFFFFF', text: '#111111' } },
    pages: [{
      id: 'p1', name: 'Page 1', size: { width: W, height: H }, background: { color: '#FFFFFF' },
      blocks: [{ id: 'free-1', type: 'free', overlays }],
    }],
  } as never, {}).html;
}

describe('a heading is emitted as a heading', () => {
  it('renders a title as h1 and a section header at its own level', () => {
    expect(render([text({ ...semantics('title', 1) })])).toContain('<h1 ');
    expect(render([text({ ...semantics('heading', 2) })])).toContain('<h2 ');
    expect(render([text({ ...semantics('heading', 5) })])).toContain('<h5 ');
  });

  it('leaves every other role as a div', () => {
    for (const role of ['body', 'caption', 'footnote', 'pageHeader', 'pageFooter', 'listItem', 'code']) {
      const html = render([text(semantics(role))]);
      expect(html, role).not.toMatch(/<h[1-6][ >]/);
      expect(html, role).toContain('<div ');
    }
  });

  it('changes nothing for an overlay with no annotation', () => {
    // Every template that predates this stage, and every import path that emits
    // no labels, must render byte-identically.
    expect(render([text()])).toBe(render([text()]));
    expect(render([text()])).not.toMatch(/<h[1-6][ >]/);
  });

  it('zeroes the margin the heading element would otherwise inherit', () => {
    // The box is absolutely positioned, so a UA-stylesheet margin moves it.
    // Everything else h1–h6 sets — font-size, font-weight — is already written
    // inline by the shared declaration builder.
    const html = render([text({ ...semantics('title', 1) })]);
    expect(html).toMatch(/<h1 [^>]*style="[^"]*margin:0;"/);
  });

  it('gives the flex container a real child instead of an anonymous one', () => {
    // Vertical alignment makes this box a flex container; WeasyPrint emits a
    // structure element for the anonymous flex item it then creates, and that
    // element inherits the tag — producing /H1 nested inside /H1. An explicit
    // span costs nothing and is pixel-identical.
    expect(render([text({ ...semantics('title', 1) })]))
      .toMatch(/<h1 [^>]*><span>Executive Summary<\/span><\/h1>/);
  });

  it('refuses the heading element when the copy was split into paragraphs', () => {
    // `<p>` inside a heading is invalid, and a parser recovering from it closes
    // the heading early and leaves the rest of the copy outside the element.
    const html = render([text({ content: 'First para.\n\nSecond para.', ...semantics('heading', 2) })]);
    expect(html).not.toMatch(/<h2[ >]/);
    expect(html).toContain('<p style=');
  });

  it('keeps the overlay id on the element the editor queries', () => {
    // `[data-overlay-id]` is how the canvas mirrors live drag geometry and how
    // the V2 DOM-evidence walker finds a box. The id must survive the tag swap.
    expect(render([text({ ...semantics('title', 1) })])).toContain('<h1 data-overlay-id="ov"');
  });
});

describe('a figure carries its alternative text', () => {
  const image = (over: Record<string, unknown> = {}) => ({
    id: 'fig', type: 'image', x: 48, y: 200, width: 200, height: 120,
    rotation: 0, opacity: 1, src: PNG, fit: 'contain', ...over,
  });

  it('emits alt, which WeasyPrint writes as the figure\'s /Alt', () => {
    // A /Figure with no /Alt is a hard PDF/UA failure, and every imported
    // picture was one.
    expect(render([image({ alt: 'Bar chart of income by source' })]))
      .toContain('alt="Bar chart of income by source"');
  });

  it('omits the attribute rather than emitting an empty one', () => {
    expect(render([image()])).not.toContain(' alt=');
    expect(render([image({ alt: '   ' })])).not.toContain(' alt=');
    expect(render([image({ alt: 42 })])).not.toContain(' alt=');
  });

  it('escapes alternative text like any other untrusted string', () => {
    const html = render([image({ alt: '"><script>alert(1)</script>' })]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;');
  });
});
