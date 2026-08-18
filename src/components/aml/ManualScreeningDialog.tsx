/**
 * Record a screening the MLRO performed by hand.
 *
 * ── What this is, and what it must never become ───────────────────────
 * This is a second EXECUTION METHOD for a screening the policy already
 * requires. It is not an exemption, it does not touch the obligation, and
 * nothing here can make a required scope `not_required` — the dialog cannot
 * even express that, because it sends no `required` flag and the server
 * derives the obligation from the recorded policy decision rather than from
 * anything a caller says.
 *
 * ── Why the evidence fields are not optional ──────────────────────────
 * "No match" is the claim that a customer does not appear on a sanctions
 * list. Recorded without the sources checked, the names searched and a
 * reason, it is indistinguishable afterwards from a screening that never
 * happened — and it would read as `clear` to every consumer of
 * `screening_checks`. So the same rule is enforced three times: here (early
 * enough to say which field is missing), in the edge function (which never
 * trusts a browser), and by a table constraint (which catches a code path
 * that forgets).
 *
 * The rule is not written three times. `planManualScreening` is the one
 * implementation, imported by both this dialog and the edge function, so the
 * button cannot enable on something the server would refuse.
 *
 * `unable_to_complete` is the honest failure state and is deliberately held
 * to a different bar: it asserts the screening could NOT be concluded, which
 * is the opposite of a claim about the customer. It carries a reason code,
 * it satisfies nothing, and the obligation stays outstanding.
 */
import { useMemo, useState } from "react";
import { ClipboardCheck, Loader2, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  amlCasesApi,
  type AmlManualOutcome,
  type AmlManualUnableReason,
  type AmlPartyScreeningSubject,
} from "@/lib/aml/amlCasesApi";
import {
  UNABLE_REASON_TEXT,
  planManualScreening,
} from "../../../supabase/functions/_shared/aml/manualScreening.pure";

const OUTCOMES: Array<{ value: AmlManualOutcome; label: string; detail: string }> = [
  {
    value: "no_match",
    label: "No match",
    detail: "The searches were performed and the party does not appear. This discharges "
      + "the screening obligation, so it carries the full evidence record.",
  },
  {
    value: "possible_match",
    label: "Possible match",
    detail: "A candidate needs adjudicating. It goes to the same reviewer/MLRO "
      + "adjudication an automated candidate goes to.",
  },
  {
    value: "confirmed_match",
    label: "Confirmed match",
    detail: "The listed party is this party. Recorded as a confirmed match on the case.",
  },
  {
    value: "unable_to_complete",
    label: "Unable to complete",
    detail: "The screening could not be concluded. Nothing is asserted about the "
      + "party and the obligation stays outstanding.",
  },
];

const SOURCE_TYPES = [
  { value: "sanctions_list", label: "Sanctions list" },
  { value: "regulator_register", label: "Regulator / government register" },
  { value: "court_record", label: "Court or tribunal record" },
  { value: "media_search", label: "Media search" },
  { value: "provider_portal", label: "Provider portal (searched by hand)" },
  { value: "other", label: "Other" },
];

const SCOPES = [
  { value: "sanctions", label: "Sanctions" },
  { value: "adverse_media", label: "Adverse media" },
  { value: "watchlist", label: "Watchlist" },
] as const;

interface SourceRow {
  source_type: string; source_name: string; source_reference: string; searched_at: string;
}
interface CandidateRow {
  matchedName: string; listName: string; jurisdiction: string; reference: string; matchBasis: string;
}

const emptySource = (): SourceRow => ({
  source_type: "sanctions_list", source_name: "", source_reference: "", searched_at: "",
});
const emptyCandidate = (): CandidateRow => ({
  matchedName: "", listName: "", jurisdiction: "", reference: "", matchBasis: "",
});

