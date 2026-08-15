/**
 * Builder stock lists — decoding Notion's public page state.
 *
 * WHY THIS EXISTS. A published Notion page does not serve its content as
 * markup. The first HTML response is a 19 KB client-rendering shell: a
 * `<title>Notion</title>`, an empty `window.__notion_boot_data`, and script
 * tags. Every row of a stock list lives in a `recordMap` that the browser
 * fetches afterwards from Notion's own public, unauthenticated endpoints. So
 * `htmlSource.pure.ts` finding no table on a public Notion page is the
 * ORDINARY case and says nothing whatever about who may read the page.
 *
 * This module is the decoder for that `recordMap`: schema keys to column
 * names, rich-text arrays to plain strings, a collection's rows to a matrix.
 * The matrix then goes through `keyRowsByHeader` and `normaliseStockRow` like
 * every other source — there is no Notion-specific property schema anywhere
 * after this file.
 *
 * NO JAVASCRIPT IS EXECUTED. This reads JSON that Notion's public API
 * returned. `notionPublicContent.ts` is the half that does the (SSRF-guarded,
 * unauthenticated) retrieving; this half is pure so it can be tested against
 * captured production payloads.
 *
 * Pure: no imports, no IO, no clock.
 */

/** A `recordMap` as the public endpoints return it: table → id → wrapper. */
export type NotionRecordMap = Record<string, unknown>;

/**
 * The shape of the page we were pointed at, as far as the record map states
 * it. Every field is nullable because a record map is whatever the endpoint
 * chose to send, and guessing at a missing id is how the wrong collection gets
 * queried.
 */
export interface NotionPageShape {
  pageBlockId: string | null;
  blockType: string | null;
  collectionId: string | null;
  collectionViewId: string | null;
  spaceId: string | null;
  title: string | null;
}

/**
 * Unwrap a record map entry.
 *
 * The endpoints disagree about depth — `loadCachedPageChunkV2` returns
 * `{ spaceId, value: { value: <record>, role } }` while older responses return
 * `{ role, value: <record> }` — so this descends through `value` until it
 * finds the object that carries an `id`, rather than assuming either shape.
 */
export function unwrapNotionRecord(entry: unknown): Record<string, unknown> | null {
  let node: unknown = entry;
  for (let depth = 0; depth < 4; depth++) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    const record = node as Record<string, unknown>;
    if (typeof record.id === 'string') return record;
    if ('value' in record) { node = record.value; continue; }
    return null;
  }
  return null;
}

/** The `spaceId` a record map hangs on its entries, when it carries one. */
export function notionEntrySpaceId(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const wrapper = entry as Record<string, unknown>;
  return typeof wrapper.spaceId === 'string' ? wrapper.spaceId : null;
}

function tableOf(recordMap: NotionRecordMap, name: string): Record<string, unknown> {
  const table = recordMap[name];
  return table && typeof table === 'object' && !Array.isArray(table)
    ? table as Record<string, unknown>
    : {};
}

/**
 * A Notion rich-text value as plain text.
 *
 * The wire format is an array of segments, each `[text]` or
 * `[text, decorations]`. A mention is the sentinel `‣` carrying its real
 * value in the decorations — a date is recoverable, a user or page reference
 * is not, and an unrecoverable mention contributes nothing rather than a
 * stray bullet.
 */
export function notionTextValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';

  const parts: string[] = [];
  for (const segment of value) {
    if (typeof segment === 'string') { parts.push(segment); continue; }
    if (!Array.isArray(segment)) continue;
    const text = typeof segment[0] === 'string' ? segment[0] : '';
    // U+2023 is the sentinel Notion puts where a mention was. Escaped
    // rather than literal: the character is invisible in most editors.
    if (text === '\u2023') {
      parts.push(mentionText(Array.isArray(segment[1]) ? segment[1] : []));
      continue;
    }
    parts.push(text);
  }
  return parts.join('').replace(/\u00a0/g, ' ').trim();
}

