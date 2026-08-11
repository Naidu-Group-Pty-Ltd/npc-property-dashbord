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
  agreementRenderServiceState,
  type AgreementDelivery,
  type PartnerPortalAccess,
  projectFieldValues,
  rowPatchFromValues,
  templateKeyForDirection,
  agreementTemplate,
  type AgreementArtefactState,
  type AgreementFieldValues,
  type AgreementRenderServiceState,
  type AgreementStatus,
  type AgreementTemplateKey,
} from '@/lib/agreements';
import {
  buildAgreementDocx,
  agreementDocxFileName,
  type AgreementDocxBrand,
} from '@/lib/agreements/docx';
import {
  agreementErrorMessage,
  detectSkew,
  type AgreementSkew,
} from '@/lib/agreements/apiErrors.pure';

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
  /** Whether the counterparty can reach this. Absent on an older deployment. */
  partner_portal_access?: PartnerPortalAccess;
  delivery?: AgreementDelivery;
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
  /**
   * Where this partner stands with the portal. Absent from a deployment older
   * than this bundle, so callers fall back through `portal_connected` — which
   * used to mean "invited or better" and now means "can sign in".
   */
  portal_access?: PartnerPortalAccess;
  portal_connected: boolean;
}

/** The four states, with the old boolean as the fallback. */
export function partnerAccessOf(partner: PartnerOption | null | undefined): PartnerPortalAccess {
  if (!partner) return 'none';
  return partner.portal_access ?? (partner.portal_connected ? 'active' : 'none');
}

export interface ValidationItem {
  key: string;
  label: string;
  sectionId: string;
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>(FN, payload);
  if (error) throw new Error(error.message);
  const errBody = data as {
    error?: string; message?: string; code?: string | null; missing?: ValidationItem[];
  } | null;
  if (errBody?.error) {
    // Never surface the server's raw slug. `agreementErrorMessage` keeps a real
    // sentence when the server wrote one, and replaces `unknown_action` and a
    // missing-column error with what those actually mean — the app and the
    // server are on different builds. See `apiErrors.pure.ts`.
    const err = new Error(agreementErrorMessage({
      code: errBody.error,
      // Our own failures carry `message`; a PostgREST failure arrives with its
      // code in `code` and its prose in `error`.
      message: errBody.message || errBody.error,
    })) as Error & { missing?: ValidationItem[]; code?: string; skew?: AgreementSkew };
    err.code = errBody.error;
    err.missing = errBody.missing;
    err.skew = detectSkew({ code: errBody.code ?? errBody.error, message: errBody.message || errBody.error });
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

/**
 * One error presenter for every Agreement Centre mutation.
 *
 * A deployment-skew message is a paragraph and names the fix, so it gets a
 * heading and time to be read. An ordinary refusal is one line and behaves
 * like every other toast in the app.
 */
function showAgreementError(error: Error) {
  const skew = (error as Error & { skew?: AgreementSkew }).skew;
  if (skew) {
    toast.error(
      skew === 'function_behind' ? 'Server code is out of date' : 'Database is out of date',
      { description: error.message, duration: 15_000 },
    );
    return;
  }
  toast.error(error.message);
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * The working list, or the archive.
 *
 * `archived_count` rides along with either so the archive is reachable from
 * the working view without a second request — an archived agreement that
 * cannot be found again is indistinguishable from a deleted one.
 */
export function useAgreementCentreList(archived: 'exclude' | 'only' = 'exclude') {
  return useQuery({
    queryKey: ['agreement-centre', 'list', archived],
    queryFn: async () => {
      const data = await call<{ agreements: PartnerAgreement[]; archived_count: number }>({
        action: 'list', archived,
      });
      return { agreements: data.agreements ?? [], archivedCount: data.archived_count ?? 0 };
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

/**
 * Give a partner their portal access without leaving the agreement.
 *
 * The invite function already existed, behind the Finance Portal admin screen.
 * Sending an agreement to a partner who has never logged in therefore meant
 * abandoning a half-built agreement, finding them in another section, inviting
 * them, and coming back — which is why the wizard's dead end was worth removing
 * on both sides: the agreement no longer waits for the invitation, and the
 * invitation no longer waits for a different page.
 *
 * `reinstate` is here for the one state that still blocks a digital issue.
 */
export function usePartnerPortalAccess() {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['agreement-centre', 'partners'] });
    queryClient.invalidateQueries({ queryKey: ['agreement-centre', 'detail'] });
  };

  const invite = useMutation({
    mutationFn: async (params: { financeContactId: string; resend?: boolean }) => {
      const { data, error } = await invokeSecureFunction('finance-portal-invite', {
        action: 'invite',
        finance_contact_id: params.financeContactId,
        resend_invite: params.resend === true,
        invite_mode: 'set_password_link',
      });
      if (error) throw new Error(error.message);
      if ((data as { error?: string } | null)?.error) {
        throw new Error((data as { error: string }).error);
      }
      return data as { message?: string; invite_link?: string; email_sent?: boolean };
    },
    onSuccess: (result) => {
      refresh();
      toast.success(result?.email_sent === false
        ? 'Invite created, but the email did not send — share the link from the Finance Portal admin screen.'
        : result?.message || 'Portal invitation sent.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'The invitation could not be sent.');
    },
  });

  const reinstate = useMutation({
    mutationFn: async (financeContactId: string) => {
      const { data, error } = await invokeSecureFunction('finance-portal-invite', {
        action: 'reinstate',
        finance_contact_id: financeContactId,
      });
      if (error) throw new Error(error.message);
      return data as { message?: string };
    },
    onSuccess: () => { refresh(); toast.success('Portal access reinstated.'); },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Access could not be reinstated.');
    },
  });

  return { invite, reinstate };
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
    onError: showAgreementError,
  });

  const update = useMutation({
    mutationFn: ({ id, ...payload }: Record<string, unknown> & { id: string }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'update', id, ...payload }),
    onSuccess: (res) => { invalidate(res.agreement.id); },
    onError: showAgreementError,
  });

  const transition = useMutation({
    mutationFn: (params: { id: string; status: AgreementStatus; reason?: string }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'transition', ...params }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success('Agreement updated');
    },
    onError: showAgreementError,
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
    onError: showAgreementError,
  });

