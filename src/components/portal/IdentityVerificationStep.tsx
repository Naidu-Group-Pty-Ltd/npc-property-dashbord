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

  // Revoke object URLs on unmount — these hold image data in memory.
  useEffect(() => () => {
    if (documentShot) URL.revokeObjectURL(documentShot.url);
    if (selfieShot) URL.revokeObjectURL(selfieShot.url);
  }, [documentShot, selfieShot]);

  const submit = async () => {
    if (!documentShot || !selfieShot) return;
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

      const [docPath, selfiePath] = [
        await upload(documentShot.blob, 'document'),
        await upload(selfieShot.blob, 'selfie'),
      ];

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
              onCapture={(c) => setDocumentShot(c)}
              onConfirm={() => setStage('selfie')}
            />
          )}

          {stage === 'selfie' && (
            <CameraCapture
              facing="user"
              existing={selfieShot}
              onCapture={(c) => setSelfieShot(c)}
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

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser cannot use the camera.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch {
        setCameraError('We could not open your camera. You can upload a photo instead.');
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [facing, stop]);

  const shoot = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onCapture({ blob, url: URL.createObjectURL(blob) });
      stop();
      setReady(false);
    }, 'image/jpeg', 0.92);
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
          <Button variant="outline" className="flex-1" onClick={() => onCapture(null)}>
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
          />
          <Button className="w-full" onClick={shoot} disabled={!ready}>
            <Camera className="mr-2 h-4 w-4" /> Take photo
          </Button>
        </>
      )}

      {cameraError && (
        <Alert>
          <AlertDescription className="text-xs">{cameraError}</AlertDescription>
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
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onCapture({ blob: file, url: URL.createObjectURL(file) });
          }}
        />
      </label>
    </div>
  );
}
