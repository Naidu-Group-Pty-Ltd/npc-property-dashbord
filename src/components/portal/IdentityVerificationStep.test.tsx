import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The Client Portal identity-verification step.
 *
 * These cover the two ways the electronic flow dead-ended in front of a
 * customer: a camera that never came back after Retake, and a capture step
 * offered on a case where the server would refuse the upload.
 */

const verificationStatus = vi.fn();
const startHostedVerification = vi.fn();
const submitVerification = vi.fn();
vi.mock('@/lib/aml/amlPortalApi', () => ({
  amlPortalApi: {
    verificationStatus: (...a: unknown[]) => verificationStatus(...a),
    requestVerificationUpload: vi.fn(),
    submitVerification: (...a: unknown[]) => submitVerification(...a),
    startHostedVerification: (...a: unknown[]) => startHostedVerification(...a),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { IdentityVerificationStep } from './IdentityVerificationStep';

/**
 * Counts how many times the camera is opened, records the requested facing
 * mode, and hands back stoppable tracks.
 */
function mockCamera(opts: { fail?: boolean; dimensions?: [number, number] } = {}) {
  const stops: Array<() => void> = [];
  const facings: string[] = [];
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    facings.push(String((constraints.video as MediaTrackConstraints)?.facingMode ?? ''));
    if (opts.fail) throw new DOMException('Permission denied', 'NotAllowedError');
    const stop = vi.fn();
    stops.push(stop);
    return { getTracks: () => [{ stop }] } as unknown as MediaStream;
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia }, configurable: true, writable: true,
  });
  // jsdom implements none of these, and the component must not depend on
  // play() resolving for the preview to become usable.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    value: vi.fn().mockResolvedValue(undefined), configurable: true, writable: true,
  });
  const [w, h] = opts.dimensions ?? [1280, 960];
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    get: () => w, configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    get: () => h, configurable: true,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    get: () => 1 /* HAVE_METADATA */, configurable: true,
  });
  return { getUserMedia, stops, facings };
}

/** Stand in for the canvas encoder jsdom does not implement. */
function stubCanvas(blob: Blob | null = new Blob(['jpeg'], { type: 'image/jpeg' })) {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as any;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(blob); } as any;
}

/**
 * Open the capture dialog and let the camera effect settle.
 *
 * `/^start$/` rather than `/start/`: the shoot button reads "Starting camera…"
 * until the stream is ready, and would otherwise match.
 */
async function openDialog() {
  fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
  // getUserMedia → play() → setReady is a promise chain; flush it inside act
  // so the ready-gated button has rendered before anything looks for it.
  await act(async () => { await Promise.resolve(); });
}

/** Walk the dialog to the selfie step, leaving the selfie camera open. */
async function reachSelfieStep() {
  await openDialog();
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
  });
  fireEvent.click(await screen.findByRole('button', { name: /use this photo/i }));
}

const party = {
  party_id: null, label: 'You', status: 'not_started' as const,
  attempts_used: 0, attempts_remaining: 3, can_attempt: true,
};

const status = (over: Record<string, unknown> = {}) => ({
  enabled: true, max_attempts: 3, biometric_consent_accepted: true,
  availability: 'available', parties: [party], ...over,
});

const noop = () => {};
const renderStep = () => render(
  <IdentityVerificationStep caseId="case-1" onBack={noop} onNext={noop} onNeedsConsent={noop} />,
);

