import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { parseTemplate } from '../templateSchema';

describe('HTML renderer style isolation', () => {
  it('does not let imported font tokens close the document style element', () => {
    const payload = '"</style><script>window.__fontTokenXss = true</script><style>"';
    const template = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: { imported: payload }, spacing: {} },
      pages: [{
        id: 'page-1',
        name: 'Imported page',
        size: { width: 595, height: 842 },
        blocks: [],
      }],
    });

    const { css, html } = renderTemplateToHtml(template);

    expect(css).toContain(payload);
    expect(html).not.toContain('</style><script>');
    expect(html).not.toContain('<script>window.__fontTokenXss');
    expect(html).toContain('\\3C /style>\\3C script>');
  });
});
