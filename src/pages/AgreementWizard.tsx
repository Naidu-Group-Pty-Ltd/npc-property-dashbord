/**
 * Agreement configuration — the guided creation flow.
 *
 * Eight steps (type → partner → organisation → branding → variables →
 * commercial terms → preview → outcome) over one register row: the draft is
 * created when the partner is chosen and saved as the user moves between
 * steps, so nothing lives only in browser state. The live preview on the
 * right is the SAME digital view the partner will review — the locked content
 * with the current values bound in.
 *
 * The legal wording is never editable here. Every input below is a field the
 * supplied templates themselves left open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, Download, FileText, Loader2,
  Palette, Save, Search, Send, Eye, UserPlus, Building2, Pencil, PenLine, RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  agreementFieldDefs,
  isAgreementFieldVisible,
  agreementTemplate,
  templateKeyForDirection,
  rowPatchFromValues,
  projectFieldValues,
  validateForIssue,
  AGREEMENT_TEMPLATE_SUMMARIES,
  directionForTemplateKey,
  contentOverridesFromValues,
  listAgreementAmendments,
  CONTENT_OVERRIDES_VALUE_KEY,
  additionalClausesFromValues,
  ADDITIONAL_CLAUSES_VALUE_KEY,
  ADDITIONAL_CLAUSES_SECTION_ID,
  type AgreementAdditionalClause,
  type AgreementFieldDef,

  type AgreementFieldValues,
  type AgreementTemplateKey,
  type PartnerAgreementDirection,
} from '@/lib/agreements';
import {
  useAgreementCentreDetail,
  useAgreementCentreMutations,
  useAgreementPartnerOptions,
  useDuplicateCheck,
  useIssuerDefaults,
  docxBrandFrom,
  downloadAgreementDocx,
  downloadAgreementPdf,
} from '@/hooks/useAgreementCentre';
import { loadDocxLogo } from '@/lib/agreements/docx';
import { shouldLoadDraft } from '@/lib/agreements/wizardDraft.pure';
import { useBrand } from '@/branding/BrandProvider';
import type { PartnerAgreement } from '@/hooks/usePartnerAgreements';
import DigitalAgreementView from '@/components/agreement-centre/DigitalAgreementView';
import PdfPreviewDialog from '@/components/agreement-centre/PdfPreviewDialog';
import AgreementStatusBadge from '@/components/agreement-centre/AgreementStatusBadge';

const STEPS = [
  { key: 'type', title: 'Agreement Type' },
  { key: 'partner', title: 'Finance Partner' },
  { key: 'organisation', title: 'Organisation Details' },
  { key: 'branding', title: 'White-Label Branding' },
  { key: 'variables', title: 'Agreement Variables' },
  { key: 'commercial', title: 'Commercial Terms' },
  { key: 'preview', title: 'Preview' },
  { key: 'outcome', title: 'Review & Issue' },
] as const;

/**
 * Presentation only. A field's label carries its clause reference in brackets
 * ("Termination notice (clause 11.2)") and its unit in the key ("…_days"), and
 * neither read as a unit at a glance — the user sees `<<NUMBER>>` and no
 * indication that 30 means thirty days. Split the two apart here so the label
 * names the term, a chip names the clause, and the input itself says its unit.
 */
function describeField(def: AgreementFieldDef): {
  name: string;
  clause: string | null;
  unit: string | null;
  hint: string | null;
} {
  const match = /^(.*?)\s*\((clause\s*[\d.]+)\)\s*$/i.exec(def.label);
  const name = (match ? match[1] : def.label).trim();
  const clause = match ? match[2].replace(/^clause\s*/i, 'Clause ') : null;

  const key = def.key.toLowerCase();
  const unit = def.type === 'number'
    ? key.endsWith('_days') || /(^|_)days(_|$)/.test(key) ? 'days'
      : key.endsWith('_hours') ? 'hours'
      : key.endsWith('_months') ? 'months'
      : key.endsWith('_years') ? 'years'
      : key.includes('percent') || key.includes('_pct') ? '%'
      : null
    : null;

  const hint = unit && unit !== '%'
    ? `Enter a whole number of ${unit}${clause ? ` as referenced in ${clause.toLowerCase()}` : ''}.`
    : null;

  return { name, clause, unit, hint };
}

