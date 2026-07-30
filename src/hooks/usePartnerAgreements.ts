import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export type PartnerAgreementDirection = 'inbound_property_referral' | 'outbound_finance_referral';

export type PartnerAgreementStatus =
  | 'draft'
  | 'pending_review'
  | 'sent_for_signature'
  | 'partially_signed'
  | 'active'
  | 'terminated'
  | 'superseded'
  | 'void';

export interface PartnerAgreement {
  id: string;
  direction: PartnerAgreementDirection;
  status: PartnerAgreementStatus;
  version: number;
  document_version: string;
  supersedes_agreement_id: string | null;

  finance_agent_contact_id: string | null;
  partner_legal_name: string;
  partner_trading_name: string | null;
  partner_abn: string | null;
  partner_acn: string | null;
  partner_acl_number: string | null;
  partner_credit_rep_number: string | null;
  partner_aggregator: string | null;
  partner_address: string | null;
  partner_contact_name: string | null;
  partner_contact_email: string | null;
  partner_contact_phone: string | null;
  partner_notice_email: string | null;

  principal_legal_name: string;
  principal_trading_name: string | null;
  principal_abn: string | null;
  principal_acn: string | null;
  principal_licence_number: string | null;
  principal_address: string | null;
  principal_contact_name: string | null;
  principal_contact_email: string | null;
  principal_notice_email: string | null;

  governing_state: string;
  effective_date: string | null;
  termination_date: string | null;
  termination_notice_days: number;
  dispute_window_days: number;
  records_retention_years: number;
  executed_under_s127: boolean;

  fee_model: 'fixed_fee' | 'percentage_of_fee' | 'tiered' | 'other' | null;
  fee_amount: number | null;
  fee_percentage: number | null;
  gst_treatment: 'plus_gst' | 'inclusive_of_gst' | 'not_applicable' | null;
  qualifying_event: string | null;
  payment_business_days: number | null;
  invoice_process: 'tax_invoice' | 'rcti' | null;
  exclusions: string | null;
  duplicate_referral_rule: string | null;
  fee_cap: number | null;
  fee_minimum: number | null;
  post_termination_entitlement: string | null;

  upfront_share_pct: number | null;
  trail_share_pct: number | null;
  commission_basis: 'gross' | 'net_of_aggregator' | null;
  payment_cycle: string | null;
  cleared_funds_required: boolean;
  clawback_treatment: string | null;
  clawback_repayment_days: number | null;
  includes_refinance_topup: boolean;

  schedule_extras: Record<string, unknown>;

  template_id: string | null;
  pdf_storage_path: string | null;
  signed_pdf_storage_path: string | null;
  docusign_envelope_id: string | null;
  docusign_status: string | null;
  docusign_sent_at: string | null;
  docusign_signed_at: string | null;
  sent_via: string;

  activated_at: string | null;
  terminated_at: string | null;
  termination_reason: string | null;
  notes: string | null;

  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerAgreementEvent {
  id: string;
  agreement_id: string;
  event_type: string;
  actor_id: string | null;
  actor_label: string | null;
  summary: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface PartnerAgreementVersionRef {
  id: string;
  version: number;
  status: PartnerAgreementStatus;
  effective_date: string | null;
  created_at: string;
  supersedes_agreement_id: string | null;
}

export interface FinancePartnerOption {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  abn: string | null;
  gst_registered: boolean | null;
  default_commission_rate_pct: number | null;
  default_commission_basis: string | null;
}

const FN = 'manage-partner-agreements';

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>(FN, payload);
  if (error) throw new Error(error.message);
  const err = (data as { error?: string; message?: string } | null)?.error;
  if (err) throw new Error((data as { message?: string })?.message || err);
  return data as T;
}

export function usePartnerAgreements(filters?: {
  direction?: PartnerAgreementDirection;
  status?: PartnerAgreementStatus;
}) {
  return useQuery({
    queryKey: ['partner-agreements', filters?.direction ?? 'all', filters?.status ?? 'all'],
    queryFn: async () => {
      const data = await call<{ agreements: PartnerAgreement[] }>({
        action: 'list',
        ...(filters?.direction ? { direction: filters.direction } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      });
      return data.agreements ?? [];
    },
  });
}

export function usePartnerAgreement(id: string | null) {
  return useQuery({
    queryKey: ['partner-agreement', id],
    enabled: !!id,
    queryFn: async () =>
      call<{
        agreement: PartnerAgreement;
        events: PartnerAgreementEvent[];
        versions: PartnerAgreementVersionRef[];
      }>({ action: 'get', id }),
  });
}

export function useFinancePartnerOptions() {
  return useQuery({
    queryKey: ['partner-agreement-partners'],
    queryFn: async () => {
      const data = await call<{ partners: FinancePartnerOption[] }>({ action: 'list_partners' });
      return data.partners ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function usePartnerAgreementMutations() {
  const queryClient = useQueryClient();

  const invalidate = (id?: string) => {
    queryClient.invalidateQueries({ queryKey: ['partner-agreements'] });
    if (id) queryClient.invalidateQueries({ queryKey: ['partner-agreement', id] });
  };

  const createAgreement = useMutation({
    mutationFn: (payload: Partial<PartnerAgreement>) =>
      call<{ agreement: PartnerAgreement }>({ action: 'create', ...payload }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success('Draft agreement created');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateAgreement = useMutation({
    mutationFn: ({ id, ...payload }: Partial<PartnerAgreement> & { id: string }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'update', id, ...payload }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success('Agreement updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transitionAgreement = useMutation({
    mutationFn: (params: {
      id: string;
      status: PartnerAgreementStatus;
      reason?: string;
      termination_date?: string;
    }) => call<{ agreement: PartnerAgreement }>({ action: 'transition', ...params }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success(`Agreement is now ${res.agreement.status.replace(/_/g, ' ')}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createVersion = useMutation({
    mutationFn: (id: string) => call<{ agreement: PartnerAgreement }>({ action: 'new_version', id }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success(`Version ${res.agreement.version} drafted`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDraft = useMutation({
    mutationFn: (id: string) => call<{ success: boolean }>({ action: 'delete_draft', id }),
    onSuccess: () => {
      invalidate();
      toast.success('Draft deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { createAgreement, updateAgreement, transitionAgreement, createVersion, deleteDraft };
}

export const DIRECTION_LABELS: Record<PartnerAgreementDirection, string> = {
  inbound_property_referral: 'Property referral (partner → NPC)',
  outbound_finance_referral: 'Finance referral (NPC → partner)',
};

export const STATUS_LABELS: Record<PartnerAgreementStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  sent_for_signature: 'Sent for signature',
  partially_signed: 'Partially signed',
  active: 'Active',
  terminated: 'Terminated',
  superseded: 'Superseded',
  void: 'Void',
};
