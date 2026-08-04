import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Share2, FileSignature, ShieldCheck } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { usePromptDialog } from "@/components/aml/usePromptDialog";
import {
  amlRelianceApi, type ComplianceAttestation, type IndependentAssessment,
  type RelianceAgreement, type RelianceGrant,
} from "@/lib/aml/amlRelianceApi";

/**
 * Compliance Passport — one completed AML/CTF process, reused across every
 * portal under Pt 2 Div 7 reliance.
 *
 * What this panel never does: it never shows a partner our risk assessment,
 * and a partner's independent assessment never moves our case. The two
 * organisations' compliance states are linked by evidence, not by authority.
 */
export function ReliancePassportSection({
  caseId, isMlro,
}: { caseId: string; isMlro: boolean }) {
  const [attestations, setAttestations] = useState<ComplianceAttestation[]>([]);
  const [grants, setGrants] = useState<RelianceGrant[]>([]);
  const [assessments, setAssessments] = useState<IndependentAssessment[]>([]);
  const [agreements, setAgreements] = useState<RelianceAgreement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { prompt, dialog } = usePromptDialog();

  const refresh = useCallback(async () => {
    try {
      const [a, g, s, ag] = await Promise.all([
        amlRelianceApi.listAttestations(caseId),
        amlRelianceApi.listGrants(caseId),
        amlRelianceApi.listAssessments(caseId),
        amlRelianceApi.listAgreements(),
      ]);
      setAttestations(a.attestations ?? []);
      setGrants(g.grants ?? []);
      setAssessments(s.assessments ?? []);
      setAgreements(ag.agreements ?? []);
    } catch {
      // Function not yet deployed in this environment — render empty state.
    } finally {
      setLoaded(true);
    }
  }, [caseId]);

  useEffect(() => { refresh(); }, [refresh]);

  const issue = async () => {
    setBusy("issue");
    try {
      const { attestation } = await amlRelianceApi.issueAttestation(caseId);
      toast({
        title: `Attestation v${attestation.version} issued`,
        description: `Content hash ${attestation.payload_sha256.slice(0, 12)}…`,
      });
      await refresh();
    } catch (e: any) {
      toast({ title: "Could not issue attestation", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const grant = async () => {
    const active = agreements.filter((a) => a.status === "active");
    if (active.length === 0) {
      toast({
        title: "No active CDD arrangement",
        description: "Reliance requires a written agreement with the partner organisation (Pt 2 Div 7). Record one first.",
        variant: "destructive",
      });
      return;
    }
    const values = await prompt({
      title: "Grant partner access",
      description:
        "The partner receives the current attestation — what procedures were performed, never our " +
        "assessments. Requires the client's sharing consent and a current written agreement.",
      confirmLabel: "Grant access",
      fields: [{
        name: "partner", label: `Partner organisation (${active.map((a) => a.partner_org_name).join(" · ")})`,
        required: true, placeholder: "Exact partner name from the list above…",
        helpText: "Must match an active agreement.",
      }],
    });
    if (!values) return;
    const agreement = active.find(
      (a) => a.partner_org_name.toLowerCase() === values.partner.trim().toLowerCase());
    if (!agreement) {
      toast({ title: "No active agreement matches that name", variant: "destructive" });
      return;
    }
    setBusy("grant");
    try {
      const res = await amlRelianceApi.grantAccess(caseId, agreement.id);
      // The raw token exists only in this moment — surface it once, plainly.
      await prompt({
        title: "Partner access token — shown once",
        description:
          `${res.note} Expires ${new Date(res.grant.expires_at).toLocaleDateString()}.`,
        confirmLabel: "I have delivered it",
        fields: [{
          name: "token", label: "Access token (copy now)", type: "textarea",
          required: false, placeholder: res.access_token, helpText: res.access_token,
        }],
      });
      await refresh();
    } catch (e: any) {
      toast({ title: "Could not grant access", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const addAgreement = async () => {
    const values = await prompt({
      title: "Record a written CDD arrangement",
      description:
        "Section 37A reliance is unavailable without a written agreement that is regularly reviewed. " +
        "This records the arrangement; the agreement itself lives with legal.",
      confirmLabel: "Record arrangement",
      fields: [
        { name: "partner_org_name", label: "Partner organisation", required: true, placeholder: "e.g. Meridian Finance Group…" },
        { name: "partner_org_type", label: 'Type ("finance" / "builder" / "developer" / "solicitor_conveyancer" / "other")', required: true, placeholder: "finance" },
        { name: "agreement_reference", label: "Written agreement reference", required: true, placeholder: "e.g. CDD-2026-014…" },
        { name: "executed_on", label: "Executed on", type: "date", required: true },
        { name: "next_review_due", label: "Next review due", type: "date", required: true, helpText: "An overdue review blocks new grants." },
      ],
    });
    if (!values) return;
    setBusy("agreement");
    try {
      await amlRelianceApi.createAgreement({
        partner_org_name: values.partner_org_name,
        partner_org_type: values.partner_org_type.trim() as any,
        agreement_reference: values.agreement_reference,
        executed_on: values.executed_on,
        next_review_due: values.next_review_due,
      });
      toast({ title: "CDD arrangement recorded" });
      await refresh();
    } catch (e: any) {
      toast({ title: "Could not record arrangement", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  if (!loaded) return null;
  const current = attestations.find((a) => !a.superseded_at) ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Share2 className="h-4 w-4 text-primary" /> Compliance passport — cross-portal reliance
        </CardTitle>
        {isMlro && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addAgreement} disabled={busy !== null}>
              <FileSignature className="mr-1.5 h-3.5 w-3.5" /> Arrangement
            </Button>
            <Button size="sm" variant="outline" onClick={issue} disabled={busy !== null}>
              {busy === "issue" && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Issue attestation
            </Button>
            <Button size="sm" onClick={grant} disabled={busy !== null || !current}>
              {busy === "grant" && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Grant access
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle className="text-sm">One process, every portal</AlertTitle>
          <AlertDescription className="text-xs">
            Partners with a written CDD arrangement (AML/CTF Act Pt 2 Div 7) rely on the procedures
            attested here, or record their own independent assessment against the same records —
            without re-approaching the client. They see what was <em>performed</em>, never our risk
            assessment; their determinations never move this case.
          </AlertDescription>
        </Alert>

        <div className="grid gap-3 sm:grid-cols-3 text-xs">
          <div>
            <div className="font-medium">Attestation</div>
            {current ? (
              <div className="text-muted-foreground">
                v{current.version} · {new Date(current.issued_at).toLocaleDateString()}
                <div className="truncate" title={current.payload_sha256}>
                  sha {current.payload_sha256.slice(0, 16)}…
                </div>
              </div>
            ) : <div className="text-muted-foreground">Not issued</div>}
          </div>
          <div>
            <div className="font-medium">Active grants</div>
            {grants.filter((g) => !g.revoked_at).length === 0 ? (
              <div className="text-muted-foreground">None</div>
            ) : grants.filter((g) => !g.revoked_at).map((g) => (
              <div key={g.id} className="text-muted-foreground">
                {g.reliance_agreements?.partner_org_name ?? "Partner"}
                {" · expires "}{new Date(g.expires_at).toLocaleDateString()}
              </div>
            ))}
          </div>
          <div>
            <div className="font-medium">Partner assessments</div>
            {assessments.length === 0 ? (
              <div className="text-muted-foreground">None recorded</div>
            ) : assessments.map((a) => (
              <div key={a.id} className="text-muted-foreground">
                {a.reliance_agreements?.partner_org_name ?? a.assessor_name}
                {": "}
                <Badge variant="outline" className={
                  a.status === "satisfied" ? "text-success"
                    : a.status === "not_satisfied" ? "text-destructive" : "text-warning"
                }>
                  {a.status.replace("_", " ")}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
      {dialog}
    </Card>
  );
}
