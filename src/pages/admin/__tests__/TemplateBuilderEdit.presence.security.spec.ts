import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('TemplateBuilderEdit presence security', () => {
  it('does not activate the unauthorised public template presence channel', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../TemplateBuilderEdit.tsx', import.meta.url)),
      'utf8',
    );

    expect(source).not.toContain('<TemplatePresenceBar');
    expect(source).not.toContain("from '@/components/templateBuilder/TemplatePresenceBar'");
  });
});
