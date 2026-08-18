/**
 * Whether this case is inside the sanctions perimeter — shown to everyone,
 * changeable by a reviewer or MLRO.
 *
 * ── Why this control has to exist ─────────────────────────────────────
 * The per-scope policy shipped with no way to reach it. `sanctions` could be
 * `not_required`, but only if an `aml.case_screening_perimeter` row said so,
 * and nothing in the product wrote one. So every case stayed inside the
 * perimeter by default — correct, and completely unusable: Stage 5 went on
 * reporting "Screening cannot run yet", an inactive provider and a missing
 * DFAT list on cases that may never have needed sanctions screening, and the
 * only action offered led to a 404.
 *
 * ── What it is careful never to say ───────────────────────────────────
 * A perimeter finding is a statement about OBLIGATION: whether a designated
 * service is being provided at all. It is never a screening result. Nobody is
 * screened by recording one and nobody is cleared, and the wording here says
 * so on the page rather than leaving an operator to infer it from a green
 * badge.
 *
 * It also never stands PEP down as a side effect of standing sanctions down.
 * The scopes are excluded individually, because they answer to different
 * obligations and one finding is not a finding about all of them.
 */
import { useState } from "react";
import { Info, Loader2, ShieldQuestion } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  amlCasesApi,
  type AmlScreeningPerimeter,
  type AmlScreeningScopeKey,
} from "@/lib/aml/amlCasesApi";

/** The fixed list the server accepts. Free text is not a reason code. */
const REASONS: Array<{ value: string; label: string; detail: string }> = [
  {
    value: "enquiry_only",
    label: "Enquiry only",
    detail: "An enquiry or quotation. The customer relationship was never entered into.",
  },
  {
    value: "no_designated_service",
    label: "No designated service",
    detail: "No designated service is being, or will be, provided on this case.",
  },
  {
    value: "duplicate_record",
    label: "Duplicate record",
    detail: "An administrative duplicate. The CDD is carried by the case this duplicates.",
  },
  {
    value: "service_declined_pre_commencement",
    label: "Service declined before commencement",
    detail: "The service was declined before it commenced, so none was provided.",
  },
];

const SCOPES: Array<{ value: AmlScreeningScopeKey; label: string }> = [
  { value: "sanctions", label: "Targeted financial sanctions" },
  { value: "pep", label: "Politically exposed person" },
  { value: "adverse_media", label: "Adverse media" },
  { value: "watchlist", label: "Internal watchlists" },
];

const REASON_LABEL = Object.fromEntries(REASONS.map((r) => [r.value, r.label]));
const SCOPE_LABEL = Object.fromEntries(SCOPES.map((s) => [s.value, s.label]));

