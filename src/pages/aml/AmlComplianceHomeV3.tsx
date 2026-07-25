import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  FileSignature,
  Gauge,
  Info,
  Lock,
  PlayCircle,
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
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { hasAmlCapability, type AmlCapability } from "@/lib/aml/permissions";
import { suggestAmlLanding } from "@/lib/aml/defaultLanding";

/**
 * AML V3 — Phase 3 Compliance Home (Directives 5 & 6).
 *
 * Action-led, role-adaptive landing. Rendered when
 * `feature_flags.aml_v3_compliance_home = true`. Otherwise the legacy
 * V2 overview continues to render (byte-identical).
 *
 * Rules honoured (AGENTS.md):
 *  - No role chips, no dev metadata.
 *  - Landing recommendation derived from **effective capabilities**
 *    (`useAmlAccess`), never from a client-side role string.
 *  - Restricted metrics (reporting SLA, configuration health) are hidden
 *    entirely for users lacking the underlying capability — no blurred
 *    placeholder, no count leak (tipping-off protection).
 *  - "Open AUSTRAC Hub" affordance is always surfaced to holders of
 *    `aml.report` and never to anyone else.
 *  - Empty states are actionable (explain + next step).
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
    description: "Investigate flagged transactions, TTR and IFTI triggers.",
    to: "/admin/aml/transactions",
    cta: "Open transactions",
    icon: Gauge,
    capability: "aml.investigate",
  },
  {
    key: "austrac",
    label: "AUSTRAC Hub",
    description: "SMR / TTR / IFTI drafting, MLRO approval and lodgement.",
    to: "/admin/aml/austrac",
    cta: "Open AUSTRAC Hub",
    icon: FileSignature,
    capability: "aml.report",
    variant: "primary",
  },
  {
    key: "finance",
    label: "Funding & Finance",
    description: "Service-entitlement gate and downstream finance handoff.",
    to: "/admin/aml/finance",
    cta: "Open Funding & Finance",
    icon: Wallet,
    capability: "aml.investigate",
  },
  {
    key: "configuration",
    label: "Organisation Settings",
    description: "Tenant, thresholds, provider keys and program version.",
    to: "/admin/aml/configuration",
    cta: "Open settings",
    icon: Settings2,
    capability: "aml.configure",
  },
];

export default function AmlComplianceHomeV3() {
  const { roles, loading: accessLoading } = useAmlAccess();

  const canView = hasAmlCapability(roles, "aml.view");
  const canInvestigate = hasAmlCapability(roles, "aml.investigate");
  const canReport = hasAmlCapability(roles, "aml.report");
  const canConfigure = hasAmlCapability(roles, "aml.configure");

  const [loadingCases, setLoadingCases] = useState(true);
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [totalCases, setTotalCases] = useState(0);
  const [caseError, setCaseError] = useState<string | null>(null);

  const [monitoring, setMonitoring] = useState<AmlMonitoringSummary | null>(null);
  const [loadingMonitoring, setLoadingMonitoring] = useState(false);

  useEffect(() => {
    if (!canView) return;
    let alive = true;
    (async () => {
      try {
        setLoadingCases(true);
        const res = await amlCasesApi.list({ limit: 5 });
        if (!alive) return;
        setCases(res.cases ?? []);
        setTotalCases(res.total ?? 0);
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
        const s = await amlMonitoringApi.summary();
        if (alive) setMonitoring(s);
      } catch {
        if (alive) setMonitoring(null);
      } finally {
        if (alive) setLoadingMonitoring(false);
      }
    })();
    return () => { alive = false; };
  }, [canInvestigate]);

  const openCount = useMemo(
    () => cases.filter((c) => !["cleared", "closed", "blocked"].includes(c.status)).length,
    [cases],
  );
  const escalated = useMemo(
    () => cases.filter((c) => c.status === "escalated_mlro").length,
    [cases],
  );

  const landing = useMemo(() => suggestAmlLanding(roles), [roles]);
  const visibleActions = useMemo(
    () => ACTION_CATALOG.filter((a) => hasAmlCapability(roles, a.capability)),
    [roles],
  );

  // Actionable no-access state.
  if (!accessLoading && roles.size === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">No AML role assigned</h2>
            <p className="text-sm text-muted-foreground">
              You can see the AML/CTF workspace but do not yet have a role that lets you act.
            </p>
          </div>
        </div>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Request access</AlertTitle>
          <AlertDescription>
            Ask a superadmin to assign an AML role — analyst, reviewer, MLRO or auditor —
            from <Link className="underline" to="/admin/users">User Management</Link>. Access
            is granted per capability, so restricted queues stay hidden until you are cleared.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Neutral continuation banner — no role labels, only capability-derived recommendation. */}
      {landing && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                <PlayCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">Continue where you work most</div>
                <div className="text-xs text-muted-foreground">{landing.reason}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to={landing.path}>
                  {landing.label}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              {canReport && landing.path !== "/admin/aml/austrac" && (
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

      {/* Case tiles — always visible for aml.view */}
      <div className="grid gap-4 md:grid-cols-3">
        <MetricTile
          title="Total cases"
          icon={Users}
          loading={loadingCases}
          value={totalCases}
          hint="Across all statuses in this tenant."
        />
        <MetricTile
          title="Open (recent)"
          icon={Gauge}
          loading={loadingCases}
          value={openCount}
          hint={`Of the latest ${cases.length || 0} cases, still under investigation.`}
        />
        <MetricTile
          title="Escalated → MLRO"
          icon={ShieldCheck}
          loading={loadingCases}
          value={escalated}
          hint="Awaiting MLRO decision."
        />
      </div>

      {/* Investigate tiles */}
      {canInvestigate && (
        <div className="grid gap-4 md:grid-cols-3">
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
            title="Periodic reviews"
            icon={ShieldCheck}
            loading={loadingMonitoring}
            value={monitoring?.pending_reviews ?? "—"}
            hint={monitoring ? `${monitoring.overdue_reviews} overdue` : "Awaiting first data refresh."}
            to="/admin/aml/monitoring"
          />
        </div>
      )}

      {caseError && (
        <Alert variant="destructive">
          <AlertTitle>Unable to load cases</AlertTitle>
          <AlertDescription>{caseError}</AlertDescription>
        </Alert>
      )}

      {/* Action-led "Do next" — only capabilities the user actually holds. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Do next</CardTitle>
          <p className="text-xs text-muted-foreground">
            Actions available to you right now, based on your assigned capabilities.
          </p>
        </CardHeader>
        <CardContent>
          {visibleActions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No actionable queues yet — request an AML role to get started.
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
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/aml/cases">Open case register →</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingCases ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : cases.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 p-4 text-center">
              <p className="text-sm text-muted-foreground">
                No cases yet. Cases are only created after a human-confirmed client
                activation — nothing is auto-generated from marketing leads.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link to="/admin/aml/cases">Go to Case register</Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {cases.map((c) => (
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
                    <Badge variant="secondary" className="capitalize">
                      {c.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Nothing more leaks below for users without report/configure capability. */}
      {!canReport && !canConfigure && (
        <p className="text-xs text-muted-foreground">
          Reporting and configuration surfaces are restricted and only appear for MLRO users.
        </p>
      )}
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
