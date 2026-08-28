import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import type {
  PartnerLinkSummary, PartnerPortalAdapter, PartnerRecordsRequestView,
  PartnerSurfaceMode, PartnerWorkspaceClient, PartnerWorkspaceDirectory,
  PartnerWorkspaceDto,
} from "./types";
import type { PassportView } from "@/lib/aml/passport";
import { partnerWorkspacePanels } from "@/lib/aml/partnerSurface";
import { PartnerPassportPanel } from "./PartnerPassportPanel";
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
  /* ── the deep link ──────────────────────────────────────────────────
     `?matter=<partner_case_link_id>` is what "View in your portal" on the
     emailed Passport link hands over. It is a DESTINATION and never an
     authority: the server re-derives this partner's organisation from their
     portal session, and a matter belonging to somebody else simply is not in
     the directory it returns — so an unrecognised value falls through to the
     ordinary selection rather than being an error. */
  const [searchParams] = useSearchParams();
  const requestedMatter = searchParams.get("matter");
  const [directory, setDirectory] = useState<PartnerWorkspaceDirectory | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<PartnerWorkspaceDto | null>(null);
  /* The Compliance Passport as the server built it for this partner, and why
     it is absent when it is. Neither is derived here. */
  const [passport, setPassport] = useState<PassportView | null>(null);
  const [passportAvailability, setPassportAvailability] =
    useState<{ code: string; message: string } | undefined>(undefined);
  /* What this page IS. The server decides; an older deployment that does not
     say reads as `full`, which is exactly how it behaved before. */
  const [surfaceMode, setSurfaceMode] = useState<PartnerSurfaceMode>("full");
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
    if (res.data.surface_mode) setSurfaceMode(res.data.surface_mode);
    const active = res.data.links.filter((l) => l.state === "active");
    /* A named matter wins, and it is checked against what the SERVER
       returned — never trusted as given. Falling back rather than erroring
       matters: a stale link in an old email must land the partner on their
       compliance page, not on a failure. */
    const named = requestedMatter
      ? res.data.links.find((l) => l.id === requestedMatter)
      : undefined;
    if (named) setSelectedLink(named.id);
    else if (active.length === 1) setSelectedLink(active[0].id);
  }, [client, requestedMatter]);

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
    setPassport((w.data.passport as PassportView | null) ?? null);
    setPassportAvailability(w.data.passport_availability);
    if (w.data.surface_mode) setSurfaceMode(w.data.surface_mode);
    setRequests(r.data?.requests ?? []);
  }, [client]);

  useEffect(() => { loadDirectory(); }, [loadDirectory]);
  useEffect(() => {
    if (selectedLink) loadWorkspace(selectedLink);
    else { setWorkspace(null); setPassport(null); setPassportAvailability(undefined); }
  }, [selectedLink, loadWorkspace]);

  const refresh = useCallback(() => {
    if (selectedLink) loadWorkspace(selectedLink);
  }, [selectedLink, loadWorkspace]);

  /* Which panels this page draws. The adapter stays the CEILING — a mode can
     only ever subtract from what a portal already permitted — and the rule is
     the shared module the server derives the mode with, so the two cannot
     disagree about what `passport_only` means. */
  const panels = partnerWorkspacePanels(surfaceMode, adapter.panels);

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
          {panels.passportStrip && <PartnerPassportStrip workspace={workspace} adapter={adapter} />}
          {/* The DOCUMENT itself — the same record the issuing organisation
              holds, so this partner never has to repeat due diligence they
              are entitled to rely on. Drawn from the server's own partner
              projection; nothing here selects or relabels a page. */}
          {panels.passport && (
            <PartnerPassportPanel passport={passport} availability={passportAvailability} />
          )}
          {panels.summary && <ComplianceSummaryCard workspace={workspace} adapter={adapter} />}
          {panels.tasks && <TaskDeadlineRail workspace={workspace} adapter={adapter} />}
          {panels.procedures && <ProcedureEvidenceViewer workspace={workspace} />}
          {panels.determination && (
            <IndependentAssessmentForm workspace={workspace} client={client} onRecorded={refresh} />
          )}
          {panels.recordsRequests && (
            <RecordsRequestBuilder
              workspace={workspace} requests={requests} client={client} onSubmitted={refresh}
            />
          )}
          {panels.deliveries && (
            <EvidenceDeliveriesPanel workspace={workspace} client={client} />
          )}
          {panels.auditReceipt && (
            <AuditReceiptPanel workspace={workspace} client={client} />
          )}
          {panels.clarification && <ClarificationChannel adapter={adapter} />}
          {panels.support && <SupportEscalationPanel adapter={adapter} />}
        </>
      )}
    </div>
  );
}