function mentionText(decorations: unknown[]): string {
  for (const decoration of decorations) {
    if (!Array.isArray(decoration)) continue;
    if (decoration[0] !== 'd') continue;
    const date = decoration[1];
    if (!date || typeof date !== 'object') continue;
    const value = date as Record<string, unknown>;
    const start = typeof value.start_date === 'string' ? value.start_date : '';
    const end = typeof value.end_date === 'string' ? value.end_date : '';
    if (!start) continue;
    return end ? `${start} to ${end}` : start;
  }
  return '';
}

/** `30ccabf920108099b502d7ac23995def` → the dashed form Notion's API wants. */
export function toNotionUuid(raw: unknown): string | null {
  const compact = String(raw ?? '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) return null;
  return [
    compact.slice(0, 8), compact.slice(8, 12), compact.slice(12, 16),
    compact.slice(16, 20), compact.slice(20),
  ].join('-');
}

function idFromSlug(slug: unknown): string | null {
  const compact = String(slug ?? '').replace(/-/g, '');
  const match = /([0-9a-fA-F]{32})$/.exec(compact);
  return match ? toNotionUuid(match[1]) : null;
}

/**
 * The page id to ask Notion about.
 *
 * The URL is preferred because it is what the builder actually linked to; the
 * markup's own `pageId` is the fallback for a site root, which carries no id
 * in its path. `?v=` is deliberately NOT read — that is the collection VIEW,
 * and querying it as a page returns nothing.
 */
export function extractNotionPageId(rawUrl: string, html?: string | null): string | null {
  try {
    const url = new URL(rawUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    const fromPath = segments.length ? idFromSlug(segments[segments.length - 1]) : null;
    if (fromPath) return fromPath;
    const fromQuery = idFromSlug(url.searchParams.get('p'));
    if (fromQuery) return fromQuery;
  } catch {
    /* not a URL we can read; the markup may still name the page */
  }

  const embedded = /"pageId"\s*:\s*"([0-9a-fA-F-]{32,36})"/.exec(String(html ?? ''));
  return embedded ? toNotionUuid(embedded[1]) : null;
}

/** The collection view named by `?v=` on the link, when there is one. */
export function preferredNotionViewId(rawUrl: string): string | null {
  try {
    return idFromSlug(new URL(rawUrl).searchParams.get('v'));
  } catch {
    return null;
  }
}

/**
 * What the record map says the page is.
 *
 * `collection_view_page` is a full-page database (the shape a stock list
 * almost always takes); `collection_view` is one embedded in a page. Either
 * way the collection and view ids are what `queryCollection` needs, and they
 * live in two places depending on the age of the block, so both are read.
 */
export function describeNotionPage(
  recordMap: NotionRecordMap,
  pageId?: string | null,
  preferredViewId?: string | null,
): NotionPageShape {
  const blocks = tableOf(recordMap, 'block');

  let entry = pageId ? blocks[pageId] : undefined;
  let blockId = pageId ?? null;
  if (!unwrapNotionRecord(entry)) {
    entry = undefined;
    blockId = null;
    for (const [id, candidate] of Object.entries(blocks)) {
      const record = unwrapNotionRecord(candidate);
      const type = record?.type;
      if (type === 'collection_view_page' || type === 'collection_view' || type === 'page') {
        entry = candidate;
        blockId = id;
        if (type !== 'page') break;
      }
    }
  }

  const block = unwrapNotionRecord(entry);
  if (!block) return blank();

  const format = (block.format && typeof block.format === 'object')
    ? block.format as Record<string, unknown> : {};
  const pointer = (format.collection_pointer && typeof format.collection_pointer === 'object')
    ? format.collection_pointer as Record<string, unknown> : {};

  const collectionId = typeof block.collection_id === 'string'
    ? block.collection_id
    : (typeof pointer.id === 'string' ? pointer.id : null);

  const viewIds = Array.isArray(block.view_ids)
    ? block.view_ids.filter((id): id is string => typeof id === 'string')
    : [];
  const collectionViewId = (preferredViewId && viewIds.includes(preferredViewId))
    ? preferredViewId
    : (viewIds[0] ?? preferredViewId ?? null);

  const spaceId = typeof block.space_id === 'string' ? block.space_id
    : notionEntrySpaceId(entry)
    ?? (typeof pointer.spaceId === 'string' ? pointer.spaceId : null)
    ?? (typeof recordMap.spaceId === 'string' ? recordMap.spaceId : null);

  const properties = (block.properties && typeof block.properties === 'object')
    ? block.properties as Record<string, unknown> : {};
  const blockTitle = notionTextValue(properties.title);
  const collection = collectionId ? unwrapNotionRecord(tableOf(recordMap, 'collection')[collectionId]) : null;
  const collectionTitle = collection ? notionTextValue(collection.name) : '';

  return {
    pageBlockId: blockId,
    blockType: typeof block.type === 'string' ? block.type : null,
    collectionId,
    collectionViewId,
    spaceId,
    title: (collectionTitle || blockTitle || null),
  };
}

function blank(): NotionPageShape {
  return {
    pageBlockId: null, blockType: null, collectionId: null,
    collectionViewId: null, spaceId: null, title: null,
  };
}

/** One column of a Notion database: its schema key and what it is called. */
export interface NotionColumn {
  key: string;
  name: string;
}

/**
 * The columns a reader of this page sees, in the order they see them.
 *
 * The VIEW decides, not the schema: a table view carries `table_properties`
 * with a `visible` flag, and a column the page hides is not part of the stock
 * list. Without a view — or without that format — the schema's own order is
 * used with the title column first, because the title is the row's name.
 */
export function notionCollectionColumns(
  recordMap: NotionRecordMap,
  collectionId: string,
  viewId?: string | null,
): NotionColumn[] {
  const collection = unwrapNotionRecord(tableOf(recordMap, 'collection')[collectionId]);
  const schema = (collection?.schema && typeof collection.schema === 'object')
    ? collection.schema as Record<string, unknown> : {};

  const nameFor = (key: string): string | null => {
    const definition = schema[key];
    if (!definition || typeof definition !== 'object') return null;
    const label = (definition as Record<string, unknown>).name;
    const text = typeof label === 'string' ? label.trim() : '';
    return text || key;
  };

  const columns: NotionColumn[] = [];
  const seen = new Set<string>();
  const push = (key: string) => {
    if (seen.has(key)) return;
    const name = nameFor(key);
    if (name === null) return;
    seen.add(key);
    columns.push({ key, name });
  };

  const view = viewId ? unwrapNotionRecord(tableOf(recordMap, 'collection_view')[viewId]) : null;
  const format = (view?.format && typeof view.format === 'object')
    ? view.format as Record<string, unknown> : {};
  const tableProperties = Array.isArray(format.table_properties) ? format.table_properties : [];

  for (const entry of tableProperties) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (item.visible === false) continue;
    if (typeof item.property === 'string') push(item.property);
  }

  if (!columns.length) {
    if (schema.title) push('title');
    for (const key of Object.keys(schema)) push(key);
  }
  return columns;
}

/**
 * A collection's rows as a matrix, header row first.
 *
 * `blockIds` is the order the view returned — the same order and the same
 * filtering a reader of the page sees — so a filtered view does not import
 * rows the page hides.
 */
export function notionCollectionMatrix(
  recordMap: NotionRecordMap,
  input: { collectionId: string; viewId?: string | null; blockIds?: string[] | null },
): string[][] {
  const columns = notionCollectionColumns(recordMap, input.collectionId, input.viewId);
  if (!columns.length) return [];

  const blocks = tableOf(recordMap, 'block');
  const ids = input.blockIds?.length
    ? input.blockIds
    : Object.keys(blocks).filter((id) => {
      const block = unwrapNotionRecord(blocks[id]);
      return block?.parent_id === input.collectionId && block?.type === 'page';
    });

  const matrix: string[][] = [columns.map((column) => column.name)];
  for (const id of ids) {
    const block = unwrapNotionRecord(blocks[id]);
    if (!block || block.alive === false) continue;
    const properties = (block.properties && typeof block.properties === 'object')
      ? block.properties as Record<string, unknown> : {};
    const cells = columns.map((column) => notionTextValue(properties[column.key]));
    if (cells.some((cell) => cell !== '')) matrix.push(cells);
  }
  return matrix.length > 1 ? matrix : [];
}

/**
 * Every SIMPLE table on the page — the `table` / `table_row` blocks a builder
 * gets from Notion's "Table" block rather than from a database.
 *
 * Its cells are keyed by column id and ordered by `table_block_column_order`,
 * which is the only thing that says which column is which.
 */
export function notionSimpleTableMatrices(recordMap: NotionRecordMap): string[][][] {
  const blocks = tableOf(recordMap, 'block');
  const matrices: string[][][] = [];

  for (const entry of Object.values(blocks)) {
    const block = unwrapNotionRecord(entry);
    if (!block || block.type !== 'table') continue;

    const format = (block.format && typeof block.format === 'object')
      ? block.format as Record<string, unknown> : {};
    const order = Array.isArray(format.table_block_column_order)
      ? format.table_block_column_order.filter((id): id is string => typeof id === 'string')
      : [];
    const content = Array.isArray(block.content)
      ? block.content.filter((id): id is string => typeof id === 'string')
      : [];

    const matrix: string[][] = [];
    for (const rowId of content) {
      const row = unwrapNotionRecord(blocks[rowId]);
      if (!row || row.type !== 'table_row') continue;
      const properties = (row.properties && typeof row.properties === 'object')
        ? row.properties as Record<string, unknown> : {};
      const keys = order.length ? order : Object.keys(properties).sort();
      const cells = keys.map((key) => notionTextValue(properties[key]));
      if (cells.some((cell) => cell !== '')) matrix.push(cells);
    }
    if (matrix.length > 1) matrices.push(matrix);
  }
  return matrices;
}

/** Block types whose `title` property is prose a reader sees. */
const TEXT_BLOCK_TYPES = new Set([
  'text', 'header', 'sub_header', 'sub_sub_header', 'bulleted_list',
  'numbered_list', 'to_do', 'toggle', 'quote', 'callout', 'code',
]);

/**
 * The page's readable prose, for the model-assisted path.
 *
 * Used only when neither a database nor a simple table produced rows — the
 * same fallback an ordinary web page gets, and under the same "never invent a
 * value" schema.
 */
export function notionReadableText(recordMap: NotionRecordMap, maxChars = 120_000): string {
  const blocks = tableOf(recordMap, 'block');
  const lines: string[] = [];

  for (const entry of Object.values(blocks)) {
    const block = unwrapNotionRecord(entry);
    if (!block) continue;
    const type = typeof block.type === 'string' ? block.type : '';
    if (type !== 'page' && !TEXT_BLOCK_TYPES.has(type)) continue;
    const properties = (block.properties && typeof block.properties === 'object')
      ? block.properties as Record<string, unknown> : {};
    const text = notionTextValue(properties.title);
    if (text) lines.push(text);
  }

  return lines.join('\n').slice(0, maxChars);
}

/**
 * A matrix as RFC-4180 CSV.
 *
 * This is what gets snapshotted and what gets imported, so the two cannot
 * disagree about what was read: `parseDelimited` reads back exactly what this
 * writes, multi-line cells included.
 */
export function matrixToCsv(matrix: string[][]): string {
  return matrix
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

function csvCell(value: string): string {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Combine two record maps, table by table.
 *
 * The two public endpoints each answer half of a database: the chunk carries
 * the schema and the view, the collection query carries the rows. Merging them
 * means the decoder above sees one map and never has to know which half held
 * what. Later entries win; neither input is mutated.
 */
export function mergeNotionRecordMaps(
  first: NotionRecordMap,
  second: NotionRecordMap,
): NotionRecordMap {
  const out: NotionRecordMap = { ...first };
  for (const [table, records] of Object.entries(second)) {
    const existing = out[table];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)
      && records && typeof records === 'object' && !Array.isArray(records)) {
      out[table] = {
        ...existing as Record<string, unknown>,
        ...records as Record<string, unknown>,
      };
    } else {
      out[table] = records;
    }
  }
  return out;
}