export function ManualScreeningDialog({
  subject, open, onOpenChange, onRecorded,
}: {
  subject: AmlPartyScreeningSubject;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onRecorded: () => void;
}) {
  const [scope, setScope] = useState<"sanctions" | "adverse_media" | "watchlist">("sanctions");
  const [outcome, setOutcome] = useState<AmlManualOutcome>("no_match");
  const [unableReason, setUnableReason] = useState<AmlManualUnableReason>("insufficient_identity");
  // Pre-filled with the name the case actually screens, because that is the
  // name that was almost certainly searched — and an empty field invites a
  // record that does not say which name was put to the source.
  const [names, setNames] = useState(subject.screened_name);
  const [sources, setSources] = useState<SourceRow[]>([emptySource()]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([emptyCandidate()]);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);

  const parsedNames = useMemo(
    () => names.split("\n").map((n) => n.trim()).filter(Boolean),
    [names],
  );
  const parsedSources = useMemo(
    () => sources.filter((s) => s.source_name.trim()).map((s) => ({
      source_type: s.source_type,
      source_name: s.source_name.trim(),
      source_reference: s.source_reference.trim() || null,
      searched_at: s.searched_at.trim() || null,
    })),
    [sources],
  );
  const parsedCandidates = useMemo(
    () => candidates.filter((c) => c.matchedName.trim()).map((c) => ({
      matchedName: c.matchedName.trim(),
      listName: c.listName.trim() || null,
      jurisdiction: c.jurisdiction.trim() || null,
      reference: c.reference.trim() || null,
      matchBasis: c.matchBasis.trim() || null,
    })),
    [candidates],
  );

  /*
   * The SAME decision the server will make, from the same module. When this
   * refuses, the message shown is the server's own message — so the operator
   * is never told one thing by the form and another by the response.
   */
  const plan = useMemo(() => planManualScreening({
    outcome, sources: parsedSources, searchedNames: parsedNames,
    rationale, unableReason, candidates: parsedCandidates,
  }), [outcome, parsedSources, parsedNames, rationale, unableReason, parsedCandidates]);

  const isUnable = outcome === "unable_to_complete";
  const isMatch = outcome === "possible_match" || outcome === "confirmed_match";

  const submit = async () => {
    if (!plan.ok) return;
    setBusy(true);
    try {
      const r = await amlCasesApi.recordManualScreening({
        subject_id: subject.id,
        scope,
        outcome,
        sources: parsedSources,
        searched_names: parsedNames,
        rationale,
        unable_reason: isUnable ? unableReason : null,
        candidates: isMatch ? parsedCandidates : undefined,
      });
      toast({
        title: "Manual screening recorded",
        description: r.satisfies_obligation
          ? "Recorded against the case as a completed screening, performed by you, with the "
            + "sources and rationale you gave. The obligation itself is unchanged."
          : outcome === "unable_to_complete"
            ? "Recorded as unable to complete. Nothing is asserted about this party and the "
              + "screening obligation remains outstanding."
            : "Recorded. The candidates now need adjudicating in the same workflow an "
              + "automated candidate uses.",
      });
      onRecorded();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Could not record manual screening",
        description: e?.message, variant: "destructive",
      });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a manual screening</DialogTitle>
          <DialogDescription>
            {subject.screened_name} — a screening you performed yourself, against sources you
            name. This is a different way of carrying out the screening, not a way of
            standing it down: the case's obligation is unchanged by anything recorded here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="manual-scope">What was screened</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
              <SelectTrigger id="manual-scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A PEP conclusion is recorded as a PEP determination, not here, so that there is
              only ever one answer to whether this party is a PEP.
            </p>
          </div>

          <div className="space-y-2">
            <Label>What you concluded</Label>
            <RadioGroup
              value={outcome}
              onValueChange={(v) => setOutcome(v as AmlManualOutcome)}
              className="space-y-2"
            >
              {OUTCOMES.map((o) => (
                <label
                  key={o.value}
                  htmlFor={`manual-outcome-${o.value}`}
                  className="flex cursor-pointer gap-3 rounded-md border border-border/60 p-3"
                >
                  <RadioGroupItem value={o.value} id={`manual-outcome-${o.value}`} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">{o.detail}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>

          {isUnable ? (
            <div className="space-y-2">
              <Label>Why it could not be concluded</Label>
              <RadioGroup
                value={unableReason}
                onValueChange={(v) => setUnableReason(v as AmlManualUnableReason)}
                className="space-y-2"
              >
                {(Object.keys(UNABLE_REASON_TEXT) as AmlManualUnableReason[]).map((r) => (
                  <label
                    key={r}
                    htmlFor={`manual-unable-${r}`}
                    className="flex cursor-pointer gap-3 rounded-md border border-border/60 p-3"
                  >
                    <RadioGroupItem value={r} id={`manual-unable-${r}`} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{r.replace(/_/g, " ")}</span>
                      <span className="block text-xs text-muted-foreground">
                        {UNABLE_REASON_TEXT[r]}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="manual-names">Names actually searched</Label>
                <Textarea
                  id="manual-names" rows={3} value={names}
                  onChange={(e) => setNames(e.target.value)}
                  placeholder="One per line — the legal name and any alias or transliteration searched."
                />
                <p className="text-xs text-muted-foreground">
                  {parsedNames.length} name{parsedNames.length === 1 ? "" : "s"} recorded.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Sources actually checked</Label>
                {sources.map((s, i) => (
                  <div key={i} className="grid gap-2 rounded-md border border-border/60 p-3 sm:grid-cols-2">
                    <Select
                      value={s.source_type}
                      onValueChange={(v) => setSources((prev) =>
                        prev.map((row, j) => j === i ? { ...row, source_type: v } : row))}
                    >
                      <SelectTrigger aria-label={`Source ${i + 1} type`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SOURCE_TYPES.map((t) =>
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label={`Source ${i + 1} name`}
                      placeholder="Which source, e.g. DFAT Consolidated List"
                      value={s.source_name}
                      onChange={(e) => setSources((prev) =>
                        prev.map((row, j) => j === i ? { ...row, source_name: e.target.value } : row))}
                    />
                    <Input
                      aria-label={`Source ${i + 1} reference`}
                      placeholder="Reference, URL or list version"
                      value={s.source_reference}
                      onChange={(e) => setSources((prev) =>
                        prev.map((row, j) => j === i ? { ...row, source_reference: e.target.value } : row))}
                    />
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`Source ${i + 1} searched at`}
                        placeholder="When searched (optional)"
                        value={s.searched_at}
                        onChange={(e) => setSources((prev) =>
                          prev.map((row, j) => j === i ? { ...row, searched_at: e.target.value } : row))}
                      />
                      {sources.length > 1 && (
                        <Button
                          type="button" size="icon" variant="ghost"
                          aria-label={`Remove source ${i + 1}`}
                          onClick={() => setSources((prev) => prev.filter((_, j) => j !== i))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={() => setSources((prev) => [...prev, emptySource()])}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add another source
                </Button>
              </div>
            </>
          )}

          {isMatch && (
            <div className="space-y-2">
              <Label>What matched</Label>
              {candidates.map((c, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-border/60 p-3 sm:grid-cols-2">
                  <Input
                    aria-label={`Candidate ${i + 1} listed name`}
                    placeholder="The listed name that matched"
                    value={c.matchedName}
                    onChange={(e) => setCandidates((prev) =>
                      prev.map((row, j) => j === i ? { ...row, matchedName: e.target.value } : row))}
                  />
                  <Input
                    aria-label={`Candidate ${i + 1} list`}
                    placeholder="Which list"
                    value={c.listName}
                    onChange={(e) => setCandidates((prev) =>
                      prev.map((row, j) => j === i ? { ...row, listName: e.target.value } : row))}
                  />
                  <Input
                    aria-label={`Candidate ${i + 1} jurisdiction`}
                    placeholder="Jurisdiction"
                    value={c.jurisdiction}
                    onChange={(e) => setCandidates((prev) =>
                      prev.map((row, j) => j === i ? { ...row, jurisdiction: e.target.value } : row))}
                  />
                  <Input
                    aria-label={`Candidate ${i + 1} reference`}
                    placeholder="Listing reference"
                    value={c.reference}
                    onChange={(e) => setCandidates((prev) =>
                      prev.map((row, j) => j === i ? { ...row, reference: e.target.value } : row))}
                  />
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <Input
                      aria-label={`Candidate ${i + 1} basis`}
                      placeholder="What matched — name, date of birth, address…"
                      value={c.matchBasis}
                      onChange={(e) => setCandidates((prev) =>
                        prev.map((row, j) => j === i ? { ...row, matchBasis: e.target.value } : row))}
                    />
                    {candidates.length > 1 && (
                      <Button
                        type="button" size="icon" variant="ghost"
                        aria-label={`Remove candidate ${i + 1}`}
                        onClick={() => setCandidates((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <Button
                type="button" size="sm" variant="outline"
                onClick={() => setCandidates((prev) => [...prev, emptyCandidate()])}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add another candidate
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="manual-rationale">
              {isUnable ? "What was attempted (optional)" : "Why the conclusion is reasonable"}
            </Label>
            <Textarea
              id="manual-rationale" rows={4} value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder={isUnable
                ? "What was searched, and what stopped it concluding."
                : "How the searches were run and why the result follows from them."}
            />
          </div>

          {!plan.ok && (
            <p className="text-xs text-destructive" role="status">{plan.message}</p>
          )}
          {plan.ok && (
            <p className="text-xs text-muted-foreground" role="status">
              {plan.satisfiesObligation
                ? "This will be recorded as a completed screening, performed by you."
                : "This does not discharge the screening obligation."}
              {" "}
              <Badge variant="outline" className="ml-1">recorded as manual</Badge>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !plan.ok}>
            {busy
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              : <ClipboardCheck className="mr-1.5 h-4 w-4" />}
            Record manual screening
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
