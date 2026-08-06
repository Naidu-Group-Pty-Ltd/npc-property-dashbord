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

/** Counts how many times the camera is opened, and hands back stoppable tracks. */
function mockCamera() {
  const stops: Array<() => void> = [];
  const getUserMedia = vi.fn(async () => {
    const stop = vi.fn();
    stops.push(stop);
    return { getTracks: () => [{ stop }] } as unknown as MediaStream;
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia }, configurable: true, writable: true,
  });
  // jsdom implements neither, and the component must not depend on either
  // resolving for the preview to appear.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    value: vi.fn().mockResolvedValue(undefined), configurable: true, writable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    get: () => 1280, configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    get: () => 960, configurable: true,
  });
  return { getUserMedia, stops };
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
    // jsdom has no canvas encoder; stand one in so a shot produces a capture.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as any;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
    } as any;

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

  it('does not offer capture when the server would refuse the upload', async () => {
    // Offering "Start" here is the contradiction the request router was fixed
    // to avoid: the selfie upload URL is gated on the same availability, so
    // the customer photographed their face and was refused afterwards.
    mockCamera();
    verificationStatus.mockResolvedValue(
      status({ availability: 'manual_verification_required' }));

    renderStep();

    expect(await screen.findByText(/adviser will verify your identity/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull();
  });

  it('says nothing has been used up when the check is only temporarily down', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(
      status({ availability: 'temporarily_unavailable' }));

    renderStep();

    expect(await screen.findByText(/nothing has been used up/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull();
  });

  it('still offers capture when a provider is available', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(status());

    renderStep();

    expect(await screen.findByRole('button', { name: /start/i })).toBeTruthy();
  });
});
