import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { AdminBuilderProjectsPanel } from '@/components/admin/builder-portal/AdminBuilderProjectsPanel';
import { AdminBuilderInventoryPanel } from '@/components/admin/builder-portal/AdminBuilderInventoryPanel';
import { AdminBuilderTransactionsPanel } from '@/components/admin/builder-portal/AdminBuilderTransactionsPanel';
import { AdminBuilderConstructionPanel } from '@/components/admin/builder-portal/AdminBuilderConstructionPanel';
import { AdminBuilderDeliveryPanel } from '@/components/admin/builder-portal/AdminBuilderDeliveryPanel';
import { AdminBuilderCollaborationPanel } from '@/components/admin/builder-portal/AdminBuilderCollaborationPanel';
import { AdminBuilderWorkspacePanel } from '@/components/admin/builder-portal/AdminBuilderWorkspacePanel';
import { BuilderStatCard } from '@/components/admin/builder-portal/ui/BuilderStatCard';
import { BuilderEmptyState } from '@/components/admin/builder-portal/ui/BuilderEmptyState';
import { BuilderSearchField } from '@/components/admin/builder-portal/ui/BuilderSearchField';
import { BuilderStatusBadge } from '@/components/admin/builder-portal/ui/BuilderStatusBadge';
import {
  BuilderAccessLifecycle, type BuilderAccessLifecycleStep,
} from '@/components/admin/builder-portal/ui/BuilderAccessLifecycle';
import { toast } from 'sonner';
import {
  BriefcaseBusiness, Building2, Copy, FolderKanban, Hammer, Handshake, HardHat, KeyRound, Loader2,
  Mail, MessageSquare, Package, Plus, RefreshCw, ShieldCheck, Truck, UserCheck, UserPlus, Users,
} from 'lucide-react';

/**
 * Builder / Developer Portal administration — Phase 1 shell.
 *
 * Organisations, portal users and memberships (Phase 1), plus projects and
 * project access (Phase 3). Transaction assignments, integration health, AI
 * policies and cutover status belong to later phases.
 *
 * This is the INTERNAL surface. The external portal at /builder/* is a separate
 * route tree with its own provider and its own session and is never linked from
 * here or from any internal navigation surface (ADR 018).
 */

const ORG_TYPES = [
  { value: 'developer', label: 'Developer' },
  { value: 'builder', label: 'Builder' },
  { value: 'builder_developer', label: 'Builder and developer' },
  { value: 'sales_representative', label: 'Authorised sales representative' },
] as const;

const MEMBERSHIP_ROLES = [
  { value: 'owner', label: 'Organisation owner' },
  { value: 'administrator', label: 'Administrator' },
  { value: 'manager', label: 'Manager' },
  { value: 'member', label: 'Member' },
  { value: 'read_only', label: 'Read only' },
] as const;

/**
 * Status presentation. `dot` is the token-coloured indicator on an outline
 * pill; `tone: 'destructive'` is the solid badge, kept for the states that
 * mean no access. Every colour here is a semantic token.
 *
 * The tinted `success`/`warning`/`info` badge variants are deliberately not
 * used: their dark-theme foreground token is near-black on a 12% tint, so the
 * label all but disappears. An outline pill keeps full foreground contrast in
 * both themes and carries the tone in the dot instead.
 */
interface StatusPresentation {
  label: string;
  dot?: string;
  tone?: 'destructive';
}

const ORG_STATUS_META: Record<string, StatusPresentation> = {
  active: { label: 'Active', dot: 'bg-success' },
  pending_activation: { label: 'Pending activation', dot: 'bg-info' },
  suspended: { label: 'Suspended', dot: 'bg-warning' },
  closed: { label: 'Closed', tone: 'destructive' },
};

interface BuilderOrganisation {
  id: string;
  legal_name: string;
  trading_name: string | null;
  org_type: string;
  abn: string | null;
  acn: string | null;
  contact_email: string | null;
  status: string;
  is_active: boolean;
  row_version: number;
}

