import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2, ShieldCheck, CheckCircle2, AlertTriangle, Camera, ArrowRight, ArrowLeft, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  amlPortalApi, type AmlVerificationParty, type AmlVerificationStatus,
} from '@/lib/aml/amlPortalApi';
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

export function IdentityVerificationStep({
  caseId, onBack, onNext, onNeedsConsent,
}: {
  caseId: string;
  onBack: () => void;
  onNext: () => void;
  onNeedsConsent: () => void;
}) {
  const [state, setState] = useState<AmlVerificationStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeParty, setActiveParty] = useState<AmlVerificationParty | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  /** An open hosted session: the party plus the URL the server just minted. */
  const [hosted, setHosted] = useState<{ party: AmlVerificationParty; url: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await amlPortalApi.verificationStatus(caseId));
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message ?? 'Unable to load verification status.');
    }
  }, [caseId]);

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
      setState(fresh);
      const stillAllowed = fresh.parties.find(
        (p) => (p.party_id ?? null) === (party.party_id ?? null))?.can_attempt;
      if ((fresh.availability ?? 'available') !== 'available' || !stillAllowed) return;

      /**
       * A hosted provider runs its own capture. The session is minted by our
       * backend — never a generic workflow link, which would arrive with no
       * way to tie the result back to this case and party.
       */
      if ((fresh.provider_flow ?? 'capture') === 'hosted') {
        const res = await amlPortalApi.startHostedVerification(caseId, {
          party_id: party.party_id, party_label: party.label,
        });
        if (res.verification_url) {
          setHosted({ party, url: res.verification_url });
        } else {
          // Already in flight or already settled server-side. Re-read rather
          // than guessing, and never assert an outcome from here.
          toast.info(res.message);
          await load();
        }
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
  }, [caseId, load]);

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
                  {party.attempts_used > 0 ? (
                    <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again</>
                  ) : (
                    <><Camera className="mr-1.5 h-3.5 w-3.5" /> Start</>
                  )}
                </Button>
              ) : null}
            </div>

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

      {hosted && (
        <HostedVerificationDialog
          party={hosted.party}
          url={hosted.url}
          onClose={async () => { setHosted(null); await load(); }}
        />
      )}
    </Card>
  );
}

/* ─────────────────────────── hosted verification ────────────────────────── */

/**
 * The permissions the hosted flow is delegated.
 *
 * `camera` is the one that decides whether this works at all — without it the
 * provider's capture step dies on a permission error the customer cannot act
 * on. The rest are the documented embed set: `autoplay` and `encrypted-media`
 * for the liveness video pipeline (a blocked stream reads to the provider as
 * "this device cannot capture"), `clipboard-write` and `picture-in-picture`
 * because the integration snippet grants them, and the motion sensors for the
 * document-tilt and liveness steps.
 *
 * There is deliberately NO `sandbox` attribute. The documented embed does not
 * use one, and the one we had bought nothing: a cross-origin frame already
 * granted `allow-same-origin allow-scripts` is not meaningfully contained by
 * it — the same-origin policy, not the sandbox, is what stops the provider
 * reading this page. What it could do is silently withhold something the
 * capture pipeline needs (downloads, presentation, storage access, pointer
 * lock) and turn that into an unexplained handoff to a second device.
 */
/**
 * Namespaced terminal events, matched by shape rather than by vendor name.
 *
 * Taken from the provider's own published SDK, which posts this vocabulary
 * across the frame boundary. The full set it can send is:
 *
 *   ready · started · step_started · step_changed · step_completed ·
 *   media_started · media_captured · document_selected ·
 *   verification_submitted · status_updated · code_sent · code_verified ·
 *   completed · cancelled · error · close_request
 *
 * Only the last four end the journey. Everything before them happens while
 * the customer is still working, and acting on one takes them out of a flow
 * that was going fine — `step_completed` fires between document and selfie,
 * `verification_submitted` fires while the result is still being computed.
 *
 * Matching the shape rather than the literal keeps the vendor's name out of
 * the portal bundle, for the same reason the expected origin is derived from
 * the server-minted URL instead of being written down here.
 *
 * The colon is load-bearing: `<vendor>:step_completed` ends in "completed",
 * and a substring test would close the dialog on a customer mid-capture.
 * Requiring the separator immediately before the terminal word does not.
 */
const HOSTED_TERMINAL_NAMESPACED =
  /^[a-z][a-z0-9-]*:(completed|cancelled|canceled|error|failed|close_request)$/;

/**
 * Unprefixed spellings, kept as a safety net.
 *
 * The provider's integration writing has used `verification_completed` for
 * the same moment its SDK calls `<vendor>:completed`, and the wire format of
 * an embedded session is not itself published. Recognising too little only
 * costs the customer a button press; recognising a lifecycle event ejects
 * them from a working flow — so this list stays strictly terminal.
 */
const HOSTED_TERMINAL_EVENTS = new Set([
  'verification_completed',
  'verification_complete',
  'verification_failed',
  'verification_cancelled',
  'verification_error',
]);

/**
 * Whether a message means the hosted journey has ended.
 *
 * Reads a NAME and nothing else. It cannot reach a status, a decision or a
 * score, so there is no field an embedded page could set to influence an
 * identity outcome — the strongest thing any message can do is cause NPC to
 * re-read what its own server already knows.
 *
 * Recognising too little is safe (the customer presses "I have finished");
 * recognising too much throws them out of a working flow. Hence terminal-only,
 * matched exactly.
 */
