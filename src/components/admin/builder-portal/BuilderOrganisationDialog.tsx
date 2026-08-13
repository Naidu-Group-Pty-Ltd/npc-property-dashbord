import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AU_STATES, ORG_TYPES, type BuilderOrganisation } from './accessTypes';

/**
 * Create or edit a Builder organisation.
 *
 * One dialog for both, because `upsert_organisation` is one operation. The
 * distinction is `organisation_id` plus `expected_version`: absent, the server
 * inserts and forces `pending_activation`; present, it updates and rejects a
 * stale write with 409.
 *
 * Status is deliberately NOT a field here. It is a separate audited transition
 * with its own guarded command, so it lives in its own control.
 */

const EMPTY = {
  legal_name: '', trading_name: '', org_type: 'builder',
  abn: '', acn: '', contact_email: '', contact_phone: '', website: '',
  address_line1: '', address_line2: '', suburb: '', state: '', postcode: '', notes: '',
};

type OrgForm = typeof EMPTY;

const toForm = (organisation: BuilderOrganisation): OrgForm => ({
  legal_name: organisation.legal_name ?? '',
  trading_name: organisation.trading_name ?? '',
  org_type: organisation.org_type ?? 'builder',
  abn: organisation.abn ?? '',
  acn: organisation.acn ?? '',
  contact_email: organisation.contact_email ?? '',
  contact_phone: organisation.contact_phone ?? '',
  website: organisation.website ?? '',
  address_line1: organisation.address_line1 ?? '',
  address_line2: organisation.address_line2 ?? '',
  suburb: organisation.suburb ?? '',
  state: organisation.state ?? '',
  postcode: organisation.postcode ?? '',
  notes: organisation.notes ?? '',
});

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null creates; a row edits it. */
  organisation: BuilderOrganisation | null;
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>, isEdit: boolean) => Promise<boolean>;
}

export function BuilderOrganisationDialog({ open, onOpenChange, organisation, busy, onSubmit }: Props) {
  const [form, setForm] = useState<OrgForm>(EMPTY);
  const isEdit = !!organisation;

  // Re-seed whenever the dialog opens so an edit never shows the previous
  // organisation's values for an instant.
  useEffect(() => {
    if (open) setForm(organisation ? toForm(organisation) : EMPTY);
  }, [open, organisation]);

  const set = (key: keyof OrgForm) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const field = (key: keyof OrgForm) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key)(event.target.value),
  });

  // Mirrors the server's validation so the administrator is told before the
  // round trip. The server re-checks all of it regardless.
  const abnDigits = form.abn.replace(/[^0-9]/g, '');
  const acnDigits = form.acn.replace(/[^0-9]/g, '');
  const abnInvalid = abnDigits.length > 0 && abnDigits.length !== 11;
  const acnInvalid = acnDigits.length > 0 && acnDigits.length !== 9;
  const canSubmit = !!form.legal_name.trim() && !abnInvalid && !acnInvalid && !busy;

  const submit = async () => {
    const payload: Record<string, unknown> = { ...form };
    if (organisation) {
      payload.organisation_id = organisation.id;
      payload.expected_version = organisation.row_version;
    }
    const ok = await onSubmit(payload, isEdit);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit organisation' : 'Add organisation'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Changing details does not change the organisation status or anyone’s access.'
              : 'New organisations start pending activation. Activate them once details are confirmed.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="org-legal-name">Legal name</Label>
            <Input id="org-legal-name" {...field('legal_name')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-trading-name">Trading name</Label>
            <Input id="org-trading-name" {...field('trading_name')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-type">Organisation type</Label>
            <Select value={form.org_type} onValueChange={set('org_type')}>
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
            <Input id="org-abn" inputMode="numeric" aria-invalid={abnInvalid} {...field('abn')} />
            {abnInvalid && <p className="text-xs text-destructive">ABN must be 11 digits.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-acn">ACN</Label>
            <Input id="org-acn" inputMode="numeric" aria-invalid={acnInvalid} {...field('acn')} />
            {acnInvalid && <p className="text-xs text-destructive">ACN must be 9 digits.</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-email">Contact email</Label>
            <Input id="org-email" type="email" {...field('contact_email')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-phone">Contact phone</Label>
            <Input id="org-phone" {...field('contact_phone')} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="org-website">Website</Label>
            <Input id="org-website" {...field('website')} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="org-address1">Address line 1</Label>
            <Input id="org-address1" {...field('address_line1')} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="org-address2">Address line 2</Label>
            <Input id="org-address2" {...field('address_line2')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-suburb">Suburb</Label>
            <Input id="org-suburb" {...field('suburb')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-state">State</Label>
            <Select value={form.state || 'none'} onValueChange={(value) => set('state')(value === 'none' ? '' : value)}>
              <SelectTrigger id="org-state"><SelectValue placeholder="Not set" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {AU_STATES.map((state) => (
                  <SelectItem key={state} value={state}>{state}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-postcode">Postcode</Label>
            <Input id="org-postcode" inputMode="numeric" {...field('postcode')} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="org-notes">Internal notes</Label>
            <Textarea id="org-notes" rows={3} {...field('notes')} />
            <p className="text-xs text-muted-foreground">
              Visible to Command Centre staff only. Never shown in the Builder Portal.
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
