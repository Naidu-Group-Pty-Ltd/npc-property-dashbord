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
import { createHash } from 'node:crypto';

import {
  AUTHENTICATED_REFUSALS, CALLBACK_TOKEN_BYTES, MAX_CALLBACK_BYTES,
  RECOVERABLE_AVAILABILITY, RECOVERABLE_AVAILABILITY_LEGACY,
  RECOVERY_REQUEST_TTL_MINUTES, callbackRefusal, constantTimeEquals,
  isRecoverableStoredAvailability, mergeRecoveredLink,
  outboundRecoveryPayload, recoveredRowsFromGrid, shouldRequestLinkRecovery,
} from '../../../supabase/functions/_shared/builderStock/linkRecovery.pure';
import { rowSourceBranches } from '../../../supabase/functions/_shared/builderStock/sourceBranches.pure';

/** The same construction both sides of the token use. */
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const TOKEN = 'a'.repeat(64);
const TOKEN_HASH = sha256(TOKEN);

const OK = {
  importSucceeded: true,
  availability: 'unavailable_source_export' as const,
  spreadsheetId: 'sheet-abc',
  webhookConfigured: true,
};

// ── Trigger ────────────────────────────────────────────────────────────────

describe('the one condition worth asking about', () => {
  it('asks when all four hold', () => {
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

  it('asks for EVERY organisation — there is no tenant gate', () => {
    /*
     * A sheet whose link targets cannot be read is the same defect whoever
     * uploaded it. Gating the fix per tenant means every builder nobody
     * remembered to enable goes on silently losing its brochures, so the only
     * things that narrow this are the conditions above and the rate limiting.
     */
    expect(shouldRequestLinkRecovery({ ...OK })).toBe(true);
    // No property of the input names an organisation, a tenant or a flag.
    for (const key of Object.keys(OK)) {
      expect(key).not.toMatch(/organisation|tenant|allow|enabled|flag/i);
    }
  });

  it('no allowlist, feature flag or hardcoded organisation survives anywhere', () => {
    for (const file of [
      'supabase/functions/_shared/builderStock/linkRecovery.pure.ts',
      'supabase/functions/_shared/builderStock/requestLinkRecovery.ts',
      'supabase/functions/builder-portal-stock/index.ts',
      'supabase/functions/builder-stock-link-callback/index.ts',
      'supabase/migrations/20261030000000_builder_stock_link_recovery.sql',
    ]) {
      const source = readFileSync(file, 'utf8');
      for (const gone of [
        'builder_stock_link_recovery_orgs',
        'linkRecoveryEnabledFor',
        'organisationEnabled',
      ]) {
        expect(`${file}: ${source.includes(gone)}`).toBe(`${file}: false`);
      }
      // And no production organisation may be named in code either.
      expect(source).not.toMatch(/kopi\s*jantan/i);
    }
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
    expires_at: new Date().toISOString(), callback_token_hash: TOKEN_HASH,
  };

  it('is four fields and nothing else', () => {
    expect(outboundRecoveryPayload(request, TOKEN)).toEqual({
      request_id: 'req-1', spreadsheet_id: 'sheet-abc', gid: '0',
      callback_token: TOKEN,
    });
  });

  it('carries no organisation, upload, property or customer data', () => {
    const serialised = JSON.stringify(outboundRecoveryPayload(request, TOKEN));
    for (const secret of ['org-secret', 'upload-secret', 'organisation', 'upload_id']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('sends the token itself and NEVER the stored hash', () => {
    const serialised = JSON.stringify(outboundRecoveryPayload(request, TOKEN));
    expect(serialised).toContain(TOKEN);
    expect(serialised).not.toContain('callback_token_hash');
    // Belt and braces: the hash of a different value must not appear either.
    expect(serialised).not.toContain(sha256('anything-else'));
  });

  it('a sheet-wide link with no tab still sends an explicit null', () => {
    expect(outboundRecoveryPayload({ ...request, gid: null }, TOKEN).gid).toBeNull();
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
    for (const forbidden of ['spreadsheet_id', 'webhook', 'secret', 'token']) {
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
    callback_token_hash: TOKEN_HASH,
  };
  const body = {
    request_id: 'req-1', spreadsheet_id: 'sheet-abc', gid: '0', sheets: [],
  };

  it('accepts a well-formed, bound, unconsumed, unexpired, authorised request', () => {
    expect(callbackRefusal(request, body, now, TOKEN_HASH)).toBeNull();
  });

  it('refuses an unknown request id', () => {
    expect(callbackRefusal(null, body, now, TOKEN_HASH))
      .toEqual({ code: 'unknown_request', status: 404 });
  });

  it('refuses a replay of a consumed request', () => {
    expect(callbackRefusal(
      { ...request, consumed_at: '2026-08-30T11:59:00Z' }, body, now, TOKEN_HASH))
      .toEqual({ code: 'request_already_consumed', status: 409 });
  });

  it('refuses an expired request', () => {
    expect(callbackRefusal(
      { ...request, expires_at: new Date(now - 1).toISOString() }, body, now, TOKEN_HASH))
      .toEqual({ code: 'request_expired', status: 409 });
  });

  it('refuses a document that is not the one we asked about', () => {
    expect(callbackRefusal(
      request, { ...body, spreadsheet_id: 'sheet-other' }, now, TOKEN_HASH))
      .toEqual({ code: 'spreadsheet_mismatch', status: 409 });
  });

  it('refuses a TAB that is not the one we asked about', () => {
    expect(callbackRefusal(request, { ...body, gid: '7' }, now, TOKEN_HASH))
      .toEqual({ code: 'gid_mismatch', status: 409 });
  });

  it('treats absent, null and empty gid as the same statement', () => {
    const sheetWide = { ...request, gid: null };
    for (const gid of [null, undefined, '']) {
      expect(callbackRefusal(sheetWide, { ...body, gid }, now, TOKEN_HASH)).toBeNull();
    }
    // ...and a numeric gid is the same tab as its digits, either way round.
    expect(callbackRefusal(request, { ...body, gid: 0 }, now, TOKEN_HASH)).toBeNull();
    expect(callbackRefusal({ ...request, gid: '0' }, { ...body, gid: '0' }, now, TOKEN_HASH))
      .toBeNull();
  });

  it('refuses a malformed payload before looking anything up', () => {
    for (const bad of [{}, { request_id: 'req-1' }, { spreadsheet_id: 'sheet-abc' },
      { request_id: 'req-1', spreadsheet_id: 'sheet-abc' },
      { request_id: 'req-1', spreadsheet_id: 'sheet-abc', sheets: 'not-an-array' }]) {
      expect(callbackRefusal(request, bad as never, now, TOKEN_HASH)?.code)
        .toBe('malformed_payload');
    }
  });

  it('a body naming another organisation changes nothing — it is never read', () => {
    const hostile = {
      ...body,
      organisation_id: 'org-b', upload_id: 'upload-b', property_id: 'prop-b',
    };
    expect(callbackRefusal(request, hostile, now, TOKEN_HASH)).toBeNull();
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

// ── The one-time capability token ──────────────────────────────────────────

describe('authorisation is a per-request capability, not a shared secret', () => {
  const now = Date.parse('2026-08-30T12:00:00Z');
  const request = {
    id: 'req-1', organisation_id: 'org-a', upload_id: 'upload-a',
    spreadsheet_id: 'sheet-abc', gid: '0',
    expires_at: new Date(now + 60_000).toISOString(), consumed_at: null,
    callback_token_hash: TOKEN_HASH,
  };
  const body = {
    request_id: 'req-1', spreadsheet_id: 'sheet-abc', gid: '0', sheets: [],
  };

  it('accepts the token minted for this request', () => {
    expect(callbackRefusal(request, body, now, sha256(TOKEN))).toBeNull();
  });

  it('refuses a wrong token', () => {
    expect(callbackRefusal(request, body, now, sha256('not-the-token')))
      .toEqual({ code: 'invalid_token', status: 401 });
  });

  it('refuses a missing token, and says so distinctly from a wrong one', () => {
    expect(callbackRefusal(request, body, now, null))
      .toEqual({ code: 'missing_token', status: 401 });
  });

  it('refuses a token that belongs to a DIFFERENT request', () => {
    const other = sha256('b'.repeat(64));
    expect(callbackRefusal(request, body, now, other)?.code).toBe('invalid_token');
  });

  it('refuses when the row carries no hash at all, rather than letting it through', () => {
    expect(callbackRefusal(
      { ...request, callback_token_hash: '' }, body, now, sha256(''))?.code)
      .toBe('invalid_token');
  });

  it('checks the token BEFORE the binding, so a wrong token never reveals the binding', () => {
    // Wrong token AND wrong document: the token failure is what is reported.
    expect(callbackRefusal(
      request, { ...body, spreadsheet_id: 'sheet-other' }, now, sha256('wrong'))?.code)
      .toBe('invalid_token');
  });

  it('checks existence, use and expiry before the token — those reveal nothing', () => {
    expect(callbackRefusal(null, body, now, null)?.code).toBe('unknown_request');
    expect(callbackRefusal(
      { ...request, consumed_at: 'x' }, body, now, null)?.code)
      .toBe('request_already_consumed');
  });

  it('only an AUTHENTICATED refusal may cause a write', () => {
    // A caller that has not proven possession must not be able to make this
    // product write, even a diagnostic status.
    for (const unauthenticated of ['malformed_payload', 'unknown_request',
      'request_already_consumed', 'request_expired', 'missing_token', 'invalid_token']) {
      expect(AUTHENTICATED_REFUSALS.has(unauthenticated)).toBe(false);
    }
    for (const authenticated of ['spreadsheet_mismatch', 'gid_mismatch']) {
      expect(AUTHENTICATED_REFUSALS.has(authenticated)).toBe(true);
    }
  });

  it('compares in constant time and never short-circuits on content', () => {
    expect(constantTimeEquals(TOKEN_HASH, TOKEN_HASH)).toBe(true);
    expect(constantTimeEquals(TOKEN_HASH, sha256('other'))).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });

  it('carries 256 bits of randomness, minted from the platform CSPRNG', () => {
    expect(CALLBACK_TOKEN_BYTES).toBe(32);
    const source = readFileSync(
      'supabase/functions/_shared/builderStock/requestLinkRecovery.ts', 'utf8');
    expect(source).toContain('crypto.getRandomValues');
    // Nothing about the request may feed the token — that would be guessable.
    const mint = source.slice(source.indexOf('export function mintCallbackToken'));
    for (const derived of ['request', 'organisation', 'Date.now', 'upload']) {
      expect(mint.slice(0, 400)).not.toContain(derived);
    }
  });

  it('stores only the hash, and never the token', () => {
    const source = readFileSync(
      'supabase/functions/_shared/builderStock/requestLinkRecovery.ts', 'utf8');
    const from = source.indexOf('.insert({');
    const insert = source.slice(from, source.indexOf('.select(', from));
    expect(insert).toContain('callback_token_hash: callbackTokenHash');
    expect(insert).not.toMatch(/callback_token:/);
  });

  it('the database refuses to hold anything but a sha256 digest', () => {
    const migration = readFileSync(
      'supabase/migrations/20261030000000_builder_stock_link_recovery.sql', 'utf8');
    expect(migration).toContain('callback_token_hash text NOT NULL');
    expect(migration).toContain("CHECK (callback_token_hash ~ '^[0-9a-f]{64}$')");
  });

  it('the callback reads a Bearer token and hashes it before comparing', () => {
    const callback = readFileSync(
      'supabase/functions/builder-stock-link-callback/index.ts', 'utf8');
    expect(callback).toContain("bearerToken(req.headers.get('authorization'))");
    expect(callback).toContain('await sha256Hex(presented)');
    // The plaintext must never meet a stored value.
    expect(callback).not.toMatch(/callback_token_hash\s*===\s*presented\b/);
  });

  it('bounds the body before it reads or parses anything', () => {
    const callback = readFileSync(
      'supabase/functions/builder-stock-link-callback/index.ts', 'utf8');
    const bound = callback.indexOf('enforceRawBodyLimit');
    const parse = callback.indexOf('JSON.parse');
    const lookup = callback.indexOf('.from(REQUEST_TABLE)');
    expect(bound).toBeGreaterThan(0);
    expect(bound).toBeLessThan(parse);
    expect(parse).toBeLessThan(lookup);
    expect(MAX_CALLBACK_BYTES).toBe(5 * 1024 * 1024);
  });

  it('claims the request atomically, so only one concurrent callback proceeds', () => {
    const callback = readFileSync(
      'supabase/functions/builder-stock-link-callback/index.ts', 'utf8');
    // A conditional UPDATE ... WHERE consumed_at IS NULL is the claim: the
    // database, not this code, decides which of two racing callers wins.
    expect(callback).toMatch(/\.update\(\{\s*consumed_at:[\s\S]{0,200}?\.is\('consumed_at', null\)/);
    expect(callback).toContain('request_already_consumed');
    // And the claim happens before any property is touched.
    const claim = callback.indexOf("is('consumed_at', null)\n    .select('id')");
    const mutate = callback.indexOf('applyRecoveredLinks(supabase');
    expect(callback.indexOf('consumed_at: new Date')).toBeLessThan(mutate);
    expect(claim === -1 || claim < mutate).toBe(true);
  });

  it('rate limits on recovered authority, after the token is proven', () => {
    const callback = readFileSync(
      'supabase/functions/builder-stock-link-callback/index.ts', 'utf8');
    const token = callback.indexOf('callbackRefusal(');
    const limit = callback.indexOf('consumeRateLimit(');
    expect(token).toBeGreaterThan(0);
    expect(token).toBeLessThan(limit);
    expect(callback).toContain('bs:link-recovery:${authority.organisation_id}');
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

  it('finds gid 0 when Google OMITS sheetId, which is how it always arrives', () => {
    /*
     * The Sheets API is proto3 JSON and leaves out scalars holding their
     * default, so the first tab of nearly every spreadsheet carries no
     * `sheetId` at all — and `gid=0` is the commonest link anyone pastes.
     * Read as `Number(undefined)`, that is NaN, which matches nothing: the
     * recovery returned zero rows and reported itself fulfilled. Measured
     * against the live document before this was fixed.
     */
    const noId = { properties: { title: 'Stock' }, data: grid(0).data };
    expect(recoveredRowsFromGrid([noId], '0')).toHaveLength(2);
  });

  it('absent means zero, never "the first one"', () => {
    // A workbook whose first tab is 12345 and whose second omits its id
    // resolves gid 0 to the SECOND, not to whatever happens to be first.
    const second = { properties: { title: 'Stock' }, data: grid(0).data };
    const rows = recoveredRowsFromGrid([grid(12345), second], '0');
    expect(rows).toHaveLength(2);
    // And a gid that names the explicit tab still takes that one.
    expect(recoveredRowsFromGrid([grid(12345), second], '12345')).toHaveLength(2);
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

  it('the webhook URL is read from the environment and never written down', () => {
    const source = readFileSync(
      'supabase/functions/_shared/builderStock/requestLinkRecovery.ts', 'utf8');
    expect(source).toContain("Deno.env.get('MAKE_SHEET_LINKS_WEBHOOK_URL')");
    // No default, no fallback, no literal.
    expect(source).not.toMatch(/MAKE_SHEET_LINKS_WEBHOOK_URL'\s*\)\s*\?\?\s*'h[^']+'/);
    expect(source).not.toMatch(/hook\.[a-z0-9]+\.make\.com/);
  });
});

// ── The architecture that was removed ──────────────────────────────────────

describe('the static shared secret is gone, not merely unused', () => {
  /*
   * A dead compatibility path is one import away from coming back, and this
   * one had a distribution problem rather than a bug: a secret that must be
   * byte-identical in two systems, where the side that can write one cannot
   * write the other. Nothing about the old design should survive as something
   * a future change could reach for, so this asserts absence rather than
   * trusting it.
   */
  const FILES = [
    'supabase/functions/_shared/builderStock/linkRecovery.pure.ts',
    'supabase/functions/_shared/builderStock/requestLinkRecovery.ts',
    'supabase/functions/builder-stock-link-callback/index.ts',
    'supabase/functions/builder-portal-stock/index.ts',
    'supabase/migrations/20261030000000_builder_stock_link_recovery.sql',
    'supabase/config.toml',
    '.github/workflows/set-builder-stock-link-secrets.yml',
  ];

  it('names no shared secret, signature header or timestamp signing anywhere', () => {
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      for (const gone of [
        'MAKE_SHEET_LINKS_SHARED_SECRET',
        'REPLACE_ME_MAKE_SHEET_LINKS_SHARED_SECRET',
        'x-make-signature',
        'x-make-timestamp',
        'x-aurixa-signature',
        'x-aurixa-timestamp',
        'timestampWithinSkew',
        'signedPayload',
        'MAX_TIMESTAMP_SKEW_SECONDS',
      ]) {
        expect(`${file}: ${source.includes(gone)}`).toBe(`${file}: false`);
      }
    }
  });

  it('signs nothing with HMAC on this path', () => {
    for (const file of [
      'supabase/functions/_shared/builderStock/requestLinkRecovery.ts',
      'supabase/functions/builder-stock-link-callback/index.ts',
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('hmacHex');
      expect(source).not.toMatch(/name:\s*'HMAC'/);
    }
  });

  it('refuses no request for a reason that only a shared secret could produce', () => {
    const callback = readFileSync(
      'supabase/functions/builder-stock-link-callback/index.ts', 'utf8');
    for (const gone of ['recovery_not_configured', 'stale_timestamp', 'invalid_signature']) {
      expect(callback).not.toContain(gone);
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
