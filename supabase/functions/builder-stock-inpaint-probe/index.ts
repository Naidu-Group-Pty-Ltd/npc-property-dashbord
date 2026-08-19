/**
 * Builder stock — establishing whether a masked image EDIT is reachable at all.
 *
 * Temporary. Everything the sanitizer's generative path needs turns on one
 * question this deployment has never asked: does any credential here reach an
 * `/images/edits` endpoint, which takes an image AND a mask, rather than
 * `/images/generations`, which takes only a prompt and would draw a new house.
 * Guessing that from the presence of an API key is how a whole feature gets
 * built on an endpoint that answers 404.
 *
 * It reports presence of credentials as BOOLEANS and never their values, and it
 * sends a 1x1 image so a probe cannot cost a real generation.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders } from '../_shared/auth.ts';
import { verifyInternal } from '../_shared/auth_v2.ts';
import { enforceRawBodyLimit } from '../_shared/requestSecurity.ts';

const corsHeaders = createCorsHeaders();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** A 1x1 PNG, and the same with an alpha hole: the smallest legal edit pair. */
const ONE_BY_ONE = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
), (c) => c.charCodeAt(0));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const bounded = await enforceRawBodyLimit(req, 8 * 1024);
  if (!bounded.ok) return bounded.error;
  const gate = await verifyInternal(supabase, req, bounded.raw);
  if (!gate.ok) return json({ error: 'unauthorized' }, 401);

  const openai = Deno.env.get('OPENAI_API_KEY');
  const lovable = Deno.env.get('LOVABLE_API_KEY');

  const findings: Record<string, unknown> = {
    has_openai_key: Boolean(openai),
    has_lovable_key: Boolean(lovable),
  };

  const probe = async (label: string, url: string, key: string, model: string) => {
    try {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', 'remove the overlay');
      form.append('image', new Blob([ONE_BY_ONE], { type: 'image/png' }), 'image.png');
      form.append('mask', new Blob([ONE_BY_ONE], { type: 'image/png' }), 'mask.png');
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      const text = await res.text();
      findings[label] = { status: res.status, body: text.slice(0, 300) };
    } catch (error) {
      findings[label] = { error: String((error as { message?: string })?.message ?? error).slice(0, 200) };
    }
  };

  if (openai) {
    await probe('openai_edits_gpt_image_1', 'https://api.openai.com/v1/images/edits', openai, 'gpt-image-1');
  }
  if (lovable) {
    await probe('lovable_edits', 'https://ai.gateway.lovable.dev/v1/images/edits', lovable, 'openai/gpt-image-1');
  }

  console.log('[builder-stock-inpaint-probe]', JSON.stringify(findings));
  return json({ success: true, findings });
});
