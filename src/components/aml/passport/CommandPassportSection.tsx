import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCcw, ShieldCheck } from "lucide-react";
import { amlRelianceApi } from "@/lib/aml/amlRelianceApi";
import type { PassportStamp, PassportView } from "@/lib/aml/passport";
import { PassportStateBadge } from "./PassportStateBadge";
import { StampSeal } from "./StampSeal";
import { classifyPassportLoadFailure } from "./loadState";
import { PassportControls } from "./PassportControls";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { cn } from "@/lib/utils";
import {
  formatPassportCurrency as formatCurrency,
  formatPassportDate as formatDate,
  formatPassportDateTime as formatDateTime,
  formatStampDate,
} from "./format";

/**
 * Command Centre Compliance Passport — the RESULTING RECORD of the AML/CTF
 * journey, projected server-side by `get_passport_view`.
 *
 * Reading and acting are separated: the pages present the record, and
 * `PassportControls` invokes the EXISTING canonical operations (client
 * request, attestation issue, grant, service-gate decision). No control
 * here writes state directly, and every restricted action carries the
 * server's own MLRO gate plus a mandatory reason.
 *
 * When the `aml_passport_command_view` flag is off the server answers 404
 * `passport_disabled` and this component renders NOTHING — the workspace
 * behaves exactly as it did before the Passport existed.
 */

type LoadState =
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "error"; message: string }
  | { kind: "ready"; view: PassportView };

