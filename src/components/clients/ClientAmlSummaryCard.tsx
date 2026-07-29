/**
 * Persistent AML/CTF summary on the master client record (directive §13,
 * tri-portal Phase 4). Extends the activation entry point into a standing
 * status card: before activation it explains eligibility and offers Start
 * Client Compliance; after activation it shows stage, portal status, service
 * gate, progress and outstanding items with a deep link into the case.
 *
 * Deliberately a summary — detailed AML processing stays in the dedicated
 * case workspace (§13.3). Renders nothing for users without AML access or
 * while the client-record integration flag is off.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { ActivateClientDialog } from "@/components/aml/ActivateClientDialog";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import {
  CASE_STAGE_LABELS, CLIENT_PORTAL_STATUS_LABELS, caseStage, clientPortalStatus,
  serviceGateStatus,
} from "@/lib/aml/caseDimensions";

const GATE_LABELS: Record<string, string> = {
  not_activated: "Not activated",
  cdd_incomplete: "CDD incomplete",
  information_outstanding: "Information outstanding",
  under_review: "Under review",
  conditions_outstanding: "Conditions outstanding",
  approved_with_controls: "Approved with controls",
  approved: "Approved",
  locked: "Locked",
  terminated: "Terminated",
};

interface Props {
  clientId: string;
  clientName?: string;
}

export function ClientAmlSummaryCard({ clientId, clientName }: Props) {
  const access = useAmlAccess();
  const { startClientCompliance, caseWorkspace, loading: flagsLoading } = useAmlV3Flags();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<{
    caseRow: AmlCase | null;
    hasOpenCase: boolean;
    progress: { completed: number; total: number } | null;
    openRequests: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activateOpen, setActivateOpen] = useState(false);

  const eligible = Boolean(
    !access.loading && !flagsLoading &&
    access.flagEnabled && access.hasAnyRole && startClientCompliance && clientId,
  );

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const res = await amlCasesApi.clientSummary(clientId);
      setSummary({
        caseRow: res.case,
        hasOpenCase: res.has_open_case,
        progress: res.requirement_progress ?? null,
        openRequests: res.open_client_requests ?? 0,
      });
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (eligible) void load();
  }, [eligible, load]);

  if (!eligible) return null;

  const openCase = (c: AmlCase) => {
    if (caseWorkspace) navigate(`/admin/aml/cases/${c.id}`);
    else navigate(`/admin/aml/cases?open=${c.id}`);
  };

  const c = summary?.caseRow ?? null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm">Identity &amp; compliance</CardTitle>
            <p className="text-xs text-muted-foreground">AML/CTF status for this client</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading || summary === null ? (
          <Skeleton className="h-16 w-full" />
        ) : !c ? (
          <>
            <p className="text-sm text-muted-foreground">
              Compliance has not started. Activating opens a case, invites the client into
              their secure portal and starts identity checks — it needs a human-confirmed
              activation event.
            </p>
            {access.canWrite && (
              <Button size="sm" onClick={() => setActivateOpen(true)}>
                <ShieldCheck className="mr-2 h-4 w-4" /> Start Client Compliance
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{CASE_STAGE_LABELS[caseStage(c)]}</Badge>
              <Badge variant="outline">
                Client portal: {CLIENT_PORTAL_STATUS_LABELS[clientPortalStatus(c)]}
              </Badge>
              <Badge
                variant="outline"
                className={
                  ["approved", "approved_with_controls"].includes(serviceGateStatus(c))
                    ? "border-success/40 text-success"
                    : serviceGateStatus(c) === "locked"
                      ? "border-destructive/40 text-destructive"
                      : "border-muted-foreground/30 text-muted-foreground"
                }
              >
                Service: {GATE_LABELS[serviceGateStatus(c)]}
              </Badge>
            </div>

            {summary.progress && summary.progress.total > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Required documents</span>
                  <span>{summary.progress.completed} of {summary.progress.total}</span>
                </div>
                <Progress
                  value={(summary.progress.completed / summary.progress.total) * 100}
                  aria-label="Required document progress"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {c.case_reference}
                {summary.openRequests > 0
                  ? ` · ${summary.openRequests} open request${summary.openRequests === 1 ? "" : "s"} with the client`
                  : ""}
              </span>
              <span>Updated {new Date(c.updated_at).toLocaleDateString()}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => openCase(c)}>
                Open AML case <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              {/* Duplicate prevention: a new activation is offered only when no
                  open case exists (cleared/blocked/closed cases don't block). */}
              {!summary.hasOpenCase && access.canWrite && (
                <Button size="sm" variant="outline" onClick={() => setActivateOpen(true)}>
                  <ShieldCheck className="mr-2 h-4 w-4" /> Start new compliance case
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>

      <ActivateClientDialog
        open={activateOpen}
        onOpenChange={setActivateOpen}
        clientId={clientId}
        clientName={clientName}
        onActivated={(created) => {
          setActivateOpen(false);
          void load();
          openCase(created);
        }}
      />
    </Card>
  );
}
