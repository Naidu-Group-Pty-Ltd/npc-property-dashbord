/**
 * BUILDER STOCK — GOOGLE SHEETS HYPERLINK RECOVERY THROUGH MAKE.
 *
 * A Google Sheet whose owner has not enabled file export answers `/export`
 * with a sign-in page, and `/export` is the only public representation that
 * carries a cell's link target. Measured against a live document: `/export`
 * (xlsx and csv) and `/pubhtml` all 401, while `gviz` in every output mode
 * returns the cell TEXT with zero anchors and zero file ids. The brochure
 * address never reaches this product, so stage 1 has nothing to open.
 *
 * The recovery is performed by a Make scenario holding its own authorised
 * Google connection. That makes the callback an inbound write path deciding
 * what a client sees on a property card, and these tests are mostly about the
 * three properties that keep it safe:
 *
 *   THE CALLER CANNOT NAME ITS OWN AUTHORITY — organisation, upload and
 *   property come from the row this product wrote when it asked.
 *
 *   A ROW IS MATCHED BY WHAT IT IS — never by position, order or count.
 *
 *   IT FAILS CLOSED — every refusal writes nothing.
 *
 * Written on invented data. No spreadsheet, estate, lot, builder, secret or
 * URL here belongs to any deployment.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  MAX_CALLBACK_BYTES, MAX_TIMESTAMP_SKEW_SECONDS, RECOVERABLE_AVAILABILITY,
  RECOVERABLE_AVAILABILITY_LEGACY, RECOVERY_REQUEST_TTL_MINUTES, callbackRefusal,
  isRecoverableStoredAvailability, mergeRecoveredLink,
  outboundRecoveryPayload, recoveredRowsFromGrid, shouldRequestLinkRecovery,
  signedPayload, timestampWithinSkew,
} from '../../../supabase/functions/_shared/builderStock/linkRecovery.pure';
import { rowSourceBranches } from '../../../supabase/functions/_shared/builderStock/sourceBranches.pure';

const OK = {
  importSucceeded: true,
  availability: 'unavailable_source_export' as const,
  spreadsheetId: 'sheet-abc',
  organisationEnabled: true,
  webhookConfigured: true,
};

// ── Trigger ────────────────────────────────────────────────────────────────

describe('the one condition worth asking about', () => {
  it('asks when all five hold', () => {
    expect(shouldRequestLinkRecovery(OK)).toBe(true);
  });

  it('never asks for a reading that already has the links', () => {
    for (const availability of ['resolved', 'none_present'] as const) {
      expect(shouldRequestLinkRecovery({ ...OK, availability })).toBe(false);
    }
  });

  it('never asks where the workbook DID arrive — a re-read learns nothing', () => {
    for (const availability of ['unavailable_workbook_unreadable',
      'unavailable_no_worksheet_match', 'unavailable_ambiguous_worksheet'] as const) {
      expect(shouldRequestLinkRecovery({ ...OK, availability })).toBe(false);
    }
  });

  it('never asks for a source that is not a Google Sheet', () => {
    // CSV, XLSX, Notion and an ordinary URL all parse to no spreadsheet id.
    for (const spreadsheetId of [null, undefined, '', '   ']) {
      expect(shouldRequestLinkRecovery({ ...OK, spreadsheetId })).toBe(false);
    }
  });

  it('never asks for an organisation nobody enabled', () => {
    expect(shouldRequestLinkRecovery({ ...OK, organisationEnabled: false })).toBe(false);
  });

  it('never asks when no webhook is configured', () => {
    expect(shouldRequestLinkRecovery({ ...OK, webhookConfigured: false })).toBe(false);
  });

  it('never asks when the import itself did not succeed', () => {
    expect(shouldRequestLinkRecovery({ ...OK, importSucceeded: false })).toBe(false);
  });

  it('the availability it keys on is a single named constant', () => {
    expect(RECOVERABLE_AVAILABILITY).toBe('unavailable_source_export');
  });
});

// ── Outbound ───────────────────────────────────────────────────────────────

describe('what leaves this product', () => {
  const request = {
    id: 'req-1', organisation_id: 'org-secret', upload_id: 'upload-secret',
    spreadsheet_id: 'sheet-abc', gid: '0',
    expires_at: new Date().toISOString(),
  };

  it('is three fields and nothing else', () => {
    expect(outboundRecoveryPayload(request))
      .toEqual({ request_id: 'req-1', spreadsheet_id: 'sheet-abc', gid: '0' });
  });

  it('carries no organisation, upload, property or customer data', () => {
    const serialised = JSON.stringify(outboundRecoveryPayload(request));
    for (const secret of ['org-secret', 'upload-secret', 'organisation', 'upload_id']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('a sheet-wide link with no tab still sends an explicit null', () => {
    expect(outboundRecoveryPayload({ ...request, gid: null }).gid).toBeNull();
  });

  it('the dispatch can never fail the import', () => {
    const source = readFileSync(
      'supabase/functions/_shared/builderStock/requestLinkRecovery.ts', 'utf8');
    // Every path returns an outcome; nothing propagates.
    expect(source).not.toMatch(/^\s*throw /m);
    // And it does not read the webhook's body, which is neither trusted nor needed.
    expect(source).not.toMatch(/response\.(json|text)\(\)/);
  });

  it('logs an outcome and never a secret, a URL or a document id', () => {
    const source = readFileSync(
      'supabase/functions/_shared/builderStock/requestLinkRecovery.ts', 'utf8');
    const logged = source.slice(source.indexOf('console.info('));
    expect(logged).toContain('request_id');
    for (const forbidden of ['spreadsheet_id', 'webhook', 'secret', 'signature']) {
      expect(logged.slice(0, 400)).not.toContain(forbidden);
    }
  });
});

// ── Callback authority ─────────────────────────────────────────────────────

describe('the callback cannot name its own authority', () => {
  const now = Date.parse('2026-08-30T12:00:00Z');
  const request = {
    id: 'req-1', organisation_id: 'org-a', upload_id: 'upload-a',
    spreadsheet_id: 'sheet-abc', gid: '0',
    expires_at: new Date(now + 60_000).toISOString(), consumed_at: null,
  };
  const body = { request_id: 'req-1', spreadsheet_id: 'sheet-abc', sheets: [] };

  it('accepts a well-formed, bound, unconsumed, unexpired request', () => {
    expect(callbackRefusal(request, body, now)).toBeNull();
  });

  it('refuses an unknown request id', () => {
    expect(callbackRefusal(null, body, now))
      .toEqual({ code: 'unknown_request', status: 404 });
  });

  it('refuses a replay of a consumed request', () => {
    expect(callbackRefusal({ ...request, consumed_at: '2026-08-30T11:59:00Z' }, body, now))
      .toEqual({ code: 'request_already_consumed', status: 409 });
  });

  it('refuses an expired request', () => {
    expect(callbackRefusal(
      { ...request, expires_at: new Date(now - 1).toISOString() }, body, now))
      .toEqual({ code: 'request_expired', status: 409 });
  });

  it('refuses a document that is not the one we asked about', () => {
    expect(callbackRefusal(request, { ...body, spreadsheet_id: 'sheet-other' }, now))
      .toEqual({ code: 'spreadsheet_mismatch', status: 409 });
  });

  it('refuses a malformed payload before looking anything up', () => {
    for (const bad of [{}, { request_id: 'req-1' }, { spreadsheet_id: 'sheet-abc' },
      { request_id: 'req-1', spreadsheet_id: 'sheet-abc' },
      { request_id: 'req-1', spreadsheet_id: 'sheet-abc', sheets: 'not-an-array' }]) {
      expect(callbackRefusal(request, bad as never, now)?.code).toBe('malformed_payload');
    }
  });

  it('a body naming another organisation changes nothing — it is never read', () => {
    const hostile = {
      ...body,
      organisation_id: 'org-b', upload_id: 'upload-b', property_id: 'prop-b',
    };
    expect(callbackRefusal(request, hostile, now)).toBeNull();
    // The refusal check passes, and the function reads authority from the row:
    const callback = readFileSync(
      'supabase/functions/builder-stock-link-callback/index.ts', 'utf8');
    expect(callback).toContain('authority.organisation_id');
    expect(callback).toContain('authority.upload_id');
    expect(callback).not.toMatch(/body\.(organisation_id|upload_id|property_id)/);
  });

  it('the request window is thirty minutes', () => {
    expect(RECOVERY_REQUEST_TTL_MINUTES).toBe(30);
  });
});

describe('freshness and signing', () => {
  const now = Date.parse('2026-08-30T12:00:00Z');
  const seconds = Math.floor(now / 1000);

  it('accepts a timestamp inside the skew, either way', () => {
    expect(timestampWithinSkew(String(seconds), now)).toBe(true);
    expect(timestampWithinSkew(String(seconds - MAX_TIMESTAMP_SKEW_SECONDS + 1), now)).toBe(true);
    expect(timestampWithinSkew(String(seconds + MAX_TIMESTAMP_SKEW_SECONDS - 1), now)).toBe(true);
  });

  it('refuses one outside it, and anything unparseable', () => {
    expect(timestampWithinSkew(String(seconds - MAX_TIMESTAMP_SKEW_SECONDS - 1), now)).toBe(false);
    expect(timestampWithinSkew(String(seconds + MAX_TIMESTAMP_SKEW_SECONDS + 1), now)).toBe(false);
    for (const bad of ['', 'soon', 'NaN']) expect(timestampWithinSkew(bad, now)).toBe(false);
  });

  it('the timestamp is inside the signed string, which is what closes replay', () => {
    expect(signedPayload('123', '{"a":1}')).toBe('123.{"a":1}');
    expect(signedPayload('124', '{"a":1}')).not.toBe(signedPayload('123', '{"a":1}'));
  });

  it('the callback compares signatures in constant time and bounds the body', () => {
    const callback = readFileSync(
      'supabase/functions/builder-stock-link-callback/index.ts', 'utf8');
    expect(callback).toContain('constantTimeEquals');
    expect(callback).toMatch(/diff \|=/);
    expect(callback).toContain('enforceRawBodyLimit');
    expect(MAX_CALLBACK_BYTES).toBe(5 * 1024 * 1024);
  });

  it('freshness and signature are both checked before anything is parsed', () => {
    const callback = readFileSync(
      'supabase/functions/builder-stock-link-callback/index.ts', 'utf8');
    const skew = callback.indexOf('timestampWithinSkew');
    const signature = callback.indexOf('constantTimeEquals(presented');
    const parse = callback.indexOf('JSON.parse(rawBody)');
    expect(skew).toBeLessThan(parse);
    expect(signature).toBeLessThan(parse);
  });

  it('rate limiting keys on recovered authority, never on the body', () => {
    const callback = readFileSync(
      'supabase/functions/builder-stock-link-callback/index.ts', 'utf8');
    expect(callback).toMatch(/consumeRateLimit\(\s*\n?\s*supabase, `bs:link-recovery:\$\{authority\.organisation_id\}/);
  });
});

// ── The grid ───────────────────────────────────────────────────────────────

const grid = (sheetId: number) => ({
  properties: { sheetId, title: 'Stock' },
  data: [{
    rowData: [
      { values: [{ formattedValue: 'Lot #' }, { formattedValue: 'Estate' },
        { formattedValue: 'Brochure' }] },
      { values: [{ formattedValue: '605' }, { formattedValue: 'Sample Rise' },
        { formattedValue: 'Brochure', hyperlink: 'https://example.invalid/b-605.pdf' }] },
      { values: [{ formattedValue: '606' }, { formattedValue: 'Sample Rise' },
        { formattedValue: 'Brochure', hyperlink: 'https://example.invalid/b-606.pdf' }] },
    ],
  }],
});

describe('the tab is chosen by its own id, never by position', () => {
  it('takes the sheet the gid names wherever it sits', () => {
    const rows = recoveredRowsFromGrid([grid(99), grid(7)], '7');
    expect(rows).toHaveLength(2);
    expect(rows[0].values['Lot #']).toBe('605');
  });

  it('takes the first tab only where the link named none', () => {
    const rows = recoveredRowsFromGrid([grid(99), grid(7)], null);
    expect(rows).toHaveLength(2);
  });

  it('a gid no sheet carries recovers nothing rather than something', () => {
    expect(recoveredRowsFromGrid([grid(99)], '7')).toEqual([]);
  });

  it('keeps only http(s) targets', () => {
    const rows = recoveredRowsFromGrid([{
      properties: { sheetId: 0 },
      data: [{ rowData: [
        { values: [{ formattedValue: 'Lot #' }, { formattedValue: 'Plan' }] },
        { values: [{ formattedValue: '1' },
          { formattedValue: 'Plan', hyperlink: '#Sheet1!A1' }] },
      ] }],
    }], '0');
    expect(rows[0].links).toEqual({});
  });

  it('an empty or headerless grid recovers nothing and does not throw', () => {
    for (const bad of [null, undefined, [], [{}], [{ data: [] }]]) {
      expect(recoveredRowsFromGrid(bad as never, '0')).toEqual([]);
    }
  });
});

// ── Storage ────────────────────────────────────────────────────────────────

describe('a recovered link enters the row the existing pipeline already reads', () => {
  const URL_A = 'https://example.invalid/b-605.pdf';

  it('keeps the display text and adds the address beside it', () => {
    expect(mergeRecoveredLink('Brochure', URL_A)).toBe(`Brochure ${URL_A}`);
  });

  it('an empty cell becomes the address alone', () => {
    expect(mergeRecoveredLink(null, URL_A)).toBe(URL_A);
    expect(mergeRecoveredLink('   ', URL_A)).toBe(URL_A);
  });

  it('a duplicate callback changes nothing', () => {
    // Idempotence is what makes a retried Make run harmless.
    expect(mergeRecoveredLink(`Brochure ${URL_A}`, URL_A)).toBeNull();
    expect(mergeRecoveredLink(URL_A, URL_A)).toBeNull();
  });

  it('refuses anything that is not a document this pipeline can open', () => {
    for (const bad of ['', '   ', 'file:///c:/b.pdf', 'mailto:a@example.invalid',
      '#Sheet1!A1', 'javascript:alert(1)']) {
      expect(mergeRecoveredLink('Brochure', bad)).toBeNull();
    }
  });

  it('and `rowSourceBranches` discovers it with no stage 1 change at all', () => {
    // The whole reason for storing it this way.
    const merged = mergeRecoveredLink('Brochure', URL_A)!;
    const branches = rowSourceBranches({ 'Brochure V002': merged });
    expect(branches).toHaveLength(1);
    expect(branches[0].url).toBe(URL_A);
    // The original heading travels as provenance, unchanged.
    expect(branches[0].column).toBe('Brochure V002');
  });

  it('two headings on one row stay two independent branches', () => {
    const branches = rowSourceBranches({
      'Brochure V002': mergeRecoveredLink('Brochure', URL_A)!,
      'Estate Brochure': mergeRecoveredLink('Estate Brochure',
        'https://example.invalid/estate.pdf')!,
    });
    expect(branches.map((b) => b.column).sort())
      .toEqual(['Brochure V002', 'Estate Brochure']);
  });
});

// ── Matching and reopening ─────────────────────────────────────────────────

describe('a row is matched by what it is, never by where it sits', () => {
  const callback = readFileSync(
    'supabase/functions/builder-stock-link-callback/index.ts', 'utf8');

  it('uses the same normalisation and identity the import used', () => {
    expect(callback).toContain('normaliseStockRow');
    expect(callback).toContain('stockPropertyIdentity');
    expect(callback).toContain('identityDifferences');
  });

  it('applies only on exactly one match, and discards zero or several', () => {
    expect(callback).toMatch(/matches\.length !== 1/);
  });

  it('never consults a row index, offset or count alignment', () => {
    const body = callback.slice(callback.indexOf('async function applyRecoveredLinks'));
    for (const forbidden of ['rowIndex', 'row_index', 'rows[index]', '.length ===  rows']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('reads only the stored upload\u2019s properties, scoped by the stored organisation', () => {
    expect(callback).toMatch(/\.eq\('organisation_id', authority\.organisation_id\)/);
    expect(callback).toMatch(/authority\.upload_id/);
  });

  it('reopens only properties that gained a link and hold no stage 1 image', () => {
    expect(callback).toMatch(/if \(!target\.primary_image_id\) reopen\.push/);
    expect(callback).toMatch(/\.in\('id', reopen\)/);
  });

  it('never bumps the deployment-wide ladder generation', () => {
    expect(callback).not.toContain('image_ladder_generation_at');
    expect(callback).not.toContain('reopen_builder_stock_stranded_items');
  });

  it('decides nothing about an image', () => {
    for (const untouched of ['imagePriority', 'sanitizeImage', 'chooseCardImage',
      'streetViewHeading', 'webImageIdentity', 'marketplaceEligibility']) {
      expect(callback).not.toContain(untouched);
    }
  });
});

// ── Scope ──────────────────────────────────────────────────────────────────

describe('nothing here names a deployment', () => {
  it('carries no spreadsheet, organisation, secret or live URL', () => {
    for (const file of [
      'supabase/functions/_shared/builderStock/linkRecovery.pure.ts',
      'supabase/functions/_shared/builderStock/requestLinkRecovery.ts',
      'supabase/functions/builder-stock-link-callback/index.ts',
      'supabase/migrations/20261030000000_builder_stock_link_recovery.sql',
    ]) {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*(\/\/|--).*$/gm, ' ');
      expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
      expect(source).not.toMatch(/docs\.google\.com/);
      expect(source).not.toMatch(/1bPh8W|npcservices/i);
    }
  });

  it('the secret is read from the environment and never written down', () => {
    for (const file of [
      'supabase/functions/_shared/builderStock/requestLinkRecovery.ts',
      'supabase/functions/builder-stock-link-callback/index.ts',
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain("Deno.env.get('MAKE_SHEET_LINKS_SHARED_SECRET')");
      // No default, no fallback, no literal.
      expect(source).not.toMatch(/MAKE_SHEET_LINKS_SHARED_SECRET'\s*\)\s*\?\?\s*'[^']+'/);
    }
  });
});

// ── The reading, under both of its names ────────────────────────────────────
/*
 * `unavailable_source_sharing` covered both "the document refused to hand over
 * the workbook" and "we got it and could not read it" until those were split,
 * because they have different remedies. Rows written before that split still
 * carry the old name — including, at the time this shipped, the one production
 * upload this feature exists for.
 */
