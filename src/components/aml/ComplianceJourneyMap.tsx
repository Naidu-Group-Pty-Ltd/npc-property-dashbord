import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  FileText, ShieldCheck, BadgeCheck, Share2, User, Landmark, HardHat,
  Building2, Scale, Check, Circle, AlertTriangle,
} from "lucide-react";
import type { AmlCase } from "@/lib/aml/amlCasesApi";
import { amlRelianceApi, type IndependentAssessment, type RelianceGrant } from "@/lib/aml/amlRelianceApi";
import {
  FINANCE_PORTAL_STATUS_LABELS, PARTNER_COMPLIANCE_STATE_LABELS,
  partnerComplianceState, type AmlPartnerComplianceState,
} from "@/lib/aml/caseDimensions";

/**
 * Compliance Journey Map — the owner's five-portal flow diagram, rendered as
 * a living surface at the top of every case.
 *
 * Four stages across the top and the five portal tiles beneath, each fed from
 * data the module already records. This component COMPUTES nothing about
 * compliance — every state shown here is a projection of decisions made
 * elsewhere (the service gate is still only ever moved by an explicit human
 * decision; a partner's assessment is still only ever theirs). It is a map,
 * not a control panel.
 *
 * Partner tiles read `partnerComplianceState` from `caseDimensions` — the
 * same canonical dimension the rest of the module uses — rather than deriving
 * their own. The tile vocabulary therefore cannot drift from the domain, and
 * in particular cannot reacquire a label asserting that an origin approval
 * made a downstream organisation compliant.
 *
 * Styling: semantic tokens only, per FRONTEND_TOOLING.md — no raw palette
 * classes, so the map inherits both themes for free.
 */

type StageState = "done" | "active" | "todo";

function stageStates(caseRow: AmlCase, hasAttestation: boolean, activeGrants: number): StageState[] {
  const portal = String(caseRow.client_portal_status ?? "not_started");
  const gate = String(caseRow.service_gate_status ?? "");
  const submitted = ["submitted", "under_review", "complete"].includes(portal)
    || !["draft", "kyc_in_progress"].includes(String(caseRow.status));
  const approved = ["approved", "approved_with_controls"].includes(gate);
  const shared = hasAttestation && activeGrants > 0;

  const submit: StageState = submitted ? "done" : "active";
  const verify: StageState = approved ? "done" : submitted ? "active" : "todo";
  const approve: StageState = approved ? "done" : submitted ? "active" : "todo";
  const share: StageState = shared ? "done" : approved ? "active" : "todo";
  return [submit, verify, approve, share];
}

const STAGES = [
  { icon: FileText, label: "Client submits", sub: "KYC & onboarding" },
  { icon: ShieldCheck, label: "We verify", sub: "identity · screening" },
  { icon: BadgeCheck, label: "Approved", sub: "human decision" },
  // "Available to" — not "shared with", and never "compliant". Issuing a
  // passport makes our evidence reusable; it does not discharge any
  // downstream organisation's own obligations.
  { icon: Share2, label: "Available", sub: "reusable evidence" },
] as const;

interface PortalTile {
  key: string;
  label: string;
  icon: typeof User;
  status: string;
  tone: "done" | "progress" | "attention" | "idle";
}

/**
 * Tone carries emphasis only — the label is always the accessible answer,
 * so no state is distinguishable by colour alone.
 */
const PARTNER_STATE_TONE: Record<AmlPartnerComplianceState, PortalTile["tone"]> = {
  not_linked: "idle",
  independent_cdd: "progress",
  passport_available: "progress",
  under_partner_review: "progress",
  records_requested: "attention",
  partner_satisfied: "done",
  refresh_required: "attention",
  revoked: "attention",
};

function portalTiles(
  caseRow: AmlCase,
  grants: RelianceGrant[],
  assessments: IndependentAssessment[],
  attestationRefreshRequired: boolean,
): PortalTile[] {
  // Group by partner type through the agreement each grant carries. A
  // determination is reached via its own agreement_id, so a partner whose
  // access has since been revoked still resolves to its tile rather than
  // silently falling back to "Not linked".
  const grantsOfType = (t: string) =>
    grants.filter((g) => g.reliance_agreements?.partner_org_type === t);
  const determinationsOfType = (t: string) => {
    const agreementIds = new Set(grantsOfType(t).map((g) => g.agreement_id));
    return assessments.filter((a) => agreementIds.has(a.agreement_id));
  };

  const partnerTile = (key: string, label: string, icon: typeof User): PortalTile => {
    const state = partnerComplianceState({
      grants: grantsOfType(key),
      determinations: determinationsOfType(key),
      attestationRefreshRequired,
    });
    return {
      key, label, icon,
      status: PARTNER_COMPLIANCE_STATE_LABELS[state],
      tone: PARTNER_STATE_TONE[state],
    };
  };

  const portal = String(caseRow.client_portal_status ?? "not_started");
  const finance = String(caseRow.finance_portal_status ?? "not_requested");

  // Finance keeps its own dimension: `finance_portal_status` is the funding
  // reconciliation loop and is not interchangeable with partner reliance
  // state. Where finance holds a passport the partner state is the more
  // specific fact and wins; with no partner link the funding loop shows
  // through, so a finance partner mid-reconciliation never reads "Not
  // linked" just because no passport was issued.
  const financeTile = (): PortalTile => {
    const passport = partnerTile("finance", "Finance portal", Landmark);
    if (passport.status !== PARTNER_COMPLIANCE_STATE_LABELS.not_linked) return passport;
    if (finance === "not_requested") return passport;
    return {
      ...passport,
      status: FINANCE_PORTAL_STATUS_LABELS[
        finance as keyof typeof FINANCE_PORTAL_STATUS_LABELS
      ] ?? finance.replace(/_/g, " "),
      tone: "progress",
    };
  };

  return [
    {
      key: "client", label: "Client portal", icon: User,
      status: portal === "complete" ? "Complete"
        : ["submitted", "under_review"].includes(portal) ? "Submitted"
        : portal === "in_progress" ? "In progress" : "Invited",
      tone: portal === "complete" ? "done"
        : portal === "not_started" ? "idle" : "progress",
    },
    financeTile(),
    partnerTile("builder", "Builder portal", HardHat),
    partnerTile("developer", "Developer portal", Building2),
    partnerTile("solicitor_conveyancer", "Solicitors & conveyancers", Scale),
  ];
}

