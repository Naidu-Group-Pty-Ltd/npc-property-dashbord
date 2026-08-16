import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/solicitor-portal-matters/index.ts'),
  'utf8',
);
const sharedSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/_shared/legalMatters.ts'),
  'utf8',
);

describe('solicitor portal matter list security contract', () => {
  /**
   * The scoping moved from client ids to matter ids.
   *
   * This asserted `.in('client_id', viewableClientIds)` twice. The function now
   * resolves `listAccessibleMatterIds(...)` — which reads
   * `solicitor_matter_access` under the matter-access-v1 flag and falls back to
   * the assigned-client set otherwise — and filters `.in('id',
   * accessibleMatterIds)`. Narrower, not looser: it is the matters the
   * solicitor may see rather than every matter of every client they touch.
   * `can(matrix, 'matters', 'view')` still gates the client-level path.
   */
  it('scopes list and stats queries to the matters this solicitor may view', () => {
    expect(functionSource).toContain("can(matrix, 'matters', 'view')");
    expect(functionSource).toContain('listAccessibleMatterIds(');
    expect(functionSource.match(/\.in\('id', accessibleMatterIds\)/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(1);
    // And the firm boundary is still applied alongside it.
    expect(functionSource).toContain(".eq('firm_id', me.firm_id)");
  });

  it('keeps the reduced list projection free of staff-only and detail fields', () => {
    const projection = sharedSource.match(
      /export const SOLICITOR_MATTER_LIST_SELECT = `([\s\S]*?)`;/,
    )?.[1];
    expect(projection).toBeTruthy();
    expect(projection).not.toMatch(
      /internal_notes|risk_notes|shared_summary|purchase_price|deposit_amount|title_reference|pexa_workspace_id/,
    );
  });

  /**
   * The half that is a live question, not a stale assertion.
   *
   * `SOLICITOR_MATTER_LIST_SELECT` — "Minimal matter summary returned by
   * solicitor portal list surfaces", twelve columns — is referenced by NOTHING
   * but this file. `list_matters` selects `LEGAL_MATTER_SOLICITOR_LIST_SELECT`,
   * which is the 38-column shared projection, so the solicitor list response
   * carries `purchase_price`, `deposit_amount`, `deposit_percent`,
   * `title_reference`, `pexa_workspace_id`, `risk_notes` and `shared_summary`.
   *
   * It is NOT a regression: the constant and this test arrived in the same
   * merge (PR #2085) and the constant has never been adopted. And it cannot be
   * adopted mechanically, because two live list surfaces read fields it would
   * remove:
   *
   *   - `SolicitorDashboard.tsx:166` renders `m.risk_notes`
   *   - `SolicitorPipeline.tsx:64` sums `m.purchase_price` for each stage
   *
   * So minimising the list means either dropping those two features, giving
   * them their own scoped read, or amending the contract. That is a product and
   * privacy decision about what a third-party firm sees, and it is recorded
   * here rather than resolved by a test.
   */
  it.todo('list_matters selects SOLICITOR_MATTER_LIST_SELECT — see the note above');
});
