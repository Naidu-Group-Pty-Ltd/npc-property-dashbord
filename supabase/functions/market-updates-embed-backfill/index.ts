// Phase 6 — Market Updates persistent embedding backfill.
// Cron: hourly. Embeds up to 200 market_updates rows where embedding IS NULL
// using openai/text-embedding-3-small (1536 dims) via Lovable AI Gateway.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyRequiredCronSecret } from '../_shared/requestSecurity.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const CRON_SECRET = Deno.env.get('MARKET_INGESTION_CRON_SECRET');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const BATCH_SIZE = 50;
const MAX_BATCHES = 4; // 200 per run
const EMBED_MODEL = 'openai/text-embedding-3-small';

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Lovable-API-Key': LOVABLE_API_KEY,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs, dimensions: 1536 }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Embedding failed ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  return (j.data ?? []).sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
}

function buildText(row: any): string {
  return [row.title, row.summary, row.why_it_matters].filter(Boolean).join('\n\n').slice(0, 6000);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!verifyRequiredCronSecret(CRON_SECRET, req.headers.get('x-cron-secret'))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const stats = { batches: 0, embedded: 0, failed: 0, errors: [] as string[] };

  try {
    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const { data: rows, error } = await sb
        .from('market_updates')
        .select('id, title, summary, why_it_matters')
        .is('embedding', null)
        .order('created_at', { ascending: false })
        .limit(BATCH_SIZE);
      if (error) throw error;
      if (!rows || rows.length === 0) break;

      const inputs = rows.map(buildText);
      let vectors: number[][];
      try {
        vectors = await embedBatch(inputs);
      } catch (err) {
        stats.failed += rows.length;
        stats.errors.push(String((err as Error).message));
        break;
      }

      for (let j = 0; j < rows.length; j += 1) {
        const vec = vectors[j];
        if (!vec) continue;
        const { error: upErr } = await sb
          .from('market_updates')
          .update({
            embedding: `[${vec.join(',')}]`,
            embedding_generated_at: new Date().toISOString(),
          })
          .eq('id', rows[j].id);
        if (upErr) {
          stats.failed += 1;
          stats.errors.push(`row ${rows[j].id}: ${upErr.message}`);
        } else {
          stats.embedded += 1;
        }
      }
      stats.batches += 1;
      // small throttle between batches
      await new Promise((r) => setTimeout(r, 400));
    }

    return new Response(JSON.stringify({ ok: true, ...stats }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String((err as Error).message), ...stats }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
