/**
 * Builder stock lists — the one import pipeline.
 *
 * Bytes in, stock items out. A file the builder uploaded and a document the
 * server fetched from a URL both arrive here, and everything after this point
 * is identical for both: the same duplicate guard, the same detection, the
 * same extraction, the same model fallback under the same "never invent a
 * value" schema, the same `importStockRecords`, the same statuses on the same
 * audit row.
 *
 * This module exists so that sentence stays true. Before URL sources the
 * pipeline lived inline in `process_upload`; a second copy for URLs is exactly
 * how two import paths start behaving differently.
 */
import { detectDocumentMime, sha256Hex } from '../immutableDocuments.ts';
import { classifyStockFile, MAX_STOCK_FILE_BYTES } from './fileTypes.pure.ts';
import type { StockFileClassification } from './fileTypes.pure.ts';
import { extractStockFile, StockExtractionError } from './extract.ts';
import { extractStockRowsFromImages, extractStockRowsFromText } from './modelExtract.ts';
import { importStockRecords } from './importStock.ts';
import { NOTION_NOT_PUBLIC_MESSAGE } from './urlSource.pure.ts';

/** Wall clock allowed to the model, leaving room for the import itself. */
const MODEL_BUDGET_MS = 90_000;

export interface RunImportInput {
  supabase: any;
  organisationId: string;
  organisationName: string | null;
  builderUserId: string;
  upload: { id: string; original_filename: string };
  bytes: Uint8Array;
  /**
   * Pre-decided reading strategy. URL sources classify from the response as
   * well as the bytes; a file classifies from its name and its bytes, which is
   * what this module does when the caller passes nothing.
   */
  classification?: StockFileClassification;
  /** Shapes the "nothing readable" message. */
  sourceKind?: 'file' | 'url';
  isNotionSource?: boolean;
}

export interface RunImportFailure {
  ok: false;
  code: string;
  /** Safe to show the builder. */
  message: string;
  /** Internal diagnosis. Recorded on the row, never returned to a caller. */
  detail?: string;
  status: number;
  duplicateUploadId?: string;
}

export interface RunImportSuccess {
  ok: true;
  summary: {
    detected: number;
    imported: number;
    updated: number;
    failed: number;
    warnings: string[];
    failures: Array<{ label: string; reason: string }>;
  };
  strategy: string;
  detectedMime: string | null;
  byteSize: number;
  enrichmentPending: number;
  /** The status the upload row was left in. */
  uploadStatus: 'enriching' | 'partially_complete';
}

export type RunImportResult = RunImportSuccess | RunImportFailure;

/**
 * Run the pipeline for one upload row whose bytes are already in hand.
 *
 * The caller owns the row's lifecycle either side of this: it sets `parsing`
 * before, and writes the failure or the success this returns.
 */
