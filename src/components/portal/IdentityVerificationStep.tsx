import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2, ShieldCheck, CheckCircle2, AlertTriangle, Camera, ArrowRight, ArrowLeft, RefreshCw,
  ExternalLink, Clock,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  amlPortalApi, type AmlVerificationParty, type AmlVerificationStatus,
} from '@/lib/aml/amlPortalApi';
import {
  IDENTITY_DOCUMENT_CHOICES, IDENTITY_DOCUMENT_PRESENTATION, identityCheckRequirements,
  type IdentityDocumentChoice,
} from '@/lib/aml/identityDocuments';
import { frameToJpeg, toUploadableJpeg, MAX_CAPTURE_EDGE_PX } from '@/lib/aml/captureImage';

/**
 * Identity verification step (zero-cost stack).
 *
 * Two captures per party: a photo of the identity document, and a selfie. The
 * comparison happens server-side; this component never sees a score, and
 * never tells the client whether the face matched. That is internal AML
 * information — the client is told only what they must do next.
 *
 * The document-instead escape hatch is deliberately prominent. Consent to
 * biometric collection is genuinely optional (APP 3.3), so refusing must be
 * an obvious, unpenalised path rather than something a client has to hunt for.
 */

type Capture = { blob: Blob; url: string } | null;

/**
 * Server refusals that mean "this client cannot use electronic verification",
 * as opposed to "that photo did not work". The step, not the camera dialog,
 * owns what the client is shown for these.
 */
const UNAVAILABLE_CODES = [
  'manual_verification_required',
  'temporarily_unavailable',
  'attempts_exhausted',
  'already_processing',
  // The server switched to a hosted provider while this dialog was open. Not a
  // capture failure — hand it back to the step, which re-reads and renders the
  // hosted flow instead.
  'hosted_verification_required',
];

/** A signed-URL PUT that failed, carrying the object it was writing. */
class UploadFailed extends Error {
  constructor(message: string, readonly path: string) {
    super(message);
    this.name = 'UploadFailed';
  }
}

const STATUS_PRESENTATION: Record<AmlVerificationParty['status'], { label: string; tone: string }> = {
  not_started:     { label: 'Not started',        tone: 'text-muted-foreground' },
  in_review:       { label: 'With our team',      tone: 'text-primary' },
  verified:        { label: 'Verified',           tone: 'text-success' },
  action_required: { label: 'Please try again',   tone: 'text-warning' },
  contact_adviser: { label: 'We will contact you', tone: 'text-warning' },
};

/**
 * What this party's state looks like right now, as one comparable string.
 *
 * Used only to notice that something MOVED. It is not sent anywhere and it is
 * not an outcome — the parent's response to it is to re-read the server, never
 * to believe anything the browser worked out.
 */
function statusSignature(status: AmlVerificationStatus): string {
  return status.parties
    .map((p) => `${p.party_id ?? 'self'}:${p.status}:${p.verification_in_progress ? 1 : 0}`)
    .join('|');
}

