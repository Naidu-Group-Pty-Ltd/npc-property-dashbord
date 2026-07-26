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
): Promise<TemplateBuilderRouteResult | null> {
  return routeReportThroughTemplate(reportId, {
    reportType: 'investment_compass',
    allowedReportTypes: COMPASS_REPORT_TYPES,
  });
}

export type { TemplateBuilderRouteResult };
