import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  MEMBERSHIP_ROLES,
  type BuilderMembership, type BuilderOrganisation, type BuilderUser,
} from './accessTypes';

/**
 * Grant a membership, or change an existing one's role and primary flag.
 *
 * `upsert_membership` is one operation for both. On an existing membership the
 * server requires `expected_version`; grant-only omits it.
 *
 * The primary flag is not cosmetic. Invitation acceptance and login both
 * auto-select the primary organisation, and a user with several memberships and
 * no primary is sent to the organisation picker on every sign-in.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null grants a new membership; a row edits it. */
  membership: BuilderMembership | null;
  users: BuilderUser[];
  organisations: BuilderOrganisation[];
  /** Live memberships, used to explain what changing the primary flag will do. */
  liveMemberships: BuilderMembership[];
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>, isEdit: boolean) => Promise<boolean>;
}

export function BuilderMembershipDialog({
  open, onOpenChange, membership, users, organisations, liveMemberships, busy, onSubmit,
}: Props) {
  const [form, setForm] = useState({
    builder_user_id: '', organisation_id: '', membership_role: 'member', is_primary: false,
  });
  const [reason, setReason] = useState('');
  const isEdit = !!membership;

  useEffect(() => {
    if (!open) return;
    setReason('');
    setForm(membership
      ? {
        builder_user_id: membership.builder_user_id,
        organisation_id: membership.organisation_id,
        membership_role: membership.membership_role,
        is_primary: !!membership.is_primary,
      }
      : { builder_user_id: '', organisation_id: '', membership_role: 'member', is_primary: false });
  }, [open, membership]);

  // A closed organisation cannot take a membership; the server answers 409.
  const selectableOrganisations = organisations.filter(
    (organisation) => organisation.status !== 'closed' || organisation.id === form.organisation_id);
  // A revoked user cannot be granted one either.
  const selectableUsers = users.filter(
    (user) => user.status !== 'revoked' || user.id === form.builder_user_id);

  const othersForUser = liveMemberships.filter(
    (entry) => entry.builder_user_id === form.builder_user_id && entry.id !== membership?.id);
  const existingPrimary = othersForUser.find((entry) => entry.is_primary);
  const organisationName = (id: string) =>
    organisations.find((organisation) => organisation.id === id)?.legal_name ?? 'another organisation';

  const duplicate = !isEdit && othersForUser.some(
    (entry) => entry.organisation_id === form.organisation_id);

  const canSubmit = !busy && !!form.builder_user_id && !!form.organisation_id && !duplicate;

  const submit = async () => {
    const payload: Record<string, unknown> = {
      builder_user_id: form.builder_user_id,
      organisation_id: form.organisation_id,
      membership_role: form.membership_role,
      is_primary: form.is_primary,
      reason: reason.trim() || null,
    };
    if (membership) payload.expected_version = membership.row_version;
    const ok = await onSubmit(payload, isEdit);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit membership' : 'Grant membership'}</DialogTitle>
          <DialogDescription>
            Membership binds a user to one organisation and is the only source of portal access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="membership-user">User</Label>
            <Select
              value={form.builder_user_id}
              disabled={isEdit}
              onValueChange={(value) => setForm({ ...form, builder_user_id: value })}
            >
              <SelectTrigger id="membership-user"><SelectValue placeholder="Select a user" /></SelectTrigger>
              <SelectContent>
                {selectableUsers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>{user.name} — {user.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="membership-org">Organisation</Label>
            <Select
              value={form.organisation_id}
              disabled={isEdit}
              onValueChange={(value) => setForm({ ...form, organisation_id: value })}
            >
              <SelectTrigger id="membership-org"><SelectValue placeholder="Select an organisation" /></SelectTrigger>
              <SelectContent>
                {selectableOrganisations.map((organisation) => (
                  <SelectItem key={organisation.id} value={organisation.id}>
                    {organisation.legal_name}
                    {organisation.status !== 'active' ? ` (${organisation.status.replace(/_/g, ' ')})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                To move a user to a different organisation, revoke this membership and grant a new one.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="membership-role">Role</Label>
            <Select
              value={form.membership_role}
              onValueChange={(value) => setForm({ ...form, membership_role: value })}
            >
              <SelectTrigger id="membership-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MEMBERSHIP_ROLES.map((role) => (
                  <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The role sets the baseline permissions. Per-membership overrides are edited separately.
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
            <Checkbox
              id="membership-primary"
              checked={form.is_primary}
              onCheckedChange={(checked) => setForm({ ...form, is_primary: checked === true })}
            />
            <div className="space-y-1">
              <Label htmlFor="membership-primary" className="cursor-pointer">Primary organisation</Label>
              <p className="text-xs text-muted-foreground">
                Selected automatically when the user accepts their invitation and at every sign-in.
                Without one, a user who belongs to more than one organisation must choose each time.
              </p>
            </div>
          </div>

          {form.is_primary && existingPrimary && (
            <Alert>
              <Info className="h-4 w-4" aria-hidden />
              <AlertDescription>
                {organisationName(existingPrimary.organisation_id)} is currently this user’s primary
                organisation. Saving moves the primary here.
              </AlertDescription>
            </Alert>
          )}

          {duplicate && (
            <Alert variant="destructive">
              <Info className="h-4 w-4" aria-hidden />
              <AlertDescription>
                This user already holds a live membership of that organisation. Edit it instead.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="membership-reason">Reason <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="membership-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Recorded in the audit trail"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {isEdit ? 'Save changes' : 'Grant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