export function IdentityVerificationStep({
  caseId, onBack, onNext, onNeedsConsent, onStatusChange,
}: {
  caseId: string;
  onBack: () => void;
  onNext: () => void;
  onNeedsConsent: () => void;
  /**
   * Canonical verification state changed on the SERVER.
   *
   * This step keeps its own copy of the verification status; the journey that
   * draws the stepper, the progress figure and the review summary lives on the
   * page above it. Without this the two drifted apart — a client could return
   * from a completed check and see "Verify identity" still grey, with the
   * progress bar unmoved, until they reloaded the page by hand.
   *
   * It carries no argument on purpose. It reports that something moved, never
   * what it moved to: the parent answers by re-reading the server, so a
   * browser callback can never be the thing that marks anybody verified.
   */
  onStatusChange?: () => void;
}) {
  const [state, setState] = useState<AmlVerificationStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeParty, setActiveParty] = useState<AmlVerificationParty | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  /**
   * The party currently going through the secure identity check.
   *
   * Holds a party and NOT a session: the URL is minted only once the customer
   * presses Begin, inside the click that opens the window. Keeping it out of
   * this state is what makes the popup rule satisfiable — see `beginCheck`.
   */
  const [checking, setChecking] = useState<AmlVerificationParty | null>(null);

  /**
   * The last party-state we told the page about.
   *
   * `null` until the first successful read. That first read only notifies when
   * it has something to say — a case where nothing has been started yet is the
   * state the page already assumes, and telling it so would cost an overview
   * fetch every time the client so much as opened this step.
   */
  const reportedRef = useRef<string | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  /** Adopt a fresh server read, and tell the page if the state moved. */
  const applyStatus = useCallback((next: AmlVerificationStatus) => {
    setState(next);
    const signature = statusSignature(next);
    const first = reportedRef.current === null;
    const quiet = next.parties.every(
      (p) => p.status === 'not_started' && !p.verification_in_progress);
    if (reportedRef.current !== signature) {
      reportedRef.current = signature;
      if (!(first && quiet)) onStatusChangeRef.current?.();
    }
  }, []);

  const load = useCallback(async () => {
    try {
      applyStatus(await amlPortalApi.verificationStatus(caseId));
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message ?? 'Unable to load verification status.');
    }
  }, [caseId, applyStatus]);

  useEffect(() => { load(); }, [load]);

  /**
   * Open the capture dialog only if the server still says electronic
   * verification is on for this party.
   *
   * The availability read at page mount is not enough: the client may have had
   * the page open for a while, and the camera must never open against a
   * provider that will refuse the upload — that was how a customer ended up
   * photographing their face and being told afterwards that it could not be
   * used.
   */
  const startCapture = useCallback(async (party: AmlVerificationParty) => {
    setStarting(party.party_id ?? 'self');
    try {
      const fresh = await amlPortalApi.verificationStatus(caseId);
      applyStatus(fresh);
      const stillAllowed = fresh.parties.find(
        (p) => (p.party_id ?? null) === (party.party_id ?? null))?.can_attempt;
      if ((fresh.availability ?? 'available') !== 'available' || !stillAllowed) return;

      /**
       * A hosted provider runs the short capture on its own page. NPC owns
       * everything either side of it, so this opens NPC's own screens — pick a
       * document, then read what to have ready — and no session is created
       * until the customer presses Begin.
       *
       * That ordering is not cosmetic. The verification window has to be
       * opened synchronously inside the customer's click or the browser
       * classifies it as an unsolicited popup and blocks it, so the click that
       * opens the window cannot be the same click that waits for a session.
       */
      if ((fresh.provider_flow ?? 'capture') === 'hosted') {
        setChecking(party);
        return;
      }

      setActiveParty(party);
    } catch (e: any) {
      if (e?.code && UNAVAILABLE_CODES.includes(e.code)) {
        toast.info(e.message);
        await load();
        return;
      }
      setLoadError(e?.message ?? 'Unable to check verification availability.');
    } finally {
      setStarting(null);
    }
  }, [caseId, load, applyStatus]);

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Verification unavailable</AlertTitle>
        <AlertDescription>{loadError} Please refresh, or contact your adviser.</AlertDescription>
      </Alert>
    );
  }
  if (!state) return <Skeleton className="h-64" />;

  if (!state.biometric_consent_accepted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Facial verification consent needed</CardTitle>
          <CardDescription>
            Before we can take a photo of your face, we need your consent for that specific
            step. It is set out separately from the other consents because Australian privacy
            law treats a facial image as sensitive information.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={onNeedsConsent}>Review the consent</Button>
          <Button variant="outline" onClick={onNext}>Skip for now</Button>
        </CardContent>
      </Card>
    );
  }

  const allSettled = state.parties.every(
    (p) => p.status === 'verified' || p.status === 'in_review' || p.status === 'contact_adviser');

  // The server refuses a selfie upload URL unless a live provider can examine
  // the result. Honour that here rather than offering a capture that ends in a
  // 409 — the same contradiction the request router was fixed to avoid.
  const availability = state.availability ?? 'available';
  if (availability !== 'available') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Verify your identity
          </CardTitle>
          <CardDescription>
            {availability === 'manual_verification_required'
              ? 'We will verify your identity from your documents instead of a photo check. '
                + 'Please make sure your identity document is uploaded on the previous step — '
                + 'your adviser checks it from there. There is no disadvantage to you.'
              : 'The photo check is temporarily unavailable and nothing has been used up. '
                + 'You can upload your identity document instead and your adviser will take it '
                + 'from there, or come back shortly to try the photo check again.'}
          </CardDescription>
        </CardHeader>
        {/*
          The documentary route is not "nothing to do" — it is the route, and it
          needs the client to upload a document on the Documents step. This card
          used to say an adviser would arrange it and offered only Back/Continue,
          so a client whose provider was unavailable was told to wait for
          something that was waiting on them.
        */}
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <div className="flex gap-2">
            <Button onClick={onBack}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Upload identity document
            </Button>
            <Button variant="outline" onClick={onNext}>
              Skip for now <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  /**
   * The secure check takes over the step while it is running.
   *
   * A sub-screen rather than a dialog: this is NPC's own journey — choose a
   * document, read what to have ready, then a short trip out and back — and
   * wrapping it in a modal would frame it as an interruption to the portal
   * rather than a part of it.
   */
  if (checking) {
    return (
      <SecureIdentityCheck
        caseId={caseId}
        party={checking}
        maxAttempts={state.max_attempts}
        onRefresh={load}
        onExit={async () => { setChecking(null); await load(); }}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" /> Verify your identity
        </CardTitle>
        <CardDescription>
          We compare a photo of your identity document with a photo of you. It takes about a
          minute. You have up to {state.max_attempts} attempts — if it does not work, that is
          not a problem and it is not a finding against you; a member of our team will help you
          complete it another way.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {state.parties.map((party) => (
          <div key={party.party_id ?? 'self'} className="rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{party.label}</div>
                <div className={`text-xs ${STATUS_PRESENTATION[party.status].tone}`}>
                  {STATUS_PRESENTATION[party.status].label}
                  {party.attempts_used > 0 && party.can_attempt && (
                    <span className="text-muted-foreground">
                      {' '}· {party.attempts_remaining} of {state.max_attempts} attempts left
                    </span>
                  )}
                </div>
              </div>

              {party.status === 'verified' ? (
                <Badge variant="outline" className="text-success">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Done
                </Badge>
              ) : party.can_attempt ? (
                <Button
                  size="sm"
                  disabled={starting === (party.party_id ?? 'self')}
                  variant={party.attempts_used > 0 ? 'outline' : 'default'}
                  // Availability is re-read here rather than trusted from
                  // page mount. A provider can go away while the client is
                  // reading the page, and opening a camera whose capture the
                  // server will refuse collects a face for nothing (APP 3).
                  onClick={() => void startCapture(party)}
                >
                  {/*
                    Three labels, and the middle one matters most: a client
                    who already has a check open has NOT failed and has NOT
                    used anything up, so they are asked to continue rather
                    than to try again. `verification_in_progress` is the
                    server's answer and survives the refresh that loses every
                    trace of the window on this side.
                  */}
                  {party.verification_in_progress ? (
                    <><Clock className="mr-1.5 h-3.5 w-3.5" /> Continue verification</>
                  ) : party.attempts_used > 0 ? (
                    <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again</>
                  ) : (
                    <><Camera className="mr-1.5 h-3.5 w-3.5" /> Start</>
                  )}
                </Button>
              ) : null}
            </div>

            {party.verification_in_progress && party.can_attempt && (
              <p className="mt-3 text-xs text-muted-foreground">
                Your secure identity check is still open. Continue where you left off — nothing
                has been used up.
              </p>
            )}

            {party.retake_required && party.can_attempt && (
              <p className="mt-3 text-xs text-muted-foreground">
                We could not read your last photos clearly enough to check them, so
                nothing was used up. Please take them again in brighter, even light.
              </p>
            )}

            {party.status === 'contact_adviser' && (
              <p className="mt-3 text-xs text-muted-foreground">
                We were not able to complete the automated check. There is nothing further for
                you to do here — we will be in touch to verify your identity from your documents.
              </p>
            )}
          </div>
        ))}

        <Alert>
          <AlertTitle className="text-sm">Prefer not to use the photo check?</AlertTitle>
          <AlertDescription className="text-xs">
            You do not have to. Tell your adviser and we will verify your identity from original
            or certified copies of your documents instead. It takes a little longer and there is
            no disadvantage to you.
          </AlertDescription>
        </Alert>

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <Button onClick={onNext} variant={allSettled ? 'default' : 'outline'}>
            {allSettled ? 'Continue' : 'Skip for now'} <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>

      {activeParty && (
        <CaptureDialog
          caseId={caseId}
          party={activeParty}
          onClose={() => setActiveParty(null)}
          onDone={async () => { setActiveParty(null); await load(); }}
          // A readiness refusal closes the dialog and re-reads status, so the
          // client lands on the step's unavailable or manual-route state
          // instead of being left pressing Submit against a dead provider.
          onUnavailable={async () => { setActiveParty(null); await load(); }}
        />
      )}
    </Card>
  );
}

