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
}));

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
  vi.stubGlobal('fetch', async (url: string) => (h.fetchImpl
    ? h.fetchImpl(url)
    : body('%PDF-1.7 rendered')));
});

describe('asking for the templated document', () => {
  it('returns the bytes, and passes the report type and variant through', async () => {
    const doc = await tryTemplateDocument('qa', 'conv-1', { variant: 'answer' });
    expect(await doc?.blob.text()).toBe('%PDF-1.7 rendered');
    expect(doc?.fileName).toBe('x.pdf');
    expect(doc?.templateId).toBe('tpl-1');
    expect(h.routeCalls).toEqual([['qa', 'conv-1', { variant: 'answer' }]]);
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
