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
 * The secure identity check, rendered for real.
 *
 * A live run against the provider's own page is not possible here — outbound
 * browser traffic is blocked in this environment — so what is verified is the
 * half NPC owns: that NPC asks which document before anything is created, that
 * the window is opened synchronously inside the click (the rule that decides
 * whether this works at all on default browser settings), that a blocked or
 * closed window is never reported as a verification failure, and that nothing
 * reaching the browser — a message, a callback, a closed window — can mark
 * anybody verified.
 */
describe('secure identity check', () => {
  const hostedStatus = (over: Record<string, unknown> = {}) =>
    status({ provider_flow: 'hosted', ...over });

  const SESSION_URL = 'https://verify.didit.me/session/TOKEN';

  /**
   * A stand-in for the window the browser would open.
   *
   * jsdom's `window.open` returns null, which is indistinguishable from a
   * blocked popup — so every test that expects a window installs this, and the
   * blocked-popup test is the one that does not.
   */
  function mockPopup(opts: { blocked?: boolean } = {}) {
    const replace = vi.fn();
    const popup = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn(() => { popup.closed = true; }),
      location: { replace },
      document: { write: vi.fn(), close: vi.fn() },
    };
    const open = vi.spyOn(window, 'open')
      .mockImplementation(() => (opts.blocked ? null : popup as unknown as Window));
    return { open, popup, replace };
  }

  /** Walk from the party list to the launch screen for one document. */
  async function chooseDocument(name: RegExp = /driver licence/i) {
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
    fireEvent.click(await screen.findByRole('radio', { name }));
    fireEvent.click(await screen.findByRole('button', { name: /^continue$/i }));
    return await screen.findByRole('button', { name: /begin secure verification/i });
  }

  /* ── document selection ──────────────────────────────────────────────── */

  it('asks which document before creating anything', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());

    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));

    expect(await screen.findByText(/which identity document will you use/i)).toBeTruthy();
    // Nothing has been created and no window has been opened: choosing a
    // document is NPC's screen, and a session that a customer never begins is
    // one the provider still charges an allowance for.
    expect(startHostedVerification).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('offers exactly the four supported Australian documents, and no country picker', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());

    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
    await screen.findByRole('radio', { name: /passport/i });

    const options = screen.getAllByRole('radio').map((el) => el.getAttribute('value'));
    expect(options).toEqual(['passport', 'driver_licence', 'identity_card', 'residence_permit']);

    // Australia is enforced server-side and never asked about. A Medicare,
    // health or concession card is not an identity document here and is not
    // named — naming one only to refuse it invites the client to try it.
    expect(screen.queryByText(/select.*country|choose.*country/i)).toBeNull();
    expect(screen.queryByText(/medicare|concession|health care card/i)).toBeNull();
  });

  it('choosing a document arms Continue', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());

    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));
    const proceed = await screen.findByRole('button', { name: /^continue$/i });

    // Nothing chosen, nothing to proceed with.
    expect(proceed).toBeDisabled();

    /*
     * A regression guard for a bug a browser found and jsdom did not: the
     * group was given `value={choice ?? undefined}`, and an undefined value
     * makes a Radix radio group UNCONTROLLED. The option rendered as selected
     * from the group's own internal state while ours stayed null, so the
     * customer could see their document chosen and still find Continue dead.
     */
    fireEvent.click(await screen.findByRole('radio', { name: /passport/i }));
    await waitFor(() => expect(proceed).not.toBeDisabled());
  });

  it('sends the chosen document and never a provider, workflow or country', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: SESSION_URL, message: 'ok',
    });

    renderStep();
    fireEvent.click(await chooseDocument(/passport/i));
    await waitFor(() => expect(startHostedVerification).toHaveBeenCalled());

    // The document type is the ONLY thing the browser declares. Provider
    // selection, workflow authority and environment stay server-side; a
    // browser that could name any of them would be choosing its own authority.
    expect(startHostedVerification).toHaveBeenCalledWith('case-1', {
      party_id: null, party_label: 'You', document_type: 'passport',
    });
    const [, params] = startHostedVerification.mock.calls[0];
    expect(Object.keys(params).sort())
      .toEqual(['document_type', 'party_id', 'party_label']);
  });

  /* ── the window ──────────────────────────────────────────────────────── */

  it('opens the window synchronously in the click, before the session call', async () => {
    const { open, replace } = mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    let resolveSession: (v: unknown) => void = () => {};
    startHostedVerification.mockReturnValue(new Promise((r) => { resolveSession = r; }));

    renderStep();
    const begin = await chooseDocument();
    fireEvent.click(begin);

    /*
     * The whole popup rule, in two assertions: the window exists before the
     * session promise has resolved, and it was opened blank. Awaiting the API
     * first and opening afterwards is what browsers classify as an unsolicited
     * popup and block on default settings.
     */
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe('');
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      resolveSession({ started: true, verification_url: SESSION_URL, message: 'ok' });
    });

    // Only now is the window we already hold pointed at the session.
    await waitFor(() => expect(replace).toHaveBeenCalledWith(SESSION_URL));
    // And it is still ONE window — never a second one opened at the URL.
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('shows verification in progress once the window is open', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: SESSION_URL, message: 'ok',
    });

    renderStep();
    fireEvent.click(await chooseDocument());

    expect(await screen.findByText(/identity verification in progress/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /re-open verification/i })).toBeTruthy();
  });

  it('never embeds the provider in the portal', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: SESSION_URL, message: 'ok',
    });

    renderStep();
    fireEvent.click(await chooseDocument());
    await screen.findByText(/identity verification in progress/i);

    // The iframe is gone for good: a third-party application inside NPC's page
    // is the confusion this work exists to remove.
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('double-clicking Begin creates one session, not two', async () => {
    const { open } = mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: SESSION_URL, message: 'ok',
    });

    renderStep();
    const begin = await chooseDocument();
    fireEvent.click(begin);
    fireEvent.click(begin);
    await waitFor(() => expect(startHostedVerification).toHaveBeenCalled());

    expect(startHostedVerification).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('handles a blocked popup without losing the session or blaming the client', async () => {
    const { open } = mockPopup({ blocked: true });
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: SESSION_URL, message: 'ok',
    });

    renderStep();
    fireEvent.click(await chooseDocument());

    expect(await screen.findByText(/could not open the secure verification window/i)).toBeTruthy();
    // Not a failure, and not an attempt: the wording has to say so, because a
    // customer told "verification failed" by their own pop-up blocker will
    // stop trying.
    expect(screen.getByText(/nothing has been used up/i)).toBeTruthy();

    /*
     * Recovery is ONE press. The session was created even though the window
     * was refused, and its URL is held in memory — so the retry is a direct
     * response to a click rather than another promise the browser would
     * block in turn.
     */
    const callsBefore = startHostedVerification.mock.calls.length;
    open.mockReturnValue({
      closed: false, focus: vi.fn(), close: vi.fn(),
      location: { replace: vi.fn() }, document: { write: vi.fn(), close: vi.fn() },
    } as unknown as Window);
    fireEvent.click(screen.getByRole('button', { name: /open verification/i }));

    await waitFor(() => expect(screen.getByText(/identity verification in progress/i)).toBeTruthy());
    expect(open).toHaveBeenLastCalledWith(SESSION_URL, expect.any(String), expect.any(String));
    expect(startHostedVerification.mock.calls.length).toBe(callsBefore);
  });

  it('a closed window is not a failure — it offers Continue and re-reads the server', async () => {
    const { popup } = mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: SESSION_URL, message: 'ok',
    });

    renderStep();
    fireEvent.click(await chooseDocument());
    await screen.findByText(/identity verification in progress/i);

    const readsBefore = verificationStatus.mock.calls.length;
    popup.closed = true;

    // Real timers: the watcher polls once a second, because there is no
    // cross-origin close event to listen for.
    expect(await screen.findByText(/has not been confirmed yet/i, {}, { timeout: 4000 }))
      .toBeTruthy();
    // Never "failed" and never "cancelled": the window closing says nothing
    // about what happened inside it. They may have finished.
    expect(screen.queryByText(/failed|unsuccessful/i)).toBeNull();
    expect(screen.getByRole('button', { name: /continue verification/i })).toBeTruthy();
    // The server is asked; the browser does not decide.
    expect(verificationStatus.mock.calls.length).toBeGreaterThan(readsBefore);
  });

  it('re-opening focuses the window it already has rather than minting another', async () => {
    const { open, popup } = mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: SESSION_URL, message: 'ok',
    });

    renderStep();
    fireEvent.click(await chooseDocument());
    await screen.findByText(/identity verification in progress/i);

    fireEvent.click(screen.getByRole('button', { name: /re-open verification/i }));

    expect(popup.focus).toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(startHostedVerification).toHaveBeenCalledTimes(1);
  });

  /* ── nothing here can settle a verification ──────────────────────────── */

  it('the return message only re-reads server state — it cannot mark verified', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: SESSION_URL, message: 'ok',
    });

    renderStep();
    fireEvent.click(await chooseDocument());
    await screen.findByText(/identity verification in progress/i);

    const readsBefore = verificationStatus.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        // Everything a hostile page would put in it, including a verdict.
        data: { type: 'npc:identity-return', status: 'Approved', verified: true },
      }));
    });

    // The strongest thing it can do: NPC asks its own server again. The
    // customer is told "we are checking", never "you are verified" — the only
    // path to that is the signed webhook and the server-to-server decision.
    expect(verificationStatus.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(await screen.findByText(/securely checking your verification/i)).toBeTruthy();
    expect(screen.queryByText(/identity verified/i)).toBeNull();
  });

  it('ignores a return message from any other origin', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: SESSION_URL, message: 'ok',
    });

    renderStep();
    fireEvent.click(await chooseDocument());
    await screen.findByText(/identity verification in progress/i);

    const readsBefore = verificationStatus.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://verify.didit.me',
        data: { type: 'npc:identity-return', status: 'Approved' },
      }));
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://attacker.example',
        data: { type: 'npc:identity-return' },
      }));
    });

    // Not even a re-read. The provider's own window cannot speak for NPC.
    expect(verificationStatus.mock.calls.length).toBe(readsBefore);
    expect(screen.getByText(/identity verification in progress/i)).toBeTruthy();
  });

  it('never puts the session URL in web storage', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: SESSION_URL, message: 'ok',
    });
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');

    renderStep();
    fireEvent.click(await chooseDocument());
    await screen.findByText(/identity verification in progress/i);

    /*
     * The URL embeds the customer's session token. Web storage survives the
     * browser restart that should have ended it and is readable by every
     * script on the origin, so the URL lives in memory for the length of the
     * flow and nowhere else.
     */
    for (const [, value] of setLocal.mock.calls) {
      expect(String(value)).not.toContain('TOKEN');
      expect(String(value)).not.toContain(SESSION_URL);
    }
    expect(JSON.stringify(window.localStorage)).not.toContain('TOKEN');
    expect(JSON.stringify(window.sessionStorage)).not.toContain('TOKEN');
  });

  /* ── backend authority over sessions and attempts ────────────────────── */

  it('an already-open session is reported, not duplicated', async () => {
    const { popup } = mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: false, code: 'already_processing',
      message: 'Your verification has been received. We will update you shortly.',
    });

    renderStep();
    fireEvent.click(await chooseDocument());
    await waitFor(() => expect(startHostedVerification).toHaveBeenCalled());

    // No URL means the backend reconciled it away — the blank window is closed
    // rather than left on `about:blank`, and the step re-reads instead of
    // asserting anything about the outcome. One session, whatever the client
    // pressed.
    await waitFor(() => expect(popup.close).toHaveBeenCalled());
    expect(startHostedVerification).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(verificationStatus.mock.calls.length).toBeGreaterThan(2));
  });

  it('shows Continue verification after a refresh, from server state alone', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus({
      parties: [{ ...party, verification_in_progress: true }],
    }));

    renderStep();

    /*
     * A refresh loses the window handle, the session URL and every scrap of
     * local state. The server's boolean is what stops the client being offered
     * "Start" while their verification window is still open behind the browser.
     */
    expect(await screen.findByRole('button', { name: /continue verification/i })).toBeTruthy();
    expect(screen.getByText(/nothing has been used up/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull();
  });

  it('a provider outage exposes the documentary route and consumes nothing', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    const refusal = Object.assign(
      new Error('Verification is temporarily unavailable. Please try again shortly — '
        + 'nothing has been used up.'),
      { code: 'temporarily_unavailable' },
    );
    startHostedVerification.mockRejectedValue(refusal);

    renderStep();
    const begin = await chooseDocument();

    // The provider goes away between the launch screen and the click. Every
    // read after this one says so, which is what the step re-reads on refusal.
    verificationStatus.mockResolvedValue(
      hostedStatus({ availability: 'temporarily_unavailable' }));
    fireEvent.click(begin);
    await waitFor(() => expect(startHostedVerification).toHaveBeenCalled());

    // The manual route, not a dead end in the secure-window flow — and the
    // copy says nothing has been used up, because nothing has.
    expect(await screen.findByRole('button', { name: /upload identity document/i })).toBeTruthy();
    expect(screen.getByText(/nothing has been used up/i)).toBeTruthy();
  });

  it('keeps the manual route visible throughout the secure flow', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());

    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }));

    // Refusing biometric collection is genuinely optional (APP 3.3), so the
    // alternative has to be visible at the moment somebody decides to refuse.
    expect(await screen.findByText(/prefer not to use the photo check/i)).toBeTruthy();
  });

  /* ── the provider is never named ─────────────────────────────────────── */

  it('never names the provider or exposes its internals to the customer', async () => {
    mockPopup();
    verificationStatus.mockResolvedValue(hostedStatus());
    startHostedVerification.mockResolvedValue({
      started: true, verification_url: SESSION_URL, message: 'ok',
    });

    renderStep();
    fireEvent.click(await chooseDocument());
    await screen.findByText(/identity verification in progress/i);

    const rendered = document.body.textContent ?? '';
    for (const forbidden of [/didit/i, /workflow/i, /provider session/i, /session id/i,
      /liveness/i, /face match/i, /similarity/i, /threshold/i, /webhook/i]) {
      expect(rendered).not.toMatch(forbidden);
    }
    // ...and the URL itself never reaches the page.
    expect(rendered).not.toContain(SESSION_URL);
  });

  it('falls back to NPC capture when the server says the flow is capture', async () => {
    mockCamera();
    verificationStatus.mockResolvedValue(status({ provider_flow: 'capture' }));

    renderStep();
    const startBtn = await screen.findByRole('button', { name: /^start$/i });
    fireEvent.click(startBtn);
    await act(async () => { await Promise.resolve(); });

    // The self-hosted path is untouched: the camera dialog, and no document
    // chooser — that screen belongs to the hosted flow alone.
    expect(startHostedVerification).not.toHaveBeenCalled();
    expect(await screen.findByText(/photograph your ID/i)).toBeTruthy();
  });
});