describe('a stored row may carry either spelling of the same reading', () => {
  it('the manual path accepts the historical name', () => {
    expect(isRecoverableStoredAvailability(RECOVERABLE_AVAILABILITY)).toBe(true);
    expect(isRecoverableStoredAvailability(RECOVERABLE_AVAILABILITY_LEGACY)).toBe(true);
  });

  it('and nothing else, including the readings that had the workbook', () => {
    for (const other of ['resolved', 'none_present', 'unavailable_workbook_unreadable',
      'unavailable_no_worksheet_match', 'unavailable_ambiguous_worksheet',
      null, undefined, '']) {
      expect(isRecoverableStoredAvailability(other)).toBe(false);
    }
  });

  it('the AUTOMATIC trigger stays narrow — the old name can no longer be emitted', () => {
    // Widening the live path would accept a value the current reader cannot
    // produce, which is how a condition quietly stops meaning anything.
    expect(shouldRequestLinkRecovery({
      ...OK, availability: RECOVERABLE_AVAILABILITY_LEGACY as never,
    })).toBe(false);
  });

  it('the portal control and the server ask the same question', () => {
    const page = readFileSync('src/pages/builder/BuilderStockList.tsx', 'utf8');
    const server = readFileSync(
      'supabase/functions/builder-portal-stock/index.ts', 'utf8');
    expect(page).toContain('isRecoverableStoredAvailability');
    expect(server).toContain('isRecoverableStoredAvailability');
    // And the server is still the authority: it re-checks rather than trusting.
    expect(server).toMatch(/if \(!isRecoverableStoredAvailability\(availability\)\)/);
  });
});
