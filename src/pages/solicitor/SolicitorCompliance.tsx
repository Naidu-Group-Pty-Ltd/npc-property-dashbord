import { useMemo } from "react";
import { invokeSolicitorFunction } from "@/lib/solicitorPortal";
import { PartnerComplianceWorkspace } from "@/components/partner-compliance";
import { solicitorPortalAdapter } from "@/components/partner-compliance/adapters";
import { makePartnerWorkspaceClient } from "@/lib/partnerWorkspaceClient";
import { usePartnerWorkspaceEnabled } from "@/lib/aml/usePartnerWorkspaceFlags";

/**
 * Solicitor/Conveyancer Portal mount of the SHARED Partner Compliance
 * Workspace (Phase 5). Firm identity travels only through the solicitor
 * session cookie; the server maps it to the canonical partner organisation
 * (firm back-reference must match) and enforces every check again.
 * Privileged material never enters this surface: the workspace carries the
 * structured determinations the practice chooses to record, nothing from
 * matter files, notes or communications.
 */
export default function SolicitorCompliance() {
  const { loading, enabled } = usePartnerWorkspaceEnabled("solicitor");
  const client = useMemo(
    () => makePartnerWorkspaceClient(invokeSolicitorFunction, "solicitor_conveyancer"),
    [],
  );

  if (loading) return null;
  if (!enabled) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        The compliance workspace is not available.
      </div>
    );
  }
  return (
    <div className="p-4 md:p-6">
      <PartnerComplianceWorkspace adapter={solicitorPortalAdapter} client={client} />
    </div>
  );
}
