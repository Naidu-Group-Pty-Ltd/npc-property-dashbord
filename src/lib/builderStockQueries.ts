/**
 * Builder Portal — Stock List query layer.
 *
 * Mirrors `src/lib/builderQueries.ts`: one `invoke` wrapper that raises a typed
 * error, query keys under the same `builder` root, and one hook per surface.
 * Every call goes through `invokeBuilderFunction`, which carries the HttpOnly
 * portal cookie — the browser never reaches the database directly and never
 * names an organisation.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeBuilderFunction } from '@/lib/builderPortal';
import type {
  BuilderStockItem, BuilderStockSelectionForBuilder, BuilderStockUpload,
} from '@/lib/builderStock';

export const builderStockKeys = {
  root: () => ['builder', 'stock'] as const,
  uploads: (page: number) => ['builder', 'stock', 'uploads', page] as const,
  items: (filters: StockFilters) => ['builder', 'stock', 'items', filters] as const,
  item: (id: string) => ['builder', 'stock', 'item', id] as const,
  selections: (page: number) => ['builder', 'stock', 'selections', page] as const,
};

export interface StockFilters {
  search: string;
  availability: string;
  uploadId: string;
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  records: T[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeBuilderFunction<T>('builder-portal-stock', body);
  if (error) {
    const failure = new Error(error.message) as Error & { code?: string; status?: number };
    failure.code = error.code;
    failure.status = error.status;
    throw failure;
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function useBuilderStockUploads(page = 1) {
  return useQuery({
    queryKey: builderStockKeys.uploads(page),
    queryFn: () => invoke<Paginated<BuilderStockUpload>>({
      operation: 'list_uploads', page, page_size: 20,
    }),
  });
}

export function useBuilderStockItems(filters: StockFilters) {
  return useQuery({
    queryKey: builderStockKeys.items(filters),
    queryFn: () => invoke<Paginated<BuilderStockItem>>({
      operation: 'list_stock',
      search: filters.search,
      availability_status: filters.availability,
      upload_id: filters.uploadId,
      page: filters.page,
      page_size: filters.pageSize,
    }),
  });
}

export function useBuilderStockSelections(page = 1) {
  return useQuery({
    queryKey: builderStockKeys.selections(page),
    queryFn: () => invoke<Paginated<BuilderStockSelectionForBuilder>>({
      operation: 'list_selections', page, page_size: 20,
    }),
  });
}

/** A short-lived signed URL for one stored image. */
export async function builderStockImageUrl(imageId: string): Promise<string | null> {
  try {
    const result = await invoke<{ url?: string }>({ operation: 'image_url', image_id: imageId });
    return result.url ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface StockUploadProgress {
  phase: 'requesting' | 'uploading' | 'processing' | 'enriching' | 'done';
  /** Properties still waiting for image enrichment, while phase is 'enriching'. */
  remaining?: number;
}

export interface StockImportSummary {
  detected: number;
  imported: number;
  updated: number;
  failed: number;
  warnings: string[];
  failures: Array<{ label: string; reason: string }>;
}

export interface StockUploadResult {
  upload: BuilderStockUpload;
  summary: StockImportSummary;
}

/** What deleting a source affected. Counts only — no client is named. */
export interface StockSourceRemoval {
  archived: number;
  retainedBecauseResupplied: number;
  affectedSelections: number;
}

/**
 * The whole upload, start to finish.
 *
 * Four steps, and the last one is a LOOP on purpose. Image enrichment makes
 * two network calls per property against providers we do not control, so it
 * cannot finish inside one edge invocation for a schedule of any size. The
 * server does what it can within its budget and reports what is left; this
 * asks again until nothing is. A failure in that loop leaves the properties
 * imported — the import is already committed by then.
 */
export async function uploadBuilderStockFile(
  file: File,
  onProgress?: (progress: StockUploadProgress) => void,
): Promise<StockUploadResult> {
  onProgress?.({ phase: 'requesting' });

  const created = await invoke<{
    upload: BuilderStockUpload; signed_url: string; token: string;
  }>({
    operation: 'create_upload',
    filename: file.name,
    content_type: file.type || 'application/octet-stream',
    byte_size: file.size,
  });

  onProgress?.({ phase: 'uploading' });
  const put = await fetch(created.signed_url, {
    method: 'PUT',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) throw new Error('The file could not be uploaded. Please try again.');

  onProgress?.({ phase: 'processing' });
  const processed = await invoke<{
    upload: BuilderStockUpload; summary: StockImportSummary; enrichment_pending: number;
  }>({ operation: 'process_upload', upload_id: created.upload.id });

  // Enrichment is best-effort from here. The properties exist.
  try {
    let guard = 0;
    let remaining = processed.enrichment_pending ?? 0;
    while (remaining > 0 && guard < 40) {
      onProgress?.({ phase: 'enriching', remaining });
      const batch = await invoke<{ processed: number; remaining: number }>({
        operation: 'enrich_images', upload_id: created.upload.id,
      });
      remaining = batch.remaining;
      // A batch that moved nothing will not move anything next time either.
      if (!batch.processed) break;
      guard += 1;
    }
  } catch {
    /* Images are an enhancement. The import stands without them. */
  }

  onProgress?.({ phase: 'done' });
  return { upload: processed.upload, summary: processed.summary };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Import a stock list the builder linked to rather than uploaded.
 *
 * The browser sends only the URL. The server fetches it — behind the SSRF
 * guard, with every redirect re-checked — snapshots what it got, and runs the
 * same import a file goes through. Enrichment then resumes exactly as it does
 * after an upload.
 */
export async function importBuilderStockUrl(
  url: string,
  onProgress?: (progress: StockUploadProgress) => void,
): Promise<StockUploadResult> {
  onProgress?.({ phase: 'processing' });
  const imported = await invoke<{
    upload: BuilderStockUpload; summary: StockImportSummary; enrichment_pending: number;
  }>({ operation: 'import_url', url });

  try {
    let guard = 0;
    let remaining = imported.enrichment_pending ?? 0;
    while (remaining > 0 && guard < 40) {
      onProgress?.({ phase: 'enriching', remaining });
      const batch = await invoke<{ processed: number; remaining: number }>({
        operation: 'enrich_images', upload_id: imported.upload.id,
      });
      remaining = batch.remaining;
      if (!batch.processed) break;
      guard += 1;
    }
  } catch {
    /* Images are an enhancement. The import stands without them. */
  }

  onProgress?.({ phase: 'done' });
  return { upload: imported.upload, summary: imported.summary };
}

/** Remove a stock-list source. Requires the inventory DELETE permission. */
export function useDeleteBuilderStockSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (uploadId: string) =>
      invoke<{ removed: StockSourceRemoval }>({
        operation: 'delete_upload', upload_id: uploadId,
      }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: builderStockKeys.root() }); },
  });
}

