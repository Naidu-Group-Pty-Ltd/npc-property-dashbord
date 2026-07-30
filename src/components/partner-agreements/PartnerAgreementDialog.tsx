import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import {
  DIRECTION_LABELS,
  useFinancePartnerOptions,
  usePartnerAgreementMutations,
  type PartnerAgreement,
  type PartnerAgreementDirection,
} from '@/hooks/usePartnerAgreements';

const UNASSIGNED = '__unassigned__';

const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

const INBOUND_QUALIFYING_EVENTS = [
  'Engagement agreement signed',
  'Contract unconditional',
  'Settlement',
  'Other (see notes)',
];
const OUTBOUND_QUALIFYING_EVENTS = [
  'Loan settled and first drawdown',
  'Loan settled',
  'Commission received in cleared funds',
  'Other (see notes)',
];

type FormState = Partial<PartnerAgreement>;

const BLANK: FormState = {
  direction: 'outbound_finance_referral',
  principal_legal_name: 'NPC Services Pty Ltd',
  governing_state: 'NSW',
  termination_notice_days: 30,
  dispute_window_days: 30,
  records_retention_years: 7,
  cleared_funds_required: true,
  includes_refinance_topup: false,
  executed_under_s127: false,
  document_version: '2.0',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agreement?: PartnerAgreement | null;
  defaultDirection?: PartnerAgreementDirection;
}

