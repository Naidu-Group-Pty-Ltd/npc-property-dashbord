/**
 * Builder stock lists — retrieving a PUBLIC Notion page's actual content.
 *
 * A published Notion page serves a client-rendering shell. The stock list is
 * not in that HTML at any point: it is fetched afterwards, by the browser,
 * from Notion's own public endpoints on the same host, with no credential of
 * any kind. This module makes those same unauthenticated requests server-side
 * and hands the result to `notionRecordMap.pure.ts` to decode.
 *
 * WHAT THIS IS NOT:
 *   • It is NOT a Notion API integration. There is no key, no token, no OAuth,
 *     no setting, and nothing is read from the environment. The endpoints used
 *     are the ones a logged-out browser calls for a page that has been shared
 *     to the web; a page that has not been shared answers them with a 401,
 *     which is exactly the evidence `notion_not_public` is allowed to rest on.
 *   • It is NOT a second import pipeline. It produces a matrix. The matrix
 *     becomes CSV, the CSV goes through `runStockImport` like every other
 *     source, and nothing downstream knows Notion exists.
 *   • It executes NO JavaScript. It parses JSON.
 *
 * SSRF: every request goes through `postGuardedJson`, which applies the same
 * `assertPublicUrl` guard, the same timeouts and the same size ceiling as the
 * ordinary source fetch, refuses redirects outright, and sends no cookie,
 * Authorization header or Supabase credential. The destination is additionally
 * pinned to the SAME HOST the page was fetched from, and only when that host
 * is a Notion one — so this cannot be steered at a third address.
 */
import { postGuardedJson, SourceFetchError } from './fetchSource.ts';
import { isNotionHost } from './urlSource.pure.ts';
import {
  describeNotionPage, extractNotionPageId, matrixToCsv, mergeNotionRecordMaps,
  notionCollectionMatrix, notionReadableText, notionSimpleTableMatrices,
  preferredNotionViewId, type NotionRecordMap,
} from './notionRecordMap.pure.ts';

/** Rows asked for in one go. A stock list an order of magnitude larger than
 * this is not something a builder maintains by hand in Notion. */
const MAX_COLLECTION_ROWS = 1000;

/** Everything the recovery attempt learned. Server-side diagnostics only. */
export interface NotionRecoveryDiagnostics {
  page_id_found: boolean;
  chunk_status: number | null;
  chunk_bytes: number;
  block_type: string | null;
  has_collection: boolean;
  query_status: number | null;
  query_bytes: number;
  row_count: number;
  column_count: number;
  simple_tables: number;
  text_length: number;
  /** Set only when Notion itself refused us. */
  access_denied_status: number | null;
}

export type NotionRecovery =
  | {
    ok: true;
    /** Header row first. Fed to the ordinary pipeline as CSV. */
    matrix: string[][];
    csv: string;
    title: string | null;
    /** Recorded as `parse_strategy` on the audit row. */
    strategy: string;
    diagnostics: NotionRecoveryDiagnostics;
  }
  | {
    ok: true;
    matrix: null;
    /** Prose for the existing model-assisted path. */
    text: string;
    title: string | null;
    strategy: string;
    diagnostics: NotionRecoveryDiagnostics;
  }
  | {
    ok: false;
    /**
     * `access_denied` is the ONLY value that may produce
     * `notion_not_public`, and it is set only when Notion answered 401/403 or
     * named an authorisation error. Everything else means "public, but we
     * could not read a stock list out of it".
     */
    reason: 'no_page_id' | 'unreachable' | 'access_denied' | 'no_content';
    diagnostics: NotionRecoveryDiagnostics;
  };

function blankDiagnostics(): NotionRecoveryDiagnostics {
  return {
    page_id_found: false, chunk_status: null, chunk_bytes: 0, block_type: null,
    has_collection: false, query_status: null, query_bytes: 0, row_count: 0,
    column_count: 0, simple_tables: 0, text_length: 0, access_denied_status: null,
  };
}

/** Notion's own name for "you may not read this". Evidence, not inference. */
function deniedByNotion(status: number, body: unknown): boolean {
  if (status === 401 || status === 403) return true;
  if (!body || typeof body !== 'object') return false;
  const name = String((body as Record<string, unknown>).name ?? '').toLowerCase();
  return name === 'unauthorizederror' || name === 'restrictedresourceerror';
}

function recordMapOf(body: unknown): NotionRecordMap {
  if (!body || typeof body !== 'object') return {};
  const map = (body as Record<string, unknown>).recordMap;
  return (map && typeof map === 'object') ? map as NotionRecordMap : {};
}

/** The row ids the view returned, in the order and filtering a reader sees. */
function resultBlockIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const result = (body as Record<string, unknown>).result;
  if (!result || typeof result !== 'object') return [];
  const reducers = (result as Record<string, unknown>).reducerResults;
  const group = (reducers && typeof reducers === 'object')
    ? (reducers as Record<string, unknown>).collection_group_results
    : null;
  const source = (group && typeof group === 'object') ? group : result;
  const ids = (source as Record<string, unknown>).blockIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * Recover what a public Notion page actually shows.
 *
 * `finalUrl` is the address the ordinary fetch settled on and `html` is what
 * it returned; both are inputs rather than something re-fetched, so this adds
 * at most two requests to an import.
 */
