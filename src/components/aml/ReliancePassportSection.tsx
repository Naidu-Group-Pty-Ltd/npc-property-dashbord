import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Share2, FileSignature, ShieldCheck, Link2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { usePromptDialog } from "@/components/aml/usePromptDialog";
import {
  amlRelianceApi, type ComplianceAttestation, type IndependentAssessment,
  type PartnerCaseLink, type PartnerOrganisation, type PartnerRecordsRequest,
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
  const [links, setLinks] = useState<PartnerCaseLink[]>([]);
  const [organisations, setOrganisations] = useState<PartnerOrganisation[]>([]);
  const [recordsRequests, setRecordsRequests] = useState<PartnerRecordsRequest[]>([]);
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
    }
    try {
      // Phase 1 surfaces load separately so an environment without the
      // partner-identity migration still renders the legacy panel.
      const [l, o] = await Promise.all([
        amlRelianceApi.listPartnerCaseLinks(caseId),
        amlRelianceApi.listPartnerOrganisations(),
      ]);
      setLinks(l.links ?? []);
      setOrganisations(o.partner_organisations ?? []);
    } catch {
      // Partner-identity tables not present yet — hide the links block.
    }
    try {
      const rr = await amlRelianceApi.staffListPartnerRecordsRequests(caseId);
      setRecordsRequests(rr.requests ?? []);
    } catch {
      // Phase 4 tables not present yet — hide the requests block.
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

  const addOrganisation = async () => {
    const values = await prompt({
      title: "Record a partner organisation",
      description:
        "The canonical legal identity of a partner. Classification stays 'unclassified' until the " +
        "MLRO records it with evidence — the system never infers a legal status.",
      confirmLabel: "Record organisation",
      fields: [
        { name: "legal_name", label: "Legal name", required: true, placeholder: "e.g. Meridian Finance Group Pty Ltd…" },
        { name: "organisation_type", label: 'Type ("finance" / "builder" / "developer" / "solicitor_conveyancer" / "other")', required: true, placeholder: "finance" },
        { name: "abn", label: "ABN (optional)", required: false, placeholder: "11 digits…" },
      ],
    });
    if (!values) return;
    setBusy("org");
    try {
      await amlRelianceApi.upsertPartnerOrganisation({
        legal_name: values.legal_name,
        organisation_type: values.organisation_type.trim() as any,
        abn: values.abn || undefined,
      });
      toast({ title: "Partner organisation recorded", description: "Classification: unclassified until the MLRO records it." });
      await refresh();
    } catch (e: any) {
      toast({ title: "Could not record organisation", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const addLink = async () => {
    if (organisations.length === 0) {
      toast({
        title: "No partner organisations recorded",
        description: "Record the canonical partner organisation first — a free-text name is not an identity.",
        variant: "destructive",
      });
      return;
    }
    const values = await prompt({
      title: "Link a partner to this case",
      description:
        "The link records why this organisation may access this matter. It grants nothing by " +
        "itself — no passport, no reliance, no data flow. The legal route is a recorded decision, " +
        "never inferred from the portal.",
      confirmLabel: "Link partner",
      fields: [
        {
          name: "partner", label: `Partner organisation (${organisations.map((o) => o.legal_name).join(" · ")})`,
          required: true, placeholder: "Exact legal name from the list above…",
        },
        { name: "portal_type", label: 'Portal ("finance" / "builder" / "developer" / "solicitor_conveyancer" / "other")', required: true, placeholder: "finance" },
        { name: "relationship_role", label: "Relationship role", required: true, placeholder: "e.g. lender, buyer_solicitor, builder…" },
        { name: "legal_route", label: 'Legal route ("reliance" / "outsourced_cdd" / "independent_cdd" / "information_share_only")', required: true, placeholder: "independent_cdd" },
        { name: "purpose", label: "Documented purpose", type: "textarea", required: true, placeholder: "Why this organisation needs access to this matter…" },
      ],
    });
    if (!values) return;
    const org = organisations.find(
      (o) => o.legal_name.toLowerCase() === values.partner.trim().toLowerCase());
    if (!org) {
      toast({ title: "No recorded organisation matches that name", variant: "destructive" });
      return;
    }
    setBusy("link");
    try {
      await amlRelianceApi.linkPartnerToCase({
        case_id: caseId, partner_org_id: org.id,
        portal_type: values.portal_type.trim(),
        relationship_role: values.relationship_role.trim(),
        legal_route: values.legal_route.trim() as any,
        purpose: values.purpose,
      });
      toast({ title: "Partner linked", description: "The link is an access root only — no reliance follows from it." });
      await refresh();
    } catch (e: any) {
      toast({ title: "Could not link partner", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const endLink = async (link: PartnerCaseLink) => {
    const values = await prompt({
      title: "End partner link",
      description: "Ending the link removes the access root. The reason code is partner-safe.",
      confirmLabel: "End link",
      fields: [{
        name: "reason", label: 'Reason ("completed" / "withdrawn" / "superseded" / "client_declined" / "other")',
        required: true, placeholder: "completed",
      }],
    });
    if (!values) return;
    setBusy("endlink");
    try {
      await amlRelianceApi.setPartnerCaseLinkState({
        link_id: link.id, state: "ended", end_reason_code: values.reason.trim() as any,
      });
      toast({ title: "Partner link ended" });
      await refresh();
    } catch (e: any) {
      toast({ title: "Could not end link", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const reviewRecordsRequest = async (request: PartnerRecordsRequest) => {
    const values = await prompt({
      title: "Review partner records request",
      description:
        `${request.partner_organisations?.legal_name ?? "Partner"} requested: ` +
        `${request.requested_record_codes.join(", ")}. Releasing CDD records is a restricted ` +
        "disclosure decision. The response message is shown to the partner — write it partner-safe.",
      confirmLabel: "Record decision",
      fields: [
        { name: "decision", label: 'Decision ("approved" / "partly_approved" / "denied" / "under_review")', required: true, placeholder: "approved" },
        { name: "approved_codes", label: "Approved codes (comma-separated; blank = all requested for approval)", required: false, placeholder: request.requested_record_codes.join(", ") },
        { name: "response_message", label: "Partner-safe response message", type: "textarea", required: false, placeholder: "What the partner will read…" },
      ],
    });
    if (!values) return;
    setBusy("review-request");
    try {
      const decision = values.decision.trim() as any;
      const approved = values.approved_codes
        ? values.approved_codes.split(",").map((c) => c.trim()).filter(Boolean)
        : decision === "approved" ? request.requested_record_codes : [];
      await amlRelianceApi.reviewPartnerRecordsRequest({
        request_id: request.id, decision,
        approved_record_codes: approved,
        response_message: values.response_message,
      });
      toast({ title: "Records request decision recorded" });
      await refresh();
    } catch (e: any) {
      toast({ title: "Could not record decision", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const recordDelivery = async (request: PartnerRecordsRequest) => {
    const values = await prompt({
      title: "Record evidence delivery",
      description:
        "Metadata only: the delivery register records what was supplied, its hash and expiry. " +
        `Approved codes: ${request.approved_record_codes.join(", ") || "none"}.`,
      confirmLabel: "Record delivery",
      fields: [
        { name: "record_code", label: "Record code (from the approved list)", required: true, placeholder: request.approved_record_codes[0] ?? "" },
        { name: "safe_label", label: "Partner-safe label", required: true, placeholder: "e.g. Identity verification record — J. Citizen…" },
        { name: "delivered_sha256", label: "Content hash (optional)", required: false, placeholder: "sha256…" },
      ],
    });
    if (!values) return;
    setBusy("delivery");
    try {
      await amlRelianceApi.recordPartnerEvidenceDelivery({
        request_id: request.id,
        record_code: values.record_code.trim(),
        safe_label: values.safe_label,
        delivered_sha256: values.delivered_sha256 || undefined,
      });
      toast({ title: "Evidence delivery recorded" });
      await refresh();
    } catch (e: any) {
      toast({ title: "Could not record delivery", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const recordAssessment = async (agreement: RelianceAgreement) => {
    const values = await prompt({
      title: `Assess arrangement — ${agreement.partner_org_name}`,
      description:
        "s 37A requires the arrangement to be regularly reviewed. The assessment history is " +
        "immutable: a new assessment supersedes the previous one, it never edits it.",
      confirmLabel: "Record assessment",
      fields: [
        { name: "trigger", label: 'Trigger ("initial" / "scheduled" / "significant_change" / "incident" / "other")', required: true, placeholder: "scheduled" },
        { name: "decision", label: 'Decision ("suitable" / "suitable_with_conditions" / "unsuitable")', required: true, placeholder: "suitable" },
        { name: "next_due_at", label: "Next assessment due", type: "date", required: true, helpText: "An overdue assessment blocks new reliance grants." },
        { name: "findings", label: "Findings", type: "textarea", required: false, placeholder: "Required unless plainly suitable…" },
      ],
    });
    if (!values) return;
    setBusy("assessment");
    try {
      await amlRelianceApi.recordArrangementAssessment({
        agreement_id: agreement.id,
        trigger: values.trigger.trim() as any,
        decision: values.decision.trim() as any,
        next_due_at: values.next_due_at,
        findings: values.findings || undefined,
      });
      toast({ title: "Arrangement assessment recorded" });
      await refresh();
    } catch (e: any) {
      toast({ title: "Could not record assessment", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  // Phase 6: recompute the material-input hash against live case data and,
  // where it genuinely changed, atomically flag the attestation, grants and
  // partner determinations for refresh (never the case, gate or risk state).
  const materialChange = async () => {
    setBusy("material");
    try {
      const result = await amlRelianceApi.applyMaterialChange({ case_id: caseId });
      if (!result.material) {
        toast({ title: "No material change", description: result.message });
      } else {
        toast({
          title: "Material change recorded",
          description: `Changed: ${result.changed_groups.join(", ")}. Partners see safe refresh wording only.`,
        });
      }
      await refresh();
    } catch (e: any) {
      toast({ title: "Could not evaluate material change", description: e?.message, variant: "destructive" });
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
            <Button size="sm" variant="outline" onClick={materialChange}
              disabled={busy !== null || !current} title="Re-evaluate the material inputs and flag partner surfaces for refresh if they changed">
              {busy === "material" && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Material change
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
                  {/* Global replace: `independent_cdd_required` (Phase 4)
                      otherwise renders with its later underscores intact. */}
                  {a.status.replace(/_/g, " ")}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Arrangement governance (Phase 2). The written arrangement and
            its immutable assessment history. An overdue, unsuitable or
            inactive arrangement blocks NEW reliance grants; the independent
            CDD route is never affected. */}
        {agreements.length > 0 && (
          <div className="border-t pt-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium flex items-center gap-1.5">
                <FileSignature className="h-3.5 w-3.5 text-primary" /> Written arrangements
              </div>
            </div>
            <ul className="mt-1.5 space-y-1.5 text-xs">
              {agreements.map((a) => {
                const reviewOverdue = new Date(a.next_review_due).getTime() < Date.now();
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.partner_org_name}</span>
                    <Badge variant="outline" className={
                      a.status === "active" ? "text-success"
                        : a.status === "suspended" ? "text-warning" : "text-muted-foreground"
                    }>
                      {a.status}
                    </Badge>
                    {reviewOverdue && (
                      <Badge variant="outline" className="text-destructive">review overdue</Badge>
                    )}
                    {(a.eligibility_classification ?? "unassessed") === "unassessed" && (
                      <Badge variant="outline" className="text-warning">eligibility not recorded</Badge>
                    )}
                    {!a.current_assessment_id && (
                      <Badge variant="outline" className="text-warning">no assessment</Badge>
                    )}
                    {isMlro && (
                      <Button
                        size="sm" variant="ghost" className="h-6 px-2 text-xs"
                        onClick={() => recordAssessment(a)} disabled={busy !== null}
                      >
                        Record assessment
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="text-[11px] text-muted-foreground mt-1.5">
              An overdue, unsuitable or inactive arrangement blocks new reliance grants. A partner
              that cannot rely completes its own independent CDD instead — that route is always
              available.
            </div>
          </div>
        )}

        {/* Canonical partner links (Phase 1). A link is the access root —
            it explains WHY an organisation may see this matter. It is never
            itself a passport, a reliance decision or a disclosure. */}
        <div className="border-t pt-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5 text-primary" /> Partner links
            </div>
            {isMlro && (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={addOrganisation} disabled={busy !== null}>
                  Record organisation
                </Button>
                <Button size="sm" variant="outline" onClick={addLink} disabled={busy !== null}>
                  {busy === "link" && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                  Link partner
                </Button>
              </div>
            )}
          </div>
          {links.length === 0 ? (
            <div className="text-xs text-muted-foreground mt-1.5">
              No partners linked. A partner sees this matter only through an active link with a
              recorded legal route and purpose — and a link alone still grants no passport or
              reliance access.
            </div>
          ) : (
            <ul className="mt-1.5 space-y-1.5 text-xs">
              {links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {l.partner_organisations?.legal_name ?? "Partner organisation"}
                  </span>
                  <Badge variant="outline">{l.relationship_role}</Badge>
                  <Badge variant="outline">{l.legal_route.replace(/_/g, " ")}</Badge>
                  <Badge
                    variant="outline"
                    className={
                      l.state === "active" ? "text-success"
                        : l.state === "suspended" ? "text-warning" : "text-muted-foreground"
                    }
                  >
                    {l.state}
                  </Badge>
                  {l.partner_organisations?.classification_status !== "classified" && (
                    <Badge variant="outline" className="text-warning">classification incomplete</Badge>
                  )}
                  {isMlro && l.state === "active" && (
                    <Button
                      size="sm" variant="ghost" className="h-6 px-2 text-xs"
                      onClick={() => endLink(l)} disabled={busy !== null}
                    >
                      End link
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Partner records requests (Phase 4). Origin review of controlled
            record-class requests; nothing is delivered without an explicit
            decision here, and the response wording is partner-safe. */}
        {recordsRequests.length > 0 && (
          <div className="border-t pt-3">
            <div className="text-xs font-medium">Partner records requests</div>
            <ul className="mt-1.5 space-y-1.5 text-xs">
              {recordsRequests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {r.partner_organisations?.legal_name ?? "Partner"}
                  </span>
                  <span className="text-muted-foreground">
                    {r.requested_record_codes.join(", ")}
                  </span>
                  <Badge variant="outline" className={
                    r.status === "denied" ? "text-destructive"
                      : ["approved", "partly_approved", "delivered"].includes(r.status) ? "text-success"
                        : "text-warning"
                  }>
                    {r.status.replace(/_/g, " ")}
                  </Badge>
                  {isMlro && ["submitted", "under_review"].includes(r.status) && (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                      onClick={() => reviewRecordsRequest(r)} disabled={busy !== null}>
                      Review
                    </Button>
                  )}
                  {isMlro && ["approved", "partly_approved", "delivered"].includes(r.status)
                    && r.approved_record_codes.length > 0 && (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                      onClick={() => recordDelivery(r)} disabled={busy !== null}>
                      Record delivery
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      {dialog}
    </Card>
  );
}
