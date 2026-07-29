import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const functionSource = readFileSync(
  resolve(process.cwd(), "supabase/functions/mission-control-balance/index.ts"),
  "utf8",
);

describe("Mission Control balance resilience security contract", () => {
  it("keeps the cache fallback behind authentication and exact-tenant scoping", () => {
    const authAt = functionSource.indexOf("await verifyAuth(");
    const cacheAt = functionSource.indexOf("await readCachedBalance(");

    expect(authAt).toBeGreaterThanOrEqual(0);
    expect(cacheAt).toBeGreaterThan(authAt);
    expect(functionSource).toContain('.eq("tenant_ref", AGENCY_TENANT_REF)');
    expect(functionSource).toMatch(/exempt:\s*false/);
  });

  it("refreshes the fallback from live data and marks cached responses stale", () => {
    expect(functionSource).toContain("await refreshCache(supabase, balance)");
    expect(functionSource).toMatch(/source:\s*"live"/);
    expect(functionSource).toMatch(/source:\s*"cache"/);
    expect(functionSource).toContain('"cache-control": "private, no-store"');
  });
});
