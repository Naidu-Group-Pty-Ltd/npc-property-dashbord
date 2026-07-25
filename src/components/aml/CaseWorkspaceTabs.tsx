/**
 * Phase 4 — Case-centred Customer Compliance register.
 *
 * All KYC surfaces (Verification, Screening, Risk) collapse into tabs
 * scoped to a single case_id. Legacy top-nav pages are preserved as
 * alias routes; this component is the new default entry point.
 *
 * Guardrails (AGENTS.md §2):
 *   - Restricted counts / previews never rendered outside authorised
 *     capabilities; write actions gated by `canWrite`.
 *   - No new data model — reuses existing amlVerificationApi / amlRiskApi.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, ShieldCheck, ScanSearch, Gauge, ClipboardList, Play,
  Network, Wallet, ExternalLink, AlertTriangle, History,
  Scale, CircleDot,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  amlVerificationApi, type IdentityCheck, type ScreeningCheck,
} from "@/lib/aml/amlVerificationApi";
import {
  amlRiskApi, type AmlRiskAssessment, type AmlCaseCondition, type AmlDecision,
} from "@/lib/aml/amlRiskApi";
import { amlFinanceApi, type AmlFinanceComparison, type AmlFinanceDiscrepancy } from "@/lib/aml/amlFinanceApi";
import type { AmlCase, AmlCaseEvent } from "@/lib/aml/amlCasesApi";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";

interface Props {
  caseRow: AmlCase;
  events: AmlCaseEvent[];
  canWrite: boolean;
  canInvestigate: boolean;
  onChanged: () => void;
  initialTab?: string;
}

const KNOWN_TABS = new Set([
  "overview", "verification", "screening", "risk",
  "ownership", "finance", "timeline", "audit",
]);

export function CaseWorkspaceTabs({ caseRow, events, canWrite, canInvestigate, onChanged, initialTab }: Props) {
  const { caseWorkspace: v3Case } = useAmlV3Flags();
  const safeInitial = initialTab && KNOWN_TABS.has(initialTab) ? initialTab : "overview";
  return (
    <Tabs defaultValue={safeInitial} className="w-full">

      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview">
          <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Overview
        </TabsTrigger>
        <TabsTrigger value="verification">
          <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Verification
        </TabsTrigger>
        <TabsTrigger value="screening">
          <ScanSearch className="h-3.5 w-3.5 mr-1.5" /> Screening
        </TabsTrigger>
        <TabsTrigger value="risk">
          <Gauge className="h-3.5 w-3.5 mr-1.5" /> Risk & Decision
        </TabsTrigger>
        {v3Case && (
          <TabsTrigger value="ownership">
            <Network className="h-3.5 w-3.5 mr-1.5" /> Ownership & Control
          </TabsTrigger>
        )}
        {v3Case && canInvestigate && (
          <TabsTrigger value="finance">
            <Wallet className="h-3.5 w-3.5 mr-1.5" /> Funding & Finance
          </TabsTrigger>
        )}
        {v3Case && (
          <TabsTrigger value="timeline">
            <History className="h-3.5 w-3.5 mr-1.5" /> Timeline
          </TabsTrigger>
        )}
        <TabsTrigger value="audit">Audit</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-4">
        <OverviewTab caseRow={caseRow} />
      </TabsContent>
      <TabsContent value="verification" className="mt-4">
        <VerificationTab caseId={caseRow.id} canWrite={canWrite} onChanged={onChanged} />
      </TabsContent>
      <TabsContent value="screening" className="mt-4">
        <ScreeningTab caseId={caseRow.id} canWrite={canInvestigate} onChanged={onChanged} />
      </TabsContent>
      <TabsContent value="risk" className="mt-4">
        <RiskTab caseId={caseRow.id} canWrite={canWrite} onChanged={onChanged} />
      </TabsContent>
      {v3Case && (
        <TabsContent value="ownership" className="mt-4">
          <OwnershipControlTab caseRow={caseRow} />
        </TabsContent>
      )}
      {v3Case && canInvestigate && (
        <TabsContent value="finance" className="mt-4">
          <FundingFinanceTab caseId={caseRow.id} />
        </TabsContent>
      )}
      {v3Case && (
        <TabsContent value="timeline" className="mt-4">
          <TimelineTab caseId={caseRow.id} events={events} canInvestigate={canInvestigate} />
        </TabsContent>
      )}
      <TabsContent value="audit" className="mt-4">
        <AuditTab events={events} />
      </TabsContent>
    </Tabs>
  );
}

/* -------------------- Overview -------------------- */

