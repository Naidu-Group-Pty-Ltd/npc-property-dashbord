/**
 * Onboard a partner and grant passport access — one guided pass.
 *
 * Chains the four existing `aml-reliance` acts in the order the server
 * requires them: record the canonical organisation → record the written
 * CDD arrangement → link the partner to this case (with a recorded legal
 * route and purpose) → grant access. The final screen hands over the
 * ONE-TIME access token: the partner's portal integration redeems it, so
 * the partner does not need to sign up before the passport reaches them.
 *
 * Rules this deliberately keeps (the server enforces all of them):
 *   - MLRO only — every step is outward-facing restricted configuration.
 *   - The client's sharing consent is a precondition of the grant
 *     (APP 6); a known-missing consent blocks with the reason named, an
 *     UNKNOWN reading is a caution and never a pass.
 *   - Created records are cached per step, so a failure midway retries
 *     from where it stopped instead of duplicating what already exists.
 *   - Nothing here bypasses a server refusal — a 409/403 surfaces in
 *     place with its reason.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Copy, Check, ShieldCheck } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { amlCasesApi } from "@/lib/aml/amlCasesApi";
import {
  amlRelianceApi, type PartnerOrganisation, type RelianceAgreement,
} from "@/lib/aml/amlRelianceApi";
import {
  LEGAL_ROUTE_CHOICES, PARTNER_PORTAL_CHOICES, PREBUILT_AGREEMENT_TITLE,
  defaultPurpose, defaultReviewDate, grantReadiness, isoDate,
  portalHasPrebuiltAgreement, prebuiltArrangementDraft,
} from "@/lib/aml/partnerOnboarding.pure";

type WizardStep = "partner" | "arrangement" | "link" | "grant" | "token";

/* Numbered at render time — the arrangement step exists only for a
 * partner OUTSIDE the portals. A portal partner's arrangement is the
 * prebuilt Compliance Passport agreement, executed at their sign-up. */
const STEP_TITLES: Record<Exclude<WizardStep, "token">, string> = {
  partner: "The partner",
  arrangement: "The written arrangement",
  link: "Why they may access this matter",
  grant: "Grant passport access",
};

function ChoiceCard({ selected, label, meaning, onSelect }: {
  selected: boolean; label: string; meaning: string; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "rounded-md border p-2.5 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/50",
      )}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-xs text-muted-foreground">{meaning}</span>
    </button>
  );
}