/* ────────────────────── the secure identity check ───────────────────────── */

/**
 * NPC's identity check, with the provider reduced to one short errand.
 *
 * ## What changed and why
 *
 * The provider's flow used to be embedded in an iframe inside this step. That
 * put a third-party application inside NPC's own page — a customer could see
 * another product's chrome, its language and its errors framed as ours, and the
 * hosted flow owned far more of the visible journey than the one thing it is
 * actually needed for. It now runs where a payment authorisation runs: a
 * separate top-level window that opens, does its job, and goes away. NPC owns
 * the document choice, the instructions, the waiting state and the return.
 *
 * ## It still cannot report an outcome
 *
 * Nothing in this component can mark anybody verified, and there is no field it
 * could read that would let it. The window closing, the return page messaging
 * us, the customer pressing a button — every one of them does exactly one
 * thing: re-read what NPC's own server already knows. The identity decision
 * arrives on a signed server-to-server webhook and is re-fetched from the
 * provider over an authenticated call before it settles anything.
 *
 * ## The popup rule
 *
 * A window opened after an `await` is an unsolicited popup and browsers block
 * it. So `beginCheck` opens a BLANK window synchronously inside the click,
 * then asks the backend for a session, then points the window it already has
 * at the result. Getting that order wrong is not a subtle degradation — it is
 * the whole flow failing on default settings in Safari and Firefox.
 */

/** One named window. A second open with the same name re-uses it, not clones it. */
const CHECK_WINDOW_TARGET = 'npc-secure-identity-check';

/**
 * The message the return page sends its opener.
 *
 * Matched exactly, from this origin only, and it carries no status because
 * there is nothing this component would be allowed to do with one. It means
 * "the customer came back" and its only effect is a re-read.
 */
const RETURN_NOTICE_TYPE = 'npc:identity-return';

