import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ShieldAlert, Plus, RefreshCw, ShieldCheck } from "lucide-react";

import { ActivateClientDialog } from "@/components/aml/ActivateClientDialog";
import { CaseWorkspaceTabs } from "@/components/aml/CaseWorkspaceTabs";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import {
  amlCasesApi, AmlCase, AmlCaseEvent, AmlCaseStatus, AmlRiskRating,
} from "@/lib/aml/amlCasesApi";
import {
  CASE_STAGE_LABELS, caseStage, serviceGateStatus,
} from "@/lib/aml/caseDimensions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";

const STATUS_LABELS: Record<AmlCaseStatus, string> = {
  draft: "Draft", kyc_in_progress: "Onboarding in progress", kyc_complete: "Submission received",
  edd_required: "Additional information required", under_review: "Under review",
  escalated_mlro: "Awaiting decision", cleared: "Cleared", blocked: "Blocked", closed: "Closed",
};

const SUBJECT_TYPE_LABELS: Record<string, string> = {
  individual: "Individual", entity: "Entity / company", trust: "Trust",
};

/**
 * Risk rating escalates through tone *and* weight rather than four unrelated
 * hues: the two "bad" ratings share the destructive token and are separated by
 * fill strength, so `prohibited` is unmistakably the loudest pill in the table.
 * All four consume semantic tokens, so they hold up in both themes.
 */
