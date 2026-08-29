/**
 * The photograph on the identity document — and nothing else from it.
 *
 * ── What this is, and what it deliberately is not ─────────────────────
 * A Compliance Passport that proves an identity was verified, and shows no
 * face, is a certificate. The artefact this product is modelled on shows the
 * holder. So the booklet carries one image: **the portrait the provider
 * extracted from the identity document** — the face printed on the passport
 * or licence page.
 *
 * Three images exist in a standalone verification, and only one of them may
 * ever travel:
 *
 *   · `id_portrait` — the face crop the provider extracted from the DOCUMENT.
 *     It carries no document number, no MRZ, no date of birth, no address and
 *     no signature. This is the one.
 *   · `document_front` / `document_back` — the whole bio page as the customer
 *     photographed it. It carries every one of those. NPC holds it as
 *     evidence; it is staff-only and is never published to a Passport, a
 *     client or a partner.
 *   · `selfie` — the live capture taken during verification. Biometric media
 *     of the person, and out by the same rule that has always kept liveness
 *     measurements out of this document.
 *
 * The rule is an **allow-list of exactly one key**, not a deny-list over the
 * other two. A deny-list over a payload that gains a field later is how the
 * wrong image ships; `identityPortraitObject` returns the portrait or null,
 * and there is no argument that widens it.
 *
 * ── Why it is a descriptor here and a URL somewhere else ──────────────
 * This module is pure and does no I/O, and a signed storage URL is a bearer
 * credential with a lifetime. Putting one in a projection means it can be
 * persisted, cached, embedded in an attestation payload, or handed on after
 * it stops being the reader's to hold. So the view carries a DESCRIPTOR —
 * whether a portrait exists, which document it came off, when — and the edge
 * function that serves that view to a particular reader signs a short-lived
 * URL for that reader alone.
 */

/** The only capture key whose image may leave the verification record. */
export const DISCLOSABLE_CAPTURE_KEY = "id_portrait" as const;

/**
 * Capture keys that must never be published, named so a reader of this file
 * can see the decision rather than infer it from an absence.
 */
export const WITHHELD_CAPTURE_KEYS: readonly string[] = [
  "document_front", "document_back", "selfie",
];

export interface CaptureObjectRef {
  bucket: string;
  path: string;
}

/**
 * The stored object for the document portrait, or null.
 *
 * Reads only `id_portrait`. A verification recorded before portraits were
 * stored simply has none, and every surface renders exactly as it did.
 */
export function identityPortraitObject(
  captureObjects: unknown,
): CaptureObjectRef | null {
  if (!captureObjects || typeof captureObjects !== "object") return null;
  const raw = (captureObjects as Record<string, unknown>)[DISCLOSABLE_CAPTURE_KEY];
  if (!raw || typeof raw !== "object") return null;
  const bucket = String((raw as Record<string, unknown>).bucket ?? "");
  const path = String((raw as Record<string, unknown>).path ?? "");
  if (!bucket || !path) return null;
  // Belt and braces against a hand-edited `outcome_detail`: a path that
  // escapes its own prefix is not a portrait, whatever it is called.
  if (path.startsWith("/") || path.includes("..")) return null;
  return { bucket, path };
}

export type IdentityDocumentKind =
  | "passport" | "driver_licence" | "identity_card" | "residence_permit";

export interface IdentityPortraitDescriptor {
  /** True when a portrait is stored for this party. */
  available: true;
  /**
   * Which document the face was printed on, in NPC's own vocabulary.
   *
   * The document KIND is disclosable and its number is not: "verified against
   * an Australian passport" is the fact a relying party needs, and the
   * passport number is the credential they do not.
   */
  document: IdentityDocumentKind | null;
  /** ISO 3166-1 alpha-3 as the provider read it, or null. */
  issuing_state: string | null;
  /** When the verification that produced it completed. */
  captured_at: string | null;
  /**
   * Filled in by the edge function serving this view, for this reader, with
   * a short lifetime. Null in the projection itself — see the header.
   */
  url: string | null;
}

export interface PortraitFacts {
  captureObjects: unknown;
  documentChoice: string | null | undefined;
  issuingState: string | null | undefined;
  completedAt: string | null | undefined;
}

const DOCUMENT_KINDS: ReadonlySet<string> = new Set([
  "passport", "driver_licence", "identity_card", "residence_permit",
]);

/**
 * Describe the portrait for a party, or answer null.
 *
 * Null is the ordinary case for every verification recorded before this
 * existed, for a hosted-provider verification (where NPC deliberately holds
 * no copy of anything), and for any attempt whose portrait could not be
 * stored. Every surface must render unchanged on null — a Passport with no
 * portrait is the Passport this product has always produced.
 */
export function describeIdentityPortrait(
  facts: PortraitFacts,
): IdentityPortraitDescriptor | null {
  if (!identityPortraitObject(facts.captureObjects)) return null;
  const choice = String(facts.documentChoice ?? "").trim().toLowerCase();
  return {
    available: true,
    document: DOCUMENT_KINDS.has(choice) ? choice as IdentityDocumentKind : null,
    issuing_state: facts.issuingState ? String(facts.issuingState).toUpperCase() : null,
    captured_at: facts.completedAt ?? null,
    url: null,
  };
}

/** "Australian passport" — how the document reads under the portrait. */
export function portraitCaption(d: IdentityPortraitDescriptor): string {
  const DOCUMENT_LABEL: Record<IdentityDocumentKind, string> = {
    passport: "passport",
    driver_licence: "driver licence",
    identity_card: "identity card",
    residence_permit: "residence permit",
  };
  const document = d.document ? DOCUMENT_LABEL[d.document] : "identity document";
  const state = d.issuing_state === "AUS" ? "Australian"
    : d.issuing_state ? d.issuing_state : null;
  return state ? `${state} ${document}` : document;
}
