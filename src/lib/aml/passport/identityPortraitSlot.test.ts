/**
 * The photograph on the Client Identity page — the slot, the absence, and the
 * one repair.
 *
 * The defect these pin: the Passport carried the holder's portrait on the
 * Identity Verification leaf, behind a filter that omitted the block whenever
 * no image was stored. So on the page a reader opens to see WHO this document
 * belongs to there was no face at all — and on every Passport issued before
 * portraits were stored (all of them) there was nothing anywhere, with nothing
 * on any screen saying why or what could be done about it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DISCLOSABLE_CAPTURE_KEY,
  WITHHELD_CAPTURE_KEYS,
  describeIdentityPortraitSlot,
  portraitAbsenceNote,
  portraitRecoverable,
  slotCaption,
} from "@/lib/aml/passport";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const FRONT = { bucket: "aml-documents", path: "case/verification/check/document-front.jpg" };
const SELFIE = { bucket: "aml-biometrics", path: "case/verification/check/selfie.jpg" };
const PORTRAIT = { bucket: "aml-biometrics", path: "case/verification/check/id-portrait.jpg" };

const facts = (over: Record<string, unknown> = {}) => ({
  captureObjects: { document_front: FRONT, selfie: SELFIE },
  documentChoice: "passport",
  issuingState: "AUS",
  completedAt: "2026-08-15T16:59:20.691Z",
  verified: true,
  mayRecover: true,
  ...over,
});

describe("the slot always answers", () => {
  it("is a photograph when one is stored", () => {
    const slot = describeIdentityPortraitSlot(facts({
      captureObjects: { document_front: FRONT, selfie: SELFIE, id_portrait: PORTRAIT },
    }));
    expect(slot.available).toBe(true);
    expect(slot.reason).toBeNull();
    // The URL is minted for one reader at the moment of service, never here.
    expect(slot.url).toBeNull();
    // A repair is not offered for a record that does not need one.
    expect(slot.recoverable).toBe(false);
  });

  it("names the absence rather than leaving a gap", () => {
    /* Four situations produced one `null` before this, and the booklet's only
       way to render null was to omit the block. An absence with a reason is a
       document; an absence with no reason is a page that looks broken. */
    expect(describeIdentityPortraitSlot(facts({ verified: false })).reason)
      .toBe("not_verified");
    expect(describeIdentityPortraitSlot(facts()).reason)
      .toBe("predates_portrait_capture");
    expect(describeIdentityPortraitSlot(facts({ captureObjects: null })).reason)
      .toBe("provider_retains_media");

    for (const reason of ["not_verified", "predates_portrait_capture", "provider_retains_media"] as const) {
      expect(portraitAbsenceNote(reason).length).toBeGreaterThan(10);
    }
  });

  it("says nothing about the customer, only about the record", () => {
    /* Nobody's identity is in question because a photograph was not
       retained, and the page must not read as though it were. */
    for (const reason of ["not_verified", "predates_portrait_capture", "provider_retains_media"] as const) {
      expect(portraitAbsenceNote(reason)).not.toMatch(/fail|refus|reject|unverif|invalid|suspic/i);
    }
  });

  it("still names the document under an empty frame", () => {
    // "Australian passport" under a blank mount is more use to a reader than
    // nothing, and it is a fact about the verification rather than the image.
    expect(slotCaption(describeIdentityPortraitSlot(facts()))).toBe("Australian passport");
  });
});

describe("what may be repaired, and by whom", () => {
  it("is decided by whether NPC still holds the document page", () => {
    /* Deliberately not a rule about which vendor was used: holding the source
       image is what makes recovery possible, and a provider rule goes stale
       the moment another one is added. */
    expect(portraitRecoverable({ document_front: FRONT, selfie: SELFIE })).toBe(true);
    expect(portraitRecoverable({ document_front: FRONT, id_portrait: PORTRAIT })).toBe(false);
    expect(portraitRecoverable({ selfie: SELFIE })).toBe(false);
    expect(portraitRecoverable(null)).toBe(false);
  });

  it("is never offered to a partner or a client", () => {
    /* `recoverable` describes a repair staff perform. Telling a relying
       partner a photograph is recoverable invites a request nobody in their
       organisation can action. */
    expect(describeIdentityPortraitSlot(facts({ mayRecover: false })).recoverable).toBe(false);
    const view = read("supabase/functions/_shared/aml/passport/passportView.pure.ts");
    expect(view).toContain('mayRecover: audience === "command"');
  });

  it("is never offered where nothing can be done", () => {
    for (const over of [{ verified: false }, { captureObjects: null }]) {
      expect(describeIdentityPortraitSlot(facts(over)).recoverable).toBe(false);
    }
  });
});

