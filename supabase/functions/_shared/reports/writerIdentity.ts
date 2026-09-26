/**
 * The report writer's identity on this deployment, read at the edge.
 *
 * `writerFirm.pure.ts` decides who the writer works for; this reads what it
 * decides from. On the prime it reads exactly what the writers read before —
 * Report Settings, through `getBrandConfig` — and nothing else. On a clone it
 * also reads the Branding page's name, because a clone's documents are issued
 * under that name where Report Settings names nobody (`resolveReportIssuer`).
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- @ts-expect-error would be an unused directive under Deno, where this import resolves.
// @ts-ignore Deno-only esm.sh import; not resolvable under Node type-checking.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getBrandConfig } from '../brand-config.ts';
import { deploymentKind } from '../emailIdentity.pure.ts';
import { reportWriterIdentity, type ReportWriterIdentity } from './writerFirm.pure.ts';

export async function loadReportWriterIdentity(): Promise<ReportWriterIdentity> {
  const deployment = { prime: deploymentKind(Deno.env.get('SUPABASE_URL')) === 'prime' };
  const brand = await getBrandConfig();
  if (deployment.prime) return reportWriterIdentity({ companyName: brand.companyName }, deployment);
  return reportWriterIdentity(
    { companyName: brand.companyName, brandName: await brandingPageName() },
    deployment,
  );
}

/**
 * `whitelabel_settings.company_name`, or null.
 *
 * A failed read is not a reason to fail a report: it resolves the writer to the
 * next name, or to no business — never to the house, which a clone's writer is
 * never told it works for.
 */
async function brandingPageName(): Promise<string | null> {
  try {
    const client: SupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data, error } = await client
      .from('whitelabel_settings')
      .select('company_name')
      .limit(1)
      .maybeSingle();
    if (error) return null;
    const name = (data as { company_name?: unknown } | null)?.company_name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}
