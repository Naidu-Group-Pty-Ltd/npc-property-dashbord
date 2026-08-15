/**
 * Builder / Developer Portal — Stock List
 *
 * The builder's half of the Stock List → Property Marketplace feature. Mirrors
 * `builder-portal-inventory` operation for operation: cookie session,
 * governance gate, server-held active organisation, deny-by-default permission
 * resolution, CSRF on every mutation.
 *
 * ORGANISATION SCOPE IS THE WHOLE SECURITY MODEL HERE. Stock belongs to an
 * organisation, not to a project, so there is no project grant to resolve
 * through — which makes it more important, not less, that the organisation is
 * never taken from the request. `activeOrganisationId` comes from the stored
 * session, every query filters on it, and every write re-reads the target row
 * with that filter applied before it changes anything. A stock item id in the
 * body is a lookup key, never authority.
 *
 * Operations
 *   create_upload | process_upload | enrich_images
 *   list_uploads | get_upload
 *   list_stock | get_stock_item | set_availability | archive_stock_item
 *   image_url
 *   list_selections | acknowledge_selection
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  resolveBuilderSession,
  builderGovernanceError,
  builderCan,
  logBuilderProjectActivity,
} from '../_shared/builderPortalAuth.ts';
import { detectDocumentMime, sha256Hex } from '../_shared/immutableDocuments.ts';
import {
  MAX_STOCK_FILE_BYTES, STOCK_LIST_BUCKET, STOCK_IMAGE_BUCKET,
  STOCK_LIST_STORAGE_PREFIX, STOCK_ALLOWED_DECLARED_MIME,
  classifyStockFile, isAcceptableStockStoragePath, safeObjectName,
} from '../_shared/builderStock/fileTypes.pure.ts';
import { extractStockFile, StockExtractionError } from '../_shared/builderStock/extract.ts';
import {
  extractStockRowsFromImages, extractStockRowsFromText,
} from '../_shared/builderStock/modelExtract.ts';
import { importStockRecords } from '../_shared/builderStock/importStock.ts';
import {
  enrichStockItem, type EnrichableStockItem,
} from '../_shared/builderStock/images.ts';
import {
  BUILDER_SELECTION_SELECT, STOCK_AVAILABILITY_STATUSES, STOCK_IMAGE_SELECT,
  STOCK_ITEM_SELECT, STOCK_UPLOAD_SELECT, stockPagination,
} from '../_shared/builderStock/projection.pure.ts';

/** Signed read URLs are short-lived — a leaked link outlives nothing. */
const IMAGE_URL_TTL_SECONDS = 300;

/**
 * Enrichment runs against a wall clock, not a queue. The edge ceiling is about
 * 150s and two network stages per property is a second or two each, so a batch
 * stops when the budget is spent and reports what is left; the page asks again.
 * That is the same shape the investment-report loop uses, and for the same
 * reason.
 */
const ENRICHMENT_BUDGET_MS = 90_000;
const ENRICHMENT_MAX_ITEMS = 25;

