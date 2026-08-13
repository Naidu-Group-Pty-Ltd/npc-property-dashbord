import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type {
  PartnerLinkSummary, PartnerPortalAdapter, PartnerRecordsRequestView,
  PartnerWorkspaceClient, PartnerWorkspaceDirectory, PartnerWorkspaceDto,
} from "./types";
import { ResponsibilityNotice } from "./ResponsibilityNotice";
import { RefreshBanner } from "./RefreshBanner";
import { ComplianceSummaryCard } from "./ComplianceSummaryCard";
import { PartnerPassportStrip } from "./PartnerPassportStrip";
import { ProcedureEvidenceViewer } from "./ProcedureEvidenceViewer";
import { IndependentAssessmentForm } from "./IndependentAssessmentForm";
import { RecordsRequestBuilder } from "./RecordsRequestBuilder";
import { EvidenceDeliveriesPanel } from "./EvidenceDeliveriesPanel";
import { TaskDeadlineRail } from "./TaskDeadlineRail";
import { AuditReceiptPanel } from "./AuditReceiptPanel";
import { ClarificationChannel } from "./ClarificationChannel";
import { SupportEscalationPanel } from "./SupportEscalationPanel";

/**
 * THE shared Partner Compliance Workspace (Phase 4). All four portals mount
 * this one component; the adapter supplies wording and optional panels, the
 * client supplies the portal's own authenticated transport, and every
 * security decision stays on the server. There is deliberately no
 * portal-specific fork inside this tree.
 */
export function PartnerComplianceWorkspace({
  adapter, client,
}: { adapter: PartnerPortalAdapter; client: PartnerWorkspaceClient }) {
  const [directory, setDirectory] = useState<PartnerWorkspaceDirectory | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<PartnerWorkspaceDto | null>(null);
  const [requests, setRequests] = useState<PartnerRecordsRequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(async () => {
    setLoading(true); setError(null);
    const res = await client.getDirectory();
    setLoading(false);
    if (res.error || !res.data) {
      setError(res.error?.message ?? "The compliance workspace is not available for your account.");
      return;
    }
    setDirectory(res.data);
    const active = res.data.links.filter((l) => l.state === "active");
    if (active.length === 1) setSelectedLink(active[0].id);
  }, [client]);

  const loadWorkspace = useCallback(async (linkId: string) => {
    setLoading(true); setError(null);
    const [w, r] = await Promise.all([
      client.getWorkspace(linkId),
      client.listRequests(linkId),
    ]);
    setLoading(false);
    if (w.error || !w.data) {
      setError(w.error?.message ?? "This matter is not available.");
      return;
    }
    setWorkspace(w.data.workspace);
    setRequests(r.data?.requests ?? []);
  }, [client]);

  useEffect(() => { loadDirectory(); }, [loadDirectory]);
  useEffect(() => {
    if (selectedLink) loadWorkspace(selectedLink);
    else setWorkspace(null);
  }, [selectedLink, loadWorkspace]);

  const refresh = useCallback(() => {
    if (selectedLink) loadWorkspace(selectedLink);
  }, [selectedLink, loadWorkspace]);

  if (loading && !directory) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading compliance workspace…
      </div>
    );
  }

  if (error && !directory) {
    // Safe closed state: no membership / disabled / no mapping. The exact
    // denial reason from the server is already partner-safe.
    return (
      <div className="space-y-3 max-w-3xl">
        <ResponsibilityNotice intro={adapter.responsibilityIntro} />
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">{error}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-3xl" data-testid="partner-compliance-workspace">
      <h1 className="text-lg font-semibold">{adapter.workspaceTitle}</h1>
      <ResponsibilityNotice intro={adapter.responsibilityIntro} />

      {directory && directory.links.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No matters are linked to {directory.organisation.legal_name} yet. When the issuing
            organisation links a matter to your organisation it appears here — until then there
            is nothing to review, and your organisation's own processes are unaffected.
          </CardContent>
        </Card>
      )}

      {directory && directory.links.length > 0 && (
        <nav aria-label={`${adapter.matterLabel} list`} className="flex flex-wrap gap-2">
          {directory.links.map((l: PartnerLinkSummary) => (
            <Button
              key={l.id}
              size="sm"
              variant={selectedLink === l.id ? "default" : "outline"}
              aria-current={selectedLink === l.id ? "true" : undefined}
              onClick={() => setSelectedLink(l.id)}
            >
              {adapter.formatReference(l)}
              {l.state !== "active" && (
                <Badge variant="outline" className="ml-1.5 text-muted-foreground">{l.state}</Badge>
              )}
            </Button>
          ))}
        </nav>
      )}

      {loading && directory && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      )}
      {error && directory && (
        <Card><CardContent className="py-4 text-sm text-muted-foreground">{error}</CardContent></Card>
      )}

      {workspace && !loading && (
        <>
          <RefreshBanner state={workspace.attestation_state} />
          {/* Phase 4: the Passport identity strip — presentation of data the
              workspace DTO already discloses; renders nothing pre-share. */}
          <PartnerPassportStrip workspace={workspace} adapter={adapter} />
          <ComplianceSummaryCard workspace={workspace} adapter={adapter} />
          <TaskDeadlineRail workspace={workspace} adapter={adapter} />
          {adapter.panels.procedures && <ProcedureEvidenceViewer workspace={workspace} />}
          {adapter.panels.determination && (
            <IndependentAssessmentForm workspace={workspace} client={client} onRecorded={refresh} />
          )}
          {adapter.panels.recordsRequests && (
            <RecordsRequestBuilder
              workspace={workspace} requests={requests} client={client} onSubmitted={refresh}
            />
          )}
          {adapter.panels.deliveries && (
            <EvidenceDeliveriesPanel workspace={workspace} client={client} />
          )}
          {adapter.panels.auditReceipt && (
            <AuditReceiptPanel workspace={workspace} client={client} />
          )}
          {adapter.panels.clarification && <ClarificationChannel adapter={adapter} />}
          <SupportEscalationPanel adapter={adapter} />
        </>
      )}
    </div>
  );
}
