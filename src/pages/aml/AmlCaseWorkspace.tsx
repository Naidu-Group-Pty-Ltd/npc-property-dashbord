/**
 * Full-page AML case workspace (directive §11, tri-portal Phase 3).
 *
 * The authoritative processing surface for a single case: a persistent
 * header, a five-phase macro rail, five operator areas, the section the
 * operator chose, and a right rail contextual to that area.
 *
 * ── What the redesign changed, and what it did not ────────────────────
 * The eleven sections are unchanged. Each still lives at the same
 * `?section=` key, still mounts the same component, and still calls the
 * same server operations with the same server-side authorisation. What
 * changed is how much an operator has to read before they can act: the
 * eleven-item rail became five areas, the fourteen-pill progress strip
 * became five phases (the fourteen-step rail is untouched and still
 * canonical — it renders in Records → Timeline), and the Overview became
 * an operational summary instead of a wall of label/value cards.
 *
 * Everything the Overview shows is derived, per render, by the pure
 * helpers in `src/lib/aml/workspaceViewModel.ts`. None of it is stored,
 * and none of it is an authority: the service gate is still moved only by
 * an explicit human decision recorded server-side.
 *
 * Rendered at /admin/aml/cases/:caseId behind `aml_v3_case_workspace`;
 * while the flag is off the route redirects to the legacy side-sheet deep
 * link so nothing breaks mid-rollout.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Circle, CircleDot, Loader2, Lock, Minus,
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
import { displayDate, displayDateTime } from "@/lib/aml/displayDate";
import { amlCasesApi, type AmlCase, type AmlCaseEvent } from "@/lib/aml/amlCasesApi";
import { amlFinanceApi } from "@/lib/aml/amlFinanceApi";
import {
  amlTransactionsApi, type AmlTransaction, type AmlCounterpartyCase,
  type AmlCounterpartyCddSummary, type AmlSettlementGateStatus,
} from "@/lib/aml/amlTransactionsApi";
import {
  amlMonitoringApi, type AmlCaseMonitoring, type AmlReview, type AmlReviewTriggerKind,
} from "@/lib/aml/amlMonitoringApi";
import { usePromptDialog } from "@/components/aml/usePromptDialog";
import { VerificationSection } from "@/components/aml/VerificationSection";
import { SubmissionReviewPanel } from "@/components/aml/SubmissionReviewPanel";
import { LegacyVerificationHistoryPanel } from "@/components/aml/LegacyVerificationHistoryPanel";
import { PartyVerificationPanel } from "@/components/aml/PartyVerificationPanel";
import { PartyScreeningPanel } from "@/components/aml/PartyScreeningPanel";
import { ReliancePassportSection } from "@/components/aml/ReliancePassportSection";
import { ComplianceJourneyMap } from "@/components/aml/ComplianceJourneyMap";
import { progressRail, type ProgressRailState } from "@/lib/aml/caseDimensions";
import {
  ScreeningTab, RiskTab, OwnershipControlTab,
  FundingFinanceTab, TimelineTab, AuditTab,
} from "@/components/aml/CaseWorkspaceTabs";
import { AmlLoadingState } from "@/components/aml/primitives";
import {
  AmlComplianceSummary, AmlConnectedPortals, AmlContextActionPanel, AmlNextActionCard,
  AmlOutstandingItems, AmlRecentActivity, AmlServiceReadinessCard, AmlWorkspaceHeader,
  AmlWorkspaceNavigation, SECTION_LABELS,
} from "@/components/aml/workspace";
import { useAmlCaseSummary } from "@/lib/aml/useAmlCaseSummary";
import {
  areaForSection, AREA_SECTIONS, deriveAmlConnectedPortals, isWorkspaceSection,
  WORKSPACE_SECTIONS, type AmlAttentionLevel, type AmlWorkspaceArea,
  type AmlWorkspaceSection as SectionKey,
} from "@/lib/aml/workspaceViewModel";

/**
 * Which sections a role may open. Unchanged from the previous rail:
 * Purchase & counterparty, Funding & finance and Monitoring stay behind
 * `canInvestigate`. This is a rendering decision only — the server still
 * authorises every operation those sections perform.
 */
