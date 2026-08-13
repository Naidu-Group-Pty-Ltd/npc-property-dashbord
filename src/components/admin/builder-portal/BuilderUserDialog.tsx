import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BuilderUser } from './accessTypes';

/**
 * Create or edit a Builder portal user.
 *
 * Two operations behind one form. `create_user` takes the email and always
 * starts the account `invited`, inactive and passwordless; `update_user` takes
 * `expected_version` and edits only the descriptive fields.
 *
 * Email is immutable after creation: it is the login identifier and the address
 * the invitation was sent to, and `update_user` does not accept it. Status,
 * password and invitation state are not fields here either — each has its own
 * audited path.
 */

const EMPTY = { email: '', name: '', phone: '', job_title: '' };
type UserForm = typeof EMPTY;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null creates; a row edits it. */
  user: BuilderUser | null;
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>, isEdit: boolean) => Promise<boolean>;
}

export function BuilderUserDialog({ open, onOpenChange, user, busy, onSubmit }: Props) {
  const [form, setForm] = useState<UserForm>(EMPTY);
  const isEdit = !!user;

  useEffect(() => {
    if (!open) return;
    setForm(user
      ? {
        email: user.email ?? '',
        name: user.name ?? '',
        phone: user.phone ?? '',
        job_title: user.job_title ?? '',
      }
      : EMPTY);
  }, [open, user]);

  const field = (key: keyof UserForm) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value })),
  });

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim());
  const canSubmit = !busy && !!form.name.trim() && (isEdit || emailValid);

  const submit = async () => {
    const payload: Record<string, unknown> = isEdit
      ? {
        builder_user_id: user!.id,
        expected_version: user!.row_version,
        name: form.name,
        phone: form.phone,
        job_title: form.job_title,
      }
      : { ...form };
    const ok = await onSubmit(payload, isEdit);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit portal user' : 'Add portal user'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Editing details does not change the user’s access, status or invitation.'
              : 'The user is created without access. Grant a membership, then send the invitation.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="user-name">Name</Label>
            <Input id="user-name" {...field('name')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              disabled={isEdit}
              aria-invalid={!isEdit && form.email.length > 0 && !emailValid}
              {...field('email')}
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                The email is the login identifier and cannot be changed here.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-phone">Phone</Label>
            <Input id="user-phone" {...field('phone')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-job-title">Job title</Label>
            <Input
              id="user-job-title"
              placeholder="Project manager, site supervisor, sales consultant…"
              {...field('job_title')}
            />
            <p className="text-xs text-muted-foreground">
              Descriptive only. Access comes from the membership role, not the job title.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
