import { useCallback, useEffect, useRef, useState } from 'react';
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

  const load = useCallback(async () => {
    try {
      setState(await amlPortalApi.verificationStatus(caseId));
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message ?? 'Unable to load verification status.');
    }
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

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
              ? 'The photo check is not available for your case. Your adviser will verify your identity from your documents instead — there is nothing you need to do here, and no disadvantage to you.'
              : 'The photo check is temporarily unavailable. Nothing has been used up. Please come back shortly, or upload your identity document and your adviser will take it from there.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <Button onClick={onNext}>Continue <ArrowRight className="ml-1 h-4 w-4" /></Button>
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
                  variant={party.attempts_used > 0 ? 'outline' : 'default'}
                  onClick={() => setActiveParty(party)}
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
        />
      )}
    </Card>
  );
}

/* ─────────────────────────────── capture ────────────────────────────────── */

function CaptureDialog({
  caseId, party, onClose, onDone,
}: {
  caseId: string;
  party: AmlVerificationParty;
  onClose: () => void;
  onDone: () => void | Promise<void>;
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
      const upload = async (blob: Blob, kind: 'document' | 'selfie') => {
        const meta = await amlPortalApi.requestVerificationUpload(caseId, kind);
        const put = await fetch(meta.upload_url, {
          method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        return meta.path;
      };

      // Sequential and document-first: the selfie URL is the request that
      // checks attempts and provider readiness, so a refusal happens before a
      // face is uploaded rather than after (APP 3 — no collection without a
      // purpose that can be served).
      const docPath = await upload(documentShot.blob, 'document');
      const selfiePath = await upload(selfieShot.blob, 'selfie');

      const res = await amlPortalApi.submitVerification(caseId, {
        party_id: party.party_id,
        party_label: party.label,
        document_storage_path: docPath,
        selfie_storage_path: selfiePath,
      });
      toast.success(res.message);
      await onDone();
    } catch (e: any) {
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
        // `play()` resolving does not mean there are pixels: videoWidth is
        // still 0 until metadata arrives. Shooting then produced a blank
        // frame that uploaded happily and came back "no face found".
        if (!cancelled && video.videoWidth > 0) setReady(true);
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
            onLoadedMetadata={(e) => {
              if (e.currentTarget.videoWidth > 0) setReady(true);
            }}
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
          accept="image/*"
          capture={facing === 'user' ? 'user' : 'environment'}
          className="mt-1 block w-full text-xs"
          disabled={working}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset the input so choosing the same file twice still fires.
            e.currentTarget.value = '';
            // Everything reaching the service is JPEG within its own working
            // bound — see toUploadableJpeg. A HEIC straight from an iPhone
            // library used to reach OpenCV and come back as a 400.
            if (file) void capture(() => toUploadableJpeg(file));
          }}
        />
        <span className="mt-1 block text-[11px] text-muted-foreground">
          Photos are resized to {MAX_CAPTURE_EDGE_PX}px before they are sent.
        </span>
      </label>
    </div>
  );
}
