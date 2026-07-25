/**
 * Full-page AML case workspace (directive §11, tri-portal Phase 3).
 *
 * The authoritative processing surface for a single case, replacing the
 * narrow side sheet: persistent case header, grouped section navigation,
 * progress rail, right action panel and a complete operational Overview.
 *
 * Rendered at /admin/aml/cases/:caseId behind `aml_v3_case_workspace`;
 * while the flag is off the route redirects to the legacy side-sheet deep
 * link so nothing breaks mid-rollout. Section content reuses the existing
 * case tab components — no duplicate data model.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Circle, CircleDot, ClipboardList,
  FileText, Handshake, Loader2, Lock, MailQuestion, Minus, Network, ScanSearch,
  Scale, User, Wallet, History,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { amlCasesApi, type AmlCase, type AmlCaseEvent, type AmlCaseStatus } from "@/lib/aml/amlCasesApi";
import { amlFinanceApi } from "@/lib/aml/amlFinanceApi";
import {
  amlTransactionsApi, type AmlTransaction, type AmlCounterpartyCase,
  type AmlCounterpartyCddSummary, type AmlSettlementGateStatus,
} from "@/lib/aml/amlTransactionsApi";
import {
  CASE_STAGE_LABELS, caseStage, clientPortalStatus, CLIENT_PORTAL_STATUS_LABELS,
  serviceGateStatus, progressRail, type ProgressRailState,
} from "@/lib/aml/caseDimensions";
import {
  VerificationTab, ScreeningTab, RiskTab, OwnershipControlTab,
  FundingFinanceTab, TimelineTab, AuditTab,
} from "@/components/aml/CaseWorkspaceTabs";

const STATUS_LABELS: Record<AmlCaseStatus, string> = {
  draft: "Draft", kyc_in_progress: "Onboarding in progress", kyc_complete: "Submission received",
  edd_required: "Additional information required", under_review: "Under review",
  escalated_mlro: "Awaiting decision", cleared: "Cleared", blocked: "Blocked", closed: "Closed",
};

const NEXT_STATUSES: Record<AmlCaseStatus, AmlCaseStatus[]> = {
  draft: ["kyc_in_progress", "closed"],
  kyc_in_progress: ["kyc_complete", "edd_required", "blocked", "closed"],
  kyc_complete: ["under_review", "edd_required", "cleared", "closed"],
  edd_required: ["under_review", "escalated_mlro", "blocked", "closed"],
  under_review: ["cleared", "escalated_mlro", "edd_required", "blocked", "closed"],
  escalated_mlro: ["cleared", "blocked", "closed"],
  cleared: ["under_review", "closed"],
  blocked: ["under_review", "closed"],
  closed: [],
};

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

type SectionKey =
  | "overview" | "identity" | "ownership"
  | "counterparty" | "finance" | "documents"
  | "risk" | "requests" | "timeline";

interface SectionDef {
  key: SectionKey;
  label: string;
  icon: typeof ClipboardList;
  visible: (a: { canInvestigate: boolean }) => boolean;
}

const SECTION_GROUPS: Array<{ group: string; sections: SectionDef[] }> = [
  {
    group: "Customer",
    sections: [
      { key: "overview", label: "Overview", icon: ClipboardList, visible: () => true },
      { key: "identity", label: "Identity & Screening", icon: ScanSearch, visible: () => true },
      { key: "ownership", label: "Ownership & Control", icon: Network, visible: () => true },
    ],
  },
  {
    group: "Matter",
    sections: [
      { key: "counterparty", label: "Purchase & Counterparty", icon: Handshake, visible: (a) => a.canInvestigate },
      { key: "finance", label: "Funding & Finance", icon: Wallet, visible: (a) => a.canInvestigate },
      { key: "documents", label: "Documents & Evidence", icon: FileText, visible: () => true },
    ],
  },
  {
    group: "Decision & oversight",
    sections: [
      { key: "risk", label: "Risk & Decision", icon: Scale, visible: () => true },
      { key: "requests", label: "Requests", icon: MailQuestion, visible: () => true },
      { key: "timeline", label: "Timeline & Audit", icon: History, visible: () => true },
    ],
  },
];

const RAIL_STATE_META: Record<ProgressRailState, { icon: typeof Circle; className: string }> = {
  complete: { icon: CheckCircle2, className: "text-success" },
  in_progress: { icon: CircleDot, className: "text-primary" },
  not_started: { icon: Circle, className: "text-muted-foreground/50" },
  attention_required: { icon: AlertTriangle, className: "text-warning" },
  blocked: { icon: Lock, className: "text-destructive" },
  not_applicable: { icon: Minus, className: "text-muted-foreground/40" },
};

export default function AmlCaseWorkspace() {
  const { caseId = "" } = useParams<{ caseId: string }>();
  const [searchParams] = useSearchParams();
  const access = useAmlAccess();
  const { caseWorkspace: workspaceEnabled, loading: flagsLoading } = useAmlV3Flags();

  const [caseRow, setCaseRow] = useState<AmlCase | null>(null);
  const [events, setEvents] = useState<AmlCaseEvent[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestedSection = searchParams.get("section") as SectionKey | null;
  const [section, setSection] = useState<SectionKey>("overview");
  useEffect(() => {
    if (requestedSection && SECTION_GROUPS.some((g) => g.sections.some((s) => s.key === requestedSection))) {
      setSection(requestedSection);
    }
  }, [requestedSection]);

  const canWrite = access.canWrite;
  const canInvestigate = access.roles.has("analyst") || access.roles.has("reviewer") || access.roles.has("mlro");

  const load = useCallback(async () => {
    if (!caseId) return;
    try {
      setLoading(true);
      setError(null);
      const [res, reqRes] = await Promise.all([
        amlCasesApi.get(caseId),
        amlCasesApi.listClientRequests(caseId).catch(() => ({ requests: [] })),
      ]);
      setCaseRow(res.case);
      setEvents(res.events ?? []);
      setRequests(reqRes.requests ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unable to load this case");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    if (access.hasAnyRole && access.flagEnabled) void load();
  }, [access.hasAnyRole, access.flagEnabled, load]);

  // Staged rollout: while the workspace flag is off, fall back to the legacy
  // side-sheet deep link so bookmarks and shared links keep working.
  if (!flagsLoading && !workspaceEnabled) {
    return <Navigate to={`/admin/aml/cases?open=${caseId}`} replace />;
  }

  if (access.loading || flagsLoading || (loading && !caseRow)) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !caseRow) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Alert variant="destructive">
          <AlertTitle>Case unavailable</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error ?? "This case could not be found, or you may not have access to it."}</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/aml/cases"><ArrowLeft className="mr-2 h-4 w-4" /> Back to case register</Link>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const stage = caseStage(caseRow);
  const gate = serviceGateStatus(caseRow);
  const rail = progressRail(caseRow);
  const openRequests = requests.filter((r) => r.status === "open" || r.status === "responded");
  const completedSteps = rail.filter((s) => s.state === "complete").length;
  const progressPercent = Math.round((completedSteps / rail.length) * 100);
  const visibleGroups = SECTION_GROUPS.map((g) => ({
    ...g,
    sections: g.sections.filter((s) => s.visible({ canInvestigate })),
  })).filter((g) => g.sections.length > 0);

  const activation = (caseRow.metadata as any)?.activation;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* ---- Persistent case header ---- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 px-2">
                <Link to="/admin/aml/cases" aria-label="Back to case register">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <h1 className="truncate text-xl font-semibold sm:text-2xl">
                {caseRow.subject_display_name}
              </h1>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{caseRow.case_reference}</span>
              {caseRow.client_id && (
                <Link
                  className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  to={`/clients?clientId=${caseRow.client_id}`}
                >
                  <User className="h-3.5 w-3.5" /> Client record
                </Link>
              )}
              <span>Updated {new Date(caseRow.updated_at).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{CASE_STAGE_LABELS[stage]}</Badge>
            <Badge
              variant="outline"
              className={
                gate === "approved" || gate === "approved_with_controls"
                  ? "border-success/40 text-success"
                  : gate === "locked"
                    ? "border-destructive/40 text-destructive"
                    : "border-muted-foreground/30 text-muted-foreground"
              }
            >
              Service gate: {GATE_LABELS[gate] ?? gate}
            </Badge>
            {caseRow.risk_rating && (
              <Badge variant="outline" className="capitalize">Risk: {caseRow.risk_rating}</Badge>
            )}
          </div>
        </div>

        {/* ---- Progress rail ---- */}
        <Card>
          <CardContent className="py-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Case progress</span>
              <span aria-live="polite">{progressPercent}% of stages complete</span>
            </div>
            <ol className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Case progress stages">
              {rail.map((step) => {
                const meta = RAIL_STATE_META[step.state];
                const Icon = meta.icon;
                return (
                  <li key={step.key} className="flex items-center gap-1.5 text-xs">
                    <Icon className={`h-3.5 w-3.5 ${meta.className}`} aria-hidden />
                    <span className={step.state === "not_started" ? "text-muted-foreground/70" : ""}>
                      {step.label}
                    </span>
                    <span className="sr-only">— {step.state.replace(/_/g, " ")}</span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>

      {/* ---- Body: grouped nav · content · action panel ---- */}
      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)_260px]">
        {/* Grouped section navigation — vertical on desktop, select on mobile */}
        <nav aria-label="Case sections" className="lg:sticky lg:top-4 lg:self-start">
          <div className="lg:hidden">
            <Select value={section} onValueChange={(v) => setSection(v as SectionKey)}>
              <SelectTrigger aria-label="Case section">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {visibleGroups.flatMap((g) =>
                  g.sections.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{g.group} — {s.label}</SelectItem>
                  )),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="hidden space-y-4 lg:block">
            {visibleGroups.map((g) => (
              <div key={g.group}>
                <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.group}
                </div>
                <ul className="space-y-0.5">
                  {g.sections.map((s) => {
                    const Icon = s.icon;
                    const active = section === s.key;
                    return (
                      <li key={s.key}>
                        <button
                          type="button"
                          onClick={() => setSection(s.key)}
                          aria-current={active ? "page" : undefined}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                            active ? "bg-primary/10 font-medium text-primary" : "hover:bg-accent"
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {s.label}
                          {s.key === "requests" && openRequests.length > 0 && (
                            <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                              {openRequests.length}
                            </Badge>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        {/* Section content */}
        <main className="min-w-0 space-y-4">
          {section === "overview" && (
            <CaseOverviewSection
              caseRow={caseRow}
              openRequests={openRequests}
              onOpenSection={setSection}
            />
          )}
          {section === "identity" && (
            <div className="space-y-4">
              <VerificationTab caseId={caseRow.id} canWrite={canWrite} onChanged={load} />
              <ScreeningTab caseId={caseRow.id} canWrite={canInvestigate} onChanged={load} />
            </div>
          )}
          {section === "ownership" && <OwnershipControlTab caseRow={caseRow} canWrite={canInvestigate} />}
          {section === "counterparty" && canInvestigate && (
            <PurchaseCounterpartySection caseRow={caseRow} canWrite={canWrite} />
          )}
          {section === "finance" && canInvestigate && <FundingFinanceTab caseId={caseRow.id} />}
          {section === "documents" && (
            <DocumentsEvidenceSection caseId={caseRow.id} canWrite={canWrite} onChanged={load} />
          )}
          {section === "risk" && <RiskTab caseId={caseRow.id} canWrite={canWrite} onChanged={load} />}
          {section === "requests" && (
            <RequestsSection
              caseId={caseRow.id}
              requests={requests}
              canWrite={canWrite}
              onChanged={load}
            />
          )}
          {section === "timeline" && (
            <div className="space-y-4">
              <TimelineTab caseId={caseRow.id} events={events} canInvestigate={canInvestigate} />
              <AuditTab events={events} />
            </div>
          )}
        </main>

        {/* Right action panel */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start" aria-label="Case actions">
          <ActionPanel
            caseRow={caseRow}
            openRequests={openRequests}
            events={events}
            canWrite={canWrite}
            isMlro={access.isMlro}
            onChanged={load}
            onOpenSection={setSection}
          />
        </aside>
      </div>

      {/* Activation provenance footnote for context, kept out of the header */}
      {activation && (
        <p className="text-xs text-muted-foreground">
          Activated {activation.activated_at ? new Date(activation.activated_at).toLocaleDateString() : ""} —{" "}
          {caseRow.activation_timing === "conditional_agreement"
            ? "compliance runs under a conditional agreement; the service unlocks when the gate is approved."
            : "the designated service trigger had occurred at activation."}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview — complete operational summary (directive §12.1)           */
/* ------------------------------------------------------------------ */

function CaseOverviewSection({
  caseRow, openRequests, onOpenSection,
}: {
  caseRow: AmlCase;
  openRequests: any[];
  onOpenSection: (s: SectionKey) => void;
}) {
  const stage = caseStage(caseRow);
  const gate = serviceGateStatus(caseRow);
  const portalStatus = clientPortalStatus(caseRow);
  const activation = (caseRow.metadata as any)?.activation;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Customer</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row k="Subject" v={caseRow.subject_display_name} />
            <Row k="Customer type" v={{ individual: "Individual", entity: "Entity / company", trust: "Trust" }[caseRow.subject_type] ?? caseRow.subject_type} />
            <Row
              k="Client record"
              v={caseRow.client_id ? (
                <Link className="underline underline-offset-2" to={`/clients?clientId=${caseRow.client_id}`}>
                  Open client
                </Link>
              ) : (
                <span className="text-muted-foreground">Not linked</span>
              )}
            />
            <Row k="Opened" v={new Date(caseRow.opened_at).toLocaleDateString()} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Activation</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row
              k="Timing"
              v={
                caseRow.activation_timing === "conditional_agreement" ? "Before service (conditional agreement)"
                : caseRow.activation_timing === "post_agreement_trigger" ? "At service trigger"
                : caseRow.activation_timing === "pre_agreement" ? "Before agreement"
                : "Not classified"
              }
            />
            <Row
              k="Agreement"
              v={
                caseRow.agreement_state === "operative" ? "Operative"
                : caseRow.agreement_state === "conditional_executed" ? "Conditional — executed"
                : caseRow.agreement_state === "terminated" ? "Terminated"
                : caseRow.agreement_state === "not_executed" ? "Not executed"
                : "—"
              }
            />
            <Row k="Trigger event" v={activation?.event ?? "—"} />
            {activation?.program_version && <Row k="Program version" v={activation.program_version} />}
            <Row k="Confirmed by" v={activation?.activated_by_email ?? "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Where things stand</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row k="Stage" v={CASE_STAGE_LABELS[stage]} />
            <Row k="Client portal" v={CLIENT_PORTAL_STATUS_LABELS[portalStatus]} />
            <Row k="Service gate" v={GATE_LABELS[gate] ?? gate} />
            <Row k="Risk rating" v={caseRow.risk_rating ? caseRow.risk_rating : "Unrated"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Outstanding</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {openRequests.length === 0 ? (
              <p className="text-muted-foreground">No open client requests.</p>
            ) : (
              <>
                <p>
                  {openRequests.length} open request{openRequests.length === 1 ? "" : "s"} with the client.
                </p>
                <Button size="sm" variant="outline" onClick={() => onOpenSection("requests")}>
                  Review requests
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Documents & Evidence (directive §12.7 — staff review surface)       */
/* ------------------------------------------------------------------ */

function DocumentsEvidenceSection({
  caseId, canWrite, onChanged,
}: { caseId: string; canWrite: boolean; onChanged: () => void }) {
  const [requirements, setRequirements] = useState<any[] | null>(null);
  const [documents, setDocuments] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dupScan, setDupScan] = useState<{
    duplicates: Array<{ reference_id: string; reference_type: string; label: string; case_count: number; client_count: number }>;
    discrepancies_created: number;
  } | null>(null);
  const [evidence, setEvidence] = useState<any[]>([]);

  const refresh = useCallback(async () => {
    const [reqs, docs, ev] = await Promise.all([
      amlCasesApi.listRequirements(caseId).catch(() => ({ requirements: [] })),
      amlCasesApi.listDocuments(caseId).catch(() => ({ documents: [] })),
      amlFinanceApi.listEvidence(caseId).catch(() => ({ evidence: [] })),
    ]);
    setRequirements(reqs.requirements ?? []);
    setDocuments(docs.documents ?? []);
    setEvidence(ev.evidence ?? []);
  }, [caseId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const download = async (documentId: string) => {
    try {
      const { url } = await amlCasesApi.getDocumentDownloadUrl(documentId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast({ title: "Download failed", description: e.message, variant: "destructive" });
    }
  };

  const review = async (documentId: string, decision: "accepted" | "rejected") => {
    const reason = decision === "rejected"
      ? window.prompt("Reason shown to the client for rejecting this document:") ?? undefined
      : undefined;
    if (decision === "rejected" && !reason) return;
    setBusy(documentId);
    try {
      await amlCasesApi.reviewDocument(documentId, decision, reason);
      toast({ title: decision === "accepted" ? "Document accepted" : "Document rejected" });
      await refresh();
      onChanged();
    } catch (e: any) {
      toast({ title: "Review failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const seed = async () => {
    setBusy("seed");
    try {
      await amlCasesApi.seedDefaultRequirements(caseId);
      await refresh();
      onChanged();
    } catch (e: any) {
      toast({ title: "Could not add requirements", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const scanDuplicates = async () => {
    setBusy("dup-scan");
    try {
      const res = await amlFinanceApi.duplicateDocumentRefs(caseId);
      setDupScan(res);
      if (res.discrepancies_created > 0) onChanged();
      toast({
        title: res.duplicates.length === 0
          ? "No reused documents found"
          : `${res.duplicates.length} reused document reference${res.duplicates.length === 1 ? "" : "s"} found`,
      });
    } catch (e: any) {
      toast({ title: "Scan failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (requirements === null || documents === null) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Document requirements</CardTitle>
            {canWrite && requirements.length === 0 && (
              <Button size="sm" variant="outline" disabled={busy === "seed"} onClick={seed}>
                Add standard requirements
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {requirements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No requirements yet. Add the standard identity and source-of-funds set, then the
              client sees them in their portal checklist.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {requirements.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="truncate">{r.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.required ? "Required" : "Optional"}
                      {r.due_at ? ` · due ${new Date(r.due_at).toLocaleDateString()}` : ""}
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize">{String(r.status ?? "pending").replace(/_/g, " ")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Documents on file</CardTitle></CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing uploaded yet. Documents the client uploads in their portal appear here for review.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{d.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      Uploaded {new Date(d.uploaded_at).toLocaleString()}
                      {d.rejection_reason ? ` · rejected: ${d.rejection_reason}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">{String(d.status ?? "uploaded").replace(/_/g, " ")}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => download(d.id)}>Download</Button>
                    {canWrite && d.status === "uploaded" && (
                      <>
                        <Button size="sm" variant="outline" disabled={busy === d.id}
                          onClick={() => review(d.id, "accepted")}>
                          Accept
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy === d.id}
                          onClick={() => review(d.id, "rejected")}>
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Evidence references</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Documents and records cited as evidence for this case — stored once,
                referenced wherever they support a finding.
              </p>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link to="/admin/aml/finance">Manage</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">No evidence references recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {evidence.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{e.label}</div>
                    {e.detail && <div className="truncate text-xs text-muted-foreground">{e.detail}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {String(e.reference_type ?? "reference").replace(/_/g, " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm">Reused-document check</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Scans evidence references for documents that also appear on other
                  clients' cases. Confirmed reuse is recorded as a discrepancy on every
                  affected case.
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={busy === "dup-scan"} onClick={scanDuplicates}>
                {busy === "dup-scan" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Run scan
              </Button>
            </div>
          </CardHeader>
          {dupScan && (
            <CardContent>
              {dupScan.duplicates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No document references on this case are shared with other clients.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {dupScan.duplicates.map((d) => (
                    <li key={`${d.reference_type}:${d.reference_id}`} className="rounded-md border border-warning/40 p-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                        <span className="min-w-0 truncate">{d.label || d.reference_id}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Appears on {d.case_count} cases across {d.client_count} different clients.
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {dupScan.discrepancies_created > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {dupScan.discrepancies_created} discrepanc{dupScan.discrepancies_created === 1 ? "y" : "ies"} recorded for follow-up.
                </p>
              )}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Purchase & Counterparty (Phase 9, §12.5)                            */
/* ------------------------------------------------------------------ */

function PurchaseCounterpartySection({ caseRow, canWrite }: { caseRow: AmlCase; canWrite: boolean }) {
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<AmlTransaction[]>([]);
  const [cpCases, setCpCases] = useState<AmlCounterpartyCase[]>([]);
  const [cpRequests, setCpRequests] = useState<any[]>([]);
  const [obligations, setObligations] = useState<any[]>([]);
  const [cddSummary, setCddSummary] = useState<AmlCounterpartyCddSummary | null>(null);
  const [settlementGate, setSettlementGate] = useState<AmlSettlementGateStatus | null>(null);
  const [busyCp, setBusyCp] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [tx, cp, req, ob, sum] = await Promise.all([
        amlTransactionsApi.listTransactions(caseRow.id).catch(() => ({ transactions: [] })),
        amlTransactionsApi.listCpCases(caseRow.id).catch(() => ({ counterparty_cases: [] })),
        amlTransactionsApi.listCpRequests({ case_id: caseRow.id }).catch(() => ({ requests: [] })),
        amlTransactionsApi.listObligations({ case_id: caseRow.id }).catch(() => ({ obligations: [] })),
        amlTransactionsApi.counterpartyCddSummary(caseRow.id).catch(() => ({ summary: null as any })),
      ]);
      setTransactions(tx.transactions ?? []);
      setCpCases(cp.counterparty_cases ?? []);
      setCpRequests(req.requests ?? []);
      setObligations(ob.obligations ?? []);
      setCddSummary(sum.summary ?? null);
      if (caseRow.purchase_file_id) {
        const gate = await amlTransactionsApi.settlementGateStatus(caseRow.purchase_file_id).catch(() => null);
        setSettlementGate(gate);
      }
    } finally {
      setLoading(false);
    }
  }, [caseRow.id, caseRow.purchase_file_id]);

  useEffect(() => { void load(); }, [load]);

  const setDelayedCdd = async (cp: AmlCounterpartyCase) => {
    const deadline = window.prompt("Delayed CDD deadline (YYYY-MM-DD):") ?? "";
    if (!deadline.trim()) return;
    const justification = window.prompt("Justification for delaying CDD (minimum 10 characters):") ?? "";
    if (!justification.trim()) return;
    setBusyCp(cp.id);
    try {
      await amlTransactionsApi.setDelayedCdd({ id: cp.id, deadline: deadline.trim(), justification: justification.trim() });
      toast({ title: "Delayed CDD recorded" });
      await load();
    } catch (e: any) {
      toast({ title: "Could not record delayed CDD", description: e.message, variant: "destructive" });
    } finally {
      setBusyCp(null);
    }
  };

  const markUncooperative = async (cp: AmlCounterpartyCase) => {
    const reason = window.prompt(
      "Reason for marking this counterparty uncooperative (minimum 10 characters).\nAt least two recorded contact attempts are required first:",
    ) ?? "";
    if (!reason.trim()) return;
    setBusyCp(cp.id);
    try {
      await amlTransactionsApi.markUncooperative({ id: cp.id, reason: reason.trim() });
      toast({ title: "Counterparty marked uncooperative", description: "The case has been escalated for review." });
      await load();
    } catch (e: any) {
      toast({ title: "Could not mark uncooperative", description: e.message, variant: "destructive" });
    } finally {
      setBusyCp(null);
    }
  };

  const openObligations = obligations.filter((o) => ["pending", "acknowledged"].includes(o.status));
  const openCpRequests = cpRequests.filter((r) => ["pending", "sent", "awaiting_response"].includes(r.status));
  const today = new Date().toISOString().slice(0, 10);

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Purchase & Counterparty</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                The property transaction, its sellers and counterparties, and the due-diligence
                record for each — scoped to this case.
              </p>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link to="/admin/aml/transactions">Full register</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row
            k="Purchase file"
            v={caseRow.purchase_file_id ? "Linked" : <span className="text-muted-foreground">Not linked</span>}
          />
          {settlementGate && (
            <Row
              k="Settlement gate"
              v={
                !settlementGate.gate_enabled ? "Not enforced"
                : settlementGate.blocked
                  ? <span className="text-destructive">Blocked ({settlementGate.reasons.length} reason{settlementGate.reasons.length === 1 ? "" : "s"})</span>
                  : <span className="text-success">Clear to settle</span>
              }
            />
          )}
          {cddSummary && (
            <Row
              k="Counterparty CDD"
              v={
                cddSummary.counterparty_cases_total === 0
                  ? "No counterparties recorded"
                  : cddSummary.all_cleared
                    ? `All ${cddSummary.counterparty_cases_total} cleared`
                    : `${cddSummary.counterparty_cases_open} open · ${cddSummary.requests_overdue} overdue request${cddSummary.requests_overdue === 1 ? "" : "s"}`
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Transactions</CardTitle></CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No transaction recorded yet. Transactions capture the contract, price and
              settlement details and drive threshold obligations.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {transactions.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="truncate">{t.property_address ?? t.reference ?? t.kind}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.settlement_date ? `Settles ${new Date(t.settlement_date).toLocaleDateString()}` : "No settlement date"}
                      {t.original_settlement_date && t.settlement_date !== t.original_settlement_date &&
                        ` (moved from ${new Date(t.original_settlement_date).toLocaleDateString()})`}
                      {t.purchase_price ? ` · ${Number(t.purchase_price).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ""}
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize">{String(t.status).replace(/_/g, " ")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Seller & counterparty due diligence</CardTitle></CardHeader>
        <CardContent>
          {cpCases.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No counterparty records yet. Add sellers, seller entities and their
              representatives on the full register.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {cpCases.map((cp) => (
                <li key={cp.id} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="truncate">{cp.subject_display_name}</span>
                      {cp.uncooperative && (
                        <Badge variant="outline" className="h-5 border-destructive/50 px-1.5 text-[10px] text-destructive">
                          Uncooperative
                        </Badge>
                      )}
                      {cp.delayed_cdd_deadline && (
                        <Badge
                          variant="outline"
                          className={`h-5 px-1.5 text-[10px] ${cp.delayed_cdd_deadline < today ? "border-destructive/50 text-destructive" : "border-warning/50 text-warning"}`}
                        >
                          Delayed CDD {cp.delayed_cdd_deadline < today ? "overdue" : `due ${new Date(cp.delayed_cdd_deadline).toLocaleDateString()}`}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">{String(cp.status).replace(/_/g, " ")}</Badge>
                      {canWrite && !cp.delayed_cdd_deadline && (
                        <Button size="sm" variant="ghost" disabled={busyCp === cp.id} onClick={() => setDelayedCdd(cp)}>
                          Delay CDD
                        </Button>
                      )}
                      {canWrite && !cp.uncooperative && (
                        <Button size="sm" variant="ghost" disabled={busyCp === cp.id} onClick={() => markUncooperative(cp)}>
                          Mark uncooperative
                        </Button>
                      )}
                    </div>
                  </div>
                  {cp.uncooperative_reason && (
                    <p className="text-xs text-muted-foreground">Uncooperative: {cp.uncooperative_reason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {openCpRequests.length > 0 && (
            <p className="mt-3 border-t border-border/60 pt-2 text-xs text-muted-foreground">
              {openCpRequests.length} open information request{openCpRequests.length === 1 ? "" : "s"} to counterparties
              {cddSummary && cddSummary.requests_overdue > 0 && `, ${cddSummary.requests_overdue} past due`}.
            </p>
          )}
        </CardContent>
      </Card>

      {openObligations.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" /> Reporting obligations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {openObligations.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <span className="uppercase">{String(o.kind).replace(/_/g, " ")}</span>
                  <Badge variant="outline" className="capitalize">{String(o.status).replace(/_/g, " ")}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Obligations resolve on the Transactions register — reports require submission evidence.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Requests (client-safe further-information requests, §14.5)          */
/* ------------------------------------------------------------------ */

function RequestsSection({
  caseId, requests, canWrite, onChanged,
}: { caseId: string; requests: any[]; canWrite: boolean; onChanged: () => void }) {
  const [kind, setKind] = useState<"additional_info" | "new_document" | "clarification" | "re_consent">("additional_info");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await amlCasesApi.createClientRequest({ case_id: caseId, kind, subject, message });
      toast({ title: "Request sent to client" });
      setSubject(""); setMessage("");
      onChanged();
    } catch (e: any) {
      toast({ title: "Could not send request", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (id: string) => {
    try {
      await amlCasesApi.resolveClientRequest(id);
      onChanged();
    } catch (e: any) {
      toast({ title: "Could not resolve request", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {canWrite && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Ask the client for something</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger aria-label="Request type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="additional_info">Additional information</SelectItem>
                  <SelectItem value="new_document">New document</SelectItem>
                  <SelectItem value="clarification">Clarification</SelectItem>
                  <SelectItem value="re_consent">Re-consent</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <Textarea
              placeholder="Plain-English explanation the client will see. Do not include internal reasoning."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <Button size="sm" disabled={busy || !subject.trim() || !message.trim()} onClick={send}>
              Send request
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Requests</CardTitle></CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No requests yet. Requests you send appear in the client's portal with your
              explanation, and their responses land back here.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {requests.map((r) => (
                <li key={r.id} className="space-y-1 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate font-medium">{r.subject}</div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">{String(r.status).replace(/_/g, " ")}</Badge>
                      {canWrite && (r.status === "open" || r.status === "responded") && (
                        <Button size="sm" variant="ghost" onClick={() => resolve(r.id)}>Resolve</Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{r.message}</p>
                  {r.response_payload && Object.keys(r.response_payload).length > 0 && (
                    <p className="text-xs">
                      <span className="text-muted-foreground">Client response: </span>
                      {typeof r.response_payload === "object"
                        ? r.response_payload.text ?? JSON.stringify(r.response_payload)
                        : String(r.response_payload)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Right action panel (directive §11.4)                                */
/* ------------------------------------------------------------------ */

function ActionPanel({
  caseRow, openRequests, events, canWrite, isMlro, onChanged, onOpenSection,
}: {
  caseRow: AmlCase;
  openRequests: any[];
  events: AmlCaseEvent[];
  canWrite: boolean;
  isMlro: boolean;
  onChanged: () => void;
  onOpenSection: (s: SectionKey) => void;
}) {
  const [reason, setReason] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const nextOptions = NEXT_STATUSES[caseRow.status] ?? [];
  const stage = caseStage(caseRow);

  const transition = async (to: AmlCaseStatus) => {
    setTransitioning(true);
    try {
      await amlCasesApi.transition(caseRow.id, to, reason || undefined);
      toast({
        title: "Status updated",
        description: `${STATUS_LABELS[caseRow.status]} → ${STATUS_LABELS[to]}`,
      });
      setReason("");
      onChanged();
    } catch (e: any) {
      toast({ title: "Transition failed", description: e.message, variant: "destructive" });
    } finally {
      setTransitioning(false);
    }
  };

  const blockers: string[] = [];
  if (stage === "blocked") blockers.push("Case is blocked — resolve before proceeding.");
  if (stage === "enhanced_cdd") blockers.push("Enhanced due diligence is outstanding.");
  if (openRequests.length > 0) blockers.push(`${openRequests.length} client request${openRequests.length === 1 ? "" : "s"} awaiting a response.`);

  const nextAction =
    stage === "client_submitted" ? { label: "Review the client submission", section: "documents" as SectionKey }
    : stage === "decision_pending" ? { label: "Record the decision", section: "risk" as SectionKey }
    : stage === "enhanced_cdd" ? { label: "Work the additional-information items", section: "requests" as SectionKey }
    : stage === "client_in_progress" ? { label: "Check portal progress and chase requirements", section: "documents" as SectionKey }
    : { label: "Review the case overview", section: "overview" as SectionKey };

  return (
    <>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Next best action</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{nextAction.label}</p>
          <Button size="sm" variant="outline" onClick={() => onOpenSection(nextAction.section)}>
            Go
          </Button>
        </CardContent>
      </Card>

      {blockers.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Blockers</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {canWrite && nextOptions.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Advance status</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {nextOptions.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="outline"
                  disabled={transitioning}
                  onClick={() => transition(s)}
                >
                  {STATUS_LABELS[s]}
                </Button>
              ))}
            </div>
            {caseRow.status === "escalated_mlro" && !isMlro && (
              <p className="text-xs text-muted-foreground">
                Escalated decisions can only be recorded by authorised decision-makers.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent activity</CardTitle></CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {events.slice(0, 5).map((e) => (
                <li key={e.id}>
                  <div className="line-clamp-2">{e.summary}</div>
                  <div className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</div>
                </li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 px-0"
            onClick={() => onOpenSection("timeline")}
          >
            View full timeline
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
