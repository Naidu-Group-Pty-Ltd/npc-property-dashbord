/**
 * The Compliance Passport must be REACHABLE — not merely built.
 *
 * The Passport shipped correct and invisible: its only mount was a case
 * workspace behind an unrelated cutover flag, so no navigation path led to
 * it and it read as missing. These assertions pin the routes, the module
 * navigation and the Compliance Home queues that make it findable, in both
 * AML shells, so a future refactor cannot quietly orphan the page again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(repo, p), 'utf8');

const app = read('src/App.tsx');
const layout = read('src/components/aml/AmlLayout.tsx');
const homeV2 = read('src/pages/aml/AmlOverview.tsx');
const homeV3 = read('src/pages/aml/AmlComplianceHomeV3.tsx');

describe('Compliance Passport reachability', () => {
  it('has a Command Centre route under the AML module', () => {
    expect(app).toContain('path="passport"');
    expect(app).toContain('AmlPassports');
    // Guarded like every other AML page — visibility never bypasses access.
    expect(app).toMatch(/path="passport"[^\n]*AmlGuard capability="aml\.view"/);
  });

  it('has a client-portal booklet route', () => {
    expect(app).toContain('path="aml/passport"');
    expect(app).toContain('PortalPassport');
  });

  it('appears in BOTH AML navigation shells', () => {
    // Two nav configs exist (legacy + V3); a destination in only one of them
    // is invisible to whichever shell the tenant is actually running.
    const hits = layout.match(/to: "\/admin\/aml\/passport"/g) ?? [];
    expect(hits.length).toBe(2);
    expect(layout).toContain('"Compliance Passport"');
  });

  it('appears as a queue on BOTH Compliance Home surfaces', () => {
    for (const [name, source] of [['V2', homeV2], ['V3', homeV3]] as const) {
      expect(source, `${name} Compliance Home`).toContain('/admin/aml/passport');
      expect(source, `${name} Compliance Home`).toContain('Compliance Passports');
    }
  });

  it('every secondary destination is also in its workspace `paths`', () => {
    // Being listed in `secondary` is not enough to be integrated. The shell
    // resolves the ACTIVE workspace from `paths` and renders the secondary
    // strip from that workspace alone — so a destination absent from `paths`
    // opens a page with no secondary nav, highlighting Compliance Home while
    // you stand on another page. The Passport shipped in `secondary` only, and
    // that is why it read as "not integrated into the AML tab".
    //
    // Asserted for the whole nav rather than for the Passport, because the
    // trap belongs to the shell, not to this page.
    // Split on the workspace's own `key:` so a chunk can never pair one
    // workspace's paths with the next one's secondary list.
    const chunks = layout.split(/\bkey:\s*"/).slice(1);
    let checked = 0;
    for (const chunk of chunks) {
      const pathsBlock = chunk.match(/paths:\s*\[([\s\S]*?)\]/)?.[1];
      const secondaryBlock = chunk.match(/secondary:\s*\[([\s\S]*?)\]/)?.[1];
      if (!pathsBlock || !secondaryBlock) continue;
      const paths = [...pathsBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      const dests = [...secondaryBlock.matchAll(/to:\s*"([^"]+)"/g)].map((m) => m[1]);
      for (const dest of dests) {
        checked += 1;
        expect(paths, `${dest} is a secondary link but not in its workspace paths`)
          .toContain(dest);
      }
    }
    // Guard the guard: a regex that matched nothing would pass silently.
    expect(checked).toBeGreaterThan(8);
  });

  it('the page renders the shared Command projection — not a second implementation', () => {
    const page = read('src/pages/aml/AmlPassports.tsx');
    expect(page).toContain('CommandPassportSection');
    // One passport projection, fetched per opened customer, never preloaded
    // for the whole register.
    expect(page).not.toMatch(/getPassportView/);
  });
});
