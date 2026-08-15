/**
 * The V3 flag reader — and the staleness that hid a whole surface.
 *
 * `aml_v3_case_workspace` decides whether an AML case opens in the staged
 * compliance journey or the legacy dialog. It was switched on in the
 * database and *nothing changed on screen*, because this reader wrote its
 * answer to `sessionStorage` once and never asked again — and
 * `sessionStorage` survives a reload. Every tab that had already read
 * `false` went on reading `false`, through refreshes, for the whole browser
 * session.
 *
 * These tests pin the two halves of the fix: a cached reading still renders
 * without a round trip, and it is always revalidated behind, so a flag
 * flipped anywhere reaches every tab on its next mount.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const select = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ in: (...a: unknown[]) => select(...a) }) }) },
}));

const CACHE_KEY = "aml:v3_flags:v2";

/** Flags come back as `feature_flags` rows; anything absent is false. */
const rows = (...keys: string[]) => ({
  data: keys.map((key) => ({ key, value: true })),
  error: null,
});

async function freshModule() {
  vi.resetModules();
  return import("./useAmlV3Flags");
}

beforeEach(() => {
  select.mockReset();
  sessionStorage.clear();
});

describe("refreshAmlV3Flags", () => {
  it("reads every V3 flag and coerces the row values", async () => {
    select.mockResolvedValue(rows("aml_v3_case_workspace"));
    const { refreshAmlV3Flags } = await freshModule();

    const flags = await refreshAmlV3Flags();
    expect(flags.caseWorkspace).toBe(true);
    expect(flags.v3Nav).toBe(false);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("shares one request between concurrent callers", async () => {
    // Four surfaces read these flags. Now that every mount revalidates, they
    // must not fire four identical queries in the same tick.
    select.mockResolvedValue(rows());
    const { refreshAmlV3Flags } = await freshModule();

    await Promise.all([refreshAmlV3Flags(), refreshAmlV3Flags(), refreshAmlV3Flags()]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good reading when the query fails", async () => {
    select.mockResolvedValue(rows("aml_v3_case_workspace"));
    const { refreshAmlV3Flags } = await freshModule();
    await refreshAmlV3Flags();

    select.mockRejectedValue(new Error("network"));
    const after = await refreshAmlV3Flags();
    // A failed read is not a switched-off feature.
    expect(after.caseWorkspace).toBe(true);
  });

  it("defaults everything to false when nothing has ever been read", async () => {
    select.mockRejectedValue(new Error("network"));
    const { refreshAmlV3Flags } = await freshModule();
    const flags = await refreshAmlV3Flags();
    expect(Object.values(flags).every((v) => v === false)).toBe(true);
  });
});

describe("the cache cannot outlive a flag change", () => {
  it("writes under a key that a stale v1 reading cannot satisfy", async () => {
    // The bump is what clears the tabs that were already holding `false`
    // when the workspace was switched on.
    sessionStorage.setItem(
      "aml:v3_flags:v1",
      JSON.stringify({ caseWorkspace: false, v3Nav: false }),
    );
    select.mockResolvedValue(rows("aml_v3_case_workspace"));
    const { refreshAmlV3Flags } = await freshModule();

    const flags = await refreshAmlV3Flags();
    expect(flags.caseWorkspace).toBe(true);
    expect(sessionStorage.getItem(CACHE_KEY)).toContain('"caseWorkspace":true');
  });

  it("revalidates a cached reading rather than trusting it for the session", async () => {
    // A tab that cached `false` before the flip must pick the change up on
    // its next mount — not on its next browser session.
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        v3Nav: false, startClientCompliance: false, complianceHome: false,
        caseWorkspace: false, regulatoryHub: false, terminologyEditor: false,
        metricsRelocation: false, orgSettings: false,
      }),
    );
    select.mockResolvedValue(rows("aml_v3_case_workspace"));
    const { refreshAmlV3Flags } = await freshModule();

    const refreshed = await refreshAmlV3Flags();
    expect(refreshed.caseWorkspace).toBe(true);
    expect(sessionStorage.getItem(CACHE_KEY)).toContain('"caseWorkspace":true');
  });
});
