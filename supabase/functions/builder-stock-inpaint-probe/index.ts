/**
 * Builder stock — a TEMPORARY internal window onto the overlay repair.
 *
 * It exists so the repaired photographs can be LOOKED AT during this change
 * rather than trusted from a database flag, and it is removed with the change.
 * Two things it does and nothing else: report which properties have a stored
 * derivative, and mint a short-lived signed URL for one so a human can open it.
 *
 * It reads. It never repairs, never writes a row, never writes an object and
 * never touches a credential value. Internal callers only, through the signed
 * envelope.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders } from '../_shared/auth.ts';
import { verifyInternal } from '../_shared/auth_v2.ts';
import { enforceRawBodyLimit } from '../_shared/requestSecurity.ts';
import { STOCK_IMAGE_BUCKET } from '../_shared/builderStock/fileTypes.pure.ts';

const corsHeaders = createCorsHeaders();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

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

  const { data: images } = await supabase
    .from('builder_stock_item_images')
    .select('id, stock_item_id, storage_bucket, storage_path, source_detail')
    .eq('source_stage', 'uploaded_document')
    .eq('processing_status', 'ready')
    .limit(2000);

  const report: Array<Record<string, unknown>> = [];
  for (const image of (images ?? []) as Array<Record<string, any>>) {
    const detail = image.source_detail ?? {};
    const derivative = detail.sanitized_derivative;
    const failure = detail.sanitization_failure;
    if (!derivative && !failure) continue;

    const entry: Record<string, unknown> = {
      image_id: image.id,
      stock_item_id: image.stock_item_id,
      original_path: image.storage_path,
      derivative: derivative
        ? {
          transformation: derivative.transformation,
          model: derivative.model,
          verdict: derivative.verdict,
          repaired_share: derivative.repaired_share,
          regions_removed: derivative.regions_removed,
          width: derivative.width,
          height: derivative.height,
          path: derivative.storage_path,
        }
        : null,
      failure: failure
        ? { reason: failure.reason, detail: failure.detail, model: failure.model }
        : null,
    };

    if (failure?.rejected_path) {
      const { data: rejectedSigned } = await supabase.storage
        .from(image.storage_bucket || STOCK_IMAGE_BUCKET)
        .createSignedUrl(failure.rejected_path, 3600);
      entry.rejected_url = rejectedSigned?.signedUrl ?? null;
    }

    // The original, always: a refusal is exactly the case somebody needs to
    // look at the builder's own file for.
    if (image.storage_path) {
      const { data: originalSigned } = await supabase.storage
        .from(image.storage_bucket || STOCK_IMAGE_BUCKET)
        .createSignedUrl(image.storage_path, 3600);
      entry.original_url = originalSigned?.signedUrl ?? null;
    }

    if (derivative?.storage_path) {
      const { data: signed } = await supabase.storage
        .from(derivative.storage_bucket || STOCK_IMAGE_BUCKET)
        .createSignedUrl(derivative.storage_path, 3600);
      entry.derivative_url = signed?.signedUrl ?? null;
    }
    report.push(entry);
  }

  console.log('[builder-stock-inpaint-probe]', JSON.stringify(report));
  return json({ success: true, count: report.length, report });
});