interface BuilderUser {
  id: string;
  email: string;
  name: string;
  job_title: string | null;
  status: string;
  is_active: boolean;
  invited_at: string | null;
  invite_token_expires_at: string | null;
  invite_accepted_at: string | null;
  last_login_at: string | null;
  /** Derived server-side: the invite was accepted and a password exists. */
  has_completed_account_setup: boolean;
  row_version: number;
}

/**
 * Where a user sits in the Builder access lifecycle:
 *
 *   create user -> grant membership -> send invite -> user accepts -> active
 *
 * Membership comes before the invitation deliberately. An invitation to an
 * account with no membership leads nowhere, and `builder-portal-invite` rejects
 * it with 409 `no_membership`, so the interface must not offer it.
 */
type AccessStage =
  | 'revoked' | 'no_membership' | 'not_invited'
  | 'invite_pending' | 'invite_expired' | 'active' | 'suspended';

/**
 * Labels and hints are unchanged; only the presentation differs, so each of
 * the seven stages is distinguishable at a glance. The two stages that mean
 * "no portal access at all" keep the solid destructive badge.
 */
const ACCESS_STAGE_META: Record<AccessStage, StatusPresentation & { hint: string }> = {
  revoked: {
    label: 'Revoked', tone: 'destructive',
    hint: 'Access has been revoked. Restore to suspended before activating.',
  },
  no_membership: {
    label: 'No access', tone: 'destructive',
    hint: 'Step 2 of 5 — grant an organisation membership. Until then this user cannot be invited.',
  },
  not_invited: {
    label: 'Awaiting invitation', dot: 'bg-muted-foreground',
    hint: 'Step 3 of 5 — send the invitation so the user can set a password.',
  },
  invite_pending: {
    label: 'Invitation sent', dot: 'bg-info',
    hint: 'Step 4 of 5 — waiting for the user to accept and set a password.',
  },
  invite_expired: {
    label: 'Invitation expired', dot: 'bg-warning',
    hint: 'The invitation lapsed before it was accepted. Resend it.',
  },
  active: {
    label: 'Active', dot: 'bg-success',
    hint: 'Step 5 of 5 — the account is active and can sign in.',
  },
  suspended: {
    label: 'Suspended', dot: 'bg-destructive',
    hint: 'Sign-in is blocked and sessions were ended. Restore to return access.',
  },
};

/**
 * The order the interface enforces, laid out as a process strip rather than a
 * paragraph. The wording stays here, beside `accessStageFor`, because this is
 * the page that enforces the order — the strip component only lays it out.
 */
const ACCESS_LIFECYCLE_STEPS: ReadonlyArray<BuilderAccessLifecycleStep> = [
  { label: 'create the user', icon: UserPlus },
  { label: 'grant an organisation membership', icon: KeyRound },
  { label: 'send the invitation', icon: Mail },
  { label: 'the user accepts and sets a password', icon: ShieldCheck },
  { label: 'the account becomes active', icon: UserCheck },
];

/** The stage is read from server-provided state only; nothing here is guessed. */
function accessStageFor(user: BuilderUser, hasMembership: boolean): AccessStage {
  if (user.status === 'revoked') return 'revoked';
  if (!hasMembership) return 'no_membership';
  if (user.has_completed_account_setup) {
    return user.status === 'suspended' ? 'suspended' : 'active';
  }
  if (!user.invite_token_expires_at) return 'not_invited';
  return new Date(user.invite_token_expires_at) > new Date() ? 'invite_pending' : 'invite_expired';
}

interface BuilderMembership {
  id: string;
  builder_user_id: string;
  organisation_id: string;
  membership_role: string;
  status: string;
  revoked_at: string | null;
  row_version: number;
}

