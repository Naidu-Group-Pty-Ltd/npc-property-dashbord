import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pipelineSource = readFileSync(new URL('./SolicitorPipeline.tsx', import.meta.url), 'utf8');
const functionSource = readFileSync(
  new URL('../../../supabase/functions/solicitor-portal-intelligence/index.ts', import.meta.url),
  'utf8',
);

describe('solicitor pipeline matter status security', () => {
  it('prevents terminal matter cards from initiating a portal status move', () => {
    expect(pipelineSource).toContain(
      "const TERMINAL_STATUSES = new Set<LegalMatterStatus>(['settled', 'post_settlement', 'terminated'])",
    );
    expect(pipelineSource).toContain('draggable={!isTerminal}');
    expect(pipelineSource).toContain('TERMINAL_STATUSES.has(matter.status)');
  });

  it('enforces terminal-state and settlement bookkeeping in move_matter', () => {
    const moveMatterBranch = functionSource.match(
      /if \(operation === 'move_matter'\) \{([\s\S]*?)\n\s{4}\/\/ ─+ KPIs/,
    )?.[1];

    expect(moveMatterBranch).toBeDefined();
    expect(moveMatterBranch).toContain('TERMINAL_STATUSES.has(matter.status)');
    expect(moveMatterBranch).toContain(
      "error: 'This matter is closed. Contact NPC to reopen it.'",
    );
    expect(moveMatterBranch).toContain("status === 'settled'");
    expect(moveMatterBranch).toContain('patch.actual_settlement_date');
    expect(moveMatterBranch).toContain('patch.closed_at');
    expect(moveMatterBranch).toContain('.update(patch)');
  });
});
