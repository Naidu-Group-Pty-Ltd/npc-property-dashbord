import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameToJpeg, toUploadableJpeg, UnreadableCaptureError } from './captureImage';

/**
 * Capture normalisation.
 *
 * Both behaviours here exist because of something that reached the
 * verification service and came back as a failure the customer had no way to
 * understand: a blank frame, and a HEIC photo OpenCV cannot decode.
 */

afterEach(() => { vi.unstubAllGlobals(); });

describe('capturing a camera frame', () => {
  it('refuses a frame the camera has not filled in yet', async () => {
    // `play()` resolving does not mean there are pixels. Shooting at that
    // moment produced a blank 1×1 JPEG that uploaded successfully and came
    // back "no face found" — a capture failure disguised as a result.
    const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    await expect(frameToJpeg(video)).rejects.toBeInstanceOf(UnreadableCaptureError);
    await expect(frameToJpeg(video)).rejects.toThrow(/camera was not ready/i);
  });

  it('refuses a frame with a width but no height', async () => {
    const video = { videoWidth: 1280, videoHeight: 0 } as HTMLVideoElement;
    await expect(frameToJpeg(video)).rejects.toBeInstanceOf(UnreadableCaptureError);
  });
});

describe('normalising a file the customer picked', () => {
  it('passes a JPEG through when the browser cannot re-encode', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const jpeg = new Blob(['x'], { type: 'image/jpeg' });
    await expect(toUploadableJpeg(jpeg)).resolves.toBe(jpeg);
  });

  it('refuses a non-JPEG when the browser cannot re-encode, rather than sending it', async () => {
    // Uploading a HEIC under `Content-Type: image/jpeg` is how an iPhone
    // library photo reached OpenCV, returned a 400, and left the client on
    // "With our team" having done nothing wrong.
    vi.stubGlobal('createImageBitmap', undefined);
    for (const type of ['image/heic', 'image/png', 'image/webp', '']) {
      await expect(
        toUploadableJpeg(new Blob(['x'], { type })), `type=${type}`,
      ).rejects.toBeInstanceOf(UnreadableCaptureError);
    }
  });

  it('says something the customer can act on when the image will not decode', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
    await expect(toUploadableJpeg(new Blob(['x'], { type: 'image/heic' })))
      .rejects.toThrow(/take a new photo|JPEG or PNG/i);
  });
});
