/**
 * Builder stock — the builder's OWN photograph reaching the right property.
 *
 * THE DEFECT THIS FILE PINS. Seventy properties imported from a public Notion
 * stock list showed Street View and satellite stills badged "Location
 * imagery", while twenty-five builder-supplied renders sat on the covers of
 * the very rows they came from. Nothing was broken in the enrichment stages:
 * stage 1 simply never produced anything, because the Notion decoder flattened
 * every property value to text — and a Notion file value's text is the
 * FILENAME, with the file itself hidden in a link decoration. A render that is
 * never extracted cannot outrank a Street View that is.
 *
 * The fixtures below are the SHAPE of the live payload, taken from it: the
 * double `value.value` wrapping, `format.page_cover` carrying
 * `attachment:<id>:<name>`, punctuation-heavy schema keys, and the real column
 * names (`Deal`, `Estate Tag`, `Package Status`).
 */
import { describe, expect, it } from 'vitest';

import {
  attributeDocumentMedia, sniffImageContentType, sourceImageObjectPath,
  SOURCE_ANCHOR_HEADER, validateSourceImageBytes,
} from '../../../supabase/functions/_shared/builderStock/sourceAssets.pure';
import {
  notionAssetUrl, notionCollectionTable, notionRowAssetRefs, withNotionRowAnchors,
} from '../../../supabase/functions/_shared/builderStock/notionRecordMap.pure';
import { normaliseStockRow } from '../../../supabase/functions/_shared/builderStock/normalise.pure';
import { keyRowsByHeader, parseDelimited } from '../../../supabase/functions/_shared/builderStock/table.pure';
import { matrixToCsv } from '../../../supabase/functions/_shared/builderStock/notionRecordMap.pure';
import {
  parseDrawingAnchors, parseRelationships, parseWorkbookSheets, relsPathFor,
  resolveOoxmlPath, sheetRowAnchor,
} from '../../../supabase/functions/_shared/builderStock/documentAnchors.pure';
import { extractStockFile } from '../../../supabase/functions/_shared/builderStock/extract';
import { storeSourceImages } from '../../../supabase/functions/_shared/builderStock/sourceImages';
import { chooseAndStorePrimaryImage } from '../../../supabase/functions/_shared/builderStock/primaryImage';
import { repairSourceImagesForUpload } from '../../../supabase/functions/_shared/builderStock/repairSourceImages';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SPACE_ID = '2b0cabf9-2010-8111-92c9-000329d94f98';
const COLLECTION_ID = '30ccabf9-2010-80b2-b004-000b94db2627';
const VIEW_ID = '30ccabf9-2010-80e6-9dd6-000c26da7c45';
const ROW_A = '374cabf9-2010-8059-b681-c9aa84ff8b0d';
const ROW_B = '3accabf9-2010-81b7-9168-f2eb55ecc559';
const PAGE_URL = 'https://ionized-chalk-a63.notion.site/30ccabf920108099b502d7ac23995def';

/** A real PNG header, padded past the "too small to be a photograph" floor. */
function pngBytes(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.fill(0x42, 8);
  return bytes;
}

function wrap(record: Record<string, unknown>) {
  // The chunk endpoint's shape: `{ spaceId, value: { value: <record>, role } }`.
  return { spaceId: SPACE_ID, value: { value: record, role: 'reader' } };
}

