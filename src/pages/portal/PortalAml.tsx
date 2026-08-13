import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, CheckCircle2, Clock, AlertTriangle, Lock, Upload, FileText, ArrowRight, ArrowLeft, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { PassportPromoCard } from '@/components/portal/PassportPromoCard';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import {
  amlPortalApi, uploadAmlDocument,
  type AmlPortalOverview, type AmlSection, type AmlConsentDocument,
} from '@/lib/aml/amlPortalApi';
import { IdentityVerificationStep } from '@/components/portal/IdentityVerificationStep';
// Lifted out of this file so it can be tested on its own — it now reads the
// canonical document list rather than rendering requirements alone.
import { DocumentsStep } from '@/components/portal/DocumentsStep';
import { ClientJourneyStrip } from '@/components/portal/ClientJourneyStrip';
import { resolveRequestStep, type IdvAvailability } from '@/lib/aml/portalRequestRoute';
// One canonical journey drives the stepper, the progress figure, the resume
// target and the review summary. Presentation only — the truth is the server's.
import {
  buildPortalStepStates, initialStepIndex, onboardingStatusPresentation, portalProgress,
  type PortalStepState, type PortalStepTone,
} from '@/lib/aml/portalStepPresentation';

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
    { key: 'verify', label: 'Verify identity' },
    { key: 'review', label: 'Review & submit' },
  ];
}

const RESUME_STORAGE_PREFIX = 'aml_portal_resume:';

function resumeKey(caseId: string) { return `${RESUME_STORAGE_PREFIX}${caseId}`; }

