import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Add or edit a Builder portal user.
 *
 * The form carries only the profile fields the admin function accepts. There is
 * deliberately no control for a password, an invitation token, a status or any
 * lifecycle timestamp: an account becomes usable by being invited and accepted,
 * never by being edited here, and the Edge Function's update payload is a
 * closed allow-list that would ignore them anyway.
 */
export interface BuilderUserFormValues {
  name: string;
  email: string;
  job_title: string;
  phone: string;
}

export interface BuilderUserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null means "create". */
  initial: (BuilderUserFormValues & { id: string }) | null;
  busy?: boolean;
  onSubmit: (values: BuilderUserFormValues) => void;
}

const EMPTY: BuilderUserFormValues = { name: '', email: '', job_title: '', phone: '' };

export function BuilderUserFormDialog({
  open, onOpenChange, initial, busy = false, onSubmit,
}: BuilderUserFormDialogProps) {
  const [form, setForm] = useState<BuilderUserFormValues>(EMPTY);
  const editing = !!initial;

  useEffect(() => {
    if (!open) return;
    setForm(initial
      ? {
        name: initial.name ?? '', email: initial.email ?? '',
        job_title: initial.job_title ?? '', phone: initial.phone ?? '',
      }
      : EMPTY);
  }, [open, initial]);

  const set = (key: keyof BuilderUserFormValues) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const valid = form.name.trim().length > 0 && form.email.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit user' : 'Add portal user'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update this user’s profile details. Access is governed by their organisation access and invitation, not by anything on this form.'
              : 'The user is created without access and cannot sign in yet. Grant organisation access, then send the invitation.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="builder-user-name">Name</Label>
            <Input id="builder-user-name" value={form.name} onChange={set('name')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="builder-user-email">Email</Label>
            <Input id="builder-user-email" type="email" value={form.email} onChange={set('email')} />
            <p className="text-xs text-muted-foreground">
              {editing
                ? 'This is the sign-in identifier. Changing it changes the address future invitations are sent to.'
                : 'Their sign-in identifier and the address the invitation is sent to.'}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="builder-user-job-title">Job title</Label>
            <Input
              id="builder-user-job-title" value={form.job_title} onChange={set('job_title')}
              placeholder="Project manager, site supervisor, sales consultant…"
            />
            <p className="text-xs text-muted-foreground">
              Descriptive only. Access comes from the access role, not the job title.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="builder-user-phone">Phone</Label>
            <Input id="builder-user-phone" value={form.phone} onChange={set('phone')} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !valid} onClick={() => onSubmit(form)}>
            {editing ? 'Save changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
