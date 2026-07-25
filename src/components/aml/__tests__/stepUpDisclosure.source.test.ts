import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialogSource = readFileSync(new URL("../StepUpAuthDialog.tsx", import.meta.url), "utf8");
const functionSource = readFileSync(
  new URL("../../../../supabase/functions/aml-step-up/index.ts", import.meta.url),
  "utf8",
);

describe("AML step-up challenge confidentiality", () => {
  it("does not read or render a challenge code in the browser", () => {
    expect(dialogSource).not.toContain("data.code");
    expect(dialogSource).not.toContain("devCode");
    expect(dialogSource).not.toContain("In-app delivery");
  });

  it("delivers the code out-of-band without returning it from issue", () => {
    expect(functionSource).toContain('delivery: "email"');
    expect(functionSource).toContain("await deliverCode(recipient, code, capability)");
    expect(functionSource).not.toMatch(/return jr\(\{ challenge_id: data\.id, code[,}]/);
  });

  it("resolves delivery for custom-auth staff before falling back to native auth", () => {
    const customUserLookup = functionSource.indexOf('.from("custom_users")');
    const nativeAuthLookup = functionSource.indexOf("admin.auth.admin.getUserById(userId)");

    expect(customUserLookup).toBeGreaterThan(-1);
    expect(nativeAuthLookup).toBeGreaterThan(customUserLookup);
    expect(functionSource).toContain('.eq("is_active", true)');
    expect(functionSource).toContain("const recipient = await resolveDeliveryEmail(admin, userId)");
  });
});