export default function PortalAml() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AmlPortalOverview | null>(null);
  // A failed load is NOT the same as "no case exists". Rendering the no-case
  // empty state on error told clients their advisor had done nothing while
  // the real problem was a broken call — keep the two states separate.
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  // Client-safe readiness ('available' | 'temporarily_unavailable' |
  // 'manual_verification_required'). Needed here, not just inside the capture
  // step, because it decides which step an identity request opens at all.
  const [idvAvailability, setIdvAvailability] = useState<IdvAvailability | null>(null);
  /**
   * A background re-read failed while a good page was already on screen.
   *
   * Deliberately not `loadFailed`: that one replaces the whole portal, which
   * is the right answer when there is nothing to replace and the wrong answer
   * when the customer is halfway through a step. This is a line of text.
   */
  const [refreshFailed, setRefreshFailed] = useState(false);
  const resumedRef = useRef(false);

  /**
   * ## Initial load and background refresh are not the same operation
   *
   * They used to be one `load()` that set `loading = true`, and the render
   * swaps the entire portal for skeletons while that is set. So every refresh
   * — a document upload, a questionnaire save, an identity state change —
   * unmounted the step the customer was standing in.
   *
   * With identity verification that became an infinite loop: the step read a
   * check that was already in flight, told the page, the page blanked itself,
   * the step unmounted and forgot what it had seen, remounted, read the same
   * state, and told the page again. The portal blinked until the customer
   * gave up. Both halves are fixed — the step no longer reports its baseline
   * (see IdentityVerificationStep), and a refresh no longer blanks the page.
   *
   * A refresh may update the page. It may never erase it.
   */
  const requestToken = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const trailingRef = useRef(false);

  /**
   * One canonical read. `foreground` decides only what a FAILURE does — the
   * request is identical either way.
   *
   * The token makes the newest response win: a slow first read must never
   * land on top of a fresher one triggered by something the customer just did.
   */
  const readOverview = useCallback(async (foreground: boolean) => {
    const token = ++requestToken.current;
    try {
      const res = await amlPortalApi.overview();
      if (token !== requestToken.current) return;
      setData(res);
      setLoadFailed(null);
      setRefreshFailed(false);
    } catch (e: any) {
      if (token !== requestToken.current) return;
      if (foreground) {
        setLoadFailed(e?.message ?? 'Failed to load AML onboarding');
        toast.error(e?.message ?? 'Failed to load AML onboarding');
      } else {
        // Keep the last known-good page. A failed background read is not a
        // reason to tell somebody their case has vanished.
        setRefreshFailed(true);
      }
    }
  }, []);

  /** First paint, and the explicit retry from the failure card. */
  const loadInitial = useCallback(async () => {
    setLoading(true);
    setLoadFailed(null);
    try { await readOverview(true); } finally { setLoading(false); }
  }, [readOverview]);

  /**
   * Re-read the canonical overview underneath the customer.
   *
   * Coalesced: concurrent callers (an upload landing while an identity change
   * is announced) share the in-flight read, and one trailing read follows so
   * the later event is never answered with data fetched before it. No
   * skeleton, no unmount, no polling.
   */
  const refreshOverview = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) {
      trailingRef.current = true;
      return inFlightRef.current;
    }
    const run = async () => {
      await readOverview(false);
      if (trailingRef.current) {
        trailingRef.current = false;
        await readOverview(false);
      }
    };
    const promise = run().finally(() => { inFlightRef.current = null; });
    inFlightRef.current = promise;
    return promise;
  }, [readOverview]);

  useEffect(() => { void loadInitial(); }, [loadInitial]);

  // Readiness is advisory to the UI and never a gate on requesting anything;
  // an unknown value resolves identity requests to the manual route, which
  // always works.
  useEffect(() => {
    const id = data?.case?.id;
    if (!id) return;
    let alive = true;
    amlPortalApi.verificationStatus(id)
      .then((s) => { if (alive) setIdvAvailability((s as any)?.availability ?? null); })
      .catch(() => { if (alive) setIdvAvailability(null); });
    return () => { alive = false; };
  }, [data?.case?.id]);

  const caseObj = data?.case ?? null;

  // Consent wall. The server owns this: every op that collects client data
  // re-checks acceptance of the current catalogue version, so this flag is a
  // mirror for navigation only, never the control itself. It used to be a
  // localStorage flag, which meant the wall was decoration.
  const consented = data?.consent?.satisfied ?? false;

  // Phase 5: the step list is derived from the server's applicable-section
  // list, so it can grow/shrink when the client changes purchasing structure
  // or funding sources. The current index is clamped against the live array.
  const steps = useMemo(() => buildSteps(data?.sections), [data?.sections]);

  /**
   * Every visible step, resolved against the ONE canonical journey.
   *
   * Questionnaire children keep their own section status; consent, documents,
   * identity and submission come from `overview.journey`. Nothing below this
   * line decides for itself whether something is finished.
   */
  const stepStates = useMemo(() => buildPortalStepStates({
    steps,
    journey: data?.journey,
    sections: data?.sections ?? [],
    consentSatisfied: consented,
  }), [steps, data?.journey, data?.sections, consented]);

  // Resume: the stored step wins while it is still meaningful; a stale one —
  // already complete, out of range, or written before the client consented —
  // loses to the canonical journey.
  useEffect(() => {
    if (!caseObj || resumedRef.current || loading || stepStates.length === 0) return;
    resumedRef.current = true;
    let stored: number | null = null;
    try {
      const saved = localStorage.getItem(resumeKey(caseObj.id));
      if (saved != null) {
        const n = Number(saved);
        if (Number.isFinite(n)) stored = n;
      }
    } catch { /* ignore */ }
    setStepIdx(initialStepIndex({ states: stepStates, storedIndex: stored, consentSatisfied: consented }));
  }, [caseObj, consented, loading, stepStates]);

  /**
   * Persist the current step for next time — but never before resume has read
   * it.
   *
   * `stepIdx` starts at 0, and there is a render where the case has arrived
   * and the resume decision has not been made yet. Writing in that window
   * overwrites the customer's stored step with 0 and then "resumes" them to
   * the answer it just destroyed. The guard is the fix; the ordering of the
   * two effects is not something to rely on.
   */
  useEffect(() => {
    if (!caseObj || !resumedRef.current) return;
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

  /**
   * Progress over the steps the client can see, and nothing else.
   *
   * The formula this replaced was 60% of questionnaire sections plus 40% of
   * required documents. It could not see consent, identity verification or
   * submission at all, and every case with no formal document requirements —
   * the common one — was capped at 60% no matter how much the client uploaded.
   */
  const progress = useMemo(() => portalProgress(stepStates), [stepStates]);

  // Presentation only — never written back, never a case-stage change.
  const onboardingStatus = useMemo(() => onboardingStatusPresentation({
    caseStatus: caseObj?.status,
    statusLabel: caseObj?.status_label,
    statusTone: caseObj?.status_tone,
    states: stepStates,
  }), [caseObj?.status, caseObj?.status_label, caseObj?.status_tone, stepStates]);

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
      ) : loadFailed ? (
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <ShieldCheck className="h-10 w-10 text-muted-foreground/50 mx-auto" />
            <p className="text-sm text-muted-foreground">
              We couldn’t load your onboarding details just now. This doesn’t affect
              anything your advisor has set up for you.
            </p>
            <Button variant="outline" size="sm" onClick={() => void loadInitial()}>
              Try again
            </Button>
            <p className="text-xs text-muted-foreground">
              If this keeps happening, please contact your adviser.
            </p>
          </CardContent>
        </Card>
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
                {/* "Onboarding status", because that is what the customer is
                    looking at. The case's own workflow label said "Not
                    started" over five completed steps. */}
                <div className="text-xs text-muted-foreground">Onboarding status</div>
                <Badge variant={onboardingStatus.tone === 'positive' ? 'default' : 'outline'} className="mt-1">
                  {onboardingStatus.label}
                </Badge>
              </div>
              <div className="flex-[2] min-w-[240px]">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Overall progress</span>
                  {/* The count is the honest figure and leads; the percentage
                      is there for the bar. "75%" alone never told anybody
                      which step they were missing. */}
                  <span>{progress.completed} of {progress.total} steps complete</span>
                </div>
                <Progress
                  value={progress.percent}
                  className="h-2"
                  aria-label={`${progress.completed} of ${progress.total} steps complete`}
                />
              </div>
            </CardContent>
          </Card>

          {/* The journey → Passport bridge. Renders nothing while the
              passport flag is off, so this page is unchanged until then. */}
          <PassportPromoCard />

          {refreshFailed && (
            // One line, and the page stays exactly where it was. This used to
            // be the full-page failure card, which threw away a step the
            // customer was halfway through because a background read timed out.
            <p
              role="status"
              className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              We couldn’t check for updates just now — what you can see may be a
              moment out of date. Nothing you have sent us is affected.
              <Button
                variant="link" size="sm" className="h-auto p-0 text-xs"
                onClick={() => void refreshOverview()}
              >
                Try again
              </Button>
            </p>
          )}

          {!consented && (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Consent required to continue</AlertTitle>
              <AlertDescription>
                We are required to give you a collection notice and obtain your consent before we
                collect and verify your identity information for AUSTRAC anti-money laundering
                purposes. Please review and confirm the items below. Your progress is saved
                automatically as you go.
              </AlertDescription>
            </Alert>
          )}

          <ClientJourneyStrip overview={data!} />

          <Stepper
            states={stepStates}
            currentIdx={Math.min(stepIdx, steps.length - 1)}
            onSelect={safeSetStep}
            consented={consented}
          />

          <div className="min-h-[300px]">
            {step.key === 'consent' && (
              <ConsentStep
                caseId={caseObj.id}
                onDone={async () => { await refreshOverview(); setStepIdx(1); }}
              />
            )}
            {step.section && consented && (
              <QuestionnaireStep
                key={step.key}
                caseId={caseObj.id}
                section={step.section}
                title={step.label}
                structureType={data?.structure_type ?? null}
                onSaved={refreshOverview}
                onNext={() => setStepIdx(i => Math.min(steps.length - 1, i + 1))}
                onBack={() => setStepIdx(i => Math.max(0, i - 1))}
              />
            )}
            {step.key === 'documents' && consented && (
              <DocumentsStep
                caseId={caseObj.id}
                requirements={data?.requirements ?? []}
                onChange={refreshOverview}
                onNext={() => setStepIdx(i => i + 1)}
                onBack={() => setStepIdx(i => i - 1)}
              />
            )}
            {step.key === 'verify' && consented && (
              <IdentityVerificationStep
                caseId={caseObj.id}
                onBack={() => setStepIdx(i => i - 1)}
                onNext={() => setStepIdx(i => i + 1)}
                onNeedsConsent={() => setStepIdx(0)}
                // The step refreshes its own verification state; the journey
                // that draws the stepper and the progress figure lives up
                // here. Without this the client could finish a check and watch
                // "Verify identity" stay grey until they reloaded the page.
                // It re-reads the SERVER — the child reports that something
                // moved, never what it moved to.
                onStatusChange={refreshOverview}
              />
            )}
            {step.key === 'review' && consented && (
              <ReviewStep
                overview={data}
                stepStates={stepStates}
                caseId={caseObj.id}
                onBack={() => setStepIdx(i => i - 1)}
                onSubmitted={refreshOverview}
              />
            )}
          </div>

          {(data?.open_requests?.length ?? 0) > 0 && (
            <OpenRequestsCard
              requests={data!.open_requests!}
              onDone={refreshOverview}
              availability={idvAvailability}
              onNavigate={(target, sectionCode) => {
                // Internal routing only: resolve the validated target to a
                // step index in the server-derived step list.
                const findIdx = (pred: (st: PortalStep) => boolean) => steps.findIndex(pred);
                let idx = -1;
                if (target === 'consent') idx = findIdx((st) => st.key === 'consent');
                else if (target === 'documents') idx = findIdx((st) => st.key === 'documents');
                else if (target === 'verify') idx = findIdx((st) => st.key === 'verify');
                else if (target === 'review') idx = findIdx((st) => st.key === 'review');
                else if (target === 'questionnaire') {
                  idx = sectionCode ? findIdx((st) => st.section === sectionCode) : -1;
                  if (idx < 0) idx = findIdx((st) => Boolean(st.section));
                }
                if (idx >= 0) {
                  safeSetStep(idx);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                  toast.error('That step is not available yet. Please contact your adviser.');
                }
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────  Stepper  ──────────────────────── */

/**
 * The status marker's colour, one per journey tone.
 *
 * Colour is never the only signal — the step's accessible name states it in
 * words, and complete, attention and blocked each carry a distinct glyph.
 */
const TONE_MARKER: Record<PortalStepTone, string> = {
  success:   'bg-success text-success-foreground',
  progress:  'bg-info text-info-foreground',
  attention: 'bg-warning text-warning-foreground',
  muted:     'bg-muted text-muted-foreground',
  blocked:   'bg-muted/60 text-muted-foreground',
};

function StepMarker({ state, index }: { state: PortalStepState; index: number }) {
  const { icon } = state.presentation;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
        TONE_MARKER[state.presentation.tone],
      )}
    >
      {icon === 'check' ? <CheckCircle2 className="h-3 w-3" />
        : icon === 'clock' ? <Clock className="h-3 w-3" />
        : icon === 'alert' ? <AlertTriangle className="h-3 w-3" />
        : icon === 'lock' ? <Lock className="h-3 w-3" />
        : index + 1}
    </span>
  );
}

/**
 * The visible stepper.
 *
 * Two things it now keeps apart that it used to conflate. **Where you are** is
 * the brand outline on the pill; **how far you have got** is the marker inside
 * it. A step can be both — Documents selected AND complete is a brand pill
 * around a green tick, and that is the correct rendering rather than a
 * contradiction.
 *
 * It also no longer wraps. `flex-wrap` left "Review & submit" orphaned on a
 * second line at every desktop width; one scrollable row keeps the journey
 * readable as a journey, on a phone as well as at 1440.
 */
function Stepper({
  states, currentIdx, onSelect, consented,
}: {
  states: PortalStepState[]; currentIdx: number; onSelect: (i: number) => void;
  consented: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLLIElement | null>(null);
  const scrolledForRef = useRef<number | null>(null);

  /**
   * Bring the client's own step into the row — and otherwise leave the row
   * alone.
   *
   * This was `element.scrollIntoView({ behavior: 'smooth' })`, which is the
   * wrong tool three times over. It scrolls every scrollable ancestor, so the
   * PAGE moved vertically; it re-centred whether or not the step was already
   * visible, so the row slid about and clipped its left end; and it ran again
   * on re-render, so a background journey refresh animated the stepper for no
   * reason.
   *
   * This scrolls the stepper's own container, by the smallest amount that
   * makes the step visible, only when the step actually changed, and only when
   * it is actually out of view. Reduced-motion gets no animation.
   */
  useEffect(() => {
    if (scrolledForRef.current === currentIdx) return;
    scrolledForRef.current = currentIdx;
    const scroller = scrollerRef.current;
    const el = activeRef.current;
    if (!scroller || !el || typeof scroller.scrollTo !== 'function') return;
    if (typeof el.getBoundingClientRect !== 'function') return;

    const step = el.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const PAD = 12;
    let delta = 0;
    if (step.left - PAD < box.left) delta = step.left - PAD - box.left;
    else if (step.right + PAD > box.right) delta = step.right + PAD - box.right;
    if (delta === 0) return;

    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({
      left: scroller.scrollLeft + delta,
      behavior: reduced ? 'auto' : 'smooth',
    });
  }, [currentIdx]);

  return (
    <div ref={scrollerRef} className="-mx-1 overflow-x-auto scrollbar-thin px-1 pb-1">
      <ol className="flex w-max min-w-full items-center gap-2">
        {states.map((state, i) => {
          const active = i === currentIdx;
          const locked = !consented && i !== 0;
          return (
            <li key={state.key} className="shrink-0" ref={active ? activeRef : undefined}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                disabled={locked}
                aria-disabled={locked}
                aria-current={active ? 'step' : undefined}
                // "Documents, complete" / "Verify identity, in progress,
                // current step". The state is never colour alone, and the
                // visible label leads the name so it still satisfies
                // label-in-name.
                aria-label={`${state.label}, ${state.presentation.accessibleStatus}${active ? ', current step' : ''}`}
                title={locked ? 'Confirm consents to unlock' : undefined}
                className={cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition',
                  active
                    ? 'border-brand-500 bg-brand-500/10 text-foreground'
                    : 'border-border/60 text-muted-foreground hover:text-foreground',
                  locked && 'opacity-50 cursor-not-allowed hover:text-muted-foreground',
                )}
              >
                <StepMarker state={state} index={i} />
                {state.label}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ─────────────────────────  Consent  ──────────────────────── */

/**
 * The wording, statutory basis and AUSTRAC references are served from
 * `aml.consent_documents` — they are NOT hard-coded here. That is deliberate:
 * an acceptance is only evidence if we can show the exact text the client saw,
 * and compliance wording has to be revisable without a frontend deploy.
 *
 * Items typed `consent` require an affirmative tick. Items typed `notice` are
 * disclosures the client acknowledges having read (for example the tipping-off
 * limitation, which is our obligation, not their choice).
 */
function ConsentStep({ caseId, onDone }: { caseId: string; onDone: () => void | Promise<void> }) {
  const [docs, setDocs] = useState<AmlConsentDocument[] | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    amlPortalApi.getConsents(caseId)
      .then(res => {
        if (!alive) return;
        setDocs(res.documents ?? []);
        setVersion(res.version);
        // Anything already accepted at this version stays ticked and locked.
        setChecked(Object.fromEntries(
          (res.documents ?? []).map(d => [d.code, Boolean(d.accepted_at)])));
      })
      .catch((e: any) => { if (alive) setLoadError(e?.message ?? 'Unable to load the consents.'); });
    return () => { alive = false; };
  }, [caseId]);

  const outstanding = (docs ?? []).filter(d => d.required && !checked[d.code]);
  const allChecked = docs !== null && docs.length > 0 && outstanding.length === 0;

  const submit = async () => {
    if (!docs) return;
    setSaving(true);
    try {
      // Record each acceptance separately so the audit trail names the exact
      // document, not a single blanket "consented" flag.
      for (const d of docs) {
        if (d.accepted_at) continue;
        // Optional documents (e.g. compliance_sharing) are recorded ONLY if
        // the client actually ticked them. Recording an unticked consent
        // would fabricate an authorisation the client never gave.
        if (!checked[d.code]) continue;
        await amlPortalApi.recordConsent(caseId, d.code, version ?? undefined, {
          acknowledged: true,
          presented_version: version,
        });
      }
      toast.success('Consents and acknowledgements recorded');
      await onDone();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to record consent');
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Consents unavailable</AlertTitle>
        <AlertDescription>{loadError} Please refresh, or contact your adviser if this continues.</AlertDescription>
      </Alert>
    );
  }
  if (docs === null) {
    return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consents and disclosures</CardTitle>
        <CardDescription>
          We are a reporting entity regulated by AUSTRAC. Before we collect your identity
          information, the law requires us to tell you what we collect, why, and who we may
          give it to. Please read each item and confirm.
          {version && <span className="block mt-1 text-xs">Document set version {version}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {docs.map(doc => (
          <div key={doc.code} className="rounded-md border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{doc.title}</div>
                <p className="text-xs text-muted-foreground mt-1">{doc.summary}</p>
              </div>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {doc.acknowledgement_type === 'notice' ? 'Please read' : 'Your consent'}
              </Badge>
            </div>

            <div className="mt-3 max-h-56 overflow-y-auto rounded bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-line">
              {doc.body}
            </div>

            {doc.statutory_basis.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] font-medium text-muted-foreground">Legal basis</div>
                <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground list-disc pl-4">
                  {doc.statutory_basis.map(b => <li key={b}>{b}</li>)}
                </ul>
              </div>
            )}

            {doc.reference_links.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {doc.reference_links.map(link => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[11px] underline underline-offset-2 hover:text-foreground text-muted-foreground"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}

            <label className="mt-4 flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={Boolean(checked[doc.code])}
                disabled={Boolean(doc.accepted_at)}
                onCheckedChange={(v) => setChecked(prev => ({ ...prev, [doc.code]: !!v }))}
                className="mt-0.5"
                aria-label={doc.acknowledgement_type === 'notice'
                  ? `I have read: ${doc.title}`
                  : `I consent: ${doc.title}`}
              />
              <span className="text-xs">
                {doc.acknowledgement_type === 'notice'
                  ? 'I have read and understood this disclosure.'
                  : 'I have read this and I consent.'}
                {doc.accepted_at && (
                  <span className="ml-2 text-muted-foreground">
                    Recorded {new Date(doc.accepted_at).toLocaleDateString()}
                  </span>
                )}
              </span>
            </label>
          </div>
        ))}

        <p className="text-[11px] text-muted-foreground">
          A record of what you accepted, and the exact wording shown to you, is kept as part of
          your compliance file.
        </p>

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

/* ─────────────────────────  Review  ──────────────────────── */

/**
 * The review summary reads the WHOLE journey, not the questionnaire.
 *
 * It used to list sections and required documents, which meant a client who
 * had consented, uploaded and verified saw none of those three acknowledged
 * anywhere on the screen that was supposed to confirm they were finished.
 *
 * Identity verification is shown but does not gate the button, because
 * `submit_for_review` does not gate on it either (the reason is recorded at
 * that op). Saying "everything is ready" while a check is still running would
 * be wrong, so the copy says which of the two it is.
 */
function ReviewStep({
  overview, stepStates, caseId, onBack, onSubmitted,
}: {
  overview: AmlPortalOverview | null; stepStates: PortalStepState[];
  caseId: string; onBack: () => void; onSubmitted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const sections = overview?.sections ?? [];
  const reqs = overview?.requirements ?? [];
  const missingSections = sections.filter(s => !['submitted', 'accepted', 'complete'].includes(s.status));
  const missingReqs = reqs.filter(r => r.required && !['uploaded', 'accepted'].includes(r.status));
  const canSubmit = missingSections.length === 0 && missingReqs.length === 0;

  // Everything up to (and excluding) this screen — what the client owes us.
  const priorSteps = stepStates.filter(s => s.key !== 'review');
  const outstanding = priorSteps.filter(s => s.status === 'action_required');
  const inFlight = priorSteps.filter(s => s.status === 'in_progress');

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
        <ul className="grid md:grid-cols-2 gap-3" aria-label="Your onboarding summary">
          {priorSteps.map(s => (
            <li key={s.key} className="flex items-center justify-between gap-3 border rounded-md px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <StepMarker state={s} index={0} />
                <span className="truncate text-sm">{s.label}</span>
              </span>
              {/* Journey wording, never a backend enum. */}
              <span className="shrink-0 text-xs text-muted-foreground">
                {s.presentation.accessibleStatus}
              </span>
            </li>
          ))}
        </ul>

        {outstanding.length > 0 ? (
          <Alert variant="default">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {outstanding.length === 1
                ? 'One step still needs your attention'
                : `${outstanding.length} steps still need your attention`}
            </AlertTitle>
            <AlertDescription>
              {outstanding.map(s => s.label).join(', ')}.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="default">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Everything we need from you has been received.</AlertTitle>
            {inFlight.length > 0 && (
              <AlertDescription>
                {/* Never "all clear" while a check is still running — and never
                    a reason to hold their pack, because submission does not
                    wait on it. */}
                {inFlight.map(s => s.label).join(', ')} is still being checked.
                You can submit your information now.
              </AlertDescription>
            )}
          </Alert>
        )}

        {(missingSections.length > 0 || missingReqs.length > 0) && (
          <p className="text-xs text-muted-foreground">
            {missingSections.length > 0 && <span>{missingSections.length} section(s) not yet submitted. </span>}
            {missingReqs.length > 0 && <span>{missingReqs.length} required document(s) missing.</span>}
          </p>
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

/** Closed action vocabulary → button copy + the portal step it routes to.
 * The server projects only validated action metadata; nothing here follows a
 * URL from a request payload. */
function OpenRequestsCard({ requests, onDone, onNavigate, availability }: { requests: any[]; onDone: () => void; onNavigate?: (target: string, sectionCode?: string | null) => void; availability: IdvAvailability | null }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const respond = async (id: string) => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      // Versioned v1 contract; the server validates and stores it.
      await amlPortalApi.respondRequest(id, {
        version: 1, text: text.trim(), attachments: [],
        completed_action: 'provide_clarification',
      });
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
              <Badge variant="outline" className="capitalize">
                {r.status === 'open' ? 'Action required'
                  : r.status === 'responded' ? 'Response sent'
                  : r.status === 'resolved' ? 'Resolved' : r.status}
              </Badge>
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
              r.status === 'open' && (() => {
                const sectionCode = r.action_target?.section_code ?? null;
                const resolved = resolveRequestStep(r, availability);
                const routable = resolved.step !== 'respond';
                return (
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                    {/* Say why the route changed, before they click. Without
                        this the copy contradicted itself: an identity request
                        that opened a camera the server would refuse. */}
                    {resolved.manualFallback && (
                      <p className="w-full text-xs text-muted-foreground">
                        Electronic verification is unavailable. Please upload your identity
                        document for manual review.
                      </p>
                    )}
                    {r.due_at && (
                      <span className="text-xs text-muted-foreground">
                        Due {new Date(r.due_at).toLocaleDateString()}
                      </span>
                    )}
                    {routable ? (
                      <Button
                        size="sm"
                        onClick={() => onNavigate?.(resolved.step, sectionCode)}
                      >
                        {resolved.label}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setActiveId(r.id)}>
                        {resolved.label}
                      </Button>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
