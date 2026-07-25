import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Gauge,
  ShieldCheck,
  Users,
  Info,
  Bell,
  Settings2,
  ArrowRight,
  Lock,
} from "lucide-react";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import { amlMonitoringApi, type AmlMonitoringSummary } from "@/lib/aml/amlMonitoringApi";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { hasAmlCapability, type AmlCapability } from "@/lib/aml/permissions";
import { suggestAmlLanding } from "@/lib/aml/defaultLanding";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import AmlComplianceHomeV3 from "./AmlComplianceHomeV3";

/**
 * Phase 2 — Compliance Home (role-adaptive).
 *
 * All tiles and queue links are derived from the user's **effective
 * capabilities** returned by `useAmlAccess`. Restricted metric counts
 * (reporting SLA, configuration health) are never rendered — not even
 * as blurred placeholders — for users lacking the underlying capability,
 * to comply with tipping-off protections in AGENTS.md §2.
 */

interface QueueLink {
  key: string;
  label: string;
  description: string;
  to: string;
  cta: string;
  capability: AmlCapability;
}

const QUEUE_LINKS: QueueLink[] = [
  {
    key: "cases",
    label: "Customer Case register",
    description: "Search, open and continue any customer compliance case.",
    to: "/admin/aml/cases",
    cta: "Open register",
    capability: "aml.view",
  },
  {
    key: "monitoring",
    label: "Monitoring & alerts",
    description: "Triage open alerts, unprocessed events and periodic reviews.",
    to: "/admin/aml/monitoring",
    cta: "Open monitoring",
    capability: "aml.investigate",
  },
  {
    key: "investigations",
    label: "Investigations & EDD",
    description: "Progress EDD workstreams and evidence-backed decisions.",
    to: "/admin/aml/investigations",
    cta: "Open investigations",
    capability: "aml.investigate",
  },
  {
    key: "transactions",
    label: "Transactions",
    description: "Investigate flagged transactions and IFTI/TTR triggers.",
    to: "/admin/aml/transactions",
    cta: "Open transactions",
    capability: "aml.investigate",
  },
  {
    key: "austrac",
    label: "AUSTRAC Hub",
    description: "SMR / TTR / IFTI drafting, MLRO approval and lodgement.",
    to: "/admin/aml/austrac",
    cta: "Open AUSTRAC Hub",
    capability: "aml.report",
  },
  {
    key: "configuration",
    label: "Configuration",
    description: "Tenant, thresholds, provider keys and program version.",
    to: "/admin/aml/configuration",
    cta: "Open configuration",
    capability: "aml.configure",
  },
];

export default function AmlOverview() {
  const { complianceHome: v3Home, loading: v3Loading } = useAmlV3Flags();

  // Phase 3 (V3) — swap to the action-led Compliance Home when the
  // `aml_v3_compliance_home` feature flag is on. Default false → V2 renders.
  if (!v3Loading && v3Home) {
    return <AmlComplianceHomeV3 />;
  }

  return <AmlOverviewV2 />;
}

function AmlOverviewV2() {
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
      } catch (e) {
        // silent — tile shows unavailable state
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

  const visibleQueues = useMemo(
    () => QUEUE_LINKS.filter((q) => hasAmlCapability(roles, q.capability)),
    [roles],
  );

  // No access at all — actionable empty state.
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
      {/* Role-adaptive landing hint */}
      {landing && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium">Continue where you work most</div>
              <div className="text-xs text-muted-foreground">{landing.reason}</div>
            </div>
            <Button asChild size="sm">
              <Link to={landing.path}>
                {landing.label}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
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

      {/* Investigate-only tiles: monitoring queue snapshot */}
      {canInvestigate && (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricTile
            title="Open alerts"
            icon={Bell}
            loading={loadingMonitoring}
            value={monitoring?.open_alerts ?? "—"}
            hint={
              monitoring
                ? `${monitoring.critical_alerts} critical`
                : "Awaiting first data refresh."
            }
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
            hint={
              monitoring
                ? `${monitoring.overdue_reviews} overdue`
                : "Awaiting first data refresh."
            }
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

      {/* Queue directory — only entries the user can reach */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your queues</CardTitle>
          <p className="text-xs text-muted-foreground">
            Workspaces available to you right now, based on your assigned capabilities.
          </p>
        </CardHeader>
        <CardContent>
          {visibleQueues.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No actionable queues yet — request an AML role to get started.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {visibleQueues.map((q) => (
                <li
                  key={q.key}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card/40 p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{q.label}</div>
                    <div className="text-xs text-muted-foreground">{q.description}</div>
                  </div>
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <Link to={q.to}>{q.cta}</Link>
                  </Button>
                </li>
              ))}
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

      {/* Restricted-capability affordances live in tiles above; nothing more
          leaks into the home for users without the underlying permission. */}
      {!canReport && !canConfigure && (
        <p className="text-xs text-muted-foreground">
          Reporting and configuration surfaces are restricted and only appear for MLRO users.
        </p>
      )}
      {(canReport || canConfigure) && (
        <div className="flex flex-wrap gap-2">
          {canConfigure && (
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/aml/configuration">
                <Settings2 className="mr-2 h-4 w-4" />
                Configuration
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

interface MetricTileProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
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
  return to ? <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg">{body}</Link> : body;
}