  const issueToPartner = useMutation({
    mutationFn: (id: string) =>
      call<{
        agreement: PartnerAgreement;
        version: AgreementIssuedVersion;
        delivery?: AgreementDelivery;
      }>({ action: 'issue_to_partner', id }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      // "Issued" and "issued to somebody who cannot open it yet" are different
      // enough outcomes that one toast for both would be a small lie at the
      // exact moment a person is deciding whether to chase the partner.
      if (res.delivery === 'awaiting_activation') {
        toast.success(
          `Version ${res.version.version_label} issued — held for the partner until they activate `
          + 'their portal account.',
        );
      } else {
        toast.success(`Version ${res.version.version_label} issued to the partner portal`);
      }
    },
    onError: showAgreementError,
  });

  const withdraw = useMutation({
    mutationFn: (params: { id: string; reason?: string }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'withdraw', ...params }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success('Agreement withdrawn');
    },
    onError: showAgreementError,
  });

  const counterSign = useMutation({
    mutationFn: (params: { id: string; signatory_name: string; signatory_title?: string; signature_typed: string }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'counter_sign', ...params }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success('Fully executed — the master copy is stored in Agreements');
    },
    onError: showAgreementError,
  });

  const resolveChangeRequest = useMutation({
    mutationFn: (params: { id: string; request_id: string; resolution: 'resolved' | 'declined'; resolution_note?: string }) =>
      call<{ change_request: AgreementChangeRequest }>({ action: 'resolve_change_request', ...params }),
    onSuccess: (_res, params) => {
      invalidate(params.id);
      toast.success('Change request updated');
    },
    onError: showAgreementError,
  });

  const setOwner = useMutation({
    mutationFn: (params: { id: string; owner_id: string | null; owner_label: string | null }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'set_owner', ...params }),
    onSuccess: (res) => { invalidate(res.agreement.id); },
    onError: showAgreementError,
  });

  const newVersion = useMutation({
    mutationFn: (id: string) => call<{ agreement: PartnerAgreement }>({ action: 'new_version', id }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success(`Version ${res.agreement.version} drafted`);
    },
    onError: showAgreementError,
  });

  // ── Disposition ────────────────────────────────────────────────────────
  // Three different acts, three different mutations, three different
  // sentences afterwards. The server re-derives every one of these rules; the
  // UI only decides which buttons are worth showing.

  const voidAgreement = useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'void_agreement', ...params }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success('Agreement voided');
    },
    onError: showAgreementError,
  });

  const archive = useMutation({
    mutationFn: (params: { id: string; reason?: string }) =>
      call<{ agreement: PartnerAgreement }>({ action: 'archive', ...params }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success('Archived — find it under Archived, or restore it any time');
    },
    onError: showAgreementError,
  });

  const restore = useMutation({
    mutationFn: (id: string) => call<{ agreement: PartnerAgreement }>({ action: 'restore', id }),
    onSuccess: (res) => {
      invalidate(res.agreement.id);
      toast.success('Restored to the working list');
    },
    onError: showAgreementError,
  });

  const deleteAgreement = useMutation({
    mutationFn: (params: { id: string; reason?: string }) =>
      call<{ success: boolean }>({ action: 'delete_agreement', ...params }),
    onSuccess: () => {
      invalidate();
      toast.success('Agreement deleted');
    },
    onError: showAgreementError,
  });

  const createPartner = useMutation({
    mutationFn: (params: { company_name: string; contact_name?: string; email: string; abn?: string }) =>
      call<{ partner: PartnerOption }>({ action: 'create_partner', ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreement-centre', 'partners'] });
      toast.success('Finance partner created');
    },
    onError: showAgreementError,
  });

  return {
    create, update, transition, recordReview, issueToPartner, withdraw,
    counterSign, resolveChangeRequest, setOwner, newVersion,
    voidAgreement, archive, restore, deleteAgreement,
    createPartner,
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

export interface AgreementDownloadOutcome {
  /** How the stored artefact stood before this download. Absent for drafts. */
  artefactState: AgreementArtefactState | null;
  /** True when this download re-rendered a superseded artefact. */
  refreshed: boolean;
  /** Whether the render service is running the document this build expects. */
  service: AgreementRenderServiceState;
}

export async function downloadAgreementPdf(
  id: string,
  kind: 'draft' | 'issued' | 'executed',
): Promise<AgreementDownloadOutcome> {
  const data = await callRender<{
    pdf_base64?: string;
    url?: string;
    file_name: string;
    document_revision?: number;
    artefact_state?: AgreementArtefactState;
    refreshed?: boolean;
  }>({ operation: 'download', id, kind });
  if (data.pdf_base64) {
    saveBlob(base64ToBlob(data.pdf_base64, 'application/pdf'), data.file_name);
  } else if (data.url) {
    window.open(data.url, '_blank', 'noopener');
  }
  return {
    artefactState: data.artefact_state ?? null,
    refreshed: data.refreshed === true,
    // A route that reports nothing is a route deployed before revisions
    // existed, which is precisely the case worth naming — the helper folds
    // that into `behind` rather than into an unknown.
    service: agreementRenderServiceState(data.document_revision ?? null),
  };
}

/**
 * The white-labelled template itself — no agreement row required. For users
 * who send through an external platform (DocuSign, PandaDoc, …): the full
 * pack including the partner email page, the tenant's own details prefilled,
 * every negotiable field printing its original bracket text.
 */
export async function downloadTemplatePdf(templateKey: AgreementTemplateKey) {
  const data = await callRender<{ pdf_base64: string; file_name: string }>({
    operation: 'template', template_key: templateKey,
  });
  saveBlob(base64ToBlob(data.pdf_base64, 'application/pdf'), data.file_name);
}

/** The tenant's identity and brand, as the DOCX builder wants it. */
export function docxBrandFrom(
  issuer?: IssuerDefaults | null,
  brandColour?: string | null,
  logo?: AgreementDocxBrand['logo'],
): AgreementDocxBrand {
  return {
    brandColour: brandColour ?? null,
    companyName: issuer?.companyName ?? null,
    legalName: issuer?.legalName ?? null,
    abn: issuer?.abn ?? null,
    address: issuer?.address ?? null,
    email: issuer?.email ?? null,
    phone: issuer?.phone ?? null,
    website: issuer?.website ?? null,
    logo: logo ?? null,
  };
}

/**
 * The blank Word template, white-labelled — the download for a business that
 * sends through its own platform. The tenant's identity is filled in; every
 * negotiable field keeps the template's original bracket text so the
 * recipient knows exactly what is theirs to complete.
 */
export async function downloadTemplateDocx(
  templateKey: AgreementTemplateKey,
  brand: AgreementDocxBrand,
) {
  const blob = await buildAgreementDocx(templateKey, {}, { brand, includeTemplatePack: true });
  saveBlob(blob, agreementDocxFileName(agreementTemplate(templateKey).title, null, 'template'));
}

/** Client-built DOCX from the same locked content and values. */
export async function downloadAgreementDocx(
  agreement: PartnerAgreement,
  brand?: AgreementDocxBrand,
) {
  const templateKey = templateKeyForDirection(agreement.direction);
  const values = agreementValues(agreement);
  const blob = await buildAgreementDocx(templateKey, values, {
    brand: brand ?? {},
    includeTemplatePack: true,
  });
  saveBlob(blob, agreementDocxFileName(
    agreementTemplate(templateKey).title,
    agreement.partner_legal_name,
    `v${agreement.version ?? 1}`,
  ));
}
