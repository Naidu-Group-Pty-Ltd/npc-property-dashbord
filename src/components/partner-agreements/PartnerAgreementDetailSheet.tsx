import { format } from 'date-fns';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Loader2, Pencil, Send, CheckCircle2, Ban, XCircle, GitBranch, History } from 'lucide-react';
import {
  DIRECTION_LABELS,
  STATUS_LABELS,
  usePartnerAgreement,
  usePartnerAgreementMutations,
  type PartnerAgreement,
  type PartnerAgreementStatus,
} from '@/hooks/usePartnerAgreements';

export function statusVariant(status: PartnerAgreementStatus): string {
  switch (status) {
    case 'active': return 'bg-success/15 text-success border-success/30';
    case 'sent_for_signature':
    case 'partially_signed': return 'bg-primary/15 text-primary border-primary/30';
    case 'pending_review': return 'bg-warning/15 text-warning border-warning/30';
    case 'terminated':
    case 'void': return 'bg-destructive/15 text-destructive border-destructive/30';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

interface Props {
  agreementId: string | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (agreement: PartnerAgreement) => void;
}

export function PartnerAgreementDetailSheet({ agreementId, onOpenChange, onEdit }: Props) {
  const { data, isLoading } = usePartnerAgreement(agreementId);
  const { transitionAgreement, createVersion } = usePartnerAgreementMutations();

  const agreement = data?.agreement;
  const isOutbound = agreement?.direction === 'outbound_finance_referral';

  const move = (status: PartnerAgreementStatus, reason?: string) => {
    if (!agreement) return;
    transitionAgreement.mutate({ id: agreement.id, status, reason });
  };

  return (
    <Sheet open={!!agreementId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        {isLoading || !agreement ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="px-6 pt-6 pb-4 border-b border-border space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <SheetTitle className="text-lg">{agreement.partner_legal_name}</SheetTitle>
                  <SheetDescription>
                    {DIRECTION_LABELS[agreement.direction]} · v{agreement.version} · doc {agreement.document_version}
                  </SheetDescription>
                </div>
                <Badge variant="outline" className={statusVariant(agreement.status)}>
                  {STATUS_LABELS[agreement.status]}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-2">
                {['draft', 'pending_review'].includes(agreement.status) && (
                  <Button size="sm" variant="outline" onClick={() => onEdit(agreement)}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                )}
                {agreement.status === 'draft' && (
                  <Button size="sm" variant="outline" onClick={() => move('pending_review')}>
                    Send to review
                  </Button>
                )}
                {['draft', 'pending_review'].includes(agreement.status) && (
                  <Button size="sm" onClick={() => move('sent_for_signature')}>
                    <Send className="h-3.5 w-3.5 mr-1.5" /> Mark sent for signature
                  </Button>
                )}
                {['sent_for_signature', 'partially_signed'].includes(agreement.status) && (
                  <Button size="sm" onClick={() => move('active')}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Activate
                  </Button>
                )}
                {agreement.status === 'active' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => createVersion.mutate(agreement.id)}>
                      <GitBranch className="h-3.5 w-3.5 mr-1.5" /> New version
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => move('terminated', 'Terminated from Command Centre')}>
                      <XCircle className="h-3.5 w-3.5 mr-1.5" /> Terminate
                    </Button>
                  </>
                )}
                {['draft', 'pending_review', 'sent_for_signature', 'partially_signed'].includes(agreement.status) && (
                  <Button size="sm" variant="ghost" onClick={() => move('void', 'Voided from Command Centre')}>
                    <Ban className="h-3.5 w-3.5 mr-1.5" /> Void
                  </Button>
                )}
              </div>
            </SheetHeader>

            <ScrollArea className="flex-1 min-h-0 px-6 py-5">
              <Section title="Parties">
                <Row label="Partner legal entity" value={agreement.partner_legal_name} />
                <Row label="Trading name" value={agreement.partner_trading_name} />
                <Row label="ABN / ACN" value={[agreement.partner_abn, agreement.partner_acn].filter(Boolean).join(' / ')} />
                <Row label="ACL / credit rep" value={[agreement.partner_acl_number, agreement.partner_credit_rep_number].filter(Boolean).join(' / ')} />
                <Row label="Aggregator" value={agreement.partner_aggregator} />
                <Row label="Contact" value={[agreement.partner_contact_name, agreement.partner_contact_email, agreement.partner_contact_phone].filter(Boolean).join(' · ')} />
                <Row label="Notice email" value={agreement.partner_notice_email} />
                <Row label="Address" value={agreement.partner_address} />
                <Separator className="my-3" />
                <Row label="Principal" value={agreement.principal_legal_name} />
                <Row label="Principal ABN" value={agreement.principal_abn} />
                <Row label="Principal notice email" value={agreement.principal_notice_email} />
              </Section>

              <Section title="Legal terms">
                <Row label="Governing state" value={agreement.governing_state} />
                <Row label="Effective date" value={fmtDate(agreement.effective_date)} />
                <Row label="Termination date" value={fmtDate(agreement.termination_date)} />
                <Row label="Termination notice" value={`${agreement.termination_notice_days} days`} />
                <Row label="Dispute window" value={`${agreement.dispute_window_days} days`} />
                <Row label="Records retention" value={`${agreement.records_retention_years} years`} />
                <Row label="s127 execution" value={agreement.executed_under_s127 ? 'Yes' : 'No'} />
                <Row label="Notes" value={agreement.notes} />
              </Section>

              <Section title="Commercial schedule">
                {isOutbound ? (
                  <>
                    <Row label="Upfront share" value={pct(agreement.upfront_share_pct)} />
                    <Row label="Trail share" value={pct(agreement.trail_share_pct)} />
                    <Row label="Commission basis" value={label(agreement.commission_basis)} />
                    <Row label="Payment cycle" value={agreement.payment_cycle} />
                    <Row label="Cleared funds required" value={agreement.cleared_funds_required ? 'Yes' : 'No'} />
                    <Row label="Refinance / top-up included" value={agreement.includes_refinance_topup ? 'Yes' : 'No'} />
                    <Row label="Clawback treatment" value={agreement.clawback_treatment} />
                    <Row label="Clawback repayment window" value={agreement.clawback_repayment_days ? `${agreement.clawback_repayment_days} days` : null} />
                  </>
                ) : (
                  <>
                    <Row label="Remuneration model" value={label(agreement.fee_model)} />
                    <Row label="Fee amount" value={money(agreement.fee_amount)} />
                    <Row label="Fee percentage" value={pct(agreement.fee_percentage)} />
                    <Row label="Fee cap" value={money(agreement.fee_cap)} />
                    <Row label="Fee minimum" value={money(agreement.fee_minimum)} />
                  </>
                )}
                <Row label="Qualifying event" value={agreement.qualifying_event} />
                <Row label="GST treatment" value={label(agreement.gst_treatment)} />
                <Row label="Payment timeframe" value={agreement.payment_business_days ? `${agreement.payment_business_days} business days` : null} />
                <Row label="Invoice process" value={label(agreement.invoice_process)} />
                <Row label="Exclusions" value={agreement.exclusions} />
                <Row label="Duplicate referral rule" value={agreement.duplicate_referral_rule} />
                <Row label="Post-termination entitlement" value={agreement.post_termination_entitlement} />
              </Section>

              {(data?.versions?.length ?? 0) > 1 && (
                <Section title="Version history">
                  {data!.versions.map((v) => (
                    <div key={v.id} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="text-muted-foreground">
                        v{v.version} · {fmtDate(v.created_at)}
                      </span>
                      <Badge variant="outline" className={statusVariant(v.status)}>{STATUS_LABELS[v.status]}</Badge>
                    </div>
                  ))}
                </Section>
              )}

              <Section title="Activity">
                {(data?.events?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {data!.events.map((e) => (
                      <div key={e.id} className="flex gap-3">
                        <History className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div className="space-y-0.5">
                          <p className="text-sm text-foreground">{e.summary || e.event_type}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmtDateTime(e.created_at)}{e.actor_label ? ` · ${e.actor_label}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{title}</h4>
      <div className="rounded-lg border border-border p-4 space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground break-words">{value}</span>
    </div>
  );
}

const fmtDate = (v?: string | null) => (v ? format(new Date(v), 'd MMM yyyy') : null);
const fmtDateTime = (v?: string | null) => (v ? format(new Date(v), 'd MMM yyyy, h:mm a') : '');
const pct = (v?: number | null) => (v === null || v === undefined ? null : `${Number(v)}%`);
const money = (v?: number | null) =>
  v === null || v === undefined ? null : `$${Number(v).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`;
const label = (v?: string | null) => (v ? v.replace(/_/g, ' ') : null);

export default PartnerAgreementDetailSheet;
