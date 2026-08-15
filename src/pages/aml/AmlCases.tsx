import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, Loader2, Plus, Search, ShieldAlert, ShieldCheck, ToggleLeft } from "lucide-react";

import { ActivateClientDialog } from "@/components/aml/ActivateClientDialog";
import { AmlCaseWorkspaceDialog } from "@/components/aml/AmlCaseWorkspaceDialog";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { useAuth } from "@/hooks/useAuth";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import {
  amlCasesApi, AmlCase, AmlCaseStatus, AmlRiskRating,
} from "@/lib/aml/amlCasesApi";
import { CASE_STATUS_LABELS } from "@/lib/aml/caseDimensions";
import {
  deriveAmlCaseAttention, deriveAmlMacroPhase, MACRO_PHASE_LABELS,
  serviceReadinessLabel,
} from "@/lib/aml/workspaceViewModel";
import { ATTENTION_TEXT, READINESS_TEXT } from "@/components/aml/workspace";
import { displayRelative } from "@/lib/aml/displayDate";
import type { AmlJourneyStageId } from "@/lib/aml/journeyModel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  AmlAccessGate,
  AmlEmptyState,
  AmlErrorState,
  AmlPageHeader,
  AmlRefreshButton,
  AmlRiskBadge,
} from "@/components/aml/primitives";

const SUBJECT_TYPE_LABELS: Record<string, string> = {
  individual: "Individual", entity: "Entity / company", trust: "Trust",
};

const RISK_FILTER_LABELS: Record<string, string> = {
  low: "Low", medium: "Medium", high: "High", prohibited: "Prohibited",
};

/**
 * Saved views (directive §10.3): one-click presets over the register filters.
 * Also addressable as `?view=<key>` so Compliance Home metrics can deep-link
 * to the exact queue a count was computed from — every key that has ever been
 * linked is preserved, only the labels were made plainer.
 *
 * Almost every view is a server filter. "Needs attention" is the exception:
 * there is no server-side predicate for it, so it refines the rows the
 * register already loaded using the same row-only reading the Attention
 * column shows. When the register is truncated the page says so rather than
 * implying the count is the whole register.
 */
const SAVED_VIEWS: Array<{
  key: string;
  label: string;
  filters: { status?: string; risk?: string; assignedToMe?: boolean };
  /** Applied to the loaded page, not the query. */
  refine?: (c: AmlCase) => boolean;
}> = [
  { key: "all", label: "All open", filters: {} },
  { key: "my_queue", label: "My cases", filters: { assignedToMe: true } },
  {
    key: "needs_attention",
    label: "Needs attention",
    filters: {},
    refine: (c) => deriveAmlCaseAttention(c).needsAttention,
  },
  { key: "onboarding", label: "Awaiting client", filters: { status: "kyc_in_progress" } },
  { key: "awaiting_review", label: "Awaiting review", filters: { status: "kyc_complete" } },
  { key: "additional_info", label: "Information outstanding", filters: { status: "edd_required" } },
  { key: "awaiting_decision", label: "Ready for decision", filters: { status: "escalated_mlro" } },
  { key: "high_risk", label: "High risk", filters: { risk: "high" } },
  { key: "blocked", label: "Blocked", filters: { status: "blocked" } },
  { key: "cleared", label: "Cleared", filters: { status: "cleared" } },
  { key: "closed", label: "Closed", filters: { status: "closed" } },
];

const PAGE_LIMIT = 100;

