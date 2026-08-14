import {
  routeReportThroughTemplate,
  type TemplateBuilderRouteResult,
} from './routeReportThroughTemplate';

const COMPASS_REPORT_TYPES = ['investment_compass'] as const;

/**
 * Back-compatible Compass pilot entry point.
 *
 * Keep this boundary narrow: PremiumPdfButton calls it for every investment
 * report, while only Compass reports are approved for Template Builder PDF
 * rendering. Other report types must fall through to their legacy renderer.
 */
export function tryRouteThroughTemplateBuilder(
  reportId: string,
  /**
   * The template the person chose for this format, when they have chosen one.
   *
   * Optional, and every existing caller omits it — a report generated without a
   * choice resolves by ranking exactly as it always did.
   */
  templateId?: string | null,
): Promise<TemplateBuilderRouteResult | null> {
  return routeReportThroughTemplate(reportId, {
    reportType: 'investment_compass',
    allowedReportTypes: COMPASS_REPORT_TYPES,
    templateId: templateId ?? null,
  });
}

export type { TemplateBuilderRouteResult };
