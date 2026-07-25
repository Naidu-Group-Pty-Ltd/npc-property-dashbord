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
    expect(functionSource).toContain("await deliverCode(admin, recipient, code, capability)");
    expect(functionSource).not.toMatch(/return jr\(\{ challenge_id: data\.id, code[,}]/);
  });
});
