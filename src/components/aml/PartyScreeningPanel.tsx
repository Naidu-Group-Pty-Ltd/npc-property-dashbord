/**
 * Party-scoped screening orchestration.
 *
 * Screening work exists per reconciled party — not just the case subject —
 * and adjudication happens on the CANONICAL screening matches: staff inspect
 * each candidate and confirm or dismiss it individually, and the party state
 * is a projection of those resolutions. PEP determinations are recorded here
 * too, with sources and rationale. No screening detail ever reaches the
 * client or the Finance Portal.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, PlayCircle, Gavel, ShieldQuestion } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  amlCasesApi,
  type AmlPartyScreeningSubject,
  type AmlScreeningCandidateMatch,
} from "@/lib/aml/amlCasesApi";
import { displayDate } from "@/lib/aml/displayDate";
import { usePromptDialog } from "@/components/aml/usePromptDialog";

const STATE_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  not_required: "secondary", not_started: "outline", queued: "outline", processing: "outline",
  completed: "default", possible_match: "destructive", confirmed_match: "destructive",
  false_positive: "default", error: "destructive",
};

const PEP_TYPES = ["foreign", "domestic", "international_organisation"] as const;
const PEP_RELATIONSHIPS = ["self", "family_member", "close_associate"] as const;

export function PartyScreeningPanel({
  caseId, canWrite, canAdjudicate, onChanged, screeningBlocked, optionalUnavailable,
}: {
  caseId: string; canWrite: boolean; canAdjudicate: boolean; onChanged: () => void;
  /**
   * Whether an OPTIONAL run could not execute right now.
   *
   * Deliberately separate from `screeningBlocked`. A blocked required
   * screening is a compliance problem someone must fix; an unavailable
   * optional one is not a problem at all, because the case never needed it.
   * Rendering them the same way would put "provider misconfigured" in front
   * of an operator whose case is complete.
   */
  optionalUnavailable?: boolean;
  /**
   * Why screening cannot execute right now, or null when it can.
   *
   * This panel used to offer "Start screening" whatever state the provider
   * was in, so pressing it produced a red toast about simulator mode — an
   * action that could not succeed, offered as though it could. It now says
   * what is wrong instead of firing into it.
   */
  screeningBlocked?: string | null;
}) {
  const [subjects, setSubjects] = useState<AmlPartyScreeningSubject[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { prompt, dialog } = usePromptDialog();

  const load = useCallback(async () => {
    try { setSubjects((await amlCasesApi.listPartyScreening(caseId)).subjects); }
    catch { setSubjects([]); }
  }, [caseId]);
  useEffect(() => { void load(); }, [load]);

  const queue = async (id: string) => {
    setBusyId(id);
    try {
      const r = await amlCasesApi.queuePartyScreening(id);
      toast({
        title: r.skipped ? "Nothing queued" : "Screening queued",
        description: r.skipped
          ? (r.code === "already_in_progress"
            ? "This party's screening is already queued or running."
            : "This party was screened inside the freshness window.")
          : "The screening engine runs it against the official sanctions lists; candidates come back for adjudication.",
      });
      await load(); onChanged();
    } catch (e: any) {
      toast({ title: "Could not queue screening", description: e?.message, variant: "destructive" });
    } finally { setBusyId(null); }
  };

  /**
   * Run a screening the policy does not require, at the operator's choice.
   *
   * A refusal here is reported as information, never as a failure: the
   * server changes nothing when the provider cannot run, and the case is
   * not waiting on this.
   */
  const runOptional = async (id: string) => {
    setBusyId(id);
    try {
      const r = await amlCasesApi.runOptionalScreening(id);
      toast({
        title: r.ran === false ? "Optional screening did not run" : "Optional screening started",
        description: r.ran === false
          ? (r.message ?? "The provider is not ready. Nothing is blocked — this case does "
            + "not require sanctions screening.")
          : "Run at your request. The case's obligation is unchanged: sanctions screening "
            + "remains not required under policy.",
      });
      await load(); onChanged();
    } catch (e: any) {
      toast({ title: "Could not run optional screening", description: e?.message, variant: "destructive" });
    } finally { setBusyId(null); }
  };

  const adjudicate = async (
    subject: AmlPartyScreeningSubject,
    match: AmlScreeningCandidateMatch,
    outcome: "confirmed_match" | "false_positive",
  ) => {
    const values = await prompt({
      title: outcome === "confirmed_match" ? "Confirm this match" : "Dismiss as false positive",
      description: `${match.matched_name} — ${match.list_name ?? match.match_type}` +
        (match.score != null ? ` (score ${Number(match.score).toFixed(2)})` : "") +
        ". The decision is recorded against the canonical screening match on the case audit trail.",
      confirmLabel: outcome === "confirmed_match" ? "Confirm match" : "Dismiss match",
      destructive: outcome === "confirmed_match",
      fields: [
        {
          name: "note", label: "Adjudication rationale", type: "textarea",
          required: true, minLength: 5,
          placeholder: outcome === "confirmed_match"
            ? "Why this listing is the screened person."
            : "Why this listing is not the screened person.",
        },
      ],
    });
    if (!values) return;
    setBusyId(subject.id);
    try {
      await amlCasesApi.adjudicatePartyScreening(subject.id, match.id, outcome, values.note.trim());
      toast({ title: "Adjudication recorded", description: "Risk is now stale and needs recomputing." });
      await load(); onChanged();
    } catch (e: any) {
      toast({ title: "Adjudication failed", description: e?.message, variant: "destructive" });
    } finally { setBusyId(null); }
  };

  const recordPep = async (subject: AmlPartyScreeningSubject, result: "not_pep" | "pep") => {
    const values = await prompt({
      title: result === "pep" ? "Record PEP determination" : "Record not-PEP determination",
      description: `${subject.screened_name} — record how the determination was established. ` +
        "Sources and rationale become part of the case evidence and the determination has a review date.",
      confirmLabel: "Record determination",
      fields: [
        ...(result === "pep"
          ? [
            { name: "pep_type", label: "PEP category", required: true,
              helpText: "One of: foreign, domestic, international_organisation" },
            { name: "pep_relationship", label: "Relationship to the position", required: true,
              helpText: "One of: self, family_member, close_associate" },
            { name: "position_held", label: "Position / office held", required: false },
          ]
          : []),
        { name: "methods", label: "Sources and methods checked", type: "textarea" as const,
          required: true, minLength: 5,
          helpText: "One per line, e.g. \"DFAT consolidated list — screened via case screening\", \"Public register search — reference/URL\"." },
        { name: "rationale", label: "Why the conclusion is reasonable", type: "textarea" as const,
          required: true, minLength: 10 },
      ],
    });
    if (!values) return;
    if (result === "pep") {
      const t = String(values.pep_type ?? "").trim();
      const r = String(values.pep_relationship ?? "").trim();
      if (!PEP_TYPES.includes(t as (typeof PEP_TYPES)[number]) ||
          !PEP_RELATIONSHIPS.includes(r as (typeof PEP_RELATIONSHIPS)[number])) {
        toast({
          title: "Invalid PEP classification",
          description: "Category must be foreign, domestic or international_organisation; relationship must be self, family_member or close_associate.",
          variant: "destructive",
        });
        return;
      }
    }
    setBusyId(subject.id);
    try {
      await amlCasesApi.recordPepDetermination({
        case_id: caseId,
        party_screening_subject_id: subject.id,
        party_type: subject.party_type,
        party_id: subject.party_id ?? undefined,
        subject_name: subject.screened_name,
        result,
        ...(result === "pep"
          ? {
            pep_type: values.pep_type as "foreign" | "domestic" | "international_organisation",
            pep_relationship: values.pep_relationship as "self" | "family_member" | "close_associate",
            position_held: values.position_held || undefined,
          }
          : {}),
        methods: values.methods.split("\n").map((l) => l.trim()).filter(Boolean)
          .map((line) => ({ source: line })),
        rationale: values.rationale.trim(),
      });
      toast({ title: "PEP determination recorded" });
      await load(); onChanged();
    } catch (e: any) {
      toast({ title: "Could not record determination", description: e?.message, variant: "destructive" });
    } finally { setBusyId(null); }
  };

  const now = new Date().toISOString();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Party screening</CardTitle>
        <CardDescription>
          Screening work for every applicable reconciled party. Clients never see screening detail — only safe
          workflow status.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {subjects === null ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading party screening" />
        ) : subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No party screening work yet. Resolve the declared parties in Submission Review first — screening follows
            reconciliation.
          </p>
        ) : (
          <ul className="space-y-2">
            {subjects.map((s) => {
              const openMatches = (s.matches ?? []).filter((m) => m.status === "open" || m.status === "escalated");
              const pep = s.pep_determination ?? null;
              const pepReviewDue = Boolean(pep?.review_due_at && pep.review_due_at < now);
              return (
                <li key={s.id} className="border-b border-border/50 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{s.screened_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.party_type.replace(/_/g, " ")}
                        {s.last_screened_at && <> · last screened {displayDate(s.last_screened_at)}</>}
                        {s.refresh_due_at && <> · refresh due {displayDate(s.refresh_due_at)}</>}
                        {s.state === "error" && s.error_category && <> · {s.error_category.replace(/_/g, " ")}</>}
                        {s.adjudication_note && <> · adjudicated</>}
                        {s.voluntary_run_at && (
                          <> · run voluntarily{s.voluntary_run_by_label
                            ? ` by ${s.voluntary_run_by_label}` : ""} — not required under policy</>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={STATE_TONE[s.state] ?? "outline"}>{s.state.replace(/_/g, " ")}</Badge>
                      {pep ? (
                        <Badge variant={pep.result === "pep" ? "destructive" : "secondary"}>
                          {pep.result === "pep"
                            ? `PEP · ${pep.pep_type?.replace(/_/g, " ")} (${pep.pep_relationship?.replace(/_/g, " ")})`
                            : "not a PEP"}
                          {pepReviewDue && " · review due"}
                        </Badge>
                      ) : (
                        <Badge variant="outline">PEP determination outstanding</Badge>
                      )}
                      {/*
                        A subject the policy does not require gets the
                        OPTIONAL action and nothing else. No Retry, no
                        provider blocker, no "upload the sanctions list" —
                        none of those are steps towards anything, because
                        this case is not waiting on a screening.
                      */}
                      {s.state === "not_required" ? (
                        canWrite && (
                          optionalUnavailable ? (
                            <span className="text-xs text-muted-foreground">
                              Optional sanctions screening unavailable — the provider or its
                              list is not ready. Nothing is blocked.
                            </span>
                          ) : (
                            <Button
                              size="sm" variant="outline" disabled={busyId === s.id}
                              onClick={() => void runOptional(s.id)}
                            >
                              {busyId === s.id
                                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                : <PlayCircle className="mr-1.5 h-3.5 w-3.5" />}
                              Run optional sanctions screening
                            </Button>
                          )
                        )
                      ) : (
                        <>
                          {canWrite && screeningBlocked
                            && ["not_started", "error"].includes(s.state) && (
                            <span className="text-xs text-muted-foreground">{screeningBlocked}</span>
                          )}
                          {canWrite && !screeningBlocked
                            && ["not_started", "error", "completed", "false_positive"].includes(s.state) && (
                            <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => void queue(s.id)}>
                              {busyId === s.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="mr-1.5 h-3.5 w-3.5" />}
                              {["completed", "false_positive"].includes(s.state) ? "Re-screen" : s.state === "error" ? "Retry screening" : "Start screening"}
                            </Button>
                          )}
                        </>
                      )}
                      {canAdjudicate && (!pep || pepReviewDue) && (
                        <>
                          <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => void recordPep(s, "not_pep")}>
                            <ShieldQuestion className="mr-1.5 h-3.5 w-3.5" /> Not a PEP
                          </Button>
                          <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => void recordPep(s, "pep")}>
                            PEP…
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {openMatches.length > 0 && (
                    <ul className="mt-2 space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                      {openMatches.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="min-w-0">
                            <span className="font-medium">{m.matched_name}</span>
                            {" — "}{m.list_name ?? m.match_type}
                            {m.score != null && <> · score {Number(m.score).toFixed(2)}</>}
                            {m.jurisdiction && <> · {m.jurisdiction}</>}
                          </span>
                          {canAdjudicate ? (
                            <span className="flex items-center gap-1.5">
                              <Button size="sm" variant="destructive" disabled={busyId === s.id}
                                onClick={() => void adjudicate(s, m, "confirmed_match")}>
                                <Gavel className="mr-1 h-3 w-3" /> Confirm
                              </Button>
                              <Button size="sm" variant="outline" disabled={busyId === s.id}
                                onClick={() => void adjudicate(s, m, "false_positive")}>
                                Dismiss
                              </Button>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">awaiting reviewer/MLRO</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {dialog}
    </Card>
  );
}
