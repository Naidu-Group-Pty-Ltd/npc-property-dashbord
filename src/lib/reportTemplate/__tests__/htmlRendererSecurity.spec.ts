import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { parseTemplate } from '../templateSchema';

function renderShape(fill: string): string {
  const template = parseTemplate({
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [{
      id: 'p1',
      name: 'Page 1',
      size: { width: 595, height: 842 },
      background: {},
      blocks: [{
        id: 'b1',
        type: 'free',
        props: {},
        overlays: [{
          id: 's1',
          type: 'shape',
          shape: 'rect',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill,
        }],
      }],
    }],
  });

  return renderTemplateToHtml(template, { data: {}, editorMode: false }).html;
}

describe('HTML renderer security', () => {
  it('preserves valid CSS gradient fills', () => {
    const gradient = 'linear-gradient(135deg, #0A2540 0%, #1A3A5A 100%)';

    expect(renderShape(gradient)).toContain(`background:${gradient}`);
  });

  it('escapes gradient fills before embedding them in a style attribute', () => {
    const html = renderShape('linear-gradient(red, blue)";><script>globalThis.pwned=true</script><div style="');

    expect(html).not.toContain('<script>globalThis.pwned=true</script>');
    expect(html).toContain('&quot;;&gt;&lt;script&gt;globalThis.pwned=true&lt;/script&gt;&lt;div style=&quot;');
  });
});
