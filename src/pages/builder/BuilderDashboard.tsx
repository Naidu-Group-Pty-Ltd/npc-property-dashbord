import { Building2, CalendarClock, ShieldCheck, UserRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useBuilderPortalAuth } from '@/hooks/useBuilderPortalAuth';

/**
 * Builder / Developer Portal landing surface.
 *
 * Phase 2 delivers authentication, governance and the portal shell — not the
 * Builder business domain. This page therefore shows only what genuinely exists
 * at this phase: who is signed in, which organisation the session is acting as,
 * and what the session's own security state is.
 *
 * There are deliberately no project, transaction, pipeline or financial tiles.
 * Placeholder tiles reading zero would be indistinguishable from real tiles
 * reading zero, and none of that data is in scope for this phase.
 */
const formatTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : 'This is your first sign-in';

export default function BuilderDashboard() {
  const { user, activeOrganisation, organisations, previousSeenAt, permissions } =
    useBuilderPortalAuth();

  const grantedCount = Object.values(permissions).filter(
    (entry) => entry.view || entry.edit || entry.delete,
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Last signed in: {formatTimestamp(previousSeenAt)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

      <Alert>
        <CalendarClock className="h-4 w-4" aria-hidden />
        <AlertDescription>
          Your portal access is active. Projects, transactions, pipeline, messages and tasks are
          not yet enabled — they become available in a later phase, and the navigation shows them
          as unavailable until then.
        </AlertDescription>
      </Alert>
    </div>
  );
}
