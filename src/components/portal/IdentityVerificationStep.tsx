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
  identityDocumentCapturePlan,
  type IdentityCaptureKind, type IdentityDocumentChoice,
} from '@/lib/aml/identityDocuments';
import { frameToJpeg, toUploadableJpeg, MAX_CAPTURE_EDGE_PX } from '@/lib/aml/captureImage';

/**
 * Identity verification step.
 *
 * ## The whole journey is NPC's
 *
 * The customer chooses a document, photographs it, photographs themselves, and
 * waits — all inside this page. They never see a verification vendor: no
 * window opens, nothing redirects, no third-party SDK loads, and no image is
 * ever sent anywhere except NPC's own private storage over a signed upload the
 * server minted. The provider is called server-to-server, from an Edge
 * Function, with a credential this bundle has no way to reach.
 *
 * ## Nothing here can mark anybody verified
 *
 * There is no field this component could set, and no response it could read,
 * that moves a verification. It uploads photographs, says "these are ready",
 * and then does exactly one thing for ever after: re-read what NPC's own
 * server says. Scores, thresholds, provider warnings and the reason for a
 * referral are internal AML information (Appendix C.1) and none of them
 * crosses the wire.
 *
 * The document-instead escape hatch is deliberately prominent on every screen.
 * Consent to biometric collection is genuinely optional (APP 3.3), so refusing
 * has to be visible at the moment somebody decides to refuse — not hidden
 * behind the check they are declining.
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
  // The active capture integration changed under us — the tenant moved between
  // the prepared-attempt journey and the older single-shot one. Also not a
  // capture failure, and never something the customer did.
  'capture_flow_unavailable',
  'capture_flow_superseded',
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
   * The party-state this step has already accounted for.
   *
   * ## The loop this ref caused
   *
   * It used to notify the page on the first read whenever that read was not
   * "quiet" — anything other than every party `not_started`. A client sitting
   * on a check that was already `in_review` therefore announced a change that
   * had not happened, the page reloaded, the reload blanked the portal, this
   * component unmounted, the ref died with it, and the remount made the very
   * same server state look new again. Forever. The page blinked and the
   * customer could not use it.
   *
   * So the first successful read for a case is a BASELINE and never a change.
   * The page has already loaded the overview from the same server; there is
   * nothing to tell it. `onStatusChange` announces a change AFTER the baseline
   * and nothing else.
   */
  const reportedRef = useRef<string | null>(null);
  /**
   * Which case that baseline belongs to.
   *
   * A genuinely different case needs a fresh baseline — its first read is not
   * a change either. Keyed on the case rather than on mount so an ordinary
   * parent refresh, which re-renders this component without remounting it,
   * cannot make an unchanged identity state look new.
   */
  const baselineCaseRef = useRef<string | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  /** Adopt a fresh server read, and tell the page only if the state moved. */
  const applyStatus = useCallback((next: AmlVerificationStatus) => {
    setState(next);
    const signature = statusSignature(next);
    if (baselineCaseRef.current !== caseId) {
      // First read for this case: record where we are starting from, silently.
      baselineCaseRef.current = caseId;
      reportedRef.current = signature;
      return;
    }
    if (reportedRef.current === signature) return;
    reportedRef.current = signature;
    onStatusChangeRef.current?.();
  }, [caseId]);

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
      // Both experiences are sub-screens of this step, and both are NPC's own.
      // `hosted` is the legacy provider-window flow, kept only while the
      // sessions opened before the cutover can still settle; `capture` is the
      // journey every new attempt takes, and it never leaves this page.
      setChecking(party);
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
    /**
     * The LIVE party, re-read from the latest server state.
     *
     * `checking` is the party as it stood when the customer pressed Start, and
     * it never changes again — so a sub-screen given it directly is looking at
     * a snapshot. Found in a browser and not in jsdom: the capture screen
     * polls, the poll refreshes `state`, and the customer sat on "Checking your
     * identity" for ever because the object they were being judged against
     * still said the check was in flight. The polling worked; nothing was
     * reading its answer.
     *
     * Falls back to the snapshot if the party has gone from the list, which
     * would otherwise unmount the screen out from under somebody mid-capture.
     */
    const live = state.parties.find(
      (p) => (p.party_id ?? null) === (checking.party_id ?? null)) ?? checking;

    return (state.provider_flow ?? 'capture') === 'hosted' ? (
      <SecureIdentityCheck
        caseId={caseId}
        party={live}
        maxAttempts={state.max_attempts}
        onRefresh={load}
        onExit={async () => { setChecking(null); await load(); }}
      />
    ) : (
      <SecureCaptureCheck
        caseId={caseId}
        party={live}
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
                  {/*
                    "In progress" means two different things in the two flows,
                    and the customer is owed the right one. Under the hosted
                    flow a window is still open and they have something to go
                    back to; under the capture flow their photographs are with
                    us and there is nothing for them to do.
                  */}
                  {party.verification_in_progress ? (
                    (state.provider_flow ?? 'capture') === 'hosted'
                      ? <><Clock className="mr-1.5 h-3.5 w-3.5" /> Continue verification</>
                      : <><Clock className="mr-1.5 h-3.5 w-3.5" /> Check progress</>
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
                {(state.provider_flow ?? 'capture') === 'hosted'
                  ? 'Your secure identity check is still open. Continue where you left off — '
                    + 'nothing has been used up.'
                  : 'We are checking the photos you sent. You do not need to do anything — '
                    + 'nothing has been used up, and we will show the result here.'}
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

/* ──────────────────── the NPC capture check (Standalone) ────────────────── */

/**
 * The whole identity check, inside NPC.
 *
 * Choose a document → read what to have ready → photograph its front → its
 * back, only if that document has one → photograph your face → upload → wait.
 * Nothing here opens a window, loads a third-party script, or sends an image
 * anywhere except NPC's own private storage.
 *
 * ## Why preparation happens before the camera
 *
 * `prepareVerificationAttempt` is called from the Begin button and not from the
 * first shutter press, because it is where the server checks provider
 * readiness, the attempt ceiling, both consents and whether something is
 * already processing. If any of those refuses, the customer has not yet taken a
 * photograph and there is nothing to throw away. The previous shape asked for
 * one upload grant, wrote the document, and then hit the gate — which is how
 * production ended up holding nine identity documents belonging to submissions
 * that never happened.
 *
 * It also returns the three storage locations, which the SERVER names. This
 * component never constructs a path and never sends one back: submission is an
 * attempt id, and everything else is read off the row the server already wrote.
 *
 * ## Preparing and photographing consume nothing
 *
 * A prepared attempt is a draft. Cancelling, closing the tab, retaking a photo
 * ten times, or a failed upload all cost the customer nothing — the allowance
 * moves only when the provider has actually examined a usable capture, and that
 * decision is made on the server.
 */

/** The stages of the check, in the order they happen. */
type CaptureStage =
  /** Nothing chosen yet. */
  | 'choose'
  /** Document chosen; showing what to have ready. */
  | 'brief'
  /** Server is preparing the attempt. No camera yet, nothing written yet. */
  | 'preparing'
  | 'document_front'
  | 'document_back'
  | 'selfie'
  /** Writing the photographs to NPC storage. */
  | 'uploading'
  /** Submitted. NPC is checking; the customer may leave. */
  | 'processing'
  /** Settled while they were watching. */
  | 'received';

/** A signed-URL PUT that failed, carrying the capture it was writing. */
class CaptureUploadFailed extends Error {
  constructor(message: string, readonly kind: IdentityCaptureKind) {
    super(message);
    this.name = 'CaptureUploadFailed';
  }
}

/**
 * How long to wait before each re-read while a check is processing.
 *
 * Bounded and backing off, and it stops. Three provider calls usually settle in
 * under twenty seconds, so the early reads are close together and the later
 * ones are not; after the last entry the page stops asking and waits for the
 * customer to return, which the focus listener below handles for free.
 *
 * A fixed interval that never ended was the alternative, and it is how a portal
 * left open on a desk becomes a request storm against the same endpoint for
 * hours.
 */
const PROCESSING_POLL_MS = [2_000, 3_000, 4_000, 6_000, 8_000, 12_000, 15_000, 20_000, 30_000];

/** Per-stage copy. Keeping it beside the stage list stops the two drifting. */
const CAPTURE_COPY: Record<IdentityCaptureKind, {
  title: string; description: string; facing: 'user' | 'environment';
}> = {
  document_front: {
    title: 'Photograph the front of your document',
    description: 'Lay it flat in good, even light. Fit the whole document in the frame — all '
      + 'four corners visible — and check the text is readable before you continue. Do not crop '
      + 'it in.',
    facing: 'environment',
  },
  document_back: {
    title: 'Now photograph the back',
    description: 'Turn the card over and photograph the other side the same way — flat, whole, '
      + 'and readable.',
    facing: 'environment',
  },
  selfie: {
    title: 'Take a photo of yourself',
    description: 'Look straight at the camera in even lighting. Remove hats and sunglasses, and '
      + 'make sure your whole face is in the frame.',
    facing: 'user',
  },
};

function SecureCaptureCheck({
  caseId, party, maxAttempts, onRefresh, onExit,
}: {
  caseId: string;
  party: AmlVerificationParty;
  maxAttempts: number;
  onRefresh: () => Promise<void>;
  onExit: () => void | Promise<void>;
}) {
  const [stage, setStage] = useState<CaptureStage>(
    // Somebody returning to a check that is already running should land on the
    // waiting screen, not be offered a document picker for an attempt that is
    // mid-flight. The server's boolean survives the refresh that loses
    // everything on this side.
    party.verification_in_progress ? 'processing' : 'choose',
  );
  const [choice, setChoice] = useState<IdentityDocumentChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captures, setCaptures] = useState<Partial<Record<IdentityCaptureKind, Capture>>>({});

  /**
   * The prepared attempt: its id and the three places the server told us to
   * write. Held in memory only — none of it is a credential the customer keeps,
   * and the upload permissions are short-lived by design.
   */
  const attempt = useRef<{
    id: string;
    required: { document_front: true; document_back: boolean; selfie: true };
    uploads: Partial<Record<IdentityCaptureKind, { upload_url: string }>>;
  } | null>(null);

  /** Guards a second prepare/submit from a double tap, before React re-renders. */
  const busy = useRef(false);

  /**
   * Every object URL minted, released on unmount.
   *
   * Tracked as a set rather than revoked per replacement: revoking the previous
   * capture's URL when a new one is taken releases a preview that is still
   * mounted behind the current stage, which shows as a broken image the moment
   * anybody presses Back.
   */
  const urls = useRef<string[]>([]);
  useEffect(() => () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
  }, []);

  const setCapture = useCallback((kind: IdentityCaptureKind) => (next: Capture) => {
    setCaptures((prev) => {
      const previous = prev[kind];
      if (previous) {
        URL.revokeObjectURL(previous.url);
        urls.current = urls.current.filter((u) => u !== previous.url);
      }
      if (next) urls.current.push(next.url);
      return { ...prev, [kind]: next };
    });
  }, []);

  const plan = choice ? identityDocumentCapturePlan(choice) : null;
  const chosen = choice ? IDENTITY_DOCUMENT_PRESENTATION[choice] : null;

  /**
   * Prepare the attempt, then open the camera.
   *
   * The order is the point, and it is the opposite of the popup rule the hosted
   * flow had to satisfy: there is no window to open synchronously, so the
   * server is asked first and the camera only opens once it has said yes.
   */
  const begin = useCallback(async (documentType: IdentityDocumentChoice) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setStage('preparing');
    try {
      const prepared = await amlPortalApi.prepareVerificationAttempt(caseId, {
        party_id: party.party_id, party_label: party.label, document_type: documentType,
      });
      attempt.current = {
        id: prepared.attempt_id,
        required: prepared.required,
        uploads: prepared.uploads,
      };
      setStage('document_front');
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err?.code && UNAVAILABLE_CODES.includes(err.code)) {
        // Provider gone, manual route, attempts exhausted, or something already
        // processing. The step owns what the customer is shown for each of
        // these, and none of them is "verification failed".
        toast.info(err.message ?? 'Verification is unavailable just now.');
        await onExit();
        return;
      }
      setStage(err?.code === 'unsupported_document_type' ? 'choose' : 'brief');
      setError(err?.message
        ?? 'We could not start the check just now. Nothing has been used up — please try '
        + 'again in a moment.');
    } finally {
      busy.current = false;
    }
  }, [caseId, party.party_id, party.label, onExit]);

  /**
   * Upload every required photograph, then submit the attempt id.
   *
   * The images go to the exact objects the server named at preparation, over
   * signed permissions it minted. There is no path in this request and no
   * choice about where anything lands.
   */
  const submit = useCallback(async () => {
    if (busy.current) return;
    const prepared = attempt.current;
    if (!prepared) {
      setError('Your check needs to be started again. Nothing has been used up.');
      setStage('choose');
      return;
    }
    busy.current = true;
    setStage('uploading');
    setError(null);
    try {
      for (const kind of ['document_front', 'document_back', 'selfie'] as const) {
        if (!prepared.required[kind]) continue;
        const shot = captures[kind];
        const grant = prepared.uploads[kind];
        if (!shot || !grant) {
          // A capture was lost between taking it and sending it. Send them back
          // to the one that has to be redone rather than failing silently.
          setError('One of your photos was not kept. Please take it again.');
          setStage(kind);
          return;
        }
        const res = await fetch(grant.upload_url, {
          method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: shot.blob,
        });
        if (!res.ok) throw new CaptureUploadFailed(`Upload failed (${res.status})`, kind);
      }

      const result = await amlPortalApi.submitVerificationAttempt(caseId, prepared.id);
      toast.success(result.message);
      setStage('processing');
      await onRefresh();
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string; retake?: IdentityCaptureKind[] };
      if (err?.code && UNAVAILABLE_CODES.includes(err.code)) {
        toast.info(err.message ?? 'Verification is unavailable just now.');
        await onExit();
        return;
      }
      if (err?.code === 'capture_incomplete' && err.retake?.length) {
        // The server checked the objects and one of them is not there. Name the
        // photograph rather than the failure.
        setError('One of your photos did not upload properly. Please take it again.');
        setStage(err.retake[0]);
        return;
      }
      if (e instanceof CaptureUploadFailed) {
        setError('That photo did not upload. Please check your connection and try again — '
          + 'nothing has been used up.');
        setStage(e.kind);
        return;
      }
      setError(err?.message ?? 'Something went wrong. Nothing has been used up — please try '
        + 'again.');
      setStage('selfie');
    } finally {
      busy.current = false;
    }
  }, [caseId, captures, onExit, onRefresh]);

  /**
   * Watch for the result, briefly.
   *
   * Backing off and finite (see `PROCESSING_POLL_MS`), and it stops the moment
   * the server says the check is no longer in flight. `onRefresh` re-reads the
   * canonical status — this component never decides anything from the answer
   * beyond which sentence to show.
   */
  useEffect(() => {
    if (stage !== 'processing') return;
    let cancelled = false;
    let index = 0;
    let timer = 0;

    const tick = async () => {
      if (cancelled) return;
      await onRefresh();
      if (cancelled) return;
      if (index < PROCESSING_POLL_MS.length) {
        timer = window.setTimeout(tick, PROCESSING_POLL_MS[index++]);
      }
      // Past the last delay we simply stop. The focus listener below picks the
      // customer up when they come back, and the step re-reads on mount.
    };

    timer = window.setTimeout(tick, PROCESSING_POLL_MS[index++]);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [stage, onRefresh]);

  /**
   * Coming back to the tab is itself a signal.
   *
   * Somebody who left while the check ran should find the answer waiting, not a
   * spinner that gave up. Guarded on `document.hidden` so a window that was
   * never hidden does not re-read on every focus event.
   */
  useEffect(() => {
    if (stage !== 'processing') return;
    const refresh = () => { if (!document.hidden) void onRefresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [stage, onRefresh]);

  /**
   * The check settled while they watched.
   *
   * Read from the party the parent re-loaded — never from anything this
   * component worked out. `verification_in_progress` going false is the
   * server's statement that processing finished; what it finished as is the
   * step's to render, not this screen's.
   */
  useEffect(() => {
    if (stage !== 'processing') return;
    if (!party.verification_in_progress && party.status !== 'not_started') {
      setStage('received');
    }
  }, [stage, party.verification_in_progress, party.status]);

  const captureStage = stage === 'document_front' || stage === 'document_back'
    || stage === 'selfie' ? stage : null;

  /**
   * The card heading.
   *
   * Deliberately NEUTRAL for the two waiting states. The state itself is
   * carried by the live region below, which is the element a screen reader is
   * told about — putting it in the title as well printed "Checking your
   * identity" twice, one line apart, which reads as a rendering fault rather
   * than emphasis. Seen in a browser; jsdom queries do not notice a duplicate.
   */
  const title = captureStage ? CAPTURE_COPY[captureStage].title
    : stage === 'processing' || stage === 'received' ? 'Identity verification'
      : 'Verify your identity';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          {title}
        </CardTitle>
        <CardDescription>
          {party.label}
          {chosen && stage !== 'choose' && <> · {chosen.label}</>}
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
        {stage === 'choose' && (
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

              `?? ''` and not `?? undefined`: an undefined value makes the group
              UNCONTROLLED, and an uncontrolled group tracks its own selection
              while ours stays null — the option looked chosen and Continue
              stayed disabled. Found in a browser, not in jsdom.
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
                    is the whole of keyboard operation for a radio group.
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
              <Button disabled={!choice} onClick={() => { setStage('brief'); setError(null); }}>
                Continue <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}

        {/* ── B. What to have ready ─────────────────────────────────────── */}
        {stage === 'brief' && choice && chosen && plan && (
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
              Said before the camera opens, not after. Somebody is about to be
              asked for a camera permission and then for a photograph of their
              face, and being told how many photographs and in what order is
              the difference between a step and a surprise.
            */}
            <div className="rounded-md border p-4">
              <p className="text-xs font-medium text-muted-foreground">
                {plan.document_back ? 'Three photos, on this page:' : 'Two photos, on this page:'}
              </p>
              <ol className="mt-2 space-y-1 text-sm">
                <li>1. The front of your {chosen.label.toLowerCase()}</li>
                {plan.document_back && <li>2. The back of it</li>}
                <li>{plan.document_back ? '3.' : '2.'} A photo of your face</li>
              </ol>
              <p className="mt-3 text-xs text-muted-foreground">
                Everything stays on this page — nothing opens a new window and nothing takes you
                to another site. Your photos are sent securely to us, and we check them for you.
              </p>
            </div>

            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="outline" onClick={() => { setStage('choose'); setError(null); }}>
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Change document
              </Button>
              <Button onClick={() => void begin(choice)}>
                <Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Begin secure verification
              </Button>
            </div>
          </div>
        )}

        {/* ── C. Preparing ──────────────────────────────────────────────── */}
        {stage === 'preparing' && (
          <div className="rounded-md border p-4" role="status" aria-live="polite">
            <p className="flex items-center gap-2 text-sm">
              <Loader2
                className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none"
                aria-hidden="true"
              />
              Preparing your secure identity check…
            </p>
          </div>
        )}

        {/* ── D–F. The three captures ───────────────────────────────────── */}
        {captureStage && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {CAPTURE_COPY[captureStage].description}
            </p>
            <CameraCapture
              // Keyed on the stage so moving between captures rebuilds the
              // component: without it the acquisition effect sees the same
              // `facing` value and never reopens the stream, which leaves a
              // black preview and a dead shutter with no way out but a reload.
              key={captureStage}
              facing={CAPTURE_COPY[captureStage].facing}
              existing={captures[captureStage] ?? null}
              onCapture={setCapture(captureStage)}
              confirmLabel={captureStage === 'selfie' ? 'Send securely' : 'Use this photo'}
              onConfirm={() => {
                setError(null);
                if (captureStage === 'document_front') {
                  setStage(attempt.current?.required.document_back ? 'document_back' : 'selfie');
                } else if (captureStage === 'document_back') {
                  setStage('selfie');
                } else {
                  void submit();
                }
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError(null);
                  if (captureStage === 'selfie' && attempt.current?.required.document_back) {
                    setStage('document_back');
                  } else if (captureStage === 'selfie' || captureStage === 'document_back') {
                    setStage('document_front');
                  } else {
                    // Leaving before anything is uploaded. The prepared attempt
                    // is a draft and stays one; nothing has been used up.
                    void onExit();
                  }
                }}
              >
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                {captureStage === 'document_front' ? 'Cancel' : 'Back'}
              </Button>
              <span className="text-xs text-muted-foreground">
                {captureStage === 'selfie' && attempt.current?.required.document_back
                  ? 'Step 3 of 3'
                  : captureStage === 'selfie' ? 'Step 2 of 2'
                    : captureStage === 'document_back' ? 'Step 2 of 3' : 'Step 1'}
              </span>
            </div>
          </div>
        )}

        {/* ── G. Uploading ──────────────────────────────────────────────── */}
        {stage === 'uploading' && (
          <div className="rounded-md border p-4" role="status" aria-live="polite">
            <p className="flex items-center gap-2 text-sm">
              <Loader2
                className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none"
                aria-hidden="true"
              />
              Uploading securely…
            </p>
          </div>
        )}

        {/* ── H–I. Waiting, and the result ──────────────────────────────── */}
        {(stage === 'processing' || stage === 'received') && (
          <div className="space-y-4">
            <div className="rounded-md border p-4" role="status" aria-live="polite">
              {stage === 'processing' ? (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                    Checking your identity
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your photos were received securely. This usually takes under a minute. You can
                    keep this page open, or come back later — we will show the result here.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                    Verification received
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Thank you. There is nothing else for you to do here.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" onClick={() => void onExit()}>
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Back to identity
              </Button>
              {stage === 'processing' && (
                <Button variant="outline" onClick={() => void onRefresh()}>
                  <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> Check now
                </Button>
              )}
              {stage === 'received' && (
                <Button onClick={() => void onExit()}>
                  Return to Identity &amp; Compliance
                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/*
          The documentary route stays on every screen of this flow. Consent to
          biometric collection is genuinely optional (APP 3.3), so refusing has
          to be visible at the moment somebody decides to refuse — not hidden
          behind the check they are declining.
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
