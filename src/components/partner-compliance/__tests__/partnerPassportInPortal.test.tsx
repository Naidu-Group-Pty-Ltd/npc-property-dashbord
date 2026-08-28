import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PartnerComplianceWorkspace } from "../PartnerComplianceWorkspace";
import type {
  PartnerPortalAdapter, PartnerWorkspaceClient, PartnerWorkspaceDirectory,
} from "../types";
import { buildPartnerWorkspaceDto } from "../../../../supabase/functions/_shared/aml/partnerWorkspace";
import { buildPassportView } from "@/lib/aml/passport";

/**
 * The Compliance Passport, RENDERED inside a partner's own portal.
 *
 * ── What this is for ──────────────────────────────────────────────────
 * A partner who already holds a portal account asked to review the Passport
 * there rather than keep an email. The risk in granting that is not the
 * document — it is the surface that hosts it: the shared workspace carries
 * eight other panels, chosen by a static per-portal adapter rather than by a
 * flag, several of which would render and then refuse because their own
 * write flags are off.
 *
 * So these tests mount the real workspace under all three portal adapters
 * and assert two things a rule-level test cannot see: that `passport_only`
 * actually draws the booklet, and that it actually suppresses everything
 * else on the page.
 */

const NOW = new Date("2026-08-28T00:00:00Z");

const ALL_PANELS = {
  procedures: true, determination: true, recordsRequests: true,
  deliveries: true, auditReceipt: true, clarification: true,
};

/** The three portals, as they are actually configured. */
const PORTALS: Array<{ name: string; adapter: PartnerPortalAdapter }> = [
  {
    name: "Finance",
    adapter: {
      portalType: "finance", workspaceTitle: "Client compliance",
      matterLabel: "Purchase file", roleLabel: "Lender / broker",
      formatReference: (l) => `File ${String(l.purchase_file_id ?? l.id).slice(0, 8)}`,
      panels: ALL_PANELS,
      support: { operationalLabel: "Message the team", operationalHref: "/finance/messages", complianceLabel: "your compliance officer" },
    },
  },
  {
    name: "Builder / Developer",
    adapter: {
      portalType: "builder", workspaceTitle: "Client compliance",
      matterLabel: "Project sale", roleLabel: "Builder",
      formatReference: (l) => `Matter ${String(l.id).slice(0, 8)}`,
      panels: ALL_PANELS,
      support: { operationalLabel: "Message the team", operationalHref: "/builder/messages", complianceLabel: "your compliance officer" },
    },
  },
  {
    name: "Solicitor / Conveyancer",
    adapter: {
      portalType: "solicitor_conveyancer", workspaceTitle: "Client compliance",
      matterLabel: "Matter", roleLabel: "Acting solicitor",
      formatReference: (l) => `Matter ${String(l.legal_matter_id ?? l.id).slice(0, 8)}`,
      panels: ALL_PANELS,
      support: { operationalLabel: "Message the team", operationalHref: "/solicitor/messages", complianceLabel: "your compliance officer" },
    },
  },
];

const directory = (mode?: string): PartnerWorkspaceDirectory => ({
  organisation: { legal_name: "Ridgeline Builders Pty Ltd", classification_status: "classified" },
  links: [{
    id: "link-0001", relationship_role: "builder", legal_route: "reliance",
    state: "active", portal_type: "builder", linked_at: "2026-08-01T00:00:00Z",
    ended_at: null, end_reason_code: null, purchase_file_id: "pf-000001", legal_matter_id: null,
  }],
  ...(mode ? { surface_mode: mode as never } : {}),
});

const dto = () => buildPartnerWorkspaceDto({
  partnerOrg: { legal_name: "Ridgeline Builders Pty Ltd", classification_status: "classified" },
  originLabel: "AML/CTF Command Centre",
  link: {
    id: "link-0001", relationship_role: "builder", legal_route: "reliance",
    state: "active", portal_type: "builder", linked_at: "2026-08-01T00:00:00Z",
    purchase_file_id: "pf-000001", legal_matter_id: null,
  },
  attestation: {
    schema_version: 2, version: 3, payload_sha256: "abcdef1234567890",
    issued_at: "2026-08-02T00:00:00Z", superseded_at: null,
  },
  grant: { revoked_at: null, expires_at: "2026-11-01T00:00:00Z" },
  procedures: {
    customer_identification: {
      parties: [{ party: "Synthetic Subject", verified: true, method: "document_sighting", completed_at: "2026-08-01T00:00:00Z" }],
      consents_held: [{ code: "compliance_sharing", version: "2026.2" }],
    },
  },
  limitations: [], recordAvailability: ["identity_verification_record"],
  determinations: [], requests: [], deliveries: [],
  now: NOW,
} as never);