function collectionRecordMap(options: {
  coverA?: string | null;
  filePropertyA?: string | null;
  contentA?: string[];
  imageBlock?: { id: string; source: string };
} = {}) {
  const {
    coverA = 'attachment:21ef423c-9428-4c6d-bf8d-7211a2fe0a83:Cloverton_Registered_2.png',
    filePropertyA = null,
    contentA = [],
    imageBlock,
  } = options;

  const blocks: Record<string, unknown> = {
    [ROW_A]: wrap({
      id: ROW_A,
      type: 'page',
      parent_id: COLLECTION_ID,
      properties: {
        title: [['Lot 60434 - Cloverton Estate, Kalkallo VIC 3064']],
        'G^bL': [['Cloverton Estate Kalkallo VIC 3064 - Stocklands']],
        'mlCu': [['Available']],
        'ZVPn': [['643000']],
        ...(filePropertyA
          ? { 'O^yH': [[filePropertyA.split(':').slice(2).join(':') || filePropertyA, [['a', filePropertyA]]]] }
          : {}),
      },
      format: coverA ? { page_cover: coverA, page_cover_position: 0.5 } : {},
      content: contentA,
    }),
    [ROW_B]: wrap({
      id: ROW_B,
      type: 'page',
      parent_id: COLLECTION_ID,
      properties: {
        title: [['Lot 43 - Tringa Street, Sandpiper Estate, Tweed Heads South']],
        'G^bL': [['Sandpiper Estate']],
        'mlCu': [['Available']],
        'ZVPn': [['812000']],
      },
      format: {},
      content: [],
    }),
  };

  if (imageBlock) {
    blocks[imageBlock.id] = wrap({
      id: imageBlock.id,
      type: 'image',
      parent_id: ROW_A,
      properties: { source: [[imageBlock.source]] },
      format: { display_source: imageBlock.source },
    });
  }

  return {
    block: blocks,
    collection: {
      [COLLECTION_ID]: wrap({
        id: COLLECTION_ID,
        name: [['LIVE STOCK LIST - August 2026 ']],
        schema: {
          title: { name: 'Deal', type: 'title' },
          'G^bL': { name: 'Estate Tag', type: 'select' },
          'mlCu': { name: 'Package Status', type: 'select' },
          'ZVPn': { name: 'Package Price', type: 'number' },
          'O^yH': { name: 'Complete Package Pack', type: 'file' },
        },
      }),
    },
    collection_view: {
      [VIEW_ID]: wrap({
        id: VIEW_ID,
        format: {
          table_properties: [
            { property: 'title', visible: true },
            { property: 'G^bL', visible: true },
            { property: 'mlCu', visible: true },
            { property: 'ZVPn', visible: true },
          ],
        },
      }),
    },
  } as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// An in-memory stand-in for the service-role client
// ---------------------------------------------------------------------------

interface FakeRow { [key: string]: unknown }

function fakeDb(seed: {
  images?: FakeRow[];
  items?: FakeRow[];
  uploads?: FakeRow[];
  objects?: Record<string, Uint8Array>;
} = {}) {
  const tables: Record<string, FakeRow[]> = {
    builder_stock_item_images: [...(seed.images ?? [])],
    builder_stock_items: [...(seed.items ?? [])],
    builder_stock_uploads: [...(seed.uploads ?? [])],
  };
  const stored: Record<string, { bytes: Uint8Array; contentType: string }> = {};
  const sourceObjects = seed.objects ?? {};
  let autoId = 0;

  const matches = (row: FakeRow, filters: Array<[string, string, unknown]>) =>
    filters.every(([op, column, value]) => {
      if (op === 'eq') return row[column] === value;
      if (op === 'is') return row[column] === value || (value === null && row[column] == null);
      if (op === 'in') return Array.isArray(value) && value.includes(row[column]);
      return true;
    });

  const selectBuilder = (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    const builder: any = {
      eq(column: string, value: unknown) { filters.push(['eq', column, value]); return builder; },
      is(column: string, value: unknown) { filters.push(['is', column, value]); return builder; },
      in(column: string, value: unknown) { filters.push(['in', column, value]); return builder; },
      limit() { return builder; },
      order() { return builder; },
      maybeSingle() {
        const rows = (tables[table] ?? []).filter((row) => matches(row, filters));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(resolve: (value: { data: FakeRow[]; error: null }) => unknown, reject?: unknown) {
        const rows = (tables[table] ?? []).filter((row) => matches(row, filters));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject as never);
      },
    };
    return builder;
  };

  const db: any = {
    tables,
    stored,
    from(table: string) {
      return {
        select: () => selectBuilder(table),
        upsert(row: FakeRow) {
          const list = tables[table] ?? (tables[table] = []);
          const index = list.findIndex((existing) =>
            existing.stock_item_id === row.stock_item_id
            && existing.source_stage === row.source_stage
            && existing.source_reference === row.source_reference);
          if (index >= 0) list[index] = { ...list[index], ...row };
          else list.push({ id: `image-${++autoId}`, ...row });
          return Promise.resolve({ data: null, error: null });
        },
        update(patch: FakeRow) {
          const filters: Array<[string, string, unknown]> = [];
          const builder: any = {
            eq(column: string, value: unknown) { filters.push(['eq', column, value]); return builder; },
            then(resolve: (value: unknown) => unknown, reject?: unknown) {
              for (const row of tables[table] ?? []) {
                if (matches(row, filters)) Object.assign(row, patch);
              }
              return Promise.resolve({ data: null, error: null }).then(resolve, reject as never);
            },
          };
          return builder;
        },
      };
    },
    storage: {
      from() {
        return {
          upload(path: string, bytes: Uint8Array, options: { contentType: string }) {
            stored[path] = { bytes, contentType: options.contentType };
            return Promise.resolve({ data: { path }, error: null });
          },
          download(path: string) {
            const bytes = sourceObjects[path];
            if (!bytes) return Promise.resolve({ data: null, error: { message: 'not found' } });
            return Promise.resolve({
              data: { arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)) },
              error: null,
            });
          },
        };
      },
    },
  };
  return db;
}

