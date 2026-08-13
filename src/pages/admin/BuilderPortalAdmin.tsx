import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { PartnerAgreementsPanel } from '@/components/admin/PartnerAgreementsPanel';
import { useAgreementDownload } from '@/components/admin/useAgreementDownload';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { BuilderOrganisationDialog } from '@/components/admin/builder-portal/BuilderOrganisationDialog';
import { BuilderOrganisationStatusDialog } from '@/components/admin/builder-portal/BuilderOrganisationStatusDialog';
import { BuilderUserDialog } from '@/components/admin/builder-portal/BuilderUserDialog';
import { BuilderMembershipDialog } from '@/components/admin/builder-portal/BuilderMembershipDialog';
import { BuilderUserSessionsDialog } from '@/components/admin/builder-portal/BuilderUserSessionsDialog';
import { BuilderMembershipPermissionsDialog } from '@/components/admin/builder-portal/BuilderMembershipPermissionsDialog';
import {
  MEMBERSHIP_ROLES, ORG_STATUS_META, ORG_TYPES,
  type BuilderMembership, type BuilderOrganisation, type BuilderPermissionKey,
  type BuilderPermissionOverride, type BuilderRoleDefault, type BuilderUser,
  type BuilderUserSession,
} from '@/components/admin/builder-portal/accessTypes';
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
import { ACCESS_ROLE_OPTIONS, accessErrorMessage } from '@/lib/builderAccessTerms';
import { toast } from 'sonner';
import {
  Copy, HardHat, KeyRound, Loader2, Mail, Pencil, Plus, RefreshCw, ShieldCheck, Users,
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

/**
 * Where a user sits in the Builder access lifecycle:
 *
 *   create user -> grant organisation access -> send invite -> accepts -> active
 *
 * Access comes before the invitation deliberately. An invitation to an account
 * with no organisation access leads nowhere, and `builder-portal-invite`
 * rejects it with 409 `no_membership`, so the interface must not offer it.
 *
 * The stage keys are the server's vocabulary and stay as they are; only the
 * labels and hints below are what a reader sees.
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
    hint: 'Step 2 of 5 — grant access to an organisation. Until then this user cannot be invited.',
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
  { label: 'grant organisation access', icon: KeyRound },
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

  // Each dialog holds the row it is editing; null means "create".
  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [orgEditing, setOrgEditing] = useState<BuilderOrganisation | null>(null);

  const [orgStatusOpen, setOrgStatusOpen] = useState(false);
  const [orgStatusTarget, setOrgStatusTarget] = useState<BuilderOrganisation | null>(null);

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userEditing, setUserEditing] = useState<BuilderUser | null>(null);

  const [membershipDialogOpen, setMembershipDialogOpen] = useState(false);
  const [membershipEditing, setMembershipEditing] = useState<BuilderMembership | null>(null);

  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionsUser, setSessionsUser] = useState<BuilderUser | null>(null);

  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissionsMembership, setPermissionsMembership] = useState<BuilderMembership | null>(null);

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
      // `builder-portal-invite` refuses an invitation to an account with no
      // access, in the server's own vocabulary. Only that one recognised
      // sentence is translated; every other message is shown verbatim.
      toast.error(accessErrorMessage(error?.message) || 'Failed to issue the invitation');
    } finally {
      setBusy(false);
    }
  }, [callInvite, load]);

  const loadSessions = useCallback(async (userId: string): Promise<BuilderUserSession[]> => {
    try {
      const data = await call('list_user_sessions', { builder_user_id: userId });
      return (data?.sessions ?? []) as BuilderUserSession[];
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load sessions');
      return [];
    }
  }, [call]);

  /**
   * The catalogue is the same for every membership, so it is fetched per dialog
   * open rather than cached here — it is small, and a stale catalogue would
   * offer a key the server has since forbidden.
   */
  const loadCatalogue = useCallback(async (): Promise<{
    permission_keys: BuilderPermissionKey[]; role_defaults: BuilderRoleDefault[];
  }> => {
    try {
      const data = await call('get_permission_catalogue');
      return {
        permission_keys: (data?.permission_keys ?? []) as BuilderPermissionKey[],
        role_defaults: (data?.role_defaults ?? []) as BuilderRoleDefault[],
      };
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load the permission catalogue');
      return { permission_keys: [], role_defaults: [] };
    }
  }, [call]);

  const loadOverrides = useCallback(async (membershipId: string): Promise<BuilderPermissionOverride[]> => {
    try {
      const data = await call('get_membership_permissions', { membership_id: membershipId });
      return (data?.overrides ?? []) as BuilderPermissionOverride[];
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load permission overrides');
      return [];
    }
  }, [call]);

  const savePermissions = useCallback(async (
    membershipId: string, overrides: Record<string, unknown>[], reason: string | null,
  ) => {
    setBusy(true);
    try {
      const data = await call('update_membership_permissions', {
        membership_id: membershipId, overrides, reason,
      });
      const rejected: string[] = data?.rejected_keys ?? [];
      if (rejected.length) {
        // The server strips forbidden and unknown keys rather than failing the
        // whole write, so say which were dropped instead of implying success.
        toast.warning(`Saved. ${rejected.length} key(s) were rejected: ${rejected.join(', ')}`);
      } else {
        toast.success(`Permissions saved (${data?.applied ?? 0} override(s))`);
      }
      return data as { applied: number; rejected_keys: string[] };
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save permissions');
      return null;
    } finally {
      setBusy(false);
    }
  }, [call]);

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
      toast.error(error?.message || 'Failed to load access permissions');
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
            { tone: 'remains', text: 'The user, their organisation access and their history are all kept.' },
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
            { tone: 'remains', text: 'Organisation access, permissions and history are untouched.' },
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
              { tone: 'remains', text: 'Organisation access and history are kept.' },
            ]
            : target === 'suspended'
              ? [
                { tone: 'remains', text: 'The account returns to suspended, not to active.' },
                { tone: 'warning', text: 'Sign-in stays blocked until it is restored again.' },
                { tone: 'remains', text: 'Organisation access and history are kept.' },
              ]
              : [
                { tone: 'remains', text: 'The user can sign in again with their existing password.' },
                { tone: 'remains', text: 'Organisation access and permissions resume as they were.' },
                { tone: 'warning', text: 'Refused if they have no valid organisation access or every organisation is closed.' },
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
            { tone: 'remains', text: 'The user account and its organisation access are kept.' },
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
            { tone: 'remains', text: 'The account status and organisation access do not change.' },
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
            { tone: 'ends', text: 'The account, its organisation access, sessions and access grants are deleted.' },
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
            description: `${organisation.legal_name} will be able to hold organisation access and portal access again.`,
            consequences: [
              { tone: 'remains', text: 'Users with valid organisation access regain it.' },
              { tone: 'remains', text: 'New organisation access can be granted again.' },
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
              { tone: 'remains', text: 'Every organisation record, access assignment and project is kept.' },
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
            { tone: 'ends', text: 'No new access to this organisation can be granted.' },
            { tone: 'remains', text: 'Projects, transactions, documents and history are all preserved.' },
            { tone: 'warning', text: 'Users whose only organisation access is here lose the Builder Portal.' },
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
            { tone: 'ends', text: 'The organisation, its access assignments and its access records are deleted.' },
            { tone: 'ends', text: 'Users lose access through it; anyone left with none has their sessions ended.' },
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
          title: 'Revoke this organisation access?',
          description: `${who} will lose access through ${organisationName(membership.organisation_id)}.`,
          consequences: [
            { tone: 'ends', text: 'Access to this organisation ends immediately.' },
            ...(confirm.isLast
              ? [{
                tone: 'warning' as const,
                text: 'This is their last active organisation access — they will lose the Builder Portal entirely and their sessions will be ended.',
              }]
              : [{ tone: 'remains' as const, text: 'Their access to other organisations is unaffected.' }]),
            { tone: 'remains', text: 'The access record is kept, marked revoked, as audit evidence.' },
            { tone: 'remains', text: 'Fresh organisation access can be granted later.' },
          ],
          confirmLabel: 'Revoke organisation access', destructive: true,
          reasonRequired: true, reasonLabel: 'Reason for revoking',
          reasonPlaceholder: 'Changed role, left the organisation…',
          run: (reason) => void runConfirmed('revoke_membership', {
            membership_id: membership.id, reason,
          }, 'Organisation access revoked'),
        };
      }

      case 'membership_remove': {
        const membership = confirm.membership;
        return {
          title: 'Permanently remove this access assignment?',
          description: `The link between ${userName(membership.builder_user_id)} and ${organisationName(membership.organisation_id)} will be deleted.`,
          consequences: [
            { tone: 'ends', text: 'The access assignment and its permission overrides are deleted.' },
            { tone: 'ends', text: 'Access through this organisation ends. If it is their last, their sessions end too.' },
            { tone: 'remains', text: 'The user is kept. The organisation is kept.' },
            { tone: 'remains', text: 'Projects, documents and the audit trail are kept — the removal is recorded with a full snapshot.' },
          ],
          confirmLabel: 'Remove access assignment', destructive: true,
          reasonRequired: true, reasonLabel: 'Reason for permanent removal',
          reasonPlaceholder: 'Granted in error…',
          run: (reason) => void runConfirmed('delete_membership', {
            membership_id: membership.id, expected_version: membership.row_version, reason,
          }, 'Access assignment removed'),
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
            Administer builder and developer organisations, portal users, organisation access and
            the project, inventory and delivery surfaces they work in.
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
          label="Active organisation access"
          hint="assignments granting a workspace"
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
                active organisation access and therefore cannot enter the portal.
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
          {/* The tab value stays `memberships`: it is the stored vocabulary the
              page, the operations and the server all share. Only the label a
              reader sees is organisation-access wording. */}
          <TabsTrigger value="memberships" className="relative shrink-0 gap-2">
            <KeyRound className="h-4 w-4 shrink-0" aria-hidden />
            Organisation Access
            {/* Counts the rows the tab actually shows, revoked included. */}
            <span className="text-xs font-normal opacity-60 tabular-nums" aria-hidden>
              {memberships.length}
            </span>
            <span className="sr-only">, {memberships.length} access assignments</span>
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
          {/* No badge: the panel loads its own rows, and a count this page has
              not fetched would be a guess. */}
          <TabsTrigger value="agreements" className="shrink-0 gap-2">
            <FileSignature className="h-4 w-4 shrink-0" aria-hidden />
            Agreements
          </TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------ agreements */}
        <TabsContent value="agreements" className="mt-4">
          <PartnerAgreementsPanel portal="builder" partnerNoun="builder or developer" />
        </TabsContent>

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
                size="sm"
                disabled={!canEdit || busy}
                onClick={() => { setOrgEditing(null); setOrgDialogOpen(true); }}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
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
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!canEdit || busy}
                                onClick={() => { setOrgEditing(organisation); setOrgDialogOpen(true); }}
                              >
                                <Pencil className="mr-2 h-4 w-4" aria-hidden />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!canEdit || busy}
                                onClick={() => { setOrgStatusTarget(organisation); setOrgStatusOpen(true); }}
                              >
                                Change status
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
                size="sm"
                disabled={!canEdit || busy}
                onClick={() => { setUserEditing(null); setUserDialogOpen(true); }}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
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
                    description="Add the first builder or developer contact. They are created without access — grant organisation access, then invite them."
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
                                  Grant organisation access before inviting
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
                                      Grant organisation access
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

                              {canResend && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!canEdit || busy}
                                  onClick={() => void revokeInvite(user)}
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
                                >
                                  Restore
                                </Button>
                              )}

                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!canEdit || busy}
                                onClick={() => { setUserEditing(user); setUserDialogOpen(true); }}
                              >
                                <Pencil className="mr-2 h-4 w-4" aria-hidden />
                                Edit
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => { setSessionsUser(user); setSessionsOpen(true); }}
                              >
                                Sessions
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

        {/* ---------------------------------------------- organisation access */}
        <TabsContent value="memberships" className="mt-4">
          <Card>
            <CardHeader className="flex flex-col items-start justify-between gap-3 space-y-0 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <CardTitle className="text-base">Organisation Access Assignments</CardTitle>
                <CardDescription>
                  Assign portal users to builder or developer organisations, define their access
                  role and control which organisation is primary. Organisation access determines
                  which company workspace a portal user can enter. Revoking a user's last
                  assignment immediately ends their sessions; revoked assignments stay listed as
                  audit evidence and can be re-granted.
                </CardDescription>
              </div>
              <Button
                size="sm"
                disabled={!canEdit || busy}
                onClick={() => { setMembershipEditing(null); setMembershipDialogOpen(true); }}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Grant membership
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {memberships.length === 0 ? (
                <BuilderEmptyState
                  icon={KeyRound}
                  title="No active organisation access yet"
                  description="Nobody can enter a workspace. Grant organisation access to bind a portal user to an organisation."
                  action={canEdit ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setMembershipDialog({ open: true, membership: null })}
                      className="gap-2"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      Grant organisation access
                    </Button>
                  ) : undefined}
                />
              ) : (
                <Table className="!min-w-[860px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">User</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Organisation</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Access role</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Status</TableHead>
                      <TableHead className="text-right text-xs font-semibold uppercase tracking-wide">Actions</TableHead>
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
                    {liveMemberships.map((membership) => {
                      // Revoking a user's only membership removes their access
                      // entirely and ends their sessions, so say so first.
                      const isLastForUser = liveMemberships.filter(
                        (entry) => entry.builder_user_id === membership.builder_user_id).length === 1;
                      return (
                        <TableRow key={membership.id}>
                          <TableCell className="font-medium">{userName(membership.builder_user_id)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {organisationName(membership.organisation_id)}
                            {membership.is_primary && (
                              <Badge variant="secondary" className="ml-2">Primary</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {MEMBERSHIP_ROLES.find((r) => r.value === membership.membership_role)?.label
                              ?? membership.membership_role}
                          </TableCell>
                          <TableCell><Badge variant="default">Active</Badge></TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!canEdit || busy}
                                onClick={() => { setMembershipEditing(membership); setMembershipDialogOpen(true); }}
                              >
                                <Pencil className="mr-2 h-4 w-4" aria-hidden />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => { setPermissionsMembership(membership); setPermissionsOpen(true); }}
                              >
                                <KeyRound className="mr-2 h-4 w-4" aria-hidden />
                                Permissions
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!canEdit || busy}
                                onClick={() => {
                                  const who = userName(membership.builder_user_id);
                                  const warning = isLastForUser
                                    ? `${who} has no other organisation. Revoking this membership removes their portal access entirely and ends their sessions. Continue?`
                                    : `Revoke ${who}'s membership of ${organisationName(membership.organisation_id)}?`;
                                  if (!window.confirm(warning)) return;
                                  void mutate('revoke_membership', {
                                    membership_id: membership.id, reason: 'revoked by administrator',
                                  }, 'Membership revoked');
                                }}
                              >
                                Revoke
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
      <BuilderOrganisationDialog
        open={orgDialogOpen}
        onOpenChange={setOrgDialogOpen}
        organisation={orgEditing}
        busy={busy}
        onSubmit={(payload, isEdit) => mutate('upsert_organisation', payload,
          isEdit ? 'Organisation updated' : 'Organisation created')}
      />

      <BuilderOrganisationStatusDialog
        open={orgStatusOpen}
        onOpenChange={setOrgStatusOpen}
        organisation={orgStatusTarget}
        memberCount={orgStatusTarget
          ? liveMemberships.filter((m) => m.organisation_id === orgStatusTarget.id).length
          : 0}
        busy={busy}
        onSubmit={(payload) => mutate('set_organisation_status', payload, 'Organisation status changed')}
      />

      <BuilderUserDialog
        open={userDialogOpen}
        onOpenChange={setUserDialogOpen}
        user={userEditing}
        busy={busy}
        onSubmit={(payload, isEdit) => mutate(isEdit ? 'update_user' : 'create_user', payload,
          isEdit ? 'Portal user updated' : 'Portal user created')}
      />

      <BuilderUserSessionsDialog
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
        user={sessionsUser}
        busy={busy}
        loadSessions={loadSessions}
        onRevokeAll={(user) => mutate('revoke_user_sessions', {
          builder_user_id: user.id, reason: 'revoked by administrator',
        }, 'Sessions revoked')}
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

      <BuilderMembershipDialog
        open={membershipDialogOpen}
        onOpenChange={setMembershipDialogOpen}
        membership={membershipEditing}
        users={users}
        organisations={organisations}
        liveMemberships={liveMemberships}
        busy={busy}
        onSubmit={(payload, isEdit) => mutate('upsert_membership', payload,
          isEdit ? 'Membership updated' : 'Membership granted')}
      />

      <BuilderMembershipPermissionsDialog
        open={permissionsOpen}
        onOpenChange={setPermissionsOpen}
        membership={permissionsMembership}
        userName={permissionsMembership ? userName(permissionsMembership.builder_user_id) : ''}
        organisationName={permissionsMembership ? organisationName(permissionsMembership.organisation_id) : ''}
        canEdit={canEdit}
        busy={busy}
        loadCatalogue={loadCatalogue}
        loadOverrides={loadOverrides}
        onSave={savePermissions}
      />
    </div>
  );
}