type CheckPhase =
  /** Nothing chosen yet. */
  | 'choose'
  /** Document chosen; showing what to have ready. */
  | 'brief'
  /** Window open, session being minted. */
  | 'opening'
  /** Window open on the provider's capture page. */
  | 'open'
  /** The browser refused the window. Recoverable with one press. */
  | 'blocked'
  /** The window went away before the customer returned. Not a failure. */
  | 'closed'
  /** They came back. NPC is waiting on its own server, not on them. */
  | 'returned';

/** A separate, centred window — deliberately not a tab, and never an iframe. */
function checkWindowFeatures(): string {
  const width = 460;
  const height = 780;
  const screenWidth = window.screen?.width ?? width;
  const screenHeight = window.screen?.height ?? height;
  const left = Math.max(0, Math.round((screenWidth - width) / 2));
  const top = Math.max(0, Math.round((screenHeight - height) / 2));
  // `popup=yes` asks desktop browsers for a window rather than a tab. Mobile
  // browsers ignore the geometry and open a tab, which is the right behaviour
  // there and is why nothing below assumes a window exists beside this one.
  return `popup=yes,width=${width},height=${height},left=${left},top=${top},`
    + 'resizable=yes,scrollbars=yes';
}

/**
 * Something to look at while the session is minted.
 *
 * Without it the customer stares at `about:blank` for as long as the round
 * trip takes, which reads as a broken window rather than a loading one. Wrapped
 * because a browser may refuse to let us write into the new document, and that
 * is cosmetic — the navigation that follows still works.
 */
function paintPlaceholder(win: Window): void {
  try {
    win.document.write(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Secure identity check</title></head>'
      /*
       * No colours. This document lives for one round trip in a window that
       * has none of NPC's stylesheets, so a brand colour here could only be a
       * hardcoded hex — and the design tokens are the single source for those.
       * Default browser styling is correct for a page nobody should have time
       * to read.
       */
      + '<body style="margin:0;display:flex;align-items:center;justify-content:center;'
      + 'height:100vh;font:16px/1.5 system-ui,sans-serif">'
      + 'Preparing your secure identity check…</body></html>',
    );
    win.document.close();
  } catch { /* not writable here; the window is still usable */ }
}

