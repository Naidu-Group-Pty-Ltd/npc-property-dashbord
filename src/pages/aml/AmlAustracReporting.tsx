import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FileText, Loader2, PlusCircle, ShieldCheck, Send, Download, CheckCircle2, XCircle, History, AlertTriangle, CalendarClock, Check, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { RegulatoryAssuranceHeader } from "@/components/aml/RegulatoryAssuranceHeader";
import { AustracReportPathCard } from "@/components/aml/AustracReportPathCard";
import { AustracDraftGuidancePanel, AustracTippingOffNotice } from "@/components/aml/AustracDraftGuidancePanel";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import {
  AUSTRAC_OBLIGATIONS, MIN_NARRATIVE_CHARS, isCustomerReport,
  type AustracReportFacts,
} from "@/lib/aml/austracReportPath.pure";
import {
  KIND_GUIDANCE, draftClock, draftSections, draftSummary, narrativeSkeleton,
  toObligationKind, type DraftFacts, type DraftSection,
} from "@/lib/aml/austracDraftGuidance.pure";
import { displayDateTime } from "@/lib/aml/displayDate";
import {
  AmlAccessGate,
  AmlLoadingState,
  AmlPageHeader,
  AmlRefreshButton,
  AmlTableEmptyRow,
  AmlTableLoadingRow,
} from "@/components/aml/primitives";
import {
  amlReportingApi,
  type AmlReport, type AmlReportKind, type AmlReportStatus,
  type AmlReportSubmission, type AmlReportVersion, type AmlReportingSummary,
  type AmlSubmissionChannel,
} from "@/lib/aml/amlReportingApi";

const KIND_LABEL: Record<AmlReportKind, string> = {
  smr: "Suspicious Matter Report",
  ttr: "Threshold Transaction Report",
  ifti: "International Funds Transfer Instruction",
  compliance: "Compliance Report",
  annual: "Annual Compliance Report",
};
const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  in_review: "bg-primary/15 text-primary",
  awaiting_mlro: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  submitted: "bg-primary text-primary-foreground",
  acknowledged: "bg-success text-success-foreground",
  rejected: "bg-destructive/15 text-destructive",
  withdrawn: "bg-muted text-muted-foreground",
};

/**
 * One numbered section of the draft.
 *
 * The dialog is a form in four parts and deliberately NOT a wizard: a
 * suspicious matter report is often started the minute the suspicion forms
 * and finished an hour later, so gating the fields behind one another would
 * make the obligation harder to meet rather than easier. What the numbering
 * adds is the thing that was missing — where the operator is, why they are
 * being asked, and what is still owed.
 */