export async function recoverNotionPublicContent(
  finalUrl: string,
  html: string,
): Promise<NotionRecovery> {
  const diagnostics = blankDiagnostics();

  let origin: URL;
  try {
    origin = new URL(finalUrl);
  } catch {
    return { ok: false, reason: 'unreachable', diagnostics };
  }
  // The endpoints are Notion's own, on the host the page came from. Anything
  // else is not a destination this module is willing to invent.
  if (!isNotionHost(origin.hostname)) {
    return { ok: false, reason: 'unreachable', diagnostics };
  }

  const pageId = extractNotionPageId(finalUrl, html);
  diagnostics.page_id_found = !!pageId;
  if (!pageId) return { ok: false, reason: 'no_page_id', diagnostics };

  const endpoint = (path: string) => new URL(path, origin.origin).toString();

  let chunk: { status: number; json: unknown; byteLength: number };
  try {
    chunk = await postGuardedJson(endpoint('/api/v3/loadCachedPageChunkV2'), {
      page: { id: pageId },
      limit: 100,
      cursor: { stack: [] },
      chunkNumber: 0,
      verticalColumns: false,
    });
  } catch (error) {
    if (!(error instanceof SourceFetchError)) throw error;
    return { ok: false, reason: 'unreachable', diagnostics };
  }
  diagnostics.chunk_status = chunk.status;
  diagnostics.chunk_bytes = chunk.byteLength;

  if (deniedByNotion(chunk.status, chunk.json)) {
    diagnostics.access_denied_status = chunk.status;
    return { ok: false, reason: 'access_denied', diagnostics };
  }
  if (chunk.status < 200 || chunk.status >= 300) {
    return { ok: false, reason: 'unreachable', diagnostics };
  }

  const chunkMap = recordMapOf(chunk.json);
  const shape = describeNotionPage(chunkMap, pageId, preferredNotionViewId(finalUrl));
  diagnostics.block_type = shape.blockType;
  diagnostics.has_collection = !!shape.collectionId;

  // (1) A database — the shape a real stock list takes. Its rows are not in
  // the chunk; the view has to be queried for them.
  if (shape.collectionId && shape.collectionViewId && shape.spaceId) {
    let query: { status: number; json: unknown; byteLength: number } | null = null;
    try {
      query = await postGuardedJson(endpoint('/api/v3/queryCollection?src=initial_load'), {
        source: { type: 'collection', id: shape.collectionId, spaceId: shape.spaceId },
        collectionView: { id: shape.collectionViewId, spaceId: shape.spaceId },
        loader: {
          type: 'reducer',
          reducers: {
            collection_group_results: { type: 'results', limit: MAX_COLLECTION_ROWS },
          },
          sortQuery: [],
          searchQuery: '',
          userTimeZone: 'Australia/Sydney',
        },
      });
    } catch (error) {
      if (!(error instanceof SourceFetchError)) throw error;
      query = null;
    }

    if (query) {
      diagnostics.query_status = query.status;
      diagnostics.query_bytes = query.byteLength;
      if (deniedByNotion(query.status, query.json)) {
        diagnostics.access_denied_status = query.status;
        return { ok: false, reason: 'access_denied', diagnostics };
      }
      if (query.status >= 200 && query.status < 300) {
        // The row blocks come back on the query's own record map; the schema
        // and the view came back on the chunk's. Merged so the decoder sees
        // one map rather than having to know which half held what.
        const merged = mergeNotionRecordMaps(chunkMap, recordMapOf(query.json));
        const matrix = notionCollectionMatrix(merged, {
          collectionId: shape.collectionId,
          viewId: shape.collectionViewId,
          blockIds: resultBlockIds(query.json),
        });
        if (matrix.length > 1) {
          diagnostics.row_count = matrix.length - 1;
          diagnostics.column_count = matrix[0].length;
          return {
            ok: true,
            matrix,
            csv: matrixToCsv(matrix),
            title: shape.title,
            strategy: 'notion_collection',
            diagnostics,
          };
        }
      }
    }
  }

  // (2) A simple `table` block on an ordinary page.
  const simple = notionSimpleTableMatrices(chunkMap);
  diagnostics.simple_tables = simple.length;
  const widest = simple.slice().sort((a, b) => b.length - a.length)[0];
  if (widest && widest.length > 1) {
    diagnostics.row_count = widest.length - 1;
    diagnostics.column_count = widest[0].length;
    return {
      ok: true,
      matrix: widest,
      csv: matrixToCsv(widest),
      title: shape.title,
      strategy: 'notion_simple_table',
      diagnostics,
    };
  }

  // (3) Prose. Handed to the existing model-assisted path, which reads it
  // under the same "never invent a value" schema a brochure gets.
  const text = notionReadableText(chunkMap);
  diagnostics.text_length = text.length;
  if (text.trim().length >= 40) {
    return { ok: true, matrix: null, text, title: shape.title, strategy: 'notion_blocks', diagnostics };
  }

  return { ok: false, reason: 'no_content', diagnostics };
}
