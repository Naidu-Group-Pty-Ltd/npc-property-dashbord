import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

describe('portal messages authorization contract', () => {
  it('keeps the staff messages route behind the conversations module guard', () => {
    expect(appSource).toContain(
      '<Route path="messages" element={<ModuleGuard moduleKey="conversations"><Messages /></ModuleGuard>} />',
    );
  });
});
