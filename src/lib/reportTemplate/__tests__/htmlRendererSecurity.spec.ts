import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { parseTemplate } from '../templateSchema';

describe('HTML renderer security', () => {
  it('keeps gradient stop content inside the page style attribute', () => {
    const marker = 'window.__GRADIENT_XSS__=1';
    const template = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'page-1',
        name: 'Page 1',
        size: { width: 595, height: 842 },
        background: {
          gradient: {
            type: 'linear',
            angle: 180,
            stops: [
              { color: `red\";><script>${marker}</script><section style=\"`, position: 0 },
              { color: '#ffffff', position: 100 },
            ],
          },
        },
        blocks: [],
      }],
    });

    const { html } = renderTemplateToHtml(template, { data: {}, editorMode: false });

    expect(html).not.toContain(`<script>${marker}</script>`);
    expect(html).toContain(`red&quot;;&gt;&lt;script&gt;${marker}&lt;/script&gt;`);
    expect(html.match(/<section\b/g)).toHaveLength(1);
  });
});
