/**
 * The sidebar renders admin entries by walking `adminGroup.itemTitles` and
 * looking each title up in `adminItems`. That means an item can be fully
 * defined — route, icon, module key — and still never appear, silently, because
 * its title was not added to the group list. Nothing fails, nothing warns; the
 * page is simply unreachable from the nav.
 *
 * That has already happened twice, so it is worth a test. The two sidebars keep
 * separate copies of both lists, so both are checked.
 *
 * Read as source text rather than imported: the arrays are module-private, and
 * exporting them purely for a test would widen a component's surface to satisfy
 * its own guard.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SIDEBARS = ['DashboardSidebar', 'MobileSidebar'] as const;

/**
 * Admin entries deliberately defined but not listed, and so not rendered.
 * Recorded here so the omission is a decision on the record rather than a
 * silent gap — not an endorsement of it. Removing a name from this list should
 * mean adding it to `adminGroup.itemTitles`.
 */
const UNLISTED_BY_DESIGN = new Set(['Builder / Developer Portal']);

function readLists(sidebar: string) {
  const source = readFileSync(`src/components/layout/${sidebar}.tsx`, 'utf8');

  const groupStart = source.indexOf('const adminGroup');
  const itemsStart = source.indexOf('const adminItems');
  expect(groupStart, `${sidebar} declares adminGroup`).toBeGreaterThan(-1);
  expect(itemsStart, `${sidebar} declares adminItems`).toBeGreaterThan(groupStart);

  const titles = [...source.slice(groupStart, itemsStart).matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]);
  // Bounded to the adminItems literal so the AML array below it is not swept in.
  const itemsBlock = source.slice(itemsStart, source.indexOf('];', itemsStart));
  const items = [...itemsBlock.matchAll(/\{ title: '([^']+)', url:/g)].map((m) => m[1]);

  return { titles, items };
}

describe.each(SIDEBARS)('%s admin navigation', (sidebar) => {
  const { titles, items } = readLists(sidebar);

  it('defines both lists', () => {
    expect(titles.length).toBeGreaterThan(0);
    expect(items.length).toBeGreaterThan(0);
  });

  it('renders every admin item it defines', () => {
    const listed = new Set(titles);
    const unrendered = items.filter((title) => !listed.has(title) && !UNLISTED_BY_DESIGN.has(title));
    expect(unrendered).toEqual([]);
  });

  it('lists no title without a matching item', () => {
    // The other direction: a rename or typo leaves a title that resolves to
    // nothing, which also fails silently.
    const defined = new Set(items);
    expect(titles.filter((title) => !defined.has(title))).toEqual([]);
  });

  it('reaches the Workflow Playground', () => {
    expect(items).toContain('Workflow Playground');
    expect(titles).toContain('Workflow Playground');
  });
});
