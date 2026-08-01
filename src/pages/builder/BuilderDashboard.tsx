import { Link } from 'react-router-dom';
import {
  AlertTriangle, Bell, Boxes, Building2, FileText, Hammer, ListChecks, Loader2,
  MessageSquare, Receipt, RefreshCw, ShieldCheck, UserRound,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useBuilderPortalAuth } from '@/hooks/useBuilderPortalAuth';
import { useBuilderActivity, useBuilderWorkspaceSummary } from '@/lib/builderQueries';
import {
  ACTIVITY_ENTITY_LABELS, ACTOR_TYPE_LABELS, activityActionLabel, formatWorkspaceTime,
} from '@/lib/builderWorkspace';

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

  const tiles = [
    { label: 'Projects', value: summary?.projects ?? 0, icon: Building2, to: '/builder/projects' },
    { label: 'Units', value: summary?.units ?? 0, icon: Boxes, to: '/builder/inventory' },
    { label: 'Transactions', value: summary?.transactions ?? 0, icon: Receipt, to: '/builder/transactions' },
    { label: 'Builds', value: summary?.construction_cases ?? 0, icon: Hammer, to: '/builder/construction' },
    { label: 'Documents', value: summary?.documents ?? 0, icon: FileText, to: '/builder/documents' },
    { label: 'Open conversations', value: summary?.open_conversations ?? 0, icon: MessageSquare, to: '/builder/messages' },
    { label: 'Open tasks', value: summary?.open_tasks ?? 0, icon: ListChecks, to: '/builder/tasks' },
    { label: 'Unread notifications', value: summary?.unread_notifications ?? 0, icon: Bell, to: '/builder/notifications' },
  ];

  const attention = [
    { label: 'Open defects', value: summary?.open_defects ?? 0, to: '/builder/construction' },
    { label: 'Overdue tasks', value: summary?.overdue_tasks ?? 0, to: '/builder/tasks' },
    { label: 'Unread messages', value: summary?.unread_messages ?? 0, to: '/builder/messages' },
  ].filter((item) => item.value > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Last signed in: {formatTimestamp(previousSeenAt)}
          </p>
        </div>
        <Button
          variant="outline" size="sm"
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

      {attention.length ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertDescription>
            Needs attention:{' '}
            {attention.map((item, index) => (
              <span key={item.label}>
                {index > 0 ? ', ' : ''}
                <Link to={item.to} className="underline underline-offset-2">
                  {item.value} {item.label.toLowerCase()}
                </Link>
              </span>
            ))}
            .
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your portal</CardTitle>
          <CardDescription>
            Every figure counts only what your access reaches. A zero means nothing you can see,
            not necessarily nothing at all.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summaryQuery.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading summary" />
            </div>
          ) : summaryQuery.isError ? (
            <div role="alert" className="rounded-lg border border-destructive/40 p-6 text-center">
              <p className="font-medium">Your summary could not be loaded</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Check your connection and try again.
              </p>
              <Button className="mt-4" variant="outline" onClick={() => void summaryQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tiles.map(({ label, value, icon: Icon, to }) => (
                <Link
                  key={label} to={to}
                  className="rounded-lg border border-border p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="h-4 w-4 text-primary" aria-hidden />
                    {label}
                  </span>
                  <span className="mt-2 block text-2xl font-semibold">{value}</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Recent activity</CardTitle>
              <CardDescription>
                Changes to records you can reach. Administrative events are not shown here.
              </CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/builder/activity">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {activityQuery.isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading activity" />
              </div>
            ) : activityQuery.isError ? (
              <div role="alert" className="rounded-lg border border-destructive/40 p-6 text-center">
                <p className="font-medium">Activity could not be loaded</p>
                <Button className="mt-4" variant="outline" onClick={() => void activityQuery.refetch()}>
                  Try again
                </Button>
              </div>
            ) : !activity.length ? (
              <div className="rounded-lg border border-dashed p-10 text-center">
                <p className="font-medium">Nothing has happened yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Changes to your projects, builds and tasks will appear here.
                </p>
              </div>
            ) : (
              <ol className="space-y-2">
                {activity.map((entry) => (
                  <li key={entry.id} className="rounded-lg border border-border p-3">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {activityActionLabel(entry.action)}
                      {entry.entity_type ? (
                        <Badge variant="outline">
                          {ACTIVITY_ENTITY_LABELS[entry.entity_type] ?? entry.entity_type}
                        </Badge>
                      ) : null}
                    </p>
                    {entry.reason ? (
                      <p className="mt-1 text-sm text-muted-foreground">{entry.reason}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ACTOR_TYPE_LABELS[entry.actor_type] ?? entry.actor_type} ·{' '}
                      {formatWorkspaceTime(entry.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Building2 className="h-4 w-4 text-primary" aria-hidden />
                Acting as
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="truncate text-base font-semibold text-foreground">
                {activeOrganisation
                  ? activeOrganisation.trading_name || activeOrganisation.legal_name
                  : 'No organisation selected'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {activeOrganisation
                  ? activeOrganisation.membership_role.replace(/_/g, ' ')
                  : 'Choose an organisation to continue'}
              </p>
              {organisations.length > 1 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  You have access to {organisations.length} organisations. Switch from the header.
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
            <CardContent className="space-y-1 text-sm">
              <p className="truncate font-medium text-foreground">{user?.email}</p>
              {user?.job_title ? (
                <Badge variant="outline" className="mt-2">{user.job_title}</Badge>
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
            <CardContent className="space-y-1 text-sm">
              <p className="text-foreground">
                {grantedCount} permission {grantedCount === 1 ? 'area' : 'areas'} granted
              </p>
              <p className="text-xs text-muted-foreground">
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