export function ComplianceJourneyMap({ caseRow }: { caseRow: AmlCase }) {
  const [grants, setGrants] = useState<RelianceGrant[]>([]);
  const [assessments, setAssessments] = useState<IndependentAssessment[]>([]);
  const [hasAttestation, setHasAttestation] = useState(false);
  const [attestationRefreshRequired, setAttestationRefreshRequired] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      amlRelianceApi.listGrants(caseRow.id).catch(() => ({ grants: [] })),
      amlRelianceApi.listAssessments(caseRow.id).catch(() => ({ assessments: [] })),
      amlRelianceApi.listAttestations(caseRow.id).catch(() => ({ attestations: [] })),
    ]).then(([g, a, at]) => {
      if (!alive) return;
      const attestations = at.attestations ?? [];
      const operative = attestations.filter((x) => !x.superseded_at);
      setGrants(g.grants ?? []);
      setAssessments(a.assessments ?? []);
      setHasAttestation(operative.length > 0);
      // Flagged but not yet superseded: content has stopped being served
      // while the MLRO decides whether to re-issue.
      setAttestationRefreshRequired(
        operative.length > 0 && operative.every((x) => Boolean(x.refresh_required_at)),
      );
    });
    return () => { alive = false; };
  }, [caseRow.id]);

  const states = stageStates(caseRow, hasAttestation, grants.filter((g) => !g.revoked_at).length);
  const tiles = portalTiles(caseRow, grants, assessments, attestationRefreshRequired);
  const doneCount = states.filter((s) => s === "done").length;

  return (
    <Card className="overflow-hidden border-primary/20">
      <CardContent className="p-5">
        {/* ── the journey ─────────────────────────────────────────────── */}
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Compliance journey</h3>
          <Badge variant="outline" className="text-xs text-muted-foreground">
            One collection · each organisation decides for itself
          </Badge>
        </div>

        <ol className="relative mt-4 grid grid-cols-4 gap-2" aria-label="Compliance journey stages">
          {/* connector rail: track + progress fill */}
          <div aria-hidden className="absolute left-[12.5%] right-[12.5%] top-5 h-1 rounded-full bg-muted" />
          <div
            aria-hidden
            className="absolute left-[12.5%] top-5 h-1 rounded-full bg-primary transition-all duration-700"
            style={{ width: `${(Math.max(doneCount - 0.5, 0) / 4) * 100}%`, maxWidth: "75%" }}
          />
          {STAGES.map((stage, i) => {
            const state = states[i];
            const Icon = stage.icon;
            return (
              <li key={stage.label} className="relative z-10 flex flex-col items-center text-center">
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border-2 bg-card transition-colors",
                    state === "done" && "border-primary bg-primary text-primary-foreground",
                    state === "active" && "border-primary text-primary animate-pulse",
                    state === "todo" && "border-border text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {state === "done" ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </span>
                <span className={cn(
                  "mt-2 text-xs font-medium",
                  state === "todo" ? "text-muted-foreground" : "text-foreground",
                )}>
                  {stage.label}
                </span>
                <span className="text-[10px] text-muted-foreground">{stage.sub}</span>
                <span className="sr-only">
                  {state === "done" ? "complete" : state === "active" ? "in progress" : "not started"}
                </span>
              </li>
            );
          })}
        </ol>

        {/* ── the five portals ────────────────────────────────────────── */}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <div
                key={tile.key}
                className={cn(
                  "rounded-lg border p-2.5 text-center transition-colors",
                  tile.tone === "done" && "border-success/40 bg-success/5",
                  tile.tone === "progress" && "border-primary/40 bg-primary/5",
                  tile.tone === "attention" && "border-warning/40 bg-warning/5",
                  tile.tone === "idle" && "border-border/60",
                )}
              >
                <Icon className={cn(
                  "mx-auto h-4 w-4",
                  tile.tone === "done" ? "text-success"
                    : tile.tone === "attention" ? "text-warning"
                    : tile.tone === "progress" ? "text-primary" : "text-muted-foreground",
                )} aria-hidden />
                <div className="mt-1 truncate text-[11px] font-medium" title={tile.label}>
                  {tile.label}
                </div>
                <div className={cn(
                  "flex items-center justify-center gap-1 text-[10px]",
                  tile.tone === "done" ? "text-success"
                    : tile.tone === "attention" ? "text-warning"
                    : tile.tone === "progress" ? "text-primary" : "text-muted-foreground",
                )}>
                  {tile.tone === "done"
                    ? <Check className="h-2.5 w-2.5" aria-hidden />
                    : tile.tone === "attention"
                    ? <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                    : <Circle className="h-2 w-2" aria-hidden />}
                  <span className="truncate" title={tile.status}>{tile.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
