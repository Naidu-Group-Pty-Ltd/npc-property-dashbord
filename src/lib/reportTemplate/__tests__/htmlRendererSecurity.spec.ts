import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { makeBlankTemplate } from '../templateSchema';

describe('renderTemplateToHtml style element safety', () => {
  it('prevents font tokens from closing the generated style element', () => {
    const template = makeBlankTemplate();
    template.tokens = {
      ...template.tokens,
      fonts: {
        imported: '</style><script>globalThis.__fontTokenXss = true</script><style>',
      },
    };

    const { html } = renderTemplateToHtml(template, { data: {} });

    expect(html).not.toContain('</style><script>');
    expect(html).not.toContain('<script>globalThis.__fontTokenXss');
    expect(html).toContain('\\3C /style>\\3C script>globalThis.__fontTokenXss');
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html.match(/<\/style>/g)).toHaveLength(1);
  });
});
