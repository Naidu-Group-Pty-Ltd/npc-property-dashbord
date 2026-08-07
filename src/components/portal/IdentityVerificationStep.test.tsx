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
vi.mock('@/lib/aml/amlPortalApi', () => ({
  amlPortalApi: {
    verificationStatus: (...a: unknown[]) => verificationStatus(...a),
    requestVerificationUpload: vi.fn(),
    submitVerification: vi.fn(),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