/* ── telling the page when canonical verification state moves ──────────── */

/**
 * This step keeps its own copy of the verification status; the journey that
 * draws the stepper, the overall progress figure and the review summary lives
 * on the page above it. They used to drift: a customer could finish a check,
 * come back, and find "Verify identity" still grey with the progress bar
 * unmoved until they reloaded the page by hand.
 *
 * The callback carries NO argument, and that is the contract. It says
 * something moved; the page answers by re-reading the server. Nothing the
 * browser works out can mark anybody verified.
 *
 * ## The loop these also guard
 *
 * The first version notified on the first read whenever that read was not
 * "quiet". A customer sitting on a check that was already `in_review`
 * therefore announced a change that had not happened; the page reloaded, the
 * reload blanked the portal, this component unmounted, its memory of what it
 * had seen died with it, and the remount made the same server state new
 * again — forever. The page blinked and could not be used.
 *
 * The first successful read for a case is a BASELINE, never a change. The
 * page loaded its overview from the same server; there is nothing to tell it.
 */
describe('parent refresh on canonical change', () => {
  const onStatusChange = vi.fn();
  const renderWithStatusChange = () => render(
    <IdentityVerificationStep
      caseId="case-1" onBack={noop} onNext={noop} onNeedsConsent={noop}
      onStatusChange={onStatusChange}
    />,
  );

  beforeEach(() => { onStatusChange.mockReset(); });

  it('stays quiet on the first read when nothing has been started', async () => {
    verificationStatus.mockResolvedValue(status());
    renderWithStatusChange();
    await screen.findByRole('button', { name: /^start$/i });
    // The page already assumes this state; an overview fetch here buys nothing.
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('stays quiet on the first read when a check is ALREADY in flight', async () => {
    // The production loop, in one assertion. `in_review` at mount is not news:
    // the page's own overview came from the same server, and announcing it
    // reloaded the page, which unmounted this component, which forgot it had
    // seen anything, which made the same state new again on remount.
    verificationStatus.mockResolvedValue(
      status({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    renderWithStatusChange();
    await screen.findByText(/with our team/i);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('stays quiet on the first read for every settled state', async () => {
    for (const partyStatus of ['verified', 'action_required', 'contact_adviser'] as const) {
      onStatusChange.mockReset();
      verificationStatus.mockResolvedValue(
        status({ parties: [{ ...party, status: partyStatus, can_attempt: false }] }));
      const view = renderWithStatusChange();
      await waitFor(() => expect(verificationStatus).toHaveBeenCalled());
      await act(async () => { await Promise.resolve(); });
      expect(onStatusChange).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('stays quiet when a hosted check is open at mount', async () => {
    verificationStatus.mockResolvedValue(status({
      parties: [{ ...party, status: 'not_started', verification_in_progress: true }],
    }));
    renderWithStatusChange();
    await waitFor(() => expect(verificationStatus).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('tells the page when the party state moves, and says nothing about what to', async () => {
    verificationStatus.mockResolvedValue(status());
    renderWithStatusChange();
    await screen.findByRole('button', { name: /^start$/i });
    expect(onStatusChange).not.toHaveBeenCalled();

    // The server has settled the party since the page loaded; the step's next
    // read is where it finds out.
    verificationStatus.mockResolvedValue(
      status({ parties: [{ ...party, status: 'verified', can_attempt: false }] }));
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1));
    // No outcome crosses the callback — the parent re-reads the server.
    for (const call of onStatusChange.mock.calls) expect(call).toHaveLength(0);
  });

  it('does not notify again while the state is unchanged', async () => {
    verificationStatus.mockResolvedValue(status());
    renderWithStatusChange();
    await screen.findByRole('button', { name: /^start$/i });

    // Same state read again — not news, whatever prompts the read.
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await act(async () => { await Promise.resolve(); });
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('takes a fresh baseline for a genuinely different case', async () => {
    verificationStatus.mockResolvedValue(status());
    const view = render(
      <IdentityVerificationStep
        caseId="case-1" onBack={noop} onNext={noop} onNeedsConsent={noop}
        onStatusChange={onStatusChange}
      />,
    );
    await screen.findByRole('button', { name: /^start$/i });

    // A different case, already in review. Its first read is its baseline —
    // not a change, even though it differs from the previous case's state.
    verificationStatus.mockResolvedValue(
      status({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    view.rerender(
      <IdentityVerificationStep
        caseId="case-2" onBack={noop} onNext={noop} onNeedsConsent={noop}
        onStatusChange={onStatusChange}
      />,
    );
    await screen.findByText(/with our team/i);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('an ordinary parent re-render does not make an unchanged state new', async () => {
    // The parent re-renders this component on every background refresh, with
    // fresh inline callback props. That must not be mistaken for a change —
    // it is the other half of what made the loop endless.
    verificationStatus.mockResolvedValue(
      status({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    const view = render(
      <IdentityVerificationStep
        caseId="case-1" onBack={noop} onNext={noop} onNeedsConsent={noop}
        onStatusChange={onStatusChange}
      />,
    );
    await screen.findByText(/with our team/i);

    for (let i = 0; i < 5; i++) {
      view.rerender(
        <IdentityVerificationStep
          caseId="case-1" onBack={() => {}} onNext={() => {}} onNeedsConsent={() => {}}
          onStatusChange={onStatusChange}
        />,
      );
      await act(async () => { await Promise.resolve(); });
    }
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('reports a change once, then goes quiet again on the same state', async () => {
    verificationStatus.mockResolvedValue(status());
    renderWithStatusChange();
    await screen.findByRole('button', { name: /^start$/i });

    verificationStatus.mockResolvedValue(
      status({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1));

    // Re-rendering with new parent props must not make it look new again —
    // that is what turned one announcement into an endless one.
    await act(async () => { await Promise.resolve(); });
    expect(onStatusChange).toHaveBeenCalledTimes(1);
  });
});