export function SanctionsPerimeterControl({
  caseId, perimeter, canClassify, onChanged, open: openProp, onOpenChange,
}: {
  caseId: string;
  /** The server's operative classification, or null while it is unread. */
  perimeter: AmlScreeningPerimeter | null | undefined;
  /**
   * Reviewer or MLRO. The backend enforces this independently — this only
   * decides whether an action nobody is allowed to take is offered at all.
   */
  canClassify: boolean;
  onChanged: () => void;
  /**
   * Optional external control of the dialog.
   *
   * Stage 5's own "Classify sanctions screening requirement" CTA has to open
   * THIS dialog — the one that already exists, with its reasons, its scope
   * checkboxes and its submit path — rather than a second copy of it. So the
   * dialog is controlled when the parent supplies `open`, and keeps its own
   * state when nobody does.
   *
   * That is the standard React controlled/uncontrolled pattern rather than a
   * ref handle, because the parent already needs the state anyway (to open
   * it from a card rendered above this one) and because it leaves this
   * component usable on its own, unchanged.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openSelf, setOpenSelf] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openSelf;
  // One setter for both modes, so every call site — the lower button, the
  // dialog's own dismiss, the successful submit — moves the same state.
  const setOpen = (next: boolean) => {
    if (!controlled) setOpenSelf(next);
    onOpenChange?.(next);
  };
  const [busy, setBusy] = useState(false);
  const [classification, setClassification] =
    useState<"designated_service" | "outside_perimeter">("outside_perimeter");
  const [reason, setReason] = useState<string>("enquiry_only");
  // Sanctions only by default. Excluding more is a separate decision, and
  // pre-ticking PEP would make one finding stand down two obligations.
  const [scopes, setScopes] = useState<AmlScreeningScopeKey[]>(["sanctions"]);
  const [note, setNote] = useState("");

  const outside = perimeter?.classification === "outside_perimeter";
  const excluded = perimeter?.scopes_excluded ?? [];

  const submit = async () => {
    setBusy(true);
    try {
      await amlCasesApi.classifyScreeningPerimeter({
        case_id: caseId,
        classification,
        ...(classification === "outside_perimeter"
          ? { reason_code: reason, scopes_excluded: scopes }
          : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast({
        title: classification === "outside_perimeter"
          ? "Perimeter recorded — outside"
          : "Perimeter recorded — inside",
        description: classification === "outside_perimeter"
          ? "This is a policy determination, not a screening result. Nobody has been "
            + "screened and nobody has been cleared."
          : "Sanctions screening is required for this case.",
      });
      setOpen(false);
      onChanged();
    } catch (e: any) {
      toast({
        title: "Could not record the perimeter",
        description: e?.message, variant: "destructive",
      });
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Sanctions screening requirement
            </p>
            <p className="mt-0.5 text-sm font-medium">
              {perimeter == null
                ? "Not yet classified"
                : outside
                  ? "Outside the sanctions perimeter"
                  : "Inside the sanctions perimeter"}
            </p>
          </div>
          <Badge variant={outside ? "secondary" : "outline"} className="text-[10px]">
            {perimeter == null ? "default policy" : outside ? "outside" : "inside"}
          </Badge>
        </div>

        {/*
          An unclassified case is INSIDE. Saying so is the point: an operator
          should never have to infer the screening obligation from a provider
          error message.
        */}
        {perimeter == null || !outside ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {perimeter == null
                ? "No perimeter decision has been recorded. The default under policy is "
                  + "inside the perimeter, so sanctions screening is required."
                : "A designated service is provided on this case, so sanctions screening "
                  + "is required."}
            </span>
          </p>
        ) : (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/40 p-3 text-xs">
            <p>
              <span className="text-muted-foreground">Reason: </span>
              <span className="font-medium">
                {REASON_LABEL[String(perimeter.reason_code)] ?? perimeter.reason_code}
              </span>
            </p>
            <p className="text-muted-foreground">
              Recorded by {perimeter.recorded_by_label ?? "an authorised reviewer"}
              {perimeter.recorded_at
                ? ` on ${new Date(perimeter.recorded_at).toLocaleDateString()}` : ""}
            </p>
            <div>
              <span className="text-muted-foreground">Scopes not required:</span>
              <ul className="mt-0.5 list-inside list-disc">
                {excluded.map((s) => (
                  <li key={s}>{SCOPE_LABEL[s] ?? s}</li>
                ))}
              </ul>
            </div>
            <p className="pt-1 text-muted-foreground">
              This is a policy determination, not a screening result. Nobody has been
              screened and nobody has been cleared.
            </p>
          </div>
        )}

        {canClassify ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <ShieldQuestion className="mr-1.5 h-3.5 w-3.5" />
            {outside ? "Reclassify perimeter" : "Classify perimeter"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only a reviewer or the MLRO can change this.
          </p>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Is this case within the sanctions screening perimeter?</DialogTitle>
            <DialogDescription>
              Targeted financial sanctions bind every dealing, so this is not a question
              about risk. It asks whether a designated service is being provided at all.
              Recording a finding screens nobody and clears nobody.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <RadioGroup
              value={classification}
              onValueChange={(v) => setClassification(v as typeof classification)}
              className="space-y-2"
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem value="designated_service" id="perimeter-inside" className="mt-0.5" />
                <Label htmlFor="perimeter-inside" className="font-normal">
                  <span className="font-medium">Inside perimeter</span>
                  <span className="block text-xs text-muted-foreground">
                    Sanctions screening required.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="outside_perimeter" id="perimeter-outside" className="mt-0.5" />
                <Label htmlFor="perimeter-outside" className="font-normal">
                  <span className="font-medium">Outside perimeter</span>
                  <span className="block text-xs text-muted-foreground">
                    No designated service is provided, so no screening obligation arises.
                  </span>
                </Label>
              </div>
            </RadioGroup>

            {classification === "outside_perimeter" && (
              <>
                <fieldset className="space-y-2">
                  <legend className="text-xs font-medium text-muted-foreground">Reason</legend>
                  <RadioGroup value={reason} onValueChange={setReason} className="space-y-2">
                    {REASONS.map((r) => (
                      <div key={r.value} className="flex items-start gap-2">
                        <RadioGroupItem value={r.value} id={`reason-${r.value}`} className="mt-0.5" />
                        <Label htmlFor={`reason-${r.value}`} className="font-normal">
                          <span className="font-medium">{r.label}</span>
                          <span className="block text-xs text-muted-foreground">{r.detail}</span>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="text-xs font-medium text-muted-foreground">
                    Scopes this finding removes
                  </legend>
                  {/*
                    Ticked individually. A perimeter finding is not automatically
                    a finding about every control, and defaulting this to all of
                    them would stand PEP down on the strength of a sanctions
                    decision nobody made.
                  */}
                  {SCOPES.map((s) => (
                    <div key={s.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`scope-${s.value}`}
                        checked={scopes.includes(s.value)}
                        onCheckedChange={(c) => setScopes((prev) =>
                          c ? [...new Set([...prev, s.value])] : prev.filter((x) => x !== s.value))}
                      />
                      <Label htmlFor={`scope-${s.value}`} className="font-normal">{s.label}</Label>
                    </div>
                  ))}
                  {scopes.length === 0 && (
                    <p className="text-xs text-destructive">
                      A finding that excludes nothing exempts nothing. Choose at least one.
                    </p>
                  )}
                </fieldset>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="perimeter-note" className="text-xs text-muted-foreground">
                Note (optional)
              </Label>
              <Textarea
                id="perimeter-note" value={note} rows={3}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything a reviewer would need to understand this determination later."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={busy || (classification === "outside_perimeter" && scopes.length === 0)}
            >
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Record determination
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
