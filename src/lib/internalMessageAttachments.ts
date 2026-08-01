/**
 * Internal messaging attachments.
 *
 * Upload path
 * -----------
 * Files go straight from the browser to Supabase Storage using a short-lived
 * signed upload URL minted by the `internal-messaging` edge function (which
 * re-verifies thread participation). Because the edge function is never in the
 * data path there is no payload ceiling — large files stream directly to
 * storage and every MIME type is accepted.
 *
 * Uploads are performed with XHR so we get real byte-level progress, an abort
 * signal, and — critically — a *retry* loop. Every retry mints a **fresh**
 * signed ticket (tokens are single-use and short-lived), so a dropped
 * connection, a token expiry mid-flight, or a transient 5xx never results in a
 * silent failure: each attempt either completes or surfaces a hard error that
 * the UI can retry manually.
 *
 * Safety
 * ------
 * The server re-inspects every uploaded object (magic-byte sniff, declared-vs-
 * actual MIME agreement, executable blocklist and — when configured — an
 * antivirus pass) inside `send_message`. Anything that fails is deleted from
 * storage and the message is rejected, so unsafe files never become visible to
 * recipients.
 *
 * Downloads always go back through the edge function so a signed URL is only
 * ever issued to a verified participant of that thread.
 */
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export const INTERNAL_ATTACHMENT_BUCKET = 'internal-message-attachments';
/** Every format is allowed — the server does the safety screening. */
export const INTERNAL_ATTACHMENT_ACCEPT = '*/*';
export const MAX_INTERNAL_ATTACHMENTS = 25;
/** Attempts per file (1 initial + retries), each with a brand-new ticket. */
export const UPLOAD_ATTEMPTS = 4;

export type AttachmentScanStatus = 'clean' | 'unscanned' | 'blocked' | 'legacy';

export interface AttachmentScan {
  status: AttachmentScanStatus;
  engine?: string | null;
  reason?: string | null;
  at?: string | null;
}

export interface InternalAttachment {
  name: string;
  path: string;
  mime: string;
  size: number;
  scan?: AttachmentScan | null;
}

export function formatAttachmentSize(bytes?: number | null): string {
  const n = Number(bytes ?? 0);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const call = async (payload: Record<string, unknown>) => {
  const { data, error } = await invokeSecureFunction('internal-messaging', payload);
  if (error) throw new Error(error.message || 'Request failed');
  if (data && (data as any).success === false) {
    throw new Error((data as any).error || 'Request failed');
  }
  return data as any;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface UploadTicket {
  path: string;
  token: string;
  signed_url?: string;
  file_name: string;
}

/** PUT the file to a signed upload URL with byte-level progress + abort. */
function putWithProgress(opts: {
  url: string;
  file: File;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', opts.url, true);
    xhr.setRequestHeader('content-type', opts.file.type || 'application/octet-stream');
    xhr.setRequestHeader('cache-control', 'max-age=3600');
    xhr.setRequestHeader('x-upsert', 'true');

    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !opts.onProgress) return;
      opts.onProgress(Math.min(0.99, e.loaded / e.total));
    };
    xhr.onload = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(1);
        resolve();
        return;
      }
      let detail = '';
      try {
        detail = JSON.parse(xhr.responseText)?.message ?? '';
      } catch {
        detail = xhr.responseText?.slice(0, 160) ?? '';
      }
      const err = new Error(detail || `Upload failed (${xhr.status})`);
      (err as any).status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new Error('Network interrupted during upload'));
    };
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.onabort = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };
    // No client timeout: very large files may legitimately take a long time.
    xhr.timeout = 0;
    xhr.send(opts.file);
  });
}

/**
 * The project URL, matching how the rest of this app resolves it.
 *
 * The fallback below used to read `import.meta.env.VITE_SUPABASE_URL`. There is
 * no `.env` in this repo — only `.env.example` — and every other module that
 * needs this URL hardcodes it as a constant for exactly that reason. When the
 * variable is undefined at build time the expression collapses to `''`, so the
 * "fallback" produced a RELATIVE url and the upload PUT went to the app's own
 * origin, which answers with HTML. A fallback that cannot work is worse than no
 * fallback: it turns a recoverable hiccup into a confusing failure.
 */
const SUPABASE_URL =
  ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://dduzbchuswwbefdunfct.supabase.co')
    .replace(/\/$/, '');

