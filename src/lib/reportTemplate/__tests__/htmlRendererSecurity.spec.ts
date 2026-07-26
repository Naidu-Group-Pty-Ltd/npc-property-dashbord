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

function renderLinkedBlock(link: Record<string, unknown>, bookmark?: Record<string, unknown>): string {
  const template = parseTemplate({
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [
      {
        id: 'p1', name: 'Page 1', size: { width: 595, height: 842 }, background: {},
        blocks: [{ id: 'b1', type: 'free', props: {}, overlays: [], link, bookmark }],
      },
      { id: 'p2', name: 'Page 2', size: { width: 595, height: 842 }, background: {}, blocks: [] },
    ],
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

  it('escapes link and bookmark values before embedding them in attributes', () => {
    const html = renderLinkedBlock(
      { href: 'https://example.invalid/" data-injected="yes', title: 'A " title' },
      { name: 'toc', label: 'Chapter " data-injected="yes', level: 2 },
    );

    expect(html).toContain('href="https://example.invalid/&quot; data-injected=&quot;yes"');
    expect(html).toContain('title="A &quot; title"');
    expect(html).toContain('bookmark-label:&#39;Chapter &quot; data-injected=&quot;yes&#39;;bookmark-level:2;');
    expect(html).not.toContain(' data-injected="yes"');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<img src=x>', 'file:///etc/passwd'])(
    'does not render links using the unsafe %s scheme',
    (href) => {
      const html = renderLinkedBlock({ href });

      expect(html).not.toContain(`<a href="${href}`);
    },
  );

  it('resolves page links without crashing', () => {
    expect(renderLinkedBlock({ href: 'page:p2' })).toContain('href="#tpl-page-1" target="_self"');
  });
});