export async function runStockImport(input: RunImportInput): Promise<RunImportResult> {
  const { supabase, upload, bytes, organisationId } = input;
  const sourceKind = input.sourceKind ?? 'file';

  if (!bytes.length) {
    return fail('empty_file', sourceKind === 'url'
      ? 'That address returned an empty document.'
      : 'That file is empty.');
  }
  if (bytes.length > MAX_STOCK_FILE_BYTES) {
    return fail('file_too_large', 'That file is larger than the 25 MB limit.');
  }

  // `sha256Hex` is typed for a plain-ArrayBuffer view; a Uint8Array that
  // reached us through a stream reader carries the wider `ArrayBufferLike`.
  const sha = await sha256Hex(bytes as Uint8Array<ArrayBuffer>);

  // Duplicate guard. The same BYTES from the same organisation have already
  // produced whatever they were going to — which is why a URL is not the key:
  // a stock-list page keeps its address and changes its contents.
  const { data: duplicate } = await supabase
    .from('builder_stock_uploads')
    .select('id, original_filename, source_title, created_at')
    .eq('organisation_id', organisationId)
    .eq('file_sha256', sha)
    .is('deleted_at', null)
    .neq('id', upload.id)
    .maybeSingle();
  if (duplicate) {
    const label = duplicate.source_title || duplicate.original_filename;
    return {
      ok: false,
      code: 'duplicate_file',
      message: `This is the same content as "${label}", already imported.`,
      status: 409,
      duplicateUploadId: duplicate.id,
    };
  }

  const detection = detectDocumentMime(bytes);
  if (detection.executable) {
    return fail('executable_file', 'That file is a program, not a document.');
  }

  const classification = input.classification
    ?? classifyStockFile(upload.original_filename, detection.mime, detection.reason);
  if (classification.kind === 'unsupported') {
    return fail('unsupported_file_type', classification.reason ?? 'That file type cannot be read.');
  }

  let extraction;
  try {
    extraction = await extractStockFile(bytes, upload.original_filename, classification);
  } catch (error) {
    if (error instanceof StockExtractionError) {
      return fail(error.code, error.safeMessage, String((error as { underlying?: unknown }).underlying ?? ''));
    }
    throw error;
  }

  // A table is normalised deterministically. Prose and photographs are read by
  // a model first, then normalised by exactly the same code.
  let rows = extraction.rows;
  let strategy = extraction.strategy;
  if (!rows.length && extraction.visionImages.length) {
    const modelResult = await extractStockRowsFromImages(
      extraction.visionImages,
      { filename: upload.original_filename, organisationName: input.organisationName },
      { deadlineAt: Date.now() + MODEL_BUDGET_MS },
    );
    rows = modelResult.rows;
    strategy = `${strategy}+model`;
  } else if (!rows.length && extraction.text) {
    const modelResult = await extractStockRowsFromText(
      extraction.text,
      { filename: upload.original_filename, organisationName: input.organisationName },
      { deadlineAt: Date.now() + MODEL_BUDGET_MS },
    );
    rows = modelResult.rows;
    strategy = `${strategy}+model`;
  }

  const { error: stampError } = await supabase.from('builder_stock_uploads').update({
    status: 'imported',
    detected_content_type: detection.mime,
    file_sha256: sha,
    byte_size: bytes.length,
    parse_strategy: strategy,
  }).eq('id', upload.id);
  // The unique index on (organisation_id, file_sha256) is the duplicate
  // guard's second half: if two imports of the same bytes raced past the
  // lookup above, this is where the loser finds out.
  if (stampError && /duplicate key/i.test(stampError.message || '')) {
    return {
      ok: false,
      code: 'duplicate_file',
      message: 'This content has already been imported.',
      status: 409,
    };
  }

  const outcome = await importStockRecords(supabase, {
    organisationId,
    uploadId: upload.id,
    builderUserId: input.builderUserId,
    rows,
    media: extraction.media,
  });

  if (!outcome.detected) {
    // A Notion page that yielded nothing is almost always a permission
    // problem rather than an empty page, and that is the one refusal a
    // builder can fix themselves.
    if (input.isNotionSource) {
      return fail('notion_not_public', NOTION_NOT_PUBLIC_MESSAGE);
    }
    return fail('no_properties_found', sourceKind === 'url'
      ? 'No properties could be read from that page. Check that it lists one property per row, or upload the stock list instead.'
      : 'No properties could be read from that file. Check that it lists one property per row with column headings.');
  }

  return {
    ok: true,
    summary: {
      detected: outcome.detected,
      imported: outcome.imported,
      updated: outcome.updated,
      failed: outcome.failed,
      warnings: extraction.warnings,
      failures: outcome.failures,
    },
    strategy,
    detectedMime: detection.mime,
    byteSize: bytes.length,
    enrichmentPending: outcome.itemIds.length,
    uploadStatus: outcome.failed > 0 ? 'partially_complete' : 'enriching',
  };
}

function fail(code: string, message: string, detail?: string): RunImportFailure {
  return { ok: false, code, message, detail, status: 400 };
}
