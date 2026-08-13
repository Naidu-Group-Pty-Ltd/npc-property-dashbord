export interface TemplateBindingContext {
  data: Record<string, any>;
  meta: { reportId: string; reportType: string; variant: string | null; tier: string | null };
}

export interface BrandContext {
  tokens?: Record<string, any>;
  logoUrl?: string | null;
}

export interface RoutingContext {
  reportId: string;
  reportType: string;
  variant: string | null;
  tier: string | null;
  title?: string | null;
  fileLabel?: string | null;
  sourceTable?: string;
  legacyFallback?: LegacyFallbackDescriptor;
}

export interface LegacyFallbackDescriptor {
  label: string;
  route?: string;
  reason?: string;
}

export interface ReportTemplateAdapter {
  reportType: string;
  label: string;
  supportsProduction: boolean;
  samplePresetIds?: string[];
  legacyFallback?: LegacyFallbackDescriptor;
  /**
   * `variant` is what the caller asked for rather than what the row says — the
   * Cash Flow adapter reads it to pick one of three stored scenarios, and the
   * others derive their own from the record and ignore it. Optional, because
   * every existing caller omits it and the adapters that use it have a default.
   */
  resolveRoutingContext(input: { reportId: string; variant?: string | null }): Promise<RoutingContext | null>;
  buildBindingContext(input: { reportId: string; variant?: string | null; brand?: BrandContext | null }): Promise<TemplateBindingContext | null>;
}
