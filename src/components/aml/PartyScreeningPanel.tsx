/**
 * Party-scoped screening orchestration.
 *
 * Screening work exists per reconciled party — not just the case subject —
 * and a possible match must be adjudicated by a reviewer or MLRO before it
 * can become a confirmed hold. No screening detail ever reaches the client.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, PlayCircle, Gavel } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { amlCasesApi, type AmlPartyScreeningSubject } from "@/lib/aml/amlCasesApi";
import { displayDate } from "@/lib/aml/displayDate";

const STATE_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  not_required: "secondary", not_started: "outline", queued: "outline", processing: "outline",
  completed: "default", possible_match: "destructive", confirmed_match: "destructive",
  false_positive: "default", error: "destructive",
};

export function PartyScreeningPanel({
  caseId, canWrite, canAdjudicate, onChanged,
}: { caseId: string; canWrite: boolean; canAdjudicate: boolean; onChanged: () => void }) {
  const [subjects, setSubjects] = useState<AmlPartyScreeningSubject[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
        title: r.skipped ? "Already screened recently" : "Screening queued",
        description: r.skipped ? "This party was screened inside the freshness window." : undefined,
      });
      await load(); onChanged();
    } catch (e: any) {
      toast({ title: "Could not queue screening", description: e?.message, variant: "destructive" });
    } finally { setBusyId(null); }
  };

  const adjudicate = async (id: string, outcome: "confirmed_match" | "false_positive") => {
    const note = window.prompt(
      outcome === "confirmed_match"
        ? "Why is this a confirmed match? (recorded on the case)"
        : "Why is this a false positive? (recorded on the case)",
    );
    if (!note || note.trim().length < 5) {
      toast({ title: "An adjudication note of at least 5 characters is required", variant: "destructive" });
      return;
    }
    setBusyId(id);
    try {
      await amlCasesApi.adjudicatePartyScreening(id, outcome, note.trim());
      toast({ title: "Adjudication recorded", description: "Risk is now stale and needs recomputing." });
      await load(); onChanged();
    } catch (e: any) {
      toast({ title: "Adjudication failed", description: e?.message, variant: "destructive" });
    } finally { setBusyId(null); }
  };

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
            {subjects.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{s.screened_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.party_type.replaceAll("_", " ")}
                    {s.last_screened_at && <> · last screened {displayDate(s.last_screened_at)}</>}
                    {s.refresh_due_at && <> · refresh due {displayDate(s.refresh_due_at)}</>}
                    {s.adjudication_note && <> · adjudicated</>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATE_TONE[s.state] ?? "outline"}>{s.state.replaceAll("_", " ")}</Badge>
                  {canWrite && ["not_started", "error", "completed"].includes(s.state) && (
                    <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => void queue(s.id)}>
                      {busyId === s.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="mr-1.5 h-3.5 w-3.5" />}
                      {s.state === "completed" ? "Re-screen" : "Start screening"}
                    </Button>
                  )}
                  {canAdjudicate && s.state === "possible_match" && (
                    <>
                      <Button size="sm" variant="destructive" disabled={busyId === s.id} onClick={() => void adjudicate(s.id, "confirmed_match")}>
                        <Gavel className="mr-1.5 h-3.5 w-3.5" /> Confirm match
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => void adjudicate(s.id, "false_positive")}>
                        False positive
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
  );
}
