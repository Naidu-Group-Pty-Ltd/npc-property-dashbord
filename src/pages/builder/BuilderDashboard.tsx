import { Link } from 'react-router-dom';
import {
  AlertTriangle, Bell, Boxes, Building2, FileText, Hammer, History, ListChecks, Loader2,
  MessageSquare, Receipt, RefreshCw, ShieldCheck, UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { accessRoleLabel } from '@/lib/builderAccessTerms';
import { useBuilderPortalAuth } from '@/hooks/useBuilderPortalAuth';
import { useBuilderActivity, useBuilderWorkspaceSummary } from '@/lib/builderQueries';
import {
  ACTIVITY_ENTITY_LABELS, ACTOR_TYPE_LABELS, activityActionLabel, formatWorkspaceTime,
} from '@/lib/builderWorkspace';
import { BuilderPortalMetricCard } from '@/components/builder-portal/ui/BuilderPortalMetricCard';
import { BuilderPortalSection } from '@/components/builder-portal/ui/BuilderPortalSection';
import { BuilderPortalEmptyState } from '@/components/builder-portal/ui/BuilderPortalEmptyState';

/**
 * Builder / Developer Portal landing surface.
 *
 * Every number on this page is computed by the database from an accessible-set
 * function, so a tile can never count a record this user cannot open — and a
 * count of zero means "nothing you can reach", not "nothing exists". The recent
 * activity list is the same feed as the Activity page, narrowed to the most
 * recent entries and filtered through the resolvers that govern each record.
 *
 * There is deliberately no financial tile: no money, client position, AML
 * determination or commission is in the Builder audience.
 *
 * The two queries below are the only sources on this page. Nothing is derived
 * from a third, nothing is estimated, and the layout groups the figures without
 * changing what any of them counts.
 */
const formatTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : 'This is your first sign-in';

export default function BuilderDashboard() {
  const { user, activeOrganisation, organisations, previousSeenAt, permissions } =
    useBuilderPortalAuth();

  const summaryQuery = useBuilderWorkspaceSummary();
  const activityQuery = useBuilderActivity();
  const summary = summaryQuery.data;
  const activity = (activityQuery.data || []).slice(0, 8);

  const grantedCount = Object.values(permissions).filter(
    (entry) => entry.view || entry.edit || entry.delete,
  ).length;

  const organisationName = activeOrganisation
    ? activeOrganisation.trading_name || activeOrganisation.legal_name
    : 'No organisation selected';

  /**
   * The same eight figures as before, at the same routes, grouped by the stage
   * of delivery they belong to. Grouping is presentation: no tile counts
   * anything different from what it counted as a flat grid.
   */
  const tileGroups = [
    {
      title: 'Project delivery',
      tiles: [
        { label: 'Projects', value: summary?.projects ?? 0, icon: Building2, to: '/builder/projects', hint: 'Developments you can reach' },
        { label: 'Units', value: summary?.units ?? 0, icon: Boxes, to: '/builder/inventory', hint: 'Lots and units in inventory' },
        { label: 'Transactions', value: summary?.transactions ?? 0, icon: Receipt, to: '/builder/transactions', hint: 'Sales across your projects' },
        { label: 'Builds', value: summary?.construction_cases ?? 0, icon: Hammer, to: '/builder/construction', hint: 'Construction programmes' },
      ],
    },
    {
      title: 'Workspace',
      tiles: [
        { label: 'Documents', value: summary?.documents ?? 0, icon: FileText, to: '/builder/documents', hint: 'Plans, certificates and packs' },
        { label: 'Open conversations', value: summary?.open_conversations ?? 0, icon: MessageSquare, to: '/builder/messages', hint: 'Threads still open' },
        { label: 'Open tasks', value: summary?.open_tasks ?? 0, icon: ListChecks, to: '/builder/tasks', hint: 'Assigned and not yet done' },
        { label: 'Unread notifications', value: summary?.unread_notifications ?? 0, icon: Bell, to: '/builder/notifications', hint: 'Waiting for you to read' },
      ],
    },
  ];

  const attention = [
    { label: 'Open defects', value: summary?.open_defects ?? 0, to: '/builder/construction' },
    { label: 'Overdue tasks', value: summary?.overdue_tasks ?? 0, to: '/builder/tasks' },
    { label: 'Unread messages', value: summary?.unread_messages ?? 0, to: '/builder/messages' },
  ].filter((item) => item.value > 0);

  return (
    <div className="space-y-6">
      {/* ── Welcome and organisation context ── */}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-primary/[0.07] via-card to-card">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate font-medium text-foreground">{organisationName}</span>
              </span>
              <span aria-hidden>·</span>
              <span>Last signed in: {formatTimestamp(previousSeenAt)}</span>
            </p>
          </div>
          <Button
            variant="outline" size="sm"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => { void summaryQuery.refetch(); void activityQuery.refetch(); }}
            disabled={summaryQuery.isFetching || activityQuery.isFetching}
          >
            <RefreshCw
              className={cn('mr-2 h-4 w-4',
                (summaryQuery.isFetching || activityQuery.isFetching) && 'animate-spin')}
              aria-hidden
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Attention strip: rendered only when the summary reports a figure
             above zero. No severity is invented — the data carries none. ── */}
      {attention.length ? (
        <section
          className="rounded-xl border border-warning/40 bg-warning/[0.06] p-4"
          aria-label="Needs attention"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
            Needs attention
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {attention.map((item) => (
              <li key={item.label}>
                <Link
                  to={item.to}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-primary/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-base font-semibold tabular-nums text-foreground">
                    {item.value}
                  </span>
                  <span className="text-muted-foreground">{item.label.toLowerCase()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Core operational metrics ── */}
      <section aria-label="Your portal" className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Your portal</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every figure counts only what your access reaches. A zero means nothing you can see,
            not necessarily nothing at all.
          </p>
        </div>

        {summaryQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading summary" />
          </div>
        ) : summaryQuery.isError ? (
          <div role="alert" className="rounded-xl border border-destructive/40 p-6 text-center">
            <p className="font-medium">Your summary could not be loaded</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check your connection and try again.
            </p>
            <Button className="mt-4" variant="outline" onClick={() => void summaryQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {tileGroups.map(({ title, tiles }) => (
              <div key={title}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                  {title}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {tiles.map(({ label, value, icon, to, hint }) => (
                    <BuilderPortalMetricCard
                      key={label}
                      icon={icon}
                      label={label}
                      value={value}
                      hint={hint}
                      to={to}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        {/* ── Recent activity ── */}
        <BuilderPortalSection
          title="Recent activity"
          icon={History}
          description="Changes to records you can reach. Administrative events are not shown here."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/builder/activity">View all</Link>
            </Button>
          }
        >
          {activityQuery.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading activity" />
            </div>
          ) : activityQuery.isError ? (
            <div role="alert" className="rounded-xl border border-destructive/40 p-6 text-center">
              <p className="font-medium">Activity could not be loaded</p>
              <Button className="mt-4" variant="outline" onClick={() => void activityQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : !activity.length ? (
            <BuilderPortalEmptyState
              icon={History}
              title="Nothing has happened yet"
              description="Changes to your projects, builds and tasks will appear here."
            />
          ) : (
            /* A timeline: one rail, one node per entry. The list, its order and
               its eight-record limit are unchanged. */
            <ol className="relative space-y-4 border-l border-border pl-6">
              {activity.map((entry) => (
                <li key={entry.id} className="relative">
                  <span
                    className="absolute -left-[1.8125rem] top-1.5 h-2 w-2 rounded-full bg-primary ring-4 ring-card"
                    aria-hidden
                  />
                  {/* A div, not a p: Badge renders a div, and a div inside a
                      p is invalid HTML that the browser silently reflows. */}
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    {activityActionLabel(entry.action)}
                    {entry.entity_type ? (
                      <Badge variant="outline" className="font-normal">
                        {ACTIVITY_ENTITY_LABELS[entry.entity_type] ?? entry.entity_type}
                      </Badge>
                    ) : null}
                  </div>
                  {entry.reason ? (
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{entry.reason}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ACTOR_TYPE_LABELS[entry.actor_type] ?? entry.actor_type} ·{' '}
                    {formatWorkspaceTime(entry.created_at)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </BuilderPortalSection>

        {/* ── Organisation, account and access context ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Building2 className="h-4 w-4 text-primary" aria-hidden />
                Acting as
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="break-words text-base font-semibold leading-snug text-foreground">
                {organisationName}
              </p>
              {activeOrganisation ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="font-normal">
                    {accessRoleLabel(activeOrganisation.membership_role)}
                  </Badge>
                  {activeOrganisation.is_primary ? (
                    <Badge variant="outline" className="font-normal">Primary organisation</Badge>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose an organisation to continue
                </p>
              )}
              {organisations.length > 1 ? (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  You have organisation access to {organisations.length} organisations. Switch from
                  the sidebar.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <UserRound className="h-4 w-4 text-primary" aria-hidden />
                Your account
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p className="break-all font-medium text-foreground">{user?.email}</p>
              {user?.job_title ? (
                <Badge variant="outline" className="font-normal">{user.job_title}</Badge>
              ) : null}
              {user?.phone ? (
                <p className="text-xs text-muted-foreground">{user.phone}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
                Access
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <p className="text-2xl font-semibold tabular-nums leading-tight text-foreground">
                {grantedCount}
              </p>
              <p className="text-sm text-foreground">
                permission {grantedCount === 1 ? 'area' : 'areas'} granted
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Permissions are resolved by the server on every request. Anything not explicitly
                granted is denied.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
