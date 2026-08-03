import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CircleAlert } from 'lucide-react';

/**
 * Grant organisation access, or edit the role and primary flag of an existing
 * assignment. The record is a `membership` everywhere below the surface — the
 * props, the values and the submitted payload all keep that name; only the
 * words on screen call it organisation access.
 *
 * When editing, the user and the organisation are fixed and shown as read-only
 * context: moving an assignment between organisations is not an edit, it is a
 * revoke and a fresh grant, and each of those is separately audited.
 *
 * Closed organisations are not offered. The server refuses them too — this only
 * saves the administrator a round trip.
 */
export interface BuilderMembershipFormValues {
  builder_user_id: string;
  organisation_id: string;
  membership_role: string;
  is_primary: boolean;
}

export interface BuilderMembershipFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null means "grant new". */
  initial: (BuilderMembershipFormValues & { id: string }) | null;
  users: ReadonlyArray<{ id: string; name: string; email: string; status: string }>;
  organisations: ReadonlyArray<{ id: string; legal_name: string; status: string }>;
  roles: ReadonlyArray<{ value: string; label: string }>;
  /** Names shown as fixed context when editing. */
  userLabel?: string;
  organisationLabel?: string;
  busy?: boolean;
  onSubmit: (values: BuilderMembershipFormValues) => void;
}

const EMPTY: BuilderMembershipFormValues = {
  builder_user_id: '', organisation_id: '', membership_role: 'member', is_primary: false,
};

export function BuilderMembershipFormDialog({
  open, onOpenChange, initial, users, organisations, roles,
  userLabel, organisationLabel, busy = false, onSubmit,
}: BuilderMembershipFormDialogProps) {
  const [form, setForm] = useState<BuilderMembershipFormValues>(EMPTY);
  const editing = !!initial;

  useEffect(() => { if (open) setForm(initial ?? EMPTY); }, [open, initial]);

  // A revoked user cannot hold organisation access; the server rejects it with 409.
  const grantableUsers = users.filter((user) => user.status !== 'revoked');
  const openOrganisations = organisations.filter((org) => org.status !== 'closed');

  const valid = !!form.builder_user_id && !!form.organisation_id && !!form.membership_role;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Edit organisation access' : 'Grant organisation access'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Change this assignment’s access role, or make it the user’s primary organisation.'
              : 'Organisation access determines which company workspace a portal user can enter.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {editing ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-muted-foreground">User</span>
                <span className="font-medium">{userLabel}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-muted-foreground">Organisation</span>
                <span className="font-medium">{organisationLabel}</span>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="builder-membership-user">User</Label>
                <Select
                  value={form.builder_user_id}
                  onValueChange={(value) => setForm((c) => ({ ...c, builder_user_id: value }))}
                >
                  <SelectTrigger id="builder-membership-user">
                    <SelectValue placeholder="Select a user" />
                  </SelectTrigger>
                  <SelectContent>
                    {grantableUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>{user.name} — {user.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="builder-membership-org">Organisation</Label>
                <Select
                  value={form.organisation_id}
                  onValueChange={(value) => setForm((c) => ({ ...c, organisation_id: value }))}
                >
                  <SelectTrigger id="builder-membership-org">
                    <SelectValue placeholder="Select an organisation" />
                  </SelectTrigger>
                  <SelectContent>
                    {openOrganisations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>{org.legal_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Closed organisations cannot take new access assignments.
                </p>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="builder-membership-role">Access role</Label>
            <Select
              value={form.membership_role}
              onValueChange={(value) => setForm((c) => ({ ...c, membership_role: value }))}
            >
              <SelectTrigger id="builder-membership-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The role sets the baseline permissions. Overrides are edited separately.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="builder-membership-primary">Primary organisation</Label>
              <p className="text-xs text-muted-foreground">
                The organisation this user lands in when they sign in. Marking this one primary
                clears the flag on their other organisations.
              </p>
            </div>
            <Switch
              id="builder-membership-primary"
              checked={form.is_primary}
              onCheckedChange={(checked) => setForm((c) => ({ ...c, is_primary: checked }))}
            />
          </div>

          {!editing && (
            <Alert className="border-border bg-muted/40">
              <CircleAlert className="h-4 w-4" aria-hidden />
              <AlertDescription>
                Granting organisation access does not sign the user in. They still need to
                accept an invitation and set a password before the account becomes active.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !valid} onClick={() => onSubmit(form)}>
            {editing ? 'Save changes' : 'Grant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
