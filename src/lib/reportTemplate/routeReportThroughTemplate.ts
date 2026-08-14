/**
 * Generic Template Builder routing helper.
 *
 * Resolves a production-capable adapter for the report, resolves the best
 * matching active template, renders through HTML/WeasyPrint, and returns null
 * so callers can fall back to legacy generators whenever routing is not ready.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { preloadImages } from '@/lib/reportTemplate/imagePreloader';
import { resolveReportTemplate, type ReportVariant } from '@/lib/reportTemplate/resolveTemplate';
import { refuseUnboundReconstruction } from '@/lib/reportTemplate/rendering/productionTemplateGuard';
import { getAdapter, listAdapters, type ReportTemplateAdapter } from '@/lib/reportTemplate/adapters';
import { isSelectableTemplate } from '@/lib/reportTemplate/templateSelection';

export interface TemplateBuilderRouteResult {
  fileUrl: string;
  fileName: string;
  renderer: 'weasyprint';
  templateId: string;
  source: string;
}

function candidateAdapters(reportType?: string | null): ReportTemplateAdapter[] {
  const explicit = getAdapter(reportType);
  if (explicit) return [explicit];
  return listAdapters().filter((adapter) => adapter.supportsProduction);
}

/**
 * The template the person chose, when they chose one.
 *
 * Read back from the server rather than trusted from the caller: the id
 * travelled through the browser, and the row it names has to still be active
 * and still belong to this format. `manage-templates` applies its own read
 * scope on top, so a caller cannot fetch a template they may not see.
 *
 * Returns null — never throws and never substitutes — when the selection no
 * longer applies. The caller then resolves by ranking exactly as it did before
 * selections existed, which is also what the picker has already told the user
 * is happening (`status: 'unavailable'`).
 */
async function loadSelectedTemplate(
  templateId: string, reportType: string,
): Promise<any | null> {
  try {
    const { data, error } = await invokeSecureFunction('manage-templates', {
      operation: 'get',
      table: 'report_templates',
      recordId: templateId,
    });
    const row = (data as any)?.record;
    if (error || !row) {
      console.warn('[routeReportThroughTemplate] selected template unreadable', error);
      return null;
    }
    if (!isSelectableTemplate(row, reportType)) {
      console.warn(
        `[routeReportThroughTemplate] selected template ${templateId} no longer applies to `
        + `${reportType} (active=${row.is_active}, type=${row.report_type}) — falling back to ranking`,
      );
      return null;
    }
    return row;
  } catch (e) {
    console.warn('[routeReportThroughTemplate] selected template lookup failed', e);
    return null;
  }
}

export async function routeReportThroughTemplate(
  reportId: string,
  opts?: {
    agencyId?: string | null;
    userId?: string | null;
    brand?: any;
    reportType?: string | null;
    allowedReportTypes?: readonly string[];
    /**
     * The template the person chose for this format, if they have chosen one.
     *
     * An explicit choice beats the ranking — that is the whole point of a
     * choice. It is still validated against the format and re-read from the
     * server (`loadSelectedTemplate`), and a choice that no longer applies
     * falls back to the ranking rather than failing the generation.
     */
    templateId?: string | null;
  },
): Promise<TemplateBuilderRouteResult | null> {
  try {
    for (const adapter of candidateAdapters(opts?.reportType)) {
      if (!adapter.supportsProduction) continue;

      const routing = await adapter.resolveRoutingContext({ reportId });
      if (!routing?.reportType) continue;
      if (opts?.allowedReportTypes && !opts.allowedReportTypes.includes(routing.reportType.toLowerCase())) continue;

      const selected = opts?.templateId
        ? await loadSelectedTemplate(opts.templateId, routing.reportType)
        : null;

      const resolved = selected
        ? { template: selected, engine: (selected.engine ?? 'jspdf') as 'jspdf' | 'weasyprint', source: 'selected' }
        : await resolveReportTemplate({
          reportType: routing.reportType,
          variant: routing.variant as ReportVariant | null,
          agencyId: opts?.agencyId ?? null,
          userId: opts?.userId ?? null,
        });
      if (!resolved || resolved.engine !== 'weasyprint') continue;

      const tplRow = resolved.template;
      const ctx = await adapter.buildBindingContext({ reportId, brand: opts?.brand });
      const bindingData = ctx?.data ?? {};

      const schema = parseTemplate(tplRow.schema);

      // A template that is a static copy of one client's report will render
      // that client's report for everybody, with only the title substituted.
      // That shipped for two months; see `productionTemplateGuard`. Refusing
      // here falls back to the legacy generator, which is wrong-looking rather
      // than wrong.
      const refusal = refuseUnboundReconstruction(schema);
      if (refusal) {
        console.error(
          `[routeReportThroughTemplate] refusing template ${tplRow.id} `
          + `(${tplRow.name}): ${refusal.reason}`,
        );
        continue;
      }

      // Reference mode — WeasyPrint fetches assets itself. See weasyPreview.ts.
      const preparedSchema = await preloadImages(schema, { mode: 'reference' }).catch(() => schema);
      const { html } = renderTemplateToHtml(preparedSchema, {
        data: bindingData,
        customCss: tplRow.custom_css ?? undefined,
        title: `${tplRow.name} — ${routing.title ?? ''}`.trim(),
        cascadeMetadata: true,
      });

      const safeLabel = String(routing.fileLabel ?? routing.title ?? routing.reportType ?? 'report')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 60);
      const fileName = `${routing.reportType}-${safeLabel}-${reportId.slice(0, 8)}.pdf`;

      const { data: pdfData, error: pdfErr } = await invokeSecureFunction<{
        url: string;
        fileName: string;
      }>('render-template-pdf', {
        html,
        fileName,
        templateId: tplRow.id,
        mode: 'final',
      });
      if (pdfErr || !pdfData?.url) {
        console.warn('[routeReportThroughTemplate] render-template-pdf failed', pdfErr);
        continue;
      }

      return {
        fileUrl: pdfData.url,
        fileName: pdfData.fileName ?? fileName,
        renderer: 'weasyprint',
        templateId: tplRow.id,
        source: `${resolved.source}:${adapter.reportType}`,
      };
    }

    return null;
  } catch (e) {
    console.warn('[routeReportThroughTemplate] unexpected error, falling back', e);
    return null;
  }
}
