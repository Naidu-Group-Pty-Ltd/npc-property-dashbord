import { describe, expect, it } from 'vitest';
import { renderOverlay } from '../blocks/_shared.html';

const ctx = { data: {}, tokens: {} } as any;
const baseOverlay = {
  x: 0,
  y: 0,
  width: 200,
  height: 40,
  opacity: 1,
  rotation: 0,
};

describe('HTML overlay rendering', () => {
  it('escapes bound values inside designer-authored rich text', () => {
    const html = renderOverlay({
      ...baseOverlay,
      type: 'text',
      id: 'rich-bound-text',
      rich: true,
      content: '<strong>Description:</strong> {{property.description}}',
    } as any, {
      data: {
        property: {
          description: '<img src="http://169.254.169.254/latest/meta-data/">',
        },
      },
      tokens: {},
    } as any);

    expect(html).toContain('<strong>Description:</strong>');
    expect(html).toContain('&lt;img src=&quot;http://169.254.169.254/latest/meta-data/&quot;&gt;');
    expect(html).not.toContain('<img');
  });

  it('preserves literal designer-authored rich text', () => {
    const html = renderOverlay({
      ...baseOverlay,
      type: 'text',
      id: 'rich-literal-text',
      rich: true,
      content: '<strong>Trusted formatting</strong>',
    } as any, ctx);

    expect(html).toContain('<strong>Trusted formatting</strong>');
  });

  it('escapes text-on-path ids before writing SVG attributes', () => {
    const html = renderOverlay({
      ...baseOverlay,
      type: 'textOnPath',
      id: 'x\"/><script>globalThis.__xss_text=1</script><path id=\"y',
      content: 'Safe text',
      fontFamily: 'Helvetica',
      fontSize: 18,
      fontWeight: 'normal',
      color: '#000000',
      curve: 'arc-up',
      curvature: 0.5,
      letterSpacing: 0,
      startOffset: 0,
    } as any, ctx);

    expect(html).not.toContain('<script>');
    expect(html).toContain('txp-x&quot;/&gt;&lt;script&gt;');
  });

  it('escapes table style values before writing HTML attributes', () => {
    const html = renderOverlay({
      ...baseOverlay,
      type: 'table',
      id: 'table-1',
      columns: [{ key: 'name', label: 'Name' }],
      rows: [['Alice']],
      cellStyles: [{
        row: 0,
        col: 0,
        bg: '#fff\"><script>globalThis.__xss_table=1</script><td style=\"background:#fff',
      }],
    } as any, ctx);

    expect(html).not.toContain('<script>');
    expect(html).toContain('background:#fff&quot;&gt;&lt;script&gt;');
    expect(html).toContain('Alice');
  });
});