/** A fetcher that answers with real image bytes, and records what was asked. */
function imageFetcher(bytes: Uint8Array = pngBytes()) {
  const requested: string[] = [];
  return {
    requested,
    fetchImage: async (url: string) => {
      requested.push(url);
      return { bytes, finalUrl: 'https://img.notionusercontent.com/s3/prod-files-secure/signed' };
    },
  };
}

// ---------------------------------------------------------------------------
// TEST A — a Notion file property belongs to the row that carries it
// ---------------------------------------------------------------------------

describe('Notion file and media properties', () => {
  it('takes the file out of a files property and keeps it on that row', () => {
    const recordMap = collectionRecordMap({
      coverA: null,
      filePropertyA: 'attachment:aaa11111-2222-3333-4444-555566667777:Lot60434_Facade.png',
    });

    const refs = notionRowAssetRefs(recordMap, ROW_A);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ origin: 'file_property', blockId: ROW_A });
    expect(refs[0].source).toContain('Lot60434_Facade.png');

    // And nothing leaks onto the row beside it.
    expect(notionRowAssetRefs(recordMap, ROW_B)).toHaveLength(0);
  });

  it('ignores a file property holding something that is not an image', () => {
    const recordMap = collectionRecordMap({
      coverA: null,
      // The live list's "Complete Package Pack" column: a contract pack, and on
      // most rows a Google Drive folder. Neither is a photograph of a house.
      filePropertyA: 'attachment:1cd875b8-14cf-42fa-8f95-a58ae98a3344:shops_Now_open_Cloverton_estate.pdf',
    });
    expect(notionRowAssetRefs(recordMap, ROW_A)).toHaveLength(0);
  });

  it('reads the page cover, which is where the live stock list keeps its renders', () => {
    const refs = notionRowAssetRefs(collectionRecordMap(), ROW_A);
    expect(refs).toHaveLength(1);
    expect(refs[0].origin).toBe('page_cover');
    expect(refs[0].source).toBe(
      'attachment:21ef423c-9428-4c6d-bf8d-7211a2fe0a83:Cloverton_Registered_2.png');
  });

  it('does not treat a Notion gallery texture as builder imagery', () => {
    const recordMap = collectionRecordMap({ coverA: '/images/page-cover/woodgrain_dark.png' });
    expect(notionRowAssetRefs(recordMap, ROW_A)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TEST B — an image block inside a row's own page belongs to that row
// ---------------------------------------------------------------------------

describe('Notion image blocks inside a database row', () => {
  it('attributes an image block to the row whose page holds it', () => {
    const blockId = '3f1cabf9-2010-4000-9000-0000000000aa';
    const recordMap = collectionRecordMap({
      coverA: null,
      contentA: [blockId],
      imageBlock: { id: blockId, source: 'attachment:bbb22222-3333-4444-5555-666677778888:Render.jpg' },
    });

    const refs = notionRowAssetRefs(recordMap, ROW_A);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ origin: 'image_block', blockId });

    // The URL is signed against the IMAGE block, not the row — which is what
    // Notion's public endpoint requires.
    const url = notionAssetUrl(PAGE_URL, refs[0]);
    expect(url).toContain(`id=${blockId}`);
    expect(notionRowAssetRefs(recordMap, ROW_B)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Row identity survives the CSV the pipeline actually imports
// ---------------------------------------------------------------------------

describe('the anchor column', () => {
  it('carries the Notion row id through the snapshot and into the record', () => {
    const recordMap = collectionRecordMap();
    const table = notionCollectionTable(recordMap, {
      collectionId: COLLECTION_ID, viewId: VIEW_ID, blockIds: [ROW_A, ROW_B],
    });
    expect(table.rowIds).toEqual([ROW_A, ROW_B]);

    const matrix = withNotionRowAnchors(table.matrix, table.rowIds, SOURCE_ANCHOR_HEADER);
    // Round-trip through exactly what gets stored and re-read.
    const keyed = keyRowsByHeader(parseDelimited(matrixToCsv(matrix)));
    expect(keyed).not.toBeNull();

    const first = normaliseStockRow(keyed!.rows[0]);
    expect(first?.source_anchor).toBe(`notion:${ROW_A}`);
    expect(first?.address_line).toContain('Lot 60434');
    // The reserved column is lifted off the row, not reported as a column we
    // failed to understand.
    expect(Object.keys(first?.unmapped ?? {})).not.toContain(SOURCE_ANCHOR_HEADER);
  });

  it('is not by itself evidence that a row describes a property', () => {
    expect(normaliseStockRow({ [SOURCE_ANCHOR_HEADER]: 'notion:abc' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TEST C — an external image URL is fetched, stored and attributed
// TEST D — a Notion-hosted file is snapshotted so expiry cannot break the card
// ---------------------------------------------------------------------------

describe('bringing the source image inside', () => {
  it('stores an externally hosted image against the exact property', async () => {
    const db = fakeDb();
    const fetcher = imageFetcher();

    const outcome = await storeSourceImages(db, {
      organisationId: 'org-1',
      uploadId: 'upload-1',
      stockItemId: 'item-1',
      assets: [{
        url: 'https://cdn.builder.example/renders/lot-60434.png',
        reference: 'https://cdn.builder.example/renders/lot-60434.png',
        origin: 'notion_file_property',
        provider: 'notion',
        pageUrl: PAGE_URL,
        position: 0,
        linkFallback: false,
      }],
    }, { fetchImage: fetcher.fetchImage });

    expect(outcome.stored).toBe(1);
    const row = db.tables.builder_stock_item_images[0];
    expect(row).toMatchObject({
      stock_item_id: 'item-1',
      source_stage: 'uploaded_document',
      verification_status: 'source_supplied',
      processing_status: 'ready',
      source_provider: 'notion',
      content_type: 'image/png',
    });
    expect(row.storage_bucket).toBe('builder-stock-images');
    expect(db.stored[row.storage_path as string].bytes.length).toBe(4096);
  });

  it('snapshots a Notion-hosted file and never keeps its expiring URL', async () => {
    const refs = notionRowAssetRefs(collectionRecordMap(), ROW_A);
    const url = notionAssetUrl(PAGE_URL, refs[0])!;
    // The public image endpoint on the page's own host, which re-signs the
    // attachment on every request.
    expect(url).toContain('https://ionized-chalk-a63.notion.site/image/');
    expect(url).toContain(encodeURIComponent(refs[0].source));
    expect(url).toContain(`id=${ROW_A}`);

    const db = fakeDb();
    const fetcher = imageFetcher();
    await storeSourceImages(db, {
      organisationId: 'org-1',
      uploadId: 'upload-1',
      stockItemId: 'item-1',
      assets: [{
        url,
        // Keyed on Notion's own name, so a re-import refreshes one row rather
        // than writing a new one for every signature.
        reference: refs[0].source,
        origin: 'notion_page_cover',
        provider: 'notion',
        pageUrl: PAGE_URL,
        position: 0,
        linkFallback: false,
      }],
    }, { fetchImage: fetcher.fetchImage });

    const row = db.tables.builder_stock_item_images[0];
    expect(row.storage_path).toBeTruthy();
    expect(row.external_url).toBeNull();
    expect(row.source_reference).toBe(refs[0].source);
    expect(db.stored[row.storage_path as string]).toBeTruthy();
  });

  it('refuses an access page dressed up as an image, and says so', async () => {
    const db = fakeDb();
    const html = new TextEncoder().encode('<!doctype html><html><body>Sign in</body></html>'.repeat(40));

    const outcome = await storeSourceImages(db, {
      organisationId: 'org-1',
      uploadId: null,
      stockItemId: 'item-1',
      assets: [{
        url: 'https://example.invalid/render.png',
        reference: 'render.png',
        origin: 'notion_page_cover',
        provider: 'notion',
        pageUrl: null,
        position: 0,
        linkFallback: false,
      }],
    }, { fetchImage: async () => ({ bytes: html, finalUrl: 'https://example.invalid/render.png' }) });

    expect(outcome.stored).toBe(0);
    expect(outcome.failed).toBe(1);
    const row = db.tables.builder_stock_item_images[0];
    expect(row.processing_status).toBe('failed');
    expect(row.storage_path).toBeUndefined();
    // An expiring URL is never left behind as product data.
    expect(row.external_url).toBeNull();
  });

  it('lets an ordinary published link stand when the bytes cannot be fetched', async () => {
    const db = fakeDb();
    await storeSourceImages(db, {
      organisationId: 'org-1',
      uploadId: null,
      stockItemId: 'item-1',
      assets: [{
        url: 'https://builder.example/lot-1.jpg',
        reference: 'https://builder.example/lot-1.jpg',
        origin: 'stock_list_column',
        provider: 'stock_list_column',
        pageUrl: null,
        position: 0,
        linkFallback: true,
      }],
    }, { fetchImage: async () => { throw new Error('That address could not be reached.'); } });

    const row = db.tables.builder_stock_item_images[0];
    expect(row.processing_status).toBe('ready');
    expect(row.external_url).toBe('https://builder.example/lot-1.jpg');
    expect(row.verification_status).toBe('source_supplied');
  });

  it('reads the bytes, not the promise', () => {
    expect(sniffImageContentType(pngBytes())).toBe('image/png');
    expect(validateSourceImageBytes(new TextEncoder().encode('<svg/>'.repeat(200))).ok).toBe(false);
    expect(validateSourceImageBytes(pngBytes(64)).ok).toBe(false);
    expect(sourceImageObjectPath('org', 'item', 'attachment:x:Cover.png', 'png'))
      .toBe('org/items/item/source/attachment-x-Cover.png.png');
  });
});

// ---------------------------------------------------------------------------
// TEST E — an HTML row's own image follows that row
// ---------------------------------------------------------------------------

describe('an ordinary web page', () => {
  const html = `<!doctype html><html><body><table>
    <tr><th>Lot</th><th>Estate</th><th>Price</th><th>Photo</th></tr>
    <tr><td>101</td><td>Riverbank</td><td>$640,000</td><td><img src="/img/lot-101.jpg"></td></tr>
    <tr><td>102</td><td>Riverbank</td><td>$655,000</td><td><img src="/img/lot-102.jpg"></td></tr>
  </table></body></html>`;

  it('keeps each card image with the row that contains it', async () => {
    const extraction = await extractStockFile(
      new TextEncoder().encode(html),
      'stock.html',
      { kind: 'markup', extension: 'html' },
      { baseUrl: 'https://builder.example/stock' },
    );

    expect(extraction.rows).toHaveLength(2);
    const anchors = extraction.rows.map((row) => row[SOURCE_ANCHOR_HEADER]);
    expect(new Set(anchors).size).toBe(2);

    // Row 101's anchor carries row 101's photograph, and no other.
    const first = extraction.rowAssets.find((entry) => entry.anchor === anchors[0]);
    expect(first?.assets.map((asset) => asset.url))
      .toEqual(['https://builder.example/img/lot-101.jpg']);
    const second = extraction.rowAssets.find((entry) => entry.anchor === anchors[1]);
    expect(second?.assets.map((asset) => asset.url))
      .toEqual(['https://builder.example/img/lot-102.jpg']);
    expect(first?.assets[0]).toMatchObject({ provider: 'source_page', linkFallback: true });
  });
});

// ---------------------------------------------------------------------------
// TEST F — a document image is attributed structurally, not by counting
// ---------------------------------------------------------------------------

describe('embedded document imagery', () => {
  it('resolves a spreadsheet drawing to the sheet row it is anchored to', () => {
    const workbook = '<workbook><sheets><sheet name="Stock" sheetId="1" r:id="rId1"/></sheets></workbook>';
    expect(parseWorkbookSheets(workbook)).toEqual([{ name: 'Stock', rid: 'rId1' }]);

    const workbookRels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
    const sheetPart = resolveOoxmlPath('xl/workbook.xml', parseRelationships(workbookRels).rId1);
    expect(sheetPart).toBe('xl/worksheets/sheet1.xml');
    expect(relsPathFor(sheetPart)).toBe('xl/worksheets/_rels/sheet1.xml.rels');

    const drawingPart = resolveOoxmlPath(sheetPart, '../drawings/drawing1.xml');
    expect(drawingPart).toBe('xl/drawings/drawing1.xml');

    const drawing = `<xdr:wsDr>
      <xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:row>7</xdr:row></xdr:from>
        <xdr:pic><xdr:blipFill><a:blip r:embed="rId4"/></xdr:blipFill></xdr:pic>
      </xdr:twoCellAnchor></xdr:wsDr>`;
    expect(parseDrawingAnchors(drawing)).toEqual([{ rid: 'rId4', row: 7 }]);
    expect(resolveOoxmlPath(drawingPart, '../media/image2.png')).toBe('xl/media/image2.png');
    expect(sheetRowAnchor('Stock', 7)).toBe('sheet:Stock#7');
  });

  it('prefers the anchor over the ordering the counts would have allowed', () => {
    const attributions = attributeDocumentMedia({
      anchors: ['sheet:Stock#7', 'sheet:Stock#5'],
      itemIdByAnchor: { 'sheet:Stock#5': 'item-lot-5', 'sheet:Stock#7': 'item-lot-7' },
      itemIdsInOrder: ['item-lot-5', 'item-lot-7'],
    });
    // Counting would have given image 0 to item-lot-5. The document says
    // otherwise, and the document decides.
    expect(attributions[0]).toMatchObject({ stockItemId: 'item-lot-7', structural: true });
    expect(attributions[1]).toMatchObject({ stockItemId: 'item-lot-5', structural: true });
  });

  it('stops attributing by order once the document has shown it anchors images', () => {
    const attributions = attributeDocumentMedia({
      anchors: ['sheet:Stock#7', null],
      itemIdByAnchor: { 'sheet:Stock#7': 'item-lot-7' },
      itemIdsInOrder: ['item-lot-5', 'item-lot-7'],
    });
    expect(attributions[0].stockItemId).toBe('item-lot-7');
    // A letterhead the spreadsheet never anchored is kept against the upload.
    expect(attributions[1].stockItemId).toBeNull();
    expect(attributions[1].reason).toContain('did not anchor this one');
  });

  it('still counts when the format stated nothing at all', () => {
    const attributions = attributeDocumentMedia({
      anchors: [null, null],
      itemIdByAnchor: {},
      itemIdsInOrder: ['item-a', 'item-b'],
    });
    expect(attributions.map((entry) => entry.stockItemId)).toEqual(['item-a', 'item-b']);
    expect(attributions[0].structural).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TEST G — the source-supplied image always wins the card
// ---------------------------------------------------------------------------

describe('which image the marketplace shows', () => {
  it('chooses the builder image over ready Google and search imagery', async () => {
    const db = fakeDb({
      items: [{ id: 'item-1', primary_image_id: 'google-1' }],
      images: [
        {
          id: 'google-1', stock_item_id: 'item-1', source_stage: 'google_maps',
          processing_status: 'ready', position: 0, storage_path: 'org/items/item-1/google-streetview.jpg',
        },
        {
          id: 'search-1', stock_item_id: 'item-1', source_stage: 'internet_search',
          processing_status: 'ready', position: 0, external_url: 'https://example.com/found.jpg',
        },
        {
          id: 'source-1', stock_item_id: 'item-1', source_stage: 'uploaded_document',
          processing_status: 'ready', position: 3, storage_path: 'org/items/item-1/source/cover.png',
        },
      ],
    });

    const primary = await chooseAndStorePrimaryImage(db, 'item-1');
    expect(primary).toBe('source-1');
    expect(db.tables.builder_stock_items[0].primary_image_id).toBe('source-1');
  });

  it('never lets a lower position on Google outrank the builder image', async () => {
    const db = fakeDb({
      items: [{ id: 'item-1', primary_image_id: null }],
      images: [
        {
          id: 'google-1', stock_item_id: 'item-1', source_stage: 'google_maps',
          processing_status: 'ready', position: 0, storage_path: 'g.jpg',
        },
        {
          id: 'source-1', stock_item_id: 'item-1', source_stage: 'uploaded_document',
          processing_status: 'ready', position: 9, storage_path: 's.png',
        },
      ],
    });
    expect(await chooseAndStorePrimaryImage(db, 'item-1')).toBe('source-1');
  });

  // TEST H — no builder image: the fallback still works exactly as designed.
  it('falls back to location imagery when the source supplied nothing', async () => {
    const db = fakeDb({
      items: [{ id: 'item-2', primary_image_id: null }],
      images: [
        {
          id: 'search-2', stock_item_id: 'item-2', source_stage: 'internet_search',
          processing_status: 'ready', position: 0, external_url: 'https://example.com/x.jpg',
        },
        {
          id: 'google-2', stock_item_id: 'item-2', source_stage: 'google_maps',
          processing_status: 'ready', position: 0, storage_path: 'g.jpg',
        },
      ],
    });
    expect(await chooseAndStorePrimaryImage(db, 'item-2')).toBe('google-2');
  });

  it('does not promote a source image that failed to come inside', async () => {
    const db = fakeDb({
      items: [{ id: 'item-3', primary_image_id: null }],
      images: [
        {
          id: 'source-3', stock_item_id: 'item-3', source_stage: 'uploaded_document',
          processing_status: 'failed', position: 0,
        },
        {
          id: 'google-3', stock_item_id: 'item-3', source_stage: 'google_maps',
          processing_status: 'ready', position: 0, storage_path: 'g.jpg',
        },
      ],
    });
    expect(await chooseAndStorePrimaryImage(db, 'item-3')).toBe('google-3');
  });
});

// ---------------------------------------------------------------------------
// TEST I — existing stock is repaired, not recreated
// TEST J — and one builder's imagery can never reach another's stock
// ---------------------------------------------------------------------------

describe('repairing stock that is already imported', () => {
  const csv = [
    'Reference,Development,Lot,Package Price,Photo',
    'NPC-101,Riverbank,101,640000,https://builder.example/img/lot-101.jpg',
  ].join('\r\n');

  const upload = {
    id: 'upload-1',
    organisation_id: 'org-a',
    source_type: 'file',
    source_url: null,
    final_url: null,
    original_filename: 'stock.csv',
    storage_bucket: 'builder-stock-lists',
    storage_path: 'stock-lists/org-a/upload-1/stock.csv',
    deleted_at: null,
  };

  it('attaches the source image to the existing item and re-points the card', async () => {
    const db = fakeDb({
      uploads: [upload],
      items: [{
        id: 'item-101', organisation_id: 'org-a', lifecycle_status: 'active',
        external_reference: 'NPC-101', development_name: 'Riverbank',
        project_name: null, unit_number: null, lot_number: '101',
        primary_image_id: 'google-101',
      }],
      images: [{
        id: 'google-101', stock_item_id: 'item-101', source_stage: 'google_maps',
        processing_status: 'ready', position: 0, storage_path: 'g.jpg',
      }],
      objects: { [upload.storage_path]: new TextEncoder().encode(csv) },
    });

    const before = db.tables.builder_stock_items.length;
    const outcome = await repairSourceImagesForUpload(db, {
      organisationId: 'org-a', uploadId: 'upload-1',
    });

    expect(outcome.error).toBeUndefined();
    expect(outcome.rowsRead).toBe(1);
    expect(outcome.matched).toBe(1);
    // The stock item is not duplicated, recreated or edited.
    expect(db.tables.builder_stock_items).toHaveLength(before);
    expect(db.tables.builder_stock_items[0].id).toBe('item-101');
    expect(db.tables.builder_stock_items[0].external_reference).toBe('NPC-101');

    const sourceRow = db.tables.builder_stock_item_images
      .find((row: FakeRow) => row.source_stage === 'uploaded_document');
    expect(sourceRow).toMatchObject({
      stock_item_id: 'item-101',
      verification_status: 'source_supplied',
      processing_status: 'ready',
    });
    // And the card now shows it. The Google row is left where it is.
    expect(db.tables.builder_stock_items[0].primary_image_id).toBe(sourceRow!.id);
    expect(outcome.primaryUpdated).toBe(1);
    expect(db.tables.builder_stock_item_images
      .some((row: FakeRow) => row.id === 'google-101')).toBe(true);
  });

  it('cannot attach one builder\'s source image to another builder\'s stock', async () => {
    const db = fakeDb({
      uploads: [upload],
      items: [
        // The SAME reference, owned by a different organisation.
        {
          id: 'item-other', organisation_id: 'org-b', lifecycle_status: 'active',
          external_reference: 'NPC-101', development_name: 'Riverbank',
          project_name: null, unit_number: null, lot_number: '101',
          primary_image_id: null,
        },
      ],
      objects: { [upload.storage_path]: new TextEncoder().encode(csv) },
    });

    const outcome = await repairSourceImagesForUpload(db, {
      organisationId: 'org-a', uploadId: 'upload-1',
    });

    expect(outcome.rowsRead).toBe(1);
    expect(outcome.matched).toBe(0);
    expect(db.tables.builder_stock_item_images).toHaveLength(0);
    expect(db.tables.builder_stock_items[0].primary_image_id).toBeNull();
  });

  it('refuses a source that belongs to another organisation outright', async () => {
    const db = fakeDb({ uploads: [upload] });
    const outcome = await repairSourceImagesForUpload(db, {
      organisationId: 'org-b', uploadId: 'upload-1',
    });
    expect(outcome.error).toBe('That source could not be found.');
  });
});