function SecureIdentityCheck({
  caseId, party, maxAttempts, onRefresh, onExit,
}: {
  caseId: string;
  party: AmlVerificationParty;
  maxAttempts: number;
  onRefresh: () => Promise<void>;
  onExit: () => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<CheckPhase>('choose');
  const [choice, setChoice] = useState<IdentityDocumentChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The window we opened. Never re-created behind the customer's back. */
  const winRef = useRef<Window | null>(null);
  /**
   * The session URL, held in memory for exactly as long as the flow runs.
   *
   * It embeds the customer's session token, so it is never written to
   * `localStorage`, `sessionStorage`, a cookie, the URL bar, a log line or any
   * telemetry — a token in web storage outlives the browser restart that should
   * have ended it, and is readable by every script on the origin. It exists
   * here only so that "open it again" can be a synchronous response to a click
   * rather than another round trip the browser would block.
   */
  const urlRef = useRef<string | null>(null);
  /** Guards a second session request from a double tap, before React re-renders. */
  const busy = useRef(false);

  useEffect(() => () => { urlRef.current = null; }, []);

  /**
   * Point the existing window at the session, or open one if it has gone.
   *
   * Called only from a click, and it never awaits before opening — both are
   * what keep the browser treating this as user-initiated.
   */
  const showCheckWindow = useCallback((): boolean => {
    const url = urlRef.current;
    if (!url) return false;
    const existing = winRef.current;
    if (existing && !existing.closed) {
      try { existing.location.replace(url); } catch { /* cross-origin: already there */ }
      existing.focus();
      return true;
    }
    const win = window.open(url, CHECK_WINDOW_TARGET, checkWindowFeatures());
    if (!win) return false;
    winRef.current = win;
    win.focus();
    return true;
  }, []);

  /**
   * The one click that matters.
   *
   * Order is load-bearing and is the reason this is not simply
   * `await start(); window.open(url)`:
   *
   *   1. open a blank window — synchronously, inside the gesture;
   *   2. ask the backend for a session — which may reconcile and hand back the
   *      one the customer already has rather than mint another;
   *   3. navigate the window we already hold.
   *
   * A blocked window does not abandon the request: the session is still
   * created and its URL kept in memory, so the recovery button is one press
   * and not another round trip. Nothing about a blocked window is a
   * verification failure and none of it consumes an attempt — the backend
   * settles attempts from provider outcomes alone.
   */
  const beginCheck = useCallback((documentType: IdentityDocumentChoice) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);

    // ── 1. Synchronous, before any await. Do not move this.
    const win = window.open('', CHECK_WINDOW_TARGET, checkWindowFeatures());
    if (win) {
      winRef.current = win;
      paintPlaceholder(win);
    }
    setPhase('opening');

    void (async () => {
      try {
        // ── 2. The session. Server-minted, server-correlated, server-owned.
        const res = await amlPortalApi.startHostedVerification(caseId, {
          party_id: party.party_id,
          party_label: party.label,
          document_type: documentType,
        });

        if (!res.verification_url) {
          // Already in flight elsewhere, or settled while nobody was looking.
          // Neither is ours to interpret — say what the server said and let
          // the step re-read.
          win?.close();
          winRef.current = null;
          toast.info(res.message);
          await onExit();
          return;
        }

        urlRef.current = res.verification_url;

        // ── 3. Navigate the window we already have.
        if (!win || win.closed) {
          setPhase('blocked');
          return;
        }
        win.location.replace(res.verification_url);
        setPhase('open');
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string };
        win?.close();
        winRef.current = null;
        if (err?.code && UNAVAILABLE_CODES.includes(err.code)) {
          // Provider gone, manual route, or attempts exhausted. The step owns
          // what the customer is shown for each of these, and it is never
          // "verification failed".
          toast.info(err.message ?? 'Verification is unavailable just now.');
          await onExit();
          return;
        }
        setPhase(err?.code === 'unsupported_document_type' ? 'choose' : 'brief');
        setError(err?.message
          ?? 'We could not start the secure check just now. Nothing has been used up — '
          + 'please try again in a moment.');
      } finally {
        busy.current = false;
      }
    })();
  }, [caseId, party.party_id, party.label, onExit]);

  /**
   * The customer came back.
   *
   * Origin-checked against this page's own origin, so only an NPC page can be
   * heard at all, and matched on a bare type. There is deliberately no field
   * in the message that could carry a status — the only action available here
   * is a re-read of server state, so no message from any window can move a
   * verification.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown } | null;
      if (!data || typeof data !== 'object' || data.type !== RETURN_NOTICE_TYPE) return;
      setPhase('returned');
      void onRefresh();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onRefresh]);

  /**
   * The window went away.
   *
   * Polled, because there is no cross-origin close event. A closed window is
   * NOT a failure and is never reported as one: the customer may have
   * finished, may have given up, may have closed it by accident. All this does
   * is stop claiming the check is in progress and re-read the server.
   */
  useEffect(() => {
    if (phase !== 'open') return;
    const timer = window.setInterval(() => {
      if (winRef.current && !winRef.current.closed) return;
      window.clearInterval(timer);
      setPhase('closed');
      void onRefresh();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, onRefresh]);

  /**
   * Coming back to this tab is itself a signal.
   *
   * On a phone the check usually opens as a tab, and returning to NPC is a tab
   * switch rather than anything we are told about. Re-reading on focus is what
   * makes the mobile journey land on the right state without the customer
   * pressing anything.
   */
  useEffect(() => {
    if (phase !== 'open' && phase !== 'closed' && phase !== 'returned') return;
    const refresh = () => { if (!document.hidden) void onRefresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [phase, onRefresh]);

  const chosen = choice ? IDENTITY_DOCUMENT_PRESENTATION[choice] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          {phase === 'choose' || phase === 'brief' ? 'Confirm your identity'
            : phase === 'returned' ? 'Verification received'
              : 'Identity verification'}
        </CardTitle>
        <CardDescription>
          {party.label}
          {chosen && phase !== 'choose' && <> · {chosen.label}</>}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* ── A. Which document ─────────────────────────────────────────── */}
        {phase === 'choose' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Which identity document will you use?</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose the document you have with you. We only need one.
              </p>
            </div>

            {/*
              A radio group and not a row of buttons: this is a single choice
              from a short closed list, so arrow keys should move through it,
              the label should be clickable, and a screen reader should hear
              "2 of 4". Pressing an option does not start anything — the launch
              screen is a separate, deliberate step.
            */}
            {/*
              `?? ''` and not `?? undefined`: an undefined value makes the
              group UNCONTROLLED, and an uncontrolled group tracks its own
              selection while ours stays null — the option looked chosen and
              Continue stayed disabled. Found in a browser, not in jsdom.
            */}
            <RadioGroup
              value={choice ?? ''}
              onValueChange={(v) => setChoice(v as IdentityDocumentChoice)}
              aria-label="Identity document"
              className="gap-2"
            >
              {IDENTITY_DOCUMENT_CHOICES.map((option) => {
                const presentation = IDENTITY_DOCUMENT_PRESENTATION[option];
                const id = `identity-document-${option}`;
                return (
                  /*
                    The label is a SIBLING of the control, not its wrapper.
                    Measured in a browser: with the label wrapped around the
                    radio, arrow keys did not move between options at all — the
                    list could be tabbed into and then not moved through, which
                    is the whole of keyboard operation for a radio group. As
                    siblings it behaves correctly, and this is the shape shadcn
                    documents.
                  */
                  <div
                    key={option}
                    className="flex items-start gap-3 rounded-md border p-3 transition-colors
                      hover:bg-accent/50 has-[[data-state=checked]]:border-primary
                      has-[[data-state=checked]]:bg-accent/40 motion-reduce:transition-none"
                  >
                    <RadioGroupItem value={option} id={id} className="mt-0.5" />
                    <Label htmlFor={id} className="flex-1 cursor-pointer space-y-0.5 font-normal">
                      <span className="block text-sm font-medium">{presentation.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {presentation.hint}
                      </span>
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>

            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="outline" onClick={() => void onExit()}>
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Back
              </Button>
              <Button disabled={!choice} onClick={() => setPhase('brief')}>
                Continue <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}

        {/* ── B. What to have ready ─────────────────────────────────────── */}
        {phase === 'brief' && choice && chosen && (
          <div className="space-y-4">
            <div className="rounded-md border p-4">
              <div className="text-sm font-medium">{chosen.label}</div>
              <p className="mt-3 text-xs font-medium text-muted-foreground">You will need:</p>
              <ul className="mt-2 space-y-1.5">
                {identityCheckRequirements(choice).map((requirement) => (
                  <li key={requirement} className="flex items-start gap-2 text-sm">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    <span>{requirement}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/*
              Said before the window opens, not after. A new window appearing
              unannounced is the moment a customer decides something has gone
              wrong — and someone using a screen reader or a magnifier needs to
              know where their focus is about to be able to go.
            */}
            <p className="text-xs text-muted-foreground">
              Selecting <strong>Begin secure verification</strong> opens a separate secure window
              for the photo steps. This page stays open behind it, and you will come back here
              when you are finished. Your identity check is completed securely using our
              verification provider.
            </p>

            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="outline" onClick={() => { setPhase('choose'); setError(null); }}>
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Change document
              </Button>
              <Button onClick={() => beginCheck(choice)}>
                Begin secure verification
                <ExternalLink className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}

        {/* ── C–G. In flight ────────────────────────────────────────────── */}
        {(phase === 'opening' || phase === 'open' || phase === 'blocked'
          || phase === 'closed' || phase === 'returned') && (
          <div className="space-y-4">
            {/*
              One live region for every in-flight state, so a screen reader is
              told when the check moves from "preparing" to "in progress" to
              "received" without the customer hunting for it. Each state pairs
              an icon with words — none of them is distinguishable by colour
              alone.
            */}
            <div className="rounded-md border p-4" role="status" aria-live="polite">
              {phase === 'opening' && (
                <p className="flex items-center gap-2 text-sm">
                  <Loader2
                    className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  Preparing your secure identity check…
                </p>
              )}

              {phase === 'open' && (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                    Identity verification in progress
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Complete the steps in the secure window that has opened. You can return to
                    this page when you have finished.
                  </p>
                </div>
              )}

              {phase === 'blocked' && (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
                    We could not open the secure verification window
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your browser blocked it. Nothing has gone wrong with your verification and
                    nothing has been used up — select Open verification below, or allow pop-ups
                    for this site and try again.
                  </p>
                </div>
              )}

              {phase === 'closed' && (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    Your identity check has not been confirmed yet
                  </p>
                  {/*
                    Not "you failed" and not "you cancelled". The window closing
                    tells us nothing about what happened inside it — they may
                    have finished and closed it themselves — so this says only
                    what is true and offers the way back.
                  */}
                  <p className="text-xs text-muted-foreground">
                    The secure window is no longer open. If you have already finished, we may
                    still be checking it. Otherwise you can continue where you left off —
                    nothing has been used up.
                  </p>
                </div>
              )}

              {phase === 'returned' && (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                    We are securely checking your verification
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your information has been received. This usually takes under a minute, and
                    we will show the result here. You do not need to do anything else.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" onClick={() => void onExit()}>
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Back to identity
              </Button>

              <div className="flex flex-wrap gap-2">
                {/*
                  One control, three labels. It is a direct response to a click
                  every time — never a promise resolving into a window — because
                  a browser blocks the second kind.
                */}
                {(phase === 'open' || phase === 'blocked' || phase === 'closed') && (
                  <Button
                    onClick={() => {
                      if (showCheckWindow()) {
                        setPhase('open');
                        setError(null);
                      } else if (choice) {
                        // The URL is gone (a refresh, or the flow was re-entered).
                        // Ask the backend again — it reconciles and hands back the
                        // session already open rather than minting another.
                        beginCheck(choice);
                      }
                    }}
                  >
                    {phase === 'open' ? 'Re-open verification'
                      : phase === 'blocked' ? 'Open verification'
                        : 'Continue verification'}
                    <ExternalLink className="ml-1.5 h-4 w-4" aria-hidden="true" />
                  </Button>
                )}

                {phase === 'returned' && (
                  <Button onClick={() => void onExit()}>
                    Return to Identity &amp; Compliance
                    <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/*
          The documentary route stays prominent and stays on every screen of
          this flow. Consent to biometric collection is genuinely optional
          (APP 3.3), so refusing has to be visible at the moment somebody
          decides to refuse — not hidden behind the check they are declining.
        */}
        <Alert>
          <AlertTitle className="text-sm">Prefer not to use the photo check?</AlertTitle>
          <AlertDescription className="text-xs">
            You do not have to. Tell your adviser and we will verify your identity from original
            or certified copies of your documents instead. It takes a little longer, you keep all
            {' '}{maxAttempts} attempts, and there is no disadvantage to you.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────── capture ────────────────────────────────── */

function CaptureDialog({
  caseId, party, onClose, onDone, onUnavailable,
}: {
  caseId: string;
  party: AmlVerificationParty;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onUnavailable: () => void | Promise<void>;
}) {
  const [stage, setStage] = useState<'document' | 'selfie' | 'submitting'>('document');
  const [documentShot, setDocumentShot] = useState<Capture>(null);
  const [selfieShot, setSelfieShot] = useState<Capture>(null);
  const [error, setError] = useState<string | null>(null);
  /** Guards a second submit from a double tap, before React re-renders. */
  const submitting = useRef(false);

  /**
   * Object URLs hold image data until revoked, so every one we mint is tracked
   * and released on unmount. Revoking on each capture change — the previous
   * shape here — released the document preview's URL the moment the selfie was
   * taken, which is only invisible because that preview is off screen by then.
   */
  const urls = useRef<string[]>([]);
  const setCapture = useCallback((
    set: (c: Capture) => void, previous: Capture,
  ) => (next: Capture) => {
    if (previous) {
      URL.revokeObjectURL(previous.url);
      urls.current = urls.current.filter((u) => u !== previous.url);
    }
    if (next) urls.current.push(next.url);
    set(next);
  }, []);
  useEffect(() => () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
  }, []);

  const submit = async () => {
    if (submitting.current) return;
    if (!documentShot || !selfieShot) {
      // Never return silently: the customer pressed Submit and is owed a
      // reason. Reaching this means a capture was lost, so send them back to
      // the step that has to be redone rather than leaving Submit inert.
      setError(!documentShot
        ? 'The photo of your document was not kept. Please take it again.'
        : 'The photo of your face was not kept. Please take it again.');
      setStage(documentShot ? 'selfie' : 'document');
      return;
    }
    submitting.current = true;
    setStage('submitting');
    setError(null);
    try {
      /**
       * Both signed-upload grants BEFORE either byte is written.
       *
       * The old order asked for the document URL and uploaded it, then asked
       * for the selfie URL — and the selfie request is the gate: it is where
       * the server checks provider readiness and remaining attempts. With no
       * live provider that gate answers 409, so every attempt uploaded a
       * customer's identity document to `aml-documents` and then abandoned the
       * submission. Production accumulated nine orphaned documents and not one
       * selfie, verification row or outbox event.
       *
       * Asking for the gated grant first means a refusal costs nothing: no
       * object is written, no attempt is spent, and nothing needs cleaning up.
       */
      const selfieMeta = await amlPortalApi.requestVerificationUpload(caseId, 'selfie');
      const documentMeta = await amlPortalApi.requestVerificationUpload(caseId, 'document');

      const put = async (meta: { upload_url: string; path: string }, blob: Blob) => {
        const res = await fetch(meta.upload_url, {
          method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
        });
        if (!res.ok) throw new UploadFailed(`Upload failed (${res.status})`, meta.path);
        return meta.path;
      };

      const docPath = await put(documentMeta, documentShot.blob);
      const selfiePath = await put(selfieMeta, selfieShot.blob);

      const res = await amlPortalApi.submitVerification(caseId, {
        party_id: party.party_id,
        party_label: party.label,
        document_storage_path: docPath,
        selfie_storage_path: selfiePath,
      });
      toast.success(res.message);
      await onDone();
    } catch (e: any) {
      // A readiness refusal is not a capture problem, and leaving the client
      // in the camera to press Submit again against a provider that cannot
      // serve them is a dead end. Hand it back to the step, which renders the
      // correct unavailable or manual-route state.
      if (e?.code && UNAVAILABLE_CODES.includes(e.code)) {
        await onUnavailable();
        return;
      }
      setError(e?.message ?? 'Something went wrong. Please try again.');
      setStage('selfie');
    } finally {
      submitting.current = false;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Verify ${party.label}`}
    >
      <Card className="max-h-full w-full max-w-lg overflow-y-auto">
        <CardHeader>
          <CardTitle className="text-base">
            {stage === 'document' ? 'Step 1 — photograph your ID'
              : stage === 'selfie' ? 'Step 2 — take a photo of yourself'
                : 'Sending…'}
          </CardTitle>
          <CardDescription>
            {stage === 'document'
              ? 'Place your passport or driver licence on a flat surface in good light. Make sure the whole document is in frame and the text is readable.'
              : stage === 'selfie'
                ? 'Look straight at the camera in even lighting. Remove hats and sunglasses.'
                : 'Uploading securely.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {stage === 'document' && (
            <CameraCapture
              facing="environment"
              existing={documentShot}
              onCapture={setCapture(setDocumentShot, documentShot)}
              onConfirm={() => setStage('selfie')}
            />
          )}

          {stage === 'selfie' && (
            <CameraCapture
              facing="user"
              existing={selfieShot}
              onCapture={setCapture(setSelfieShot, selfieShot)}
              onConfirm={submit}
              confirmLabel="Submit"
            />
          )}

          {stage === 'submitting' && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Sending your photos securely…
            </div>
          )}

          {stage !== 'submitting' && (
            <Button variant="ghost" size="sm" onClick={onClose} className="w-full">
              Cancel
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Camera capture with an explicit file-upload fallback.
 *
 * getUserMedia fails for real and ordinary reasons — denied permission, no
 * camera, an insecure context, a locked-down work laptop. Falling back to a
 * file input keeps those customers moving instead of dead-ending them.
 */
/**
 * Whether the element has an actual frame to draw.
 *
 * All three conditions are needed: `loadedmetadata` sets `readyState` to
 * HAVE_METADATA and populates the dimensions, and a stream can report a width
 * a tick before it reports a height.
 */
function isVideoRenderable(video: HTMLVideoElement): boolean {
  return video.readyState >= HTMLMediaElement.HAVE_METADATA
    && video.videoWidth > 0
    && video.videoHeight > 0;
}

function CameraCapture({
  facing, existing, onCapture, onConfirm, confirmLabel = 'Use this photo',
}: {
  facing: 'user' | 'environment';
  existing: Capture;
  onCapture: (c: Capture) => void;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  /**
   * Bumped to reopen the camera. Retake used to call `onCapture(null)` alone,
   * which re-rendered the preview branch — but the acquisition effect keys on
   * `facing`, which had not changed, so it never re-ran and the stream stopped
   * by the previous shot was never replaced. The customer got a permanently
   * black preview and a dead "Take photo" button, with no way out but reload.
   */
  const [restartKey, setRestartKey] = useState(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const restart = useCallback(() => {
    stop();
    setReady(false);
    setCameraError(null);
    setRestartKey((k) => k + 1);
  }, [stop]);

  useEffect(() => {
    // Nothing to acquire while a capture is on screen; the preview branch has
    // no <video> to attach a stream to, and holding the camera open would
    // leave the device indicator lit for no reason.
    if (existing) return;

    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser cannot use the camera. You can upload a photo instead.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        await video.play().catch(() => {});
        // `play()` resolving does not mean there are pixels: the dimensions
        // are still 0 until metadata arrives. Shooting then produced a blank
        // frame that uploaded happily and came back "no face found".
        if (!cancelled && isVideoRenderable(video)) setReady(true);
      } catch {
        setCameraError('We could not open your camera. You can upload a photo instead.');
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [facing, stop, restartKey, existing]);

  const capture = async (produce: () => Promise<Blob>) => {
    setWorking(true);
    setCameraError(null);
    try {
      const blob = await produce();
      stop();
      setReady(false);
      onCapture({ blob, url: URL.createObjectURL(blob) });
    } catch (e: any) {
      // Say what happened. A silent return here left the customer pressing a
      // button that appeared to do nothing.
      setCameraError(e?.message ?? 'We could not use that photo. Please try again.');
    } finally {
      setWorking(false);
    }
  };

  const shoot = () => {
    const video = videoRef.current;
    if (!video) return;
    void capture(() => frameToJpeg(video));
  };

  if (existing) {
    return (
      <div className="space-y-3">
        <img
          src={existing.url}
          alt="Captured photo, for you to check before sending"
          className="w-full rounded-md border"
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => { onCapture(null); restart(); }}
          >
            Retake
          </Button>
          <Button className="flex-1" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!cameraError && (
        <>
          {/* muted + playsInline are required for autoplay on iOS Safari. */}
          <video
            ref={videoRef}
            className="w-full rounded-md border bg-muted"
            playsInline
            muted
            aria-label="Camera preview"
            // Metadata can land after the effect has already checked, so the
            // ready gate is driven from the element as well.
            onLoadedMetadata={(e) => { if (isVideoRenderable(e.currentTarget)) setReady(true); }}
            onCanPlay={(e) => { if (isVideoRenderable(e.currentTarget)) setReady(true); }}
          />
          <Button className="w-full" onClick={shoot} disabled={!ready || working}>
            {working
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…</>
              : <><Camera className="mr-2 h-4 w-4" /> {ready ? 'Take photo' : 'Starting camera…'}</>}
          </Button>
        </>
      )}

      {cameraError && (
        <Alert>
          <AlertDescription className="space-y-2 text-xs">
            <span className="block">{cameraError}</span>
            <Button variant="outline" size="sm" onClick={restart}>
              <RefreshCw className="mr-1.5 h-3 w-3" /> Try the camera again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <label className="block">
        <span className="text-xs text-muted-foreground underline underline-offset-2">
          Or upload a photo from this device
        </span>
        <input
          type="file"
          // JPEG and PNG only. `image/*` let an iPhone offer HEIC, which the
          // verification service cannot decode; toUploadableJpeg rejects it
          // anyway, but not offering it is a better experience than refusing it.
          accept="image/jpeg,image/png"
          capture={facing === 'user' ? 'user' : 'environment'}
          className="mt-1 block w-full text-xs"
          disabled={working}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset the input so choosing the same file twice still fires.
            e.currentTarget.value = '';
            if (file) void capture(() => toUploadableJpeg(file));
          }}
        />
        <span className="mt-1 block text-[11px] text-muted-foreground">
          JPEG or PNG. Photos are resized to {MAX_CAPTURE_EDGE_PX}px before they are sent.
        </span>
      </label>
    </div>
  );
}