const RISK_STYLES: Record<AmlRiskRating, string> = {
  low: "bg-success/20 text-success border-success/40",
  medium: "bg-warning/20 text-warning border-warning/40",
  high: "bg-destructive/15 text-destructive border-destructive/40",
  prohibited: "border-destructive bg-destructive text-destructive-foreground",
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

/**
 * Saved views (directive §10.3): one-click presets over the register filters.
 */
const SAVED_VIEWS: Array<{
  key: string; label: string;
  filters: { status?: string; risk?: string; assignedToMe?: boolean };
}> = [
  { key: "all", label: "All open", filters: {} },
  { key: "my_queue", label: "My queue", filters: { assignedToMe: true } },
  { key: "awaiting_review", label: "Awaiting review", filters: { status: "kyc_complete" } },
  { key: "additional_info", label: "Additional information", filters: { status: "edd_required" } },
  { key: "awaiting_decision", label: "Awaiting decision", filters: { status: "escalated_mlro" } },
  { key: "high_risk", label: "High risk", filters: { risk: "high" } },
  { key: "cleared", label: "Cleared", filters: { status: "cleared" } },
  { key: "closed", label: "Closed", filters: { status: "closed" } },
];

export default function AmlCasesPage() {
  const access = useAmlAccess();
  const navigate = useNavigate();
  const { caseWorkspace: fullPageWorkspace } = useAmlV3Flags();
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("all");
  const [risk, setRisk] = useState<string>("all");
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  // Route-based activation handoff: /admin/aml/cases?activateClientId=<id>.
  // Only the client ID travels in the URL — the dialog loads the name and
  // active status server-side from the authoritative record.
  const [activateClientId, setActivateClientId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialTab, setInitialTab] = useState<string | undefined>(undefined);
  const [searchParams, setSearchParams] = useSearchParams();

  const applyView = (key: string) => {
    const v = SAVED_VIEWS.find((s) => s.key === key);
    if (!v) return;
    setView(key);
    setStatus(v.filters.status ?? "all");
    setRisk(v.filters.risk ?? "all");
    setAssignedToMe(Boolean(v.filters.assignedToMe));
  };

  const openCase = (c: AmlCase) => {
    if (fullPageWorkspace) navigate(`/admin/aml/cases/${c.id}`);
    else setActiveId(c.id);
  };

  // Phase 12 · deep-link support from legacy alias banner: /admin/aml/cases?open=<id>&tab=<hint>
  useEffect(() => {
    const openId = searchParams.get("open");
    const tab = searchParams.get("tab") ?? undefined;
    if (openId) {
      setActiveId(openId);
      setInitialTab(tab);
      // Clear query so refresh doesn't reopen sheet unexpectedly.
      const next = new URLSearchParams(searchParams);
      next.delete("open");
      next.delete("tab");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Activation handoff from the client record: ?activateClientId=<client-id>
  // opens the activation dialog preselected on that exact client. The server
  // validates the ID and supplies name/status; an invalid or inaccessible ID
  // surfaces as a clear error inside the dialog rather than a silent no-op.
  useEffect(() => {
    const activateId = searchParams.get("activateClientId");
    if (activateId) {
      setActivateClientId(activateId);
      setActivateOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearActivateParam = () => {
    const next = new URLSearchParams(searchParams);
    if (next.has("activateClientId")) {
      next.delete("activateClientId");
      setSearchParams(next, { replace: true });
    }
  };


  const load = async () => {
    setLoading(true);
    try {
      const res = await amlCasesApi.list({
        status: status !== "all" ? (status as AmlCaseStatus) : undefined,
        risk: risk !== "all" ? (risk as AmlRiskRating) : undefined,
        assigned_to_me: assignedToMe || undefined,
        search: search || undefined,
        limit: 100,
      });
      setCases(res.cases);
      setTotal(res.total);
    } catch (e: any) {
      toast({ title: "Failed to load cases", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (access.hasAnyRole && access.flagEnabled) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.hasAnyRole, access.flagEnabled, status, risk, assignedToMe]);

  if (access.loading) {
    return <div className="flex items-center justify-center h-64">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>;
  }

  if (!access.flagEnabled) {
    return <EmptyGate
      title="AML/CTF is not enabled"
      body="The AML/CTF module isn't switched on for your organisation yet. Contact your administrator to enable it."
    />;
  }

  if (!access.hasAnyRole) {
    return <EmptyGate
      title="You don't have access to AML cases yet"
      body="Ask your compliance administrator to grant you AML access. The case register appears automatically once access is granted."
    />;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">AML / CTF Cases</h1>
          <p className="text-sm text-muted-foreground">
            {total} case{total === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          {access.canWrite && (
            <Button
              size="sm"
              onClick={() => { setActivateClientId(null); setActivateOpen(true); }}
            >
              <ShieldCheck className="h-4 w-4 mr-2" /> Activate client
            </Button>
          )}
          {/* Manual creation is an authorised exception, not an ordinary
              pathway (directive §10.4) — MLRO only, with a recorded reason. */}
          {access.isMlro && (
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Exception case
            </Button>
          )}
        </div>
      </div>

      {/* Saved views */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Saved views">
        {SAVED_VIEWS.map((v) => (
          <Button
            key={v.key}
            size="sm"
            variant={view === v.key ? "default" : "outline"}
            className="h-7 rounded-full px-3 text-xs"
            aria-pressed={view === v.key}
            onClick={() => applyView(v.key)}
          >
            {v.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search subject or case ref…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          className="max-w-xs"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={risk} onValueChange={setRisk}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Risk" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All risk</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="prohibited">Prohibited</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Case register</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : cases.length === 0 ? (
            <div className="py-12 text-center space-y-1">
              <p className="text-sm text-muted-foreground">
                {status !== "all" || risk !== "all" || search
                  ? "No cases match the current filters. Clear a filter to widen the search."
                  : "No cases yet. Open a client's record and choose Start Client Compliance, or use Activate client above."}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop: commercial data table (directive §10.1) */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client / subject</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Service gate</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cases.map((c) => {
                      const gate = serviceGateStatus(c);
                      return (
                        <TableRow
                          key={c.id}
                          tabIndex={0}
                          role="link"
                          aria-label={`Open case ${c.case_reference} for ${c.subject_display_name}`}
                          className="cursor-pointer"
                          onClick={() => openCase(c)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCase(c); }
                          }}
                        >
                          <TableCell className="font-medium">{c.subject_display_name}</TableCell>
                          <TableCell className="text-muted-foreground">{c.case_reference}</TableCell>
                          <TableCell>{SUBJECT_TYPE_LABELS[c.subject_type] ?? c.subject_type}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{CASE_STAGE_LABELS[caseStage(c)]}</Badge>
                          </TableCell>
                          <TableCell>
                            {c.risk_rating ? (
                              <Badge variant="outline" className={RISK_STYLES[c.risk_rating]}>
                                {c.risk_rating.toUpperCase()}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Unrated</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs capitalize text-muted-foreground">
                            {gate.replace(/_/g, " ")}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(c.updated_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: responsive cards (directive §6.2) */}
              <div className="space-y-2 md:hidden">
                {cases.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openCase(c)}
                    className="w-full text-left flex flex-wrap items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent transition"
                  >
                    <div className="flex-1 min-w-[200px]">
                      <div className="font-medium">{c.subject_display_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.case_reference} · {SUBJECT_TYPE_LABELS[c.subject_type] ?? c.subject_type} · opened {new Date(c.opened_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge variant="outline">{CASE_STAGE_LABELS[caseStage(c)]}</Badge>
                    {c.risk_rating && (
                      <Badge variant="outline" className={RISK_STYLES[c.risk_rating]}>
                        {c.risk_rating.toUpperCase()}
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <CreateCaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(c) => { setCreateOpen(false); load(); openCase(c); }}
      />

      <ActivateClientDialog
        open={activateOpen}
        onOpenChange={(o) => {
          setActivateOpen(o);
          if (!o) {
            setActivateClientId(null);
            clearActivateParam();
          }
        }}
        clientId={activateClientId ?? undefined}
        onActivated={(c) => {
          clearActivateParam();
          setActivateClientId(null);
          load();
          openCase(c);
        }}
      />

      <CaseDetailSheet
        caseId={activeId}
        initialTab={initialTab}
        onClose={() => { setActiveId(null); setInitialTab(undefined); }}
        onChanged={load}
        canWrite={access.canWrite}
        canInvestigate={access.canWrite}
      />

    </div>
  );
}

function EmptyGate({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-8 max-w-xl mx-auto text-center">
      <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

/**
 * Authorised-exception case creation (directive §10.4). MLRO only. The
 * ordinary production pathway is client activation; this dialog exists for
 * migrations, legacy remediation, regulator-directed cases and approved
 * testing, and every use records category, authority and reason.
 */
function CreateCaseDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: AmlCase) => void }) {
  const [subject, setSubject] = useState("");
  const [subjectType, setSubjectType] = useState<"individual" | "entity" | "trust">("individual");
  const [risk, setRisk] = useState<string>("none");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState<"data_migration" | "legacy_remediation" | "regulator_directed" | "approved_testing">("data_migration");
  const [authority, setAuthority] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setSubject(""); setSubjectType("individual"); setRisk("none"); setNotes("");
    setCategory("data_migration"); setAuthority(""); setReason("");
  };

  const canSubmit = subject.trim() && authority.trim() && reason.trim().length >= 10;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await amlCasesApi.create({
        subject_display_name: subject.trim(),
        subject_type: subjectType,
        risk_rating: risk !== "none" ? (risk as AmlRiskRating) : undefined,
        notes: notes || undefined,
        exception: { category, reason: reason.trim(), authority: authority.trim() },
      });
      toast({ title: "Exception case opened", description: res.case.case_reference });
      reset();
      onCreated(res.case);
    } catch (e: any) {
      toast({ title: "Failed to create case", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Open case by authorised exception</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Not the ordinary pathway</AlertTitle>
            <AlertDescription className="text-xs">
              Ordinary cases open from the client record via Start Client Compliance after a
              human-confirmed activation. Use this only for data migration, legacy remediation,
              regulator-directed work or approved testing. The exception is recorded on the
              case's audit history.
            </AlertDescription>
          </Alert>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Exception type</Label>
              <Select value={category} onValueChange={(v: any) => setCategory(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="data_migration">Data migration</SelectItem>
                  <SelectItem value="legacy_remediation">Legacy remediation</SelectItem>
                  <SelectItem value="regulator_directed">Regulator directed</SelectItem>
                  <SelectItem value="approved_testing">Approved testing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Approved by</Label>
              <Input value={authority} onChange={(e) => setAuthority(e.target.value)}
                placeholder="Who authorised this exception" />
            </div>
          </div>
          <div>
            <Label>Reason (min 10 characters)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="Why this case cannot be opened through client activation" />
          </div>
          <div>
            <Label>Subject name</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Full legal name or entity" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Subject type</Label>
              <Select value={subjectType} onValueChange={(v: any) => setSubjectType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="entity">Entity / company</SelectItem>
                  <SelectItem value="trust">Trust</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Initial risk rating</Label>
              <Select value={risk} onValueChange={setRisk}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unrated</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="prohibited">Prohibited</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Opening notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !canSubmit}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Open exception case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CaseDetailSheet({
  caseId, onClose, onChanged, canWrite, canInvestigate, initialTab,
}: { caseId: string | null; onClose: () => void; onChanged: () => void; canWrite: boolean; canInvestigate: boolean; initialTab?: string }) {

  const [caseRow, setCaseRow] = useState<AmlCase | null>(null);
  const [events, setEvents] = useState<AmlCaseEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [reason, setReason] = useState("");

  const load = async (id: string) => {
    setLoading(true);
    try {
      const res = await amlCasesApi.get(id);
      setCaseRow(res.case); setEvents(res.events);
    } catch (e: any) {
      toast({ title: "Failed to load case", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (caseId) load(caseId); else { setCaseRow(null); setEvents([]); setReason(""); }
  }, [caseId]);

  const nextOptions = useMemo(
    () => (caseRow ? NEXT_STATUSES[caseRow.status] : []),
    [caseRow],
  );

  const transition = async (to: AmlCaseStatus) => {
    if (!caseRow) return;
    setTransitioning(true);
    try {
      await amlCasesApi.transition(caseRow.id, to, reason || undefined);
      toast({
        title: "Status updated",
        description: `${STATUS_LABELS[caseRow.status]} → ${STATUS_LABELS[to]}`,
      });
      setReason(""); await load(caseRow.id); onChanged();
    } catch (e: any) {
      toast({ title: "Transition failed", description: e.message, variant: "destructive" });
    } finally { setTransitioning(false); }
  };

  return (
    <Sheet open={!!caseId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle>{caseRow?.subject_display_name ?? "Case"}</SheetTitle>
          {caseRow && (
            <p className="text-xs text-muted-foreground">
              {caseRow.case_reference} · {STATUS_LABELS[caseRow.status]}
              {caseRow.risk_rating ? ` · risk ${caseRow.risk_rating.toUpperCase()}` : ""}
            </p>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1 mt-4 pr-4">
          {loading || !caseRow ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <div className="space-y-4">
              {canWrite && nextOptions.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Advance status</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <div className="flex flex-wrap gap-2">
                      {nextOptions.map((s) => (
                        <Button key={s} size="sm" variant="outline"
                          disabled={transitioning} onClick={() => transition(s)}>
                          → {STATUS_LABELS[s]}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <CaseWorkspaceTabs
                caseRow={caseRow}
                events={events}
                canWrite={canWrite}
                canInvestigate={canInvestigate}
                initialTab={initialTab}
                onChanged={() => { void load(caseRow.id); onChanged(); }}
              />

            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