function isHostedTerminalMessage(data: unknown): boolean {
  let payload: unknown = data;
  // The provider's SDK JSON-parses string payloads before reading the type,
  // so an embedded session may send either shape.
  if (typeof payload === 'string') {
    const raw = payload;
    try { payload = JSON.parse(raw); } catch { /* a bare event name */ }
    if (typeof payload === 'string') {
      return HOSTED_TERMINAL_EVENTS.has(raw) || HOSTED_TERMINAL_NAMESPACED.test(raw);
    }
  }
  let name = '';
  if (payload && typeof payload === 'object') {
    const d = payload as Record<string, unknown>;
    for (const key of ['type', 'event', 'name']) {
      if (typeof d[key] === 'string') { name = d[key] as string; break; }
    }
  }
  return HOSTED_TERMINAL_EVENTS.has(name) || HOSTED_TERMINAL_NAMESPACED.test(name);
}

const HOSTED_IFRAME_ALLOW = [
  'camera',
  'microphone',
  'autoplay',
  'encrypted-media',
  'fullscreen',
  'clipboard-write',
  'picture-in-picture',
  'accelerometer',
  'gyroscope',
  'magnetometer',
].join('; ');

/**
 * The provider's own verification flow, embedded in the portal.
 *
 * ## It never reports an outcome
 *
 * There is no path from this component to an identity decision. The `message`
 * listener below is origin-checked and does exactly one thing — re-read server
 * state — because the identity result reaches NPC on a signed
 * server-to-server webhook and nowhere else. Nothing the frame, the customer
 * or a return URL says can mark anybody verified; the strongest claim this
 * screen can make is "we are checking".
 *
 * ## Capturing on this device is the normal path
 *
 * Handing the customer off to a second device is the provider's fallback for
 * one that genuinely cannot capture, and it should stay that way. It became
 * the default because the workflow carried `is_desktop_allowed = false`, which
 * tells the provider to refuse desktop capture outright — fixed in the
 * workflow, not here. This component's job is to not re-create the problem:
 * full permissions, no sandbox, and enough room that the capture UI is usable.
 */
function HostedVerificationDialog({
  party, url, onClose,
}: {
  party: AmlVerificationParty;
  url: string;
  onClose: () => void | Promise<void>;
}) {
  const [closing, setClosing] = useState(false);
  /** Revealed on request. Not shown up front — nothing has failed yet. */
  const [showFallback, setShowFallback] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const done = useCallback(async () => {
    setClosing(true);
    await onClose();
  }, [onClose]);

  /**
   * The provider posts lifecycle messages while the embedded app boots and
   * moves between steps; only a terminal one means the journey has finished.
   * Treating every same-origin message as completion unmounted the iframe
   * during startup, which the customer saw as a white panel that vanished
   * after a few seconds.
   *
   * Three checks, all of which must pass: the origin (derived from the
   * server-minted session URL, never hardcoded, so the portal still does not
   * name a provider), the source (this exact frame, so a popup or a nested
   * frame cannot speak for it), and the event name against a terminal
   * allow-list.
   *
   * Only the NAME is read. Nothing in the payload can reach an identity
   * outcome, because the sole action available here is to re-read what the
   * server already knows.
   */
  const origin = useMemo(() => {
    try { return new URL(url).origin; } catch { return null; }
  }, [url]);

  useEffect(() => {
    if (!origin) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isHostedTerminalMessage(event.data)) return;
      void done();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, done]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-background/80 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Verify ${party.label}`}
    >
      {/*
        Full-bleed on a phone, where the capture UI needs every pixel it can
        get, and a generous panel on a desktop. The old fixed `h-[60vh]` inside
        a `max-w-2xl` card squeezed a camera viewfinder into a small inner
        scroll box with the controls below the fold.
      */}
      <Card className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-none sm:h-[min(90vh,900px)] sm:rounded-lg">
        <CardHeader className="shrink-0 py-3">
          <CardTitle className="text-base">Verify your identity</CardTitle>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 p-0 sm:px-4 sm:pb-4">
          <iframe
            ref={iframeRef}
            src={url}
            title="Identity verification"
            className="min-h-0 w-full flex-1 border-0 sm:rounded-md sm:border"
            allow={HOSTED_IFRAME_ALLOW}
            allowFullScreen
          />

          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 sm:px-0 sm:pb-0">
            <Button variant="ghost" size="sm" onClick={done} disabled={closing}>
              Cancel
            </Button>

            <div className="flex items-center gap-3">
              {/*
                Offered quietly, and only when asked for. Leading with "camera
                not working?" told every customer something had gone wrong
                before anything had.
              */}
              {showFallback ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs underline underline-offset-2"
                >
                  Open in a new tab
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowFallback(true)}
                  className="text-xs text-muted-foreground underline underline-offset-2"
                >
                  Having trouble?
                </button>
              )}

              <Button size="sm" onClick={done} disabled={closing}>
                {closing ? (
                  <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Checking…</>
                ) : (
                  <>I have finished <ArrowRight className="ml-1 h-4 w-4" /></>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
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
