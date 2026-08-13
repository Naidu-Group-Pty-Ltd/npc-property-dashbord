import { useState } from "react";
import { AlertTriangle, FileQuestion, Plus, Share2, ShieldOff, Slash } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { amlRelianceApi } from "@/lib/aml/amlRelianceApi";
import { amlRiskApi } from "@/lib/aml/amlRiskApi";
import type { PassportView } from "@/lib/aml/passport";

/**
 * Passport controls — the design's control rail, wired to the operations
 * that already own each action.
 *
 * Nothing here writes state directly. Issue calls `issue_attestation`,
 * suspend and revoke call `set_service_gate` — all MLRO-gated server-side,
 * all reason-bearing, all writing their own hash-chained case event. The
 * client-information request and partner sharing keep their existing homes
 * (the Requests section and the Compliance Sharing panel), because those
 * surfaces carry inputs this rail has no business duplicating; the rail
 * says where they are rather than pretending to be them.
 *
 * Affordance is not authorisation: the buttons are shown to MLROs for
 * discoverability, and the server refuses anyone else regardless.
 */

const MIN_REASON = 10;

type RestrictedAction = {
  key: "suspend" | "revoke";
  title: string;
  description: string;
  confirmLabel: string;
  gateStatus: "locked" | "terminated";
};

const RESTRICTED: RestrictedAction[] = [
  {
    key: "suspend",
    title: "Suspend Passport",
    description:
      "A temporary restriction. New reliance and new partner access become unavailable while it is in force; partner decisions already recorded are not withdrawn.",
    confirmLabel: "Suspend",
    gateStatus: "locked",
  },
  {
    key: "revoke",
    title: "Revoke Passport",
    description:
      "Revocation makes the Passport unavailable for any new reliance. It remains a retained compliance record and is not deleted.",
    confirmLabel: "Revoke",
    gateStatus: "terminated",
  },
];

export function PassportControls({
  caseId, view, isMlro, onChanged,
}: {
  caseId: string;
  view: PassportView;
  isMlro: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<RestrictedAction | null>(null);
  const [reason, setReason] = useState("");

  const state = view.header.state.code;
  const canIssue = state === "ready_for_issuance" || state === "superseded" || state === "refresh_required";

  async function issue() {
    setBusy("issue");
    try {
      await amlRelianceApi.issueAttestation(caseId);
      toast({
        title: "Passport issued",
        description: "A new version was sealed and fingerprinted. Partners holding an earlier version are told theirs is obsolete.",
      });
      onChanged();
    } catch (e: unknown) {
      toast({
        title: "The Passport was not issued",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function confirmRestricted() {
    if (!pending || reason.trim().length < MIN_REASON) return;
    setBusy(pending.key);
    try {
      await amlRiskApi.setServiceGate({
        case_id: caseId,
        status: pending.gateStatus,
        reason: reason.trim(),
      });
      toast({
        title: pending.key === "suspend" ? "Passport suspended" : "Passport revoked",
        description: "Recorded with your reason on the case timeline. Connected partners see a controlled message only.",
      });
      setPending(null);
      setReason("");
      onChanged();
    } catch (e: unknown) {
      toast({
        title: "The action was not applied",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Card className="glass-panel">
        <CardContent className="space-y-4 py-4">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Passport controls
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!isMlro || !canIssue || busy !== null}
                onClick={() => void issue()}
                title={
                  !isMlro
                    ? "MLRO role required"
                    : canIssue
                      ? undefined
                      : "A new version is issued when the gate is approved or the current version has been superseded"
                }
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {view.versions.length === 0 ? "Issue Passport" : "Issue new version"}
              </Button>

              {/* Sharing and client requests keep their existing homes — this
                  rail points at them rather than duplicating their forms. */}
              <Button size="sm" variant="outline" asChild>
                <a href="#compliance-sharing">
                  <Share2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Share Passport
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href="#compliance-sharing">
                  <FileQuestion className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Request client information
                </a>
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Sharing, partner access and client requests are performed in the Compliance Sharing panel below, which
              owns their inputs and their audit records.
            </p>
          </div>

          <div className="rounded-lg border border-dashed border-destructive/40 p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Restricted actions
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {RESTRICTED.map((a) => (
                <Button
                  key={a.key}
                  size="sm"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  disabled={!isMlro || busy !== null}
                  onClick={() => { setPending(a); setReason(""); }}
                  title={isMlro ? undefined : "MLRO role required"}
                >
                  {a.key === "suspend"
                    ? <Slash className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    : <ShieldOff className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                  {a.title}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              MLRO only, and a reason is mandatory. Every action is written to Passport history with the actor and the
              reason; partner portals receive a controlled message and never the internal reason.
            </p>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="passport-restricted-reason">Reason (recorded on the case timeline)</Label>
            <Textarea
              id="passport-restricted-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this action is being taken"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {reason.trim().length < MIN_REASON
                ? `At least ${MIN_REASON} characters.`
                : "This reason is internal and is never disclosed to a partner."}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reason.trim().length < MIN_REASON || busy !== null}
              onClick={(e) => { e.preventDefault(); void confirmRestricted(); }}
            >
              {pending?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