function OverviewTab({ caseRow }: { caseRow: AmlCase }) {
  const activation = (caseRow as any)?.metadata?.activation;
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Case snapshot</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Row k="Reference" v={caseRow.case_reference} />
        <Row k="Subject" v={`${caseRow.subject_display_name} (${caseRow.subject_type})`} />
        <Row k="Status" v={caseRow.status} />
        <Row k="Risk" v={caseRow.risk_rating ?? "unrated"} />
        <Row k="Opened" v={new Date(caseRow.opened_at).toLocaleString()} />
        {activation ? (
          <>
            <div className="pt-2 text-xs font-semibold text-muted-foreground uppercase">
              Activation
            </div>
            <Row k="Model" v={`Model ${activation.model}`} />
            <Row k="Event" v={activation.event ?? "—"} />
            {activation.program_version && (
              <Row k="Program version" v={activation.program_version} />
            )}
            <Row k="Confirmed by" v={activation.activated_by_email ?? "—"} />
          </>
        ) : (
          <p className="text-xs text-muted-foreground pt-2">
            No activation metadata recorded (legacy case).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

/* -------------------- Verification -------------------- */

export function VerificationTab({ caseId, canWrite, onChanged }: { caseId: string; canWrite: boolean; onChanged: () => void }) {
  const [items, setItems] = useState<IdentityCheck[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setItems((await amlVerificationApi.listIdv(caseId)).identity_checks); }
    catch (e: any) { toast({ title: "Load failed", description: e.message, variant: "destructive" }); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [caseId]);

  const runIdv = async () => {
    setBusy(true);
    try {
      await amlVerificationApi.initiateIdv(caseId);
      toast({ title: "IDV initiated" });
      await load(); onChanged();
    } catch (e: any) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Identity verification</CardTitle>
        {canWrite && (
          <Button size="sm" onClick={runIdv} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            Initiate IDV
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {items === null ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No IDV checks yet for this case.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((r) => (
              <li key={r.id} className="flex items-center justify-between text-sm border-b border-border/50 py-2">
                <div>
                  <div className="font-medium">{r.subject_label}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.provider} · {r.method} · {new Date(r.requested_at).toLocaleString()}
                  </div>
                </div>
                <Badge variant="outline">{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- Screening -------------------- */

export function ScreeningTab({ caseId, canWrite, onChanged }: { caseId: string; canWrite: boolean; onChanged: () => void }) {
  const [items, setItems] = useState<ScreeningCheck[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setItems((await amlVerificationApi.listScreening(caseId)).screening_checks); }
    catch (e: any) { toast({ title: "Load failed", description: e.message, variant: "destructive" }); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [caseId]);

  const runScreen = async () => {
    setBusy(true);
    try {
      await amlVerificationApi.runScreening(caseId, ["pep", "sanctions", "adverse_media"]);
      toast({ title: "Screening initiated" });
      await load(); onChanged();
    } catch (e: any) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">PEP · Sanctions · Adverse media</CardTitle>
        {canWrite && (
          <Button size="sm" onClick={runScreen} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            Run screening
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {items === null ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No screening checks yet for this case.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm border-b border-border/50 py-2">
                <div>
                  <div className="font-medium">{s.subject_label}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.provider} · {(s.scope || []).join(", ")} · {new Date(s.requested_at).toLocaleString()}
                  </div>
                </div>
                <Badge variant="outline">{s.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- Risk & Decision -------------------- */

export function RiskTab({ caseId, canWrite, onChanged }: { caseId: string; canWrite: boolean; onChanged: () => void }) {
  const [assessments, setAssessments] = useState<AmlRiskAssessment[] | null>(null);
  const [conditions, setConditions] = useState<AmlCaseCondition[]>([]);
  const [latestDecision, setLatestDecision] = useState<AmlDecision | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [a, c, d] = await Promise.all([
        amlRiskApi.listAssessments(caseId),
        amlRiskApi.listConditions(caseId),
        amlRiskApi.latestDecision(caseId),
      ]);
      setAssessments(a.assessments); setConditions(c.conditions); setLatestDecision(d.decision);
    } catch (e: any) { toast({ title: "Load failed", description: e.message, variant: "destructive" }); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [caseId]);

  const evaluate = async () => {
    setBusy(true);
    try {
      const res = await amlRiskApi.evaluate(caseId, {});
      if (res.auto_decision) {
        toast({ title: "Auto-cleared", description: `Straight-through under policy ${res.program_version}.` });
      } else {
        toast({ title: "Risk re-evaluated", description: `Policy ${res.program_version}` });
      }
      await load(); onChanged();
    } catch (e: any) { toast({ title: "Evaluate failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const latest = assessments?.[0];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-sm">Latest risk assessment</CardTitle>
            {latest?.program_version && (
              <Badge variant="outline" className="border-primary/40 text-primary text-[10px] uppercase">
                Policy {latest.program_version}
              </Badge>
            )}
            {latest?.straight_through && (
              <Badge variant="outline" className="border-success/40 text-success text-[10px] uppercase">
                Auto-cleared
              </Badge>
            )}
          </div>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={evaluate} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null} Re-evaluate
            </Button>
          )}
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {assessments === null ? <Loader2 className="h-4 w-4 animate-spin" /> :
            !latest ? <p className="text-muted-foreground">No assessments yet.</p> :
            <>
              <Row k="Rating" v={latest.risk_rating?.toUpperCase() ?? "—"} />
              <Row k="MLTF score" v={String(latest.mltf_score)} />
              <Row k="Verification score" v={String(latest.verification_score)} />
              <Row k="Completion score" v={String(latest.completion_score)} />
              <Row k="Computed" v={new Date(latest.created_at).toLocaleString()} />
              {latest.policy_snapshot_hash && (
                <Row k="Policy hash" v={<span className="font-mono text-[11px]">{latest.policy_snapshot_hash.slice(0, 12)}…</span>} />
              )}
              {latest.triggered_holds?.length > 0 && (
                <div className="pt-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Triggered holds</div>
                  <ul className="mt-1 space-y-1">
                    {latest.triggered_holds.map((h) => (
                      <li key={h.key}>
                        <Badge variant="outline" className={h.severity === "block" ? "border-destructive/40 text-destructive" : "border-yellow-500/40 text-yellow-500"}>
                          {h.severity.toUpperCase()}
                        </Badge>{" "}
                        {h.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {latest.explanation && (latest.explanation.top_positive?.length || latest.explanation.top_neutral_missing?.length) ? (
                <div className="pt-2 border-t border-border/50">
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Why this rating</div>
                  {latest.explanation.top_positive && latest.explanation.top_positive.length > 0 && (
                    <div className="mt-1">
                      <div className="text-[11px] text-muted-foreground">Top contributors</div>
                      <ul className="mt-0.5 space-y-0.5">
                        {latest.explanation.top_positive.map((f) => (
                          <li key={f.key} className="text-xs flex justify-between gap-4">
                            <span className="truncate">{f.label}</span>
                            <span className="font-mono text-muted-foreground">+{Math.round(f.weighted)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {latest.explanation.top_neutral_missing && latest.explanation.top_neutral_missing.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[11px] text-muted-foreground">Missing inputs (scored 0)</div>
                      <ul className="mt-0.5 space-y-0.5">
                        {latest.explanation.top_neutral_missing.slice(0, 3).map((f) => (
                          <li key={f.key} className="text-xs text-muted-foreground truncate">• {f.label}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : null}
            </>}
        </CardContent>
      </Card>


      <Card>
        <CardHeader><CardTitle className="text-sm">Open conditions</CardTitle></CardHeader>
        <CardContent>
          {conditions.filter(c => c.status === "open").length === 0 ? (
            <p className="text-sm text-muted-foreground">No open conditions.</p>
          ) : (
            <ul className="space-y-2">
              {conditions.filter(c => c.status === "open").map((c) => (
                <li key={c.id} className="text-sm border-b border-border/50 py-2">
                  <div className="font-medium">{c.label}</div>
                  {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Latest decision</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {!latestDecision ? (
            <p className="text-muted-foreground">No decision recorded.</p>
          ) : (
            <>
              <Row k="Outcome" v={latestDecision.outcome} />
              <Row k="Decided" v={new Date(latestDecision.decided_at).toLocaleString()} />
              {latestDecision.rationale && (
                <div className="mt-2 rounded bg-muted/40 p-2 text-xs">{latestDecision.rationale}</div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------- Audit -------------------- */

export function AuditTab({ events }: { events: AmlCaseEvent[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Audit trail (hash-chained)</CardTitle></CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ScrollArea className="max-h-[420px] pr-3">
            <ol className="space-y-3">
              {events.map((ev) => (
                <li key={ev.id} className="border-l-2 border-border pl-3">
                  <div className="text-xs text-muted-foreground">
                    {new Date(ev.created_at).toLocaleString()} · {ev.category}
                  </div>
                  <div className="text-sm">{ev.summary}</div>
                  {ev.actor_label && (
                    <div className="text-xs text-muted-foreground">by {ev.actor_label}</div>
                  )}
                  {ev.row_hash && (
                    <div className="text-[10px] font-mono text-muted-foreground truncate">
                      hash {ev.row_hash.slice(0, 16)}…
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- Ownership & Control (V3) -------------------- */

/**
 * Directive 3 — case-scoped ownership & control summary.
 * Shows the case subject's structure classification and a deep-link
 * to the legacy Ownership & Control (formerly Structures) page. No
 * write actions here — mutations remain on the dedicated page so
 * capability + step-up rules are enforced by that surface.
 */
export function OwnershipControlTab({ caseRow }: { caseRow: AmlCase }) {
  const isEntity = caseRow.subject_type !== "individual";
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Ownership & Control</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Structures — beneficial owners, controllers and authorised representatives —
            scoped to this case subject.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/aml/counterparty">
            Open Ownership & Control
            <ExternalLink className="ml-2 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row k="Subject" v={caseRow.subject_display_name} />
        <Row k="Subject type" v={caseRow.subject_type} />
        {!isEntity ? (
          <div className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
            Individual subjects do not carry beneficial ownership or trustee structures.
            Use the Verification tab for identity evidence.
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
            Manage this subject's ownership graph on the Ownership & Control page.
            Changes there flow back to the case decision audit trail.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- Funding & Finance (V3) -------------------- */

/**
 * Directive 4 — case-scoped Funding & Finance snapshot.
 * Reuses `amlFinanceApi` so this tab shares the same comparison /
 * discrepancy engine as the standalone page. Read-only here — the
 * page owns entitlement gate + write actions.
 */
export function FundingFinanceTab({ caseId }: { caseId: string }) {
  const [loading, setLoading] = useState(true);
  const [comparisons, setComparisons] = useState<AmlFinanceComparison[]>([]);
  const [discrepancies, setDiscrepancies] = useState<AmlFinanceDiscrepancy[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [c, d] = await Promise.all([
          amlFinanceApi.listComparisons(caseId),
          amlFinanceApi.listDiscrepancies({ case_id: caseId }),
        ]);
        if (!alive) return;
        setComparisons((c as any)?.comparisons ?? (Array.isArray(c) ? c : []));
        setDiscrepancies((d as any)?.discrepancies ?? (Array.isArray(d) ? d : []));
      } catch {
        // silent — panel shows empty state
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [caseId]);

  const latest = comparisons[0] ?? null;
  const openDiscrepancies = useMemo(
    () => discrepancies.filter((d) => d.status === "open" || d.status === "under_review"),
    [discrepancies],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Funding & Finance</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Source-of-funds comparison and discrepancy queue for this case. Service
            entitlement (Model B) remains gated on the dedicated Funding & Finance page.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/aml/finance">
            Open Funding & Finance
            <ExternalLink className="ml-2 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Row k="Latest comparison" v={latest ? new Date(latest.created_at ?? "").toLocaleDateString() : "—"} />
              <Row k="Open discrepancies" v={String(openDiscrepancies.length)} />
            </div>
            {openDiscrepancies.length > 0 ? (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>
                  {openDiscrepancies.length} unresolved item{openDiscrepancies.length === 1 ? "" : "s"}.
                  Triage on the Funding & Finance page — decisions write back to this case's audit trail.
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                No open funding discrepancies for this case.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- Timeline (V3 · Directive 15) -------------------- */

type TimelineCategory = "event" | "verification" | "screening" | "risk" | "decision" | "finance";

interface TimelineEntry {
  id: string;
  at: string;
  category: TimelineCategory;
  title: string;
  detail?: string;
  badge?: string;
  hash?: string | null;
}

const CATEGORY_META: Record<TimelineCategory, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  event:        { label: "Case event",   icon: CircleDot,    className: "text-muted-foreground" },
  verification: { label: "Verification", icon: ShieldCheck,  className: "text-primary" },
  screening:    { label: "Screening",    icon: ScanSearch,   className: "text-primary" },
  risk:         { label: "Risk",         icon: Gauge,        className: "text-yellow-500" },
  decision:     { label: "Decision",     icon: Scale,        className: "text-success" },
  finance:      { label: "Finance",      icon: Wallet,       className: "text-warning" },
};

/**
 * Chronological, read-only build-out of the case lifecycle. Merges
 * hash-chained case events with verification, screening, risk, decision
 * and (if authorised) funding discrepancy artefacts into a single feed.
 *
 * Guardrails:
 *   - Reuses existing APIs; no schema or write paths introduced.
 *   - Finance category only surfaces when caller holds `aml.investigate`
 *     (tipping-off protection preserved).
 *   - No SMR / regulatory records; those remain gated on the AUSTRAC hub.
 */
export function TimelineTab({
  caseId,
  events,
  canInvestigate,
}: {
  caseId: string;
  events: AmlCaseEvent[];
  canInvestigate: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [idv, setIdv] = useState<IdentityCheck[]>([]);
  const [screen, setScreen] = useState<ScreeningCheck[]>([]);
  const [risk, setRisk] = useState<AmlRiskAssessment[]>([]);
  const [decisions, setDecisions] = useState<AmlDecision[]>([]);
  const [discrepancies, setDiscrepancies] = useState<AmlFinanceDiscrepancy[]>([]);
  const [filter, setFilter] = useState<TimelineCategory | "all">("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const promises: Promise<any>[] = [
          amlVerificationApi.listIdv(caseId).catch(() => ({ identity_checks: [] })),
          amlVerificationApi.listScreening(caseId).catch(() => ({ screening_checks: [] })),
          amlRiskApi.listAssessments(caseId).catch(() => ({ assessments: [] })),
          amlRiskApi.listDecisions?.(caseId).catch(() => ({ decisions: [] })) ??
            amlRiskApi.latestDecision(caseId).then((r) => ({ decisions: r.decision ? [r.decision] : [] })).catch(() => ({ decisions: [] })),
        ];
        if (canInvestigate) {
          promises.push(
            amlFinanceApi.listDiscrepancies({ case_id: caseId }).catch(() => ({ discrepancies: [] })),
          );
        }
        const res = await Promise.all(promises);
        if (!alive) return;
        setIdv(res[0]?.identity_checks ?? []);
        setScreen(res[1]?.screening_checks ?? []);
        setRisk(res[2]?.assessments ?? []);
        setDecisions(res[3]?.decisions ?? []);
        if (canInvestigate) setDiscrepancies(res[4]?.discrepancies ?? []);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [caseId, canInvestigate]);

  const entries: TimelineEntry[] = useMemo(() => {
    const out: TimelineEntry[] = [];
    for (const e of events) {
      out.push({
        id: `evt-${e.id}`, at: e.created_at, category: "event",
        title: e.summary || e.category, detail: e.actor_label ? `by ${e.actor_label}` : undefined,
        hash: e.row_hash ?? null,
      });
    }
    for (const r of idv) {
      out.push({
        id: `idv-${r.id}`, at: r.requested_at, category: "verification",
        title: `IDV · ${r.subject_label}`,
        detail: `${r.provider} · ${r.method}`, badge: r.status,
      });
    }
    for (const s of screen) {
      out.push({
        id: `scr-${s.id}`, at: s.requested_at, category: "screening",
        title: `Screening · ${s.subject_label}`,
        detail: `${s.provider} · ${(s.scope || []).join(", ")}`, badge: s.status,
      });
    }
    for (const a of risk) {
      out.push({
        id: `risk-${a.id}`, at: a.created_at, category: "risk",
        title: `Risk assessment · ${(a.risk_rating ?? "unrated").toString().toUpperCase()}`,
        detail: `MLTF ${a.mltf_score} · Verification ${a.verification_score} · Completion ${a.completion_score}`,
        badge: a.straight_through ? "auto-cleared" : a.program_version,
      });
    }
    for (const d of decisions) {
      out.push({
        id: `dec-${d.id}`, at: d.decided_at, category: "decision",
        title: `Decision · ${d.outcome}`, detail: d.rationale ?? undefined,
      });
    }
    for (const x of discrepancies) {
      const at = (x as any).created_at ?? (x as any).detected_at ?? new Date().toISOString();
      out.push({
        id: `fin-${x.id}`, at, category: "finance",
        title: `Funding discrepancy · ${(x as any).label ?? (x as any).kind ?? "item"}`,
        detail: (x as any).detail ?? undefined, badge: x.status,
      });
    }
    return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [events, idv, screen, risk, decisions, discrepancies]);

  const filtered = filter === "all" ? entries : entries.filter((e) => e.category === filter);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: entries.length };
    for (const e of entries) c[e.category] = (c[e.category] ?? 0) + 1;
    return c;
  }, [entries]);

  const categories: (TimelineCategory | "all")[] = [
    "all", "event", "verification", "screening", "risk", "decision",
    ...(canInvestigate ? (["finance"] as const) : []),
  ];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Case lifecycle timeline</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Chronological view of everything on this case. Read-only —
              actions remain on their respective tabs so step-up and entitlement
              gates continue to apply.
            </p>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase">{entries.length} entries</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => {
            const active = filter === c;
            const label = c === "all" ? "All" : CATEGORY_META[c].label;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(c)}
                className={
                  "text-[11px] rounded-md border px-2 py-1 transition-colors " +
                  (active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:bg-muted/40")
                }
              >
                {label} <span className="ml-1 opacity-70">{counts[c] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Assembling timeline…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-4 text-xs text-muted-foreground">
            Nothing to show for this filter yet.
          </div>
        ) : (
          <ScrollArea className="max-h-[520px] pr-3">
            <ol className="relative border-l border-border/60 pl-4 space-y-4">
              {filtered.map((entry) => {
                const meta = CATEGORY_META[entry.category];
                const Icon = meta.icon;
                return (
                  <li key={entry.id} className="relative">
                    <span
                      className={
                        "absolute -left-[22px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background border border-border " +
                        meta.className
                      }
                    >
                      <Icon className="h-2.5 w-2.5" />
                    </span>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {meta.label} · {new Date(entry.at).toLocaleString()}
                        </div>
                        <div className="text-sm font-medium">{entry.title}</div>
                        {entry.detail && (
                          <div className="text-xs text-muted-foreground">{entry.detail}</div>
                        )}
                        {entry.hash && (
                          <div className="text-[10px] font-mono text-muted-foreground truncate">
                            hash {entry.hash.slice(0, 16)}…
                          </div>
                        )}
                      </div>
                      {entry.badge && (
                        <Badge variant="outline" className="text-[10px] uppercase whitespace-nowrap">
                          {entry.badge}
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

