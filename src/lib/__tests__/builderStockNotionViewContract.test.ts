/**
 * BUILDER STOCK — THE LINKED NOTION VIEW IS THE STOCK LIST.
 *
 * A Notion view is a QUERY over a collection — a filter, a sort, a grouping —
 * and the rows a reader sees are the rows that query returns. Two rules follow,
 * and the importer honoured neither.
 *
 * ONE. `?v=` NAMES THE VIEW, AND IT IS HONOURED OR THE READ FAILS. The
 * selection used to be
 *
 *     viewIds.includes(preferred) ? preferred : (viewIds[0] ?? preferred)
 *
 * so a link naming a view the page does not have was served the page's FIRST
 * view instead — a different set of properties, silently, with nothing
 * reporting it. Which rows belong to a stock list is the one question an
 * importer may never guess at: a wrong answer replaces a builder's stock with
 * somebody else's.
 *
 * TWO. THE VIEW'S OWN QUERY TRAVELS WITH IT. `queryCollection` was sent
 * `sortQuery: []` and no filter, which asks the COLLECTION rather than the
 * view — so a builder linking a filtered view of a large database would have
 * every row of it imported. It is passed verbatim now rather than translated:
 * Notion supplies the canonical structure, and re-deriving it would be a
 * second implementation of somebody else's filter language, free to disagree
 * with the page the builder is looking at.
 *
 * These are written against arbitrary views, because the contract is about
 * every future Builder Portal upload rather than any page in front of us today.
 */
import { describe, expect, it } from 'vitest';

import {
  describeNotionPage, preferredNotionViewId,
} from '../../../supabase/functions/_shared/builderStock/notionRecordMap.pure';

const PAGE = 'aaaaaaaa-0000-4000-8000-000000000001';
const COLLECTION = 'bbbbbbbb-0000-4000-8000-000000000002';
const SPACE = 'cccccccc-0000-4000-8000-000000000003';
const VIEW_A = 'dddddddd-0000-4000-8000-00000000000a';
const VIEW_B = 'dddddddd-0000-4000-8000-00000000000b';
const VIEW_ABSENT = 'eeeeeeee-0000-4000-8000-0000000000ff';

/** A filter of the shape Notion actually stores on a view's `query2`. */
const VIEW_B_QUERY = {
  filter: {
    operator: 'and',
    filters: [{
      property: 'ZVPn',
      filter: { operator: 'enum_is', value: { type: 'exact', value: 'Available' } },
    }],
  },
  sort: [{ property: 'title', direction: 'ascending' }],
};

function recordMap(over: { viewIds?: string[] } = {}) {
  return {
    block: {
      [PAGE]: {
        value: {
          value: {
            id: PAGE,
            type: 'collection_view_page',
            collection_id: COLLECTION,
            space_id: SPACE,
            view_ids: over.viewIds ?? [VIEW_A, VIEW_B],
            properties: { title: [['Stock']] },
          },
        },
      },
    },
    collection_view: {
      [VIEW_A]: { value: { value: { id: VIEW_A, type: 'table', name: 'All' } } },
      [VIEW_B]: { value: { value: { id: VIEW_B, type: 'table', name: 'Available', query2: VIEW_B_QUERY } } },
    },
    collection: {
      [COLLECTION]: { value: { value: { id: COLLECTION, name: [['Stock']] } } },
    },
  } as never;
}

