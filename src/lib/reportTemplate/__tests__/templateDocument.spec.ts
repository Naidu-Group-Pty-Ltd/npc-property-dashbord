/**
 * The call every format's delivery path makes before its own route.
 *
 * The rule this file exists to hold: **a templated document is an improvement
 * on a working path, so it may never be the reason somebody cannot get their
 * file.** A refused adapter, no activated template, a render that failed, a
 * signed URL that will not fetch, an empty body — every one of them has to
 * answer null, because the caller's next line is the route that has produced
 * this document for the life of the product.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  routed: null as { fileUrl: string; fileName: string; templateId: string } | null,
  routeCalls: [] as Array<[string, string, unknown]>,
  routeThrows: false,
  fetchImpl: null as null | ((url: string) => Promise<Response>),
  selections: [] as Array<{ id: string; report_type: string; template_id: string }>,
  selectionsThrow: false,
  selectionCalls: 0,
}));

vi.mock('@/lib/reportTemplate/templateSelection', async (importOriginal) => {
  // The pure half stays real, so the alias map decides which format a
  // selection belongs to — the same map the picker and the server use.
  const actual = await importOriginal<typeof import('../templateSelection')>();
  return {
    ...actual,
    fetchTemplateSelections: async () => {
      h.selectionCalls += 1;
      if (h.selectionsThrow) throw new Error('selections unreadable');
      return h.selections;
    },
  };
});

vi.mock('@/lib/reportTemplate/compassRoute', () => ({
  tryRouteThroughTemplateBuilderFor: async (
    reportType: string, reportId: string, opts?: unknown,
  ) => {
    h.routeCalls.push([reportType, reportId, opts]);
    if (h.routeThrows) throw new Error('the routing layer exploded');
    return h.routed;
  },
}));

import { tryTemplateDocument } from '../templateDocument';

const body = (text: string, ok = true) => ({
  ok,
  blob: async () => new Blob([text], { type: 'application/pdf' }),
}) as unknown as Response;

beforeEach(() => {
  h.routed = { fileUrl: 'https://cdn.example/x.pdf', fileName: 'x.pdf', templateId: 'tpl-1' };
  h.routeCalls = [];
  h.routeThrows = false;
  h.fetchImpl = null;
  h.selections = [];
  h.selectionsThrow = false;
  h.selectionCalls = 0;
  vi.stubGlobal('fetch', async (url: string) => (h.fetchImpl
    ? h.fetchImpl(url)
    : body('%PDF-1.7 rendered')));
});

describe("the person's chosen template", () => {
  /**
   * The picker offers a choice for every format and says it is kept. Only the
   * Compass button ever passed the chosen id, so on the other eight formats a
   * selection was stored, displayed as selected, and ignored by the generator
   * it was a choice about.
   */
  it('is looked up and carried into the route', async () => {
    h.selections = [{ id: 's1', report_type: 'client_details', template_id: 'tpl-chosen' }];
    await tryTemplateDocument('client_details', 'client-1');
    expect(h.routeCalls[0][2]).toMatchObject({ templateId: 'tpl-chosen' });
  });

  it('is matched through the alias map, not by raw spelling', async () => {
    // A format is stored under up to four spellings and they are one format;
    // a selection saved as `formara` belongs to the Client Details document.
    h.selections = [{ id: 's1', report_type: 'formara', template_id: 'tpl-alias' }];
    await tryTemplateDocument('client_details', 'client-1');
    expect(h.routeCalls[0][2]).toMatchObject({ templateId: 'tpl-alias' });
  });

  it('carries null when this format has no choice, so the ranking decides', async () => {
    h.selections = [{ id: 's1', report_type: 'portfolio', template_id: 'tpl-other' }];
    await tryTemplateDocument('qa', 'conv-1');
    expect(h.routeCalls[0][2]).toMatchObject({ templateId: null });
  });

  it('still produces the document when the selection cannot be read', async () => {
    // The choice is an improvement on a working path, so failing to read it
    // resolves by ranking rather than costing somebody their file.
    h.selectionsThrow = true;
    const doc = await tryTemplateDocument('portfolio', 'p-1');
    expect(doc).toBeTruthy();
    expect(h.routeCalls[0][2]).toMatchObject({ templateId: null });
  });

  it('is read fresh, so changing it changes the next document', async () => {
    h.selections = [{ id: 's1', report_type: 'portfolio', template_id: 'tpl-first' }];
    await tryTemplateDocument('portfolio', 'p-1');
    h.selections = [{ id: 's1', report_type: 'portfolio', template_id: 'tpl-second' }];
    await tryTemplateDocument('portfolio', 'p-1');
    expect(h.routeCalls[1][2]).toMatchObject({ templateId: 'tpl-second' });
    expect(h.selectionCalls).toBe(2);
  });

  it('is looked up without a report to render, so a dropped choice is said out loud', async () => {
    /*
     * This used to assert the opposite — no lookup, no query, return null. It
     * was the cheaper call and it hid a live defect for as long as it stood.
     *
     * Every Borrowing Capacity surface builds its request as
     * `{ clientId, clientName }` with no `assessmentId`, so `reportId` was
     * always null for that format and the template path was skipped on every
     * download *before* the fall-through notice could fire. The person's chosen
     * template was inert and nothing said so; the legacy composer produces a
     * well-typeset document, so an ignored choice looked exactly like an
     * honoured one. It was reported as "the template selector isn't working".
     *
     * One read on a path that is about to produce a PDF is the cheaper side of
     * that trade — the same reasoning `selectedTemplateFor` already gives for
     * not caching. No selection, no query beyond the read, and still no route.
     */
    h.selections = [{ id: 's1', report_type: 'portfolio', template_id: 'tpl-1' }];
    await tryTemplateDocument('portfolio', null);
    expect(h.selectionCalls).toBe(1);
    // Still no render attempt — there is no record to render.
    expect(h.routeCalls).toHaveLength(0);
  });
});

