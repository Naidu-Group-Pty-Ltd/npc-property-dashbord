import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { makeBlankTemplate } from '../templateSchema';

describe('renderTemplateToHtml style element security', () => {
  it('prevents imported font tokens from closing the style element', () => {
    const template = makeBlankTemplate();
    template.tokens.fonts = {
      imported: '"</StYlE><script>window.__fontTokenXss = true</script><style>"',
    };

    const { css, html } = renderTemplateToHtml(template, { data: {}, editorMode: true });

    // Preserve the generated CSS contract for non-HTML consumers.
    expect(css).toContain('</StYlE><script>');
    // Only the renderer-owned editor runtime may appear as an HTML script.
    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(html).not.toContain('</StYlE><script>');
    expect(html).toContain('\\3C /style><script>');
  });

  it('applies the same boundary protection to appended custom CSS', () => {
    const template = makeBlankTemplate();
    const { html } = renderTemplateToHtml(template, {
      data: {},
      customCss: '</style><script>window.__customCssXss = true</script><style>',
    });

    expect(html).not.toContain('</style><script>');
    expect(html).not.toMatch(/<script/gi);
    expect(html).toContain('\\3C /style><script>');
  });
});