describe("the allow-list of exactly one image survives", () => {
  it("still admits one key and names the other two", () => {
    expect(DISCLOSABLE_CAPTURE_KEY).toBe("id_portrait");
    expect([...WITHHELD_CAPTURE_KEYS].sort())
      .toEqual(["document_back", "document_front", "selfie"]);
  });

  it("the recovery writes the portrait and nothing else", () => {
    /* It re-derives an IMAGE and never re-decides an identity. A status, a
       verdict or a score written here would make a repair into a second,
       unasked-for verification of somebody who is already verified. */
    const src = read("supabase/functions/_shared/aml/standaloneVerification.ts");
    const fn = src.slice(src.indexOf("export async function recoverIdentityPortrait"));
    expect(fn).toContain("id_portrait: stored");
    for (const forbidden of [
      "status: 'passed'", "status: 'failed'", "processing_status:",
      "completed_at:", "failure_reason:", "provider_error_category:",
    ]) {
      expect(fn.split("\n").filter((l) => l.includes(forbidden) && !l.trim().startsWith("*")).join())
        .not.toContain(forbidden);
    }
    // Only a verification that PASSED, re-checked in the UPDATE.
    expect(fn).toContain("check.status !== 'passed'");
    expect(fn).toContain(".eq('status', 'passed')");
  });

  it("puts the recovered image on the same deletion clock as the captures", () => {
    /* `aml-idv-retention` enumerates FIXED keys out of `standalone_capture`,
       so an object written anywhere else is one this product stores and never
       deletes — a worse defect than not storing it at all. */
    const src = read("supabase/functions/_shared/aml/standaloneVerification.ts");
    const fn = src.slice(src.indexOf("export async function recoverIdentityPortrait"));
    expect(fn).toContain("standalone_capture: {");
    expect(read("supabase/functions/aml-idv-retention/index.ts")).toContain("id_portrait");
  });
});

describe("the repair is an act somebody asks for", () => {
  const reliance = read("supabase/functions/aml-reliance/index.ts");
  const op = reliance.slice(
    reliance.indexOf('case "recover_document_portrait"'),
    reliance.indexOf('case "get_passport_view"'),
  );

  it("is MLRO-only and refuses everyone else at the server", () => {
    expect(op).toContain("if (!isMlro)");
    expect(op).toMatch(/403/);
  });

  it("distinguishes a read that FAILED from a row that is ABSENT", () => {
    // 404 is final; 503 is worth retrying. Reporting a database fault as a
    // missing case sends the operator to the wrong remedy.
    expect(op).toContain("503");
    expect(op).toContain("404");
  });

  it("records what it did, including a verdict it deliberately ignored", () => {
    expect(op).toContain("appendCaseEvent(");
    expect(op).toContain("provider_verdict_on_reread");
  });

  it("is never swept, and never fires on a page load", () => {
    /* It spends money. The processor's standing rule is that a paid call is
       never repeated unasked, and this mode sits outside the sweep. */
    const processor = read("supabase/functions/aml-verification-processor/index.ts");
    const sweep = processor.slice(processor.indexOf("Sweep: the durability guarantee"));
    expect(sweep).not.toContain("recover_portrait_check_id");
    expect(processor).toContain("recover_portrait_check_id");
  });

  it("states the cost before the click", () => {
    const notice = read("src/components/aml/passport/design/PortraitRecoveryNotice.tsx");
    expect(notice).toMatch(/billed call/);
    // And says what it is not: "run the ID check again" is what this looks
    // like and is not what it is.
    expect(notice).toMatch(/does not re-run the identity check/);
    // Only where the server says there is something to do.
    expect(notice).toContain("!slot.recoverable");
  });
});