function cleanText(value: unknown, max = 200): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, any>));
    const operation = String(body.operation || '');

    const session = await resolveBuilderSession(supabase, req);
    if (!session.ok || !session.user) {
      return json({ error: session.error || 'Unauthorised', code: session.code }, session.status || 401);
    }
    const me = session.user;
    const governanceError = builderGovernanceError(session);
    if (governanceError) return json({ error: 'Portal setup required', code: governanceError }, 403);

    // Server-held. A browser-supplied organisation_id is never consulted.
    const activeOrganisationId = session.active_organisation?.organisation_id ?? null;
    if (!activeOrganisationId) {
      return json({ error: 'Select an organisation to continue', code: 'organisation_selection_required' }, 403);
    }
    const organisationName = session.active_organisation?.trading_name
      ?? session.active_organisation?.legal_name
      ?? null;

    /**
     * Stock is inventory the organisation is offering, so it rides the
     * existing `inventory` permission key rather than inventing a parallel
     * one. Deny by default, resolved in the database.
     */
    const can = (level: 'view' | 'edit' | 'delete') =>
      builderCan(supabase, session, activeOrganisationId, 'inventory', level);

    if (!await can('view')) {
      return json({ error: 'You do not have access to stock', code: 'permission_denied' }, 403);
    }

    /** Load one upload, scoped. A row outside the organisation is "not found". */
    const loadUpload = async (uploadId: string) => {
      if (!uploadId) return null;
      const { data } = await supabase
        .from('builder_stock_uploads')
        .select('*')
        .eq('id', uploadId)
        .eq('organisation_id', activeOrganisationId)
        .maybeSingle();
      return data;
    };

    /** Load one stock item, scoped, the same way. */
    const loadItem = async (itemId: string) => {
      if (!itemId) return null;
      const { data } = await supabase
        .from('builder_stock_items')
        .select('*')
        .eq('id', itemId)
        .eq('organisation_id', activeOrganisationId)
        .maybeSingle();
      return data;
    };

    // =====================================================================
    // Upload
    // =====================================================================

    if (operation === 'create_upload') {
      if (!await can('edit')) {
        return json({ error: 'You do not have permission to upload stock', code: 'permission_denied' }, 403);
      }

      const filename = cleanText(body.filename, 240);
      if (!filename) return json({ error: 'A file name is required' }, 400);

      const declared = cleanText(body.content_type, 200).toLowerCase().split(';')[0].trim();
      if (!STOCK_ALLOWED_DECLARED_MIME.has(declared)) {
        return json({ error: 'That file type cannot be uploaded.', code: 'unsupported_file_type' }, 400);
      }

      const byteSize = Number(body.byte_size);
      if (!Number.isFinite(byteSize) || byteSize < 1) {
        return json({ error: 'That file is empty.', code: 'empty_file' }, 400);
      }
      if (byteSize > MAX_STOCK_FILE_BYTES) {
        return json({
          error: `That file is larger than ${Math.round(MAX_STOCK_FILE_BYTES / (1024 * 1024))} MB.`,
          code: 'file_too_large',
        }, 400);
      }

      // The extension is checked here so an obviously unreadable file is
      // refused before it is stored. The BYTES are checked again at
      // processing time, which is the check that counts.
      const preflight = classifyStockFile(filename, null, 'unknown_content_signature');
      if (preflight.kind === 'unsupported') {
        return json({ error: preflight.reason, code: 'unsupported_file_type' }, 400);
      }

      const uploadId = crypto.randomUUID();
      const storagePath = `${STOCK_LIST_STORAGE_PREFIX}${activeOrganisationId}/${uploadId}/${safeObjectName(filename)}`;

      const { data: upload, error: insertError } = await supabase
        .from('builder_stock_uploads')
        .insert({
          id: uploadId,
          organisation_id: activeOrganisationId,
          uploaded_by_builder_user_id: me.id,
          original_filename: filename,
          declared_content_type: declared || null,
          byte_size: Math.round(byteSize),
          storage_bucket: STOCK_LIST_BUCKET,
          storage_path: storagePath,
          status: 'uploaded',
        })
        .select(STOCK_UPLOAD_SELECT)
        .single();
      if (insertError) {
        console.error('[builder-portal-stock] upload insert failed', insertError.message);
        return json({ error: 'The upload could not be started.' }, 500);
      }

      const { data: signed, error: signError } = await supabase.storage
        .from(STOCK_LIST_BUCKET)
        .createSignedUploadUrl(storagePath);
      if (signError || !signed?.signedUrl) {
        await supabase.from('builder_stock_uploads')
          .update({ status: 'failed', error_code: 'storage_unavailable', error_message: 'Storage could not accept the file.' })
          .eq('id', uploadId);
        return json({ error: 'Storage could not accept the file.' }, 502);
      }

      const raw = signed.signedUrl;
      const absolute = raw.startsWith('http')
        ? raw
        : `${Deno.env.get('SUPABASE_URL')}/storage/v1${raw.startsWith('/') ? '' : '/'}${raw}`;

      await logBuilderProjectActivity(supabase, req, {
        builderUserId: me.id, organisationId: activeOrganisationId,
        action: 'builder_stock_upload_started',
        entityType: 'stock_upload', entityId: uploadId,
        metadata: { filename, declared_content_type: declared },
      });

      return json({ success: true, upload, signed_url: absolute, token: signed.token });
    }

    if (operation === 'process_upload') {
      if (!await can('edit')) {
        return json({ error: 'You do not have permission to upload stock', code: 'permission_denied' }, 403);
      }

      const upload = await loadUpload(cleanText(body.upload_id, 64));
      if (!upload) return json({ error: 'Upload not found' }, 404);
      if (!isAcceptableStockStoragePath(upload.storage_path)) {
        return json({ error: 'That file location is not allowed' }, 400);
      }
      // A second click while the first run is in flight must not import the
      // file twice.
      if (!['uploaded', 'failed'].includes(String(upload.status))) {
        return json({
          error: 'This file has already been processed.',
          code: 'already_processed',
          upload,
        }, 409);
      }

      await supabase.from('builder_stock_uploads').update({
        status: 'parsing',
        processing_started_at: new Date().toISOString(),
        error_code: null, error_message: null, error_detail: null,
      }).eq('id', upload.id);

      const fail = async (code: string, message: string, detail?: unknown) => {
        await supabase.from('builder_stock_uploads').update({
          status: 'failed',
          error_code: code,
          error_message: message,
          // Internal. Never returned by any operation on this function.
          error_detail: detail ? { detail: String(detail).slice(0, 2000) } : null,
          processing_completed_at: new Date().toISOString(),
        }).eq('id', upload.id);
        return json({ success: false, error: message, code }, 400);
      };

      try {
        const { data: blob, error: downloadError } = await supabase.storage
          .from(upload.storage_bucket).download(upload.storage_path);
        if (downloadError || !blob) {
          return await fail('file_missing', 'The uploaded file could not be read. Please upload it again.', downloadError?.message);
        }

        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!bytes.length) return await fail('empty_file', 'That file is empty.');
        if (bytes.length > MAX_STOCK_FILE_BYTES) {
          return await fail('file_too_large', 'That file is larger than the 25 MB limit.');
        }

        const sha = await sha256Hex(bytes);
        // Duplicate processing guard. The same bytes from the same
        // organisation have already produced whatever they were going to.
        const { data: duplicate } = await supabase
          .from('builder_stock_uploads')
          .select('id, original_filename, created_at')
          .eq('organisation_id', activeOrganisationId)
          .eq('file_sha256', sha)
          .neq('id', upload.id)
          .maybeSingle();
        if (duplicate) {
          await supabase.from('builder_stock_uploads').update({
            status: 'failed',
            error_code: 'duplicate_file',
            error_message: `This is the same file as "${duplicate.original_filename}", already imported.`,
            processing_completed_at: new Date().toISOString(),
          }).eq('id', upload.id);
          return json({
            success: false,
            error: `This is the same file as "${duplicate.original_filename}", already imported.`,
            code: 'duplicate_file',
            duplicate_upload_id: duplicate.id,
          }, 409);
        }

        const detection = detectDocumentMime(bytes);
        if (detection.executable) {
          return await fail('executable_file', 'That file is a program, not a document.');
        }
        const classification = classifyStockFile(
          upload.original_filename, detection.mime, detection.reason);
        if (classification.kind === 'unsupported') {
          return await fail('unsupported_file_type', classification.reason ?? 'That file type cannot be read.');
        }

        const extraction = await extractStockFile(bytes, upload.original_filename, classification);

        // A table is normalised deterministically. Prose and photographs are
        // read by a model first, then normalised by exactly the same code.
        let rows = extraction.rows;
        let strategy = extraction.strategy;
        if (!rows.length && extraction.visionImages.length) {
          const modelResult = await extractStockRowsFromImages(
            extraction.visionImages,
            { filename: upload.original_filename, organisationName },
            { deadlineAt: Date.now() + 90_000 },
          );
          rows = modelResult.rows;
          strategy = `${strategy}+model`;
        } else if (!rows.length && extraction.text) {
          const modelResult = await extractStockRowsFromText(
            extraction.text,
            { filename: upload.original_filename, organisationName },
            { deadlineAt: Date.now() + 90_000 },
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
        // guard's second half: if two uploads of the same bytes raced past the
        // lookup above, this is where the loser finds out.
        if (stampError && /duplicate key/i.test(stampError.message || '')) {
          await supabase.from('builder_stock_uploads').update({
            status: 'failed',
            error_code: 'duplicate_file',
            error_message: 'This file has already been imported.',
            processing_completed_at: new Date().toISOString(),
          }).eq('id', upload.id);
          return json({
            success: false,
            error: 'This file has already been imported.',
            code: 'duplicate_file',
          }, 409);
        }

        const outcome = await importStockRecords(supabase, {
          organisationId: activeOrganisationId,
          uploadId: upload.id,
          builderUserId: me.id,
          rows,
          media: extraction.media,
        });

        if (!outcome.detected) {
          return await fail(
            'no_properties_found',
            'No properties could be read from that file. Check that it lists one property per row with column headings.',
          );
        }

        const status = outcome.failed > 0 ? 'partially_complete' : 'enriching';
        const { data: updated } = await supabase.from('builder_stock_uploads').update({
          status,
          records_detected: outcome.detected,
          records_imported: outcome.imported,
          records_updated: outcome.updated,
          records_failed: outcome.failed,
          error_detail: outcome.failures.length ? { failures: outcome.failures } : null,
          error_message: outcome.failures.length
            ? `${outcome.failed} row(s) could not be saved.` : null,
          processing_completed_at: new Date().toISOString(),
        }).eq('id', upload.id).select(STOCK_UPLOAD_SELECT).single();

        await logBuilderProjectActivity(supabase, req, {
          builderUserId: me.id, organisationId: activeOrganisationId,
          action: 'builder_stock_upload_processed',
          entityType: 'stock_upload', entityId: upload.id,
          metadata: {
            detected: outcome.detected, imported: outcome.imported,
            updated: outcome.updated, failed: outcome.failed, strategy,
          },
        });

        return json({
          success: true,
          upload: updated,
          summary: {
            detected: outcome.detected,
            imported: outcome.imported,
            updated: outcome.updated,
            failed: outcome.failed,
            warnings: extraction.warnings,
            // Safe by construction: a label and a short reason, no internals.
            failures: outcome.failures,
          },
          // The page enriches next. Images never block the import.
          enrichment_pending: outcome.itemIds.length,
        });
      } catch (error) {
        if (error instanceof StockExtractionError) {
          return await fail(error.code, error.safeMessage, error.underlying);
        }
        console.error('[builder-portal-stock] processing failed', error);
        return await fail(
          'processing_failed',
          'That file could not be processed. Please check the format and try again.',
          (error as { message?: string })?.message,
        );
      }
    }

    // =====================================================================
    // Image enrichment — stages 2 and 3, resumable
    // =====================================================================

    if (operation === 'enrich_images') {
      if (!await can('edit')) {
        return json({ error: 'You do not have permission to manage stock', code: 'permission_denied' }, 403);
      }

      const uploadId = cleanText(body.upload_id, 64);
      let query = supabase
        .from('builder_stock_items')
        .select('id, organisation_id, address_line, suburb, state, postcode, development_name, project_name, lot_number, unit_number')
        .eq('organisation_id', activeOrganisationId)
        .eq('lifecycle_status', 'active')
        .in('enrichment_status', ['pending', 'enriching'])
        .order('created_at', { ascending: true })
        .limit(ENRICHMENT_MAX_ITEMS);
      if (uploadId) query = query.eq('upload_id', uploadId);

      const { data: pending } = await query;
      const startedAt = Date.now();
      let processed = 0;

      for (const item of pending ?? []) {
        if (Date.now() - startedAt > ENRICHMENT_BUDGET_MS) break;
        try {
          await enrichStockItem(supabase, item as EnrichableStockItem, organisationName);
        } catch (error) {
          // Enrichment is allowed to fail. The property stays.
          console.warn('[builder-portal-stock] enrichment failed', {
            item: (item as { id: string }).id,
            message: String((error as { message?: string })?.message ?? error),
          });
          await supabase.from('builder_stock_items')
            .update({ enrichment_status: 'failed', enriched_at: new Date().toISOString() })
            .eq('id', (item as { id: string }).id);
        }
        processed += 1;
      }

      let remainingQuery = supabase
        .from('builder_stock_items')
        .select('id', { count: 'exact', head: true })
        .eq('organisation_id', activeOrganisationId)
        .eq('lifecycle_status', 'active')
        .in('enrichment_status', ['pending', 'enriching']);
      if (uploadId) remainingQuery = remainingQuery.eq('upload_id', uploadId);
      const { count: remaining } = await remainingQuery;

      if (uploadId && !remaining) {
        const upload = await loadUpload(uploadId);
        if (upload && upload.status === 'enriching') {
          const { data: stageCounts } = await supabase
            .from('builder_stock_item_images')
            .select('source_stage, processing_status')
            .eq('upload_id', uploadId)
            .limit(5000);
          const summary: Record<string, Record<string, number>> = {};
          for (const row of stageCounts ?? []) {
            const stage = String((row as any).source_stage);
            const state = String((row as any).processing_status);
            summary[stage] = summary[stage] ?? {};
            summary[stage][state] = (summary[stage][state] ?? 0) + 1;
          }
          await supabase.from('builder_stock_uploads').update({
            status: upload.records_failed > 0 ? 'partially_complete' : 'complete',
            image_stage_summary: summary,
          }).eq('id', uploadId);
        }
      }

      return json({ success: true, processed, remaining: remaining ?? 0 });
    }

    // =====================================================================
    // Reads
    // =====================================================================

    if (operation === 'list_uploads') {
      const { page, pageSize, from, to } = stockPagination(body);
      const { data, count } = await supabase
        .from('builder_stock_uploads')
        .select(STOCK_UPLOAD_SELECT, { count: 'exact' })
        .eq('organisation_id', activeOrganisationId)
        .order('created_at', { ascending: false })
        .range(from, to);
      return json({
        success: true,
        records: data ?? [],
        pagination: {
          page, page_size: pageSize, total: count ?? 0,
          total_pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
        },
      });
    }

    if (operation === 'get_upload') {
      const upload = await loadUpload(cleanText(body.upload_id, 64));
      if (!upload) return json({ error: 'Upload not found' }, 404);
      // `error_detail` is stripped: the row is selected in full above so the
      // handler can read it, and projected here so the browser cannot.
      const { error_detail: _internal, storage_path: _path, ...safe } = upload;
      return json({ success: true, record: safe });
    }

    if (operation === 'list_stock') {
      const { page, pageSize, from, to } = stockPagination(body);
      const search = cleanText(body.search, 120);
      const availability = cleanText(body.availability_status, 40);
      const uploadId = cleanText(body.upload_id, 64);

      let query = supabase
        .from('builder_stock_items')
        .select(STOCK_ITEM_SELECT, { count: 'exact' })
        .eq('organisation_id', activeOrganisationId)
        .eq('lifecycle_status', cleanText(body.lifecycle_status, 20) || 'active');
      if (uploadId) query = query.eq('upload_id', uploadId);
      if (availability && (STOCK_AVAILABILITY_STATUSES as readonly string[]).includes(availability)) {
        query = query.eq('availability_status', availability);
      }
      if (search) {
        const escaped = search.replace(/[%,()]/g, ' ');
        query = query.or(
          ['address_line', 'suburb', 'development_name', 'project_name', 'external_reference']
            .map((column) => `${column}.ilike.%${escaped}%`).join(','),
        );
      }

      const { data, count } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      const items = data ?? [];
      const decorated = await decorateItems(supabase, items, activeOrganisationId);

      return json({
        success: true,
        records: decorated,
        pagination: {
          page, page_size: pageSize, total: count ?? 0,
          total_pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
        },
      });
    }

    if (operation === 'get_stock_item') {
      const item = await loadItem(cleanText(body.stock_item_id, 64));
      if (!item) return json({ error: 'Property not found' }, 404);
      const [decorated] = await decorateItems(supabase, [item], activeOrganisationId);
      return json({ success: true, record: decorated });
    }

    if (operation === 'image_url') {
      const imageId = cleanText(body.image_id, 64);
      const { data: image } = await supabase
        .from('builder_stock_item_images')
        .select('id, storage_bucket, storage_path, external_url, organisation_id')
        .eq('id', imageId)
        .eq('organisation_id', activeOrganisationId)
        .maybeSingle();
      if (!image) return json({ error: 'Image not found' }, 404);
      if (image.external_url && !image.storage_path) {
        return json({ success: true, url: image.external_url, external: true });
      }
      const { data: signed, error } = await supabase.storage
        .from(image.storage_bucket || STOCK_IMAGE_BUCKET)
        .createSignedUrl(image.storage_path, IMAGE_URL_TTL_SECONDS);
      if (error || !signed?.signedUrl) return json({ error: 'The image could not be prepared' }, 502);
      return json({ success: true, url: signed.signedUrl, expires_in: IMAGE_URL_TTL_SECONDS });
    }

    // =====================================================================
    // Mutations on stock
    // =====================================================================

    if (operation === 'set_availability') {
      if (!await can('edit')) {
        return json({ error: 'You do not have permission to manage stock', code: 'permission_denied' }, 403);
      }
      const item = await loadItem(cleanText(body.stock_item_id, 64));
      if (!item) return json({ error: 'Property not found' }, 404);

      const status = cleanText(body.availability_status, 40);
      if (!(STOCK_AVAILABILITY_STATUSES as readonly string[]).includes(status)) {
        return json({ error: 'That availability status is not recognised' }, 400);
      }

      const { data, error } = await supabase
        .from('builder_stock_items')
        .update({ availability_status: status })
        .eq('id', item.id)
        .eq('organisation_id', activeOrganisationId)
        .select(STOCK_ITEM_SELECT)
        .single();
      if (error) return json({ error: 'The property could not be updated' }, 400);

      await logBuilderProjectActivity(supabase, req, {
        builderUserId: me.id, organisationId: activeOrganisationId,
        action: 'builder_stock_availability_changed',
        entityType: 'stock_item', entityId: item.id,
        previousState: { availability_status: item.availability_status },
        newState: { availability_status: status },
      });
      return json({ success: true, record: data });
    }

    if (operation === 'archive_stock_item') {
      if (!await can('delete')) {
        return json({ error: 'You do not have permission to remove stock', code: 'permission_denied' }, 403);
      }
      const item = await loadItem(cleanText(body.stock_item_id, 64));
      if (!item) return json({ error: 'Property not found' }, 404);

      const { data, error } = await supabase
        .from('builder_stock_items')
        .update({ lifecycle_status: 'archived' })
        .eq('id', item.id)
        .eq('organisation_id', activeOrganisationId)
        .select(STOCK_ITEM_SELECT)
        .single();
      if (error) return json({ error: 'The property could not be archived' }, 400);

      await logBuilderProjectActivity(supabase, req, {
        builderUserId: me.id, organisationId: activeOrganisationId,
        action: 'builder_stock_item_archived',
        entityType: 'stock_item', entityId: item.id,
      });
      return json({ success: true, record: data });
    }

    // =====================================================================
    // Activations — the builder's side of the two-way link
    // =====================================================================

    if (operation === 'list_selections') {
      const { page, pageSize, from, to } = stockPagination(body);
      const { data, count } = await supabase
        .from('builder_stock_selections')
        // BUILDER_SELECTION_SELECT omits client_id, selected_by_user_id and
        // internal_notes. The builder learns THAT one of their properties was
        // selected, never who by or for whom.
        .select(BUILDER_SELECTION_SELECT, { count: 'exact' })
        .eq('organisation_id', activeOrganisationId)
        .order('selected_at', { ascending: false })
        .range(from, to);

      const selections = data ?? [];
      const itemIds = Array.from(new Set(selections.map((row: any) => row.stock_item_id)));
      const { data: items } = itemIds.length
        ? await supabase.from('builder_stock_items')
          .select('id, address_line, suburb, state, development_name, project_name, lot_number, unit_number, external_reference, price, availability_status')
          .eq('organisation_id', activeOrganisationId)
          .in('id', itemIds)
        : { data: [] };
      const itemById = new Map((items ?? []).map((item: any) => [item.id, item]));

      return json({
        success: true,
        records: selections.map((row: any) => ({
          ...row,
          stock_item: itemById.get(row.stock_item_id) ?? null,
        })),
        pagination: {
          page, page_size: pageSize, total: count ?? 0,
          total_pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
        },
      });
    }

    if (operation === 'acknowledge_selection') {
      if (!await can('edit')) {
        return json({ error: 'You do not have permission to manage stock', code: 'permission_denied' }, 403);
      }
      const selectionId = cleanText(body.selection_id, 64);
      const { data: selection } = await supabase
        .from('builder_stock_selections')
        .select('id, status, organisation_id, stock_item_id')
        .eq('id', selectionId)
        .eq('organisation_id', activeOrganisationId)
        .maybeSingle();
      if (!selection) return json({ error: 'Selection not found' }, 404);
      if (selection.status !== 'selected') {
        return json({ error: 'This selection has already moved on.', code: 'not_acknowledgeable' }, 409);
      }

      const { data, error } = await supabase
        .from('builder_stock_selections')
        .update({
          status: 'builder_acknowledged',
          acknowledged_at: new Date().toISOString(),
          acknowledged_by_builder_user_id: me.id,
        })
        .eq('id', selection.id)
        .eq('organisation_id', activeOrganisationId)
        .select(BUILDER_SELECTION_SELECT)
        .single();
      if (error) return json({ error: 'The selection could not be updated' }, 400);

      await logBuilderProjectActivity(supabase, req, {
        builderUserId: me.id, organisationId: activeOrganisationId,
        action: 'builder_stock_selection_acknowledged',
        entityType: 'stock_selection', entityId: selection.id,
      });
      return json({ success: true, record: data });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (error) {
    console.error('[builder-portal-stock] unhandled', error);
    return new Response(
      JSON.stringify({ error: 'The stock service is unavailable.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

/**
 * Attach images and the live selection state to a page of items.
 *
 * One query per collection rather than per row: a 100-row stock page must not
 * become 201 round trips.
 */
async function decorateItems(
  supabase: any,
  items: any[],
  organisationId: string,
): Promise<any[]> {
  if (!items.length) return [];
  const ids = items.map((item) => item.id);

  const [{ data: images }, { data: selections }] = await Promise.all([
    supabase.from('builder_stock_item_images')
      .select(STOCK_IMAGE_SELECT)
      .in('stock_item_id', ids)
      .eq('organisation_id', organisationId)
      .order('position', { ascending: true }),
    supabase.from('builder_stock_selections')
      .select('id, stock_item_id, status, selected_at, acknowledged_at')
      .in('stock_item_id', ids)
      .eq('organisation_id', organisationId)
      .neq('status', 'withdrawn'),
  ]);

  const imagesByItem = new Map<string, any[]>();
  for (const image of images ?? []) {
    const list = imagesByItem.get(image.stock_item_id) ?? [];
    list.push(image);
    imagesByItem.set(image.stock_item_id, list);
  }
  const selectionsByItem = new Map<string, any[]>();
  for (const selection of selections ?? []) {
    const list = selectionsByItem.get(selection.stock_item_id) ?? [];
    list.push(selection);
    selectionsByItem.set(selection.stock_item_id, list);
  }

  return items.map((item) => ({
    ...item,
    images: imagesByItem.get(item.id) ?? [],
    // The builder's activation signal: how many Command Centre selections this
    // property has, and where the most recent one is up to.
    selection_count: (selectionsByItem.get(item.id) ?? []).length,
    latest_selection: (selectionsByItem.get(item.id) ?? [])
      .sort((a, b) => String(b.selected_at).localeCompare(String(a.selected_at)))[0] ?? null,
  }));
}
