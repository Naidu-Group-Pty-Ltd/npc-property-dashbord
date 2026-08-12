/**
 * Edge mirror of src/lib/reportTemplate/buildBindingContext.ts
 * KEEP IN SYNC.
 *
 * Flattens an `investment_reports` row into the stable shape templates bind
 * against — works with service_role from edge functions (no RLS hop required).
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { chunkReportContent, extractStructureHeadings, selectStructureTemplate } from './reportSections.ts';
import { applyInvestmentProjection } from './reportBindingProjection.pure.ts';

export interface TemplateBindingContext {
  data: Record<string, any>;
  meta: { reportId: string; reportType: string; variant: string | null; tier: string | null };
}

const flatten = (o: any): Record<string, any> => (o && typeof o === 'object' ? { ...o } : {});

/**
 * Best-effort headings of the active report-structure guide for this report's
 * type/tier, so `sections.*` chunk ids line up with the Cascade contract ids.
 */
async function loadStructureHeadings(
  supabase: SupabaseClient,
  tier: string | null,
  category: string | null,
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('report_structure_templates')
      .select('id,name,parsed_content,report_tier,report_category,priority')
      .eq('template_type', 'ai_structure')
      .eq('is_active', true);
    if (error || !data) return [];
    const row = selectStructureTemplate(data as any[], { tier, category });
    return extractStructureHeadings((row as any)?.parsed_content || '');
  } catch {
    return [];
  }
}

export async function buildTemplateBindingContext(
  supabase: SupabaseClient,
  reportId: string,
  brand?: { tokens?: any; logoUrl?: string | null } | null,
): Promise<TemplateBindingContext | null> {
  const { data: row, error } = await supabase
    .from('investment_reports')
    .select('*')
    .eq('id', reportId)
    .maybeSingle();
  if (error || !row) return null;

  const reportType = String((row as any).report_type ?? (row as any).report_scope ?? '').toLowerCase();
  const variant = ((row as any).report_variant ?? null) as string | null;
  const tier = ((row as any).report_tier ?? null) as string | null;
  const structureHeadings = await loadStructureHeadings(supabase, tier, reportType);

  const data: Record<string, any> = {
    report: {
      id: (row as any).id,
      type: reportType,
      variant,
      tier,
      address: (row as any).property_address ?? '',
      generated_at: (row as any).updated_at ?? (row as any).created_at,
      status: (row as any).status,
    },
    property: flatten((row as any).property_specs),
    financials: flatten((row as any).financial_calculations),
    scores: flatten((row as any).investment_score),
    demographics: flatten((row as any).demographics_data),
    economic: flatten((row as any).economic_data),
    location: flatten((row as any).location_intelligence),
    sections: chunkReportContent((row as any).report_content, { structureHeadings }),
    sources: flatten((row as any).sources_content),
    overrides: flatten((row as any).manual_overrides),
    tier,
    variant,
    brand: {
      tokens: brand?.tokens ?? {},
      logo: brand?.logoUrl ?? null,
    },
  };

  // Mirrors the client adapter. The raw namespaces above are the database's
  // vocabulary; the seeded catalogue binds a different one, so without this a
  // live render resolves almost nothing. See `reportBindingProjection.pure.ts`.
  applyInvestmentProjection(data, row as Record<string, unknown>);

  return { data, meta: { reportId, reportType, variant, tier } };
}
