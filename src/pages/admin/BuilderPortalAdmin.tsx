import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BuilderStatCard } from '@/components/admin/builder-portal/ui/BuilderStatCard';
import { BuilderConfirmDialog, type BuilderConsequence } from '@/components/admin/builder-portal/ui/BuilderConfirmDialog';
import {
  BuilderUserFormDialog, type BuilderUserFormValues,
} from '@/components/admin/builder-portal/ui/BuilderUserFormDialog';
import {
  BuilderOrganisationFormDialog, type BuilderOrganisationFormValues,
} from '@/components/admin/builder-portal/ui/BuilderOrganisationFormDialog';
import {
  BuilderMembershipFormDialog, type BuilderMembershipFormValues,
} from '@/components/admin/builder-portal/ui/BuilderMembershipFormDialog';
import {
  BuilderPermissionsDialog, type BuilderPermissionKey, type BuilderPermissionOverride,
  type BuilderRoleDefault,
} from '@/components/admin/builder-portal/ui/BuilderPermissionsDialog';
import { BuilderEmptyState } from '@/components/admin/builder-portal/ui/BuilderEmptyState';
import { BuilderSearchField } from '@/components/admin/builder-portal/ui/BuilderSearchField';
import { BuilderStatusBadge } from '@/components/admin/builder-portal/ui/BuilderStatusBadge';
import {
  BuilderAccessLifecycle, type BuilderAccessLifecycleStep,
} from '@/components/admin/builder-portal/ui/BuilderAccessLifecycle';
import { toast } from 'sonner';
import {
  Archive, Ban, BriefcaseBusiness, Building2, Copy, FolderKanban, Hammer, Handshake, HardHat,
  KeyRound, Loader2, LogOut, Mail, MessageSquare, MoreHorizontal, Package, Pencil, Plus, Power,
  RefreshCw, RotateCcw, ShieldCheck, ShieldOff, Star, Trash2, Truck, UserCheck, UserPlus, Users,
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

const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const;

/**
 * The stages of project delivery, shown as a nested bar inside the Projects
 * tab. Each one keeps its existing panel, props and permissions untouched —
 * only where the panel is reached from has changed.
 */
const PROJECT_OPERATION_SECTIONS = [
  { value: 'projects', label: 'Projects', icon: FolderKanban },
  { value: 'inventory', label: 'Inventory', icon: Package },
  { value: 'construction', label: 'Construction', icon: Hammer },
  { value: 'delivery', label: 'Delivery', icon: Truck },
  { value: 'collaboration', label: 'Collaboration', icon: MessageSquare },
  { value: 'workspace', label: 'Workspace', icon: BriefcaseBusiness },
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
  contact_phone: string | null;
  website: string | null;
  address_line1: string | null;
  address_line2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  notes: string | null;
  status: string;
  is_active: boolean;
  row_version: number;
}

interface BuilderUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
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
  is_primary: boolean;
  status: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  row_version: number;
}

/**
 * Every destructive or status-changing action routes through one confirmation
 * dialog, so none of them can ship without the administrator being told what
 * ends and what is kept.
 */
type ConfirmAction =
  | { kind: 'user_revoke_access'; user: BuilderUser }
  | { kind: 'user_suspend'; user: BuilderUser }
  | { kind: 'user_restore_access'; user: BuilderUser; targetStatus: 'active' | 'suspended' | 'invited' }
  | { kind: 'user_revoke_invite'; user: BuilderUser }
  | { kind: 'user_revoke_sessions'; user: BuilderUser }
  | { kind: 'user_remove'; user: BuilderUser }
  | { kind: 'org_status'; organisation: BuilderOrganisation; status: 'active' | 'suspended' | 'closed' }
  | { kind: 'org_remove'; organisation: BuilderOrganisation }
  | { kind: 'membership_revoke'; membership: BuilderMembership; isLast: boolean }
  | { kind: 'membership_remove'; membership: BuilderMembership }
  | null;

/** An admin-function failure, carrying the structured detail the server sent. */
interface AdminCallError extends Error {
  code?: string;
  dependents?: string;
  currentVersion?: number;
  status?: number;
}

/**
 * What a refused removal is shown as.
 *
 * The server answers 409 `has_dependents` with a comma-separated list of what
 * is still attached. That list is the useful part, so it is broken out and
 * rendered as its own bullets rather than buried in a sentence, and each
 * refusal names the operation that does work instead.
 */
export interface BlockedRemoval {
  message: string;
  dependents: string[];
  recommendation?: string;
}

/**
 * Turns a refusal into something an administrator can act on.
 *
 * Nothing here echoes the server's raw text: a PostgreSQL sentinel or a
 * SQLSTATE is a bug report, not an instruction, so only wording chosen here
 * reaches the screen.
 *
 * Only business work reaches this path now. Access records — memberships,
 * sessions, permission overrides, onboarding rows — are removed with their
 * parent and never refuse it.
 */
function describeBlockedRemoval(kind: string, dependents?: string): BlockedRemoval {
  const parts = (dependents ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const recommendation = kind === 'user_remove'
    ? 'Revoke access instead — the account keeps its work and its history.'
    : kind === 'org_remove'
      ? 'Close the organisation instead — its projects and records are preserved.'
      : 'Revoke the membership instead to end access without removing the record.';

  return {
    message: 'This record cannot be removed because it holds business records.',
    // Sentence case for display; the server sends them lower-case.
    dependents: parts.map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1)),
    recommendation,
  };
}

