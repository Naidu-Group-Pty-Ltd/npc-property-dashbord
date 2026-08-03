import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Add or edit a builder / developer organisation.
 *
 * Covers every field `upsert_organisation` accepts and nothing else. Status is
 * absent on purpose: activation, suspension and closure are separate audited
 * transitions with their own reasons, not a dropdown on a details form.
 */
export interface BuilderOrganisationFormValues {
  legal_name: string;
  trading_name: string;
  org_type: string;
  abn: string;
  acn: string;
  contact_email: string;
  contact_phone: string;
  website: string;
  address_line1: string;
  address_line2: string;
  suburb: string;
  state: string;
  postcode: string;
  notes: string;
}

export interface BuilderOrganisationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: (Partial<BuilderOrganisationFormValues> & { id: string }) | null;
  orgTypes: ReadonlyArray<{ value: string; label: string }>;
  auStates: ReadonlyArray<string>;
  busy?: boolean;
  onSubmit: (values: BuilderOrganisationFormValues) => void;
}

const EMPTY: BuilderOrganisationFormValues = {
  legal_name: '', trading_name: '', org_type: 'builder', abn: '', acn: '',
  contact_email: '', contact_phone: '', website: '',
  address_line1: '', address_line2: '', suburb: '', state: '', postcode: '', notes: '',
};

/** Select has no empty-string item, so "not set" needs a sentinel value. */
const NO_STATE = '__none__';

export function BuilderOrganisationFormDialog({
  open, onOpenChange, initial, orgTypes, auStates, busy = false, onSubmit,
}: BuilderOrganisationFormDialogProps) {
  const [form, setForm] = useState<BuilderOrganisationFormValues>(EMPTY);
  const editing = !!initial;

  useEffect(() => {
    if (!open) return;
    if (!initial) { setForm(EMPTY); return; }
    setForm({
      ...EMPTY,
      ...Object.fromEntries(
        (Object.keys(EMPTY) as Array<keyof BuilderOrganisationFormValues>)
          .map((key) => [key, initial[key] ?? EMPTY[key]]),
      ) as Partial<BuilderOrganisationFormValues>,
    });
  }, [open, initial]);

  const set = (key: keyof BuilderOrganisationFormValues) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit organisation' : 'Add organisation'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the organisation’s details. Its status is changed separately, with a reason recorded against it.'
              : 'New organisations start pending activation. Activate them once the details are confirmed.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="builder-org-legal-name">Legal name</Label>
            <Input id="builder-org-legal-name" value={form.legal_name} onChange={set('legal_name')} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="builder-org-trading-name">Trading name</Label>
              <Input id="builder-org-trading-name" value={form.trading_name} onChange={set('trading_name')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="builder-org-type">Organisation type</Label>
              <Select
                value={form.org_type}
                onValueChange={(value) => setForm((current) => ({ ...current, org_type: value }))}
              >
                <SelectTrigger id="builder-org-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {orgTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="builder-org-abn">ABN</Label>
              <Input id="builder-org-abn" value={form.abn} inputMode="numeric" onChange={set('abn')} />
              <p className="text-xs text-muted-foreground">11 digits.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="builder-org-acn">ACN</Label>
              <Input id="builder-org-acn" value={form.acn} inputMode="numeric" onChange={set('acn')} />
              <p className="text-xs text-muted-foreground">9 digits.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="builder-org-email">Contact email</Label>
              <Input id="builder-org-email" type="email" value={form.contact_email} onChange={set('contact_email')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="builder-org-phone">Contact phone</Label>
              <Input id="builder-org-phone" value={form.contact_phone} onChange={set('contact_phone')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="builder-org-website">Website</Label>
            <Input id="builder-org-website" value={form.website} onChange={set('website')} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="builder-org-address1">Address line 1</Label>
              <Input id="builder-org-address1" value={form.address_line1} onChange={set('address_line1')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="builder-org-address2">Address line 2</Label>
              <Input id="builder-org-address2" value={form.address_line2} onChange={set('address_line2')} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="builder-org-suburb">Suburb</Label>
              <Input id="builder-org-suburb" value={form.suburb} onChange={set('suburb')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="builder-org-state">State</Label>
              <Select
                value={form.state || NO_STATE}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, state: value === NO_STATE ? '' : value }))}
              >
                <SelectTrigger id="builder-org-state"><SelectValue placeholder="Not set" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_STATE}>Not set</SelectItem>
                  {auStates.map((state) => (
                    <SelectItem key={state} value={state}>{state}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="builder-org-postcode">Postcode</Label>
              <Input id="builder-org-postcode" value={form.postcode} inputMode="numeric" onChange={set('postcode')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="builder-org-notes">Notes</Label>
            <Textarea id="builder-org-notes" value={form.notes} onChange={set('notes')} rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !form.legal_name.trim()} onClick={() => onSubmit(form)}>
            {editing ? 'Save changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
