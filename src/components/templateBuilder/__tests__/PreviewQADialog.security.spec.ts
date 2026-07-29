import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('PreviewQADialog HTML preview isolation', () => {
  it('sandboxes rendered template HTML without granting any capabilities', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../PreviewQADialog.tsx', import.meta.url)),
      'utf8',
    );
    const previewIframe = source.match(/<iframe\s+title="html-preview"[^>]*\/>/)?.[0];

    expect(previewIframe).toBeDefined();
    expect(previewIframe).toMatch(/\ssandbox=""/);
    expect(previewIframe).not.toMatch(/allow-scripts|allow-same-origin/);
  });
});