function ticketUrl(ticket: UploadTicket): string {
  if (ticket.signed_url && /^https?:\/\//i.test(ticket.signed_url)) return ticket.signed_url;
  const encoded = ticket.path.split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/upload/sign/${INTERNAL_ATTACHMENT_BUCKET}/${encoded}?token=${ticket.token}`;
}

/**
 * Non-retryable ticket failures (the attachment endpoint itself is unavailable
 * or the caller isn't allowed) mapped to a message that explains the fix.
 */
function fatalTicketError(error: unknown): Error | null {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const m = msg.toLowerCase();
  if (m.includes('unknown action')) {
    return new Error('Attachment service is out of date — redeploy internal-messaging');
  }
  if (m.includes('not_a_participant')) {
    return new Error('You are no longer a participant in this conversation');
  }
  if (m.includes('thread_id required')) {
    return new Error('Open or create the conversation before attaching files');
  }
  return null;
}

/**
 * Upload one file with retry + progress. Each attempt mints a fresh signed
 * ticket so an expired/consumed token can never wedge the upload.
 */
export async function uploadInternalAttachment(
  threadId: string,
  file: File,
  options: {
    onProgress?: (fraction: number) => void;
    onAttempt?: (attempt: number, attempts: number) => void;
    signal?: AbortSignal;
    attempts?: number;
  } = {},
): Promise<InternalAttachment> {
  const attempts = Math.max(1, options.attempts ?? UPLOAD_ATTEMPTS);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    options.onAttempt?.(attempt, attempts);
    try {
      const ticket = (await call({
        action: 'attachment_upload_url',
        thread_id: threadId,
        file_name: file.name,
        file_size: file.size,
        content_type: file.type || 'application/octet-stream',
      })) as UploadTicket;

      try {
        await putWithProgress({
          url: ticketUrl(ticket),
          file,
          onProgress: options.onProgress,
          signal: options.signal,
        });
      } catch (xhrError) {
        // Fall back to the SDK path once (covers proxies that mangle raw PUTs).
        if (attempt === attempts - 1) {
          const { error } = await supabase.storage
            .from(INTERNAL_ATTACHMENT_BUCKET)
            .uploadToSignedUrl(ticket.path, ticket.token, file, {
              contentType: file.type || 'application/octet-stream',
            });
          if (error) throw xhrError;
          options.onProgress?.(1);
        } else {
          throw xhrError;
        }
      }

      return {
        name: file.name,
        path: ticket.path,
        mime: file.type || 'application/octet-stream',
        size: file.size,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastError = fatalTicketError(error) ?? error;
      // A stale/misconfigured attachment service will never succeed on retry —
      // surface it immediately instead of burning every attempt.
      if (fatalTicketError(error)) break;
      if (attempt < attempts) await sleep(Math.min(8_000, 600 * 2 ** (attempt - 1)));
    }

  }

  throw new Error(
    lastError instanceof Error
      ? `${file.name}: ${lastError.message}`
      : `${file.name}: upload failed`,
  );
}

/** Upload a batch sequentially so very large files don't compete for bandwidth. */
export async function uploadInternalAttachments(
  threadId: string,
  files: File[],
  onFileDone?: (done: number, total: number, name: string) => void,
): Promise<InternalAttachment[]> {
  const out: InternalAttachment[] = [];
  const batch = files.slice(0, MAX_INTERNAL_ATTACHMENTS);
  for (let i = 0; i < batch.length; i += 1) {
    out.push(await uploadInternalAttachment(threadId, batch[i]));
    onFileDone?.(i + 1, batch.length, batch[i].name);
  }
  return out;
}

/** Open (or force-download) an attachment via a freshly signed URL. */
export async function openInternalAttachment(
  threadId: string,
  attachment: Pick<InternalAttachment, 'path' | 'name'>,
  download = false,
): Promise<void> {
  const data = await call({
    action: 'attachment_download_url',
    thread_id: threadId,
    path: attachment.path,
    download,
  });
  const url = data?.signed_url as string | undefined;
  if (!url) throw new Error('Could not open attachment');
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function isImageAttachment(a: InternalAttachment) {
  return (a.mime || '').startsWith('image/');
}

export function attachmentScanStatus(a: InternalAttachment): AttachmentScanStatus {
  // Older rows stored the scan verdict as a bare string.
  const raw = a.scan as unknown;
  const status = typeof raw === 'string' ? raw : (a.scan?.status as string | undefined);
  if (status === 'clean' || status === 'unscanned' || status === 'blocked') return status;
  return 'legacy';
}


/** Pull real files out of a drop / paste event (multi-file aware). */
export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.files?.length) out.push(...Array.from(dt.files));
  if (!out.length && dt.items?.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue;
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  // De-dupe identical picks (some browsers report both files and items).
  const seen = new Set<string>();
  return out.filter((f) => {
    const key = `${f.name}|${f.size}|${f.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
