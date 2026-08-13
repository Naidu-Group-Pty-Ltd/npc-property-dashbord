/**
 * The deployment's organisation, loaded once per page rather than per adapter
 * call.
 *
 * Every one of the five production adapters needs the same single row, and a
 * preview surface renders many templates in a row — the Template Library grid
 * builds a binding context per card. Without the cache that is one round trip
 * per card for a row that changes when somebody edits the Branding page.
 *
 * Deliberately a module-level promise rather than a TTL cache: the value is
 * stable for the life of a page, and an operator who has just edited their
 * branding reloads to see it, which is how the rest of the Branding surface
 * behaves already.
 *
 * A failure resolves to `null`, never throws, and is **not** cached — a
 * transient RLS or network error must not blank the letterhead for the rest of
 * the session. `applyOrganisationProjection` treats null as "publish nothing",
 * which leaves the bindings exactly as they were before this existed.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  ORGANISATION_COLUMNS,
  applyOrganisationProjection,
  type BrandMarks,
  type OrganisationRowLike,
} from '../../../../supabase/functions/_shared/organisationProjection.pure';
import {
  resolveReportAsset,
} from '../../../../supabase/functions/_shared/reportDesign/assets.pure';
import {
  inlineBrandAssets,
} from '../../../../supabase/functions/_shared/reportDesign/fetchBrandAssets';

let inFlight: Promise<OrganisationRowLike | null> | null = null;

export async function loadOrganisation(): Promise<OrganisationRowLike | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { data, error } = await supabase
        .from('whitelabel_settings')
        .select(ORGANISATION_COLUMNS)
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        inFlight = null;
        return null;
      }
      return data as unknown as OrganisationRowLike;
    } catch {
      inFlight = null;
      return null;
    }
  })();
  return inFlight;
}

let marksInFlight: Promise<BrandMarks> | null = null;

/**
 * The tenant's brand marks, fetched and inlined.
 *
 * ## Why this did not exist
 *
 * The legacy render routes have resolved a mark from `whitelabel_settings.
 * logo_config` for a while — `assets.pure.ts` decides whether one may be used
 * and `fetchBrandAssets.ts` reads the bytes. The design-system path never did:
 * `tryRouteThroughTemplateBuilder` passes no `brand` at all, so every adapter
 * built `brand: { logo: null }` and no template could bind a mark even if it
 * wanted to. Binding one without this would have put an unresolved path on 543
 * covers, which renders as the empty string.
 *
 * ## Two slots, because the mark is not inverted
 *
 * `report` is the lockup for ivory paper, `report-mono` the one for an obsidian
 * ground. `ASSET_FALLBACK` walks the tenant's other uploads when the preferred
 * one is missing, and a key that fails policy does not stop the walk.
 *
 * Inlined rather than linked. `renderResourcePolicy` would admit a project
 * storage URL, but a `data:` URI is what makes the render network-free and
 * reproducible — the same reason `assets.pure.ts` gives at length.
 *
 * Never throws, and a failure is not cached: a logo that could not be fetched
 * is a thinner document, not a failed one.
 */
export async function loadBrandMarks(): Promise<BrandMarks> {
  if (marksInFlight) return marksInFlight;
  marksInFlight = (async () => {
    try {
      const { data, error } = await supabase
        .from('whitelabel_settings')
        .select('logo_config')
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        marksInFlight = null;
        return {};
      }
      const stored = ((data as any).logo_config ?? {}) as Record<string, string | null>;
      if (!stored || !Object.keys(stored).length) return {};

      const supabaseUrl = (import.meta as any)?.env?.VITE_SUPABASE_URL
        ?? (supabase as any)?.supabaseUrl ?? '';
      const { assets } = await inlineBrandAssets(stored, { supabaseUrl });

      const mark = resolveReportAsset(assets as any, 'report').resolved?.asset.dataUri ?? null;
      const mono = resolveReportAsset(assets as any, 'report-mono').resolved?.asset.dataUri ?? null;
      return { mark, markMono: mono };
    } catch {
      marksInFlight = null;
      return {};
    }
  })();
  return marksInFlight;
}

/**
 * The letterhead and the mark, in one call.
 *
 * Every adapter needs both and none of them should be able to remember one and
 * forget the other — which is exactly how `org.*` came to have no producer for
 * long enough that every document this product generated printed a blank
 * letterhead.
 */
export async function applyOrganisationAndBrand(
  data: Record<string, any>,
): Promise<Record<string, any>> {
  const [row, marks] = await Promise.all([loadOrganisation(), loadBrandMarks()]);
  return applyOrganisationProjection(data, row, marks);
}

/** Test seam: drop the memoised row so a spec can change what is returned. */
export function resetOrganisationCache(): void {
  inFlight = null;
  marksInFlight = null;
}