describe('asking for the templated document', () => {
  it('returns the bytes, and passes the report type and variant through', async () => {
    const doc = await tryTemplateDocument('qa', 'conv-1', { variant: 'answer' });
    expect(await doc?.blob.text()).toBe('%PDF-1.7 rendered');
    expect(doc?.fileName).toBe('x.pdf');
    expect(doc?.templateId).toBe('tpl-1');
    // `templateId` rides alongside the variant now — null here, because this
    // person has chosen no template for the format.
    // `onRefusal` rides along too — the route tells the caller which gate it
    // closed at, so the notice can name the cause. Matched rather than
    // compared whole, because a diagnostic callback is not part of what this
    // test is about.
    expect(h.routeCalls).toHaveLength(1);
    expect(h.routeCalls[0][0]).toBe('qa');
    expect(h.routeCalls[0][1]).toBe('conv-1');
    expect(h.routeCalls[0][2]).toMatchObject({
      variant: 'answer', templateId: null, payload: null,
    });
    expect(typeof (h.routeCalls[0][2] as any).onRefusal).toBe('function');
  });

  it('asks nothing at all without a report id', async () => {
    // A Borrowing Capacity Snapshot can be requested without naming an
    // assessment ("omit for the most recent"), and there is no stored record
    // for an adapter to read in that case.
    expect(await tryTemplateDocument('borrowing_capacity', null)).toBeNull();
    expect(await tryTemplateDocument('borrowing_capacity', undefined)).toBeNull();
    expect(await tryTemplateDocument('borrowing_capacity', '')).toBeNull();
    expect(h.routeCalls).toEqual([]);
  });

  it('falls back when no template is activated', async () => {
    h.routed = null;
    expect(await tryTemplateDocument('portfolio', 'p-1')).toBeNull();
  });

  it('falls back when the signed URL will not fetch', async () => {
    h.fetchImpl = async () => body('', false);
    expect(await tryTemplateDocument('portfolio', 'p-1')).toBeNull();
  });

  it('falls back when the render came back empty', async () => {
    // A zero-byte body saves as a file that opens to an error, which is worse
    // than the legacy layout.
    h.fetchImpl = async () => body('');
    expect(await tryTemplateDocument('portfolio', 'p-1')).toBeNull();
  });

  it('falls back — never throws — when the network or the router fails', async () => {
    h.fetchImpl = async () => { throw new Error('offline'); };
    await expect(tryTemplateDocument('portfolio', 'p-1')).resolves.toBeNull();

    h.fetchImpl = null;
    h.routeThrows = true;
    await expect(tryTemplateDocument('portfolio', 'p-1')).resolves.toBeNull();
  });
});
