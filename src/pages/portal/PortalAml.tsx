import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, CheckCircle2, Clock, AlertTriangle, Upload, FileText, ArrowRight, ArrowLeft, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import {
  amlPortalApi, uploadAmlDocument, type AmlPortalOverview, type AmlSection,
} from '@/lib/aml/amlPortalApi';

type PortalStep = { key: string; label: string; section?: AmlSection };

/**
 * Phase 5 — the questionnaire step list is SERVER-DRIVEN: `overview.sections`
 * carries the sections applicable to this case (conditional on the declared
 * purchasing structure and funding sources). Labels here are presentation
 * only; unknown future sections fall back to a humanised key.
 */
const SECTION_LABELS: Record<string, string> = {
  purchasing_structure: 'Purchasing structure',
  personal_details: 'Personal details',
  entity_details: 'Entity details',
  related_parties: 'Related parties',
  purchase_profile: 'Purchase profile',
  funding: 'Source of funds',
};

const DEFAULT_SECTION_ORDER: AmlSection[] = [
  'purchasing_structure', 'personal_details', 'purchase_profile', 'funding',
];

function buildSteps(sections: { section: AmlSection }[] | undefined): PortalStep[] {
  const sectionList = (sections?.length ? sections.map(s => s.section) : DEFAULT_SECTION_ORDER);
  return [
    { key: 'consent', label: 'Consent' },
    ...sectionList.map((s): PortalStep => ({
      key: s,
      label: SECTION_LABELS[s] ?? s.replace(/_/g, ' '),
      section: s,
    })),
    { key: 'documents', label: 'Documents' },
    { key: 'review', label: 'Review & submit' },
  ];
}

const CONSENT_VERSION = '1.0';

const CONSENT_STORAGE_PREFIX = 'aml_portal_consent:';
const RESUME_STORAGE_PREFIX = 'aml_portal_resume:';

function consentKey(caseId: string) { return `${CONSENT_STORAGE_PREFIX}${caseId}`; }
function resumeKey(caseId: string) { return `${RESUME_STORAGE_PREFIX}${caseId}`; }

