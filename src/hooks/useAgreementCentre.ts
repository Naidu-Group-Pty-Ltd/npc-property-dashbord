/**
 * Agreement Centre — Command Centre data layer.
 *
 * Wraps `manage-partner-agreements` (lifecycle) and `agreement-centre-render`
 * (documents). Field editing flows through the shared registry: the wizard
 * edits field values, `rowPatchFromValues` maps them onto the register row,
 * and the server's allowlist decides what lands. The DOCX export is built in
 * the browser from the same locked content module.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { PartnerAgreement } from '@/hooks/usePartnerAgreements';
import {
  projectFieldValues,
  rowPatchFromValues,
  templateKeyForDirection,
  agreementTemplate,
  type AgreementFieldValues,
  type AgreementStatus,
} from '@/lib/agreements';
import { buildAgreementDocx, agreementDocxFileName } from '@/lib/agreements/docx';

const FN = 'manage-partner-agreements';
const RENDER_FN = 'agreement-centre-render';

export interface AgreementIssuedVersion {
  id: string;
  version_label: string;
  issue_sequence: number;
  status: 'issued' | 'superseded' | 'executed' | 'withdrawn';
  issued_at: string;
  issued_by_label: string | null;
  changed_fields: { field: string; label: string; previous: unknown; updated: unknown }[];
  template_content_hash: string;
  pdf_storage_path: string | null;
  executed_pdf_storage_path: string | null;
  executed_at: string | null;
}

export interface AgreementReview {
  id: string;
  decision: 'approved' | 'returned';
  reviewer_label: string | null;
  notes: string | null;
  created_at: string;
}

export interface AgreementChangeRequest {
  id: string;
  version_id: string | null;
  section_key: string;
  comment: string;
  requested_by_label: string | null;
  status: 'open' | 'resolved' | 'declined';
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface AgreementSignatureRow {
  id: string;
  version_id: string;
  party_role: string;
  legal_entity: string | null;
  signatory_name: string | null;
  signatory_title: string | null;
  signature_method: string | null;
  signed_at: string | null;
}

export interface AgreementDetailPayload {
  agreement: PartnerAgreement;
  events: {
    id: string; event_type: string; actor_label: string | null;
    summary: string | null; payload: Record<string, unknown>; created_at: string;
  }[];
  versions: { id: string; version: number; status: string; effective_date: string | null; created_at: string }[];
  issued_versions: AgreementIssuedVersion[];
  reviews: AgreementReview[];
  change_requests: AgreementChangeRequest[];
  signatures: AgreementSignatureRow[];
}

export interface IssuerDefaults {
  companyName: string | null;
  legalName: string | null;
  abn: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
}

export interface PartnerOption {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  abn: string | null;
  portal_connected: boolean;
}

export interface ValidationItem {
  key: string;
  label: string;
  sectionId: string;
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>(FN, payload);
  if (error) throw new Error(error.message);
  const errBody = data as { error?: string; message?: string; missing?: ValidationItem[] } | null;
  if (errBody?.error) {
    const err = new Error(errBody.message || errBody.error) as Error & { missing?: ValidationItem[]; code?: string };
    err.code = errBody.error;
    err.missing = errBody.missing;
    throw err;
  }
  return data as T;
}

async function callRender<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>(RENDER_FN, payload);
  if (error) throw new Error(error.message);
  const errBody = data as { error?: string; message?: string } | null;
  if (errBody?.error) throw new Error(errBody.message || errBody.error);
  return data as T;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useAgreementCentreList() {
  return useQuery({
    queryKey: ['agreement-centre', 'list'],
    queryFn: async () => {
      const data = await call<{ agreements: PartnerAgreement[] }>({ action: 'list' });
      return data.agreements ?? [];
    },
  });
}

export function useAgreementCentreDetail(id: string | null) {
  return useQuery({
    queryKey: ['agreement-centre', 'detail', id],
    enabled: !!id,
    queryFn: async () => call<AgreementDetailPayload>({ action: 'get', id }),
  });
}

export function useIssuerDefaults() {
  return useQuery({
    queryKey: ['agreement-centre', 'issuer-defaults'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => (await call<{ issuer: IssuerDefaults }>({ action: 'issuer_defaults' })).issuer,
  });
}

export function useAgreementPartnerOptions() {
  return useQuery({
    queryKey: ['agreement-centre', 'partners'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => (await call<{ partners: PartnerOption[] }>({ action: 'list_partners' })).partners ?? [],
  });
}

export function useDuplicateCheck(financeContactId: string | null, direction: string | null) {
  return useQuery({
    queryKey: ['agreement-centre', 'duplicates', financeContactId, direction],
    enabled: !!financeContactId,
    queryFn: async () => (await call<{ agreements: Pick<PartnerAgreement, 'id' | 'direction' | 'status' | 'version' | 'partner_legal_name' | 'effective_date' | 'created_at'>[] }>({
      action: 'duplicate_check',
      finance_agent_contact_id: financeContactId,
      direction,
    })).agreements ?? [],
  });
}

export function useIssueValidation(id: string | null) {
  return useQuery({
    queryKey: ['agreement-centre', 'validation', id],
    enabled: !!id,
    queryFn: async () => call<{ ok: boolean; missing: ValidationItem[] }>({ action: 'validate_issue', id }),
  });
}

// ── Field-value helpers ──────────────────────────────────────────────────────

/** Project a register row into wizard/preview field values. */
export function agreementValues(agreement: PartnerAgreement): AgreementFieldValues {
  return projectFieldValues(templateKeyForDirection(agreement.direction), agreement as never);
}