function FieldInput({
  def,
  value,
  onChange,
}: {
  def: AgreementFieldDef;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const raw = value === null || value === undefined ? '' : String(value);
  const id = `agc-field-${def.key}`;
  const { name, clause, unit, hint } = describeField(def);
  const numberPlaceholder = unit === '%' ? 'e.g. 2.5' : unit ? `e.g. 30 ${unit}` : def.placeholder;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Label htmlFor={id} className="text-xs">
          {name}
          {unit ? <span className="ml-1 font-normal text-muted-foreground">(in {unit})</span> : null}
          {def.requiredForIssue ? <span className="ml-1 text-warning">*</span> : null}
        </Label>
        {clause ? (
          <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
            {clause}
          </span>
        ) : null}
      </div>
      {def.type === 'choice' ? (
        <Select value={raw || undefined} onValueChange={(next) => onChange(next)}>
          <SelectTrigger id={id}>
            <SelectValue placeholder={def.placeholder || 'Select…'} />
          </SelectTrigger>
          <SelectContent>
            {(def.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : def.type === 'longtext' ? (
        <Textarea id={id} value={raw} rows={2} placeholder={def.placeholder}
          onChange={(event) => onChange(event.target.value)} />
      ) : (
        <div className="relative">
          <Input
            id={id}
            type={def.type === 'date' ? 'date' : def.type === 'number' ? 'number' : 'text'}
            inputMode={def.type === 'number' ? 'numeric' : undefined}
            min={def.type === 'number' ? 0 : undefined}
            value={raw}
            placeholder={def.type === 'number' ? numberPlaceholder : def.placeholder}
            aria-describedby={hint ? `${id}-hint` : undefined}
            className={unit ? 'pr-14' : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
          {unit ? (
            <span
              aria-hidden
              className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground"
            >
              {unit}
            </span>
          ) : null}
        </div>
      )}
      {hint ? (
        <p id={`${id}-hint`} className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function FieldGroup({
  defs,
  values,
  onChange,
}: {
  defs: AgreementFieldDef[];
  values: AgreementFieldValues;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {defs.filter((def) => isAgreementFieldVisible(def, values)).map((def) => (
        <FieldInput key={def.key} def={def} value={values[def.key]}
          onChange={(next) => onChange(def.key, next)} />
      ))}
    </div>
  );
}

export default function AgreementWizard() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  const [agreementId, setAgreementId] = useState<string | null>(routeId ?? null);
  const [step, setStep] = useState(routeId ? 2 : 0);
  const [direction, setDirection] = useState<PartnerAgreementDirection | null>(
    (searchParams.get('direction') as PartnerAgreementDirection) || null,
  );
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [values, setValues] = useState<AgreementFieldValues>({});
  const [dirty, setDirty] = useState(false);
  const [previewPdfId, setPreviewPdfId] = useState<string | null>(null);
  /** Preview step: edit values where they are printed (default on — that is the point). */
  const [inlineEditing, setInlineEditing] = useState(true);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [newPartnerOpen, setNewPartnerOpen] = useState(false);
  const [newPartner, setNewPartner] = useState({ company_name: '', contact_name: '', email: '', abn: '' });

  const { data: detail } = useAgreementCentreDetail(agreementId);
  const agreement = detail?.agreement ?? null;
  const { data: issuer } = useIssuerDefaults();
  const { settings: brandSettings } = useBrand();
  const {
    data: partners = [],
    isLoading: partnersLoading,
    error: partnersError,
    refetch: refetchPartners,
  } = useAgreementPartnerOptions();
  const { data: duplicates = [] } = useDuplicateCheck(partnerId, direction);
  const {
    create, update, transition, recordReview, issueToPartner, createPartner,
  } = useAgreementCentreMutations();

  const templateKey: AgreementTemplateKey | null = direction ? templateKeyForDirection(direction) : null;
  const fieldDefs = useMemo(
    () => (templateKey ? [...agreementFieldDefs(templateKey)] : []),
    [templateKey],
  );

  useEffect(() => {
    document.title = 'Configure Agreement | Command Centre';
  }, []);

  /**
   * Load the stored draft into the form.
   *
   * Guarded against overwriting work in progress. Every save invalidates the
   * detail query, so a refetch lands a moment after the step advances — and
   * without the `dirty` check below it reset the form from the server while
   * the user was already typing on the next step, silently discarding those
   * keystrokes. The stamp makes the load idempotent; the `dirty` check makes
   * the user's unsaved input win until it has somewhere safe to go.
   */
  const loadedStamp = useRef<string | null>(null);
  useEffect(() => {
    if (!agreement) return;
    const stamp = `${agreement.id}:${agreement.updated_at}`;
    if (!shouldLoadDraft(stamp, { loaded: loadedStamp.current, dirty })) return;
    loadedStamp.current = stamp;
    setDirection(agreement.direction);
    setPartnerId(agreement.finance_agent_contact_id);
    const key = templateKeyForDirection(agreement.direction);
    setValues(projectFieldValues(key, agreement as never, {}, { raw: true }));
    setDirty(false);
  }, [agreement, dirty]);

  const setValue = (key: string, value: unknown) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  };

  /**
   * A negotiated wording amendment. Stored beside the values (never in the
   * template), so the same save that persists the figures persists the amended
   * clause, and issuing freezes both onto the version row. `null` restores.
   */
  const setContentOverride = (path: string, text: string | null) => {
    setValues((previous) => {
      const next = { ...contentOverridesFromValues(previous) };
      if (text === null) delete next[path]; else next[path] = text;
      return { ...previous, [CONTENT_OVERRIDES_VALUE_KEY]: next };
    });
    setDirty(true);
  };

  /** Every departure from the supplied wording, for the review list below. */
  const amendments = useMemo(
    () => (templateKey
      ? listAgreementAmendments(agreementTemplate(templateKey), contentOverridesFromValues(values))
      : []),
    [templateKey, values],
  );

  /**
   * Special conditions — wording the template never carried. Same store, same
   * freeze: they travel with the field values onto the version row.
   */
  const additionalClauses = useMemo(() => additionalClausesFromValues(values), [values]);
  const setAdditionalClauses = (next: AgreementAdditionalClause[]) => {
    setValues((previous) => ({ ...previous, [ADDITIONAL_CLAUSES_VALUE_KEY]: next }));
    setDirty(true);
  };


  /** The preview projection: current edits applied over the row. */
  const previewValues = useMemo(() => {
    if (!templateKey) return {};
    const patch = rowPatchFromValues(templateKey, values);
    const base = agreement ?? {};
    const pseudoRow = {
      ...base,
      ...patch.columns,
      schedule_extras: { ...((agreement?.schedule_extras as Record<string, unknown>) ?? {}), ...patch.extras },
      document_version: agreement?.document_version ?? '2.0',
    };
    return projectFieldValues(templateKey, pseudoRow as never, {
      companyName: issuer?.companyName ?? null,
      phone: issuer?.phone ?? null,
      email: issuer?.email ?? null,
      website: issuer?.website ?? null,
    });
  }, [templateKey, values, agreement, issuer]);

  const validation = useMemo(
    () => (templateKey ? validateForIssue(templateKey, previewValues) : { ok: false, missing: [] }),
    [templateKey, previewValues],
  );

  const selectedPartner = partners.find((partner) => partner.id === partnerId) ?? null;

  /** Persist the current form onto the row. Creates the draft on first save. */
  const persist = async (): Promise<PartnerAgreement | null> => {
    if (!templateKey || !direction) return null;
    const patch = rowPatchFromValues(templateKey, values);
    const payload = {
      ...patch.columns,
      schedule_extras: { ...((agreement?.schedule_extras as Record<string, unknown>) ?? {}), ...patch.extras },
      finance_agent_contact_id: partnerId,
    };
    if (!agreementId) {
      const created = await create.mutateAsync({ direction, ...payload });
      setAgreementId(created.agreement.id);
      window.history.replaceState(null, '', `/partner-agreements/${created.agreement.id}/edit`);
      setDirty(false);
      return created.agreement;
    }
    if (dirty) {
      const updated = await update.mutateAsync({ id: agreementId, ...payload });
      setDirty(false);
      return updated.agreement;
    }
    return agreement;
  };

  /** Whether there is anything a save could actually write. */
  const canSave = Boolean(direction) && (Boolean(agreementId) || Boolean(String(values.fp_legal_name ?? '').trim()));
  const saving = create.isPending || update.isPending;

  /**
   * Explicit save. The wizard also saves on every step change, but a form
   * that produces a legal document should never require the user to infer
   * that — and somebody who fills in half the commercial schedule and then
   * gets pulled into a meeting needs a button, not a convention.
   */
  const saveDraft = async (options: { silent?: boolean } = {}) => {
    if (!canSave) return null;
    try {
      const saved = await persist();
      if (!options.silent) toast.success('Draft saved');
      return saved;
    } catch {
      return null; // the mutation's own toast already said why
    }
  };

  /** Leaving the wizard must not cost the user their unsaved work. */
  const leaveWizard = async () => {
    if (dirty && canSave) await saveDraft({ silent: true });
    navigate(agreementId ? `/partner-agreements/${agreementId}` : '/partner-agreements');
  };

  // The tab-close case, which no in-app handler can catch.
  const warnOnUnload = useCallback((event: BeforeUnloadEvent) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  }, [dirty]);

  useEffect(() => {
    window.addEventListener('beforeunload', warnOnUnload);
    return () => window.removeEventListener('beforeunload', warnOnUnload);
  }, [warnOnUnload]);

  const stepReady = (): boolean => {
    switch (STEPS[step].key) {
      case 'type': return !!direction;
      case 'partner': return !!partnerId && !!String(values.fp_legal_name ?? '').trim();
      default: return true;
    }
  };

  const goNext = async () => {
    try {
      if (STEPS[step].key === 'partner' || (step > 1 && dirty)) await persist();
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
    } catch {
      /* toast already shown by the mutation */
    }
  };

  const goBack = () => setStep((current) => Math.max(current - 1, 0));

  const jumpToField = (sectionId: string) => {
    // Validation items point at document sections; map them onto the steps.
    const commercial = sectionId.includes('commercial') || sectionId.includes('commission');
    setStep(commercial ? 5 : 4);
  };

  const choosePartner = (nextId: string, record?: {
    company_name: string | null; contact_name: string | null; email: string | null; abn: string | null;
  }) => {
    setPartnerId(nextId);
    const partner = record ?? partners.find((candidate) => candidate.id === nextId);
    if (partner) {
      setValues((previous) => ({
        ...previous,
        fp_legal_name: previous.fp_legal_name || partner.company_name || partner.contact_name || '',
        fp_trading_name: previous.fp_trading_name || partner.company_name || '',
        fp_abn_acn: previous.fp_abn_acn || partner.abn || '',
        fp_email: previous.fp_email || partner.email || '',
      }));
      setDirty(true);
    }
  };

  const filteredPartners = useMemo(() => {
    const query = partnerSearch.trim().toLowerCase();
    if (!query) return partners;
    return partners.filter((partner) =>
      [partner.company_name, partner.contact_name, partner.email, partner.abn]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)));
  }, [partners, partnerSearch]);

  const submitNewPartner = () => {
    createPartner.mutate(
      {
        company_name: newPartner.company_name.trim(),
        contact_name: newPartner.contact_name.trim() || undefined,
        email: newPartner.email.trim(),
        abn: newPartner.abn.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          setNewPartnerOpen(false);
          setNewPartner({ company_name: '', contact_name: '', email: '', abn: '' });
          choosePartner(result.partner.id, result.partner);
        },
      },
    );
  };

  const applyIssuerDefaults = () => {
    if (!issuer) return;
    setValues((previous) => ({
      ...previous,
      ba_legal_name: previous.ba_legal_name || issuer.legalName || issuer.companyName || '',
      ba_trading_name: previous.ba_trading_name || issuer.companyName || '',
      ba_abn_acn: previous.ba_abn_acn || issuer.abn || '',
      ba_address: previous.ba_address || issuer.address || '',
      ba_email: previous.ba_email || issuer.email || '',
    }));
    setDirty(true);
  };

  const submitForReview = async (approveNow: boolean) => {
    try {
      const saved = await persist();
      const id = saved?.id ?? agreementId;
      if (!id) return;
      if (saved?.status === 'draft' || saved?.status === 'changes_requested' || !saved) {
        await transition.mutateAsync({ id, status: 'pending_review' });
      }
      if (approveNow) {
        await recordReview.mutateAsync({ id, decision: 'approved' });
        await issueToPartner.mutateAsync(id);
      }
      navigate(`/partner-agreements/${id}`);
    } catch {
      /* mutation toasts handle messaging; validation errors keep the user here */
    }
  };

  const exportDocument = async (kind: 'pdf' | 'docx') => {
    try {
      setExporting(kind);
      const saved = await persist();
      if (!saved) return;
      if (kind === 'pdf') await downloadAgreementPdf(saved.id, 'draft');
      else {
        const logo = await loadDocxLogo(brandSettings?.reportLogo ?? brandSettings?.sidebarLogo ?? null);
        await downloadAgreementDocx(saved, docxBrandFrom(
          issuer, brandSettings?.brandColor ?? brandSettings?.primaryColor ?? null, logo,
        ));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const group = (name: AgreementFieldDef['group']) => fieldDefs.filter((def) => def.group === name);

  const stepBody = () => {
    switch (STEPS[step].key) {
      case 'type':
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            {AGREEMENT_TEMPLATE_SUMMARIES.map((template) => {
              const templateDirection = directionForTemplateKey(template.key);
              const selected = direction === templateDirection;
              return (
                <button
                  key={template.key}
                  type="button"
                  disabled={!!agreementId}
                  onClick={() => setDirection(templateDirection)}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-colors',
                    selected ? 'border-primary bg-primary/5' : 'border-border bg-card/50 hover:bg-accent/10',
                    agreementId && !selected && 'opacity-50',
                  )}
                >
                  <div className="flex items-center justify-center gap-2 rounded-lg bg-muted/40 px-2 py-2.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{template.from}</span>
                    <ArrowRight className="h-4 w-4 text-primary" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{template.to}</span>
                  </div>
                  <h3 className="mt-3 font-serif text-base font-semibold text-foreground">{template.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{template.referralFlow}</p>
                  {selected ? (
                    <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <Check className="h-3.5 w-3.5" /> Selected
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      case 'partner':
        return (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search partners by company, contact, email or ABN…"
                  value={partnerSearch}
                  onChange={(event) => setPartnerSearch(event.target.value)}
                />
              </div>
              <Button variant="outline" onClick={() => setNewPartnerOpen(true)}>
                <UserPlus className="mr-1.5 h-4 w-4" /> New finance partner
              </Button>
            </div>

            {partnersLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-border py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading finance partners…
              </div>
            ) : partnersError ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Could not load finance partners</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{partnersError instanceof Error ? partnersError.message : 'The partner list failed to load.'}</p>
                  <Button size="sm" variant="outline" onClick={() => refetchPartners()}>Try again</Button>
                </AlertDescription>
              </Alert>
            ) : filteredPartners.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
                <Building2 className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  {partners.length === 0 ? 'No finance partners yet' : 'No partners match your search'}
                </p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Create the partner record here — you can invite them to the Finance Portal later.
                </p>
                <Button size="sm" onClick={() => setNewPartnerOpen(true)}>
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" /> New finance partner
                </Button>
              </div>
            ) : (
              <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {filteredPartners.map((partner) => {
                  const selected = partnerId === partner.id;
                  return (
                    <button
                      key={partner.id}
                      type="button"
                      onClick={() => choosePartner(partner.id)}
                      className={cn(
                        'rounded-xl border p-3.5 text-left transition-colors',
                        selected ? 'border-primary bg-primary/5' : 'border-border bg-card/50 hover:bg-accent/10',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {partner.company_name || partner.contact_name || partner.email}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[partner.contact_name, partner.email].filter(Boolean).join(' · ')}
                          </div>
                          {partner.abn ? (
                            <div className="text-xs text-muted-foreground">ABN {partner.abn}</div>
                          ) : null}
                        </div>
                        {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                      </div>
                      <div className={cn(
                        'mt-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        partner.portal_connected
                          ? 'bg-success/15 text-success'
                          : 'bg-muted text-muted-foreground',
                      )}>
                        {partner.portal_connected ? 'Portal connected' : 'No portal login'}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedPartner && !selectedPartner.portal_connected ? (
              <p className="text-xs text-warning">
                This partner has no active Finance Portal login — digital issue will be unavailable
                until they are invited, but the download options always work.
              </p>
            ) : null}
            {duplicates.length > 0 ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Active agreement found</AlertTitle>
                <AlertDescription>
                  {duplicates.length === 1
                    ? 'An agreement of this type already exists with this partner.'
                    : `${duplicates.length} agreements of this type already exist with this partner.`}{' '}
                  <button type="button" className="font-medium text-primary underline-offset-2 hover:underline"
                    onClick={() => navigate(`/partner-agreements/${duplicates[0].id}`)}>
                    View existing agreement
                  </button>{' '}
                  — or continue with a new one.
                </AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup defs={group('counterparty')} values={values} onChange={setValue} />
          </div>
        );
      case 'organisation':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Your organisation as it will appear in the executed agreement.
              </p>
              <Button variant="outline" size="sm" onClick={applyIssuerDefaults} disabled={!issuer}>
                Auto-fill from settings
              </Button>
            </div>
            <FieldGroup defs={group('issuer')} values={values} onChange={setValue} />
          </div>
        );
      case 'branding':
        return (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card/50 p-4">
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">White-label branding</h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                The generated agreement carries your organisation's mark, colours and company details
                from White Label settings — the same brand snapshot every report uses, frozen onto
                each issued version so a rebrand never changes an issued document. Nothing to
                configure here if your branding is already set up.
              </p>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-muted/30 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Issuing organisation</div>
                  <div className="text-foreground">{issuer?.companyName ?? issuer?.legalName ?? 'From White Label settings'}</div>
                </div>
                <div className="rounded-lg bg-muted/30 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Company details on documents</div>
                  <div className="text-foreground">{[issuer?.abn && `ABN ${issuer.abn}`, issuer?.email, issuer?.phone].filter(Boolean).join(' · ') || 'From Report settings'}</div>
                </div>
              </div>
              <Button variant="link" className="mt-1 h-auto p-0 text-xs" onClick={() => navigate('/white-label')}>
                Review White Label settings →
              </Button>
            </div>
          </div>
        );
      case 'variables':
        return (
          <div className="space-y-5">
            <FieldGroup defs={group('agreement')} values={values} onChange={setValue} />
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Clause variables</h3>
              <p className="mb-2 mt-1 text-xs text-muted-foreground">
                Each figure below fills the numbered clause shown on its chip. Every period is
                expressed in whole days unless the field says otherwise.
              </p>
              <FieldGroup defs={group('clauses')} values={values} onChange={setValue} />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Execution prefill (optional)</h3>
              <FieldGroup defs={group('execution')} values={values} onChange={setValue} />
            </div>
            {group('supporting').length ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Supporting forms (optional)</h3>
                <FieldGroup defs={group('supporting')} values={values} onChange={setValue} />
              </div>
            ) : null}
          </div>
        );
      case 'commercial':
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The negotiable schedule. The template sets no figures — every value here is the
              parties' to agree.
            </p>
            <FieldGroup defs={group('commercial')} values={values} onChange={setValue} />
          </div>
        );
      case 'preview':
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={async () => {
                const saved = await persist().catch(() => null);
                if (saved) setPreviewPdfId(saved.id);
              }}>
                <Eye className="mr-1.5 h-3.5 w-3.5" /> Typeset PDF preview
              </Button>
              <Button
                variant={inlineEditing ? 'default' : 'outline'}
                size="sm"
                onClick={() => setInlineEditing((previous) => !previous)}
                aria-pressed={inlineEditing}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                {inlineEditing ? 'Editing in document' : 'Edit in document'}
              </Button>
              <span className="text-xs text-muted-foreground">
                {inlineEditing
                  ? 'Click any value to change it, or the pencil beside any clause, heading or panel to amend its wording. Every edit flows into the final PDF.'
                  : 'Read-only view. Turn on editing to change values and amend clause wording directly on the page.'}
              </span>
            </div>
            {amendments.length ? (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <PenLine className="h-4 w-4 text-warning" />
                    {amendments.length} clause{amendments.length === 1 ? '' : 's'} depart from the supplied wording
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setValues((previous) => ({ ...previous, [CONTENT_OVERRIDES_VALUE_KEY]: {} }));
                      setDirty(true);
                      toast.success('The supplied wording has been restored throughout.');
                    }}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" /> Restore all
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  These amendments are recorded on the audit trail and frozen into the version you issue.
                  Have legal review them before the agreement is sent.
                </p>
                <ul className="mt-2 space-y-1.5">
                  {amendments.map((amendment) => (
                    <li key={amendment.path} className="text-xs">
                      <button
                        type="button"
                        className="font-medium text-primary underline-offset-2 hover:underline"
                        onClick={() => jumpToField(amendment.sectionId)}
                      >
                        {amendment.label}
                      </button>
                      <span className="ml-2 text-muted-foreground line-through">
                        {amendment.original.slice(0, 90)}{amendment.original.length > 90 ? '…' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!validation.ok && templateKey ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{validation.missing.length} item{validation.missing.length === 1 ? '' : 's'} require attention before issue</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 space-y-0.5">
                    {validation.missing.map((item) => (
                      <li key={item.key}>
                        <button type="button" className="text-primary underline-offset-2 hover:underline"
                          onClick={() => jumpToField(item.sectionId)}>
                          {item.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            {templateKey ? (
              <div
                className={cn(
                  'max-h-[72vh] overflow-y-auto rounded-xl border bg-background/40 p-4 transition-colors',
                  inlineEditing ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border',
                )}
              >
                <DigitalAgreementView
                  templateKey={templateKey}
                  values={previewValues}
                  versionLabel="Draft"
                  edit={inlineEditing
                    ? {
                      defs: fieldDefs,
                      rawValues: values,
                      onChange: setValue,
                      onContentChange: setContentOverride,
                    }
                    : null}
                />
              </div>
            ) : null}
          </div>
        );

      case 'outcome':
        return (
          <div className="space-y-4">
            {agreement ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                Current status: <AgreementStatusBadge status={agreement.status as never} />
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Send className="h-4 w-4 text-primary" /> Issue digitally
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Send into the Finance Partner Portal for secure review, acceptance and electronic
                  execution. The executed copy returns to the Command Centre automatically.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => submitForReview(false)}
                    disabled={transition.isPending || recordReview.isPending || issueToPartner.isPending}>
                    Submit for internal review
                  </Button>
                  <Button size="sm" variant="outline"
                    disabled={!validation.ok || !selectedPartner?.portal_connected
                      || transition.isPending || recordReview.isPending || issueToPartner.isPending}
                    onClick={() => submitForReview(true)}>
                    {issueToPartner.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    Approve & send now
                  </Button>
                </div>
                {!selectedPartner?.portal_connected ? (
                  <p className="mt-2 text-[11px] text-warning">Digital issue needs a partner portal login.</p>
                ) : null}
              </div>
              <div className="rounded-xl border border-border bg-card/50 p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FileText className="h-4 w-4 text-primary" /> Export
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Download the white-labelled agreement (with the partner email page) to manage
                  outside the portal. Both paths stay available — export now, issue digitally later.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={exporting !== null} onClick={() => exportDocument('pdf')}>
                    {exporting === 'pdf' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    Download PDF
                  </Button>
                  <Button size="sm" variant="outline" disabled={exporting !== null} onClick={() => exportDocument('docx')}>
                    {exporting === 'docx' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    Download DOCX
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6 xl:flex-row">
      {/* Left — steps */}
      <aside className="shrink-0 xl:w-56">
        <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={leaveWizard}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Agreements
        </Button>
        <ol className="flex gap-1 overflow-x-auto xl:flex-col xl:gap-0.5">
          {STEPS.map((entry, index) => {
            const done = index < step;
            const current = index === step;
            return (
              <li key={entry.key}>
                <button
                  type="button"
                  disabled={index > step && !agreementId}
                  onClick={() => { if (index <= step || agreementId) setStep(index); }}
                  className={cn(
                    'flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    current ? 'bg-primary/10 font-medium text-primary'
                      : done ? 'text-foreground hover:bg-accent/10'
                        : 'text-muted-foreground hover:bg-accent/10 disabled:opacity-50',
                  )}
                >
                  <span className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                    current ? 'border-primary text-primary' : done ? 'border-success bg-success/15 text-success' : 'border-border',
                  )}>
                    {done ? <Check className="h-3 w-3" /> : index + 1}
                  </span>
                  {entry.title}
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      {/* Centre — the step */}
      <Card className="min-w-0 flex-1">
        <CardContent className="p-4 sm:p-6">
          <h2 className="mb-1 text-lg font-semibold text-foreground">
            Step {step + 1} — {STEPS[step].title}
          </h2>
          {templateKey ? (
            <p className="mb-4 text-xs text-muted-foreground">{agreementTemplate(templateKey).title}</p>
          ) : (
            <p className="mb-4 text-xs text-muted-foreground">Choose which agreement to prepare.</p>
          )}
          {stepBody()}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={goBack} disabled={step === 0}>
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
              {canSave ? (
                <Button variant="outline" onClick={() => saveDraft()} disabled={saving || !dirty}>
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                  Save draft
                </Button>
              ) : null}
              <span
                className={cn('text-xs', dirty ? 'text-warning' : 'text-muted-foreground')}
                aria-live="polite"
              >
                {saving ? 'Saving…' : dirty ? 'Unsaved changes' : agreementId ? 'All changes saved' : ''}
              </span>
            </div>
            {step < STEPS.length - 1 ? (
              <Button onClick={goNext} disabled={!stepReady() || create.isPending || update.isPending}>
                {(create.isPending || update.isPending) ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Continue <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Right — live preview on wide screens */}
      {templateKey && step >= 2 && step < 6 ? (
        <aside className="hidden w-[420px] shrink-0 2xl:block">
          <div className="sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-border bg-background/40 p-4">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Live preview</div>
            <DigitalAgreementView templateKey={templateKey} values={previewValues} versionLabel="Draft" className="scale-[0.96] origin-top" />
          </div>
        </aside>
      ) : null}

      <PdfPreviewDialog agreementId={previewPdfId} onOpenChange={(open) => { if (!open) setPreviewPdfId(null); }} />

      {/* Inline partner creation — no detour through Finance Portal Admin. */}
      <Dialog open={newPartnerOpen} onOpenChange={setNewPartnerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New finance partner</DialogTitle>
            <DialogDescription>
              Creates the partner record so the agreement can be prepared now. Portal access and
              full contact management live in Finance Portal Admin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="agc-np-company">Company name <span className="text-warning">*</span></Label>
              <Input id="agc-np-company" value={newPartner.company_name}
                onChange={(event) => setNewPartner((p) => ({ ...p, company_name: event.target.value }))}
                placeholder="e.g. ABC Finance Pty Ltd" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agc-np-contact">Contact name</Label>
              <Input id="agc-np-contact" value={newPartner.contact_name}
                onChange={(event) => setNewPartner((p) => ({ ...p, contact_name: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agc-np-email">Email <span className="text-warning">*</span></Label>
              <Input id="agc-np-email" type="email" value={newPartner.email}
                onChange={(event) => setNewPartner((p) => ({ ...p, email: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agc-np-abn">ABN / ACN</Label>
              <Input id="agc-np-abn" value={newPartner.abn}
                onChange={(event) => setNewPartner((p) => ({ ...p, abn: event.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewPartnerOpen(false)} disabled={createPartner.isPending}>
              Cancel
            </Button>
            <Button
              disabled={!newPartner.company_name.trim() || !newPartner.email.trim() || createPartner.isPending}
              onClick={submitNewPartner}
            >
              {createPartner.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              Create & select
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
