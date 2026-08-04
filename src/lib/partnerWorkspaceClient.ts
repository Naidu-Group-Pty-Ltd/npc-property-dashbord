/**
 * Partner workspace client factory (Phase 5).
 *
 * Wraps a portal's EXISTING authenticated invoke helper (finance token /
 * builder cookie / solicitor cookie) into the shared
 * `PartnerWorkspaceClient` contract. The factory adds only the operation
 * name, the surface's portal_type and the caller's link/selection inputs —
 * it never adds an organisation, tenant or user identifier, because the
 * server derives all of those from the session.
 */
import type {
  PartnerClientResult, PartnerRecordsRequestView, PartnerWorkspaceClient,
  PartnerWorkspaceDirectory, PartnerWorkspaceDto,
} from "@/components/partner-compliance/types";

type PortalInvoke = (
  functionName: string,
  body?: Record<string, unknown>,
) => Promise<{ data: any; error: any }>;

type WorkspaceSurface = "finance" | "builder" | "solicitor_conveyancer";

const normaliseError = (error: any): { message: string; code?: string } | null =>
  error
    ? { message: String(error.message ?? error ?? "Request failed"), code: error.code }
    : null;

export function makePartnerWorkspaceClient(
  invoke: PortalInvoke,
  surface: WorkspaceSurface,
): PartnerWorkspaceClient {
  const call = async <T>(body: Record<string, unknown>): Promise<PartnerClientResult<T>> => {
    const { data, error } = await invoke("aml-reliance", { ...body, portal_type: surface });
    if (error) return { data: null, error: normaliseError(error) };
    if (data?.error) return { data: null, error: { message: String(data.error), code: data.code } };
    return { data: data as T, error: null };
  };

  return {
    getDirectory: () =>
      call<PartnerWorkspaceDirectory>({ op: "get_partner_compliance_workspace" }),
    getWorkspace: (linkId) =>
      call<{ workspace: PartnerWorkspaceDto }>({
        op: "get_partner_compliance_workspace", partner_case_link_id: linkId,
      }),
    requestRecords: ({ linkId, recordCodes, rationale, dueAt }) =>
      call<{ request: unknown }>({
        op: "request_cdd_records", partner_case_link_id: linkId,
        record_codes: recordCodes, rationale, due_at: dueAt,
      }),
    listRequests: (linkId) =>
      call<{ requests: PartnerRecordsRequestView[] }>({
        op: "list_partner_records_requests", partner_case_link_id: linkId,
      }),
    recordDetermination: ({ linkId, outcome, decisionBasis, conditions, responsibilityAcknowledged }) =>
      call<{ assessment: unknown }>({
        op: "record_partner_determination", partner_case_link_id: linkId,
        outcome, decision_basis: decisionBasis, conditions,
        responsibility_acknowledged: responsibilityAcknowledged,
      }),
    listDeliveries: (linkId) =>
      call<{ deliveries: unknown[] }>({
        op: "list_partner_evidence_deliveries", partner_case_link_id: linkId,
      }),
    getAuditReceipt: (linkId) =>
      call<{ receipt: Record<string, unknown> }>({
        op: "get_partner_audit_receipt", partner_case_link_id: linkId,
      }),
  };
}