export default function AmlCasesPage() {
  const access = useAmlAccess();
  const navigate = useNavigate();
  const { isSuperadmin } = useAuth();
  const { caseWorkspace: fullPageWorkspace, loading: flagsLoading } = useAmlV3Flags();
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Saved-view deep link: ?view=<key> seeds the initial filters
  // synchronously, so a deep-linked mount issues exactly one fetch with the
  // right parameters — never an unfiltered fetch racing the filtered one.
  const [initialViewFilters] = useState(() => {
    const v = searchParams.get("view");
    const preset = SAVED_VIEWS.find((s) => s.key === v) ?? SAVED_VIEWS[0];
    return { key: preset.key, ...preset.filters };
  });
  const [status, setStatus] = useState<string>(initialViewFilters.status ?? "all");
  const [risk, setRisk] = useState<string>(initialViewFilters.risk ?? "all");
  const [assignedToMe, setAssignedToMe] = useState(Boolean(initialViewFilters.assignedToMe));
  const [view, setView] = useState(initialViewFilters.key);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  // Route-based activation handoff: /admin/aml/cases?activateClientId=<id>.
  // Only the client ID travels in the URL — the dialog loads the name and
  // active status server-side from the authoritative record.
  const [activateClientId, setActivateClientId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialTab, setInitialTab] = useState<string | undefined>(undefined);
  // Guards against out-of-order responses when filters change in quick
  // succession: only the newest request may write state.
  const loadSeq = useRef(0);

  const applyView = (key: string) => {
    const v = SAVED_VIEWS.find((s) => s.key === key);
    if (!v) return;
    setView(key);
    setStatus(v.filters.status ?? "all");
    setRisk(v.filters.risk ?? "all");
    setAssignedToMe(Boolean(v.filters.assignedToMe));
  };

  const selectView = (key: string) => {
    applyView(key);
    const next = new URLSearchParams(searchParams);
    if (key === "all") next.delete("view");
    else next.set("view", key);
    setSearchParams(next, { replace: true });
  };

  /** Manual filter changes leave saved-view territory: clear the chip + param. */
  const leaveView = () => {
    setView("");
    if (searchParams.has("view")) {
      const next = new URLSearchParams(searchParams);
      next.delete("view");
      setSearchParams(next, { replace: true });
    }
  };

  /**
   * Open a case, optionally on a named journey stage.
   *
   * Activation used to end at a toast and a case row: the officer had just
   * confirmed a real client and started AML/CTF compliance, and the next
   * thing they needed — get the client into their portal — was somewhere
   * they had to go and find. Handing activation straight to the Client
   * intake stage makes the journey continuous, and it navigates only: the
   * stage is derived from the case's own state either way.
   */
  const openCase = (c: AmlCase, stage?: AmlJourneyStageId) => {
    if (fullPageWorkspace) {
      navigate(`/admin/aml/cases/${c.id}${stage ? `?stage=${stage}` : ""}`);
    } else {
      setActiveId(c.id);
    }
  };

  // Phase 12 · deep-link support from legacy alias banner: /admin/aml/cases?open=<id>&tab=<hint>
  useEffect(() => {
    const openId = searchParams.get("open");
    const tab = searchParams.get("tab") ?? undefined;
    if (openId) {
      setActiveId(openId);
      setInitialTab(tab);
      // Clear query so refresh doesn't reopen sheet unexpectedly.
      const next = new URLSearchParams(searchParams);
      next.delete("open");
      next.delete("tab");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Activation handoff from the client record: ?activateClientId=<client-id>
  // opens the activation dialog preselected on that exact client. The server
  // validates the ID and supplies name/status; an invalid or inaccessible ID
  // surfaces as a clear error inside the dialog rather than a silent no-op.
  useEffect(() => {
    const activateId = searchParams.get("activateClientId");
    if (activateId) {
      setActivateClientId(activateId);
      setActivateOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearActivateParam = () => {
    const next = new URLSearchParams(searchParams);
    if (next.has("activateClientId")) {
      next.delete("activateClientId");
      setSearchParams(next, { replace: true });
    }
  };


  const load = async (opts?: { searchOverride?: string }) => {
    const q = opts?.searchOverride ?? search;
    const seq = ++loadSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await amlCasesApi.list({
        status: status !== "all" ? (status as AmlCaseStatus) : undefined,
        risk: risk !== "all" ? (risk as AmlRiskRating) : undefined,
        assigned_to_me: assignedToMe || undefined,
        search: q || undefined,
        limit: PAGE_LIMIT,
      });
      if (seq !== loadSeq.current) return;
      setCases(res.cases);
      setTotal(res.total);
      setAppliedSearch(q);
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      setLoadError(e?.message ?? "The case register could not be loaded.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (access.hasAnyRole && access.flagEnabled) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.hasAnyRole, access.flagEnabled, status, risk, assignedToMe]);

  // The active view may refine the loaded page (see SAVED_VIEWS). Rows are
  // never invented — this only hides rows the reading says are quiet.
  const refine = SAVED_VIEWS.find((v) => v.key === view)?.refine;
  const visibleCases = useMemo(
    () => (refine ? cases.filter(refine) : cases),
    [cases, refine],
  );
  const refinedFromTruncatedPage = Boolean(refine) && total > cases.length;

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (status !== "all") labels.push(`Status: ${CASE_STATUS_LABELS[status as AmlCaseStatus] ?? status}`);
    if (risk !== "all") labels.push(`Risk: ${RISK_FILTER_LABELS[risk] ?? risk}`);
    if (assignedToMe) labels.push("Assigned to me");
    if (appliedSearch) labels.push(`Search: "${appliedSearch}"`);
    return labels;
  }, [status, risk, assignedToMe, appliedSearch]);

  const hasActiveFilters = activeFilterLabels.length > 0;

  const clearFilters = () => {
    setSearch("");
    selectView("all");
    // The filter effect reloads for status/risk/assignedToMe; if the preset
    // was already "all" with only a search applied, reload explicitly.
    if (status === "all" && risk === "all" && !assignedToMe) {
      void load({ searchOverride: "" });
    }
  };

  if (access.loading) {
    return (
      <div className="flex h-64 items-center justify-center" role="status">
        <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Checking your access…</span>
      </div>
    );
  }

  if (!access.flagEnabled) {
    return <AmlAccessGate
      title="AML/CTF is not enabled"
      body="The AML/CTF module isn't switched on for your organisation yet. Contact your administrator to enable it."
    />;
  }

  if (!access.hasAnyRole) {
    return <AmlAccessGate
      title="You don't have access to AML cases yet"
      body="Ask your compliance administrator to grant you AML access. The case register appears automatically once access is granted."
    />;
  }

  return (
    <div className="space-y-4">
      <AmlPageHeader
        title="Case register"
        description="Every customer compliance case — search, filter and continue the work."
        icon={ShieldCheck}
        actions={
          <>
            <AmlRefreshButton onClick={() => void load()} loading={loading} />
            {access.canWrite && (
              <Button
                size="sm"
                onClick={() => { setActivateClientId(null); setActivateOpen(true); }}
              >
                <ShieldCheck aria-hidden="true" className="mr-2 h-4 w-4" /> Activate client
              </Button>
            )}
            {/* Manual creation is an authorised exception, not an ordinary
                pathway (directive §10.4) — MLRO only, with a recorded reason. */}
            {access.isMlro && (
              <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden="true" className="mr-2 h-4 w-4" /> Exception case
              </Button>
            )}
          </>
        }
      />

      {/*
        The staged-rollout gate, said out loud — to the one audience that can
        move it.

        `aml_v3_case_workspace` decides whether a case opens in the full
        journey workspace or the legacy dialog, and it defaults to off. That
        is correct for a staged rollout and wrong to keep silent: with the
        flag off, `/admin/aml/cases/:caseId` redirects here and a row opens
        the dialog, so a finished workspace and an absent one look exactly
        the same — which is how it stayed switched off from Phase 6 to now,
        with the only toggle for it on a page linked from nowhere.

        Shown to superadmins alone, because rollout plumbing is not an
        operator's concern and the cutover page refuses anyone else.
      */}
      {isSuperadmin && !flagsLoading && !fullPageWorkspace && (
        <Alert>
          <ToggleLeft aria-hidden="true" className="h-4 w-4" />
          <AlertTitle>Cases are opening in the legacy dialog</AlertTitle>
          <AlertDescription className="space-y-2 text-xs">
            <p>
              The staged compliance journey workspace is built and deployed, but{" "}
              <code className="font-mono">aml_v3_case_workspace</code> is switched off, so a case
              opens in the legacy dialog instead. Nothing is broken — the flag has simply never
              been turned on.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/aml-v3-cutover">Open the V3 cutover controls</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Saved views */}
      <div className="rounded-xl border border-border/60 bg-card/45 p-2 shadow-sm"><div className="flex flex-wrap gap-2" role="group" aria-label="Saved views">
        {SAVED_VIEWS.map((v) => (
          <Button
            key={v.key}
            size="sm"
            variant={view === v.key ? "default" : "outline"}
            className="h-7 rounded-full px-3 text-xs"
            aria-pressed={view === v.key}
            onClick={() => selectView(v.key)}
          >
            {v.label}
          </Button>
        ))}
      </div>
      </div>

      {/* Search + filters as one toolbar */}
      <div role="search" aria-label="Filter the case register" className="rounded-xl border border-border/60 bg-card/45 p-3 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <Input
              placeholder="Search subject or case ref…"
              aria-label="Search subject or case reference"
              value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              className="w-full sm:w-64"
            />
            <Button variant="outline" size="sm" onClick={() => void load()} aria-label="Search">
              <Search aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
          <Select value={status} onValueChange={(v) => { leaveView(); setStatus(v); }}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(CASE_STATUS_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={risk} onValueChange={(v) => { leaveView(); setRisk(v); }}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by risk rating">
              <SelectValue placeholder="Risk" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="prohibited">Prohibited</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Result count + active filters, with a way out. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
          <span>
            {loading
              ? "Loading cases…"
              : refine
                ? `${visibleCases.length} of ${cases.length} loaded case${cases.length === 1 ? "" : "s"} need attention`
                : total > cases.length
                  ? `Showing the first ${cases.length} of ${total} cases`
                  : `${total} case${total === 1 ? "" : "s"}`}
          </span>
          {activeFilterLabels.map((label) => (
            <span key={label} className="rounded-full bg-muted px-2 py-0.5">{label}</span>
          ))}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {loadError && (
        <AmlErrorState
          title="The case register could not be loaded"
          message={loadError}
          detail="Nothing was changed. Your filters are still applied."
          onRetry={() => void load()}
        />
      )}

      <Card className="overflow-hidden border-border/70 bg-card/50 shadow-md">
        <CardContent className="p-0">
          {/* Skeleton whenever a load is in flight with nothing to show —
              a refetch from an empty result must never flash a false
              "no matches" for data that hasn't arrived yet. */}
          {loading && cases.length === 0 ? (
            <div className="space-y-2" role="status">
              <span className="sr-only">Loading the case register</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" aria-hidden="true" />
              ))}
            </div>
          ) : visibleCases.length === 0 && !loadError ? (
            refine ? (
              <AmlEmptyState
                title="Nothing needs attention"
                body={
                  refinedFromTruncatedPage
                    ? `None of the ${cases.length} loaded cases is waiting on a decision or a chase. The register holds ${total} in total — narrow the filters to check the rest.`
                    : "No case in the register is waiting on a decision or a chase."
                }
                action={
                  <Button size="sm" variant="outline" onClick={() => selectView("all")}>
                    Show all open cases
                  </Button>
                }
              />
            ) : hasActiveFilters ? (
              <AmlEmptyState
                title="No cases match the current filters"
                body="Widen the search or clear a filter to see more of the register."
                action={
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <AmlEmptyState
                title="No cases yet"
                body="Open a client's record and choose Start Client Compliance, or use Activate client above."
              />
            )
          ) : (
            <>
              {/* Desktop: the work queue. Columns answer, left to right:
                  who, where in the process, how risky, may the service
                  proceed, what is waiting — then ownership and freshness.
                  Phase and owner fold away on narrower laptops rather than
                  squeezing the first five into an unreadable width. */}
              <div className="hidden max-h-[58vh] overflow-auto md:block">
                <Table aria-label="Case register">
                  <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
                    <TableRow>
                      <TableHead scope="col">Customer</TableHead>
                      <TableHead scope="col" className="hidden lg:table-cell">Phase</TableHead>
                      <TableHead scope="col">Risk</TableHead>
                      <TableHead scope="col">Service</TableHead>
                      <TableHead scope="col">Attention</TableHead>
                      <TableHead scope="col" className="hidden xl:table-cell">Owner</TableHead>
                      <TableHead scope="col">Updated</TableHead>
                      <TableHead scope="col" className="hidden xl:table-cell">
                        <span className="sr-only">Open</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleCases.map((c) => {
                      const attention = deriveAmlCaseAttention(c);
                      const readiness = serviceReadinessLabel(c);
                      const phase = deriveAmlMacroPhase({ caseRow: c }).phase;
                      return (
                        <TableRow
                          key={c.id}
                          tabIndex={0}
                          role="link"
                          aria-label={`Open case ${c.case_reference} for ${c.subject_display_name} — ${attention.detail}`}
                          className="cursor-pointer border-l-2 border-l-transparent transition-colors hover:border-l-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          onClick={() => openCase(c)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCase(c); }
                          }}
                        >
                          <TableCell className="max-w-[280px]">
                            <span className="block truncate font-medium" title={c.subject_display_name}>
                              {c.subject_display_name}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {c.case_reference} · {SUBJECT_TYPE_LABELS[c.subject_type] ?? c.subject_type}
                              {c.purchase_file_id ? " · purchase file" : ""}
                            </span>
                          </TableCell>
                          <TableCell className="hidden whitespace-nowrap text-sm lg:table-cell">
                            {MACRO_PHASE_LABELS[phase]}
                          </TableCell>
                          <TableCell><AmlRiskBadge risk={c.risk_rating} /></TableCell>
                          <TableCell
                            className={cn("whitespace-nowrap text-sm", READINESS_TEXT[readiness.level])}
                          >
                            {readiness.label}
                          </TableCell>
                          {/* The attention label wraps rather than
                              truncating — "Conditions outstan…" is not a
                              status anybody can act on, and the row is
                              already two lines tall. */}
                          <TableCell className="max-w-[220px]">
                            <span
                              className={cn("block text-sm", ATTENTION_TEXT[attention.level])}
                              title={attention.detail}
                            >
                              {attention.needsAttention && (
                                <span aria-hidden className="mr-1.5">•</span>
                              )}
                              {attention.label}
                            </span>
                          </TableCell>
                          <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground xl:table-cell">
                            {c.assigned_analyst_id || c.assigned_mlro_id ? "Assigned" : "Unassigned"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {displayRelative(c.updated_at)}
                          </TableCell>
                          <TableCell className="hidden text-right xl:table-cell">
                            {/* Explicit action alongside the row-as-link, for
                                anyone who misses the row affordance. It folds
                                away below xl, where the columns that carry
                                actual information need the width. */}
                            <Button
                              size="sm"
                              variant="ghost"
                              tabIndex={-1}
                              aria-hidden="true"
                              className="pointer-events-none text-muted-foreground"
                            >
                              Open <ChevronRight className="ml-1 h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: responsive cards (directive §6.2) */}
              <div className="space-y-2 md:hidden">
                {visibleCases.map((c) => {
                  const attention = deriveAmlCaseAttention(c);
                  const readiness = serviceReadinessLabel(c);
                  const phase = deriveAmlMacroPhase({ caseRow: c }).phase;
                  return (
                    <button
                      key={c.id}
                      onClick={() => openCase(c)}
                      className="w-full rounded-xl border border-border bg-card/60 p-3 text-left shadow-sm transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      aria-label={`Open case ${c.case_reference} for ${c.subject_display_name} — ${attention.detail}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{c.subject_display_name}</div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {c.case_reference} · {SUBJECT_TYPE_LABELS[c.subject_type] ?? c.subject_type}
                          </div>
                        </div>
                        <ChevronRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                      <div className={cn("mt-2 text-sm", ATTENTION_TEXT[attention.level])}>
                        {attention.needsAttention && <span aria-hidden className="mr-1.5">•</span>}
                        {attention.label}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>{MACRO_PHASE_LABELS[phase]}</span>
                        <span aria-hidden>·</span>
                        <span className={READINESS_TEXT[readiness.level]}>
                          Service: {readiness.label}
                        </span>
                        <span aria-hidden>·</span>
                        <span>Updated {displayRelative(c.updated_at)}</span>
                      </div>
                      <div className="mt-1.5">
                        <AmlRiskBadge risk={c.risk_rating} prefix />
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <CreateCaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(c) => { setCreateOpen(false); load(); openCase(c); }}
      />

      <ActivateClientDialog
        open={activateOpen}
        onOpenChange={(o) => {
          setActivateOpen(o);
          if (!o) {
            setActivateClientId(null);
            clearActivateParam();
          }
        }}
        clientId={activateClientId ?? undefined}
        onActivated={(c) => {
          clearActivateParam();
          setActivateClientId(null);
          load();
          // Straight into Client intake — the next thing the case needs.
          openCase(c, "intake");
        }}
      />

      {/* Centred case workspace (replaces the legacy right-side Sheet).
          Radix restores focus to the case row that opened it on close. */}
      <AmlCaseWorkspaceDialog
        caseId={activeId}
        initialTab={initialTab}
        onClose={() => { setActiveId(null); setInitialTab(undefined); }}
        onChanged={load}
        canWrite={access.canWrite}
        canInvestigate={access.canWrite}
      />

    </div>
  );
}

/**
 * Authorised-exception case creation (directive §10.4). MLRO only. The
 * ordinary production pathway is client activation; this dialog exists for
 * migrations, legacy remediation, regulator-directed cases and approved
 * testing, and every use records category, authority and reason.
 */
function CreateCaseDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: AmlCase) => void }) {
  const [subject, setSubject] = useState("");
  const [subjectType, setSubjectType] = useState<"individual" | "entity" | "trust">("individual");
  const [risk, setRisk] = useState<string>("none");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState<"data_migration" | "legacy_remediation" | "regulator_directed" | "approved_testing">("data_migration");
  const [authority, setAuthority] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setSubject(""); setSubjectType("individual"); setRisk("none"); setNotes("");
    setCategory("data_migration"); setAuthority(""); setReason("");
  };

  const canSubmit = subject.trim() && authority.trim() && reason.trim().length >= 10;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await amlCasesApi.create({
        subject_display_name: subject.trim(),
        subject_type: subjectType,
        risk_rating: risk !== "none" ? (risk as AmlRiskRating) : undefined,
        notes: notes || undefined,
        exception: { category, reason: reason.trim(), authority: authority.trim() },
      });
      toast({ title: "Exception case opened", description: res.case.case_reference });
      reset();
      onCreated(res.case);
    } catch (e: any) {
      toast({ title: "Failed to create case", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Open case by authorised exception</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Not the ordinary pathway</AlertTitle>
            <AlertDescription className="text-xs">
              Ordinary cases open from the client record via Start Client Compliance after a
              human-confirmed activation. Use this only for data migration, legacy remediation,
              regulator-directed work or approved testing. The exception is recorded on the
              case's audit history.
            </AlertDescription>
          </Alert>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Exception type</Label>
              <Select value={category} onValueChange={(v: any) => setCategory(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="data_migration">Data migration</SelectItem>
                  <SelectItem value="legacy_remediation">Legacy remediation</SelectItem>
                  <SelectItem value="regulator_directed">Regulator directed</SelectItem>
                  <SelectItem value="approved_testing">Approved testing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Approved by</Label>
              <Input value={authority} onChange={(e) => setAuthority(e.target.value)}
                placeholder="Who authorised this exception" />
            </div>
          </div>
          <div>
            <Label>Reason (min 10 characters)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="Why this case cannot be opened through client activation" />
          </div>
          <div>
            <Label>Subject name</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Full legal name or entity" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Subject type</Label>
              <Select value={subjectType} onValueChange={(v: any) => setSubjectType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="entity">Entity / company</SelectItem>
                  <SelectItem value="trust">Trust</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Initial risk rating</Label>
              <Select value={risk} onValueChange={setRisk}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unrated</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="prohibited">Prohibited</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Opening notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !canSubmit}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Open exception case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
