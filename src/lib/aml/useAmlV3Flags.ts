import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * AML V3 — Phase 1 feature-flag reader.
 *
 * Reads the four V3 flags reserved in Phase 0 from `public.feature_flags`:
 *   - aml_v3_nav                    (this phase: switches the shell to V3 nav)
 *   - aml_v3_start_client_compliance (Phase 2)
 *   - aml_v3_compliance_home         (Phase 3)
 *   - aml_v3_case_workspace          (Phase 4/6)
 *
 * All default to `false`. When every flag is off the module behaves
 * byte-identically to the V2 shell — no user-visible change.
 */

export type AmlV3FlagKey =
  | "aml_v3_nav"
  | "aml_v3_start_client_compliance"
  | "aml_v3_compliance_home"
  | "aml_v3_case_workspace"
  | "aml_v3_regulatory_hub"
  | "aml_v3_terminology_editor"
  | "aml_v3_metrics_relocation"
  | "aml_v3_org_settings";

export interface AmlV3Flags {
  v3Nav: boolean;
  startClientCompliance: boolean;
  complianceHome: boolean;
  caseWorkspace: boolean;
  regulatoryHub: boolean;
  terminologyEditor: boolean;
  metricsRelocation: boolean;
  orgSettings: boolean;
  loading: boolean;
}


/**
 * Cache key. BUMP THIS whenever a stale reading would be materially wrong.
 *
 * v1 → v2: the cache was written once per browser session and never
 * revalidated, and `sessionStorage` survives a reload. So when
 * `aml_v3_case_workspace` was finally switched on, every tab that had
 * already read `false` kept reading `false` — through refreshes — and the
 * case workspace stayed invisible to exactly the people who had just turned
 * it on. The key bump clears that once; the revalidation below stops it
 * happening again.
 */
const CACHE_KEY = "aml:v3_flags:v2";
type Cache = Omit<AmlV3Flags, "loading">;

let memory: Cache | null = null;
const subs = new Set<(f: Cache) => void>();

function readCache(): Cache | null {
  if (memory) return memory;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) { memory = JSON.parse(raw) as Cache; return memory; }
  } catch { /* ignore */ }
  return null;
}

function writeCache(next: Cache) {
  memory = next;
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  subs.forEach((fn) => fn(next));
}

function coerceBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  if (value && typeof value === "object") {
    // { enabled: true } shape tolerated
    const enabled = (value as { enabled?: unknown }).enabled;
    if (typeof enabled === "boolean") return enabled;
  }
  return false;
}

/**
 * One request per page load, however many components ask.
 *
 * Four surfaces read these flags (the layout, the register, the case
 * workspace, the case tabs) and now that every mount revalidates, they would
 * otherwise fire four identical queries within the same tick. Callers share
 * whichever request is already in flight.
 */
let inFlight: Promise<Cache> | null = null;

export function refreshAmlV3Flags(): Promise<Cache> {
  if (inFlight) return inFlight;
  inFlight = fetchAmlV3Flags().finally(() => { inFlight = null; });
  return inFlight;
}

async function fetchAmlV3Flags(): Promise<Cache> {
  const keys: AmlV3FlagKey[] = [
    "aml_v3_nav",
    "aml_v3_start_client_compliance",
    "aml_v3_compliance_home",
    "aml_v3_case_workspace",
    "aml_v3_regulatory_hub",
    "aml_v3_terminology_editor",
    "aml_v3_metrics_relocation",
    "aml_v3_org_settings",
  ];
  try {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("key,value")
      .in("key", keys);
    if (error) throw error;
    const map = new Map((data ?? []).map((r) => [r.key, r.value]));
    const next: Cache = {
      v3Nav: coerceBool(map.get("aml_v3_nav")),
      startClientCompliance: coerceBool(map.get("aml_v3_start_client_compliance")),
      complianceHome: coerceBool(map.get("aml_v3_compliance_home")),
      caseWorkspace: coerceBool(map.get("aml_v3_case_workspace")),
      regulatoryHub: coerceBool(map.get("aml_v3_regulatory_hub")),
      terminologyEditor: coerceBool(map.get("aml_v3_terminology_editor")),
      metricsRelocation: coerceBool(map.get("aml_v3_metrics_relocation")),
      orgSettings: coerceBool(map.get("aml_v3_org_settings")),
    };
    writeCache(next);
    return next;
  } catch {
    const fallback: Cache = memory ?? {
      v3Nav: false,
      startClientCompliance: false,
      complianceHome: false,
      caseWorkspace: false,
      regulatoryHub: false,
      terminologyEditor: false,
      metricsRelocation: false,
      orgSettings: false,
    };
    return fallback;
  }
}

export function useAmlV3Flags(): AmlV3Flags {
  const cached = readCache();
  const [flags, setFlags] = useState<Cache>(
    cached ?? {
      v3Nav: false,
      startClientCompliance: false,
      complianceHome: false,
      caseWorkspace: false,
      regulatoryHub: false,
      terminologyEditor: false,
      metricsRelocation: false,
      orgSettings: false,
    },
  );
  const [loading, setLoading] = useState<boolean>(!cached);

  useEffect(() => {
    const listener = (f: Cache) => setFlags(f);
    subs.add(listener);
    /*
     * Stale-while-revalidate, and the revalidate half is the point.
     *
     * A cached reading renders immediately — a flag that gates a whole
     * surface must not make every AML page wait on a round trip, and a
     * flicker from "off" to "on" is worse than a beat of staleness. But the
     * cache is ALWAYS refreshed behind it, so a flag flipped in the cutover
     * page (or straight in the database, which is how this one was flipped)
     * reaches every open tab on its next mount instead of surviving until
     * somebody happens to open a new browser session.
     *
     * `writeCache` notifies every subscriber, so a value that actually
     * changed re-renders; one that did not is a no-op.
     */
    void refreshAmlV3Flags().finally(() => setLoading(false));
    return () => { subs.delete(listener); };
  }, []);

  return { ...flags, loading };
}