function DraftStep({ section, children }: { section: DraftSection; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold "
            + (section.state === "complete"
              ? "bg-success/15 text-success"
              : section.state === "optional"
                ? "bg-muted text-muted-foreground"
                : "bg-primary/15 text-primary")
          }
        >
          {section.state === "complete" ? <Check className="h-3.5 w-3.5" /> : section.n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight text-foreground">
            {section.title}
            {section.state === "optional" && (
              <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                optional
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{section.purpose}</p>
        </div>
      </div>
      <div className="space-y-3 pl-[2.125rem]">{children}</div>
    </section>
  );
}

function fmt(d: string | null | undefined) { return d ? new Date(d).toLocaleString('en-AU') : "—"; }

export default function AmlAustracReporting() {
  const { canWrite, isMlro, hasAnyRole, loading: accessLoading } = useAmlAccess();
  const { regulatoryHub } = useAmlV3Flags();

  const [summary, setSummary] = useState<AmlReportingSummary | null>(null);
  const [reports, setReports] = useState<AmlReport[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  /**
   * The customers a report can be filed against.
   *
   * `reports.case_id` has existed since the first migration and the draft
   * dialog never set it, so every report ever drafted here was filed against
   * nobody — findable from this page and from nowhere else, least of all the
   * customer's own record. The field is now asked for, and the server was
   * already writing the case event when it was given one.
   */
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<AmlReportVersion[]>([]);
  const [selectedSubs, setSelectedSubs] = useState<AmlReportSubmission[]>([]);
  const [selectedReport, setSelectedReport] = useState<AmlReport | null>(null);

  const [openDraft, setOpenDraft] = useState(false);
  const [draft, setDraft] = useState<Partial<AmlReport>>({ kind: "smr", title: "", narrative: "" });
  const [saving, setSaving] = useState(false);

  const [openSubmit, setOpenSubmit] = useState(false);
  const [submitChannel, setSubmitChannel] = useState<AmlSubmissionChannel>("austrac_online");
  const [submitRef, setSubmitRef] = useState("");
  const [submitBundlePath, setSubmitBundlePath] = useState("");
  const [submitAttest, setSubmitAttest] = useState(false);
  const [submitNotes, setSubmitNotes] = useState("");
  const [submitReport, setSubmitReport] = useState<AmlReport | null>(null);

  const [openReceipt, setOpenReceipt] = useState<AmlReportSubmission | null>(null);
  const [receiptRef, setReceiptRef] = useState("");
  const [receiptStatus, setReceiptStatus] = useState("acknowledged");
  const [receiptNotes, setReceiptNotes] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [sum, list] = await Promise.all([
        amlReportingApi.summary(),
        amlReportingApi.listReports({
          status: statusFilter === "all" ? undefined : statusFilter,
          kind: kindFilter === "all" ? undefined : kindFilter,
        }),
      ]);
      setSummary(sum); setReports(list);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load AUSTRAC reports"); }
    finally { setLoading(false); }
  };

  const loadDetail = async (id: string) => {
    try {
      const r = await amlReportingApi.getReport(id);
      setSelectedReport(r.report ?? null);
      setSelectedVersions(r.versions);
      setSelectedSubs(r.submissions);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load report detail"); }
  };

  useEffect(() => { if (hasAnyRole) load(); /* eslint-disable-next-line */ }, [statusFilter, kindFilter, hasAnyRole]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); else { setSelectedReport(null); setSelectedVersions([]); setSelectedSubs([]); } }, [selectedId]);

  useEffect(() => {
    if (!hasAnyRole) return;
    amlCasesApi.list({ limit: 200 })
      .then((r) => setCases(r.cases))
      // A report can still be drafted if the list cannot be read; the check
      // below will say it is not filed against anybody, which is true.
      .catch(() => setCases([]));
  }, [hasAnyRole]);

  const obligationAt = (draft.metadata as any)?.obligation_at ?? null;

  /**
   * The selected report as the guided path reads it.
   *
   * Assembled here rather than inside the card so the card stays pure
   * presentation over one shape, and so the lodgement reference and receipt
   * come from the SUBMISSIONS actually recorded rather than from a status
   * word that could disagree with them.
   */
  const pathFacts: AustracReportFacts | null = useMemo(() => {
    if (!selectedReport) return null;
    // A kind the obligation table does not carry gets no path rather than a
    // crash: `AUSTRAC_OBLIGATIONS[undefined]` is what the card would read.
    const kind = toObligationKind(selectedReport.kind);
    if (!kind) return null;
    const latestSub = selectedSubs[0] ?? null;
    const meta = (selectedReport.metadata ?? {}) as Record<string, any>;
    return {
      kind,
      status: selectedReport.status,
      caseId: selectedReport.case_id ?? null,
      subjectLabel: cases.find((c) => c.id === selectedReport.case_id)?.subject_display_name ?? null,
      title: selectedReport.title ?? null,
      narrative: selectedReport.narrative ?? null,
      periodStart: selectedReport.reporting_period_start ?? null,
      periodEnd: selectedReport.reporting_period_end ?? null,
      mlroSignedAt: selectedReport.mlro_signed_at ?? null,
      submittedAt: selectedReport.submitted_at ?? null,
      externalReference: latestSub?.external_reference ?? null,
      receiptReference: (latestSub as any)?.receipts?.[0]?.receipt_reference
        ?? (selectedReport.acknowledged_at ? "recorded" : null),
      obligationAt: meta.obligation_at ?? null,
      terrorismFinancing: meta.terrorism_financing === true,
    };
  }, [selectedReport, selectedSubs, cases]);

  /**
   * The draft as its guidance reads it.
   *
   * Kept as one derived shape so the numbered sections, the live deadline
   * and the panel beside them cannot disagree about the same draft — the
   * way three copies of "is the narrative long enough" would.
   */
  const draftFacts: DraftFacts = useMemo(() => ({
    kind: draft.kind ?? null,
    caseId: draft.case_id ?? null,
    title: draft.title ?? null,
    narrative: draft.narrative ?? null,
    obligationAt: obligationAt ? String(obligationAt) : null,
    terrorismFinancing: (draft.metadata as any)?.terrorism_financing === true,
    periodStart: draft.reporting_period_start ?? null,
    periodEnd: draft.reporting_period_end ?? null,
  }), [
    draft.kind, draft.case_id, draft.title, draft.narrative, obligationAt,
    draft.metadata, draft.reporting_period_start, draft.reporting_period_end,
  ]);

  /**
   * `reports.kind` accepts five values and the obligation table is keyed by
   * four — `compliance` and `annual` are one obligation under two spellings.
   * Reading the table with the raw column value returns `undefined` and
   * throws on the next property access, so every read goes through the one
   * translation and a kind it cannot place renders no clock at all.
   */
  const draftKind = toObligationKind(draft.kind ?? null);
  const draftObligation = draftKind ? AUSTRAC_OBLIGATIONS[draftKind] : null;
  const draftSectionList = useMemo(() => draftSections(draftFacts), [draftFacts]);
  const draftDeadline = useMemo(() => draftClock(draftFacts), [draftFacts]);
  const narrativeChars = (draft.narrative ?? "").trim().length;

  const startNew = () => { setDraft({ kind: "smr", title: "", narrative: "" }); setOpenDraft(true); };
  const editExisting = (r: AmlReport) => { setDraft({ ...r }); setOpenDraft(true); };

  const saveDraft = async () => {
    if (!draft.kind || !draft.title) { toast.error("Kind and title are required"); return; }
    setSaving(true);
    try {
      const saved = await amlReportingApi.upsertReport(draft);
      toast.success("Draft saved");
      setOpenDraft(false); setSelectedId(saved.id); await load();
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
    finally { setSaving(false); }
  };

  const removeReport = async (r: AmlReport) => {
    if (!confirm(`Delete draft "${r.title}"? This cannot be undone.`)) return;
    try { await amlReportingApi.deleteReport(r.id); toast.success("Draft deleted"); if (selectedId === r.id) setSelectedId(null); await load(); }
    catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
  };

  const signoff = async (r: AmlReport) => {
    if (!isMlro) return;
    try { await amlReportingApi.mlroSignoff(r.id); toast.success("MLRO sign-off recorded"); await load(); if (selectedId === r.id) await loadDetail(r.id); }
    catch (e: any) { toast.error(e?.message ?? "Sign-off failed"); }
  };
  const reject = async (r: AmlReport) => {
    if (!isMlro) return;
    const reason = prompt("Reason for rejection?"); if (!reason) return;
    try { await amlReportingApi.mlroReject(r.id, reason); toast.success("Report returned to draft"); await load(); if (selectedId === r.id) await loadDetail(r.id); }
    catch (e: any) { toast.error(e?.message ?? "Reject failed"); }
  };
  const withdraw = async (r: AmlReport) => {
    if (!isMlro) return;
    const reason = prompt("Withdrawal reason?") ?? "";
    try { await amlReportingApi.withdrawReport(r.id, reason); toast.success("Report withdrawn"); await load(); if (selectedId === r.id) await loadDetail(r.id); }
    catch (e: any) { toast.error(e?.message ?? "Withdraw failed"); }
  };

  const openSubmitFor = (r: AmlReport) => {
    setSelectedId(r.id); setSubmitReport(r);
    setSubmitChannel("austrac_online"); setSubmitRef(""); setSubmitBundlePath("");
    setSubmitAttest(false); setSubmitNotes(""); setOpenSubmit(true);
  };
  const submitNow = async () => {
    if (!selectedId) return;
    const isSmr = submitReport?.kind === "smr";
    if (!submitAttest) { toast.error("MLRO tipping-off attestation is required"); return; }
    if (!submitRef.trim() && !submitBundlePath.trim()) { toast.error("Provide an AUSTRAC reference or an export bundle path"); return; }
    if (isSmr && !submitRef.trim()) { toast.error("SMR submissions require the AUSTRAC lodgement reference"); return; }
    try {
      await amlReportingApi.submitRecord({
        report_id: selectedId, channel: submitChannel,
        external_reference: submitRef || undefined,
        export_bundle_path: submitBundlePath || undefined,
        notes: submitNotes || undefined,
        attest_no_tipping_off: true,
      });
      toast.success("Submission recorded");
      setOpenSubmit(false); await load(); await loadDetail(selectedId);
    } catch (e: any) { toast.error(e?.message ?? "Submission failed"); }
  };

  const saveReceipt = async () => {
    if (!openReceipt) return;
    if (!receiptRef) { toast.error("Receipt reference required"); return; }
    try {
      await amlReportingApi.recordReceipt({
        submission_id: openReceipt.id,
        receipt_reference: receiptRef,
        status: receiptStatus as any,
        notes: receiptNotes || undefined,
      });
      toast.success("Receipt captured");
      setOpenReceipt(null); setReceiptRef(""); setReceiptNotes("");
      if (selectedId) await loadDetail(selectedId); await load();
    } catch (e: any) { toast.error(e?.message ?? "Receipt failed"); }
  };

  const exportBundle = async (r: AmlReport) => {
    try {
      const { bundle, content_hash } = await amlReportingApi.exportBundle(r.id);
      const blob = new Blob([JSON.stringify({ ...bundle, content_hash }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `austrac-${r.kind}-${r.id}.json`; a.click();
      URL.revokeObjectURL(url);
      toast.success("Bundle exported");
    } catch (e: any) { toast.error(e?.message ?? "Export failed"); }
  };

  const tiles = useMemo(() => summary ? [
    { label: "Drafts", value: summary.draft },
    { label: "Awaiting MLRO", value: summary.awaiting_mlro },
    { label: "Approved", value: summary.approved },
    { label: "Submitted", value: summary.submitted },
    { label: "Acknowledged", value: summary.acknowledged },
    { label: "Rejected", value: summary.rejected },
  ] : [], [summary]);

  if (accessLoading) return <AmlLoadingState variant="spinner" label="Checking your access…" />;
  if (!hasAnyRole) {
    return (
      <AmlAccessGate
        title="You don't have access to the AUSTRAC Hub yet"
        body="Ask your compliance administrator to grant you AML reporting access."
      />
    );
  }

  return (
    <div className="space-y-6">
      {regulatoryHub && <RegulatoryAssuranceHeader />}
      <AmlPageHeader
        title="AUSTRAC Reporting Hub"
        description="Draft SMR, TTR, IFTI and compliance reports, capture MLRO sign-off, record submissions and receipts. Nothing auto-submits — human confirmation is required at every step."
        icon={FileText}
        actions={
          <>
            <AmlRefreshButton onClick={load} loading={loading} />
            {canWrite && <Button size="sm" onClick={startNew}><PlusCircle aria-hidden="true" className="h-4 w-4 mr-2" /> New Draft</Button>}
          </>
        }
      />

      {tiles.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {tiles.map((t) => (
            <Card key={t.label}><CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">{t.label}</div>
              <div className="text-2xl font-semibold">{t.value}</div>
            </CardContent></Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>Reports</CardTitle>
              <div className="flex gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {["draft","in_review","awaiting_mlro","approved","submitted","acknowledged","rejected","withdrawn"].map(s => (
                      <SelectItem key={s} value={s}>{s.replace(/_/g," ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={kindFilter} onValueChange={setKindFilter}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All kinds</SelectItem>
                    {Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{k.toUpperCase()} — {l.split(" ")[0]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <CardDescription>Filter, review, and act on AUSTRAC drafts and submissions.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table aria-label="AUSTRAC reports">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Kind</TableHead><TableHead scope="col">Title</TableHead>
                  <TableHead scope="col">Status</TableHead><TableHead scope="col">Updated</TableHead>
                  <TableHead scope="col" className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id} className={selectedId === r.id ? "bg-muted/40" : ""} onClick={() => setSelectedId(r.id)}>
                    <TableCell><Badge variant="outline">{r.kind.toUpperCase()}</Badge></TableCell>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell><Badge className={STATUS_TONE[r.status] ?? ""}>{r.status.replace(/_/g," ")}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(r.updated_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1 flex-wrap">
                        {canWrite && ["draft","in_review"].includes(r.status) && (
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); editExisting(r); }}>Edit</Button>
                        )}
                        {isMlro && ["draft","in_review","awaiting_mlro"].includes(r.status) && (
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); signoff(r); }}><ShieldCheck className="h-4 w-4 mr-1" /> Sign-off</Button>
                        )}
                        {isMlro && r.status === "approved" && (
                          <Button size="sm" onClick={(e) => { e.stopPropagation(); openSubmitFor(r); }}><Send className="h-4 w-4 mr-1" /> Submit</Button>
                        )}
                        {isMlro && ["approved","in_review","awaiting_mlro"].includes(r.status) && (
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); reject(r); }}><XCircle className="h-4 w-4 mr-1" /> Reject</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); exportBundle(r); }}><Download className="h-4 w-4 mr-1" /> Bundle</Button>
                        {canWrite && r.status === "draft" && (
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); removeReport(r); }} className="text-destructive">Delete</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!reports.length && loading && <AmlTableLoadingRow colSpan={5} label="Loading reports…" />}
                {!reports.length && !loading && (
                  <AmlTableEmptyRow colSpan={5}>No reports match these filters. Try clearing the status or kind filter{canWrite ? ", or start a new draft" : ""}.</AmlTableEmptyRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Detail</CardTitle>
            <CardDescription>{selectedReport ? selectedReport.title : "Select a report to view versions and submissions."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedReport && <div className="text-sm text-muted-foreground">Nothing selected.</div>}
            {/*
              The path leads, because "what now" is the question an operator
              opens a report with. The tabs below keep every existing detail
              exactly where it was.
            */}
            {selectedReport && pathFacts && (
              <AustracReportPathCard
                facts={pathFacts}
                onOpenStep={(key) => {
                  if (key === "identify" || key === "assemble") editExisting(selectedReport);
                  else if (key === "lodge") { setSubmitRef(""); setOpenSubmit(true); }
                }}
              />
            )}
            {selectedReport && (
              <Tabs defaultValue="meta">
                <TabsList className="grid grid-cols-3">
                  <TabsTrigger value="meta">Meta</TabsTrigger>
                  <TabsTrigger value="versions">Versions</TabsTrigger>
                  <TabsTrigger value="subs">Submissions</TabsTrigger>
                </TabsList>
                <TabsContent value="meta" className="space-y-2 text-sm">
                  <div><span className="text-muted-foreground">Kind:</span> <Badge variant="outline">{selectedReport.kind.toUpperCase()}</Badge></div>
                  <div><span className="text-muted-foreground">Status:</span> <Badge className={STATUS_TONE[selectedReport.status] ?? ""}>{selectedReport.status.replace(/_/g," ")}</Badge></div>
                  <div><span className="text-muted-foreground">Reference:</span> {selectedReport.reference_code ?? "—"}</div>
                  <div><span className="text-muted-foreground">MLRO signed:</span> {fmt(selectedReport.mlro_signed_at)}</div>
                  <div><span className="text-muted-foreground">Submitted:</span> {fmt(selectedReport.submitted_at)}</div>
                  <div><span className="text-muted-foreground">Acknowledged:</span> {fmt(selectedReport.acknowledged_at)}</div>
                  {selectedReport.narrative && (
                    <div className="pt-2">
                      <div className="text-xs uppercase text-muted-foreground mb-1">Narrative</div>
                      <div className="whitespace-pre-wrap text-sm">{selectedReport.narrative}</div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="versions" className="space-y-2">
                  {selectedVersions.length === 0 && <div className="text-sm text-muted-foreground">No versions.</div>}
                  {selectedVersions.map((v) => (
                    <div key={v.id} className="border rounded-md p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">v{v.version} · {v.change_note ?? "—"}</div>
                        <History className="h-3 w-3 text-muted-foreground" />
                      </div>
                      <div className="text-muted-foreground">{fmt(v.created_at)} · {v.author_label ?? "system"}</div>
                      {v.content_hash && <div className="font-mono text-[10px] break-all mt-1">{v.content_hash.slice(0, 32)}…</div>}
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="subs" className="space-y-2">
                  {selectedSubs.length === 0 && <div className="text-sm text-muted-foreground">No submissions.</div>}
                  {selectedSubs.map((s) => (
                    <div key={s.id} className="border rounded-md p-2 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{s.channel.replace(/_/g," ")} · v{s.version}</div>
                        <Badge className={STATUS_TONE[s.status] ?? ""}>{s.status}</Badge>
                      </div>
                      <div className="text-muted-foreground">{fmt(s.submitted_at)}</div>
                      {s.external_reference && <div>Ref: <span className="font-mono">{s.external_reference}</span></div>}
                      {(s.receipts ?? []).map((rec) => (
                        <div key={rec.id} className="pl-2 border-l ml-1 mt-1">
                          <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" /> {rec.receipt_reference}</div>
                          <div className="text-muted-foreground">{fmt(rec.received_at)} · {rec.status}</div>
                        </div>
                      ))}
                      {isMlro && (
                        <div className="pt-1">
                          <Button size="sm" variant="ghost" onClick={() => { setOpenReceipt(s); setReceiptRef(""); setReceiptStatus("acknowledged"); setReceiptNotes(""); }}>
                            Capture receipt
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>

      {/*
        ── The draft dialog ──────────────────────────────────────────────
        It was five boxes in a narrow modal and said nothing about why any
        of them were being asked. The fields are unchanged and so is what
        saves a draft; what is added is the reason, the order, and the
        deadline the answers produce — beside the form rather than in a
        procedure nobody has open.
      */}
      <Dialog open={openDraft} onOpenChange={setOpenDraft}>
        <DialogContent className="sm:max-w-5xl sm:max-h-[90dvh] sm:grid-rows-[auto_minmax(0,1fr)_auto] sm:overflow-hidden">
          <DialogHeader className="pr-10 text-left">
            <DialogTitle>{draft.id ? "Edit report draft" : "New AUSTRAC report draft"}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              A report is how AUSTRAC is told about something the law requires it to be told about.
              This screen assembles it and holds it on the customer's compliance file; the MLRO
              approves it, and lodgement is made in your organisation's own AUSTRAC Online account.
              Nothing here is sent to AUSTRAC.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-4 overflow-y-auto sm:pr-2">
            {draftKind && <AustracTippingOffNotice kind={draftKind} />}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
              {/* ── The form, in four numbered parts ──────────────────── */}
              <div className="space-y-6">
                <DraftStep section={draftSectionList[0]}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="draft-kind">Kind of report</Label>
                      <Select value={String(draft.kind ?? "smr")} onValueChange={(v) => setDraft((d) => ({ ...d, kind: v as AmlReportKind }))}>
                        <SelectTrigger id="draft-kind"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{k.toUpperCase()} — {l}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="draft-ref">Your reference code</Label>
                      <Input id="draft-ref" value={draft.reference_code ?? ""} onChange={(e) => setDraft((d) => ({ ...d, reference_code: e.target.value }))} placeholder="Optional — your own file reference" />
                    </div>
                  </div>

                  {/*
                    ── What starts the statutory clock ──────────────────
                    An SMR is due 3 business days after the suspicion was
                    FORMED (24 hours where it concerns terrorism financing);
                    a TTR and an IFTI 10 business days after the transaction
                    or instruction. None of those is the reporting period,
                    so the date is asked for separately and kept in
                    `metadata` — a deadline derived from the wrong date is
                    worse than no deadline at all.
                  */}
                  {draftObligation && draftObligation.businessDays !== null && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="draft-obligation-at">Obligation arose</Label>
                        <Input
                          id="draft-obligation-at"
                          type="datetime-local"
                          value={obligationAt ? String(obligationAt).slice(0, 16) : ""}
                          onChange={(e) => setDraft((d) => ({
                            ...d,
                            metadata: {
                              ...(d.metadata ?? {}),
                              obligation_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                            },
                          }))}
                        />
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {draftObligation.clockStarts.replace(/^the /, "The ")} — this is what the
                          deadline is counted from, and it is not the reporting period.
                        </p>
                      </div>
                      {draftKind === "smr" && (
                        <div className="flex items-start gap-2 sm:pt-6">
                          <Checkbox
                            id="draft-tf"
                            checked={Boolean((draft.metadata as any)?.terrorism_financing)}
                            onCheckedChange={(v) => setDraft((d) => ({
                              ...d,
                              metadata: { ...(d.metadata ?? {}), terrorism_financing: v === true },
                            }))}
                          />
                          <Label htmlFor="draft-tf" className="text-xs font-normal leading-snug">
                            The suspicion concerns terrorism financing
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              Tightens the deadline from 3 business days to 24 hours.
                            </span>
                          </Label>
                        </div>
                      )}
                    </div>
                  )}

                  {/* The deadline the answers above produce, while they are typed. */}
                  {draftDeadline?.dueAt && (
                    <div
                      className={
                        "flex items-start gap-2 rounded-md border p-2.5 "
                        + (draftDeadline.overdue
                          ? "border-destructive/40 bg-destructive/5"
                          : "border-primary/30 bg-primary/5")
                      }
                    >
                      <CalendarClock
                        aria-hidden
                        className={"mt-0.5 h-4 w-4 shrink-0 " + (draftDeadline.overdue ? "text-destructive" : "text-primary")}
                      />
                      <p className="text-[11px] leading-relaxed text-foreground/90">
                        <strong className="font-semibold">
                          {draftDeadline.overdue ? "This report is already past its window." : "Due"}
                        </strong>{" "}
                        {displayDateTime(draftDeadline.dueAt)} — {draftDeadline.window} ({draftDeadline.basis}).
                        {draftDeadline.overdue
                          ? " Lodge it and record why it was late; a late report is still a report, and the lateness is itself a matter of record."
                          : ""}
                      </p>
                    </div>
                  )}
                </DraftStep>

                {/*
                  ── Which customer this is about ──────────────────────
                  The field the dialog never had. Without it the report is
                  filed against nobody: it does not reach the customer's
                  compliance file, does not appear on their case timeline,
                  and cannot be found from their record. The server has
                  always written the case event when given a case; it was
                  never given one.
                */}
                <DraftStep section={draftSectionList[1]}>
                  {draftKind && !isCustomerReport(draftKind) ? (
                    <p className="rounded-md border border-border/70 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      Nothing to link. An annual compliance report accounts for the reporting entity's
                      own programme, so it is not filed against a customer. A matter about an individual
                      customer belongs in a suspicious matter, threshold transaction or international
                      transfer report instead.
                    </p>
                  ) : (
                    <div>
                      <Label htmlFor="draft-case">Customer</Label>
                      <Select
                        value={draft.case_id ?? "none"}
                        onValueChange={(v) => setDraft((d) => ({ ...d, case_id: v === "none" ? null : v }))}
                      >
                        <SelectTrigger id="draft-case"><SelectValue placeholder="Choose the customer this report is about" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not yet chosen</SelectItem>
                          {cases.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.subject_display_name} — {c.case_reference}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {cases.length === 0 && (
                        <p className="mt-1 text-[11px] text-warning">
                          No compliance cases could be listed. The draft can still be saved and the
                          customer linked afterwards.
                        </p>
                      )}
                    </div>
                  )}
                </DraftStep>

                <DraftStep section={draftSectionList[2]}>
                  <div>
                    <Label htmlFor="draft-title">Title</Label>
                    <Input id="draft-title" value={draft.title ?? ""} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="A short description of the matter" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <Label htmlFor="draft-narrative">Narrative</Label>
                      <span className={"text-[11px] " + (narrativeChars >= MIN_NARRATIVE_CHARS ? "text-success" : "text-muted-foreground")}>
                        {narrativeChars} / {MIN_NARRATIVE_CHARS} characters
                      </span>
                    </div>
                    <Textarea
                      id="draft-narrative"
                      rows={10}
                      value={draft.narrative ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, narrative: e.target.value }))}
                      placeholder="Set out the facts in plain language, in the order they happened."
                    />
                    {/*
                      Offered only into a narrative that is empty, and it
                      inserts the QUESTIONS rather than any answer — nothing
                      it produces can reach a lodged report as an assertion
                      nobody made.
                    */}
                    {draftKind && narrativeChars === 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => setDraft((d) => ({ ...d, narrative: narrativeSkeleton(draftKind) }))}
                      >
                        <ListChecks className="mr-2 h-3.5 w-3.5" /> Start from the questions to answer
                      </Button>
                    )}
                    {draftKind && (
                      <div className="mt-2 rounded-md border border-border/70 bg-muted/30 p-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          A narrative AUSTRAC can act on answers
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {KIND_GUIDANCE[draftKind].narrativeAsks.map((q) => (
                            <li key={q} className="text-[11px] leading-relaxed text-muted-foreground">• {q}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </DraftStep>

                <DraftStep section={draftSectionList[3]}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="draft-period-start">Period start</Label>
                      <Input id="draft-period-start" type="datetime-local" value={draft.reporting_period_start ? String(draft.reporting_period_start).slice(0, 16) : ""} onChange={(e) => setDraft((d) => ({ ...d, reporting_period_start: e.target.value ? new Date(e.target.value).toISOString() : null }))} />
                    </div>
                    <div>
                      <Label htmlFor="draft-period-end">Period end</Label>
                      <Input id="draft-period-end" type="datetime-local" value={draft.reporting_period_end ? String(draft.reporting_period_end).slice(0, 16) : ""} onChange={(e) => setDraft((d) => ({ ...d, reporting_period_end: e.target.value ? new Date(e.target.value).toISOString() : null }))} />
                    </div>
                  </div>
                </DraftStep>
              </div>

              {draftKind && (
                <AustracDraftGuidancePanel
                  kind={draftKind}
                  caseId={draft.case_id ?? null}
                  title={draft.title ?? null}
                  narrative={draft.narrative ?? null}
                />
              )}
            </div>
          </div>

          <DialogFooter className="items-center gap-2 border-t border-border/60 pt-3 sm:justify-between">
            {/*
              What is still owed, said before the operator leaves rather
              than discovered by the MLRO afterwards. It never blocks the
              save: a draft started the minute a suspicion forms is the
              behaviour the obligation wants.
            */}
            <p className="flex items-start gap-1.5 text-left text-[11px] leading-relaxed text-muted-foreground sm:mr-auto">
              {draftSectionList.some((sec) => sec.state === "outstanding")
                ? <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                : <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />}
              <span>{draftSummary(draftSectionList)}</span>
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpenDraft(false)}>Cancel</Button>
              <Button onClick={saveDraft} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save draft</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submit dialog */}
      <Dialog open={openSubmit} onOpenChange={setOpenSubmit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record AUSTRAC submission</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {submitReport?.kind === "smr" && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                SMR — tipping-off protections apply. Never disclose to the customer, related parties, or non-AML staff.
                AUSTRAC lodgement reference is mandatory before this can be marked submitted.
              </div>
            )}
            <div>
              <Label>Channel</Label>
              <Select value={submitChannel} onValueChange={(v) => setSubmitChannel(v as AmlSubmissionChannel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["austrac_online","manual_upload","api","email","other"].map(c => <SelectItem key={c} value={c}>{c.replace(/_/g," ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>AUSTRAC external reference {submitReport?.kind === "smr" ? <span className="text-destructive">*</span> : null}</Label>
              <Input value={submitRef} onChange={(e) => setSubmitRef(e.target.value)} placeholder="AUSTRAC lodgement id" />
            </div>
            <div>
              <Label>Export bundle path (optional)</Label>
              <Input value={submitBundlePath} onChange={(e) => setSubmitBundlePath(e.target.value)} placeholder="storage://aml-reports/austrac-…json" />
              <p className="text-[11px] text-muted-foreground mt-1">Provide the archived bundle URL/path if the lodgement reference is not yet available. One evidence source is mandatory.</p>
            </div>
            <div><Label>Notes</Label><Textarea rows={3} value={submitNotes} onChange={(e) => setSubmitNotes(e.target.value)} /></div>
            <div className="flex items-start gap-2 rounded-md border p-3">
              <Checkbox id="mlro-tipping-off-attestation" className="mt-0.5" checked={submitAttest} onCheckedChange={(v) => setSubmitAttest(v === true)} />
              <Label htmlFor="mlro-tipping-off-attestation" className="text-xs font-normal leading-snug">
                <strong>MLRO attestation:</strong> I confirm submission evidence has been captured and no tipping-off breach has occurred.
                This attestation is written to the immutable audit trail.
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenSubmit(false)}>Cancel</Button>
            <Button
              onClick={submitNow}
              disabled={!submitAttest || (!submitRef.trim() && !submitBundlePath.trim()) || (submitReport?.kind === "smr" && !submitRef.trim())}
            >
              <Send className="h-4 w-4 mr-2" /> Record submission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Receipt dialog */}
      <Dialog open={!!openReceipt} onOpenChange={(o) => !o && setOpenReceipt(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Capture AUSTRAC receipt</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Receipt reference</Label><Input value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} /></div>
            <div>
              <Label>Status</Label>
              <Select value={receiptStatus} onValueChange={setReceiptStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["acknowledged","queried","rejected","withdrawn","other"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea rows={3} value={receiptNotes} onChange={(e) => setReceiptNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenReceipt(null)}>Cancel</Button>
            <Button onClick={saveReceipt}><CheckCircle2 className="h-4 w-4 mr-2" /> Save receipt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
