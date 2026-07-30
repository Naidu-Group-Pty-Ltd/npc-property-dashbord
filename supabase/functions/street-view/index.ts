import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';

// Server-side Google Street View proxy. The browser never sees the server key.
// Returns coverage metadata plus a base64 static preview when imagery exists.

const MAX_WIDTH = 640;
const MAX_HEIGHT = 400;

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const j = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const { error: authError } = await verifyAuth(supabase, req.headers, body as { session_token?: string });
    if (authError) return createUnauthorizedResponse(authError, corsHeaders);

    const lat = numeric((body as { lat?: unknown }).lat);
    const lng = numeric((body as { lng?: unknown }).lng);
    const heading = numeric((body as { heading?: unknown }).heading) ?? 0;

    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return j({ error: 'invalid_location', success: false }, 400);
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) return j({ error: 'street_view_not_configured', success: false }, 500);

    const location = `${lat},${lng}`;

    const metaResponse = await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${encodeURIComponent(location)}&key=${apiKey}`,
    );
    const meta = await metaResponse.json().catch(() => ({}));

    if (meta.status !== 'OK') {
      return j({ success: true, available: false, status: String(meta.status ?? 'UNKNOWN') });
    }

    const params = new URLSearchParams({
      size: `${MAX_WIDTH}x${MAX_HEIGHT}`,
      location,
      fov: '80',
      heading: String(((heading % 360) + 360) % 360),
      pitch: '0',
      return_error_code: 'true',
      key: apiKey,
    });

    const imageResponse = await fetch(`https://maps.googleapis.com/maps/api/streetview?${params.toString()}`);
    if (!imageResponse.ok) {
      return j({ success: true, available: false, status: `image_${imageResponse.status}` });
    }

    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    return j({
      success: true,
      available: true,
      imageDataUrl: `data:image/jpeg;base64,${base64}`,
      panoramaDate: typeof meta.date === 'string' ? meta.date : null,
      copyright: typeof meta.copyright === 'string' ? meta.copyright.slice(0, 200) : null,
    });
  } catch (error) {
    console.error('[street-view] error', error);
    return j({ error: 'internal_error', success: false }, 500);
  }
});