export default function BuilderPortalAdmin() {
  const { canEdit } = useModulePermissions('builder_portal_admin');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [organisations, setOrganisations] = useState<BuilderOrganisation[]>([]);
  const [users, setUsers] = useState<BuilderUser[]>([]);
  const [memberships, setMemberships] = useState<BuilderMembership[]>([]);
  const [search, setSearch] = useState('');

  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [orgForm, setOrgForm] = useState({ legal_name: '', trading_name: '', org_type: 'builder', abn: '', contact_email: '' });

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userForm, setUserForm] = useState({ email: '', name: '', job_title: '' });

  const [membershipDialogOpen, setMembershipDialogOpen] = useState(false);
  const [membershipForm, setMembershipForm] = useState({ builder_user_id: '', organisation_id: '', membership_role: 'member' });

  // Surfaced only when the invite function reports that email delivery did not
  // happen. The link is one-time and is never persisted anywhere in the browser.
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);

  const call = useCallback(async (operation: string, payload: Record<string, unknown> = {}) => {
    const { data, error } = await invokeSecureFunction('builder-portal-admin', { operation, ...payload });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  /**
   * Invitations are issued by the existing `builder-portal-invite` function.
   * The browser never generates, hashes or stores a token: it asks the server
   * to issue one and, when mail is not configured, relays the link the server
   * hands back.
   */
  const callInvite = useCallback(async (action: 'invite' | 'resend' | 'revoke_invite', user: BuilderUser) => {
    const { data, error } = await invokeSecureFunction('builder-portal-invite', {
      action, builder_user_id: user.id,
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data as { email_sent?: boolean; invite_url?: string; expires_at?: string };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [orgResult, userResult, membershipResult] = await Promise.all([
        call('list_organisations'),
        call('list_users'),
        call('list_memberships'),
      ]);
      setOrganisations(orgResult?.organisations ?? []);
      setUsers(userResult?.users ?? []);
      setMemberships(membershipResult?.memberships ?? []);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load Builder Portal administration');
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { void load(); }, [load]);

  const mutate = useCallback(async (operation: string, payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    try {
      await call(operation, payload);
      toast.success(success);
      await load();
      return true;
    } catch (error: any) {
      toast.error(error?.message || 'Operation failed');
      return false;
    } finally {
      setBusy(false);
    }
  }, [call, load]);

  const sendInvite = useCallback(async (user: BuilderUser, action: 'invite' | 'resend') => {
    setBusy(true);
    try {
      const result = await callInvite(action, user);
      if (result?.email_sent) {
        toast.success(`Invitation emailed to ${user.email}`);
      } else if (result?.invite_url) {
        // Mail is not configured in this environment. The administrator has to
        // pass the link on, so it is shown once, here, and nowhere else.
        setInviteLink({ email: user.email, url: result.invite_url });
        toast.warning('Email delivery is unavailable — copy the invitation link.');
      } else {
        toast.success('Invitation issued');
      }
      await load();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to issue the invitation');
    } finally {
      setBusy(false);
    }
  }, [callInvite, load]);

  const revokeInvite = useCallback(async (user: BuilderUser) => {
    setBusy(true);
    try {
      await callInvite('revoke_invite', user);
      toast.success('Pending invitation revoked');
      await load();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to revoke the invitation');
    } finally {
      setBusy(false);
    }
  }, [callInvite, load]);

  const organisationName = useCallback(
    (id: string) => organisations.find((o) => o.id === id)?.legal_name ?? 'Unknown organisation',
    [organisations],
  );
  const userName = useCallback(
    (id: string) => users.find((u) => u.id === id)?.name ?? 'Unknown user',
    [users],
  );

  const filteredOrganisations = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return organisations;
    return organisations.filter((o) =>
      o.legal_name.toLowerCase().includes(term)
      || (o.trading_name ?? '').toLowerCase().includes(term)
      || (o.abn ?? '').includes(term));
  }, [organisations, search]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((u) =>
      u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));
  }, [users, search]);

  const liveMemberships = useMemo(
    () => memberships.filter((m) => !m.revoked_at),
    [memberships],
  );

  /** Users with no live membership have no portal access at all. */
  const usersWithoutAccess = useMemo(() => {
    const withMembership = new Set(liveMemberships.map((m) => m.builder_user_id));
    return users.filter((u) => !withMembership.has(u.id));
  }, [users, liveMemberships]);

  /**
   * Summary metrics. Every figure is read off the three collections already in
   * state and every user figure goes through `accessStageFor`, so the cards can
   * never disagree with the badge on the row. No extra request is made.
   */
  const stats = useMemo(() => {
    const withMembership = new Set(liveMemberships.map((m) => m.builder_user_id));
    const stages = users.map((u) => accessStageFor(u, withMembership.has(u.id)));
    return {
      organisations: organisations.length,
      activeOrganisations: organisations.filter((o) => o.is_active).length,
      users: users.length,
      activeUsers: stages.filter((s) => s === 'active').length,
      pendingInvitations: stages.filter(
        (s) => s === 'not_invited' || s === 'invite_pending' || s === 'invite_expired',
      ).length,
      memberships: memberships.length,
      liveMemberships: liveMemberships.length,
    };
  }, [organisations, users, memberships, liveMemberships]);

  /** Distinguishes "nothing has been created" from "the search matched nothing". */
  const isSearching = search.trim().length > 0;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
            <HardHat className="h-6 w-6 text-primary" aria-hidden />
            <Loader2 className="absolute h-14 w-14 animate-spin text-primary/40" aria-hidden />
          </span>
          <p className="text-sm font-medium text-muted-foreground">
            Loading Builder Portal administration…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <HardHat className="h-6 w-6 shrink-0 text-primary" aria-hidden />
            Builder / Developer Portal
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Administer builder and developer organisations, portal users, memberships and the
            project, inventory and delivery surfaces they work in.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void load()}
          disabled={busy}
          className="w-full gap-2 sm:w-auto"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Refresh
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BuilderStatCard
          icon={Building2}
          value={`${stats.activeOrganisations}/${stats.organisations}`}
          label="Organisations"
          hint="active organisations"
        />
        <BuilderStatCard
          icon={Users}
          value={`${stats.activeUsers}/${stats.users}`}
          label="Portal users"
          hint="with live portal access"
        />
        <BuilderStatCard
          icon={Mail}
          value={stats.pendingInvitations}
          label="Pending invitations"
          hint="awaiting account setup"
        />
        <BuilderStatCard
          icon={KeyRound}
          value={`${stats.liveMemberships}/${stats.memberships}`}
          label="Active memberships"
          hint="organisation access grants"
        />
      </div>

      {(!canEdit || usersWithoutAccess.length > 0) && (
        <div className="space-y-3">
          {!canEdit && (
            <Alert className="border-border bg-muted/40">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              <AlertDescription>
                You have read-only access to this module. Contact an administrator to request edit permission.
              </AlertDescription>
            </Alert>
          )}

          {usersWithoutAccess.length > 0 && (
            <Alert className="border-destructive/30 bg-destructive/5">
              <Users className="h-4 w-4" aria-hidden />
              <AlertDescription>
                {usersWithoutAccess.length} portal {usersWithoutAccess.length === 1 ? 'user has' : 'users have'} no
                active organisation membership and therefore no portal access.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <Tabs defaultValue="organisations">
        <TabsList className="w-full justify-start gap-1 sm:justify-start">
          <TabsTrigger value="organisations" className="relative shrink-0 gap-2">
            <Building2 className="h-4 w-4 shrink-0" aria-hidden />
            Organisations
            {/* The badge is decorative; the count is spelled out for screen
                readers so the tab is not announced as "Organisations5". */}
            <span className="text-xs font-normal opacity-60 tabular-nums" aria-hidden>
              {organisations.length}
            </span>
            <span className="sr-only">, {organisations.length} organisations</span>
          </TabsTrigger>
          <TabsTrigger value="users" className="relative shrink-0 gap-2">
            <Users className="h-4 w-4 shrink-0" aria-hidden />
            Portal users
            <span className="text-xs font-normal opacity-60 tabular-nums" aria-hidden>
              {users.length}
            </span>
            <span className="sr-only">, {users.length} portal users</span>
          </TabsTrigger>
          <TabsTrigger value="memberships" className="relative shrink-0 gap-2">
            <KeyRound className="h-4 w-4 shrink-0" aria-hidden />
            Memberships
            <span className="text-xs font-normal opacity-60 tabular-nums" aria-hidden>
              {liveMemberships.length}
            </span>
            <span className="sr-only">, {liveMemberships.length} active memberships</span>
          </TabsTrigger>
          <TabsTrigger value="projects" className="shrink-0 gap-2">
            <FolderKanban className="h-4 w-4 shrink-0" aria-hidden />
            Projects
          </TabsTrigger>
          <TabsTrigger value="inventory" className="shrink-0 gap-2">
            <Package className="h-4 w-4 shrink-0" aria-hidden />
            Inventory
          </TabsTrigger>
          <TabsTrigger value="transactions" className="shrink-0 gap-2">
            <Handshake className="h-4 w-4 shrink-0" aria-hidden />
            Transactions
          </TabsTrigger>
          <TabsTrigger value="construction" className="shrink-0 gap-2">
            <Hammer className="h-4 w-4 shrink-0" aria-hidden />
            Construction
          </TabsTrigger>
          <TabsTrigger value="delivery" className="shrink-0 gap-2">
            <Truck className="h-4 w-4 shrink-0" aria-hidden />
            Delivery
          </TabsTrigger>
          <TabsTrigger value="collaboration" className="shrink-0 gap-2">
            <MessageSquare className="h-4 w-4 shrink-0" aria-hidden />
            Collaboration
          </TabsTrigger>
          <TabsTrigger value="workspace" className="shrink-0 gap-2">
            <BriefcaseBusiness className="h-4 w-4 shrink-0" aria-hidden />
            Workspace
          </TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------- organisations */}
        <TabsContent value="organisations" className="mt-4">
          <Card>
            <CardHeader className="flex flex-col items-start justify-between gap-3 space-y-0 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <CardTitle className="text-base">Builder and developer organisations</CardTitle>
                <CardDescription>
                  A developer and a builder may be separate organisations. Organisations are never
                  created automatically from existing builder names.
                </CardDescription>
              </div>
              <Button
                disabled={!canEdit || busy}
                onClick={() => setOrgDialogOpen(true)}
                className="w-full gap-2 sm:w-auto"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add organisation
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <BuilderSearchField
                value={search}
                onValueChange={setSearch}
                placeholder="Search by legal name, trading name or ABN…"
                label="Search Builder Portal organisations and users"
              />

              {filteredOrganisations.length === 0 ? (
                isSearching ? (
                  <BuilderEmptyState
                    icon={Building2}
                    title="No matching organisations"
                    description="No organisation matches this search. Clear the search to see every organisation."
                  />
                ) : (
                  <BuilderEmptyState
                    icon={Building2}
                    title="No organisations yet"
                    description="Add the first builder or developer organisation. Portal users must belong to one before they can be invited."
                    action={canEdit ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setOrgDialogOpen(true)}
                        className="gap-2"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        Add organisation
                      </Button>
                    ) : undefined}
                  />
                )
              ) : (
                <Table className="!min-w-[820px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Organisation</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Type</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">ABN</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Status</TableHead>
                      <TableHead className="text-right text-xs font-semibold uppercase tracking-wide">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrganisations.map((organisation) => {
                      const meta = ORG_STATUS_META[organisation.status] ?? ORG_STATUS_META.pending_activation;
                      return (
                        <TableRow key={organisation.id}>
                          <TableCell className="max-w-[22rem]">
                            <span className="block break-words font-medium leading-tight">
                              {organisation.legal_name}
                            </span>
                            {organisation.trading_name && (
                              <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                                trading as {organisation.trading_name}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="whitespace-nowrap font-normal text-muted-foreground">
                              {ORG_TYPES.find((t) => t.value === organisation.org_type)?.label ?? organisation.org_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                            {organisation.abn ?? '—'}
                          </TableCell>
                          <TableCell>
                            <BuilderStatusBadge label={meta.label} dot={meta.dot} tone={meta.tone} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canEdit || busy}
                              onClick={() => void mutate('set_organisation_status', {
                                organisation_id: organisation.id,
                                expected_version: organisation.row_version,
                                status: organisation.is_active ? 'suspended' : 'active',
                                reason: organisation.is_active ? 'Suspended by administrator' : null,
                              }, organisation.is_active ? 'Organisation suspended' : 'Organisation activated')}
                            >
                              {organisation.is_active ? 'Suspend' : 'Activate'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ users */}
        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader className="flex flex-col items-start justify-between gap-3 space-y-0 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <CardTitle className="text-base">Portal users</CardTitle>
                <CardDescription>
                  Builders, developers and sales staff who sign in to the Builder Portal. Access is
                  granted in the fixed order shown below.
                </CardDescription>
              </div>
              <Button
                disabled={!canEdit || busy}
                onClick={() => setUserDialogOpen(true)}
                className="w-full gap-2 sm:w-auto"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add user
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <BuilderAccessLifecycle
                steps={ACCESS_LIFECYCLE_STEPS}
                footnote={(
                  <>
                    An account cannot be activated by hand — it becomes active only when the user
                    accepts their invitation and sets a password. Job title is descriptive and
                    grants nothing.
                  </>
                )}
              />

              <BuilderSearchField
                value={search}
                onValueChange={setSearch}
                placeholder="Search by name or email…"
                label="Search Builder Portal organisations and users"
              />

              {filteredUsers.length === 0 ? (
                isSearching ? (
                  <BuilderEmptyState
                    icon={Users}
                    title="No matching portal users"
                    description="No portal user matches this search. Clear the search to see everyone."
                  />
                ) : (
                  <BuilderEmptyState
                    icon={Users}
                    title="No portal users yet"
                    description="Add the first builder or developer contact. They are created without access — grant a membership, then invite them."
                    action={canEdit ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setUserDialogOpen(true)}
                        className="gap-2"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        Add user
                      </Button>
                    ) : undefined}
                  />
                )
              ) : (
                <Table className="!min-w-[1040px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">User</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Job title</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Access stage</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Organisation access</TableHead>
                      <TableHead className="text-right text-xs font-semibold uppercase tracking-wide">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => {
                      const memberOf = liveMemberships.filter((m) => m.builder_user_id === user.id);
                      const stage = accessStageFor(user, memberOf.length > 0);
                      const meta = ACCESS_STAGE_META[stage];
                      const canInvite = stage === 'not_invited';
                      const canResend = stage === 'invite_pending' || stage === 'invite_expired';
                      return (
                        <TableRow key={user.id} className="align-top">
                          <TableCell className="max-w-[18rem]">
                            <span className="block break-words font-medium leading-tight">{user.name}</span>
                            <span className="mt-0.5 block break-all text-xs text-muted-foreground">
                              {user.email}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[12rem] break-words text-sm text-muted-foreground">
                            {user.job_title ?? '—'}
                          </TableCell>
                          <TableCell>
                            <BuilderStatusBadge label={meta.label} dot={meta.dot} tone={meta.tone} />
                            <span className="mt-1.5 block max-w-[18rem] text-xs leading-snug text-muted-foreground">
                              {meta.hint}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[16rem] text-sm text-muted-foreground">
                            {memberOf.length === 0
                              ? (
                                <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
                                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                  No access
                                </span>
                              )
                              : (
                                <span className="flex flex-wrap gap-1">
                                  {memberOf.map((m) => (
                                    <Badge key={m.id} variant="outline" className="max-w-full font-normal">
                                      <span className="truncate">{organisationName(m.organisation_id)}</span>
                                    </Badge>
                                  ))}
                                </span>
                              )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {stage === 'no_membership' && (
                                <span className="text-xs text-muted-foreground">
                                  Grant a membership before inviting
                                </span>
                              )}

                              {(canInvite || canResend) && (
                                <Button
                                  size="sm"
                                  disabled={!canEdit || busy}
                                  onClick={() => void sendInvite(user, canInvite ? 'invite' : 'resend')}
                                  className="gap-2"
                                >
                                  <Mail className="h-4 w-4" aria-hidden />
                                  {canInvite ? 'Send invite' : 'Resend invite'}
                                </Button>
                              )}

                              {canResend && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!canEdit || busy}
                                  onClick={() => void revokeInvite(user)}
                                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                >
                                  Revoke invite
                                </Button>
                              )}

                              {stage === 'active' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!canEdit || busy}
                                  onClick={() => void mutate('set_user_status', {
                                    builder_user_id: user.id,
                                    expected_version: user.row_version,
                                    status: 'suspended',
                                    reason: 'Suspended by administrator',
                                  }, 'User suspended')}
                                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                >
                                  Suspend
                                </Button>
                              )}

                              {/* Restore is offered only for an account that
                                  actually completed setup. The server enforces
                                  the same rule and answers 409 otherwise. */}
                              {stage === 'suspended' && user.has_completed_account_setup && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!canEdit || busy}
                                  onClick={() => void mutate('set_user_status', {
                                    builder_user_id: user.id,
                                    expected_version: user.row_version,
                                    status: 'active',
                                  }, 'User restored')}
                                  className="gap-2"
                                >
                                  <UserCheck className="h-4 w-4" aria-hidden />
                                  Restore
                                </Button>
                              )}

                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!canEdit || busy}
                                onClick={() => void mutate('revoke_user_sessions', {
                                  builder_user_id: user.id, reason: 'revoked by administrator',
                                }, 'Sessions revoked')}
                              >
                                Revoke sessions
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------ memberships */}
        <TabsContent value="memberships" className="mt-4">
          <Card>
            <CardHeader className="flex flex-col items-start justify-between gap-3 space-y-0 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <CardTitle className="text-base">Organisation memberships</CardTitle>
                <CardDescription>
                  Membership is the only thing that grants portal access. Revoked memberships leave
                  this list, and revoking a user's last membership immediately ends their sessions.
                </CardDescription>
              </div>
              <Button
                disabled={!canEdit || busy}
                onClick={() => setMembershipDialogOpen(true)}
                className="w-full gap-2 sm:w-auto"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Grant membership
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {liveMemberships.length === 0 ? (
                <BuilderEmptyState
                  icon={KeyRound}
                  title="No active memberships yet"
                  description="Nobody holds portal access. Grant a membership to bind a portal user to an organisation."
                  action={canEdit ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setMembershipDialogOpen(true)}
                      className="gap-2"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      Grant membership
                    </Button>
                  ) : undefined}
                />
              ) : (
                <Table className="!min-w-[860px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">User</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Organisation</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Role</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Status</TableHead>
                      <TableHead className="text-right text-xs font-semibold uppercase tracking-wide">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {liveMemberships.map((membership) => (
                      <TableRow key={membership.id}>
                        <TableCell className="max-w-[16rem] break-words font-medium">
                          {userName(membership.builder_user_id)}
                        </TableCell>
                        <TableCell className="max-w-[18rem] break-words text-sm text-muted-foreground">
                          {organisationName(membership.organisation_id)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="whitespace-nowrap font-normal text-muted-foreground">
                            {MEMBERSHIP_ROLES.find((r) => r.value === membership.membership_role)?.label
                              ?? membership.membership_role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <BuilderStatusBadge label="Active" dot="bg-success" />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canEdit || busy}
                            onClick={() => void mutate('revoke_membership', {
                              membership_id: membership.id, reason: 'revoked by administrator',
                            }, 'Membership revoked')}
                            className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            Revoke
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* The domain panels each render their own Card, so they are not
            wrapped again here — a second border would only nest boxes. */}
        <TabsContent value="projects" className="mt-4">
          <AdminBuilderProjectsPanel canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="inventory" className="mt-4">
          <AdminBuilderInventoryPanel canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="transactions" className="mt-4">
          <AdminBuilderTransactionsPanel canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="construction" className="mt-4">
          <AdminBuilderConstructionPanel canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="delivery" className="mt-4">
          <AdminBuilderDeliveryPanel canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="collaboration" className="mt-4">
          <AdminBuilderCollaborationPanel canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="workspace" className="mt-4">
          <AdminBuilderWorkspacePanel canEdit={canEdit} />
        </TabsContent>

      </Tabs>

      {/* ------------------------------------------------------------ dialogs */}
      <Dialog open={orgDialogOpen} onOpenChange={setOrgDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add organisation</DialogTitle>
            <DialogDescription>
              New organisations start pending activation. Activate them once details are confirmed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-legal-name">Legal name</Label>
              <Input id="org-legal-name" value={orgForm.legal_name}
                onChange={(event) => setOrgForm({ ...orgForm, legal_name: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-trading-name">Trading name</Label>
              <Input id="org-trading-name" value={orgForm.trading_name}
                onChange={(event) => setOrgForm({ ...orgForm, trading_name: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-type">Organisation type</Label>
              <Select value={orgForm.org_type} onValueChange={(value) => setOrgForm({ ...orgForm, org_type: value })}>
                <SelectTrigger id="org-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORG_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-abn">ABN</Label>
              <Input id="org-abn" value={orgForm.abn} inputMode="numeric"
                onChange={(event) => setOrgForm({ ...orgForm, abn: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-email">Contact email</Label>
              <Input id="org-email" type="email" value={orgForm.contact_email}
                onChange={(event) => setOrgForm({ ...orgForm, contact_email: event.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrgDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !orgForm.legal_name.trim()}
              onClick={async () => {
                const ok = await mutate('upsert_organisation', orgForm, 'Organisation created');
                if (ok) {
                  setOrgDialogOpen(false);
                  setOrgForm({ legal_name: '', trading_name: '', org_type: 'builder', abn: '', contact_email: '' });
                }
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add portal user</DialogTitle>
            <DialogDescription>
              The user is created without access. Grant a membership to give them portal access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user-name">Name</Label>
              <Input id="user-name" value={userForm.name}
                onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">Email</Label>
              <Input id="user-email" type="email" value={userForm.email}
                onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-job-title">Job title</Label>
              <Input id="user-job-title" value={userForm.job_title}
                placeholder="Project manager, site supervisor, sales consultant…"
                onChange={(event) => setUserForm({ ...userForm, job_title: event.target.value })} />
              <p className="text-xs text-muted-foreground">
                Descriptive only. Access comes from the membership role, not the job title.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUserDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !userForm.name.trim() || !userForm.email.trim()}
              onClick={async () => {
                const ok = await mutate('create_user', userForm, 'Portal user created');
                if (ok) {
                  setUserDialogOpen(false);
                  setUserForm({ email: '', name: '', job_title: '' });
                }
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shown only when the server reports that the invitation email could not
          be sent. The link is one-time; it is not stored and cannot be shown
          again once this dialog is closed. */}
      <Dialog open={!!inviteLink} onOpenChange={(open) => { if (!open) setInviteLink(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy the invitation link</DialogTitle>
            <DialogDescription>
              Email delivery is not configured, so the invitation for {inviteLink?.email} was not
              sent. Pass this one-time link to them over a channel you trust. It cannot be shown
              again — issue a new invitation if it is lost.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="invite-link">Invitation link</Label>
            <Input id="invite-link" readOnly value={inviteLink?.url ?? ''} onFocus={(event) => event.target.select()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteLink(null)}>Close</Button>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteLink?.url ?? '');
                  toast.success('Invitation link copied');
                } catch {
                  toast.error('Could not copy — select the link and copy it manually.');
                }
              }}
            >
              <Copy className="mr-2 h-4 w-4" aria-hidden />
              Copy link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={membershipDialogOpen} onOpenChange={setMembershipDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant membership</DialogTitle>
            <DialogDescription>
              Membership binds a user to one organisation and is the only source of portal access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="membership-user">User</Label>
              <Select value={membershipForm.builder_user_id}
                onValueChange={(value) => setMembershipForm({ ...membershipForm, builder_user_id: value })}>
                <SelectTrigger id="membership-user"><SelectValue placeholder="Select a user" /></SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>{user.name} — {user.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="membership-org">Organisation</Label>
              <Select value={membershipForm.organisation_id}
                onValueChange={(value) => setMembershipForm({ ...membershipForm, organisation_id: value })}>
                <SelectTrigger id="membership-org"><SelectValue placeholder="Select an organisation" /></SelectTrigger>
                <SelectContent>
                  {organisations.filter((o) => o.status !== 'closed').map((organisation) => (
                    <SelectItem key={organisation.id} value={organisation.id}>{organisation.legal_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="membership-role">Role</Label>
              <Select value={membershipForm.membership_role}
                onValueChange={(value) => setMembershipForm({ ...membershipForm, membership_role: value })}>
                <SelectTrigger id="membership-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEMBERSHIP_ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMembershipDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !membershipForm.builder_user_id || !membershipForm.organisation_id}
              onClick={async () => {
                const ok = await mutate('upsert_membership', membershipForm, 'Membership granted');
                if (ok) {
                  setMembershipDialogOpen(false);
                  setMembershipForm({ builder_user_id: '', organisation_id: '', membership_role: 'member' });
                }
              }}
            >
              Grant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
