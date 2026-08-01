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
import { toast } from 'sonner';
import { HardHat, Loader2, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react';

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

const ORG_STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  active: { label: 'Active', variant: 'default' },
  pending_activation: { label: 'Pending activation', variant: 'secondary' },
  suspended: { label: 'Suspended', variant: 'outline' },
  closed: { label: 'Closed', variant: 'destructive' },
};

const USER_STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  active: { label: 'Active', variant: 'default' },
  invited: { label: 'Invited', variant: 'secondary' },
  suspended: { label: 'Suspended', variant: 'outline' },
  revoked: { label: 'Revoked', variant: 'destructive' },
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
  row_version: number;
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

  const call = useCallback(async (operation: string, payload: Record<string, unknown> = {}) => {
    const { data, error } = await invokeSecureFunction('builder-portal-admin', { operation, ...payload });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
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

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="space-y-3 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden />
          <p className="text-sm text-muted-foreground">Loading Builder Portal administration…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
            <HardHat className="h-5 w-5 text-primary" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Builder / Developer Portal</h1>
            <p className="text-sm text-muted-foreground">
              Administer builder and developer organisations, portal users and memberships.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
          Refresh
        </Button>
      </header>

      {!canEdit && (
        <Alert>
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <AlertDescription>
            You have read-only access to this module. Contact an administrator to request edit permission.
          </AlertDescription>
        </Alert>
      )}

      {usersWithoutAccess.length > 0 && (
        <Alert>
          <Users className="h-4 w-4" aria-hidden />
          <AlertDescription>
            {usersWithoutAccess.length} portal {usersWithoutAccess.length === 1 ? 'user has' : 'users have'} no
            active organisation membership and therefore no portal access.
          </AlertDescription>
        </Alert>
      )}

      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search organisations and users"
        aria-label="Search Builder Portal organisations and users"
        className="max-w-md"
      />

      <Tabs defaultValue="organisations">
        <TabsList>
          <TabsTrigger value="organisations">Organisations ({organisations.length})</TabsTrigger>
          <TabsTrigger value="users">Portal users ({users.length})</TabsTrigger>
          <TabsTrigger value="memberships">Memberships ({liveMemberships.length})</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------- organisations */}
        <TabsContent value="organisations" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Builder and developer organisations</CardTitle>
                <CardDescription>
                  A developer and a builder may be separate organisations. Organisations are never
                  created automatically from existing builder names.
                </CardDescription>
              </div>
              <Button size="sm" disabled={!canEdit || busy} onClick={() => setOrgDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Add organisation
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Legal name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>ABN</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrganisations.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                          No organisations yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {filteredOrganisations.map((organisation) => {
                      const meta = ORG_STATUS_META[organisation.status] ?? ORG_STATUS_META.pending_activation;
                      return (
                        <TableRow key={organisation.id}>
                          <TableCell>
                            <span className="font-medium">{organisation.legal_name}</span>
                            {organisation.trading_name && (
                              <span className="block text-xs text-muted-foreground">
                                trading as {organisation.trading_name}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {ORG_TYPES.find((t) => t.value === organisation.org_type)?.label ?? organisation.org_type}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{organisation.abn ?? '—'}</TableCell>
                          <TableCell><Badge variant={meta.variant}>{meta.label}</Badge></TableCell>
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
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ users */}
        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Portal users</CardTitle>
                <CardDescription>
                  A user needs an active organisation membership before they have any portal access.
                  Job title is descriptive and grants nothing.
                </CardDescription>
              </div>
              <Button size="sm" disabled={!canEdit || busy} onClick={() => setUserDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Add user
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Job title</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Access</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                          No portal users yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {filteredUsers.map((user) => {
                      const meta = USER_STATUS_META[user.status] ?? USER_STATUS_META.invited;
                      const memberOf = liveMemberships.filter((m) => m.builder_user_id === user.id);
                      return (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">{user.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{user.job_title ?? '—'}</TableCell>
                          <TableCell><Badge variant={meta.variant}>{meta.label}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {memberOf.length === 0
                              ? <span className="text-destructive">No access</span>
                              : memberOf.map((m) => organisationName(m.organisation_id)).join(', ')}
                          </TableCell>
                          <TableCell className="space-x-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canEdit || busy}
                              onClick={() => void mutate('set_user_status', {
                                builder_user_id: user.id,
                                expected_version: user.row_version,
                                status: user.is_active ? 'suspended' : 'active',
                              }, user.is_active ? 'User suspended' : 'User activated')}
                            >
                              {user.is_active ? 'Suspend' : 'Activate'}
                            </Button>
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
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------ memberships */}
        <TabsContent value="memberships" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Organisation memberships</CardTitle>
                <CardDescription>
                  Membership is the only thing that grants portal access. Revoking a user's last
                  membership immediately ends their sessions.
                </CardDescription>
              </div>
              <Button size="sm" disabled={!canEdit || busy} onClick={() => setMembershipDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Grant membership
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Organisation</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {liveMemberships.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                          No active memberships yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {liveMemberships.map((membership) => (
                      <TableRow key={membership.id}>
                        <TableCell className="font-medium">{userName(membership.builder_user_id)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {organisationName(membership.organisation_id)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {MEMBERSHIP_ROLES.find((r) => r.value === membership.membership_role)?.label
                            ?? membership.membership_role}
                        </TableCell>
                        <TableCell><Badge variant="default">Active</Badge></TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canEdit || busy}
                            onClick={() => void mutate('revoke_membership', {
                              membership_id: membership.id, reason: 'revoked by administrator',
                            }, 'Membership revoked')}
                          >
                            Revoke
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
              <TabsContent value="projects" className="mt-4">
          <AdminBuilderProjectsPanel canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="inventory" className="mt-4">
          <AdminBuilderInventoryPanel canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="transactions" className="mt-4">
          <AdminBuilderTransactionsPanel canEdit={canEdit} />
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