const SECTION_VISIBILITY: Record<SectionKey, (a: { canInvestigate: boolean }) => boolean> = {
  overview: () => true,
  identity: () => true,
  ownership: () => true,
  counterparty: (a) => a.canInvestigate,
  finance: (a) => a.canInvestigate,
  documents: () => true,
  "submission-review": () => true,
  risk: () => true,
  requests: () => true,
  passport: () => true,
  monitoring: (a) => a.canInvestigate,
  timeline: () => true,
};


export default function AmlCaseWorkspace() {
  const { caseId = "" } = useParams<{ caseId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const access = useAmlAccess();
  const { caseWorkspace: workspaceEnabled, loading: flagsLoading } = useAmlV3Flags();

  const [caseRow, setCaseRow] = useState<AmlCase | null>(null);
  const [events, setEvents] = useState<AmlCaseEvent[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The selected section lives in the `section` URL parameter, so deep links
  // work, a refresh keeps the section, and browser back/forward walks the
  // sections the user visited. Overview is the unparameterised default.
  const requestedSection = searchParams.get("section");
  const section: SectionKey = isWorkspaceSection(requestedSection) ? requestedSection : "overview";
  const setSection = (next: SectionKey) => {
    if (next === section) return;
    const params = new URLSearchParams(searchParams);
    if (next === "overview") params.delete("section");
    else params.set("section", next);
    setSearchParams(params);
  };

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

  const openRequests = useMemo(
    () => requests.filter((r) => r.status === "open" || r.status === "responded"),
    [requests],
  );

  /**
   * One batched wave of existing reads, fired once per case and shared by
   * every Overview component. It replaces five self-fetching cards; the
   * passport section and the full journey map now load only when somebody
   * opens Records.
   */
  const { loading: summaryLoading, evidence, summary } = useAmlCaseSummary(
    caseRow,
    caseRow ? openRequests.length : undefined,
    {
      enabled: access.hasAnyRole && access.flagEnabled && Boolean(caseRow),
      canReadMatter: canInvestigate,
    },
  );

  const visibleSections = useMemo(
    () =>
      new Set<SectionKey>(
        WORKSPACE_SECTIONS.filter((s) => SECTION_VISIBILITY[s]({ canInvestigate })),
      ),
    [canInvestigate],
  );

  /** Advisory dots on the area rail — the ranked reading, grouped by area. */
  const areaAttention = useMemo(() => {
    const out: Partial<Record<AmlWorkspaceArea, AmlAttentionLevel>> = {};
    const rank: Record<AmlAttentionLevel, number> = {
      critical: 0, attention: 1, waiting: 2, steady: 3, none: 4,
    };
    const mark = (sectionKey: SectionKey, level: AmlAttentionLevel) => {
      const area = areaForSection(sectionKey);
      const current = out[area];
      if (!current || rank[level] < rank[current]) out[area] = level;
    };
    mark(summary.nextAction.section, summary.nextAction.attention);
    for (const item of summary.outstanding) mark(item.section, item.attention);
    return out;
  }, [summary]);

  const connectedPortals = useMemo(
    () =>
      caseRow
        ? deriveAmlConnectedPortals(caseRow, {
            grants: evidence.grants,
            assessments: evidence.assessments,
          })
        : [],
    [caseRow, evidence.grants, evidence.assessments],
  );

  // Staged rollout: while the workspace flag is off, fall back to the legacy
  // side-sheet deep link so bookmarks and shared links keep working.
  if (!flagsLoading && !workspaceEnabled) {
    return <Navigate to={`/admin/aml/cases?open=${caseId}`} replace />;
  }

  if (access.loading || flagsLoading || (loading && !caseRow)) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading the case workspace">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !caseRow) {
    return (
      <div className="mx-auto max-w-2xl">
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

  const activation = (caseRow.metadata as any)?.activation;
  const area = areaForSection(section);
  // A section the current role may not open (a stale deep link, or a role
  // change) falls back to the Overview rather than rendering nothing.
  const resolvedSection: SectionKey = visibleSections.has(section) ? section : "overview";

  return (
    <div className="space-y-5">
      {/* ── Persistent case header + five-phase macro rail ───────────── */}
      <AmlWorkspaceHeader
        caseRow={caseRow}
        macro={summary.macro}
        matterLabel={evidence.matterLabel}
      />

      {/* ── Body: area rail · section content · contextual rail ───────
          At lg (1024px laptops) the rail and the content share the row so
          the main column keeps a workable measure; the contextual rail
          joins as a sticky third column from xl and drops to a full-width
          row beneath the content below that. */}
      <div className="grid gap-5 lg:grid-cols-[212px_minmax(0,1fr)] xl:grid-cols-[212px_minmax(0,1fr)_296px]">
        <AmlWorkspaceNavigation
          section={resolvedSection}
          onSelectSection={setSection}
          visibleSections={visibleSections}
          sectionBadges={{ requests: openRequests.length }}
          areaAttention={areaAttention}
          className="lg:self-start"
        />

        <main className="min-w-0 space-y-4" aria-label={`${SECTION_LABELS[resolvedSection]} section`}>
          {resolvedSection === "overview" && (
            <>
              {/* 1 — the one dominant thing to do next. */}
              <AmlNextActionCard action={summary.nextAction} onOpenSection={setSection} />

              {/* 2 & 4 — may the service proceed, and what else is open. */}
              <div className="grid items-start gap-4 md:grid-cols-2">
                <AmlServiceReadinessCard readiness={summary.readiness} />
                <AmlOutstandingItems items={summary.outstanding} onOpenSection={setSection} />
              </div>

              {/* 3 — the evidence behind the position. */}
              <AmlComplianceSummary
                summary={summary.compliance}
                loading={summaryLoading}
                onOpenSection={setSection}
              />

              {/* 5 & 6 — recent activity, then the sharing position. */}
              <div className="grid items-start gap-4 md:grid-cols-2">
                <AmlRecentActivity events={events} onOpenTimeline={() => setSection("timeline")} />
                <AmlConnectedPortals
                  portals={connectedPortals}
                  loading={summaryLoading}
                  onOpenSharing={() => setSection("passport")}
                />
              </div>

              {activation && (
                <p className="text-xs text-muted-foreground">
                  Activated {activation.activated_at ? displayDate(activation.activated_at) : ""} —{" "}
                  {caseRow.activation_timing === "conditional_agreement"
                    ? "compliance runs under a conditional agreement; the service unlocks when the gate is approved."
                    : "the designated service trigger had occurred at activation."}
                </p>
              )}
            </>
          )}

          {resolvedSection === "identity" && (
            <div className="space-y-4">
              {/* ONE canonical identity-verification surface: per-party
                  attempts, processing state, document sightings and audited
                  biometric access. The legacy identity_checks history lives
                  in its own collapsed read-only panel below — there are no
                  two competing primary actions.

                  Identity and screening share this surface but never share a
                  meaning: they are separate panels, separate evidence and
                  separate adjudication. */}
              <VerificationSection caseId={caseRow.id} canWrite={canWrite} onChanged={load} />
              <PartyVerificationPanel caseId={caseRow.id} canWrite={canWrite} onChanged={load} />
              <PartyScreeningPanel caseId={caseRow.id} canWrite={canWrite} canAdjudicate={access.isMlro || access.roles.has("reviewer")} onChanged={load} />
              <LegacyVerificationHistoryPanel caseId={caseRow.id} />
              <ScreeningTab caseId={caseRow.id} canWrite={canInvestigate} onChanged={load} />
              {/* Consent evidence belongs with the customer, not on the
                  Overview where it competed with the next action. */}
              <ConsentEvidenceCard caseId={caseRow.id} />
            </div>
          )}

          {resolvedSection === "ownership" && (
            <OwnershipControlTab caseRow={caseRow} canWrite={canInvestigate} />
          )}

          {resolvedSection === "counterparty" && canInvestigate && (
            <PurchaseCounterpartySection caseRow={caseRow} canWrite={canWrite} />
          )}
          {resolvedSection === "finance" && canInvestigate && <FundingFinanceTab caseId={caseRow.id} />}
          {resolvedSection === "documents" && (
            <DocumentsEvidenceSection caseId={caseRow.id} canWrite={canWrite} onChanged={load} />
          )}
          {resolvedSection === "submission-review" && (
            <SubmissionReviewPanel
              caseId={caseRow.id}
              canWrite={canWrite}
              canDecide={access.isMlro || access.roles.has("reviewer")}
              onChanged={load}
            />
          )}

          {resolvedSection === "risk" && (
            <RiskTab caseId={caseRow.id} canWrite={canWrite} onChanged={load} />
          )}

          {resolvedSection === "requests" && (
            <RequestsSection
              caseId={caseRow.id}
              requests={requests}
              canWrite={canWrite}
              onChanged={load}
            />
          )}
          {resolvedSection === "passport" && (
            <div className="space-y-4">
              {/* The full journey map keeps its place in the product — it
                  now sits where sharing is worked on rather than at the top
                  of every case. */}
              <ComplianceJourneyMap caseRow={caseRow} />
              <ReliancePassportSection caseId={caseRow.id} isMlro={access.isMlro} />
            </div>
          )}
          {resolvedSection === "monitoring" && canInvestigate && (
            <MonitoringReviewsSection
              caseId={caseRow.id}
              canWrite={canWrite}
              isReviewer={access.roles.has("reviewer") || access.isMlro}
              onChanged={load}
            />
          )}
          {resolvedSection === "timeline" && (
            <div className="space-y-4">
              {/* The canonical fourteen-step rail, in full. The five-phase
                  header rail is a map over this; this is the territory. */}
              <DetailedProcessRail caseRow={caseRow} />
              <TimelineTab caseId={caseRow.id} events={events} canInvestigate={canInvestigate} />
              <AuditTab events={events} />
            </div>
          )}
        </main>

        <aside
          className="space-y-4 lg:col-span-2 xl:col-span-1 xl:sticky xl:top-4 xl:self-start"
          aria-label="Case actions"
        >
          <AmlContextActionPanel
            caseRow={caseRow}
            section={resolvedSection}
            nextAction={summary.nextAction}
            readiness={summary.readiness}
            outstanding={summary.outstanding}
            visibleSections={visibleSections}
            canWrite={canWrite}
            isMlro={access.isMlro}
            onChanged={load}
            onOpenSection={setSection}
          />
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The canonical fourteen-step process rail (Records → Timeline)       */
/* ------------------------------------------------------------------ */

const RAIL_STATE_META: Record<ProgressRailState, { icon: typeof Circle; className: string; label: string }> = {
  complete: { icon: CheckCircle2, className: "text-success", label: "complete" },
  in_progress: { icon: CircleDot, className: "text-primary", label: "in progress" },
  not_started: { icon: Circle, className: "text-muted-foreground/50", label: "not started" },
  attention_required: { icon: AlertTriangle, className: "text-warning", label: "needs attention" },
  blocked: { icon: Lock, className: "text-destructive", label: "blocked" },
  not_applicable: { icon: Minus, className: "text-muted-foreground/40", label: "not applicable" },
};

/**
 * The detailed rail the header used to carry. Nothing was removed from it:
 * it moved to where an operator goes for the full history, and the header
 * now carries the five-phase reading derived from the same canonical state.
 */
function DetailedProcessRail({ caseRow }: { caseRow: AmlCase }) {
  const rail = progressRail(caseRow);
  const complete = rail.filter((s) => s.state === "complete").length;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-sm">Detailed process</CardTitle>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {complete} of {rail.length} steps complete
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Case process steps">
          {rail.map((step) => {
            const meta = RAIL_STATE_META[step.state];
            const Icon = meta.icon;
            return (
              <li key={step.key} className="flex items-center gap-2 text-xs">
                <Icon aria-hidden className={`h-3.5 w-3.5 shrink-0 ${meta.className}`} />
                <span className={step.state === "not_started" ? "text-muted-foreground/70" : ""}>
                  {step.label}
                </span>
                <span className="sr-only">— {meta.label}</span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}


/**
 * Confirmation, in the command centre, that the client accepted the
 * AUSTRAC-referenced consents — and evidence of which wording they saw.
 * The hash ties each acceptance to the exact document revision presented,
 * so this stands up as evidence even after the catalogue is republished.
 */
function ConsentEvidenceCard({ caseId }: { caseId: string }) {
  const [state, setState] = useState<Awaited<ReturnType<typeof amlCasesApi.consentStatus>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    amlCasesApi.consentStatus(caseId)
      .then(res => { if (alive) setState(res); })
      .catch((e: any) => { if (alive) setError(e?.message ?? "Unable to load consent status."); });
    return () => { alive = false; };
  }, [caseId]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-3">
          <span>Client consents &amp; disclosures</span>
          {state && (
            <Badge variant="outline" className={state.satisfied ? "text-success" : "text-warning"}>
              {state.satisfied ? "Accepted" : "Outstanding"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {error ? (
          <p className="text-muted-foreground">{error}</p>
        ) : !state ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : state.documents.length === 0 ? (
          <p className="text-muted-foreground">
            No consent document set is currently published. The client portal will not collect
            information until one is in force.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Document set version {state.version}
              {state.history.length > 0 && ` · ${state.history.length} superseded acceptance(s) retained`}
            </p>
            <ul className="divide-y divide-border/60">
              {state.documents.map(d => (
                <li key={d.code} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <div>{d.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.acknowledgement_type === "notice" ? "Disclosure — acknowledged as read" : "Consent"}
                      {d.document_hash && ` · evidence ${d.document_hash.slice(0, 12)}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    {d.accepted_at ? (
                      <>
                        <div className="text-success">
                          {displayDateTime(d.accepted_at)}
                        </div>
                        {d.accepted_by && (
                          <div className="text-muted-foreground">{d.accepted_by}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-warning">Not yet accepted</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
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
  const { prompt, dialog } = usePromptDialog();

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
    let reason: string | undefined;
    if (decision === "rejected") {
      const values = await prompt({
        title: "Reject this document",
        description: "The client sees this wording, so explain plainly what is wrong and what to send instead.",
        confirmLabel: "Reject document",
        destructive: true,
        fields: [{
          name: "reason", label: "Reason shown to the client", type: "textarea",
          required: true, minLength: 10,
          placeholder: "e.g. The bank statement is missing the first page — please upload all pages.",
        }],
      });
      if (!values) return;
      reason = values.reason;
    }
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
    return <AmlLoadingState variant="spinner" label="Loading this section…" />;
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
                      {r.due_at ? ` · due ${displayDate(r.due_at)}` : ""}
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
                      Uploaded {displayDateTime(d.uploaded_at)}
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
                      {displayDate(e.created_at)}
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
      {dialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Monitoring & Reviews (Phase 10, §12.9 + §18)                        */
/* ------------------------------------------------------------------ */

const TRIGGER_OPTIONS: Array<{ value: AmlReviewTriggerKind; label: string }> = [
  { value: "risk_increase", label: "Risk rating increased" },
  { value: "screening_match", label: "New screening match" },
  { value: "adverse_media", label: "Adverse media identified" },
  { value: "ownership_change", label: "Ownership or control changed" },
  { value: "transaction_change", label: "Material transaction change" },
  { value: "counterparty_uncooperative", label: "Counterparty uncooperative" },
  { value: "client_circumstances", label: "Client circumstances changed" },
  { value: "other", label: "Other trigger" },
];

const REVIEW_CLASSIFICATION_LABELS: Record<string, string> = {
  periodic: "Periodic review",
  trigger_based: "Trigger review",
  pre_commencement: "Pre-commencement review",
};

function MonitoringReviewsSection({
  caseId, canWrite, isReviewer, onChanged,
}: { caseId: string; canWrite: boolean; isReviewer: boolean; onChanged: () => void }) {
  const [monitoring, setMonitoring] = useState<AmlCaseMonitoring | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [triggerKind, setTriggerKind] = useState<AmlReviewTriggerKind>("risk_increase");
  const [triggerDetail, setTriggerDetail] = useState("");
  const [endReason, setEndReason] = useState("");
  const [showEnd, setShowEnd] = useState(false);
  const { prompt, dialog } = usePromptDialog();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { monitoring: m } = await amlMonitoringApi.caseMonitoringSummary(caseId);
      setMonitoring(m);
    } catch {
      setMonitoring(null);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, okTitle: string) => {
    setBusy(key);
    try {
      await fn();
      toast({ title: okTitle });
      await load();
      onChanged();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const extendDeadline = async (review: AmlReview) => {
    const values = await prompt({
      title: "Extend review deadline",
      description: "The original deadline is preserved and every extension is counted on the case audit trail.",
      confirmLabel: "Extend deadline",
      fields: [
        { name: "due", label: "New deadline", type: "date", required: true,
          helpText: "Must be later than the current deadline." },
        { name: "reason", label: "Reason for the extension", type: "textarea",
          required: true, minLength: 10,
          placeholder: "Why the review cannot be completed by the current date." },
      ],
    });
    if (!values) return;
    await run(review.id, () => amlMonitoringApi.extendReviewDeadline({
      id: review.id, due_at: new Date(`${values.due}T00:00:00Z`).toISOString(), reason: values.reason,
    }), "Deadline extended");
  };

  if (loading) {
    return <AmlLoadingState variant="spinner" label="Loading this section…" />;
  }
  if (!monitoring) {
    return (
      <Card><CardContent className="py-6 text-sm text-muted-foreground">
        Monitoring information is unavailable for this case.
      </CardContent></Card>
    );
  }

  const ended = monitoring.monitoring_status === "ended";
  const paused = monitoring.monitoring_status === "paused";
  const today = new Date().toISOString();

  return (
    <div className="space-y-4">
      <Card className={ended ? "border-muted-foreground/40" : undefined}>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Ongoing monitoring</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Customer due diligence continues for as long as the business relationship lasts.
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                ended ? "border-muted-foreground/40 text-muted-foreground"
                : paused ? "border-warning/40 text-warning"
                : "border-success/40 text-success"
              }
            >
              {ended ? "Relationship ended" : paused ? "Paused" : "Active"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {ended ? (
            <>
              <Row k="Ended" v={monitoring.relationship_ended_at ? displayDate(monitoring.relationship_ended_at) : "—"} />
              {monitoring.relationship_end_reason && (
                <div className="rounded bg-muted/40 p-2 text-xs">{monitoring.relationship_end_reason}</div>
              )}
              <p className="text-xs text-muted-foreground">
                Scheduled reviews are closed and no new monitoring work will be raised.
                The full history and evidence remain on the case and stay subject to retention rules.
              </p>
            </>
          ) : (
            <>
              <Row k="Review cycle" v={`Every ${monitoring.review_interval_months} months${monitoring.risk_rating ? ` (${monitoring.risk_rating} risk)` : ""}`} />
              <Row
                k="Next periodic review"
                v={
                  monitoring.next_periodic_review_at
                    ? <span className={monitoring.next_periodic_review_at < today ? "text-warning" : ""}>
                        {displayDate(monitoring.next_periodic_review_at)}
                        {monitoring.next_periodic_review_at < today ? " · due" : ""}
                      </span>
                    : <span className="text-muted-foreground">Not scheduled</span>
                }
              />
              <Row k="Last review" v={monitoring.last_periodic_review_at ? displayDate(monitoring.last_periodic_review_at) : "—"} />
              <Row
                k="Screening refresh"
                v={
                  monitoring.rescreen_due_at
                    ? <span className={monitoring.rescreen_overdue ? "text-warning" : ""}>
                        {monitoring.rescreen_overdue ? "Overdue since " : "Due "}
                        {displayDate(monitoring.rescreen_due_at)}
                      </span>
                    : <span className="text-muted-foreground">No screening on record</span>
                }
              />
              {paused && monitoring.monitoring_status_reason && (
                <div className="rounded bg-muted/40 p-2 text-xs">Paused: {monitoring.monitoring_status_reason}</div>
              )}
              {canWrite && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {!monitoring.next_periodic_review_at && (
                    <Button size="sm" variant="outline" disabled={busy === "schedule"}
                      onClick={() => run("schedule", () => amlMonitoringApi.schedulePeriodicReview({ case_id: caseId }), "Periodic review scheduled")}>
                      Schedule periodic review
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy === "pause"}
                    onClick={async () => {
                      const values = await prompt({
                        title: paused ? "Resume ongoing monitoring" : "Pause ongoing monitoring",
                        description: paused
                          ? "Scheduled reviews and monitoring alerts start again for this case."
                          : "Scheduled reviews stay in place but no new monitoring work is raised until you resume.",
                        confirmLabel: paused ? "Resume monitoring" : "Pause monitoring",
                        fields: [{
                          name: "reason", label: "Reason", type: "textarea",
                          required: true, minLength: 10,
                          placeholder: paused ? "Why monitoring is resuming." : "Why monitoring is being paused.",
                        }],
                      });
                      if (!values) return;
                      void run("pause", () => amlMonitoringApi.setMonitoringStatus({
                        case_id: caseId, status: paused ? "active" : "paused", reason: values.reason,
                      }), paused ? "Monitoring resumed" : "Monitoring paused");
                    }}>
                    {paused ? "Resume monitoring" : "Pause monitoring"}
                  </Button>
                  {isReviewer && (
                    <Button size="sm" variant="ghost" onClick={() => setShowEnd((v) => !v)}>
                      Record relationship end
                    </Button>
                  )}
                </div>
              )}
              {showEnd && isReviewer && (
                <div className="space-y-2 rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">
                    Recording the end of the business relationship closes ongoing due diligence and
                    starts the records-retention clock. History is preserved. Outstanding enhanced
                    due diligence or alerts must be resolved first.
                  </p>
                  <Textarea
                    rows={2}
                    aria-label="Reason for ending the relationship"
                    placeholder="Reason (required, minimum 10 characters)…"
                    value={endReason}
                    onChange={(e) => setEndReason(e.target.value)}
                  />
                  <Button size="sm" variant="outline" disabled={busy === "end" || endReason.trim().length < 10}
                    onClick={() => run("end", async () => {
                      await amlMonitoringApi.endRelationship({ case_id: caseId, reason: endReason.trim() });
                      setEndReason(""); setShowEnd(false);
                    }, "Relationship end recorded")}>
                    Confirm relationship end
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">
              Reviews
              {monitoring.overdue_review_count > 0 && (
                <span className="ml-2 text-xs font-normal text-warning">
                  {monitoring.overdue_review_count} overdue
                </span>
              )}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {monitoring.open_reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews are currently open.</p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {monitoring.open_reviews.map((r) => {
                const overdue = Boolean(r.due_at && r.due_at < today);
                return (
                  <li key={r.id} className="space-y-1 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate">
                          {REVIEW_CLASSIFICATION_LABELS[r.classification] ?? r.classification}
                          {r.trigger_kind && (
                            <span className="text-muted-foreground">
                              {" "}· {TRIGGER_OPTIONS.find((t) => t.value === r.trigger_kind)?.label ?? r.trigger_kind}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {r.due_at ? `Due ${displayDate(r.due_at)}` : "No deadline"}
                          {overdue ? " · overdue" : ""}
                          {r.extension_count ? ` · extended ${r.extension_count}×` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={overdue ? "border-warning/40 text-warning" : "capitalize"}>
                          {String(r.status).replace(/_/g, " ")}
                        </Badge>
                        {canWrite && (
                          <>
                            {!r.assigned_to && (
                              <Button size="sm" variant="ghost" disabled={busy === r.id}
                                onClick={() => run(r.id, () => amlMonitoringApi.assignReview({ id: r.id }), "Review assigned to you")}>
                                Take
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => extendDeadline(r)}>
                              Extend
                            </Button>
                            <Button size="sm" variant="outline" disabled={busy === r.id}
                              onClick={async () => {
                                const values = await prompt({
                                  title: "Complete this review",
                                  description: "Completing a periodic review books the next one from the case's current risk rating.",
                                  confirmLabel: "Complete review",
                                  fields: [{
                                    name: "notes", label: "Outcome notes", type: "textarea",
                                    placeholder: "What was checked and what you concluded (optional).",
                                  }],
                                });
                                if (!values) return;
                                void run(r.id, () => amlMonitoringApi.completeReview(r.id, "no_change", "complete", values.notes || undefined), "Review completed");
                              }}>
                              Complete
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {r.extension_reason && (
                      <p className="text-xs text-muted-foreground">Extension reason: {r.extension_reason}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {canWrite && !ended && (
            <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Raise a trigger review</div>
              <div className="grid gap-2 sm:grid-cols-[240px_1fr]">
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  aria-label="Trigger type"
                  value={triggerKind}
                  onChange={(e) => setTriggerKind(e.target.value as AmlReviewTriggerKind)}
                >
                  {TRIGGER_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <Button
                  size="sm" variant="outline" className="sm:justify-self-start"
                  disabled={busy === "trigger" || triggerDetail.trim().length < 10}
                  onClick={() => run("trigger", async () => {
                    await amlMonitoringApi.recordTriggerReview({
                      case_id: caseId, trigger_kind: triggerKind, detail: triggerDetail.trim(),
                    });
                    setTriggerDetail("");
                  }, "Trigger review raised")}
                >
                  Raise review
                </Button>
              </div>
              <Textarea
                rows={2}
                aria-label="Trigger detail"
                placeholder="What changed and why it needs review (required, minimum 10 characters)…"
                value={triggerDetail}
                onChange={(e) => setTriggerDetail(e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {(monitoring.open_alerts.length > 0 || monitoring.open_edd.length > 0) && (
        <Card className="border-warning/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" /> Open monitoring work
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {monitoring.open_alerts.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">Alerts</div>
                <ul className="mt-1 space-y-1 text-xs">
                  {monitoring.open_alerts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{a.title}</span>
                      <Badge variant="outline" className="capitalize">{a.severity}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {monitoring.open_edd.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">Enhanced due diligence</div>
                <ul className="mt-1 space-y-1 text-xs">
                  {monitoring.open_edd.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{e.reason}</span>
                      <Badge variant="outline" className="capitalize">{String(e.status).replace(/_/g, " ")}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Alerts and EDD are worked on the Monitoring page; decisions there write back to this case's audit trail.
            </p>
          </CardContent>
        </Card>
      )}
      {dialog}
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
  const { prompt, dialog } = usePromptDialog();

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
    const values = await prompt({
      title: `Delay CDD for ${cp.subject_display_name}`,
      description: "Record when the outstanding due diligence must be completed and why the delay is justified.",
      confirmLabel: "Record delayed CDD",
      fields: [
        { name: "deadline", label: "Completion deadline", type: "date", required: true },
        { name: "justification", label: "Justification", type: "textarea",
          required: true, minLength: 10,
          placeholder: "Why the checks cannot be completed before proceeding." },
      ],
    });
    if (!values) return;
    setBusyCp(cp.id);
    try {
      await amlTransactionsApi.setDelayedCdd({ id: cp.id, deadline: values.deadline, justification: values.justification });
      toast({ title: "Delayed CDD recorded" });
      await load();
    } catch (e: any) {
      toast({ title: "Could not record delayed CDD", description: e.message, variant: "destructive" });
    } finally {
      setBusyCp(null);
    }
  };

  const markUncooperative = async (cp: AmlCounterpartyCase) => {
    const values = await prompt({
      title: `Mark ${cp.subject_display_name} uncooperative`,
      description: "This escalates the counterparty record. At least two contact attempts must already be recorded as evidence of reasonable steps.",
      confirmLabel: "Mark uncooperative",
      destructive: true,
      fields: [{
        name: "reason", label: "Reason", type: "textarea",
        required: true, minLength: 10,
        placeholder: "What was asked for, when, and how the counterparty responded.",
      }],
    });
    if (!values) return;
    setBusyCp(cp.id);
    try {
      await amlTransactionsApi.markUncooperative({ id: cp.id, reason: values.reason });
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
    return <AmlLoadingState variant="spinner" label="Loading this section…" />;
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
                      {t.settlement_date ? `Settles ${displayDate(t.settlement_date)}` : "No settlement date"}
                      {t.original_settlement_date && t.settlement_date !== t.original_settlement_date &&
                        ` (moved from ${displayDate(t.original_settlement_date)})`}
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
                          Delayed CDD {cp.delayed_cdd_deadline < today ? "overdue" : `due ${displayDate(cp.delayed_cdd_deadline)}`}
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
      {dialog}
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
              <Input
                aria-label="Request subject"
                placeholder="Subject…"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <Textarea
              aria-label="Message shown to the client"
              placeholder="Plain-English explanation the client will see. Do not include internal reasoning…"
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
