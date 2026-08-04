/**
 * convert-template-document
 *
 * An existing template goes in; a document set through the report design system
 * and bound to a report format comes out.
 *
 * ## The three steps, and why they are three requests
 *
 * `extract` parses, `propose` re-scores against a different format, `render`
 * produces the PDF. They are separate because a person sits between them:
 * binding is *suggested and then confirmed*, never silently guessed. A wrong
 * automatic binding produces a document where the "Serviceability" chapter is
 * filled with the fee schedule, which looks entirely correct and is completely
 * wrong. A visible low score is recoverable; a silent mismatch is not.
 *
 * `propose` re-reads the stored Markdown rather than the upload, so trying a
 * second format costs nothing. Parsing a PDF is the slow and expensive half.
 *
 * ## What is taken from the upload, and what is deliberately left
 *
 * Sections, their order, their nesting and whether they are tabular. Not
 * margins, not colours, not where a logo sat — those are the things the design
 * system is replacing, and carrying them across would reproduce the document
 * rather than refurbish it.
 *
 * ## The source never becomes a stored file
 *
 * The bytes arrive in the request and the extracted Markdown is stored on the
 * row. No bucket, so an abandoned conversion leaves no orphaned object — which
 * matters here because the repo's artifact retention job is dry-run by design
 * and never deletes anything.
 *
 * ## Nothing is rendered without a design system
 *
 * The palette comes from the chosen `brand_design_systems` row, resolved at
 * render time. Storing a resolved palette would freeze it against the preset it
 * was derived under, which is a bug this repo has shipped once already.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuthOrNativeUser } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { assertSafeRenderResources } from '../_shared/renderResourcePolicy.pure.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';
import { countPdfPages, renderPdf, weasyPrintConfig } from '../_shared/weasyprintClient.ts';
import {
  buildReportBrandSnapshot,
  REPORT_SNAPSHOT_VERSION,
} from '../_shared/reportDesign/snapshot.pure.ts';
import { inlineAsset } from '../_shared/reportDesign/assets.pure.ts';
import { inlineBrandAssets } from '../_shared/reportDesign/fetchBrandAssets.ts';
import { resolveReportPalette } from '../_shared/reportDesign/brandResolve.pure.ts';
import {
  DEFAULT_REPORT_DESIGN_OPTIONS,
  normalizeReportDesignOptions,
} from '../_shared/reportDesign/options.pure.ts';
import {
  describeStructure,
  type ExtractedStructure,
  extractStructure,
  MAX_SOURCE_CHARS,
} from '../_shared/reports/converted/structure.pure.ts';
import {
  formatName,
  proposeBinding,
  readBindingPlan,
} from '../_shared/reports/converted/binding.pure.ts';
import { renderConvertedFromBrand } from '../_shared/reports/converted/render.pure.ts';
import {
  type ConvertExtractResponse,
  type ConvertProposeResponse,
  type ConvertRenderResponse,
  convertedFileName,
  convertedReference,
  convertedStoragePath,
  base64Bytes,
  parseConvertRequest,
  pdfExtractionPrompt,
  SIGNED_URL_TTL_SECONDS,
  STORAGE_BUCKET,
} from '../_shared/reports/converted/route.pure.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token, x-finance-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-8';
/** A forty-page template through vision extraction is not a quick call. */
const MODEL_TIMEOUT_MS = 240_000;

/**
 * The company block, out of the key/value table it lives in.
 *
 * `global_report_settings` is `(setting_key, setting_value jsonb)`. Reading it
 * as though it had `contact_details` and `disclaimer` columns is the mistake
 * that shipped every Borrowing Capacity Snapshot without an ABN.
 */
function readReportSettings(
  rows: unknown,
  queryError: string | null,
): { contact: Record<string, unknown> | null; disclaimer: Record<string, unknown> | null } {
  if (queryError) {
    console.warn(`[convert-template-document] global_report_settings unreadable: ${queryError}`);
  }
  let contact: Record<string, unknown> | null = null;
  let disclaimer: Record<string, unknown> | null = null;
  for (const row of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
    const value = row.setting_value;
    if (!value || typeof value !== 'object') continue;
    if (row.setting_key === 'contact_details') contact = value as Record<string, unknown>;
    else if (row.setting_key === 'professional_disclaimer') disclaimer = value as Record<string, unknown>;
  }
  return { contact, disclaimer };
}

