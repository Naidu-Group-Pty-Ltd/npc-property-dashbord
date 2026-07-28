import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ShieldCheck, AlertTriangle, Eye, FileCheck2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  amlVerificationApi, type AmlVerificationCheck, type AmlBiometricAccessEntry,
} from "@/lib/aml/amlVerificationApi";
import { usePromptDialog } from "@/components/aml/usePromptDialog";

/**
 * Identity verification — command-centre surface for the self-hosted stack.
 *
 * Two things this deliberately does NOT do:
 *  - It does not move the service gate. A passed check is evidence for a
 *    decision, never the decision.
 *  - It does not render the biometric inline. The image is fetched only on an
 *    explicit, reasoned request, and every fetch is logged.
 */

const STATUS_STYLES: Record<string, string> = {
  passed: "text-success",
  failed: "text-destructive",
  referred: "text-warning",
  exhausted: "text-destructive",
  pending: "text-muted-foreground",
  in_progress: "text-muted-foreground",
  abandoned: "text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  passed: "Verified",
  failed: "Failed",
  referred: "Needs review",
  exhausted: "Attempts exhausted",
  pending: "Awaiting adjudication",
  in_progress: "Running",
  abandoned: "Abandoned",
};

export function VerificationSection({
  caseId, canWrite, onChanged,
}: { caseId: string; canWrite: boolean; onChanged?: () => void }) {
  const [checks, setChecks] = useState<AmlVerificationCheck[] | null>(null);
  const [accessLog, setAccessLog] = useState<AmlBiometricAccessEntry[]>([]);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { prompt, dialog } = usePromptDialog();

  const refresh = useCallback(async () => {
    try {
      const [res, log] = await Promise.all([
        amlVerificationApi.listVerificationChecks(caseId),
        amlVerificationApi.listBiometricAccess(caseId).catch(() => ({ access_log: [] })),
      ]);
      setChecks(res.checks ?? []);
      setMaxAttempts(res.max_attempts ?? 3);
      setAccessLog(log.access_log ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Unable to load verification checks.");
      setChecks([]);
    }
  }, [caseId]);

  useEffect(() => { refresh(); }, [refresh]);

  const adjudicate = async (check: AmlVerificationCheck) => {
    setBusy(check.id);
    try {
      await amlVerificationApi.runVerification(check.id);
      toast({ title: "Verification adjudicated" });
      await refresh();
      onChanged?.();
    } catch (e: any) {
      toast({
        title: "Could not adjudicate",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const viewBiometric = async (check: AmlVerificationCheck) => {
    const values = await prompt({
      title: "View retained biometric",
      description:
        "This image is sensitive information. Your name, the time and the reason " +
        "below are written to the access log and to the case timeline.",
      confirmLabel: "View image",
      fields: [{
        name: "reason", label: "Reason for viewing", type: "textarea",
        required: true, minLength: 10,
        helpText: "At least 10 characters. Recorded permanently.",
        placeholder: "e.g. Manual face comparison after a referred automated check…",
      }],
    });
    if (!values) return;

    setBusy(check.id);
    try {
      const { url, expires_in_seconds } = await amlVerificationApi.getBiometricUrl(
        check.id, values.reason);
      window.open(url, "_blank", "noopener,noreferrer");
      toast({
        title: "Access recorded",
        description: `The link expires in ${expires_in_seconds} seconds.`,
      });
      await refresh();
    } catch (e: any) {
      toast({ title: "Could not open image", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const recordSighting = async () => {
    const values = await prompt({
      title: "Record a document sighting",
      description:
        "The documentary path is primary evidence under the current design. " +
        "Record exactly what was sighted and by whom.",
      confirmLabel: "Record sighting",
      fields: [
        { name: "party_label", label: "Party verified", required: true,
          placeholder: "Full legal name…" },
        { name: "document_type", label: "Document sighted", required: true,
          placeholder: "e.g. Australian passport · NSW driver licence…" },
        { name: "sighting_kind", label: 'Original or certified copy ("original" / "certified_copy")',
          required: true, placeholder: "original" },
        { name: "certifier_name", label: "Certifier name (certified copies only)",
          placeholder: "Leave blank for an original…" },
        { name: "certifier_capacity", label: "Certifier capacity (certified copies only)",
          placeholder: "e.g. Justice of the Peace, pharmacist…" },
        { name: "notes", label: "What you sighted and how", type: "textarea",
          required: true, minLength: 10,
          helpText: "At least 10 characters. This is the evidence record." },
      ],
    });
    if (!values) return;

    const kind = values.sighting_kind?.trim().toLowerCase();
    if (kind !== "original" && kind !== "certified_copy") {
      toast({
        title: "Invalid sighting type",
        description: 'Enter "original" or "certified_copy".',
        variant: "destructive",
      });
      return;
    }

    setBusy("sighting");
    try {
      await amlVerificationApi.recordDocumentSighting({
        case_id: caseId,
        party_label: values.party_label,
        document_type: values.document_type,
        sighting_kind: kind,
        certifier_name: values.certifier_name || undefined,
        certifier_capacity: values.certifier_capacity || undefined,
        notes: values.notes,
      });
      toast({ title: "Document sighting recorded" });
      await refresh();
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Could not record sighting", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>What these checks do and do not establish</AlertTitle>
        <AlertDescription className="text-xs">
          Documents are <strong>not</strong> checked against the issuing authority — there is no
          DVS connection. Liveness is a heuristic signal, not proof. A passed check is evidence
          towards a decision; it never approves the service gate on its own. For higher-risk
          matters, sight an original or certified copy.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Identity verification
          </CardTitle>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={recordSighting} disabled={busy === "sighting"}>
              {busy === "sighting" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              <FileCheck2 className="mr-1.5 h-3.5 w-3.5" /> Record sighting
            </Button>
          )}
        </CardHeader>

        <CardContent className="space-y-3 text-sm">
          {error ? (
            <p className="text-muted-foreground">{error}</p>
          ) : checks === null ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : checks.length === 0 ? (
            <p className="text-muted-foreground">
              No verification attempts yet. The client is prompted for these in their portal,
              or you can record a document sighting.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {checks.map((c) => (
                <li key={c.id} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">{c.party_label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.check_type === "document_sighting" ? "Document sighting" : "Electronic check"}
                        {c.check_type === "electronic_idv" &&
                          ` · attempt ${c.attempt_number} of ${maxAttempts}`}
                      </span>
                    </div>
                    <Badge variant="outline" className={STATUS_STYLES[c.status] ?? ""}>
                      {STATUS_LABELS[c.status] ?? c.status}
                    </Badge>
                  </div>

                  {c.check_type === "document_sighting" && c.outcome_detail && (
                    <div className="text-xs text-muted-foreground">
                      {c.outcome_detail.document_type}
                      {" · "}
                      {String(c.outcome_detail.sighting_kind ?? "").replace("_", " ")}
                      {c.outcome_detail.certifier_name &&
                        ` · certified by ${c.outcome_detail.certifier_name} (${c.outcome_detail.certifier_capacity})`}
                    </div>
                  )}

                  {Array.isArray(c.outcome_detail?.checks) && (
                    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {c.outcome_detail.checks.map((sub: any) => (
                        <li key={sub.name} className={
                          sub.status === "pass" ? "text-success"
                            : sub.status === "fail" ? "text-destructive" : "text-warning"
                        } title={sub.detail ?? ""}>
                          {sub.name.replace(/_/g, " ")}: {sub.status}
                        </li>
                      ))}
                    </ul>
                  )}

                  {c.failure_reason && (
                    <div className="text-xs text-destructive">{c.failure_reason}</div>
                  )}

                  {canWrite && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {["pending", "in_progress"].includes(c.status) && c.check_type === "electronic_idv" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => adjudicate(c)} disabled={busy === c.id}>
                          {busy === c.id && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                          Run check
                        </Button>
                      )}
                      {c.has_biometric && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => viewBiometric(c)} disabled={busy === c.id}>
                          <Eye className="mr-1.5 h-3 w-3" /> View image (logged)
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {accessLog.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Biometric access log</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            <ul className="divide-y divide-border/60">
              {accessLog.slice(0, 10).map((a) => (
                <li key={a.id} className="flex justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">{a.actor_label ?? "Unknown"}</span>
                    {" — "}{a.action}
                    {a.reason && <span className="text-muted-foreground"> · {a.reason}</span>}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {dialog}
    </div>
  );
}
