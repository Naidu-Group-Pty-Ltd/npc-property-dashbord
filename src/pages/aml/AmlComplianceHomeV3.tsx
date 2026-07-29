import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  FileSignature,
  Gauge,
  Info,
  ListChecks,
  Lock,
  ShieldCheck,
  Settings2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import { amlMonitoringApi, type AmlMonitoringSummary } from "@/lib/aml/amlMonitoringApi";
import { amlFinanceApi } from "@/lib/aml/amlFinanceApi";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { hasAmlCapability, type AmlCapability } from "@/lib/aml/permissions";
import { suggestAmlLanding } from "@/lib/aml/defaultLanding";
import { CASE_STAGE_LABELS, caseStage } from "@/lib/aml/caseDimensions";

/**
 * AML V3 — Compliance Home (directive §8, completed in tri-portal Phase 2).
 *
 * Operational, role-adaptive landing rendered when
 * `feature_flags.aml_v3_compliance_home = true`; otherwise the legacy V2
 * overview renders unchanged.
 *
 * Answers the four §8 questions directly:
 *  1. What requires attention?   → priority work queue
 *  2. Which clients are blocked? → queue reasons + stage badges
 *  3. What is approaching a deadline? → reviews due / overdue metrics
 *  4. What should I do next?     → next-best-action header
 *
 * Rules honoured (AGENTS.md): no role chips or dev metadata; everything is
 * derived from effective capabilities; restricted metrics are omitted from
 * render entirely for users without the capability (their server payloads are
 * already scoped); empty states are actionable.
 */

interface ActionEntry {
  key: string;
  label: string;
  description: string;
  to: string;
  cta: string;
  icon: LucideIcon;
  capability: AmlCapability;
  variant?: "default" | "primary";
}

const ACTION_CATALOG: ActionEntry[] = [
  {
    key: "cases",
    label: "Customer cases",
    description: "Continue any customer compliance case or open the register.",
    to: "/admin/aml/cases",
    cta: "Open case register",
    icon: Users,
    capability: "aml.view",
  },
  {
    key: "monitoring",
    label: "Monitoring & alerts",
    description: "Triage open alerts and unprocessed rule-engine events.",
    to: "/admin/aml/monitoring",
    cta: "Open monitoring",
    icon: Bell,
    capability: "aml.investigate",
  },
  {
    key: "transactions",
    label: "Transactions",
    description: "Investigate flagged transactions and reporting triggers.",
    to: "/admin/aml/transactions",
    cta: "Open transactions",
    icon: Gauge,
    capability: "aml.investigate",
  },
  {
    key: "austrac",
    label: "AUSTRAC Hub",
    description: "Regulatory report drafting, approval and lodgement.",
    to: "/admin/aml/austrac",
    cta: "Open AUSTRAC Hub",
    icon: FileSignature,
    capability: "aml.report",
    variant: "primary",
  },
  {
    key: "finance",
    label: "Funding & Finance",
    description: "Funding reconciliation and finance discrepancies.",
    to: "/admin/aml/finance",
    cta: "Open Funding & Finance",
    icon: Wallet,
    capability: "aml.investigate",
  },
  {
    key: "configuration",
    label: "Organisation Settings",
    description: "Program, thresholds, providers and terminology.",
    to: "/admin/aml/configuration",
    cta: "Open settings",
    icon: Settings2,
    capability: "aml.configure",
  },
];

/** Priority queue entry derived from an actionable case. */
interface QueueEntry {
  caseRow: AmlCase;
  reason: string;
  action: string;
  urgency: 1 | 2 | 3; // 1 = highest
}

function queueEntriesFrom(
  escalated: AmlCase[],
  awaitingReview: AmlCase[],
  enhancedCdd: AmlCase[],
): QueueEntry[] {
  const entries: QueueEntry[] = [
    ...escalated.map((c): QueueEntry => ({
      caseRow: c,
      reason: "Awaiting decision",
      action: "Decide",
      urgency: 1,
    })),
    ...enhancedCdd.map((c): QueueEntry => ({
      caseRow: c,
      reason: "Additional information required",
      action: "Review requirements",
      urgency: 2,
    })),
    ...awaitingReview.map((c): QueueEntry => ({
      caseRow: c,
      reason: "Client submission awaiting review",
      action: "Start review",
      urgency: 3,
    })),
  ];
  return entries.sort((a, b) =>
    a.urgency - b.urgency ||
    (b.caseRow.updated_at ?? "").localeCompare(a.caseRow.updated_at ?? ""),
  );
}