export default function PortalAml() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AmlPortalOverview | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [consentedCaseId, setConsentedCaseId] = useState<string | null>(null);
  const resumedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await amlPortalApi.overview();
      setData(res);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to load AML onboarding');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const caseObj = data?.case ?? null;

  // Consent wall: consented if locally recorded OR any section has moved past not_started
  // (server-side gate enforces this; we mirror it in the UI to prevent bypass via stepper clicks).
  const consented = useMemo(() => {
    if (!caseObj) return false;
    if (consentedCaseId === caseObj.id) return true;
    try {
      if (localStorage.getItem(consentKey(caseObj.id)) === '1') return true;
    } catch { /* ignore */ }
    return (data?.sections ?? []).some(s => s.status && s.status !== 'not_started');
  }, [caseObj, consentedCaseId, data?.sections]);

  // Phase 5: the step list is derived from the server's applicable-section
  // list, so it can grow/shrink when the client changes purchasing structure
  // or funding sources. The current index is clamped against the live array.
  const steps = useMemo(() => buildSteps(data?.sections), [data?.sections]);

  // Resume: on first load, jump to the last section the user was on, or the first incomplete step.
  useEffect(() => {
    if (!caseObj || resumedRef.current || loading) return;
    resumedRef.current = true;
    if (!consented) { setStepIdx(0); return; }
    let target = 1;
    try {
      const saved = localStorage.getItem(resumeKey(caseObj.id));
      if (saved != null) {
        const n = Number(saved);
        if (Number.isFinite(n) && n >= 0 && n < steps.length) target = n;
      } else {
        const sections = data?.sections ?? [];
        const firstIncompleteIdx = steps.findIndex(s => {
          if (!s.section) return false;
          const st = sections.find(x => x.section === s.section)?.status;
          return !['submitted', 'accepted', 'complete'].includes(st ?? '');
        });
        if (firstIncompleteIdx > 0) target = firstIncompleteIdx;
      }
    } catch { /* ignore */ }
    setStepIdx(target);
  }, [caseObj, consented, data?.sections, loading, steps]);

  // Persist current step for resume
  useEffect(() => {
    if (!caseObj) return;
    try { localStorage.setItem(resumeKey(caseObj.id), String(stepIdx)); } catch { /* ignore */ }
  }, [caseObj, stepIdx]);

  const safeSetStep = useCallback((i: number) => {
    if (!consented && i !== 0) {
      toast.error('Please confirm the consents first.');
      return;
    }
    setStepIdx(i);
  }, [consented]);

  const step = steps[Math.min(stepIdx, steps.length - 1)];

  const progressPct = useMemo(() => {
    if (!data?.sections) return 0;
    const doneSections = data.sections.filter(s => ['submitted', 'accepted', 'complete'].includes(s.status)).length;
    const totalSections = data.sections.length || 1;
    const reqPct = data.requirement_progress?.total
      ? data.requirement_progress.completed / data.requirement_progress.total
      : 0;
    return Math.round(((doneSections / totalSections) * 0.6 + reqPct * 0.4) * 100);
  }, [data]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-brand-500" /> Identity & Compliance
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Complete your AML/CTF onboarding so your advisor can proceed with your purchase.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-96" />
        </div>
      ) : !caseObj ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {data?.message ?? 'Your advisor hasn’t opened an AML onboarding case for you yet. You’ll be notified when it’s ready.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-brand-500/30 bg-brand-500/5">
            <CardContent className="py-4 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[220px]">
                <div className="text-xs text-muted-foreground">Case reference</div>
                <div className="font-medium">{caseObj.reference}</div>
              </div>
              <div className="flex-1 min-w-[180px]">
                <div className="text-xs text-muted-foreground">Status</div>
                <Badge variant={caseObj.status_tone === 'positive' ? 'default' : 'outline'} className="mt-1">
                  {caseObj.status_label}
                </Badge>
              </div>
              <div className="flex-[2] min-w-[240px]">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Overall progress</span><span>{progressPct}%</span>
                </div>
                <Progress value={progressPct} className="h-2" />
              </div>
            </CardContent>
          </Card>

          {!consented && (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Consent required to continue</AlertTitle>
              <AlertDescription>
                Please review and confirm the consents below before completing the rest of the onboarding.
                Your progress is saved automatically as you go.
              </AlertDescription>
            </Alert>
          )}

          <Stepper
            steps={steps}
            currentIdx={Math.min(stepIdx, steps.length - 1)}
            onSelect={safeSetStep}
            sections={data?.sections ?? []}
            consented={consented}
          />

          <div className="min-h-[300px]">
            {step.key === 'consent' && (
              <ConsentStep
                caseId={caseObj.id}
                onDone={() => {
                  try { localStorage.setItem(consentKey(caseObj.id), '1'); } catch { /* ignore */ }
                  setConsentedCaseId(caseObj.id);
                  setStepIdx(1);
                }}
              />
            )}
            {step.section && consented && (
              <QuestionnaireStep
                key={step.key}
                caseId={caseObj.id}
                section={step.section}
                title={step.label}
                structureType={data?.structure_type ?? null}
                onSaved={load}
                onNext={() => setStepIdx(i => Math.min(steps.length - 1, i + 1))}
                onBack={() => setStepIdx(i => Math.max(0, i - 1))}
              />
            )}
            {step.key === 'documents' && consented && (
              <DocumentsStep
                caseId={caseObj.id}
                requirements={data?.requirements ?? []}
                onChange={load}
                onNext={() => setStepIdx(i => i + 1)}
                onBack={() => setStepIdx(i => i - 1)}
              />
            )}
            {step.key === 'review' && consented && (
              <ReviewStep
                overview={data}
                caseId={caseObj.id}
                onBack={() => setStepIdx(i => i - 1)}
                onSubmitted={load}
              />
            )}
          </div>

          {(data?.open_requests?.length ?? 0) > 0 && (
            <OpenRequestsCard requests={data!.open_requests!} onDone={load} />
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────  Stepper  ──────────────────────── */

function Stepper({
  steps, currentIdx, onSelect, sections, consented,
}: {
  steps: PortalStep[]; currentIdx: number; onSelect: (i: number) => void;
  sections: { section: AmlSection; status: string }[];
  consented: boolean;
}) {
  const statusFor = (s?: AmlSection) => sections.find(x => x.section === s)?.status;
  return (
    <ol className="flex flex-wrap gap-2">
      {steps.map((s, i) => {
        const st = statusFor(s.section);
        const done = st === 'submitted' || st === 'accepted' || st === 'complete';
        const active = i === currentIdx;
        const locked = !consented && i !== 0;
        return (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              disabled={locked}
              aria-disabled={locked}
              title={locked ? 'Confirm consents to unlock' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition',
                active ? 'border-brand-500 bg-brand-500/10 text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
                locked && 'opacity-50 cursor-not-allowed hover:text-muted-foreground',
              )}
            >
              <span className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold',
                done
                  ? 'bg-success text-success-foreground'
                  : active
                    ? 'bg-brand text-brand-foreground'
                    : 'bg-muted text-muted-foreground',
              )}>
                {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
              </span>
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );

}

/* ─────────────────────────  Consent  ──────────────────────── */

function ConsentStep({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const [checked, setChecked] = useState({ identity: false, aml: false, privacy: false });
  const [saving, setSaving] = useState(false);
  const allChecked = checked.identity && checked.aml && checked.privacy;

  const submit = async () => {
    setSaving(true);
    try {
      await Promise.all([
        amlPortalApi.recordConsent(caseId, 'identity_verification', CONSENT_VERSION, checked),
        amlPortalApi.recordConsent(caseId, 'aml_ctf_program', CONSENT_VERSION, checked),
        amlPortalApi.recordConsent(caseId, 'privacy_notice', CONSENT_VERSION, checked),
      ]);
      toast.success('Consents recorded');
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to record consent');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consents & disclosures</CardTitle>
        <CardDescription>Please read and confirm each item before continuing.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {[
          { key: 'identity' as const, title: 'Identity verification', body: 'You consent to your identity being verified electronically or via certified documents in line with the AUSTRAC AML/CTF Act 2006 and Rules.' },
          { key: 'aml' as const, title: 'AML/CTF program', body: 'You acknowledge that additional questions and documents may be requested to satisfy customer due diligence and ongoing monitoring obligations.' },
          { key: 'privacy' as const, title: 'Privacy notice', body: 'You consent to the collection, use and disclosure of your personal information for AML/CTF and related regulatory purposes, in accordance with our Privacy Policy.' },
        ].map(item => (
          <label key={item.key} className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
            <Checkbox
              checked={checked[item.key]}
              onCheckedChange={(v) => setChecked(prev => ({ ...prev, [item.key]: !!v }))}
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium">{item.title}</div>
              <p className="text-xs text-muted-foreground mt-1">{item.body}</p>
            </div>
          </label>
        ))}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!allChecked || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            I confirm — continue <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────  Questionnaire  ────────────────────── */

function QuestionnaireStep({
  caseId, section, title, structureType, onSaved, onNext, onBack,
}: {
  caseId: string; section: AmlSection; title: string;
  structureType?: string | null;
  onSaved: () => void; onNext: () => void; onBack: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [status, setStatus] = useState<string>('not_started');
  const dirtyRef = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAutosaveRef = useRef<Promise<void>>(Promise.resolve());
  const formRef = useRef(form);
  formRef.current = form;
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    dirtyRef.current = false;
    amlPortalApi.getQuestionnaire(caseId, section)
      .then(r => {
        if (!alive) return;
        setForm(r.response?.payload ?? {});
        setStatus(r.response?.status ?? 'not_started');
        setLastSavedAt(r.response?.updated_at ? new Date(r.response.updated_at) : null);
      })
      .catch((e) => toast.error(e?.message ?? 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [caseId, section]);

  const persistDraft = useCallback(async () => {
    pendingAutosaveRef.current = pendingAutosaveRef.current.then(async () => {
      // Never overwrite a submitted/accepted section from the autosaver
      if (['submitted', 'accepted', 'complete'].includes(statusRef.current)) return;
      setAutosaving(true);
      try {
        await amlPortalApi.saveQuestionnaire(caseId, section, formRef.current, false);
        dirtyRef.current = false;
        setLastSavedAt(new Date());
        if (statusRef.current === 'not_started') setStatus('draft');
      } catch {
        // silent — user can still hit Save/Submit manually
      } finally {
        setAutosaving(false);
      }
    });
    await pendingAutosaveRef.current;
  }, [caseId, section]);

  const set = (k: string, v: any) => {
    setForm(prev => ({ ...prev, [k]: v }));
    dirtyRef.current = true;
    if (['submitted', 'accepted', 'complete'].includes(statusRef.current)) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { void persistDraft(); }, 1200);
  };

  // Flush pending autosave on unmount / step change
  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      if (dirtyRef.current && !['submitted', 'accepted', 'complete'].includes(statusRef.current)) {
        void amlPortalApi.saveQuestionnaire(caseId, section, formRef.current, false).catch(() => { /* silent */ });
      }
    };
  }, [caseId, section]);

  const save = async (submit: boolean) => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setSaving(true);
    try {
      // Serialize manual saves after any draft request that has already started.
      await pendingAutosaveRef.current;
      await amlPortalApi.saveQuestionnaire(caseId, section, form, submit);
      dirtyRef.current = false;
      setLastSavedAt(new Date());
      toast.success(submit ? 'Section submitted' : 'Draft saved');
      setStatus(submit ? 'submitted' : 'draft');
      onSaved();
      if (submit) onNext();
    } catch (e: any) {
      toast.error(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const savedLabel = lastSavedAt
    ? `Saved ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Not saved yet';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{title}</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {autosaving ? 'Autosaving…' : savedLabel}
            </span>
            <Badge variant="outline" className="capitalize">{status.replace(/_/g, ' ')}</Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <Skeleton className="h-40" /> : (
          <>
            {section === 'personal_details' && <PersonalDetailsForm value={form} set={set} />}
            {section === 'purchasing_structure' && <PurchasingStructureForm value={form} set={set} />}
            {section === 'entity_details' && <EntityDetailsForm value={form} set={set} structureType={structureType} />}
            {section === 'related_parties' && <RelatedPartiesForm value={form} set={set} structureType={structureType} />}
            {section === 'purchase_profile' && <PurchaseProfileForm value={form} set={set} />}
            {section === 'funding' && <FundingForm value={form} set={set} />}

            <Separator />
            <div className="flex justify-between">
              <Button variant="outline" onClick={onBack}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => save(false)} disabled={saving}>
                  Save draft
                </Button>
                <Button onClick={() => save(true)} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Submit section <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}


/* ─────────────────  Section-specific forms  ────────────────── */

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children}
    </div>
  );
}

function PersonalDetailsForm({ value, set }: { value: any; set: (k: string, v: any) => void }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Field label="Legal full name" required>
        <Input value={value.full_name ?? ''} onChange={e => set('full_name', e.target.value)} />
      </Field>
      <Field label="Date of birth" required>
        <Input type="date" value={value.dob ?? ''} onChange={e => set('dob', e.target.value)} />
      </Field>
      <Field label="Country of citizenship" required>
        <Input value={value.citizenship ?? ''} onChange={e => set('citizenship', e.target.value)} />
      </Field>
      <Field label="Country of tax residency" required>
        <Input value={value.tax_residency ?? ''} onChange={e => set('tax_residency', e.target.value)} />
      </Field>
      <Field label="Residential address" required>
        <Textarea rows={2} value={value.address ?? ''} onChange={e => set('address', e.target.value)} />
      </Field>
      <Field label="Occupation & employer" required>
        <Textarea rows={2} value={value.occupation ?? ''} onChange={e => set('occupation', e.target.value)} />
      </Field>
      <div className="md:col-span-2 grid md:grid-cols-2 gap-4">
        <Field label="Are you a Politically Exposed Person (PEP)?" required>
          <RadioGroup value={value.pep ?? ''} onValueChange={v => set('pep', v)} className="flex gap-4">
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="no" /> No</label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="yes" /> Yes</label>
          </RadioGroup>
        </Field>
        <Field label="Any adverse media or sanctions concerns?" required>
          <RadioGroup value={value.adverse ?? ''} onValueChange={v => set('adverse', v)} className="flex gap-4">
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="no" /> No</label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="yes" /> Yes</label>
          </RadioGroup>
        </Field>
      </div>
    </div>
  );
}

function PurchasingStructureForm({ value, set }: { value: any; set: (k: string, v: any) => void }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Field label="Purchasing entity type" required>
        <RadioGroup value={value.entity_type ?? ''} onValueChange={v => set('entity_type', v)} className="grid grid-cols-2 gap-2">
          {['Individual', 'Joint', 'Company', 'Trust', 'SMSF', 'Partnership'].map(t => (
            <label key={t} className="flex items-center gap-2 text-sm border rounded-md p-2 cursor-pointer">
              <RadioGroupItem value={t} /> {t}
            </label>
          ))}
        </RadioGroup>
        {value.entity_type && value.entity_type !== 'Individual' && (
          <p className="text-xs text-muted-foreground mt-2" role="status">
            Based on this choice, extra steps will appear in your checklist
            {value.entity_type === 'Joint'
              ? ' to add your co-purchaser(s).'
              : ' for entity details and the people connected to it.'}
          </p>
        )}
      </Field>
      <Field label="Entity legal name (if not individual)">
        <Input value={value.entity_name ?? ''} onChange={e => set('entity_name', e.target.value)} />
      </Field>
      <Field label="ABN / ACN (if applicable)">
        <Input value={value.abn_acn ?? ''} onChange={e => set('abn_acn', e.target.value)} />
      </Field>
      <Field label="Trustee / Director names">
        <Textarea rows={2} value={value.controllers ?? ''} onChange={e => set('controllers', e.target.value)} />
      </Field>
      <Field label="Beneficial owners (>25% control)">
        <Textarea rows={3} value={value.beneficial_owners ?? ''} onChange={e => set('beneficial_owners', e.target.value)} />
      </Field>
      <Field label="Registered address">
        <Textarea rows={2} value={value.registered_address ?? ''} onChange={e => set('registered_address', e.target.value)} />
      </Field>
    </div>
  );
}

/**
 * Phase 5 — entity specifics for company / trust / SMSF / partnership
 * purchasers (directive §14.2). Which field groups show depends on the
 * declared structure; everything is saved into the one section payload.
 */
function EntityDetailsForm({ value, set, structureType }: {
  value: any; set: (k: string, v: any) => void; structureType?: string | null;
}) {
  const isTrustLike = structureType === 'Trust' || structureType === 'SMSF';
  const isSmsf = structureType === 'SMSF';
  return (
    <div className="space-y-6">
      <fieldset className="grid md:grid-cols-2 gap-4">
        <legend className="text-sm font-medium mb-2">Registration</legend>
        <Field label="Entity legal name" required>
          <Input value={value.entity_name ?? ''} onChange={e => set('entity_name', e.target.value)} />
        </Field>
        <Field label="ABN / ACN" required>
          <Input value={value.abn_acn ?? ''} onChange={e => set('abn_acn', e.target.value)} />
        </Field>
        <Field label="Country and state of registration" required>
          <Input value={value.registration_place ?? ''} onChange={e => set('registration_place', e.target.value)} placeholder="e.g. Australia — NSW" />
        </Field>
        <Field label="Registered address" required>
          <Textarea rows={2} value={value.registered_address ?? ''} onChange={e => set('registered_address', e.target.value)} />
        </Field>
        <Field label="Nature of business / purpose">
          <Textarea rows={2} value={value.business_nature ?? ''} onChange={e => set('business_nature', e.target.value)} />
        </Field>
      </fieldset>

      {isTrustLike && (
        <fieldset className="grid md:grid-cols-2 gap-4">
          <legend className="text-sm font-medium mb-2">{isSmsf ? 'Fund' : 'Trust'} specifics</legend>
          <Field label={isSmsf ? 'Fund establishment date' : 'Trust deed date'} required>
            <Input type="date" value={value.deed_date ?? ''} onChange={e => set('deed_date', e.target.value)} />
          </Field>
          <Field label="Trustee type" required>
            <RadioGroup value={value.trustee_type ?? ''} onValueChange={v => set('trustee_type', v)} className="flex gap-4">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="individual" /> Individual(s)</label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="corporate" /> Corporate</label>
            </RadioGroup>
          </Field>
          {value.trustee_type === 'corporate' && (
            <Field label="Corporate trustee name and ACN" required>
              <Input value={value.corporate_trustee ?? ''} onChange={e => set('corporate_trustee', e.target.value)} />
            </Field>
          )}
          {!isSmsf && (
            <Field label="Appointor / protector (if any)">
              <Input value={value.appointor ?? ''} onChange={e => set('appointor', e.target.value)} />
            </Field>
          )}
          {isSmsf && (
            <Field label="Is the purchase using a limited recourse borrowing arrangement (LRBA)?" required>
              <RadioGroup value={value.lrba ?? ''} onValueChange={v => set('lrba', v)} className="flex gap-4">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="no" /> No</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="yes" /> Yes</label>
              </RadioGroup>
            </Field>
          )}
        </fieldset>
      )}
    </div>
  );
}

const PARTY_ROLES = [
  'Co-purchaser', 'Director', 'Trustee', 'Beneficial owner', 'Beneficiary',
  'Authorised representative', 'Donor (gift)', 'Private lender', 'Other',
] as const;

type PartyRow = {
  role?: string; full_name?: string; dob?: string; email?: string; relationship?: string;
};

/**
 * Phase 5 — structured related-party collection (directive §14.3): joint
 * applicants, directors, trustees, beneficial owners, representatives, donors
 * and private lenders, captured as repeatable rows the reviewing analyst can
 * reconcile into canonical party records.
 */
function RelatedPartiesForm({ value, set, structureType }: {
  value: any; set: (k: string, v: any) => void; structureType?: string | null;
}) {
  const parties: PartyRow[] = Array.isArray(value.parties) ? value.parties : [];
  const update = (idx: number, patch: Partial<PartyRow>) => {
    const next = parties.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    set('parties', next);
  };
  const add = () => set('parties', [...parties, {}]);
  const remove = (idx: number) => set('parties', parties.filter((_, i) => i !== idx));

  const hint =
    structureType === 'Joint' ? 'Add each co-purchaser. Everyone named on the contract needs to be listed.'
    : structureType && structureType !== 'Individual'
      ? 'Add every director, trustee, beneficiary and anyone who owns or controls 25% or more, plus any authorised representatives.'
      : 'Add anyone else connected to this purchase — for example the person giving a gift or providing a private loan.';

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{hint}</p>

      {parties.length === 0 && (
        <p className="text-sm text-muted-foreground border border-dashed rounded-md p-4 text-center">
          No people added yet. Use “Add person” below.
        </p>
      )}

      {parties.map((p, i) => (
        <fieldset key={i} className="rounded-md border p-4 space-y-4">
          <legend className="text-sm font-medium px-1">Person {i + 1}</legend>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Role" required>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={p.role ?? ''}
                onChange={e => update(i, { role: e.target.value })}
                aria-label={`Role for person ${i + 1}`}
              >
                <option value="" disabled>Select a role…</option>
                {PARTY_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Legal full name" required>
              <Input value={p.full_name ?? ''} onChange={e => update(i, { full_name: e.target.value })} />
            </Field>
            <Field label="Date of birth">
              <Input type="date" value={p.dob ?? ''} onChange={e => update(i, { dob: e.target.value })} />
            </Field>
            <Field label="Email (for identity verification)">
              <Input type="email" value={p.email ?? ''} onChange={e => update(i, { email: e.target.value })} />
            </Field>
            <Field label="Relationship to you / ownership %">
              <Input value={p.relationship ?? ''} onChange={e => update(i, { relationship: e.target.value })} placeholder="e.g. Spouse · 50% shareholder" />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)}>
              Remove person {i + 1}
            </Button>
          </div>
        </fieldset>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={add}>
        Add person
      </Button>
    </div>
  );
}

function PurchaseProfileForm({ value, set }: { value: any; set: (k: string, v: any) => void }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Field label="Purpose of purchase" required>
        <RadioGroup value={value.purpose ?? ''} onValueChange={v => set('purpose', v)} className="grid grid-cols-2 gap-2">
          {['Owner-occupier', 'Investment', 'Business use', 'Development'].map(t => (
            <label key={t} className="flex items-center gap-2 text-sm border rounded-md p-2 cursor-pointer">
              <RadioGroupItem value={t} /> {t}
            </label>
          ))}
        </RadioGroup>
      </Field>
      <Field label="Target price range (AUD)" required>
        <Input value={value.price_range ?? ''} onChange={e => set('price_range', e.target.value)} placeholder="e.g. 750,000 – 900,000" />
      </Field>
      <Field label="Target location(s)">
        <Textarea rows={2} value={value.locations ?? ''} onChange={e => set('locations', e.target.value)} />
      </Field>
      <Field label="Property type(s) of interest">
        <Input value={value.property_types ?? ''} onChange={e => set('property_types', e.target.value)} placeholder="House, unit, townhouse…" />
      </Field>
      <Field label="Expected settlement timeframe">
        <Input value={value.timeframe ?? ''} onChange={e => set('timeframe', e.target.value)} placeholder="e.g. 60–90 days" />
      </Field>
      <Field label="Is any part of this purchase for a third party?" required>
        <RadioGroup value={value.third_party ?? ''} onValueChange={v => set('third_party', v)} className="flex gap-4">
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="no" /> No</label>
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="yes" /> Yes</label>
        </RadioGroup>
      </Field>
    </div>
  );
}

function FundingForm({ value, set }: { value: any; set: (k: string, v: any) => void }) {
  const sources: string[] = value.sources ?? [];
  const toggle = (s: string) => {
    const next = sources.includes(s) ? sources.filter(x => x !== s) : [...sources, s];
    set('sources', next);
  };
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Source(s) of funds <span className="text-destructive">*</span></Label>
        <div className="grid md:grid-cols-3 gap-2 mt-2">
          {['Salary savings', 'Business income', 'Sale of asset', 'Inheritance', 'Gift', 'Investment returns', 'Superannuation', 'Loan / mortgage', 'Other'].map(s => (
            <label key={s} className="flex items-center gap-2 text-sm border rounded-md p-2 cursor-pointer">
              <Checkbox checked={sources.includes(s)} onCheckedChange={() => toggle(s)} /> {s}
            </label>
          ))}
        </div>
      </div>
      <Field label="Estimated deposit amount (AUD)" required>
        <Input value={value.deposit ?? ''} onChange={e => set('deposit', e.target.value)} />
      </Field>
      <Field label="Describe how these funds were accumulated" required>
        <Textarea rows={4} value={value.narrative ?? ''} onChange={e => set('narrative', e.target.value)} />
      </Field>
      <Field label="Financial institution(s) holding the funds">
        <Input value={value.institutions ?? ''} onChange={e => set('institutions', e.target.value)} />
      </Field>
      <Field label="Any funds sourced from overseas?" required>
        <RadioGroup value={value.overseas ?? ''} onValueChange={v => set('overseas', v)} className="flex gap-4">
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="no" /> No</label>
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="yes" /> Yes</label>
        </RadioGroup>
      </Field>
    </div>
  );
}

/* ─────────────────────────  Documents  ──────────────────────── */

function DocumentsStep({
  caseId, requirements, onChange, onNext, onBack,
}: {
  caseId: string; requirements: any[]; onChange: () => void;
  onNext: () => void; onBack: () => void;
}) {
  const inputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploading, setUploading] = useState<string | null>(null);

  const handleUpload = async (reqId: string | null, file: File | undefined) => {
    if (!file) return;
    setUploading(reqId ?? 'freeform');
    try {
      await uploadAmlDocument(caseId, file, reqId);
      toast.success('Uploaded');
      onChange();
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const missing = requirements.filter(r => r.required && !['uploaded', 'accepted'].includes(r.status));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>Upload the items your advisor has requested. Accepted formats: PDF, JPG, PNG (≤ 25 MB).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {requirements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No document requirements have been set yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {requirements.map(r => {
              const done = ['uploaded', 'accepted'].includes(r.status);
              const rejected = r.status === 'rejected';
              return (
                <li key={r.id} className="py-3 flex items-start gap-3">
                  <div className={cn(
                    'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
                    done ? 'bg-success/15 text-success' :
                    rejected ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground',
                  )}>
                    {done ? <CheckCircle2 className="h-4 w-4" /> : rejected ? <AlertTriangle className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{r.label}</p>
                      {r.required && <Badge variant="outline" className="text-[10px]">Required</Badge>}
                      <Badge variant="outline" className="text-[10px] capitalize">{r.status.replace(/_/g, ' ')}</Badge>
                    </div>
                    {r.description && <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>}
                  </div>
                  <input
                    ref={el => (inputRef.current[r.id] = el)}
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={e => handleUpload(r.id, e.target.files?.[0])}
                  />
                  <Button
                    size="sm" variant={done ? 'outline' : 'default'}
                    onClick={() => inputRef.current[r.id]?.click()}
                    disabled={uploading === r.id}
                  >
                    {uploading === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="h-4 w-4 mr-1" /> {done ? 'Replace' : 'Upload'}</>}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <Separator />
        <div>
          <Label className="text-xs">Upload additional document</Label>
          <div className="mt-2 flex items-center gap-2">
            <input
              ref={el => (inputRef.current['freeform'] = el)}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={e => handleUpload(null, e.target.files?.[0])}
            />
            <Button variant="outline" onClick={() => inputRef.current['freeform']?.click()} disabled={uploading === 'freeform'}>
              {uploading === 'freeform' ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="h-4 w-4 mr-1" /> Choose file</>}
            </Button>
          </div>
        </div>

        {missing.length > 0 && (
          <Alert>
            <Clock className="h-4 w-4" />
            <AlertTitle>{missing.length} required document{missing.length === 1 ? '' : 's'} still outstanding</AlertTitle>
            <AlertDescription>You can still continue and submit later once uploads are complete.</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          <Button onClick={onNext}>Continue <ArrowRight className="h-4 w-4 ml-1" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────  Review  ──────────────────────── */

function ReviewStep({
  overview, caseId, onBack, onSubmitted,
}: { overview: AmlPortalOverview | null; caseId: string; onBack: () => void; onSubmitted: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const sections = overview?.sections ?? [];
  const reqs = overview?.requirements ?? [];
  const missingSections = sections.filter(s => !['submitted', 'accepted', 'complete'].includes(s.status));
  const missingReqs = reqs.filter(r => r.required && !['uploaded', 'accepted'].includes(r.status));
  const canSubmit = missingSections.length === 0 && missingReqs.length === 0;

  const submit = async () => {
    setSubmitting(true);
    try {
      await amlPortalApi.submitForReview(caseId);
      toast.success('Submitted for review — your advisor has been notified.');
      onSubmitted();
    } catch (e: any) {
      toast.error(e?.message ?? 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review & submit</CardTitle>
        <CardDescription>Confirm everything is complete, then submit your onboarding pack for review.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          {sections.map(s => (
            <div key={s.section} className="flex items-center justify-between border rounded-md px-3 py-2">
              <span className="text-sm capitalize">{s.section.replace(/_/g, ' ')}</span>
              <Badge variant="outline" className="capitalize">{s.status.replace(/_/g, ' ')}</Badge>
            </div>
          ))}
        </div>

        {(missingSections.length > 0 || missingReqs.length > 0) && (
          <Alert variant="default">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Not quite ready</AlertTitle>
            <AlertDescription>
              {missingSections.length > 0 && <div>{missingSections.length} section(s) not yet submitted.</div>}
              {missingReqs.length > 0 && <div>{missingReqs.length} required document(s) missing.</div>}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          <Button onClick={submit} disabled={!canSubmit || submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Send className="h-4 w-4 mr-1" /> Submit for review
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ────────────────────  Open information requests  ─────────────────── */

function OpenRequestsCard({ requests, onDone }: { requests: any[]; onDone: () => void }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const respond = async (id: string) => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await amlPortalApi.respondRequest(id, { response: text.trim() });
      toast.success('Response sent');
      setActiveId(null); setText('');
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-warning/30 bg-warning/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Information requests from your advisor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {requests.map(r => (
          <div key={r.id} className="rounded-md border p-3 bg-background/40">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{r.subject ?? 'Additional information required'}</p>
              <Badge variant="outline" className="capitalize">{r.status}</Badge>
            </div>
            {r.message && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{r.message}</p>}
            {activeId === r.id ? (
              <div className="mt-2 space-y-2">
                <Textarea rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Your response…" />
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => { setActiveId(null); setText(''); }}>Cancel</Button>
                  <Button size="sm" onClick={() => respond(r.id)} disabled={saving || !text.trim()}>
                    {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Send
                  </Button>
                </div>
              </div>
            ) : (
              r.status === 'open' && (
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => setActiveId(r.id)}>Respond</Button>
                </div>
              )
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