export default function BuilderPortalAdmin() {
  const { canEdit } = useModulePermissions('builder_portal_admin');
  const [loading, setLoading] = useState(true);
  /**
   * The full-page loading state replaces the whole surface, which unmounts the
   * tabs with it. Every refresh after a mutation therefore reset the active tab
   * to Organisations — so deleting a membership bounced the administrator to a
   * different tab and looked as though nothing had happened. It is shown for
   * the first load only; later refreshes reload underneath the page.
   */
  const hasLoadedOnce = useRef(false);
  const [busy, setBusy] = useState(false);
  const [organisations, setOrganisations] = useState<BuilderOrganisation[]>([]);
  const [users, setUsers] = useState<BuilderUser[]>([]);
  const [memberships, setMemberships] = useState<BuilderMembership[]>([]);
  const [search, setSearch] = useState('');

  // Each form dialog holds the record it is editing, or null when it is being
  // used to create. That single piece of state is what makes "Add" and "Edit"
  // the same surface rather than two that can drift apart.
  const [orgDialog, setOrgDialog] = useState<{ open: boolean; organisation: BuilderOrganisation | null }>(
    { open: false, organisation: null });
  const [userDialog, setUserDialog] = useState<{ open: boolean; user: BuilderUser | null }>(
    { open: false, user: null });
  const [membershipDialog, setMembershipDialog] = useState<{ open: boolean; membership: BuilderMembership | null }>(
    { open: false, membership: null });

  const [permissionsDialog, setPermissionsDialog] = useState<{ open: boolean; membership: BuilderMembership | null }>(
    { open: false, membership: null });
  const [permissionKeys, setPermissionKeys] = useState<BuilderPermissionKey[]>([]);
  const [roleDefaults, setRoleDefaults] = useState<BuilderRoleDefault[]>([]);
  const [membershipOverrides, setMembershipOverrides] = useState<BuilderPermissionOverride[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);

  /**
   * Both tab selections are controlled. The page already survives a refresh
   * (the full-page loading state is first-load only), and holding the values
   * here means a mutation can never hand the administrator back to a different
   * tab mid-task.
   */
  const [primaryTab, setPrimaryTab] = useState('users');
  const [projectSection, setProjectSection] = useState('projects');

  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  /**
   * A refused removal explains itself inside the dialog instead of closing it,
   * so the administrator can read which records are holding the row and pick
   * the alternative the dialog names.
   */
  const [confirmBlocked, setConfirmBlocked] = useState<BlockedRemoval | null>(null);

  // Surfaced only when the invite function reports that email delivery did not
  // happen. The link is one-time and is never persisted anywhere in the browser.
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);

  const call = useCallback(async (operation: string, payload: Record<string, unknown> = {}) => {
    const { data, error } = await invokeSecureFunction('builder-portal-admin', { operation, ...payload });

    // A non-2xx reply sets `error` AND still returns the parsed body as `data`.
    // Throwing on `error` alone therefore threw away `code`, `dependents` and
    // `current_version` — every 409 arrived as a bare message, which is why a
    // refused removal showed a toast instead of explaining itself in the
    // dialog. Both carriers are read, and the body wins because it is the one
    // the function actually wrote.
    //
    // Scoped to this page on purpose: `invokeSecureFunction` is shared with
    // every other module, and its return shape is relied on across the app.
    if (error || data?.error) {
      const message = typeof data?.error === 'string' ? data.error : error?.message;
      const failure = new Error(message || 'Operation failed') as AdminCallError;
      failure.code = data?.code ?? (error as { code?: string } | null)?.code;
      failure.dependents = data?.dependents;
      failure.currentVersion = data?.current_version;
      failure.status = error?.status;
      throw failure;
    }
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
      hasLoadedOnce.current = true;
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

  /**
   * Runs a confirmed action. Unlike `mutate` this keeps the dialog open when
   * the server refuses a removal, because "you cannot remove this, and here is
   * what is holding it" is the whole answer the administrator needs.
   */
  const runConfirmed = useCallback(async (
    operation: string, payload: Record<string, unknown>, success: string,
  ) => {
    setBusy(true);
    setConfirmBlocked(null);
    try {
      await call(operation, payload);
      toast.success(success);
      setConfirm(null);
      await load();
    } catch (error) {
      const failure = error as AdminCallError;
      // A refused removal is an answer, not a failure. The dialog stays open
      // and explains itself, because closing it would leave the administrator
      // with a vanished toast and no idea what to do instead.
      if (failure?.code === 'has_dependents') {
        setConfirmBlocked(describeBlockedRemoval(confirm?.kind ?? '', failure.dependents));
        return;
      }
      toast.error(failure?.message || 'Operation failed');
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }, [call, load, confirm]);

  /** The permission catalogue is fetched once, when it is first needed. */
  const openPermissions = useCallback(async (membership: BuilderMembership) => {
    setPermissionsDialog({ open: true, membership });
    setPermissionsLoading(true);
    try {
      const [catalogue, current] = await Promise.all([
        permissionKeys.length
          ? Promise.resolve({ permission_keys: permissionKeys, role_defaults: roleDefaults })
          : call('get_permission_catalogue'),
        call('get_membership_permissions', { membership_id: membership.id }),
      ]);
      setPermissionKeys(catalogue?.permission_keys ?? []);
      setRoleDefaults(catalogue?.role_defaults ?? []);
      setMembershipOverrides(current?.overrides ?? []);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load membership permissions');
      setPermissionsDialog({ open: false, membership: null });
    } finally {
      setPermissionsLoading(false);
    }
  }, [call, permissionKeys, roleDefaults]);

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

  /** How many live memberships a user holds — the last one is the warning case. */
  const liveMembershipCountFor = useCallback(
    (userId: string) => liveMemberships.filter((m) => m.builder_user_id === userId).length,
    [liveMemberships],
  );

  /**
   * The confirmation copy for each action, in one place.
   *
   * Every entry has to answer the same four questions before it can be
   * confirmed: what happens, what is kept, whether sessions end, and whether
   * the action can be refused. Keeping them together is what stops one of them
   * quietly becoming a bare "are you sure?".
   */
  const confirmConfig = useMemo((): null | {
    title: string; description: string; consequences: BuilderConsequence[];
    confirmLabel: string; destructive: boolean;
    reasonRequired: boolean; reasonLabel?: string; reasonPlaceholder?: string;
    run: (reason: string) => void;
  } => {
    if (!confirm) return null;

    switch (confirm.kind) {
      case 'user_revoke_access': {
        const user = confirm.user;
        return {
          title: 'Revoke portal access?',
          description: `${user.name} will be blocked from signing in to the Builder Portal.`,
          consequences: [
            { tone: 'ends', text: 'Future sign-in is blocked immediately.' },
            { tone: 'ends', text: 'Every active Builder Portal session is ended.' },
            { tone: 'remains', text: 'The user, their memberships and their history are all kept.' },
            { tone: 'remains', text: 'Access can be restored later.' },
          ],
          confirmLabel: 'Revoke access', destructive: true,
          reasonRequired: true, reasonLabel: 'Reason for revoking access',
          reasonPlaceholder: 'Left the organisation, contract ended…',
          run: (reason) => void runConfirmed('set_user_status', {
            builder_user_id: user.id, expected_version: user.row_version,
            status: 'revoked', reason,
          }, 'Portal access revoked'),
        };
      }

      case 'user_suspend': {
        const user = confirm.user;
        return {
          title: 'Suspend this account?',
          description: `${user.name} will be unable to sign in until the account is restored.`,
          consequences: [
            { tone: 'ends', text: 'Sign-in is blocked and current sessions are ended.' },
            { tone: 'remains', text: 'Memberships, permissions and history are untouched.' },
            { tone: 'remains', text: 'Restoring the account returns access without a new invitation.' },
          ],
          confirmLabel: 'Suspend', destructive: true,
          reasonRequired: true, reasonLabel: 'Reason for suspending',
          reasonPlaceholder: 'On leave, under review…',
          run: (reason) => void runConfirmed('set_user_status', {
            builder_user_id: user.id, expected_version: user.row_version,
            status: 'suspended', reason,
          }, 'User suspended'),
        };
      }

      case 'user_restore_access': {
        const user = confirm.user;
        const target = confirm.targetStatus;
        const backToInvite = target === 'invited';
        return {
          title: 'Restore access?',
          description: backToInvite
            ? `${user.name} never finished setting up their account, so they return to the invitation stage rather than becoming active.`
            : target === 'suspended'
              ? `${user.name} will be moved from revoked back to suspended. Restore once more to return sign-in.`
              : `${user.name} will be able to sign in again.`,
          consequences: backToInvite
            ? [
              { tone: 'warning', text: 'The account has no password, so it cannot be made active by hand.' },
              { tone: 'remains', text: 'Send them a fresh invitation to finish setup.' },
              { tone: 'remains', text: 'Memberships and history are kept.' },
            ]
            : target === 'suspended'
              ? [
                { tone: 'remains', text: 'The account returns to suspended, not to active.' },
                { tone: 'warning', text: 'Sign-in stays blocked until it is restored again.' },
                { tone: 'remains', text: 'Memberships and history are kept.' },
              ]
              : [
                { tone: 'remains', text: 'The user can sign in again with their existing password.' },
                { tone: 'remains', text: 'Memberships and permissions resume as they were.' },
                { tone: 'warning', text: 'Refused if they have no valid membership or every organisation is closed.' },
              ],
          confirmLabel: 'Restore access', destructive: false,
          reasonRequired: false, reasonLabel: 'Reason (optional)',
          run: (reason) => void runConfirmed('set_user_status', {
            builder_user_id: user.id, expected_version: user.row_version,
            status: target, reason: reason || null,
          }, backToInvite ? 'Account returned to the invitation stage' : 'Access restored'),
        };
      }

      case 'user_revoke_invite': {
        const user = confirm.user;
        return {
          title: 'Revoke the pending invitation?',
          description: `The outstanding invitation for ${user.email} will stop working.`,
          consequences: [
            { tone: 'ends', text: 'The invitation link is invalidated and cannot be used.' },
            { tone: 'remains', text: 'The user account and its memberships are kept.' },
            { tone: 'remains', text: 'A fresh invitation can be sent at any time.' },
          ],
          confirmLabel: 'Revoke invite', destructive: true,
          reasonRequired: false,
          run: () => {
            setConfirm(null);
            void revokeInvite(user);
          },
        };
      }

      case 'user_revoke_sessions': {
        const user = confirm.user;
        return {
          title: 'Revoke active sessions?',
          description: `Signs ${user.name} out of the Builder Portal everywhere.`,
          consequences: [
            { tone: 'ends', text: 'Every active Builder Portal session is ended immediately.' },
            { tone: 'remains', text: 'The account status and memberships do not change.' },
            { tone: 'remains', text: 'They can sign back in straight away if their account is active.' },
          ],
          confirmLabel: 'Revoke sessions', destructive: false,
          reasonRequired: false, reasonLabel: 'Reason (optional)',
          run: (reason) => void runConfirmed('revoke_user_sessions', {
            builder_user_id: user.id, reason: reason || 'revoked by administrator',
          }, 'Sessions revoked'),
        };
      }

      case 'user_remove': {
        const user = confirm.user;
        return {
          title: 'Permanently remove this user?',
          description: `${user.name} (${user.email}) will be deleted. This cannot be undone.`,
          consequences: [
            { tone: 'ends', text: 'The account, its memberships, sessions and access grants are deleted.' },
            { tone: 'remains', text: 'Organisations, projects, documents and messages are all kept.' },
            { tone: 'remains', text: 'The audit trail is kept, and records who removed the account, when and why.' },
            { tone: 'warning', text: 'Refused if the account produced business work — uploads, messages, reservations or tasks. Revoke access instead.' },
          ],
          confirmLabel: 'Remove user', destructive: true,
          reasonRequired: true, reasonLabel: 'Reason for permanent removal',
          reasonPlaceholder: 'Created in error, duplicate record…',
          run: (reason) => void runConfirmed('delete_user', {
            builder_user_id: user.id, expected_version: user.row_version, reason,
          }, 'Portal user removed'),
        };
      }

      case 'org_status': {
        const organisation = confirm.organisation;
        const status = confirm.status;
        if (status === 'active') {
          const reopening = organisation.status === 'closed';
          return {
            title: reopening ? 'Reopen this organisation?' : 'Activate this organisation?',
            description: `${organisation.legal_name} will be able to hold memberships and portal access again.`,
            consequences: [
              { tone: 'remains', text: 'Members with a valid membership regain access.' },
              { tone: 'remains', text: 'New memberships can be granted again.' },
              { tone: 'remains', text: 'All existing records are unchanged.' },
            ],
            confirmLabel: reopening ? 'Reopen organisation' : 'Activate organisation',
            destructive: false, reasonRequired: false, reasonLabel: 'Reason (optional)',
            run: (reason) => void runConfirmed('set_organisation_status', {
              organisation_id: organisation.id, expected_version: organisation.row_version,
              status: 'active', reason: reason || null,
            }, reopening ? 'Organisation reopened' : 'Organisation activated'),
          };
        }
        if (status === 'suspended') {
          return {
            title: 'Suspend this organisation?',
            description: `Access through ${organisation.legal_name} will be blocked while it is suspended.`,
            consequences: [
              { tone: 'ends', text: 'Portal access through this organisation is blocked.' },
              { tone: 'ends', text: 'Sessions belonging to its members are ended.' },
              { tone: 'remains', text: 'Every organisation record, membership and project is kept.' },
              { tone: 'remains', text: 'The organisation can be restored at any time.' },
            ],
            confirmLabel: 'Suspend organisation', destructive: true,
            reasonRequired: true, reasonLabel: 'Reason for suspending',
            reasonPlaceholder: 'Compliance review, unpaid account…',
            run: (reason) => void runConfirmed('set_organisation_status', {
              organisation_id: organisation.id, expected_version: organisation.row_version,
              status: 'suspended', reason,
            }, 'Organisation suspended'),
          };
        }
        return {
          title: 'Close this organisation?',
          description: `${organisation.legal_name} will be closed. Closure is the end of the relationship, not a pause.`,
          consequences: [
            { tone: 'ends', text: 'Portal access through this organisation ends and sessions are closed.' },
            { tone: 'ends', text: 'No new membership of this organisation can be granted.' },
            { tone: 'remains', text: 'Projects, transactions, documents and history are all preserved.' },
            { tone: 'warning', text: 'Members whose only membership is here lose Builder Portal access.' },
          ],
          confirmLabel: 'Close organisation', destructive: true,
          reasonRequired: true, reasonLabel: 'Reason for closing',
          reasonPlaceholder: 'Relationship ended, entity wound up…',
          run: (reason) => void runConfirmed('set_organisation_status', {
            organisation_id: organisation.id, expected_version: organisation.row_version,
            status: 'closed', reason,
          }, 'Organisation closed'),
        };
      }

      case 'org_remove': {
        const organisation = confirm.organisation;
        return {
          title: 'Permanently remove this organisation?',
          description: `${organisation.legal_name} will be deleted. This cannot be undone.`,
          consequences: [
            { tone: 'ends', text: 'The organisation, its memberships and its access records are deleted.' },
            { tone: 'ends', text: 'Members lose access through it; anyone left with none has their sessions ended.' },
            { tone: 'remains', text: 'The users themselves are kept, including anyone who belonged only here.' },
            { tone: 'warning', text: 'Refused if it holds projects, inventory, transactions or documents. Close it instead.' },
          ],
          confirmLabel: 'Remove organisation', destructive: true,
          reasonRequired: true, reasonLabel: 'Reason for permanent removal',
          reasonPlaceholder: 'Created in error, duplicate entity…',
          run: (reason) => void runConfirmed('delete_organisation', {
            organisation_id: organisation.id, expected_version: organisation.row_version, reason,
          }, 'Organisation removed'),
        };
      }

      case 'membership_revoke': {
        const membership = confirm.membership;
        const who = userName(membership.builder_user_id);
        return {
          title: 'Revoke this membership?',
          description: `${who} will lose access through ${organisationName(membership.organisation_id)}.`,
          consequences: [
            { tone: 'ends', text: 'Access to this organisation ends immediately.' },
            ...(confirm.isLast
              ? [{
                tone: 'warning' as const,
                text: 'This is their last active membership — they will lose all Builder Portal access and their sessions will be ended.',
              }]
              : [{ tone: 'remains' as const, text: 'Their other memberships are unaffected.' }]),
            { tone: 'remains', text: 'The membership record is kept, marked revoked, as audit evidence.' },
            { tone: 'remains', text: 'A fresh membership can be granted later.' },
          ],
          confirmLabel: 'Revoke membership', destructive: true,
          reasonRequired: true, reasonLabel: 'Reason for revoking',
          reasonPlaceholder: 'Changed role, left the organisation…',
          run: (reason) => void runConfirmed('revoke_membership', {
            membership_id: membership.id, reason,
          }, 'Membership revoked'),
        };
      }

      case 'membership_remove': {
        const membership = confirm.membership;
        return {
          title: 'Permanently remove this membership?',
          description: `The link between ${userName(membership.builder_user_id)} and ${organisationName(membership.organisation_id)} will be deleted.`,
          consequences: [
            { tone: 'ends', text: 'The membership and its permission overrides are deleted.' },
            { tone: 'ends', text: 'Access through this organisation ends. If it is their last, their sessions end too.' },
            { tone: 'remains', text: 'The user is kept. The organisation is kept.' },
            { tone: 'remains', text: 'Projects, documents and the audit trail are kept — the removal is recorded with a full snapshot.' },
          ],
          confirmLabel: 'Remove membership', destructive: true,
          reasonRequired: true, reasonLabel: 'Reason for permanent removal',
          reasonPlaceholder: 'Granted in error…',
          run: (reason) => void runConfirmed('delete_membership', {
            membership_id: membership.id, expected_version: membership.row_version, reason,
          }, 'Membership removed'),
        };
      }

      default:
        return null;
    }
  }, [confirm, runConfirmed, revokeInvite, userName, organisationName]);

  if (loading && !hasLoadedOnce.current) {
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
          disabled={busy || loading}
          className="w-full gap-2 sm:w-auto"
        >
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
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

      <Tabs value={primaryTab} onValueChange={setPrimaryTab}>
        <TabsList className="w-full justify-start gap-1 sm:justify-start">
          <TabsTrigger value="users" className="relative shrink-0 gap-2">
            <Users className="h-4 w-4 shrink-0" aria-hidden />
            Portal users
            {/* The badge is decorative; the count is spelled out for screen
                readers so the tab is not announced as "Portal users7". */}
            <span className="text-xs font-normal opacity-60 tabular-nums" aria-hidden>
              {users.length}
            </span>
            <span className="sr-only">, {users.length} portal users</span>
          </TabsTrigger>
          <TabsTrigger value="organisations" className="relative shrink-0 gap-2">
            <Building2 className="h-4 w-4 shrink-0" aria-hidden />
            Organisations
            <span className="text-xs font-normal opacity-60 tabular-nums" aria-hidden>
              {organisations.length}
            </span>
            <span className="sr-only">, {organisations.length} organisations</span>
          </TabsTrigger>
          <TabsTrigger value="memberships" className="relative shrink-0 gap-2">
            <KeyRound className="h-4 w-4 shrink-0" aria-hidden />
            Memberships
            {/* Counts the rows the tab actually shows, revoked included. */}
            <span className="text-xs font-normal opacity-60 tabular-nums" aria-hidden>
              {memberships.length}
            </span>
            <span className="sr-only">, {memberships.length} memberships</span>
          </TabsTrigger>
          {/* Projects and Transactions carry no badge: neither count is loaded
              by this page, and a fabricated number is worse than none. */}
          <TabsTrigger value="projects" className="shrink-0 gap-2">
            <FolderKanban className="h-4 w-4 shrink-0" aria-hidden />
            Projects
          </TabsTrigger>
          <TabsTrigger value="transactions" className="shrink-0 gap-2">
            <Handshake className="h-4 w-4 shrink-0" aria-hidden />
            Transactions
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
                onClick={() => setOrgDialog({ open: true, organisation: null })}
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
                        onClick={() => setOrgDialog({ open: true, organisation: null })}
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
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={!canEdit || busy}
                                  aria-label={`Actions for ${organisation.legal_name}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel>Organisation</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => setOrgDialog({ open: true, organisation })}>
                                  <Pencil className="mr-2 h-4 w-4" aria-hidden />
                                  Edit organisation
                                </DropdownMenuItem>
                          
                                <DropdownMenuSeparator />
                          
                                {(organisation.status === 'pending_activation' || organisation.status === 'closed') && (
                                  <DropdownMenuItem
                                    onClick={() => setConfirm({ kind: 'org_status', organisation, status: 'active' })}
                                  >
                                    <Power className="mr-2 h-4 w-4" aria-hidden />
                                    Activate organisation
                                  </DropdownMenuItem>
                                )}
                          
                                {organisation.status === 'suspended' && (
                                  <DropdownMenuItem
                                    onClick={() => setConfirm({ kind: 'org_status', organisation, status: 'active' })}
                                  >
                                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                                    Restore organisation
                                  </DropdownMenuItem>
                                )}
                          
                                {organisation.status === 'active' && (
                                  <DropdownMenuItem
                                    onClick={() => setConfirm({ kind: 'org_status', organisation, status: 'suspended' })}
                                  >
                                    <Ban className="mr-2 h-4 w-4" aria-hidden />
                                    Suspend organisation
                                  </DropdownMenuItem>
                                )}
                          
                                {organisation.status !== 'closed' && (
                                  <DropdownMenuItem
                                    onClick={() => setConfirm({ kind: 'org_status', organisation, status: 'closed' })}
                                  >
                                    <Archive className="mr-2 h-4 w-4" aria-hidden />
                                    Close organisation
                                  </DropdownMenuItem>
                                )}
                          
                                <DropdownMenuSeparator />
                          
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setConfirm({ kind: 'org_remove', organisation })}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                                  Remove organisation
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
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
                onClick={() => setUserDialog({ open: true, user: null })}
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
                        onClick={() => setUserDialog({ open: true, user: null })}
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
                      // Restore puts a suspended account that actually finished setup straight
                      // back to active. Anything else has no password, so it returns to the
                      // invitation lifecycle rather than being made active by hand; a revoked
                      // account goes back to suspended first, which is the transition the
                      // server's activation guard documents. All three are re-checked server-side.
                      const restoreTarget: 'active' | 'suspended' | 'invited' =
                        stage === 'suspended' && user.has_completed_account_setup ? 'active'
                          : !user.has_completed_account_setup ? 'invited'
                            : 'suspended';
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
                          
                              {/* The invitation is the one action a row is usually waiting on, so
                                  it stays on the surface instead of hiding inside the menu. */}
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
                          
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={!canEdit || busy}
                                    aria-label={`Actions for ${user.name}`}
                                  >
                                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-60">
                                  <DropdownMenuLabel>Portal user</DropdownMenuLabel>
                                  <DropdownMenuItem onClick={() => setUserDialog({ open: true, user })}>
                                    <Pencil className="mr-2 h-4 w-4" aria-hidden />
                                    Edit user
                                  </DropdownMenuItem>
                          
                                  {stage === 'no_membership' && (
                                    <DropdownMenuItem
                                      onClick={() => setMembershipDialog({ open: true, membership: null })}
                                    >
                                      <KeyRound className="mr-2 h-4 w-4" aria-hidden />
                                      Grant membership
                                    </DropdownMenuItem>
                                  )}
                          
                                  <DropdownMenuSeparator />
                          
                                  {canResend && (
                                    <DropdownMenuItem
                                      onClick={() => setConfirm({ kind: 'user_revoke_invite', user })}
                                    >
                                      <Mail className="mr-2 h-4 w-4" aria-hidden />
                                      Revoke invite
                                    </DropdownMenuItem>
                                  )}
                          
                                  {stage === 'active' && (
                                    <DropdownMenuItem
                                      onClick={() => setConfirm({ kind: 'user_suspend', user })}
                                    >
                                      <Ban className="mr-2 h-4 w-4" aria-hidden />
                                      Suspend
                                    </DropdownMenuItem>
                                  )}
                          
                                  {(stage === 'suspended' || stage === 'revoked') && (
                                    <DropdownMenuItem
                                      onClick={() => setConfirm({
                                        kind: 'user_restore_access', user, targetStatus: restoreTarget,
                                      })}
                                    >
                                      <UserCheck className="mr-2 h-4 w-4" aria-hidden />
                                      Restore access
                                    </DropdownMenuItem>
                                  )}
                          
                                  <DropdownMenuItem
                                    onClick={() => setConfirm({ kind: 'user_revoke_sessions', user })}
                                  >
                                    <LogOut className="mr-2 h-4 w-4" aria-hidden />
                                    Revoke sessions
                                  </DropdownMenuItem>
                          
                                  <DropdownMenuSeparator />
                          
                                  {stage !== 'revoked' && (
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={() => setConfirm({ kind: 'user_revoke_access', user })}
                                    >
                                      <ShieldOff className="mr-2 h-4 w-4" aria-hidden />
                                      Revoke access
                                    </DropdownMenuItem>
                                  )}
                          
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setConfirm({ kind: 'user_remove', user })}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                                    Remove user
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
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
                  Membership is the only thing that grants portal access. Revoking a user's last
                  membership immediately ends their sessions. Revoked memberships stay listed as
                  audit evidence and can be re-granted.
                </CardDescription>
              </div>
              <Button
                disabled={!canEdit || busy}
                onClick={() => setMembershipDialog({ open: true, membership: null })}
                className="w-full gap-2 sm:w-auto"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Grant membership
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {memberships.length === 0 ? (
                <BuilderEmptyState
                  icon={KeyRound}
                  title="No active memberships yet"
                  description="Nobody holds portal access. Grant a membership to bind a portal user to an organisation."
                  action={canEdit ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setMembershipDialog({ open: true, membership: null })}
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
                    {memberships.map((membership) => {
                      const isRevoked = !!membership.revoked_at;
                      const isLast = !isRevoked
                        && liveMembershipCountFor(membership.builder_user_id) === 1;
                      return (
                        <TableRow key={membership.id}>
                          <TableCell className="max-w-[16rem] break-words font-medium">
                            {userName(membership.builder_user_id)}
                          </TableCell>
                          <TableCell className="max-w-[18rem] break-words text-sm text-muted-foreground">
                            {organisationName(membership.organisation_id)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline" className="whitespace-nowrap font-normal text-muted-foreground">
                                {MEMBERSHIP_ROLES.find((r) => r.value === membership.membership_role)?.label
                                  ?? membership.membership_role}
                              </Badge>
                              {membership.is_primary && (
                                <Badge variant="outline" className="gap-1 whitespace-nowrap font-normal">
                                  <Star className="h-3 w-3 shrink-0" aria-hidden />
                                  Primary
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {isRevoked
                              ? <BuilderStatusBadge label="Revoked" tone="destructive" />
                              : <BuilderStatusBadge label="Active" dot="bg-success" />}
                            {isRevoked && membership.revoked_reason && (
                              <span className="mt-1 block max-w-[16rem] text-xs leading-snug text-muted-foreground">
                                {membership.revoked_reason}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={!canEdit || busy}
                                  aria-label={`Actions for ${userName(membership.builder_user_id)} in ${organisationName(membership.organisation_id)}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-60">
                                <DropdownMenuLabel>Membership</DropdownMenuLabel>

                                {isRevoked ? (
                                  <DropdownMenuItem
                                    onClick={() => setMembershipDialog({ open: true, membership })}
                                  >
                                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                                    Restore membership
                                  </DropdownMenuItem>
                                ) : (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() => setMembershipDialog({ open: true, membership })}
                                    >
                                      <Pencil className="mr-2 h-4 w-4" aria-hidden />
                                      Edit membership
                                    </DropdownMenuItem>

                                    {!membership.is_primary && (
                                      <DropdownMenuItem
                                        onClick={() => void mutate('upsert_membership', {
                                          builder_user_id: membership.builder_user_id,
                                          organisation_id: membership.organisation_id,
                                          membership_role: membership.membership_role,
                                          is_primary: true,
                                          expected_version: membership.row_version,
                                        }, 'Primary organisation updated')}
                                      >
                                        <Star className="mr-2 h-4 w-4" aria-hidden />
                                        Set primary
                                      </DropdownMenuItem>
                                    )}

                                    <DropdownMenuItem onClick={() => void openPermissions(membership)}>
                                      <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />
                                      Edit permissions
                                    </DropdownMenuItem>
                                  </>
                                )}

                                <DropdownMenuSeparator />

                                {/* Revoking only applies to a live membership. Removal
                                    applies to either: a membership is access, and the
                                    removal audit record is what is kept. */}
                                {!isRevoked && (
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setConfirm({ kind: 'membership_revoke', membership, isLast })}
                                  >
                                    <ShieldOff className="mr-2 h-4 w-4" aria-hidden />
                                    Revoke membership
                                  </DropdownMenuItem>
                                )}

                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setConfirm({ kind: 'membership_remove', membership })}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                                  Remove membership
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
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

        {/* ---------------------------------------------- project operations */}
        {/* Inventory, construction, delivery, collaboration and workspace are
            stages of the same project lifecycle, so they sit under Projects as
            a nested section rather than as five more top-level tabs.

            Each panel renders its own Card. The heading and the nested bar
            therefore live in a lighter bordered strip above them rather than in
            a Card of their own — wrapping a Card around a Card would just draw
            a second border round every panel. */}
        <TabsContent value="projects" className="mt-4">
          <Tabs value={projectSection} onValueChange={setProjectSection} className="space-y-4">
            <section className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Project operations</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Manage projects and the connected inventory, construction, delivery and
                  collaboration workflows.
                </p>
              </div>
              {/* Deliberately lighter than the primary bar — a bordered strip on
                  the page background rather than a filled segmented control — so
                  the nesting reads at a glance. */}
              <TabsList
                aria-label="Project operations sections"
                className="h-auto w-full justify-start gap-1 border border-border bg-background p-1 sm:justify-start"
              >
                {PROJECT_OPERATION_SECTIONS.map((section) => (
                  <TabsTrigger
                    key={section.value}
                    value={section.value}
                    className="shrink-0 gap-2 text-xs data-[state=active]:bg-muted"
                  >
                    <section.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {section.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </section>

            <TabsContent value="projects" className="mt-0">
              <AdminBuilderProjectsPanel canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="inventory" className="mt-0">
              <AdminBuilderInventoryPanel canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="construction" className="mt-0">
              <AdminBuilderConstructionPanel canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="delivery" className="mt-0">
              <AdminBuilderDeliveryPanel canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="collaboration" className="mt-0">
              <AdminBuilderCollaborationPanel canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="workspace" className="mt-0">
              <AdminBuilderWorkspacePanel canEdit={canEdit} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Transactions stays top-level: it is a commercial surface in its own
            right, not a stage of project delivery. */}
        <TabsContent value="transactions" className="mt-4">
          <AdminBuilderTransactionsPanel canEdit={canEdit} />
        </TabsContent>

      </Tabs>

      {/* ------------------------------------------------------------ dialogs */}
      <BuilderOrganisationFormDialog
        open={orgDialog.open}
        onOpenChange={(open) => setOrgDialog((current) => ({ ...current, open }))}
        initial={orgDialog.organisation
          ? {
            id: orgDialog.organisation.id,
            legal_name: orgDialog.organisation.legal_name ?? '',
            trading_name: orgDialog.organisation.trading_name ?? '',
            org_type: orgDialog.organisation.org_type ?? 'builder',
            abn: orgDialog.organisation.abn ?? '',
            acn: orgDialog.organisation.acn ?? '',
            contact_email: orgDialog.organisation.contact_email ?? '',
            contact_phone: orgDialog.organisation.contact_phone ?? '',
            website: orgDialog.organisation.website ?? '',
            address_line1: orgDialog.organisation.address_line1 ?? '',
            address_line2: orgDialog.organisation.address_line2 ?? '',
            suburb: orgDialog.organisation.suburb ?? '',
            state: orgDialog.organisation.state ?? '',
            postcode: orgDialog.organisation.postcode ?? '',
            notes: orgDialog.organisation.notes ?? '',
          }
          : null}
        orgTypes={ORG_TYPES}
        auStates={AU_STATES}
        busy={busy}
        onSubmit={async (values: BuilderOrganisationFormValues) => {
          const editing = orgDialog.organisation;
          const ok = await mutate('upsert_organisation', editing
            ? { ...values, organisation_id: editing.id, expected_version: editing.row_version }
            : { ...values },
          editing ? 'Organisation updated' : 'Organisation created');
          if (ok) setOrgDialog({ open: false, organisation: null });
        }}
      />

      <BuilderUserFormDialog
        open={userDialog.open}
        onOpenChange={(open) => setUserDialog((current) => ({ ...current, open }))}
        initial={userDialog.user
          ? {
            id: userDialog.user.id,
            name: userDialog.user.name ?? '',
            email: userDialog.user.email ?? '',
            job_title: userDialog.user.job_title ?? '',
            phone: userDialog.user.phone ?? '',
          }
          : null}
        busy={busy}
        onSubmit={async (values: BuilderUserFormValues) => {
          const editing = userDialog.user;
          const ok = await mutate(
            editing ? 'update_user' : 'create_user',
            editing
              ? { ...values, builder_user_id: editing.id, expected_version: editing.row_version }
              : { ...values },
            editing ? 'Portal user updated' : 'Portal user created',
          );
          if (ok) setUserDialog({ open: false, user: null });
        }}
      />

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

      <BuilderMembershipFormDialog
        open={membershipDialog.open}
        onOpenChange={(open) => setMembershipDialog((current) => ({ ...current, open }))}
        initial={membershipDialog.membership
          ? {
            id: membershipDialog.membership.id,
            builder_user_id: membershipDialog.membership.builder_user_id,
            organisation_id: membershipDialog.membership.organisation_id,
            membership_role: membershipDialog.membership.membership_role,
            is_primary: !!membershipDialog.membership.is_primary,
          }
          : null}
        users={users}
        organisations={organisations}
        roles={MEMBERSHIP_ROLES}
        userLabel={membershipDialog.membership ? userName(membershipDialog.membership.builder_user_id) : undefined}
        organisationLabel={membershipDialog.membership ? organisationName(membershipDialog.membership.organisation_id) : undefined}
        busy={busy}
        onSubmit={async (values: BuilderMembershipFormValues) => {
          // One operation covers grant, role change, primary change and the
          // re-grant of a revoked membership: upsert_membership matches on the
          // live row, so a revoked one is replaced by a fresh grant rather than
          // being resurrected, and the revoked record stays as evidence.
          const editingLive = membershipDialog.membership && !membershipDialog.membership.revoked_at
            ? membershipDialog.membership
            : null;
          const ok = await mutate('upsert_membership', {
            ...values,
            ...(editingLive ? { expected_version: editingLive.row_version } : {}),
          }, editingLive ? 'Membership updated' : 'Membership granted');
          if (ok) setMembershipDialog({ open: false, membership: null });
        }}
      />

      <BuilderPermissionsDialog
        open={permissionsDialog.open}
        onOpenChange={(open) => {
          setPermissionsDialog((current) => ({ ...current, open }));
          if (!open) setMembershipOverrides([]);
        }}
        membershipLabel={permissionsDialog.membership
          ? `${userName(permissionsDialog.membership.builder_user_id)} at ${organisationName(permissionsDialog.membership.organisation_id)}`
          : ''}
        membershipRole={permissionsDialog.membership?.membership_role ?? 'member'}
        permissionKeys={permissionKeys}
        roleDefaults={roleDefaults}
        overrides={membershipOverrides}
        loading={permissionsLoading}
        busy={busy}
        onSave={async (overrides) => {
          const membership = permissionsDialog.membership;
          if (!membership) return;
          const ok = await mutate('update_membership_permissions', {
            membership_id: membership.id, overrides,
          }, 'Membership permissions updated');
          if (ok) {
            setPermissionsDialog({ open: false, membership: null });
            setMembershipOverrides([]);
          }
        }}
      />

      {confirmConfig && (
        <BuilderConfirmDialog
          open={!!confirm}
          onOpenChange={(open) => { if (!open) { setConfirm(null); setConfirmBlocked(null); } }}
          title={confirmConfig.title}
          description={confirmConfig.description}
          consequences={confirmConfig.consequences}
          reasonRequired={confirmConfig.reasonRequired}
          reasonLabel={confirmConfig.reasonLabel}
          reasonPlaceholder={confirmConfig.reasonPlaceholder}
          confirmLabel={confirmConfig.confirmLabel}
          destructive={confirmConfig.destructive}
          busy={busy}
          blocked={confirmBlocked}
          onConfirm={confirmConfig.run}
        />
      )}

    </div>
  );
}