describe('the view named on the link', () => {
  it('reads the view id out of ?v= whatever the slug looks like', () => {
    expect(preferredNotionViewId(`https://x.notion.site/Page-30ccabc?v=${VIEW_B.replace(/-/g, '')}`))
      .toBe(VIEW_B);
    expect(preferredNotionViewId('https://x.notion.site/Page-30ccabc')).toBeNull();
  });

  it('honours the requested view even when it is not the first', () => {
    const shape = describeNotionPage(recordMap(), PAGE, VIEW_B);
    expect(shape.collectionViewId).toBe(VIEW_B);
    expect(shape.requestedViewMissing).toBe(false);
  });

  it('FAILS CLOSED when the requested view is not on the page', () => {
    const shape = describeNotionPage(recordMap(), PAGE, VIEW_ABSENT);
    // Not view A, not any view — nothing. The caller refuses the source read.
    expect(shape.collectionViewId).toBeNull();
    expect(shape.requestedViewMissing).toBe(true);
  });

  it('never substitutes the first view for an explicitly requested one', () => {
    const shape = describeNotionPage(recordMap(), PAGE, VIEW_ABSENT);
    expect(shape.collectionViewId).not.toBe(VIEW_A);
    expect(shape.collectionViewId).not.toBe(VIEW_B);
  });

  it('with no ?v= it takes the page\'s own first view, and says nothing is missing', () => {
    const shape = describeNotionPage(recordMap(), PAGE, null);
    expect(shape.collectionViewId).toBe(VIEW_A);
    expect(shape.requestedViewMissing).toBe(false);
  });

  it('a page with no views at all is not a missing REQUEST when none was made', () => {
    const shape = describeNotionPage(recordMap({ viewIds: [] }), PAGE, null);
    expect(shape.collectionViewId).toBeNull();
    expect(shape.requestedViewMissing).toBe(false);
  });
});

describe('the view\'s own query', () => {
  it('carries the selected view\'s filter and sort verbatim', () => {
    const shape = describeNotionPage(recordMap(), PAGE, VIEW_B);
    // Verbatim: not re-derived, not simplified, not re-ordered.
    expect(shape.viewQuery).toEqual(VIEW_B_QUERY);
  });

  it('carries the query of the view that was SELECTED, not of another', () => {
    // View A has no query of its own; selecting it must not borrow B's filter.
    const shape = describeNotionPage(recordMap(), PAGE, VIEW_A);
    expect(shape.collectionViewId).toBe(VIEW_A);
    expect(shape.viewQuery).toBeNull();
  });

  it('carries nothing when the view was refused', () => {
    const shape = describeNotionPage(recordMap(), PAGE, VIEW_ABSENT);
    expect(shape.viewQuery).toBeNull();
  });

  it('the query is spread into the collection request, replacing the empty one', () => {
    /*
     * The request is built inside an edge function no test can import, so the
     * contract is pinned on the source — the way this repository already pins
     * its other deploy-shaped invariants.
     */
    const source = readSource();
    const call = source.slice(
      source.indexOf("'/api/v3/queryCollection"),
      source.indexOf("'/api/v3/queryCollection") + 1400);
    expect(call).toContain('...(shape.viewQuery ?? {})');
    // The empty query that asked the collection instead of the view is gone.
    expect(call).not.toContain('sortQuery: []');
  });

  it('a link naming a view the page lacks refuses the import outright', () => {
    const portal = readPortalSource();
    expect(portal).toContain("recovery.reason === 'requested_view_missing'");
    expect(portal).toContain('notion_view_not_found');
  });

  it('the refusal is a DECLARED diagnostic, not a field invented at the call site', () => {
    /*
     * A refusal nobody can see afterwards is the same operator conversation
     * over again. The field is on `NotionRecoveryDiagnostics` and defaulted in
     * `blankDiagnostics`, so every recovery answers the question — and the
     * edge type-check enforces it rather than a stray property assignment
     * silently doing nothing.
     */
    const source = readSource();
    expect(source).toContain('requested_view_missing: boolean;');
    expect(source).toContain('requested_view_missing: false,');
    expect(source).toContain('diagnostics.requested_view_missing = true;');
  });
});

function readSource(): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { resolve } = require('node:path') as typeof import('node:path');
  return readFileSync(resolve(
    __dirname, '../../../supabase/functions/_shared/builderStock/notionPublicContent.ts'), 'utf8');
}

function readPortalSource(): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { resolve } = require('node:path') as typeof import('node:path');
  return readFileSync(resolve(
    __dirname, '../../../supabase/functions/builder-portal-stock/index.ts'), 'utf8');
}