beforeEach(() => {
  verificationStatus.mockReset();
  startHostedVerification.mockReset();
  submitVerification.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:capture');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('identity verification step', () => {
  it('reopens the camera after Retake', async () => {
    // The defect: Retake cleared the capture and re-rendered the preview, but
    // the acquisition effect keyed only on `facing`, which had not changed. It
    // never re-ran, the stream stopped by the previous shot was never
    // replaced, and the customer was left with a black preview and a dead
    // button — no way out but reloading the page.
    const camera = mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();

    fireEvent.click(await screen.findByRole('button', { name: /start/i }));
    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    const retake = await screen.findByRole('button', { name: /retake/i });
    expect(camera.stops[0], 'the shot should release the camera').toHaveBeenCalled();

    fireEvent.click(retake);
    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: /take photo/i })).toBeTruthy();
  });

  it('restarts the rear camera for a document retake and the front camera for a selfie retake', async () => {
    const camera = mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();

    fireEvent.click(await screen.findByRole('button', { name: /start/i }));
    await waitFor(() => expect(camera.facings).toEqual(['environment']));

    // Document retake reopens the environment-facing camera.
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    fireEvent.click(await screen.findByRole('button', { name: /retake/i }));
    await waitFor(() => expect(camera.facings).toEqual(['environment', 'environment']));

    // Advance to the selfie step, then retake there.
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    fireEvent.click(await screen.findByRole('button', { name: /use this photo/i }));
    await waitFor(() => expect(camera.facings).toEqual(['environment', 'environment', 'user']));

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });
    fireEvent.click(await screen.findByRole('button', { name: /retake/i }));
    await waitFor(() =>
      expect(camera.facings).toEqual(['environment', 'environment', 'user', 'user']));

    // Every stream opened along the way was stopped, so no duplicate remains.
    expect(camera.stops).toHaveLength(4);
    camera.stops.slice(0, 3).forEach((stop, i) =>
      expect(stop, `stream ${i} should be stopped`).toHaveBeenCalled());
  });

  it('stops the document camera when the selfie step opens', async () => {
    const camera = mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();
    await reachSelfieStep();

    await waitFor(() => expect(camera.facings).toContain('user'));
    expect(camera.stops[0], 'the document stream must not stay open').toHaveBeenCalled();
  });

  it('stops every track when the dialog is closed', async () => {
    const camera = mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();
    await openDialog();
    await waitFor(() => expect(camera.stops).toHaveLength(1));

    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(camera.stops[0]).toHaveBeenCalled());
  });

  it('will not take a photo before the video has real dimensions', async () => {
    // The blank-frame defect: a zero-height stream must not produce a capture.
    mockCamera({ dimensions: [1280, 0] });
    verificationStatus.mockResolvedValue(status());
    stubCanvas();

    renderStep();
    await openDialog();

    const shoot = await screen.findByRole('button', { name: /starting camera/i });
    expect((shoot as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a visible error when the customer denies camera permission', async () => {
    mockCamera({ fail: true });
    verificationStatus.mockResolvedValue(status());

    renderStep();
    await openDialog();

    expect(await screen.findByText(/could not open your camera/i)).toBeTruthy();
    // The manual file fallback stays available so they are not dead-ended.
    expect(await screen.findByText(/upload a photo from this device/i)).toBeTruthy();
  });

  it('shows a visible error when the capture cannot be encoded', async () => {
    // canvas.toBlob returning null used to be swallowed, so the button looked
    // inert and nothing told the customer anything had gone wrong.
    mockCamera();
    verificationStatus.mockResolvedValue(status());
    stubCanvas(null);

    renderStep();
    await openDialog();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /take photo/i }));
    });

    expect(await screen.findByText(/could not process the photo/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retake/i }), 'no capture was kept').toBeNull();
  });

  it('refuses a HEIC chosen from the photo library and says what to do instead', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(status());

    renderStep();
    await openDialog();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const heic = new File(['x'], 'IMG_4021.HEIC', { type: 'image/heic' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [heic] } });
    });

    expect(await screen.findByText(/HEIC photos cannot be checked/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retake/i }), 'nothing was captured').toBeNull();
  });

  it('does not offer capture when the server would refuse the upload', async () => {
    // Offering "Start" here is the contradiction the request router was fixed
    // to avoid: the selfie upload URL is gated on the same availability, so
    // the customer photographed their face and was refused afterwards.
    mockCamera();
    verificationStatus.mockResolvedValue(
      status({ availability: 'manual_verification_required' }));

    renderStep();

    // The documentary route is the route, not "nothing to do": the client is
    // sent to upload their document rather than told to wait for an adviser
    // who is in fact waiting on them.
    expect(await screen.findByText(/verify your identity from your documents/i)).toBeTruthy();
    expect(await screen.findByRole('button', { name: /upload identity document/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull();
  });

  it('says nothing has been used up when the check is only temporarily down', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(
      status({ availability: 'temporarily_unavailable' }));

    renderStep();

    expect(await screen.findByText(/nothing has been used up/i)).toBeTruthy();
    // Even a transient outage offers the working route rather than only a wait.
    expect(await screen.findByRole('button', { name: /upload identity document/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull();
  });

  it('still offers capture when a provider is available', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(status());

    renderStep();

    expect(await screen.findByRole('button', { name: /start/i })).toBeTruthy();
  });
});

/**
 * The hosted-provider flow, rendered for real.
 *
 * A live run against the provider's own page is not possible here — outbound
 * browser traffic is blocked in this environment — so what is verified is the
 * half NPC owns: that the server decides the flow, that the session comes from
 * our backend, that the frame is built with the permissions the capture needs,
 * and that finishing in that frame cannot mark anybody verified.
 */
describe('hosted provider flow', () => {
  const hostedStatus = (over: Record<string, unknown> = {}) =>
    status({ provider_flow: 'hosted', ...over });

  it('opens the provider session inside the portal, from a server-minted URL', async () => {
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: 'https://verify.didit.me/session/TOKEN',
      message: 'Follow the steps to verify your identity.',
    });

    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));

    await waitFor(() => expect(startHostedVerification).toHaveBeenCalled());
    // The session is requested from OUR backend for THIS party — never a
    // generic workflow link, which would arrive with no way to correlate it.
    expect(startHostedVerification).toHaveBeenCalledWith('case-1', {
      party_id: null, party_label: 'You',
    });

    const frame = await waitFor(() => {
      const el = document.querySelector('iframe');
      if (!el) throw new Error('no iframe');
      return el;
    });
    expect(frame.getAttribute('src')).toBe('https://verify.didit.me/session/TOKEN');
  });

  /** Opens the hosted flow and hands back the frame. */
  const openHosted = async () => {
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: 'https://verify.didit.me/session/TOKEN', message: 'go',
    });

    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
    return await waitFor(() => {
      const el = document.querySelector('iframe');
      if (!el) throw new Error('no iframe');
      return el;
    });
  };

  it('delegates every permission the provider documents for its embed', async () => {
    const frame = await openHosted();
    const allow = frame.getAttribute('allow') ?? '';

    // `camera` is the one that decides whether this works at all. The rest are
    // the provider's documented embed set — and the two that were missing,
    // `autoplay` and `encrypted-media`, are what the liveness video pipeline
    // needs: a blocked stream reads to the provider as "this device cannot
    // capture", which is exactly how a same-device flow turns into a QR code.
    for (const permission of ['camera', 'microphone', 'autoplay', 'encrypted-media',
      'fullscreen', 'clipboard-write', 'picture-in-picture',
      'accelerometer', 'gyroscope', 'magnetometer']) {
      expect(allow).toContain(permission);
    }
    expect(frame.hasAttribute('allowfullscreen')).toBe(true);
  });

  it('does not sandbox the provider frame', async () => {
    const frame = await openHosted();

    // A cross-origin frame already granted `allow-same-origin allow-scripts`
    // is not meaningfully contained by a sandbox — the same-origin policy is
    // what stops the provider reading this page. What the attribute *can* do
    // is silently withhold something the capture pipeline needs and turn that
    // into an unexplained cross-device handoff.
    expect(frame.hasAttribute('sandbox')).toBe(false);
  });

  it('does not lead with a camera-failure warning before anything has failed', async () => {
    await openHosted();

    // The old dialog rendered a permanent notice about the camera not working
    // above the frame, so every customer met an error message on a screen
    // where nothing had gone wrong yet.
    expect(screen.queryByRole('link', { name: /new tab/i })).toBeNull();
    expect(screen.queryByText(/camera (is )?(not|isn't) work/i)).toBeNull();
    expect(screen.queryByText(/blocked/i)).toBeNull();
  });

  it('reveals the new-tab fallback only when the customer asks for it', async () => {
    await openHosted();

    fireEvent.click(await screen.findByRole('button', { name: /having trouble/i }));

    const link = await screen.findByRole('link', { name: /new tab/i });
    expect(link.getAttribute('href')).toBe('https://verify.didit.me/session/TOKEN');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('offers exactly one "I have finished" control', async () => {
    await openHosted();

    // There were two — one in the dialog body and one in its footer — which
    // read as two different actions with two different meanings.
    expect(screen.getAllByRole('button', { name: /i have finished/i })).toHaveLength(1);
  });

  it('ignores provider lifecycle messages until verification is complete', async () => {
    const frame = await openHosted();
    const callsBefore = verificationStatus.mock.calls.length;

    // Every one of these arrives mid-journey. Closing on any of them takes the
    // customer out of a working capture — which is how the dialog came to look
    // like a white panel that vanished after a few seconds.
    //
    // `*:step_completed` is the trap: a substring test for "completed" catches
    // it, and it fires while the customer is still photographing a document.
    // Every non-terminal name the provider's published SDK can post, plus the
    // shapes a stray sender might use.
    for (const data of [
      { type: 'verification_started', sessionId: 'session-1' },
      { type: 'didit:ready' },
      { type: 'didit:started' },
      { type: 'didit:step_started', step: 'document' },
      { type: 'didit:step_changed', step: 'liveness' },
      { type: 'didit:step_completed', step: 'document' },
      { type: 'didit:media_started', mediaType: 'camera' },
      { type: 'didit:media_captured', step: 'document' },
      { type: 'didit:document_selected', documentType: 'PASSPORT' },
      // Fires while the result is still being computed — closing here would
      // drop the customer out during processing.
      { type: 'didit:verification_submitted', step: 'liveness' },
      { type: 'didit:status_updated', status: 'In Progress' },
      { type: 'resize', height: 900 },
      { type: '' },
      'didit:step_completed',
      JSON.stringify({ type: 'didit:step_completed' }),
      null,
      42,
    ]) {
      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', {
          origin: 'https://verify.didit.me',
          source: frame.contentWindow,
          data,
        }));
        await Promise.resolve();
      });
      expect(verificationStatus.mock.calls.length, JSON.stringify(data)).toBe(callsBefore);
      expect(document.querySelector('iframe'), JSON.stringify(data)).toBeTruthy();
    }
  });

  it('recognises the terminal event under any of the spellings the provider uses', async () => {
    // The provider documents this vocabulary for its SDK callback but does not
    // publish the wire format an embedded session posts, and the two have not
    // historically agreed. Recognising too little only costs the customer a
    // button press; recognising a lifecycle event ejects them from a working
    // flow — so the set is wide but strictly terminal.
    for (const data of [
      // The four terminal names the provider's own SDK switches on.
      { type: 'didit:completed' },
      { type: 'didit:cancelled' },
      { type: 'didit:error' },
      { type: 'didit:close_request' },
      // Alternative carriers and spellings.
      { event: 'didit:completed' },
      { name: 'didit:error' },
      { type: 'verification_completed' },
      { type: 'verification_complete' },
      { type: 'verification_failed' },
      'verification_completed',
      JSON.stringify({ type: 'didit:completed' }),
    ]) {
      cleanup();
      verificationStatus.mockClear();
      const frame = await openHosted();
      const callsBefore = verificationStatus.mock.calls.length;

      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', {
          origin: 'https://verify.didit.me', source: frame.contentWindow, data,
        }));
      });

      await waitFor(() =>
        expect(verificationStatus.mock.calls.length, JSON.stringify(data))
          .toBeGreaterThan(callsBefore));
    }
  });

  it('ignores a completion message from something other than this frame', async () => {
    await openHosted();
    const callsBefore = verificationStatus.mock.calls.length;

    // Right origin, real event name, wrong window: a popup or a nested frame
    // on the provider's origin cannot speak for the customer's session.
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://verify.didit.me',
        source: window,
        data: { type: 'verification_completed' },
      }));
      await Promise.resolve();
    });

    expect(verificationStatus.mock.calls.length).toBe(callsBefore);
    expect(document.querySelector('iframe')).toBeTruthy();
  });

  it('a provider completion message only re-reads server state — it cannot mark verified', async () => {
    const frame = await openHosted();
    const callsBefore = verificationStatus.mock.calls.length;

    // The completion payload can claim success, but it can do no more than make
    // NPC ask its own server what happened. Status/decision fields are ignored.
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://verify.didit.me',
        source: frame.contentWindow,
        data: {
          type: 'verification_complete', sessionId: 'session-1',
          status: 'Approved', verified: true, decision: 'passed',
        },
      }));
    });

    await waitFor(() =>
      expect(verificationStatus.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(screen.queryByText(/verified/i)).toBeNull();
    expect(submitVerification).not.toHaveBeenCalled();
  });

  it('ignores messages from any other origin', async () => {
    await openHosted();
    const callsBefore = verificationStatus.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://verify.didit.me.attacker.example',
        data: { status: 'Approved' },
      }));
      await Promise.resolve();
    });

    expect(verificationStatus.mock.calls.length).toBe(callsBefore);
    // The frame is still open — a stranger cannot close the customer's session.
    expect(document.querySelector('iframe')).toBeTruthy();
  });

  it('never captures a document or selfie itself when hosted is active', async () => {
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: 'https://verify.didit.me/session/TOKEN', message: 'go',
    });
    const camera = mockCamera();

    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
    await waitFor(() => expect(document.querySelector('iframe')).toBeTruthy());

    // The provider owns the capture; NPC opening a camera here would collect a
    // second copy of the customer's face for no purpose it can serve.
    expect(camera.getUserMedia).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /take photo/i })).toBeNull();
  });

  it('"I have finished" re-reads the server and asserts nothing itself', async () => {
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: 'https://verify.didit.me/session/TOKEN', message: 'go',
    });

    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
    await waitFor(() => expect(document.querySelector('iframe')).toBeTruthy());

    const callsBefore = verificationStatus.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /i have finished/i }));
    });

    // The customer saying they are done is a hint to re-read, not evidence.
    await waitFor(() =>
      expect(verificationStatus.mock.calls.length).toBeGreaterThan(callsBefore));
    // The party still reads as the server reports it — not "verified".
    expect(screen.queryByText(/verified/i)).toBeNull();
  });

  it('an already-open session is reported, not duplicated', async () => {
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: false, code: 'already_processing',
      message: 'Your verification is already open.',
    });

    renderStep();
    // `findByRole` must stay OUTSIDE act(): awaiting a query inside it blocks
    // the microtask flush the query itself is waiting on.
    const start = await screen.findByRole('button', { name: /^start$/i });
    await act(async () => { fireEvent.click(start); });

    // No frame is opened against a URL we do not have, and the step re-reads.
    await waitFor(() => expect(document.querySelector('iframe')).toBeNull());
    expect(startHostedVerification).toHaveBeenCalled();
  });

  it('falls back to NPC capture when the server says the flow is capture', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(status({ provider_flow: 'capture' }));

    renderStep();
    const startBtn = await screen.findByRole('button', { name: /^start$/i });
    fireEvent.click(startBtn);
    await act(async () => { await Promise.resolve(); });

    // The self-hosted path is untouched: the camera dialog, not a frame.
    expect(startHostedVerification).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
    expect(await screen.findByText(/photograph your ID/i)).toBeTruthy();
  });
});
