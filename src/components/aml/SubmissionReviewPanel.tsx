/**
 * Submission Review — the staff surface for one immutable client submission.
 *
 * Its own case-workspace section (never buried in Documents & Evidence): the
 * complete package staff need to decide, with actions separated by intent and
 * the service gate shown as read-only context because acceptance never moves
 * it.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertTriangle, CheckCircle2, FileText, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { amlCasesApi, type AmlSubmissionReview } from "@/lib/aml/amlCasesApi";
import { displayDateTime } from "@/lib/aml/displayDate";

type ActionKind = "accept" | "changes" | "document" | "clarification" | "escalate" | "supersede";

const ACTION_META: Record<ActionKind, { title: string; description: string; requiresReason: boolean; confirmLabel: string }> = {
  accept: { title: "Accept submission", description: "Records that this submission is accepted for review purposes. This does not approve the service gate.", requiresReason: false, confirmLabel: "Accept submission" },
  changes: { title: "Request changes", description: "Sends the client an actionable request and moves the case to additional information required.", requiresReason: true, confirmLabel: "Request changes" },
  document: { title: "Request a document", description: "Asks the client for a specific document. They receive a request with an upload action.", requiresReason: true, confirmLabel: "Request document" },
  clarification: { title: "Request clarification", description: "Asks the client to explain something. They receive a request with a response action.", requiresReason: true, confirmLabel: "Request clarification" },
  escalate: { title: "Escalate for review", description: "Escalates this submission for reviewer or MLRO attention.", requiresReason: true, confirmLabel: "Escalate" },
  supersede: { title: "Mark superseded", description: "Marks this submission version as superseded. Previous versions are always retained.", requiresReason: true, confirmLabel: "Mark superseded" },
};

const REVIEW_STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  submitted: "outline", under_review: "outline", changes_requested: "destructive",
  accepted: "default", escalated: "destructive", superseded: "secondary",
};

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={REVIEW_STATUS_TONE[status] ?? "outline"}>{status.replace(/_/g, " ")}</Badge>;
}

/** Render a questionnaire payload as labelled rows — never raw JSON. */
function PayloadRows({ payload }: { payload: unknown }) {
  if (!payload || typeof payload !== "object") {
    return <p className="text-sm text-muted-foreground">No answers recorded.</p>;
  }
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No answers recorded.</p>;
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{key.replace(/_/g, " ")}</dt>
          <dd className="mt-0.5 break-words text-sm">
            {Array.isArray(value)
              ? value.map((v) => String(v)).join(", ") || "—"
              : value && typeof value === "object"
                ? Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join("; ")
                : String(value ?? "—")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SubmissionReviewPanel({
  caseId, canWrite, canDecide, onChanged,
}: { caseId: string; canWrite: boolean; canDecide: boolean; onChanged: () => void }) {
  const [data, setData] = useState<AmlSubmissionReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState("");
  const [clientMessage, setClientMessage] = useState("");
  const [requirementId, setRequirementId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await amlCasesApi.getSubmissionReview(caseId, version));
    } catch (e: any) {
      setLoadError(e?.message ?? "Could not load the submission review.");
    } finally {
      setLoading(false);
    }
  }, [caseId, version]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!action || !data?.submission) return;
    const meta = ACTION_META[action];
    if (meta.requiresReason && reason.trim().length < 10) {
      toast({ title: "A reason of at least 10 characters is required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const id = data.submission.id;
      if (action === "accept") await amlCasesApi.acceptSubmission(id, reason.trim() || undefined);
      else if (action === "changes") await amlCasesApi.requestSubmissionChanges(id, reason.trim(), clientMessage.trim() || undefined);
      else if (action === "document") await amlCasesApi.requestSubmissionDocument(id, reason.trim(), requirementId || undefined, clientMessage.trim() || undefined);
      else if (action === "clarification") await amlCasesApi.requestSubmissionClarification(id, reason.trim(), clientMessage.trim() || undefined);
      else if (action === "escalate") await amlCasesApi.escalateSubmission(id, reason.trim());
      else if (action === "supersede") await amlCasesApi.supersedeSubmission(id, reason.trim());
      toast({ title: meta.title, description: "Recorded. The service gate is unchanged." });
      setAction(null); setReason(""); setClientMessage(""); setRequirementId("");
      await load(); onChanged();
    } catch (e: any) {
      toast({ title: "Action failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="space-y-3" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  }
  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load submission review</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!data?.submission) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {data?.message ?? "This client has not submitted their onboarding yet."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const s = data.submission;
  const decided = ["accepted", "superseded"].includes(s.review_status);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">
                Submission v{s.version_number} <StatusBadge status={s.review_status} />
              </CardTitle>
              <CardDescription>
                Submitted {displayDateTime(s.submitted_at)} by {s.submitted_by_type ?? "client"} ·
                questionnaire v{s.questionnaire_version ?? "—"} · consent v{s.consent_version ?? "—"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {data.versions.length > 1 && (
                <Select
                  value={String(s.version_number)}
                  onValueChange={(v) => setVersion(Number(v))}
                >
                  <SelectTrigger className="w-[150px]" aria-label="Submission version">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {data.versions.map((v) => (
                      <SelectItem key={v.id} value={String(v.version_number)}>
                        Version {v.version_number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Reload submission review">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {/* Service gate is context only — never an outcome of this screen. */}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border/60 px-2 py-1">
              Case stage: {data.case.case_stage ?? "—"}
            </span>
            <span className="rounded-md border border-border/60 px-2 py-1">
              Client-visible status: {data.case.client_portal_status ?? "—"}
            </span>
            <span className="rounded-md border border-border/60 px-2 py-1">
              Service gate (read-only): {data.case.service_gate_status ?? "—"}
            </span>
          </div>

          {data.risk.stale && (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Risk assessment is stale</AlertTitle>
              <AlertDescription>
                {data.risk.stale_reasons.map((r) => r.replace(/_/g, " ")).join(", ")}. Recompute risk before
                recording a decision.
              </AlertDescription>
            </Alert>
          )}

          {data.missing_mandatory.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Missing mandatory information</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {data.missing_mandatory.slice(0, 12).map((m) => <li key={m}>{m.replace(/:/g, ": ")}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {canWrite && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" disabled={!canDecide || decided} onClick={() => setAction("accept")}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Accept submission
              </Button>
              <Button size="sm" variant="outline" disabled={decided} onClick={() => setAction("changes")}>Request changes</Button>
              <Button size="sm" variant="outline" disabled={decided} onClick={() => setAction("document")}>Request document</Button>
              <Button size="sm" variant="outline" disabled={decided} onClick={() => setAction("clarification")}>Request clarification</Button>
              <Button size="sm" variant="outline" disabled={!canDecide || decided} onClick={() => setAction("escalate")}>Escalate</Button>
              <Button size="sm" variant="ghost" disabled={decided} onClick={() => setAction("supersede")}>Mark superseded</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Accordion type="multiple" defaultValue={["differences", "verification"]} className="space-y-2">
        <AccordionItem value="differences" className="rounded-lg border border-border/60 px-3">
          <AccordionTrigger className="text-sm">
            Changes since previous submission{" "}
            <Badge variant={data.differences_material ? "destructive" : "outline"} className="ml-2">
              {data.differences.length} {data.differences_material ? "· material" : ""}
            </Badge>
          </AccordionTrigger>
          <AccordionContent>
            {!data.previous_version ? (
              <p className="text-sm text-muted-foreground">This is the first submission.</p>
            ) : data.differences.length === 0 ? (
              <p className="text-sm text-muted-foreground">No field changes since v{data.previous_version.version_number}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Field differences from the previous submission</caption>
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-1 pr-3">Section</th>
                      <th scope="col" className="py-1 pr-3">Field</th>
                      <th scope="col" className="py-1 pr-3">Before</th>
                      <th scope="col" className="py-1">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.differences.slice(0, 60).map((d, i) => (
                      <tr key={`${d.section}-${d.field}-${i}`} className="border-t border-border/50">
                        <td className="py-1 pr-3">{d.section.replace(/_/g, " ")}</td>
                        <td className="py-1 pr-3">{d.field}</td>
                        <td className="py-1 pr-3 text-muted-foreground">{String(d.previous ?? "—")}</td>
                        <td className="py-1">{String(d.current ?? "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="consent" className="rounded-lg border border-border/60 px-3">
          <AccordionTrigger className="text-sm">Consent evidence</AccordionTrigger>
          <AccordionContent>
            {data.consent_evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">No consent records.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.consent_evidence.map((c) => (
                  <li key={`${c.kind}-${c.version}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1">
                    <span>{c.kind.replace(/_/g, " ")} · v{c.version}</span>
                    <span className="text-xs text-muted-foreground">
                      {displayDateTime(c.accepted_at)}
                      {c.document_hash && <> · hash {c.document_hash.slice(0, 12)}…</>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="answers" className="rounded-lg border border-border/60 px-3">
          <AccordionTrigger className="text-sm">Questionnaire answers</AccordionTrigger>
          <AccordionContent className="space-y-4">
            {(s.sections ?? []).map((sec) => (
              <div key={sec.section}>
                <h4 className="mb-1 text-sm font-medium">{sec.section.replace(/_/g, " ")}</h4>
                <PayloadRows payload={sec.payload} />
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="parties" className="rounded-lg border border-border/60 px-3">
          <AccordionTrigger className="text-sm">
            Related parties <Badge variant="outline" className="ml-2">{data.related_parties.length}</Badge>
          </AccordionTrigger>
          <AccordionContent>
            {data.related_parties.length === 0 ? (
              <p className="text-sm text-muted-foreground">No declared related parties for this case.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.related_parties.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1">
                    <span>{p.declared_name} · {p.declared_role}</span>
                    <span className="flex items-center gap-2 text-xs">
                      <Badge variant="outline">{p.change_kind.replace(/_/g, " ")}</Badge>
                      <Badge variant={p.resolution_status === "open" ? "destructive" : "secondary"}>
                        {p.resolution_status.replace(/_/g, " ")}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="documents" className="rounded-lg border border-border/60 px-3">
          <AccordionTrigger className="text-sm">
            Documents <Badge variant="outline" className="ml-2">{data.documents.length}</Badge>
          </AccordionTrigger>
          <AccordionContent>
            {data.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents uploaded.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.documents.map((d: any) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1">
                    <span className="min-w-0 truncate">
                      {d.filename} {d.version_number > 1 && <span className="text-xs text-muted-foreground">(v{d.version_number})</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={d.status === "accepted" ? "default" : d.status === "rejected" ? "destructive" : "outline"}>
                        {d.status}
                      </Badge>
                      {d.client_safe_rejection_reason && (
                        <span className="text-xs text-muted-foreground">client sees: {d.client_safe_rejection_reason}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="verification" className="rounded-lg border border-border/60 px-3">
          <AccordionTrigger className="text-sm">Identity verification by party</AccordionTrigger>
          <AccordionContent>
            {data.verification.length === 0 ? (
              <p className="text-sm text-muted-foreground">No verification checks recorded.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.verification.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1">
                    <span>{v.party_label ?? "Case subject"} · {v.check_type.replace(/_/g, " ")}</span>
                    <span className="flex items-center gap-2 text-xs">
                      {v.execution_mode === "simulation" && <Badge variant="secondary">Test simulation — not compliance evidence</Badge>}
                      {v.provider_error_category && <Badge variant="secondary">{v.provider_error_category.replace(/_/g, " ")} — attempt not consumed</Badge>}
                      {v.execution_mode !== "simulation" && !v.provider_error_category && (
                        <Badge variant={v.status === "passed" ? "default" : v.status === "failed" ? "destructive" : "outline"}>
                          {v.status}
                        </Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="screening" className="rounded-lg border border-border/60 px-3">
          <AccordionTrigger className="text-sm">Screening by party</AccordionTrigger>
          <AccordionContent>
            {data.screening.length === 0 ? (
              <p className="text-sm text-muted-foreground">No party screening work yet — reconcile the declared parties first.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.screening.map((sc) => (
                  <li key={sc.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1">
                    <span>{sc.screened_name} · {sc.party_type.replace(/_/g, " ")}</span>
                    <Badge variant={sc.state === "confirmed_match" ? "destructive" : sc.state === "completed" || sc.state === "false_positive" ? "default" : "outline"}>
                      {sc.state.replace(/_/g, " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="requests" className="rounded-lg border border-border/60 px-3">
          <AccordionTrigger className="text-sm">
            Open client requests <Badge variant="outline" className="ml-2">{data.open_requests.length}</Badge>
          </AccordionTrigger>
          <AccordionContent>
            {data.open_requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open requests.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.open_requests.map((r: any) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1">
                    <span>{r.subject}</span>
                    <span className="flex items-center gap-2 text-xs">
                      {r.action_code && <Badge variant="outline">{r.action_code.replace(/_/g, " ")}</Badge>}
                      <Badge variant={r.status === "open" ? "destructive" : "secondary"}>{r.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Dialog open={action !== null} onOpenChange={(open) => { if (!open) setAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action ? ACTION_META[action].title : ""}</DialogTitle>
            <DialogDescription>{action ? ACTION_META[action].description : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="review-reason">
                Internal reason {action && ACTION_META[action].requiresReason ? "(required)" : "(optional)"}
              </Label>
              <Textarea
                id="review-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Recorded on the case; not shown to the client."
                rows={3}
              />
            </div>
            {action && ["changes", "document", "clarification"].includes(action) && (
              <div className="space-y-1.5">
                <Label htmlFor="client-message">Message to the client (client-safe)</Label>
                <Textarea
                  id="client-message" value={clientMessage} onChange={(e) => setClientMessage(e.target.value)}
                  placeholder="Plain wording the client will read. No internal reasoning."
                  rows={3}
                />
              </div>
            )}
            {action === "document" && data.requirements.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="requirement">Document requirement</Label>
                <Select value={requirementId} onValueChange={setRequirementId}>
                  <SelectTrigger id="requirement"><SelectValue placeholder="Select a requirement" /></SelectTrigger>
                  <SelectContent>
                    {data.requirements.map((r: any) => (
                      <SelectItem key={r.id} value={r.id}>{r.label ?? r.code}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {action === "accept" && (
              <Alert>
                <AlertDescription>
                  Accepting records the submission as accepted. It does not approve the service gate — that stays a
                  separate authorised decision.
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {action ? ACTION_META[action].confirmLabel : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
