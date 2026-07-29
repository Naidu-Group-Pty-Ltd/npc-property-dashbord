import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guardSource = readFileSync(new URL("./ModuleGuard.tsx", import.meta.url), "utf8");

describe("module route entitlement contract", () => {
  it("uses the combined user-permission and workspace-plan hook", () => {
    expect(guardSource).toContain("useModulePermissions(moduleKey)");
    expect(guardSource).not.toContain("usePermissions()");
  });
});
