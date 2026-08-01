/**
 * Internal messaging attachments.
 *
 * Files are uploaded straight from the browser to Supabase Storage using a
 * short-lived signed upload URL minted by the `internal-messaging` edge
 * function (which re-verifies thread participation). Uploading directly means
 * there is no edge-function body limit in the path, so large files stream fine
 * and every MIME type is accepted — the message row only stores metadata.
 *
 * Downloads always go back through the edge function so a signed URL is only
 * ever issued to a verified participant of that thread.
 */
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export const INTERNAL_ATTACHMENT_BUCKET = 'internal-message-attachments';
/** Every format is allowed. */
export const INTERNAL_ATTACHMENT_ACCEPT = '*/*';
export const MAX_INTERNAL_ATTACHMENTS = 25;

export interface InternalAttachment {
  name: string;
  path: string;
  mime: string;
  size: number;
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

/** Upload one file and return its message-attachment metadata. */
export async function uploadInternalAttachment(
  threadId: string,
  file: File,
): Promise<InternalAttachment> {
  const ticket = await call({
    action: 'attachment_upload_url',
    thread_id: threadId,
    file_name: file.name,
  });

  const { error } = await supabase.storage
    .from(INTERNAL_ATTACHMENT_BUCKET)
    .uploadToSignedUrl(ticket.path, ticket.token, file, {
      contentType: file.type || 'application/octet-stream',
    });
  if (error) throw new Error(error.message || `Failed to upload ${file.name}`);

  return {
    name: file.name,
    path: ticket.path,
    mime: file.type || 'application/octet-stream',
    size: file.size,
  };
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
