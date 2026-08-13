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
  type OrganisationRowLike,
} from '../../../../supabase/functions/_shared/organisationProjection.pure';

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
      return data as OrganisationRowLike;
    } catch {
      inFlight = null;
      return null;
    }
  })();
  return inFlight;
}

/** Test seam: drop the memoised row so a spec can change what is returned. */
export function resetOrganisationCache(): void {
  inFlight = null;
}