/** Map edited field values back onto an update payload for the register row. */
export function agreementUpdatePayload(
  agreement: PartnerAgreement,
  values: AgreementFieldValues,
): Record<string, unknown> {
  const patch = rowPatchFromValues(templateKeyForDirection(agreement.direction), values);
  return {
    ...patch.columns,
    schedule_extras: { ...(agreement.schedule_extras ?? {}), ...patch.extras },
  };
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useAgreementCentreMutations() {
  const queryClient = useQueryClient();
  const invalidate = (id?: string) => {
    queryClient.invalidateQueries({ queryKey: ['agreement-centre'] });
    queryClient.invalidateQueries({ queryKey: ['partner-agreements'] });
    if (id) queryClient.invalidateQueries({ queryKey: ['agreement-centre', 'detail', id] });
  };

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      call<{ agreement: PartnerAgreement }>({ action: 'create', ...payload }),
    onSuccess: (res) => { invalidate(res.agreement.id); },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: ({ id, ...payload }: Record<string, unknown> & { id: string }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'update', id, ...payload }),
    onSuccess: (res) => { invalidate(res.agreement.id); },
    onError: (e: Error) => toast.error(e.message),
  });

  const transition = useMutation({
    mutationFn: (params: { id: string; status: AgreementStatus; reason?: string }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'transition', ...params }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success('Agreement updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recordReview = useMutation({
    mutationFn: (params: { id: string; decision: 'approved' | 'returned'; notes?: string }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'record_review', ...params }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success(res.agreement.status === 'approved_for_issue'
        ? 'Approved for issue'
        : 'Returned to draft');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const issueToPartner = useMutation({
    mutationFn: (id: string) =>
      call<{ agreement: PartnerAgreement; version: AgreementIssuedVersion }>({ action: 'issue_to_partner', id }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success(`Version ${res.version.version_label} issued to the partner portal`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const withdraw = useMutation({
    mutationFn: (params: { id: string; reason?: string }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'withdraw', ...params }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success('Agreement withdrawn');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const counterSign = useMutation({
    mutationFn: (params: { id: string; signatory_name: string; signatory_title?: string; signature_typed: string }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'counter_sign', ...params }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success('Fully executed — the master copy is stored in Agreements');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolveChangeRequest = useMutation({
    mutationFn: (params: { id: string; request_id: string; resolution: 'resolved' | 'declined'; resolution_note?: string }) =>
      call<{ change_request: AgreementChangeRequest }>({ action: 'resolve_change_request', ...params }),
    onSuccess: (_res, params) => {
      invalidate(params.id);
      toast.success('Change request updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setOwner = useMutation({
    mutationFn: (params: { id: string; owner_id: string | null; owner_label: string | null }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'set_owner', ...params }),
    onSuccess: (res) => { invalidate(res.agreement.id); },
    onError: (e: Error) => toast.error(e.message),
  });

  const newVersion = useMutation({
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

  return {
    create, update, transition, recordReview, issueToPartner, withdraw,
    counterSign, resolveChangeRequest, setOwner, newVersion, deleteDraft,
  };
}

// ── Documents ────────────────────────────────────────────────────────────────

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** The exact typeset document, as a blob URL for the in-app viewer. */
export async function fetchAgreementPreviewUrl(id: string): Promise<{ url: string; gaps: string[] }> {
  const data = await callRender<{ pdf_base64: string; gaps: string[] }>({ operation: 'preview', id });
  const blob = base64ToBlob(data.pdf_base64, 'application/pdf');
  return { url: URL.createObjectURL(blob), gaps: data.gaps ?? [] };
}

export async function downloadAgreementPdf(id: string, kind: 'draft' | 'issued' | 'executed') {
  const data = await callRender<{ pdf_base64?: string; url?: string; file_name: string }>({
    operation: 'download', id, kind,
  });
  if (data.pdf_base64) {
    saveBlob(base64ToBlob(data.pdf_base64, 'application/pdf'), data.file_name);
  } else if (data.url) {
    window.open(data.url, '_blank', 'noopener');
  }
}

/** Client-built DOCX from the same locked content and values. */
export async function downloadAgreementDocx(agreement: PartnerAgreement) {
  const templateKey = templateKeyForDirection(agreement.direction);
  const values = agreementValues(agreement);
  const blob = await buildAgreementDocx(templateKey, values);
  saveBlob(blob, agreementDocxFileName(
    agreementTemplate(templateKey).title,
    agreement.partner_legal_name,
    `v${agreement.version ?? 1}`,
  ));
}