export function CommandPassportSection({
  caseId, initialPage = "overview",
}: { caseId: string; initialPage?: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [openStamp, setOpenStamp] = useState<PassportStamp | null>(null);
  const access = useAmlAccess();

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const { passport } = await amlRelianceApi.getPassportView(caseId);
      setState({ kind: "ready", view: passport });
    } catch (e: unknown) {
      const failure = classifyPassportLoadFailure(e);
      if (failure.kind === "disabled") {
        setState({ kind: "disabled" });
      } else {
        setState({ kind: "error", message: failure.message });
      }
    }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  if (state.kind === "disabled") return null;

  if (state.kind === "loading") {
    return (
      <Card className="glass-panel">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading the Compliance Passport…
        </CardContent>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>The Compliance Passport could not be loaded</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{state.message}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const view = state.view;
  const { header } = view;

  return (
    <div className="passport-scope space-y-4">
      {/* ── identity strip ────────────────────────────────────────────── */}
      <Card className="glass-panel">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
          <div className="min-w-0 flex-1 basis-64">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="truncate text-lg font-semibold">{header.subject ?? "Compliance Passport"}</h2>
              {header.subject_type ? (
                <Badge variant="secondary" className="uppercase">{header.subject_type}</Badge>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">{header.credential ?? "Not yet issued"}</span>
              {header.case_reference ? <span>Case {header.case_reference}</span> : null}
              <span>Issued by {header.issuer_org}</span>
              {header.officer_label ? <span>Officer {header.officer_label}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PassportStateBadge state={header.state} />
            {header.current_version_label ? (
              <Badge variant="outline" className="font-mono">{header.current_version_label}</Badge>
            ) : null}
            {header.evidence_fingerprint_short ? (
              <span
                className="font-mono text-xs text-muted-foreground"
                title={header.evidence_fingerprint ?? undefined}
                aria-label="Evidence fingerprint"
              >
                {header.evidence_fingerprint_short}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <PassportControls caseId={caseId} view={view} isMlro={access.isMlro} onChanged={() => void load()} />

      {header.state.reasons.length > 0 && header.state.code !== "issued_current" ? (
        <p className="text-xs text-muted-foreground">
          Derivation: {header.state.reasons.join(" · ")}
        </p>
      ) : null}

      {/* ── pages ─────────────────────────────────────────────────────── */}
      <Tabs defaultValue={initialPage}>
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="journey">Journey</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="identity">Identity</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
          <TabsTrigger value="ownership">Ownership &amp; Control</TabsTrigger>
          <TabsTrigger value="screening">Screening</TabsTrigger>
          <TabsTrigger value="funding">Funding &amp; EDD</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="partners">Partner access</TabsTrigger>
          <TabsTrigger value="stamps">Stamps</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewPage view={view} />
        </TabsContent>

        <TabsContent value="identity" className="mt-4">
          <Card className="glass-panel">
            <CardHeader><CardTitle className="text-base">Identity profile</CardTitle></CardHeader>
            <CardContent>
              {view.identity.fields.length === 0 ? (
                <EmptyNote text="No identity information has been submitted yet." />
              ) : (
                <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  {view.identity.fields.map((f) => (
                    <div key={f.key}>
                      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{f.label}</dt>
                      <dd className="mt-0.5 text-sm">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="verification" className="mt-4 space-y-3">
          {view.verification.parties.length === 0 ? (
            <Card className="glass-panel"><CardContent className="py-6"><EmptyNote text="No verification has been recorded yet." /></CardContent></Card>
          ) : view.verification.parties.map((p) => (
            <Card key={p.party} className="glass-panel">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">{p.party}</CardTitle>
                <Badge variant="outline" className={p.verified ? "border-success/40 text-success" : "text-muted-foreground"}>
                  {p.verified ? "Verified" : "Not verified"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {p.components.map((c, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-4 border-b border-border/40 py-1.5 text-sm last:border-0">
                    <span className="capitalize">{c.check_type.replaceAll("_", " ")}</span>
                    <span className="text-xs text-muted-foreground">
                      <span className="capitalize">{c.status.replaceAll("_", " ")}</span>
                      {c.completed_at ? ` · ${formatDateTime(c.completed_at)}` : ""}
                    </span>
                  </div>
                ))}
                <p className="pt-2 text-xs text-muted-foreground">
                  Match scores and provider payloads are held in the case file — they are not part of the Passport.
                </p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="evidence" className="mt-4">
          <Card className="glass-panel">
            <CardHeader><CardTitle className="text-base">Evidence wallet</CardTitle></CardHeader>
            <CardContent>
              {view.documents.length === 0 ? (
                <EmptyNote text="No documents have been provided yet." />
              ) : (
                <div className="space-y-1.5">
                  {view.documents.map((d) => (
                    <div key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/40 py-2 text-sm last:border-0">
                      <span className="min-w-0 flex-1 basis-48 truncate">
                        {d.label}
                        {d.version_number && d.version_number > 1 ? (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">v{d.version_number}</span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {d.uploaded_at ? formatDateTime(d.uploaded_at) : ""}
                      </span>
                      <Badge variant="outline" className="capitalize">{d.status.replaceAll("_", " ")}</Badge>
                    </div>
                  ))}
                  <p className="pt-2 text-xs text-muted-foreground">
                    Files open through the case workspace's secure viewer; the Passport lists what is held, never where it is stored.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions" className="mt-4">
          <Card className="glass-panel">
            <CardHeader><CardTitle className="text-base">Transactions & matters</CardTitle></CardHeader>
            <CardContent>
              {view.transactions.length === 0 ? (
                <EmptyNote text="No transactions are linked to this case." />
              ) : (
                <div className="space-y-3">
                  {view.transactions.map((t) => (
                    <div key={t.id} className="rounded-md border border-border/50 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{t.property_address ?? "Property"}</span>
                        {t.status ? <Badge variant="outline" className="capitalize">{t.status.replaceAll("_", " ")}</Badge> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                        {t.kind ? <span className="capitalize">{t.kind}</span> : null}
                        {t.contract_date ? <span>Contract {formatDate(t.contract_date)}</span> : null}
                        {t.settlement_date ? <span>Settlement {formatDate(t.settlement_date)}</span> : null}
                        {typeof t.purchase_price === "number" ? <span>{formatCurrency(t.purchase_price)}</span> : null}
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Transaction management stays in its own workspaces — this page records why the Passport is relied on.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="partners" className="mt-4">
          <Card className="glass-panel">
            <CardHeader><CardTitle className="text-base">Partner access & reliance</CardTitle></CardHeader>
            <CardContent>
              {!view.partners || view.partners.length === 0 ? (
                <EmptyNote text="No partner organisation is connected to this case. Sharing is managed in the Compliance Sharing panel below." />
              ) : (
                <div className="space-y-3">
                  {view.partners.map((p, i) => (
                    <div key={i} className="rounded-md border border-border/50 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{p.org_name ?? "Partner organisation"}</span>
                        <Badge variant="outline" className="capitalize">
                          {p.assessment_status
                            ? `Decision: ${p.assessment_status.replaceAll("_", " ")}`
                            : p.grant_revoked_at
                              ? "Access revoked"
                              : p.grant_created_at
                                ? "Passport shared"
                                : (p.link_state ?? "Linked")}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                        {p.portal_type ? <span className="capitalize">{p.portal_type.replaceAll("_", " ")} portal</span> : null}
                        {p.legal_route ? <span className="capitalize">Route: {p.legal_route.replaceAll("_", " ")}</span> : null}
                        {p.version_label ? <span>Version received {p.version_label}</span> : null}
                        {p.last_viewed_at ? <span>Last viewed {formatDateTime(p.last_viewed_at)}</span> : null}
                        {p.grant_expires_at && !p.grant_revoked_at ? <span>Expires {formatDate(p.grant_expires_at)}</span> : null}
                        {p.assessor_name ? <span>By {p.assessor_name}</span> : null}
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    A partner decision records that organisation's position only — it never alters this case's assessment.
                  </p>
                  <DisclosureMatrix view={view} />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="journey" className="mt-4">
          <JourneyPage view={view} />
        </TabsContent>

        <TabsContent value="ownership" className="mt-4">
          <OwnershipPage view={view} />
        </TabsContent>

        <TabsContent value="screening" className="mt-4">
          <ScreeningPage view={view} />
        </TabsContent>

        <TabsContent value="funding" className="mt-4">
          <FundingPage view={view} />
        </TabsContent>

        <TabsContent value="stamps" className="mt-4">
          <Card className="glass-panel">
            <CardHeader className="flex-row items-baseline justify-between space-y-0">
              <CardTitle className="text-base">Stamps & certifications</CardTitle>
              <span className="text-xs text-muted-foreground">
                {view.stamps.length} recorded · every stamp opens its underlying record
              </span>
            </CardHeader>
            <CardContent>
              {view.stamps.length === 0 ? (
                <EmptyNote text="No milestones have been recorded yet. Stamps are earned from real case events — they cannot be added by hand." />
              ) : (
                <div className="grid grid-cols-2 justify-items-center gap-5 sm:grid-cols-3 lg:grid-cols-4">
                  {view.stamps.map((s, i) => (
                    <button
                      key={`${s.code}-${s.at}-${i}`}
                      type="button"
                      onClick={() => setOpenStamp(s)}
                      className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label={`${s.title} — ${s.org} — ${formatStampDate(s.at)}`}
                    >
                      <StampSeal stamp={s} />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="versions" className="mt-4">
          <Card className="glass-panel">
            <CardHeader><CardTitle className="text-base">Version register</CardTitle></CardHeader>
            <CardContent>
              {view.versions.length === 0 ? (
                <EmptyNote text="No Passport version has been issued yet. Issuance is an MLRO action in the Compliance Sharing panel." />
              ) : (
                <div className="space-y-1.5">
                  <p className="pb-1 text-xs text-muted-foreground">
                    An issued version is immutable. Material change supersedes it and issues a successor; partners holding an
                    earlier version are told theirs is obsolete.
                  </p>
                  {[...view.versions].reverse().map((v) => (
                    <div key={v.version} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/40 py-2 text-sm last:border-0">
                      <span className="font-mono font-semibold">{v.label}</span>
                      <Badge variant="outline" className={v.state === "current" ? "border-success/40 text-success" : "text-muted-foreground"}>
                        {v.state === "current" ? "Current" : v.state === "initial_issue" ? "Initial issue" : "Superseded"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {v.issued_at ? `Issued ${formatDateTime(v.issued_at)}` : ""}
                        {v.superseded_at ? ` · superseded ${formatDateTime(v.superseded_at)}` : ""}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{v.fingerprint_short}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card className="glass-panel">
            <CardHeader className="flex-row items-baseline justify-between space-y-0">
              <CardTitle className="text-base">Passport history</CardTitle>
              <span className="text-xs text-muted-foreground">Append-only · hash-chained case events</span>
            </CardHeader>
            <CardContent>
              {view.history.length === 0 ? (
                <EmptyNote text="No events yet." />
              ) : (
                <ol className="space-y-0">
                  {view.history.map((h, i) => (
                    <li key={h.id ?? `${h.at}-${i}`} className="flex gap-3 border-b border-border/40 py-2 text-sm last:border-0">
                      <span className="w-36 shrink-0 font-mono text-xs text-muted-foreground">{formatDateTime(h.at)}</span>
                      <span className="min-w-0 flex-1">{h.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{h.source}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── stamp record dialog ───────────────────────────────────────── */}
      <Dialog open={openStamp !== null} onOpenChange={(open) => { if (!open) setOpenStamp(null); }}>
        <DialogContent className="max-w-md">
          {openStamp ? (
            <>
              <DialogHeader>
                <DialogTitle>{openStamp.title}</DialogTitle>
                <DialogDescription>
                  Generated by a system event against a permission — never authored by hand. Bound to the Passport version
                  current when it was applied.
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-center py-2">
                <StampSeal stamp={openStamp} />
              </div>
              <dl className="space-y-1.5 text-sm">
                <StampRow k="Organisation" v={openStamp.org} />
                <StampRow k="Portal" v={openStamp.portal} />
                <StampRow k="Recorded" v={formatDateTime(openStamp.at)} />
                <StampRow k="Passport version" v={openStamp.version ? `v${openStamp.version}` : "Pre-issuance"} />
                <StampRow k="Authorised by" v={openStamp.actor ?? "System"} />
                <StampRow k="Source record" v={openStamp.source.kind} mono />
              </dl>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── overview page ────────────────────────────────────────────────────── */

function OverviewPage({ view }: { view: PassportView }) {
  const verifiedParties = view.verification.parties.filter((p) => p.verified).length;
  const acceptedDocs = view.documents.filter((d) => d.status === "accepted").length;
  const tiles: Array<{ k: string; v: string; meta: string }> = [
    {
      k: "Identity",
      v: view.verification.parties.length === 0
        ? "Not started"
        : `${verifiedParties} of ${view.verification.parties.length} verified`,
      meta: "Verification page",
    },
    {
      k: "Evidence",
      v: view.documents.length === 0 ? "None" : `${acceptedDocs} of ${view.documents.length} accepted`,
      meta: "Evidence wallet",
    },
    ...(view.screening ? [{
      k: "Screening",
      v: view.screening.performed
        ? `${view.screening.subjects_completed} of ${view.screening.subjects_total} resolved`
        : "Not performed",
      meta: view.screening.last_completed_at ? `Current as at ${formatDate(view.screening.last_completed_at)}` : "—",
    }] : []),
    ...(view.funding ? [{
      k: "Funding",
      v: view.funding.sof_total === 0 && view.funding.sow_total === 0
        ? "Not recorded"
        : `SoF ${view.funding.sof_verified}/${view.funding.sof_total} · SoW ${view.funding.sow_verified}/${view.funding.sow_total}`,
      meta: view.funding.edd_present ? (view.funding.edd_completed ? "EDD completed" : "EDD open") : "EDD not required",
    }] : []),
    {
      k: "Partners",
      v: view.partners && view.partners.length > 0 ? `${view.partners.length} connected` : "None connected",
      meta: "Partner access page",
    },
    {
      k: "Transactions",
      v: view.transactions.length === 0 ? "None linked" : `${view.transactions.length} linked`,
      meta: "Transactions page",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.k} className="glass-panel">
            <CardContent className="py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t.k}</div>
              <div className="mt-1 text-sm font-medium">{t.v}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{t.meta}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-panel">
        <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1 basis-64">
            <div className="font-medium">
              {view.header.evidence_fingerprint
                ? `Digitally verified by ${view.header.issuer_org}`
                : "Not yet issued — the journey is still building this record"}
            </div>
            {view.header.evidence_fingerprint ? (
              <div className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                {view.header.evidence_fingerprint} · SHA-256 evidence fingerprint
              </div>
            ) : null}
          </div>
          {view.header.last_issued_at ? (
            <span className="text-xs text-muted-foreground">Sealed {formatDateTime(view.header.last_issued_at)}</span>
          ) : null}
          {view.header.evidence_fingerprint ? <AuthenticityDialog view={view} /> : null}
        </CardContent>
      </Card>

      {view.open_requests.length > 0 ? (
        <Alert>
          <AlertTitle>Open client requests</AlertTitle>
          <AlertDescription>
            {view.open_requests.length} request{view.open_requests.length === 1 ? "" : "s"} awaiting the client — managed in
            the Requests section of this workspace.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/* ── journey (design page 00) ──────────────────────────────────────────── */

function JourneyPage({ view }: { view: PassportView }) {
  const j = view.journey;
  return (
    <div className="space-y-4">
      <Card className="glass-panel">
        <CardContent className="flex flex-wrap items-center gap-4 py-4">
          <ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1 basis-72">
            <div className="text-sm font-medium">
              The Passport is generated from this journey — it is not a separate record.
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Every milestone below is recorded only when its underlying evidence exists. Completing one updates the
              Passport in the same moment.
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold tabular-nums">{j.recorded} of {j.total}</div>
            <div className="text-xs text-muted-foreground">milestones recorded</div>
          </div>
        </CardContent>
      </Card>

      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={j.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${j.recorded} of ${j.total} milestones recorded`}
      >
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${j.percent}%` }} />
      </div>

      {j.phases.map((phase) => (
        <section key={phase.phase} className="space-y-2">
          <div className="flex items-center gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {phase.label}
            </h3>
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-[11px] text-muted-foreground">
              {phase.recorded}/{phase.total}
            </span>
          </div>
          <div className="space-y-2">
            {phase.milestones.map((m) => (
              <Card key={m.code} className={m.recorded ? "glass-panel" : "border-dashed"}>
                <CardContent className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]",
                      m.recorded ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground",
                    )}
                    aria-hidden="true"
                  >
                    {m.ordinal}
                  </span>
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{m.title}</span>
                      <Badge variant="outline" className="text-[10px]">{m.portal}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{m.detail}</p>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      <span aria-hidden="true">↳ </span>Populates <span className="text-primary">{m.feeds}</span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge variant="outline" className={m.recorded ? "border-success/40 text-success" : "text-muted-foreground"}>
                      {m.recorded ? "Recorded" : "Pending"}
                    </Badge>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {m.at ? formatDateTime(m.at) : "—"}
                    </div>
                    {m.actor ? <div className="text-[11px] text-muted-foreground">{m.actor}</div> : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ── ownership & control (design page 04) ──────────────────────────────── */

function OwnershipPage({ view }: { view: PassportView }) {
  const parties = view.ownership;
  const ubos = parties.filter((p) => p.is_ubo).length;
  const controllers = parties.filter((p) => p.party_kind === "authorised_representative").length;
  const verified = parties.filter((p) => p.verified).length;

  return (
    <div className="space-y-4">
      <Card className="glass-panel">
        <CardHeader className="flex-row items-baseline justify-between space-y-0">
          <CardTitle className="text-base">Control structure</CardTitle>
          {parties.length > 0 ? (
            <Badge variant="outline" className={verified === parties.length ? "border-success/40 text-success" : "text-muted-foreground"}>
              {verified === parties.length ? "Ownership & control verified" : `${verified} of ${parties.length} verified`}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {parties.length === 0 ? (
            <EmptyNote text="No beneficial owners or controllers have been recorded for this customer." />
          ) : (
            <div className="space-y-1.5">
              {parties.map((p, i) => (
                <div
                  key={`${p.name}-${i}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/40 py-2 text-sm last:border-0"
                >
                  <span className="min-w-0 flex-1 basis-48">
                    <span className="font-medium">{p.name}</span>
                    {p.relationship ? (
                      <span className="ml-2 text-xs capitalize text-muted-foreground">
                        {p.relationship.replaceAll("_", " ")}
                      </span>
                    ) : null}
                  </span>
                  {p.is_ubo ? <Badge variant="secondary" className="text-[10px]">UBO</Badge> : null}
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {typeof p.ownership_percent === "number" ? `${p.ownership_percent}%` : "—"}
                  </span>
                  <Badge variant="outline" className={p.verified ? "border-success/40 text-success" : "text-muted-foreground"}>
                    {(p.verification_state ?? "unverified").replaceAll("_", " ")}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {parties.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { k: "Parties", v: String(parties.length) },
            { k: "Beneficial owners", v: String(ubos) },
            { k: "Representatives", v: String(controllers) },
          ].map((t) => (
            <Card key={t.k} className="glass-panel">
              <CardContent className="py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t.k}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{t.v}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── screening (design page 05) ────────────────────────────────────────── */

const NEVER_SHARED = [
  "Candidate matches", "Dismissed matches", "Match scores", "Internal suspicion",
  "MLRO reasoning", "Suspicious matter reporting", "Law-enforcement correspondence",
];

function ScreeningPage({ view }: { view: PassportView }) {
  const s = view.screening;
  if (!s) return <EmptyNote text="Screening detail is not available in this view." />;

  const lists = Object.entries(s.list_freshness ?? {});
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="glass-panel">
          <CardHeader><CardTitle className="text-sm">Screening performed</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row k="Subjects screened" v={`${s.subjects_completed} of ${s.subjects_total}`} />
            <Row k="Last completed" v={s.last_completed_at ? formatDateTime(s.last_completed_at) : "—"} />
            <Row k="Outcome" v={s.performed ? "Recorded against every identified party" : "Not yet performed"} />
          </CardContent>
        </Card>
        <Card className="glass-panel">
          <CardHeader><CardTitle className="text-sm">PEP determination</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row k="Result" v={s.pep_result ? s.pep_result.replaceAll("_", " ") : "Not determined"} />
            <Row k="Determined" v={s.pep_determined_at ? formatDateTime(s.pep_determined_at) : "—"} />
          </CardContent>
        </Card>
      </div>

      {lists.length > 0 ? (
        <Card className="glass-panel">
          <CardHeader><CardTitle className="text-sm">List currency</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {lists.map(([code, at]) => (
              <Row key={code} k={code.toUpperCase()} v={formatDate(at)} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* The design's internal-boundary panel — honest copy over a guarantee
          the attestation contract already enforces. */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Internal boundary — not part of the Passport
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 max-w-prose text-xs text-muted-foreground">
            The Passport records that required screening occurred. It is not the investigation file. The following is
            held in the AML case, never in a Passport view, and never disclosed to a partner portal.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {NEVER_SHARED.map((n) => (
              <span key={n} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground">
                <span aria-hidden="true">✕ </span>{n}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── funding & EDD (design page 06) ────────────────────────────────────── */

function FundingPage({ view }: { view: PassportView }) {
  const f = view.funding;
  if (!f) return <EmptyNote text="Funding detail is not available in this view." />;
  const nothing = f.sof_total === 0 && f.sow_total === 0 && !f.edd_present;

  return (
    <div className="space-y-4">
      {nothing ? (
        <EmptyNote text="No source of funds, source of wealth or enhanced due diligence has been recorded for this customer." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="glass-panel">
            <CardHeader><CardTitle className="text-sm">Source of funds</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Row k="Components recorded" v={String(f.sof_total)} />
              <Row k="Evidenced" v={`${f.sof_verified} of ${f.sof_total}`} />
            </CardContent>
          </Card>
          <Card className="glass-panel">
            <CardHeader><CardTitle className="text-sm">Source of wealth</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Row k="Components recorded" v={String(f.sow_total)} />
              <Row k="Evidenced" v={`${f.sow_verified} of ${f.sow_total}`} />
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="glass-panel">
        <CardHeader><CardTitle className="text-sm">Compliance position</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <Row
            k="Enhanced due diligence"
            v={f.edd_present ? (f.edd_completed ? "Completed" : "Open") : "Not required"}
          />
          <p className="pt-2 text-xs text-muted-foreground">
            Evidence collected and the compliance decision made on it are recorded separately. The decision and its
            reasoning remain internal to the AML case.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/40 pb-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className="text-right text-sm capitalize">{v}</span>
    </div>
  );
}

/* ── disclosure matrix (design page 09) ────────────────────────────────── */

function DisclosureMatrix({ view }: { view: PassportView }) {
  const partners = view.partners ?? [];
  const withManifest = partners.filter((p) => (p.disclosure ?? []).length > 0);
  if (withManifest.length === 0) {
    return (
      <p className="pt-3 text-xs text-muted-foreground">
        No disclosure manifest is recorded for the connected organisations. A manifest exists once the Passport is
        shared under attestation v2 — until then, disclosure is governed by the arrangement itself.
      </p>
    );
  }

  const classes = [...new Set(withManifest.flatMap((p) => (p.disclosure ?? []).map((d) => d.code)))].sort();

  return (
    <div className="pt-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Disclosure matrix</h4>
      <p className="mt-1 max-w-prose text-xs text-muted-foreground">
        The Passport is shared; not every organisation receives every evidence class. Disclosure is set per
        organisation and read from the stored manifest.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <caption className="sr-only">Authorised disclosure by organisation and evidence class</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-border py-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Evidence class
              </th>
              {withManifest.map((p, i) => (
                <th key={i} scope="col" className="border-b border-border px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {p.org_name ?? "Partner"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classes.map((code) => (
              <tr key={code}>
                <th scope="row" className="border-b border-border/40 py-2 pr-3 text-left font-normal capitalize">
                  {code.replaceAll("_", " ")}
                </th>
                {withManifest.map((p, i) => {
                  const cell = (p.disclosure ?? []).find((d) => d.code === code);
                  const state = cell?.state ?? "withheld";
                  return (
                    <td key={i} className="border-b border-border/40 px-2 py-2 text-center">
                      <Badge
                        variant="outline"
                        className={
                          state === "granted" ? "border-success/40 text-success"
                            : state === "limited" ? "border-warning/40 text-warning"
                              : "text-muted-foreground"
                        }
                      >
                        {state === "granted" ? "Granted" : state === "limited" ? "Limited" : "Withheld"}
                      </Badge>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── authenticity ──────────────────────────────────────────────────────── */

function AuthenticityDialog({ view }: { view: PassportView }) {
  const [open, setOpen] = useState(false);
  const h = view.header;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Verify integrity
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Digitally verified by {h.issuer_org}</DialogTitle>
            <DialogDescription>
              The fingerprint is a SHA-256 over the sealed evidence manifest of this version. An issued version is
              immutable, so a matching fingerprint proves the content has not changed since it was sealed.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-1.5 text-sm">
            <StampRow k="Credential" v={h.credential ?? "—"} mono />
            <StampRow k="Version" v={h.current_version_label ?? "—"} mono />
            <StampRow k="Sealed" v={h.last_issued_at ? formatDateTime(h.last_issued_at) : "—"} />
            <StampRow k="State" v={h.state.label} />
          </dl>
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Evidence fingerprint
            </div>
            <div className="mt-1 break-all font-mono text-xs">{h.evidence_fingerprint}</div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── small helpers ────────────────────────────────────────────────────── */

function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

function StampRow({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/40 pb-1.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className={mono ? "font-mono text-xs" : "text-sm"}>{v}</dd>
    </div>
  );
}