export function PartnerAgreementDialog({ open, onOpenChange, agreement, defaultDirection }: Props) {
  const isEdit = !!agreement;
  const { createAgreement, updateAgreement } = usePartnerAgreementMutations();
  const { data: partners = [] } = useFinancePartnerOptions();
  const [form, setForm] = useState<FormState>(BLANK);

  useEffect(() => {
    if (!open) return;
    setForm(agreement ? { ...agreement } : { ...BLANK, direction: defaultDirection ?? BLANK.direction });
  }, [open, agreement, defaultDirection]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const isOutbound = form.direction === 'outbound_finance_referral';
  const qualifyingEvents = isOutbound ? OUTBOUND_QUALIFYING_EVENTS : INBOUND_QUALIFYING_EVENTS;
  const saving = createAgreement.isPending || updateAgreement.isPending;

  const partnerOptions = useMemo(
    () =>
      partners.map((p) => ({
        id: p.id,
        label: p.company_name || p.contact_name || 'Unnamed partner',
        raw: p,
      })),
    [partners],
  );

  const applyPartner = (id: string) => {
    if (id === UNASSIGNED) {
      set('finance_agent_contact_id', null);
      return;
    }
    const match = partners.find((p) => p.id === id);
    setForm((prev) => ({
      ...prev,
      finance_agent_contact_id: id,
      partner_legal_name: prev.partner_legal_name || match?.company_name || match?.contact_name || '',
      partner_contact_name: prev.partner_contact_name || match?.contact_name || null,
      partner_contact_email: prev.partner_contact_email || match?.email || null,
      partner_contact_phone: prev.partner_contact_phone || match?.phone || null,
      partner_abn: prev.partner_abn || match?.abn || null,
    }));
  };

  const handleSave = async () => {
    if (!form.partner_legal_name?.trim()) return;
    if (isEdit && agreement) {
      await updateAgreement.mutateAsync({ ...(form as PartnerAgreement), id: agreement.id });
    } else {
      await createAgreement.mutateAsync(form);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>{isEdit ? `Edit agreement · v${agreement?.version}` : 'New partner agreement'}</DialogTitle>
          <DialogDescription>
            Capture the parties, the legal terms and the commercial schedule. The schedule drives downstream
            referral eligibility and commission calculation.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="parties" className="flex-1 min-h-0 flex flex-col">
          <div className="px-6 pt-4">
            <TabsList>
              <TabsTrigger value="parties">Parties</TabsTrigger>
              <TabsTrigger value="terms">Legal terms</TabsTrigger>
              <TabsTrigger value="schedule">Commercial schedule</TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1 min-h-0 px-6 py-4">
            {/* ── PARTIES ─────────────────────────────────────── */}
            <TabsContent value="parties" className="mt-0 space-y-6">
              <div className="space-y-2">
                <Label>Direction</Label>
                <Select
                  value={form.direction}
                  onValueChange={(v) => set('direction', v as PartnerAgreementDirection)}
                  disabled={isEdit}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Direction is fixed once the agreement is created — it determines the schedule shape and the
                  direction money flows.
                </p>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-foreground">Finance partner (counterparty)</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Link to finance partner record</Label>
                    <Select value={form.finance_agent_contact_id ?? UNASSIGNED} onValueChange={applyPartner}>
                      <SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Not linked</SelectItem>
                        {partnerOptions.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Field label="Legal entity name *" value={form.partner_legal_name} onChange={(v) => set('partner_legal_name', v)} />
                  <Field label="Trading name" value={form.partner_trading_name} onChange={(v) => set('partner_trading_name', v)} />
                  <Field label="ABN" value={form.partner_abn} onChange={(v) => set('partner_abn', v)} />
                  <Field label="ACN" value={form.partner_acn} onChange={(v) => set('partner_acn', v)} />
                  <Field label="Australian Credit Licence" value={form.partner_acl_number} onChange={(v) => set('partner_acl_number', v)} />
                  <Field label="Credit representative number" value={form.partner_credit_rep_number} onChange={(v) => set('partner_credit_rep_number', v)} />
                  <Field label="Aggregator / licensee" value={form.partner_aggregator} onChange={(v) => set('partner_aggregator', v)} />
                  <Field label="Contact name" value={form.partner_contact_name} onChange={(v) => set('partner_contact_name', v)} />
                  <Field label="Contact email" value={form.partner_contact_email} onChange={(v) => set('partner_contact_email', v)} />
                  <Field label="Contact phone" value={form.partner_contact_phone} onChange={(v) => set('partner_contact_phone', v)} />
                  <Field label="Notice email" value={form.partner_notice_email} onChange={(v) => set('partner_notice_email', v)} />
                  <div className="sm:col-span-2">
                    <Label>Registered address</Label>
                    <Textarea
                      className="mt-2"
                      rows={2}
                      value={form.partner_address ?? ''}
                      onChange={(e) => set('partner_address', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-foreground">Principal (our entity)</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Legal entity name" value={form.principal_legal_name} onChange={(v) => set('principal_legal_name', v)} />
                  <Field label="Trading name" value={form.principal_trading_name} onChange={(v) => set('principal_trading_name', v)} />
                  <Field label="ABN" value={form.principal_abn} onChange={(v) => set('principal_abn', v)} />
                  <Field label="ACN" value={form.principal_acn} onChange={(v) => set('principal_acn', v)} />
                  <Field label="Licence number" value={form.principal_licence_number} onChange={(v) => set('principal_licence_number', v)} />
                  <Field label="Contact name" value={form.principal_contact_name} onChange={(v) => set('principal_contact_name', v)} />
                  <Field label="Contact email" value={form.principal_contact_email} onChange={(v) => set('principal_contact_email', v)} />
                  <Field label="Notice email" value={form.principal_notice_email} onChange={(v) => set('principal_notice_email', v)} />
                  <div className="sm:col-span-2">
                    <Label>Registered address</Label>
                    <Textarea
                      className="mt-2"
                      rows={2}
                      value={form.principal_address ?? ''}
                      onChange={(e) => set('principal_address', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ── LEGAL TERMS ─────────────────────────────────── */}
            <TabsContent value="terms" className="mt-0 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Governing state</Label>
                  <Select value={form.governing_state ?? 'NSW'} onValueChange={(v) => set('governing_state', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AU_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Document version" value={form.document_version} onChange={(v) => set('document_version', v)} />
                <Field label="Effective date" type="date" value={form.effective_date} onChange={(v) => set('effective_date', v)} />
                <Field label="Termination date" type="date" value={form.termination_date} onChange={(v) => set('termination_date', v)} />
                <Field label="Termination notice (days)" type="number" value={form.termination_notice_days} onChange={(v) => set('termination_notice_days', v as never)} />
                <Field label="Dispute window (days)" type="number" value={form.dispute_window_days} onChange={(v) => set('dispute_window_days', v as never)} />
                <Field label="Records retention (years)" type="number" value={form.records_retention_years} onChange={(v) => set('records_retention_years', v as never)} />
              </div>

              <ToggleRow
                label="Executed under s127 Corporations Act"
                description="Two directors / director + secretary execution block."
                checked={!!form.executed_under_s127}
                onChange={(v) => set('executed_under_s127', v)}
              />

              <div className="space-y-2">
                <Label>Internal notes</Label>
                <Textarea rows={3} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
              </div>
            </TabsContent>

            {/* ── COMMERCIAL SCHEDULE ─────────────────────────── */}
            <TabsContent value="schedule" className="mt-0 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {!isOutbound && (
                  <>
                    <div className="space-y-2">
                      <Label>Remuneration model</Label>
                      <Select
                        value={form.fee_model ?? UNASSIGNED}
                        onValueChange={(v) => set('fee_model', v === UNASSIGNED ? null : (v as PartnerAgreement['fee_model']))}
                      >
                        <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNASSIGNED}>Not set</SelectItem>
                          <SelectItem value="fixed_fee">Fixed fee</SelectItem>
                          <SelectItem value="percentage_of_fee">Percentage of buyer's agency fee</SelectItem>
                          <SelectItem value="tiered">Tiered</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Field label="Fixed fee amount (AUD)" type="number" value={form.fee_amount} onChange={(v) => set('fee_amount', v as never)} />
                    <Field label="Fee percentage (%)" type="number" value={form.fee_percentage} onChange={(v) => set('fee_percentage', v as never)} />
                    <Field label="Fee cap (AUD)" type="number" value={form.fee_cap} onChange={(v) => set('fee_cap', v as never)} />
                    <Field label="Fee minimum (AUD)" type="number" value={form.fee_minimum} onChange={(v) => set('fee_minimum', v as never)} />
                  </>
                )}

                {isOutbound && (
                  <>
                    <Field label="Upfront commission share (%)" type="number" value={form.upfront_share_pct} onChange={(v) => set('upfront_share_pct', v as never)} />
                    <Field label="Trail commission share (%)" type="number" value={form.trail_share_pct} onChange={(v) => set('trail_share_pct', v as never)} />
                    <div className="space-y-2">
                      <Label>Commission basis</Label>
                      <Select
                        value={form.commission_basis ?? UNASSIGNED}
                        onValueChange={(v) => set('commission_basis', v === UNASSIGNED ? null : (v as PartnerAgreement['commission_basis']))}
                      >
                        <SelectTrigger><SelectValue placeholder="Select basis" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNASSIGNED}>Not set</SelectItem>
                          <SelectItem value="gross">Gross commission</SelectItem>
                          <SelectItem value="net_of_aggregator">Net of aggregator deductions</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Field label="Payment cycle" value={form.payment_cycle} onChange={(v) => set('payment_cycle', v)} placeholder="e.g. Monthly, in arrears" />
                    <Field label="Clawback repayment window (days)" type="number" value={form.clawback_repayment_days} onChange={(v) => set('clawback_repayment_days', v as never)} />
                  </>
                )}

                <div className="space-y-2">
                  <Label>Qualifying event</Label>
                  <Select
                    value={form.qualifying_event ?? UNASSIGNED}
                    onValueChange={(v) => set('qualifying_event', v === UNASSIGNED ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Select event" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Not set</SelectItem>
                      {qualifyingEvents.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>GST treatment</Label>
                  <Select
                    value={form.gst_treatment ?? UNASSIGNED}
                    onValueChange={(v) => set('gst_treatment', v === UNASSIGNED ? null : (v as PartnerAgreement['gst_treatment']))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select treatment" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Not set</SelectItem>
                      <SelectItem value="plus_gst">Plus GST</SelectItem>
                      <SelectItem value="inclusive_of_gst">Inclusive of GST</SelectItem>
                      <SelectItem value="not_applicable">Not applicable</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Field label="Payment timeframe (business days)" type="number" value={form.payment_business_days} onChange={(v) => set('payment_business_days', v as never)} />

                <div className="space-y-2">
                  <Label>Invoice process</Label>
                  <Select
                    value={form.invoice_process ?? UNASSIGNED}
                    onValueChange={(v) => set('invoice_process', v === UNASSIGNED ? null : (v as PartnerAgreement['invoice_process']))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select process" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Not set</SelectItem>
                      <SelectItem value="tax_invoice">Tax invoice issued by recipient of fee</SelectItem>
                      <SelectItem value="rcti">Recipient Created Tax Invoice (RCTI)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isOutbound && (
                <>
                  <ToggleRow
                    label="Cleared-funds condition applies"
                    description="No payment is due until the commission has been received in cleared funds."
                    checked={!!form.cleared_funds_required}
                    onChange={(v) => set('cleared_funds_required', v)}
                  />
                  <ToggleRow
                    label="Refinances and top-ups included"
                    description="Whether subsequent refinances or top-ups attract a share."
                    checked={!!form.includes_refinance_topup}
                    onChange={(v) => set('includes_refinance_topup', v)}
                  />
                  <div className="space-y-2">
                    <Label>Clawback treatment</Label>
                    <Textarea rows={2} value={form.clawback_treatment ?? ''} onChange={(e) => set('clawback_treatment', e.target.value)} />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label>Exclusions</Label>
                <Textarea rows={2} value={form.exclusions ?? ''} onChange={(e) => set('exclusions', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Duplicate referral rule</Label>
                <Textarea rows={2} value={form.duplicate_referral_rule ?? ''} onChange={(e) => set('duplicate_referral_rule', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Post-termination entitlement</Label>
                <Textarea rows={2} value={form.post_termination_entitlement ?? ''} onChange={(e) => set('post_termination_entitlement', e.target.value)} />
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.partner_legal_name?.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? 'Save changes' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: unknown;
  onChange: (value: string | null) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type={type}
        placeholder={placeholder}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export default PartnerAgreementDialog;
