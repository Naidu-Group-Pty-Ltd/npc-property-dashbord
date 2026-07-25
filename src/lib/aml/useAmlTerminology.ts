import { useEffect, useState, useCallback } from "react";
import { amlTenantApi } from "./amlTenantApi";

/**
 * Phase 12 — Tenant terminology resolver.
 *
 * Reads `tenant_settings.terminology_overrides` and returns a `t(label)` helper
 * that swaps display strings when an override exists. The edge function already
 * drops any locked regulatory term (AUSTRAC, SMR, MLRO, …) before persisting,
 * so callers can trust that overrides never rename compliance controls.
 *
 * The result is cached in-memory and in sessionStorage so navigation between
 * AML workspaces does not re-hit the edge function.
 */

const CACHE_KEY = "aml:terminology_overrides:v1";
type OverrideMap = Record<string, string>;

let memory: OverrideMap | null = null;
const subscribers = new Set<(m: OverrideMap) => void>();

function readCache(): OverrideMap {
  if (memory) return memory;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) { memory = JSON.parse(raw) as OverrideMap; return memory; }
  } catch { /* ignore */ }
  return {};
}
function writeCache(next: OverrideMap) {
  memory = next;
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  subscribers.forEach((fn) => fn(next));
}

export async function refreshAmlTerminology(): Promise<OverrideMap> {
  try {
    const { terminology_overrides: next } = await amlTenantApi.terminology();
    writeCache(next);
    return next;
  } catch {
    return readCache();
  }
}

export function useAmlTerminology() {
  const [overrides, setOverrides] = useState<OverrideMap>(() => readCache());

  useEffect(() => {
    const listener = (m: OverrideMap) => setOverrides(m);
    subscribers.add(listener);
    if (!memory) { refreshAmlTerminology(); }
    return () => { subscribers.delete(listener); };
  }, []);

  const t = useCallback(
    (label: string) => overrides[label] ?? label,
    [overrides],
  );

  return { t, overrides, refresh: refreshAmlTerminology };
}
