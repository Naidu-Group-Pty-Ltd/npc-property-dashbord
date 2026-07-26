import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('finance portal client creation permission contract', () => {
  it('allows purchase-file editing without granting archive permission', () => {
    expect(functionSource).toContain("'purchase_files', 'client_tasks'");
    expect(functionSource).toContain(
      "acc[key] = { view: true, edit: true, delete: key !== 'purchase_files' };",
    );
    expect(functionSource).not.toContain(
      'acc[key] = { view: true, edit: true, delete: true };',
    );
  });
});
