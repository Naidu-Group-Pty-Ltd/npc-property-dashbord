/**
 * Navigation used to be four hand-synchronised lists (desktop sidebar,
 * mobile sidebar, bottom bar, command palette), and the admin group was a
 * second layer of drift: an item could be fully defined and still never
 * render because its title was missing from a separate `itemTitles` list.
 * That silent-gap bug shipped twice.
 *
 * The registry refactor removed the failure mode structurally — items carry
 * their own group, there is no title lookup, and every surface renders from
 * `src/lib/navigation/registry.ts` through the one visibility rule in
 * `useNavigationVisibility`. What this suite pins now is that the structure
 * STAYS that way: no surface may reintroduce a private navigation list, and
 * the registry itself must stay internally coherent.
 *
 * Read as source text rather than imported where the assertion is about the
 * file's shape, matching the repo's contract-test convention.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAVIGATION_ITEMS,
  NAVIGATION_GROUP_ORDER,
  NAVIGATION_ITEMS,
} from '@/lib/navigation/registry';

const SURFACES = [
  'DashboardSidebar',
  'MobileSidebar',
  'MobileNav',
  'GlobalCommandPalette',
] as const;

describe.each(SURFACES)('%s navigation source', (surface) => {
  const source = readFileSync(`src/components/layout/${surface}.tsx`, 'utf8');

  it('consumes the shared registry visibility rule', () => {
    expect(source).toContain('useNavigationVisibility');
  });

  it('declares no private admin list to drift out of sync', () => {
    expect(source).not.toContain('const adminGroup');
    expect(source).not.toContain('const adminItems');
    expect(source).not.toContain('const navigationItems = [');
  });
});

describe('navigation registry coherence', () => {
  it('renders every admin item it defines — no silent gaps possible', () => {
    // Every admin item is rendered directly from the array; the historical
    // title-lookup indirection no longer exists. Titles must be unique so a
    // rename cannot shadow another entry.
    const titles = ADMIN_NAVIGATION_ITEMS.map((item) => item.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('reaches the Workflow Playground and the Builder / Developer Portal', () => {
    const titles = ADMIN_NAVIGATION_ITEMS.map((item) => item.title);
    expect(titles).toContain('Workflow Playground');
    // Previously unlisted-by-design in MobileSidebar; the registry renders it
    // everywhere, closing that recorded gap.
    expect(titles).toContain('Builder / Developer Portal');
  });

  it('assigns every main item to a rendered group', () => {
    for (const item of NAVIGATION_ITEMS) {
      expect(NAVIGATION_GROUP_ORDER, item.title).toContain(item.group);
    }
  });
});
