import { useMemo } from "react";
import { invokeBuilderFunction } from "@/lib/builderPortal";
import { PartnerComplianceWorkspace } from "@/components/partner-compliance";
import { builderPortalAdapter } from "@/components/partner-compliance/adapters";
import { makePartnerWorkspaceClient } from "@/lib/partnerWorkspaceClient";
import { usePartnerWorkspaceEnabled } from "@/lib/aml/usePartnerWorkspaceFlags";

/**
 * Builder / Developer Portal mount of the SHARED Partner Compliance
 * Workspace (Phase 5). One surface serves builder AND developer
 * organisations — the server accepts links of either portal type for a
 * builder session, and never infers a legal classification from the
 * portal. Cookie session only; the server re-derives the organisation from
 * the session's ACTIVE organisation and enforces every check again.
 */
export default function BuilderCompliance() {
  const { loading, enabled } = usePartnerWorkspaceEnabled("builder");
  const client = useMemo(
    () => makePartnerWorkspaceClient(invokeBuilderFunction, "builder"),
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
      <PartnerComplianceWorkspace adapter={builderPortalAdapter} client={client} />
    </div>
  );
}
