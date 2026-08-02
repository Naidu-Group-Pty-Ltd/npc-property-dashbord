// Dedicated attachment transport for internal staff messaging.
// Kept separate from `internal-messaging` so attachment releases cannot be
// shadowed by a stale deployment of the main messaging function.
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { createCorsHeaders, createUnauthorizedResponse, verifyAuth } from '../_shared/auth.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';

const BUCKET = 'internal-message-attachments';
// JSON/base64 adds about 33% overhead and Edge requests have a platform body
// ceiling. Stay comfortably below it; larger files use signed streaming.
const DIRECT_MAX_BYTES = 3 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dll', 'com', 'scr', 'pif', 'msi', 'msp', 'cpl', 'jar', 'app',
  'bat', 'cmd', 'sh', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta',
  'apk', 'deb', 'rpm', 'dmg',
]);

function response(payload: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function safeFileName(value: unknown) {
  const flat = String(value || 'file').replace(/[^\w.\- ]+/g, '_').trim().slice(-120);
  return flat || 'file';
}

function decodeBase64(raw: string): Uint8Array | null {
  try {
    const value = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return response({ success: false, error: 'method_not_allowed' }, 405, cors);
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return response({ success: false, error: 'service_not_configured' }, 500, cors);

    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const auth = await verifyAuth(db, req.headers, body);
    if (auth.error || !auth.userId) {
      return createUnauthorizedResponse(auth.error ?? 'Authentication required', cors);
    }

    const operation = String(body.operation ?? '');
    const threadId = String(body.thread_id ?? '');
    if (!threadId) return response({ success: false, error: 'thread_id_required' }, 400, cors);

    const { data: participant } = await db
      .from('internal_thread_participants')
      .select('id')
      .eq('thread_id', threadId)
      .eq('user_id', auth.userId)
      .eq('is_active', true)
      .maybeSingle();
    if (!participant) return response({ success: false, error: 'not_a_participant' }, 403, cors);

    if (operation === 'upload_direct') {
      const fileName = safeFileName(body.file_name);
      const extension = (fileName.split('.').pop() ?? '').toLowerCase();
      if (BLOCKED_EXTENSIONS.has(extension)) {
        return response({ success: false, error: 'attachment_type_blocked' }, 400, cors);
      }
      const bytes = decodeBase64(String(body.file_data ?? ''));
      if (!bytes) return response({ success: false, error: 'invalid_file_data' }, 400, cors);
      if (bytes.byteLength > DIRECT_MAX_BYTES) {
        return response({ success: false, error: 'direct_upload_too_large', use_ticket: true }, 413, cors);
      }

      const contentType = String(body.content_type ?? 'application/octet-stream').slice(0, 200);
      const path = `${threadId}/${crypto.randomUUID()}-${fileName}`;
      const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
        contentType,
        upsert: false,
      });
      if (error) return response({ success: false, error: error.message }, 500, cors);

      return response({
        success: true,
        attachment: {
          name: fileName,
          path,
          mime: contentType,
          size: bytes.byteLength,
          scan: { status: 'unscanned', engine: 'transport-gate', at: new Date().toISOString() },
        },
      }, 200, cors);
    }

    if (operation === 'upload_ticket') {
      const fileName = safeFileName(body.file_name);
      const extension = (fileName.split('.').pop() ?? '').toLowerCase();
      if (BLOCKED_EXTENSIONS.has(extension)) {
        return response({ success: false, error: 'attachment_type_blocked' }, 400, cors);
      }
      const path = `${threadId}/${crypto.randomUUID()}-${fileName}`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) return response({ success: false, error: error?.message ?? 'ticket_failed' }, 500, cors);
      const raw = data.signedUrl ?? '';
      const signedUrl = raw.startsWith('http')
        ? raw
        : `${url}/storage/v1${raw.startsWith('/') ? '' : '/'}${raw}`;
      return response({ success: true, path, token: data.token, signed_url: signedUrl, file_name: fileName }, 200, cors);
    }

    if (operation === 'download_ticket') {
      const path = String(body.path ?? '');
      if (!path.startsWith(`${threadId}/`)) return response({ success: false, error: 'invalid_path' }, 400, cors);
      const options = body.download === true ? { download: true } : undefined;
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 300, options);
      if (error || !data) return response({ success: false, error: error?.message ?? 'ticket_failed' }, 500, cors);
      return response({ success: true, signed_url: data.signedUrl }, 200, cors);
    }

    return response({ success: false, error: 'unknown_operation' }, 400, cors);
  } catch (error) {
    console.error('[internal-message-attachments]', error);
    return response({ success: false, error: error instanceof Error ? error.message : 'internal_error' }, 500, cors);
  }
});