export function useSetBuilderStockAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { stockItemId: string; availability: string }) =>
      invoke<{ record: BuilderStockItem }>({
        operation: 'set_availability',
        stock_item_id: input.stockItemId,
        availability_status: input.availability,
      }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: builderStockKeys.root() }); },
  });
}

export function useArchiveBuilderStockItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stockItemId: string) =>
      invoke<{ record: BuilderStockItem }>({
        operation: 'archive_stock_item', stock_item_id: stockItemId,
      }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: builderStockKeys.root() }); },
  });
}

export function useAcknowledgeStockSelection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (selectionId: string) =>
      invoke<{ record: BuilderStockSelectionForBuilder }>({
        operation: 'acknowledge_selection', selection_id: selectionId,
      }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: builderStockKeys.root() }); },
  });
}

/** What one source yielded when its imagery was recovered. */
export interface StockSourceImageRepair {
  upload_id: string;
  rows_read: number;
  rows_with_imagery: number;
  matched: number;
  images_stored: number;
  primary_updated: number;
  error: string | null;
}

/**
 * Re-read a source and attach the imagery it supplied.
 *
 * For stock that is ALREADY imported. Nothing is created, no property field is
 * touched and no client selection moves — the source is read again and the
 * builder's own photographs are attached to the properties they came from,
 * which is what the earlier import failed to do.
 */
export function useRecoverStockSourceImages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (uploadId?: string) =>
      invoke<{ results: StockSourceImageRepair[] }>({
        operation: 'reprocess_source_images',
        ...(uploadId ? { upload_id: uploadId } : {}),
      }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: builderStockKeys.root() }); },
  });
}

/** Resume enrichment for stock left pending by an earlier upload. */
export function useEnrichPendingStockImages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<{ processed: number; remaining: number }>({
      operation: 'enrich_images',
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: builderStockKeys.root() }); },
  });
}