export default function AmlComplianceHomeV3() {
  const { roles, loading: accessLoading } = useAmlAccess();

  const canView = hasAmlCapability(roles, "aml.view");
  const canInvestigate = hasAmlCapability(roles, "aml.investigate");
  const canReport = hasAmlCapability(roles, "aml.report");
  const canConfigure = hasAmlCapability(roles, "aml.configure");

  const [loadingCases, setLoadingCases] = useState(true);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [recent, setRecent] = useState<AmlCase[]>([]);
  const [escalated, setEscalated] = useState<AmlCase[]>([]);
  const [awaitingReview, setAwaitingReview] = useState<AmlCase[]>([]);
  const [enhancedCdd, setEnhancedCdd] = useState<AmlCase[]>([]);
  const [counts, setCounts] = useState<{
    onboarding: number; awaitingReview: number; enhancedCdd: number; escalated: number;
  } | null>(null);

  const [monitoring, setMonitoring] = useState<AmlMonitoringSummary | null>(null);
  const [loadingMonitoring, setLoadingMonitoring] = useState(false);
  const [openDiscrepancies, setOpenDiscrepancies] = useState<number | null>(null);

  useEffect(() => {
    if (!canView) return;
    let alive = true;
    (async () => {
      try {
        setLoadingCases(true);
        const [recentRes, escalatedRes, reviewRes, eddRes, onboardingRes] = await Promise.all([
          amlCasesApi.list({ limit: 5 }),
          amlCasesApi.list({ status: "escalated_mlro", limit: 5 }),
          amlCasesApi.list({ status: "kyc_complete", limit: 5 }),
          amlCasesApi.list({ status: "edd_required", limit: 5 }),
          amlCasesApi.list({ status: "kyc_in_progress", limit: 1 }),
        ]);
        if (!alive) return;
        setRecent(recentRes.cases ?? []);
        setEscalated(escalatedRes.cases ?? []);
        setAwaitingReview(reviewRes.cases ?? []);
        setEnhancedCdd(eddRes.cases ?? []);
        setCounts({
          onboarding: onboardingRes.total ?? 0,
          awaitingReview: reviewRes.total ?? 0,
          enhancedCdd: eddRes.total ?? 0,
          escalated: escalatedRes.total ?? 0,
        });
      } catch (e: any) {
        if (alive) setCaseError(e?.message ?? "Unable to load cases");
      } finally {
        if (alive) setLoadingCases(false);
      }
    })();
    return () => { alive = false; };
  }, [canView]);

  useEffect(() => {
    if (!canInvestigate) return;
    let alive = true;
    (async () => {
      try {
        setLoadingMonitoring(true);
        const [summary, discrepancies] = await Promise.all([
          amlMonitoringApi.summary().catch(() => null),
          amlFinanceApi.listDiscrepancies({ status: "open" }).catch(() => null),
        ]);
        if (!alive) return;
        setMonitoring(summary);
        setOpenDiscrepancies(discrepancies ? (discrepancies.discrepancies ?? []).length : null);
      } finally {
        if (alive) setLoadingMonitoring(false);
      }
    })();
    return () => { alive = false; };
  }, [canInvestigate]);

  const queue = useMemo(
    () => queueEntriesFrom(escalated, awaitingReview, enhancedCdd).slice(0, 8),
    [escalated, awaitingReview, enhancedCdd],
  );

  const landing = useMemo(() => suggestAmlLanding(roles), [roles]);
  const visibleActions = useMemo(
    () => ACTION_CATALOG.filter((a) => hasAmlCapability(roles, a.capability)),
    [roles],
  );

  // Next best action: the top of the priority queue wins; otherwise the
  // capability-derived landing suggestion.
  const nextBest = useMemo(() => {
    const top = queue[0];
    if (top) {
      return {
        title: `${top.reason} — ${top.caseRow.subject_display_name}`,
        detail: top.caseRow.case_reference,
        to: `/admin/aml/cases?open=${top.caseRow.id}`,
        cta: top.action,
      };
    }
    if (landing) {
      return {
        title: "Nothing urgent in your queues",
        detail: landing.reason,
        to: landing.path,
        cta: landing.label,
      };
    }
    return null;
  }, [queue, landing]);

  // Actionable no-access state.
  if (!accessLoading && roles.size === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">You don't have access yet</h2>
            <p className="text-sm text-muted-foreground">
              The AML/CTF workspace is visible, but acting in it needs an access grant.
            </p>
          </div>
        </div>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Request access</AlertTitle>
          <AlertDescription>
            Ask your compliance administrator to grant you AML access from{" "}
            <Link className="underline" to="/admin/users">User Management</Link>. Queues and
            restricted areas appear automatically once access is granted.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Next best action — operational, not generic. */}
      {nextBest && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                <ListChecks className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{nextBest.title}</div>
                <div className="text-xs text-muted-foreground">{nextBest.detail}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to={nextBest.to}>
                  {nextBest.cta}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              {canReport && nextBest.to !== "/admin/aml/austrac" && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/aml/austrac">
                    Open AUSTRAC Hub
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Operational metrics — customer pipeline (aml.view) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          title="Onboarding in progress"
          icon={Users}
          loading={loadingCases}
          value={counts?.onboarding ?? "—"}
          hint="Clients currently completing onboarding."
          to="/admin/aml/cases"
        />
        <MetricTile
          title="Submissions to review"
          icon={ListChecks}
          loading={loadingCases}
          value={counts?.awaitingReview ?? "—"}
          hint="Client submissions awaiting staff review."
          to="/admin/aml/cases"
        />
        <MetricTile
          title="Enhanced CDD"
          icon={ShieldCheck}
          loading={loadingCases}
          value={counts?.enhancedCdd ?? "—"}
          hint="Cases needing additional information."
          to="/admin/aml/cases"
        />
        <MetricTile
          title="Awaiting decision"
          icon={Gauge}
          loading={loadingCases}
          value={counts?.escalated ?? "—"}
          hint="Escalated cases awaiting a decision."
          to="/admin/aml/cases"
        />
      </div>

      {/* Operational metrics — monitoring and finance (aml.investigate) */}
      {canInvestigate && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            title="Open alerts"
            icon={Bell}
            loading={loadingMonitoring}
            value={monitoring?.open_alerts ?? "—"}
            hint={monitoring ? `${monitoring.critical_alerts} critical` : "Awaiting first data refresh."}
            to="/admin/aml/monitoring"
          />
          <MetricTile
            title="Unprocessed events"
            icon={Gauge}
            loading={loadingMonitoring}
            value={monitoring?.unprocessed_events ?? "—"}
            hint="Rule engine backlog."
            to="/admin/aml/monitoring"
          />
          <MetricTile
            title="Reviews due"
            icon={ShieldCheck}
            loading={loadingMonitoring}
            value={monitoring?.pending_reviews ?? "—"}
            hint={monitoring ? `${monitoring.overdue_reviews} overdue` : "Awaiting first data refresh."}
            to="/admin/aml/monitoring"
          />
          <MetricTile
            title="Funding discrepancies"
            icon={Wallet}
            loading={loadingMonitoring}
            value={openDiscrepancies ?? "—"}
            hint="Open finance discrepancies to resolve."
            to="/admin/aml/finance"
          />
        </div>
      )}

      {caseError && (
        <Alert variant="destructive">
          <AlertTitle>Unable to load cases</AlertTitle>
          <AlertDescription>{caseError}</AlertDescription>
        </Alert>
      )}

      {/* Priority work queue — what requires attention, with a direct action. */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Priority work queue</CardTitle>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/aml/cases">Open case register →</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Escalations first, then additional-information cases, then submissions to review.
          </p>
        </CardHeader>
        <CardContent>
          {loadingCases ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : queue.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 p-4 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing needs attention right now. New client submissions, additional-information
                cases and escalations will appear here the moment they need someone.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {queue.map(({ caseRow: c, reason, action }) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.subject_display_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.case_reference} · {reason}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{CASE_STAGE_LABELS[caseStage(c)]}</Badge>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/admin/aml/cases?open=${c.id}`}>{action}</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Action-led "Do next" — only capabilities the user actually holds. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your workspaces</CardTitle>
          <p className="text-xs text-muted-foreground">
            Areas available to you right now.
          </p>
        </CardHeader>
        <CardContent>
          {visibleActions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No workspaces yet — ask your compliance administrator for access to get started.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {visibleActions.map((a) => {
                const Icon = a.icon;
                return (
                  <li
                    key={a.key}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card/40 p-3"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{a.label}</div>
                        <div className="text-xs text-muted-foreground">{a.description}</div>
                      </div>
                    </div>
                    <Button
                      asChild
                      size="sm"
                      variant={a.variant === "primary" ? "default" : "outline"}
                      className="shrink-0"
                    >
                      <Link to={a.to}>{a.cta}</Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Latest cases with actionable empty state */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Latest cases</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loadingCases ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : recent.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 p-4 text-center">
              <p className="text-sm text-muted-foreground">
                No cases yet. Cases open when a client is activated for compliance from their
                client record — nothing is generated automatically from marketing leads.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link to="/clients">Find a client to activate</Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {recent.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.subject_display_name}</div>
                    <div className="text-xs text-muted-foreground">{c.case_reference}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.risk_rating && (
                      <Badge variant="outline" className="capitalize">
                        {c.risk_rating}
                      </Badge>
                    )}
                    <Badge variant="secondary">{CASE_STAGE_LABELS[caseStage(c)]}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface MetricTileProps {
  title: string;
  icon: LucideIcon;
  loading: boolean;
  value: number | string;
  hint: string;
  to?: string;
}

function MetricTile({ title, icon: Icon, loading, value, hint, to }: MetricTileProps) {
  const body = (
    <Card className={to ? "transition-colors hover:border-primary/40" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="text-3xl font-semibold">{value}</div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
  return to ? (
    <Link
      to={to}
      className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