export function PartnerOnboardingWizard({
  open, onOpenChange, caseId, attestationVersion, organisations, agreements, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  /** Current attestation version on the case, null when none is issued. */
  attestationVersion: number | null;
  /** Already-recorded organisations and arrangements, for reuse. */
  organisations: PartnerOrganisation[];
  agreements: RelianceAgreement[];
  onDone: () => void | Promise<void>;
}) {
  const [step, setStep] = useState<WizardStep>("partner");
  const [busy, setBusy] = useState(false);

  /* Step 1 — the partner. Reusing a recorded organisation is offered
   * first: a free-text name is not an identity. */
  const [existingOrgId, setExistingOrgId] = useState<string | null>(null);
  const [legalName, setLegalName] = useState("");
  const [portal, setPortal] = useState(PARTNER_PORTAL_CHOICES[0].value);
  const [abn, setAbn] = useState("");

  /* Step 2 — the written arrangement. */
  const [existingAgreementId, setExistingAgreementId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [executedOn, setExecutedOn] = useState(() => isoDate(new Date()));
  const [reviewDue, setReviewDue] = useState(() => defaultReviewDate(new Date()));

  /* Step 3 — the case link. */
  const [role, setRole] = useState(PARTNER_PORTAL_CHOICES[0].role);
  const [legalRoute, setLegalRoute] = useState(LEGAL_ROUTE_CHOICES[0].value);
  const [purpose, setPurpose] = useState("");

  /* Step 4 — readiness, from the case's own record. */
  const [sharingConsent, setSharingConsent] = useState<boolean | null>(null);

  /* What each completed server act created — retrying never duplicates. */
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  const [createdAgreement, setCreatedAgreement] = useState<RelianceAgreement | null>(null);
  const [linkRecorded, setLinkRecorded] = useState(false);

  /* The one-time token, shown exactly once. */
  const [grantResult, setGrantResult] = useState<{ token: string; expires_at: string; version: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const portalChoice = PARTNER_PORTAL_CHOICES.find((p) => p.value === portal)!;
  const activeAgreements = agreements.filter((a) => a.status === "active");
  const chosenOrg = organisations.find((o) => o.id === existingOrgId) ?? null;
  const partnerName = chosenOrg?.legal_name ?? legalName.trim();

  /* A portal partner's arrangement is PREBUILT: the Portal Access &
   * AML/CTF Compliance Passport Agreement their sign-up executes (its
   * binding_amlctf_arrangement acknowledgement is the s 37A statement,
   * and sign-up is refused without it). The manual arrangement step
   * exists only for a partner outside the portals. */
  const prebuilt = portalHasPrebuiltAgreement(portal);
  const stepOrder: WizardStep[] = prebuilt
    ? ["partner", "link", "grant"]
    : ["partner", "arrangement", "link", "grant"];
  /* An arrangement already on the register for this partner is reused
   * silently — auto or manual, one register row per partner is enough. */
  const reusableAgreement = activeAgreements.find(
    (a) => a.partner_org_name.toLowerCase() === partnerName.toLowerCase(),
  ) ?? null;

  /* Reset per open, so a second onboarding never inherits the first. */
  useEffect(() => {
    if (!open) return;
    setStep("partner");
    setExistingOrgId(null); setLegalName(""); setPortal(PARTNER_PORTAL_CHOICES[0].value); setAbn("");
    setExistingAgreementId(null); setReference("");
    setExecutedOn(isoDate(new Date())); setReviewDue(defaultReviewDate(new Date()));
    setRole(PARTNER_PORTAL_CHOICES[0].role);
    setLegalRoute(LEGAL_ROUTE_CHOICES[0].value);
    setPurpose("");
    setCreatedOrgId(null); setCreatedAgreement(null); setLinkRecorded(false);
    setGrantResult(null); setCopied(false);
  }, [open]);

  /* The client's sharing consent, read softly — unknown stays unknown. */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    amlCasesApi.consentStatus(caseId)
      .then((res) => {
        if (!alive) return;
        const doc = (res.documents ?? []).find((d) => d.code === "compliance_sharing");
        setSharingConsent(doc ? doc.accepted_at !== null : null);
      })
      .catch(() => { if (alive) setSharingConsent(null); });
    return () => { alive = false; };
  }, [open, caseId]);

  /* The default role and purpose follow the chosen portal until edited. */
  const applyPortal = (value: typeof portal) => {
    const prev = PARTNER_PORTAL_CHOICES.find((p) => p.value === portal)!;
    setPortal(value);
    const next = PARTNER_PORTAL_CHOICES.find((p) => p.value === value)!;
    if (role === prev.role) setRole(next.role);
  };

  const readiness = useMemo(
    () => grantReadiness({ attestationVersion, sharingConsent }),
    [attestationVersion, sharingConsent],
  );

  const partnerValid = existingOrgId !== null || legalName.trim().length > 1;
  const arrangementValid = existingAgreementId !== null
    || (reference.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(executedOn) && /^\d{4}-\d{2}-\d{2}$/.test(reviewDue));
  const effectivePurpose = purpose.trim() || defaultPurpose(portalChoice.label, role);
  const linkValid = role.trim().length > 0 && effectivePurpose.length >= 10;

  /**
   * The chain, run when the operator confirms the grant. Each act caches
   * its result so a retry resumes rather than duplicates. The link is
   * recorded before the grant (it is the access root that explains WHY);
   * an already-existing link is fine and does not stop the grant.
   */
  const completeGrant = async () => {
    setBusy(true);
    try {
      // 1 · The canonical organisation.
      let orgId = existingOrgId ?? createdOrgId;
      if (!orgId) {
        const { partner_organisation } = await amlRelianceApi.upsertPartnerOrganisation({
          legal_name: legalName.trim(),
          organisation_type: portal,
          abn: abn.trim() || undefined,
          portal_types: portal === "other" ? [] : [portal],
        });
        orgId = partner_organisation.id;
        setCreatedOrgId(orgId);
      }

      // 2 · The written arrangement — PREBUILT for a portal partner (the
      //     Compliance Passport agreement their sign-up executes; the
      //     register row is recorded automatically against it), manual
      //     only for a partner outside the portals. An active register
      //     row for this partner is reused either way.
      let agreement = existingAgreementId
        ? activeAgreements.find((a) => a.id === existingAgreementId) ?? null
        : createdAgreement ?? reusableAgreement;
      if (!agreement) {
        const draft = prebuilt
          ? prebuiltArrangementDraft(new Date())
          : {
              agreement_reference: reference.trim(),
              executed_on: executedOn,
              next_review_due: reviewDue,
            };
        const res = await amlRelianceApi.createAgreement({
          partner_org_name: partnerName,
          partner_org_type: portal,
          partner_abn: abn.trim() || undefined,
          ...draft,
        });
        agreement = res.agreement;
        setCreatedAgreement(agreement);
      }

      // 3 · The case link — the recorded reason this organisation may see
      //     this matter. An existing identical link is not an error.
      if (!linkRecorded) {
        try {
          await amlRelianceApi.linkPartnerToCase({
            case_id: caseId, partner_org_id: orgId,
            portal_type: portal, relationship_role: role.trim(),
            legal_route: legalRoute, purpose: effectivePurpose,
          });
          setLinkRecorded(true);
        } catch (e: any) {
          if (/already exists/i.test(String(e?.message ?? ""))) {
            setLinkRecorded(true);
          } else {
            throw e;
          }
        }
      }

      // 4 · The grant — the server re-checks every precondition.
      const res = await amlRelianceApi.grantAccess(caseId, agreement.id);
      setGrantResult({
        token: res.access_token,
        expires_at: res.grant.expires_at,
        version: res.grant.attestation_version,
      });
      setStep("token");
      await onDone();
    } catch (e: any) {
      toast({
        title: "Partner onboarding stopped",
        description: `${e?.message ?? "The request failed."} What was already recorded is kept — fixing the cause and confirming again resumes from there.`,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!grantResult) return;
    try {
      await navigator.clipboard.writeText(grantResult.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({ title: "Copy failed", description: "Select the token text and copy it manually.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{step === "token" ? "Partner access granted" : "Onboard a partner & grant passport access"}</DialogTitle>
          <DialogDescription>
            {step === "token"
              ? "The token below is shown once. The partner's portal redeems it — no sign-up is needed before the passport reaches them."
              : "One pass records the organisation, the written CDD arrangement and the case link, then grants access. Every rule is still enforced server-side."}
          </DialogDescription>
        </DialogHeader>

        {/* Progress — where this pass is, in words. Numbered at render
            time, because a portal partner has no arrangement step. */}
        {step !== "token" && (
          <ol className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" aria-label="Onboarding steps">
            {stepOrder.map((s, i) => (
              <li key={s} className={cn(
                "uppercase tracking-wide",
                s === step ? "font-semibold text-primary" : "text-muted-foreground",
              )}>
                {i + 1} · {STEP_TITLES[s as Exclude<WizardStep, "token">]}
              </li>
            ))}
          </ol>
        )}

        {step === "partner" && (
          <div className="space-y-3 text-sm">
            {organisations.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Use a recorded partner organisation</Label>
                <div role="radiogroup" aria-label="Recorded partner organisations" className="grid gap-2">
                  {organisations.filter((o) => o.status === "active").map((o) => (
                    <ChoiceCard
                      key={o.id}
                      selected={existingOrgId === o.id}
                      label={o.legal_name}
                      meaning={`${o.organisation_type.replace(/_/g, " ")}${o.abn ? ` · ABN ${o.abn}` : ""}`}
                      onSelect={() => setExistingOrgId(existingOrgId === o.id ? null : o.id)}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">— or record a new one below.</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pow-legal-name" className="text-xs">Legal name</Label>
              <Input
                id="pow-legal-name"
                placeholder="e.g. Meridian Finance Group Pty Ltd"
                value={legalName}
                disabled={existingOrgId !== null}
                onChange={(e) => setLegalName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Which portal will they use?</Label>
              <div role="radiogroup" aria-label="Partner portal" className="grid gap-2 sm:grid-cols-2">
                {PARTNER_PORTAL_CHOICES.map((p) => (
                  <ChoiceCard
                    key={p.value}
                    selected={portal === p.value}
                    label={p.label}
                    meaning={p.meaning}
                    onSelect={() => applyPortal(p.value)}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pow-abn" className="text-xs">ABN (optional)</Label>
              <Input id="pow-abn" placeholder="11 digits" value={abn}
                disabled={existingOrgId !== null}
                onChange={(e) => setAbn(e.target.value)} />
            </div>
          </div>
        )}

        {step === "arrangement" && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              A partner outside the portals has no sign-up to carry the prebuilt agreement, so
              the written CDD arrangement (AML/CTF Act Pt 2 Div 7) is recorded here. It must be
              reviewed regularly — an overdue review blocks new grants. The agreement itself
              lives with legal; this records it.
            </p>
            {activeAgreements.some((a) => a.partner_org_name.toLowerCase() === partnerName.toLowerCase()) && (
              <div className="space-y-1.5">
                <Label className="text-xs">An arrangement with this partner already exists</Label>
                <div role="radiogroup" aria-label="Existing arrangements" className="grid gap-2">
                  {activeAgreements
                    .filter((a) => a.partner_org_name.toLowerCase() === partnerName.toLowerCase())
                    .map((a) => (
                      <ChoiceCard
                        key={a.id}
                        selected={existingAgreementId === a.id}
                        label={a.agreement_reference}
                        meaning={`Review due ${new Date(a.next_review_due).toLocaleDateString()}`}
                        onSelect={() => setExistingAgreementId(existingAgreementId === a.id ? null : a.id)}
                      />
                    ))}
                </div>
                <p className="text-[11px] text-muted-foreground">— or record a new one below.</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pow-reference" className="text-xs">Written agreement reference</Label>
              <Input id="pow-reference" placeholder="e.g. CDD-2026-014" value={reference}
                disabled={existingAgreementId !== null}
                onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pow-executed" className="text-xs">Executed on</Label>
                <Input id="pow-executed" type="date" value={executedOn}
                  disabled={existingAgreementId !== null}
                  onChange={(e) => setExecutedOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pow-review" className="text-xs">Next review due</Label>
                <Input id="pow-review" type="date" value={reviewDue}
                  disabled={existingAgreementId !== null}
                  onChange={(e) => setReviewDue(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {step === "link" && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              The link records why {partnerName || "this organisation"} may access this matter.
              It grants nothing by itself — the legal route is a recorded decision, never
              inferred from the portal.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="pow-role" className="text-xs">Relationship role</Label>
              <Input id="pow-role" value={role} onChange={(e) => setRole(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Legal route</Label>
              <div role="radiogroup" aria-label="Legal route" className="grid gap-2 sm:grid-cols-2">
                {LEGAL_ROUTE_CHOICES.map((r) => (
                  <ChoiceCard
                    key={r.value}
                    selected={legalRoute === r.value}
                    label={r.label}
                    meaning={r.meaning}
                    onSelect={() => setLegalRoute(r.value)}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pow-purpose" className="text-xs">Documented purpose</Label>
              <textarea
                id="pow-purpose"
                className="min-h-[56px] w-full rounded-md border border-input bg-background p-2 text-sm"
                placeholder={defaultPurpose(portalChoice.label, role)}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Left empty, the suggested wording above is recorded.
              </p>
            </div>
          </div>
        )}

        {step === "grant" && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-border/60 p-3 text-xs space-y-1">
              <div><span className="font-medium">Partner:</span> {partnerName} · {portalChoice.label}</div>
              <div>
                <span className="font-medium">Arrangement:</span>{" "}
                {existingAgreementId
                  ? activeAgreements.find((a) => a.id === existingAgreementId)?.agreement_reference
                  : reusableAgreement
                    ? `${reusableAgreement.agreement_reference} (already recorded)`
                    : prebuilt
                      ? `Prebuilt — ${PREBUILT_AGREEMENT_TITLE} (recorded automatically)`
                      : `${reference.trim() || "—"} (new, review due ${reviewDue})`}
              </div>
              <div><span className="font-medium">Legal route:</span> {LEGAL_ROUTE_CHOICES.find((r) => r.value === legalRoute)?.label}</div>
              <div>
                <span className="font-medium">They will receive:</span>{" "}
                attestation v{attestationVersion ?? "—"} — what was performed, never this case&apos;s risk assessment.
              </div>
            </div>
            {readiness.blockers.map((b) => (
              <p key={b} className="text-[11px] text-warning">{b}</p>
            ))}
            {readiness.cautions.map((c) => (
              <p key={c} className="text-[11px] text-muted-foreground">{c}</p>
            ))}
            {prebuilt && !existingAgreementId && !reusableAgreement && (
              <p className="text-xs text-muted-foreground">
                No arrangement to type: the partner&apos;s binding acknowledgement of that
                agreement — including the s&nbsp;37A arrangement statement — is a mandatory part
                of their portal sign-up, and the executed copy lands in Partner Agreement
                Records.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Confirming records anything not yet recorded, then grants access and shows the
              partner&apos;s one-time token. The client sees their completed compliance in their
              own portal — nothing extra is asked of them.
            </p>
          </div>
        )}

        {step === "token" && grantResult && (
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              <p className="text-xs">
                {partnerName} now holds a grant on attestation v{grantResult.version}, expiring{" "}
                {new Date(grantResult.expires_at).toLocaleDateString()}. Their portal redeems the
                token below — they see what was performed, never this case&apos;s risk assessment.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">One-time access token — copy it now</Label>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md border border-border/60 bg-muted/40 p-2 text-xs">
                  {grantResult.token}
                </code>
                <Button size="sm" variant="outline" onClick={copyToken} aria-label="Copy access token">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Deliver it to the partner through their usual channel. It is shown once — the
                platform stores only its hash, and a lost token means revoking this grant and
                issuing another.
                {prebuilt && (
                  " When they take up portal access they acknowledge the prebuilt Compliance Passport agreement as part of sign-up — nothing more is needed from you."
                )}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step !== "token" && step !== "partner" && (
            <Button variant="ghost" disabled={busy}
              onClick={() => setStep(stepOrder[stepOrder.indexOf(step) - 1])}>
              Back
            </Button>
          )}
          {step === "partner" && (
            <Button disabled={!partnerValid}
              onClick={() => setStep(prebuilt ? "link" : "arrangement")}>
              Continue
            </Button>
          )}
          {step === "arrangement" && (
            <Button disabled={!arrangementValid} onClick={() => setStep("link")}>Continue</Button>
          )}
          {step === "link" && (
            <Button disabled={!linkValid} onClick={() => setStep("grant")}>Continue</Button>
          )}
          {step === "grant" && (
            <Button disabled={busy || !readiness.ready} onClick={completeGrant}>
              {busy && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Record &amp; grant access
            </Button>
          )}
          {step === "token" && (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