/** Base64 to bytes, without a data-URI prefix. */
function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64.replace(/^data:[^,]*,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A PDF to Markdown, by asking Claude to transcribe it.
 *
 * The alternative — a text-layer extraction — returns the words and loses the
 * headings, and headings are the only thing `extractStructure` reads. A
 * transcription with no `##` produces a one-section document and a notice
 * saying so, which is a correct outcome and a useless one.
 *
 * Sent as a `document` content block, so a scanned template goes through the
 * same path as a native one rather than needing an OCR branch.
 */
async function pdfToMarkdown(
  apiKey: string,
  base64: string,
  fileName: string,
): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16_000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            { type: 'text', text: pdfExtractionPrompt(fileName) },
          ],
        }],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    return { ok: false, error: `the extraction service did not answer: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return {
      ok: false,
      error: `the extraction service refused (${response.status}): ${detail.slice(0, 300)}`,
    };
  }

  const message = await response.json().catch(() => null) as
    | { content?: Array<{ type?: string; text?: string }> }
    | null;
  const markdown = (Array.isArray(message?.content) ? message!.content : [])
    .filter((b) => b?.type === 'text')
    .map((b) => b?.text ?? '')
    .join('\n')
    .trim();

  if (!markdown) return { ok: false, error: 'nothing could be read from the PDF' };
  return { ok: true, markdown };
}

/** The shape the review screen needs, out of an extracted structure. */
function sectionRows(structure: ExtractedStructure): ConvertExtractResponse['sections'] {
  return structure.sections.map((s) => ({
    index: s.index,
    depth: s.depth,
    title: s.title,
    chars: s.chars,
    tabular: s.tabular,
  }));
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const started = Date.now();
  let conversionId: string | null = null;

  try {
    const body = await req.json().catch(() => null);

    const auth = await verifyAuthOrNativeUser(
      supabase,
      req,
      body as { session_token?: string; command_centre_session_token?: string },
    );
    if (auth.error || !auth.userId || auth.userId === 'service_role') {
      return json({ error: auth.error || 'Authentication required' }, 401);
    }

    const parsed = parseConvertRequest(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const request = parsed.request;

    const permission = await requireModulePermission(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      'templates',
      'can_edit',
    );
    if (!permission.ok) {
      return json({ error: permission.error || 'Templates edit permission required' }, 403);
    }

    // ── extract ─────────────────────────────────────────────────────────────

    if (request.action === 'extract') {
      let markdown: string;
      if (request.kind === 'text') {
        markdown = new TextDecoder().decode(decodeBase64(request.sourceBase64));
      } else {
        const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
        if (!apiKey) {
          return json({
            error: 'PDF extraction is not configured (ANTHROPIC_API_KEY). '
              + 'A Markdown or text source converts without it.',
          }, 503);
        }
        const read = await pdfToMarkdown(apiKey, request.sourceBase64, request.fileName);
        if (!read.ok) return json({ error: read.error }, 502);
        markdown = read.markdown;
      }

      const structure = extractStructure(markdown, request.fileName.replace(/\.[a-z0-9]+$/i, ''));
      if (!structure.sections.length) {
        return json({
          error: 'nothing readable was found in the upload — no section reached the minimum length',
        }, 400);
      }

      const plan = proposeBinding(request.format, structure);

      const { data: row, error: insertError } = await supabase
        .from('template_conversions')
        .insert({
          requested_by: auth.userId,
          status: 'review',
          source_filename: request.fileName,
          // The uploaded file's own size, not the base64 the wire carried and
          // not the length of the Markdown that came back — for a PDF those are
          // three different numbers and only one of them is what a person means
          // by "how big was the file I uploaded".
          source_size_bytes: base64Bytes(request.sourceBase64),
          source_markdown: markdown.slice(0, MAX_SOURCE_CHARS),
          structure,
          binding: plan,
          bound_format: request.format,
          bound_chapters: plan.bindings.filter((b) => b.sectionIndex !== null).length,
          unfilled_chapters: plan.unfilled.length,
          appendix_sections: plan.unbound.length,
          unstructured: structure.notices.unstructured,
        })
        .select('id')
        .maybeSingle();

      if (insertError) throw new Error(`could not record the conversion: ${insertError.message}`);
      if (!row) throw new Error('the conversion was not recorded');
      conversionId = String(row.id);

      const response: ConvertExtractResponse = {
        action: 'extract',
        conversionId,
        format: request.format,
        formatName: formatName(request.format),
        summary: describeStructure(structure),
        title: structure.title,
        sections: sectionRows(structure),
        unstructured: structure.notices.unstructured,
        flattened: structure.notices.flattened,
        tooShort: structure.notices.tooShort,
        charsOmitted: structure.notices.charsOmitted,
        binding: plan,
        durationMs: Date.now() - started,
      };
      return json(response);
    }

    // ── the stored conversion, for propose and render ───────────────────────

    const { data: conversion, error: readError } = await supabase
      .from('template_conversions')
      .select('id, requested_by, status, source_markdown, structure, source_filename')
      .eq('id', request.conversionId)
      .maybeSingle();

    // The error before the data. A failed query that returns nothing is not a
    // conversion that does not exist, and answering 404 to a database problem
    // sends somebody looking for the wrong thing.
    if (readError) throw new Error(`could not read template_conversions: ${readError.message}`);
    if (!conversion) return json({ error: 'not found' }, 404);

    // A conversion holds whatever prose was in somebody's uploaded template.
    // The table's RLS says the same thing; this route runs as service role and
    // so has to say it again itself.
    const isOwner = String(conversion.requested_by ?? '') === auth.userId;
    if (!isOwner) {
      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', auth.userId);
      const superadmin = (roleRows ?? []).some(
        (r: { role?: string }) => String(r?.role ?? '').toLowerCase() === 'superadmin',
      );
      if (!superadmin) return json({ error: 'not found' }, 404);
    }

    // Set only once the row is known to exist and to be this caller's. The
    // catch below writes a failure onto whatever `conversionId` names, and a
    // row the caller may not read is not a row this request should be able to
    // stamp `failed`.
    conversionId = request.conversionId;

    // Re-extracted rather than trusted. The stored `structure` column is a
    // convenience for the review screen; the binding indices are re-checked
    // against a structure derived from the Markdown, so a hand-edited jsonb
    // column cannot point a chapter at a section that is not there.
    const structure = extractStructure(
      String(conversion.source_markdown ?? ''),
      String(conversion.source_filename ?? '').replace(/\.[a-z0-9]+$/i, ''),
    );
    if (!structure.sections.length) {
      return json({ error: 'this conversion has no stored sections — re-upload the template' }, 409);
    }

    if (request.action === 'propose') {
      const plan = proposeBinding(request.format, structure);
      await supabase
        .from('template_conversions')
        .update({
          binding: plan,
          bound_format: request.format,
          bound_chapters: plan.bindings.filter((b) => b.sectionIndex !== null).length,
          unfilled_chapters: plan.unfilled.length,
          appendix_sections: plan.unbound.length,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversionId);

      const response: ConvertProposeResponse = {
        action: 'propose',
        conversionId,
        format: request.format,
        formatName: formatName(request.format),
        binding: plan,
        durationMs: Date.now() - started,
      };
      return json(response);
    }

    // ── render ──────────────────────────────────────────────────────────────

    const weasyprint = weasyPrintConfig((key) => Deno.env.get(key));
    if (!weasyprint) {
      return json({
        error: 'WeasyPrint is not configured (WEASYPRINT_SERVICE_URL + WEASYPRINT_SERVICE_TOKEN)',
      }, 503);
    }

    const plan = readBindingPlan(request.binding, request.format, structure);

    await supabase
      .from('template_conversions')
      .update({ status: 'rendering', updated_at: new Date().toISOString() })
      .eq('id', conversionId);

    const [systemRes, whitelabelRes, settingsRes] = await Promise.all([
      request.designSystemId
        ? supabase
          .from('brand_design_systems')
          .select('id, name, brand_hex, options')
          .eq('id', request.designSystemId)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('whitelabel_settings').select('*').limit(1).maybeSingle(),
      supabase
        .from('global_report_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['contact_details', 'professional_disclaimer']),
    ]);

    if (systemRes.error) {
      throw new Error(`could not read brand_design_systems: ${systemRes.error.message}`);
    }
    // A named system that is not there is refused rather than quietly replaced
    // by the house default: somebody chose it, and a document in a different
    // design from the one chosen is worse than no document.
    if (request.designSystemId && !systemRes.data) {
      return json({ error: 'that design system no longer exists' }, 404);
    }

    const systemRow = systemRes.data as Record<string, unknown> | null;
    const systemName = String(systemRow?.name ?? 'House design');
    const options = normalizeReportDesignOptions(
      (systemRow?.options as Record<string, unknown>) ?? DEFAULT_REPORT_DESIGN_OPTIONS,
    );
    const brandHex = typeof systemRow?.brand_hex === 'string' ? systemRow.brand_hex : null;
    const palette = resolveReportPalette({ preset: options.preset, brandHex });

    const whitelabel = (whitelabelRes.data ?? null) as Record<string, unknown> | null;
    const settings = readReportSettings(settingsRes.data, settingsRes.error?.message ?? null);
    const storedLogos = (whitelabel?.logo_config ?? {}) as Record<string, string | null>;
    const themeConfig = (whitelabel?.theme_config ?? {}) as Record<string, unknown>;

    const { assets: logoConfig, notes: assetNotes } = await inlineBrandAssets(storedLogos, {
      supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
    });
    for (const note of assetNotes) {
      console.warn(
        `[convert-template-document] asset ${note.key} not inlined (${note.reason}): ${note.detail}`,
      );
    }

    const { snapshot, skippedAssets } = buildReportBrandSnapshot({
      whitelabel: whitelabel
        ? {
            id: String(whitelabel.id ?? ''),
            themeVersion: Number(whitelabel.theme_version ?? 0) || null,
            companyName: String(whitelabel.company_name ?? ''),
            tradingName: String(themeConfig.tradingName ?? ''),
            brandColour: String(themeConfig.brandColour ?? whitelabel.primary_color ?? ''),
            preset: String(themeConfig.reportPreset ?? ''),
            assets: logoConfig,
          }
        : null,
      contact: settings.contact as never,
      document: {
        confidentiality: String(themeConfig.reportConfidentiality ?? ''),
        preparedBy: String(whitelabel?.company_name ?? ''),
      },
      capturedAt: new Date().toISOString(),
    });

    for (const skipped of skippedAssets) {
      console.warn(
        `[convert-template-document] asset ${skipped.source} skipped (${skipped.reason}): ${skipped.detail}`,
      );
    }

    const { data: brandSnapshotId } = await supabase.rpc('upsert_report_brand_snapshot', {
      _fingerprint: snapshot.fingerprint,
      _snapshot_version: REPORT_SNAPSHOT_VERSION,
      _payload: snapshot,
      _company_name: snapshot.company.name,
      _brand_hex: snapshot.brandHex,
      _source_whitelabel_setting_id: snapshot.source.whitelabelSettingId,
    });

    const coverArt = inlineAsset(logoConfig.cover ?? null);

    const rendered = renderConvertedFromBrand({
      structure,
      plan,
      snapshot,
      palette,
      options,
      systemName,
      disclaimer: settings.disclaimer as never,
      coverArtDataUri: coverArt.ok ? coverArt.asset.dataUri : null,
      preparedOn: new Date().toISOString(),
      reference: convertedReference(conversionId),
    });

    // The page band is advisory for a converted draft and lives in `bandNote`
    // instead — a draft carries appendix chapters the format never has. Every
    // other rule `validateSpine` enforces is a real defect here too.
    if (rendered.problems.length) {
      throw new Error(`document structure is invalid: ${rendered.problems.join('; ')}`);
    }

    // The prose came out of a file somebody uploaded and, for a PDF, through a
    // model. The boundary is where the check belongs.
    assertSafeRenderResources(rendered.html, Deno.env.get('SUPABASE_URL') || '');

    const fileName = convertedFileName(structure.title, request.format);
    const path = convertedStoragePath(conversionId, fileName);

    const pdf = await renderPdf(weasyprint, rendered.html, { variant: 'pdf/a-2b', tagged: true });

    // `upsert: true`: re-rendering one conversion after changing its binding is
    // the normal way this screen is used, and each render is the current draft
    // of that conversion rather than a new artefact.
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, pdf, {
      contentType: 'application/pdf',
      upsert: true,
      cacheControl: '3600',
    });
    if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);

    const { data: signed, error: signError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      throw new Error(`signing failed: ${signError?.message ?? 'no url returned'}`);
    }

    const durationMs = Date.now() - started;
    const pageCount = countPdfPages(pdf);

    await supabase
      .from('template_conversions')
      .update({
        status: 'succeeded',
        binding: plan,
        bound_format: request.format,
        design_system_id: request.designSystemId,
        file_name: fileName,
        storage_bucket: STORAGE_BUCKET,
        storage_path: path,
        bytes: pdf.length,
        page_count: pageCount,
        bound_chapters: rendered.boundCount,
        unfilled_chapters: rendered.unfilledCount,
        appendix_sections: rendered.appendixCount,
        brand_snapshot_id: (brandSnapshotId as string) ?? null,
        duration_ms: durationMs,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversionId);

    const response: ConvertRenderResponse = {
      action: 'render',
      conversionId,
      url: signed.signedUrl,
      fileName,
      bytes: pdf.length,
      pageCount,
      storagePath: path,
      brandSnapshotId: (brandSnapshotId as string) ?? null,
      brandGaps: rendered.gaps,
      designSystemName: systemName,
      chapters: rendered.chapters,
      boundCount: rendered.boundCount,
      unfilledCount: rendered.unfilledCount,
      appendixCount: rendered.appendixCount,
      bandNote: rendered.bandNote,
      durationMs,
    };
    return json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[convert-template-document]', message);
    if (conversionId) {
      // Every attempt leaves the row saying what happened. A conversion stuck
      // at `rendering` with no error is one nobody can debug from production.
      await supabase
        .from('template_conversions')
        .update({
          status: 'failed',
          error: message.slice(0, 2000),
          duration_ms: Date.now() - started,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversionId);
    }
    return json({ error: message }, 500);
  }
});

Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
