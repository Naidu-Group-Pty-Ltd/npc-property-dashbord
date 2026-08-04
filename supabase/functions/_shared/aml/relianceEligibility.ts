/**
 * Reliance eligibility — the single server-side guard for every NEW
 * partner-reliance access path (AML/CTF Act 2006 (Cth) Pt 2 Div 7).
 *
 * Pure module by design: no Deno APIs, no network, no database client. The
 * edge function loads the rows; this module decides. That keeps the legal
 * gating behaviourally testable from vitest (same pattern as
 * `_shared/amlFinanceEngine.ts`) and guarantees the decision cannot vary by
 * call site.
 *
 * Phase 1 evaluates the canonical-partner and case-link layer.
 * Phase 2 adds the arrangement layer (agreement + assessment currency +
 * scope) on top — same entry point, richer input.
 *
 * Two invariants this module owns:
 *  - a denial NEVER carries restricted reasoning. Reason codes are
 *    partner-safe constants; messages are operator-facing.
 *  - independence is never blocked here: when reliance is unavailable the
 *    caller falls back to independent_cdd / information sharing. This guard
 *    gates RELIANCE access only, and never touches the originating case,
 *    risk assessment or service gate.
 */

export const LEGAL_ROUTES = [
  "reliance",
  "outsourced_cdd",
  "independent_cdd",
  "information_share_only",
] as const;
export type LegalRoute = (typeof LEGAL_ROUTES)[number];

export const PARTNER_LINK_STATES = ["active", "suspended", "ended"] as const;
export type PartnerLinkState = (typeof PARTNER_LINK_STATES)[number];

export type RelianceDenialCode =
  | "partner_org_unresolved"
  | "partner_org_not_active"
  | "partner_link_missing"
  | "partner_link_not_active"
  | "partner_link_wrong_route"
  | "partner_link_wrong_case"
  | "partner_link_wrong_tenant";

export interface PartnerOrganisationInput {
  id: string;
  status: string; // active | suspended | ended
}

export interface PartnerCaseLinkInput {
  id: string;
  case_id: string;
  tenant_id: string;
  partner_org_id: string;
  legal_route: string;
  state: string;
}

export interface RelianceLinkContext {
  caseId: string;
  caseTenantId: string;
  /** Canonical org resolved from the agreement — null when unresolved. */
  partnerOrg: PartnerOrganisationInput | null;
  /** The candidate link rows for this case × organisation (any state). */
  links: PartnerCaseLinkInput[];
}

export type RelianceDecision =
  | { ok: true; link: PartnerCaseLinkInput }
  | { ok: false; code: RelianceDenialCode; message: string };

/**
 * Phase 1 layer: is there a canonical partner organisation in good standing
 * with an ACTIVE partner-case link, for THIS case, in THIS tenant, whose
 * legal route is reliance?
 *
 * Deny-by-default: any absent, mismatched, suspended or ended input denies.
 * A caller-supplied organisation id is never part of this contract — the
 * organisation arrives resolved from the stored agreement row, and links
 * arrive pre-filtered by the server from the database, never from the
 * request body.
 */
export function evaluatePartnerLinkForReliance(
  ctx: RelianceLinkContext,
): RelianceDecision {
  if (!ctx.partnerOrg || !ctx.partnerOrg.id) {
    return {
      ok: false,
      code: "partner_org_unresolved",
      message:
        "This agreement is not mapped to a canonical partner organisation. Resolve the partner mapping before granting new reliance access.",
    };
  }
  if (ctx.partnerOrg.status !== "active") {
    return {
      ok: false,
      code: "partner_org_not_active",
      message: `The partner organisation is ${ctx.partnerOrg.status}. Reinstate it before granting new reliance access.`,
    };
  }

  const candidates = (ctx.links ?? []).filter(
    (l) => l.partner_org_id === ctx.partnerOrg!.id,
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      code: "partner_link_missing",
      message:
        "No partner-case link exists for this organisation on this case. Link the partner (with a documented purpose and legal route) before granting access.",
    };
  }

  // Wrong-case / wrong-tenant links can only reach this function through a
  // query bug — deny loudly rather than silently filtering them out.
  const wrongCase = candidates.find((l) => l.case_id !== ctx.caseId);
  if (wrongCase) {
    return {
      ok: false,
      code: "partner_link_wrong_case",
      message: "A supplied link belongs to a different case. Refusing.",
    };
  }
  const wrongTenant = candidates.find((l) => l.tenant_id !== ctx.caseTenantId);
  if (wrongTenant) {
    return {
      ok: false,
      code: "partner_link_wrong_tenant",
      message: "A supplied link belongs to a different tenant. Refusing.",
    };
  }

  const relianceLinks = candidates.filter((l) => l.legal_route === "reliance");
  if (relianceLinks.length === 0) {
    return {
      ok: false,
      code: "partner_link_wrong_route",
      message:
        "The partner is linked to this case, but not under the reliance route. Reliance is never inferred from another route — use the partner's actual route, or record a reliance link where legally available.",
    };
  }

  const active = relianceLinks.find((l) => l.state === "active");
  if (!active) {
    return {
      ok: false,
      code: "partner_link_not_active",
      message:
        "The reliance link for this partner is suspended or ended. Only an active link can carry new reliance access.",
    };
  }

  return { ok: true, link: active };
}