/** The partner-audience projection, from the SAME builder the server uses. */
const passportView = () => buildPassportView("partner", {
  issuer_org: "Naidu Property Consulting Services",
  officer_label: "P. Naidu · MLRO",
  case: {
    id: "c1", case_reference: "AML-2026-0007", subject_display_name: "Synthetic Subject",
    subject_type: "individual", status: "cleared", case_stage: "cleared",
    service_gate_status: "approved", opened_at: "2026-07-01T00:00:00Z", closed_at: null,
  },
  attestations: [{
    version: 3, issued_at: "2026-08-02T00:00:00Z", superseded_at: null,
    payload_sha256: "a".repeat(64), schema_version: 2,
  }],
  material_inputs_current: true,
  open_refresh_obligations: 0,
  personal_details: null,
  entity_details: null,
  documents: [],
  transactions: [],
  screening: null,
  funding: null,
  partners: [],
  events: [],
  client_requests: [],
  stamp_input: {
    issuer_org: "Naidu Property Consulting Services",
    attestations: [{ version: 3, issued_at: "2026-08-02T00:00:00Z", superseded_at: null }],
    consents: [], verification_checks: [], documents: [], screening_subjects: [], owners: [],
    source_of_funds: [], source_of_wealth: [], edd_cases: [], grants: [],
    assessments: [], refresh_obligations: [], transactions: [],
  },
} as never);

const client = (over: Partial<Record<string, unknown>> = {}): PartnerWorkspaceClient => ({
  getDirectory: vi.fn(async () => ({ data: directory("passport_only"), error: null })),
  getWorkspace: vi.fn(async () => ({
    data: {
      workspace: dto(),
      surface_mode: "passport_only",
      passport: passportView(),
      passport_availability: { code: "disclosable", message: "" },
      ...over,
    },
    error: null,
  })),
  requestRecords: vi.fn(async () => ({ data: { request: {} }, error: null })),
  listRequests: vi.fn(async () => ({ data: { requests: [] }, error: null })),
  recordDetermination: vi.fn(async () => ({ data: { assessment: {} }, error: null })),
  listDeliveries: vi.fn(async () => ({ data: { deliveries: [] }, error: null })),
  getAuditReceipt: vi.fn(async () => ({ data: { receipt: {} }, error: null })),
} as never);

const mount = (adapter: PartnerPortalAdapter, c: PartnerWorkspaceClient) =>
  render(
    <MemoryRouter>
      <PartnerComplianceWorkspace adapter={adapter} client={c} />
    </MemoryRouter>,
  );

describe("the Passport reaches every portal, because there is one workspace", () => {
  for (const { name, adapter } of PORTALS) {
    it(`${name}: draws the Passport on the compliance page`, async () => {
      mount(adapter, client());
      await waitFor(() => {
        // The booklet draws its own cover AND the bookbar names the
        // instrument — several matches means it rendered, not one.
        expect(screen.getAllByText(/AML\/CTF Compliance Passport/i).length)
          .toBeGreaterThan(0);
      });
      // The credential, so a partner can see it is the same instrument the
      // issuer holds rather than a summary of it.
      expect(screen.getAllByText(/AML-2026-0007/).length).toBeGreaterThan(0);
    });

    it(`${name}: passport_only suppresses every unreviewed panel`, async () => {
      mount(adapter, client());
      await waitFor(() => {
        expect(screen.getAllByText(/AML\/CTF Compliance Passport/i).length)
          .toBeGreaterThan(0);
      });
      /* The adapter permits all six. The mode must remove them — this is the
         guarantee that "show them the Passport" cannot mean "expose seven
         features nobody has reviewed". */
      for (const testId of [
        "partner-compliance-summary", "partner-procedures", "partner-assessment-form",
        "partner-records-request",
      ]) {
        expect(screen.queryByTestId(testId), testId).toBeNull();
      }
      // What is never withheld: the statutory notice and a way to ask.
      expect(screen.getByTestId("partner-responsibility-notice")).toBeTruthy();
      expect(screen.getByTestId("partner-support")).toBeTruthy();
    });
  }
});

describe("full mode is unchanged — this cannot cost an existing deployment a panel", () => {
  it("a deployment already running the workspace still gets all of it", async () => {
    const full = client({ surface_mode: "full", passport: null, passport_availability: undefined });
    (full.getDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: directory("full"), error: null,
    });
    mount(PORTALS[0].adapter, full);
    await waitFor(() => {
      expect(screen.getByTestId("partner-compliance-summary")).toBeTruthy();
    });
    expect(screen.getByTestId("partner-procedures")).toBeTruthy();
    expect(screen.getByTestId("partner-assessment-form")).toBeTruthy();
    expect(screen.getByTestId("partner-records-request")).toBeTruthy();
  });
});

describe("a withheld Passport says why — an empty page is never the answer", () => {
  it("a lapsed grant names the remedy and keeps the partner's own route open", async () => {
    const withheld = client({
      passport: null,
      passport_availability: {
        code: "expired",
        message: "Access to this Compliance Passport has expired. Ask the issuing organisation to issue it again.",
      },
    });
    mount(PORTALS[1].adapter, withheld);
    await waitFor(() => {
      expect(screen.getByText(/The Compliance Passport is not available/i)).toBeTruthy();
    });
    expect(screen.getByText(/issue it again/i)).toBeTruthy();
    // Reliance is optional, always — their own CDD route is never closed.
    expect(screen.getByText(/independent customer due diligence/i)).toBeTruthy();
  });

  it("with the surface simply not enabled, nothing is said about our configuration", async () => {
    const off = client({
      passport: null, passport_availability: { code: "not_enabled", message: "" },
    });
    mount(PORTALS[2].adapter, off);
    await waitFor(() => {
      expect(screen.getByTestId("partner-responsibility-notice")).toBeTruthy();
    });
    expect(screen.queryByText(/not available/i)).toBeNull();
    expect(screen.queryByText(/enabled/i)).toBeNull();
  });
});
