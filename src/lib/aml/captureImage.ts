/**
 * Normalising an identity capture into something the verification service can
 * actually read.
 *
 * The portal uploads captures to a signed URL with `Content-Type: image/jpeg`
 * and the verification service decodes them with OpenCV. Both assumptions hold
 * for a canvas capture and break for the file-picker fallback, which accepts
 * `image/*`:
 *
 *  - an iPhone photo picked from the library is HEIC. OpenCV cannot decode it,
 *    so the service answers 400, the worker records a technical failure, and
 *    the client sits on "With our team" having done nothing wrong;
 *  - a PNG or WebP decodes fine but is stored under a content type it is not,
 *    which makes the biometric object misleading in the very bucket whose
 *    every read is audited;
 *  - a 12 MP phone photo is several megabytes of base64 through an edge
 *    function, for an image the service immediately downscales to 2000px.
 *
 * So every capture — camera or file — goes through here and comes out as JPEG
 * within the service's own working bound. Re-encoding is done on a canvas,
 * which also strips EXIF, including the GPS tag a phone photo often carries.
 * We have no purpose for a customer's location (APP 3), so not collecting it
 * is better than holding it.
 */

/** Matches the service's own downscale bound (`decode_image` in main.py). */
export const MAX_CAPTURE_EDGE_PX = 2000;

/** JPEG quality for re-encoded captures — high enough for a face embedding. */
const JPEG_QUALITY = 0.92;

export class UnreadableCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadableCaptureError';
  }
}

function drawToJpeg(
  source: CanvasImageSource, width: number, height: number,
): Promise<Blob> {
  const scale = Math.min(1, MAX_CAPTURE_EDGE_PX / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UnreadableCaptureError('This browser could not process the photo.');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob
        ? resolve(blob)
        : reject(new UnreadableCaptureError('This browser could not process the photo.')),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

/** Capture a video frame as an upload-ready JPEG. Rejects a frame with no dimensions. */
export async function frameToJpeg(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  // A zero-dimension frame yields a blank 1×1 JPEG that uploads and verifies
  // as "no face found" — a capture failure disguised as a result.
  if (!width || !height) {
    throw new UnreadableCaptureError('The camera was not ready. Please try again.');
  }
  return drawToJpeg(video, width, height);
}

/**
 * Convert a user-selected file into an upload-ready JPEG.
 *
 * `createImageBitmap` decodes whatever the browser itself can decode, which on
 * iOS includes HEIC. Where it cannot, we say so in words the customer can act
 * on rather than letting an undecodable image reach the service.
 */
export async function toUploadableJpeg(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') {
    if (file.type === 'image/jpeg') return file;
    throw new UnreadableCaptureError(
      'This browser cannot process that image. Please choose a JPEG photo.',
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UnreadableCaptureError(
      'We could not read that image. Please take a new photo, or choose a JPEG or PNG file.',
    );
  }

  try {
    return await drawToJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}
