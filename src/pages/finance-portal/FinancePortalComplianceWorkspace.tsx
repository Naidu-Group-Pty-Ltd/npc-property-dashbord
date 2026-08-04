import { useMemo } from "react";
import { useFinancePortalAuth } from "@/hooks/useFinancePortalAuth";
import { PartnerComplianceWorkspace } from "@/components/partner-compliance";
import { financePortalAdapter } from "@/components/partner-compliance/adapters";
import { makePartnerWorkspaceClient } from "@/lib/partnerWorkspaceClient";
import { usePartnerWorkspaceEnabled } from "@/lib/aml/usePartnerWorkspaceFlags";

/**
 * Finance Portal mount of the SHARED Partner Compliance Workspace
 * (Phase 5). The existing funding request / reconciliation workflow is
 * untouched — this page complements it. Identity travels only through the
 * finance session; the server maps it to the canonical partner
 * organisation and enforces every flag and link check again.
 */
export default function FinancePortalComplianceWorkspace() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const { loading, enabled } = usePartnerWorkspaceEnabled("finance");
  const client = useMemo(
    () => makePartnerWorkspaceClient(invokeFinanceFunction, "finance"),
    [invokeFinanceFunction],
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
      <PartnerComplianceWorkspace adapter={financePortalAdapter} client={client} />
    </div>
  );
}
