// One-off seeder for `public.report_default_assets`.
//
// Why this exists: the inlined house artwork is ~490 KB of base64, and every
// file under `supabase/functions/` counts toward *every* function's deploy
// upload. Carrying it in `_shared/` pushed several functions past the ~4.5 MB
// cap (`manage-partner-agreements`, `aml-client-portal`,
// `generate-investment-report` all failed to deploy). The bytes now live in the
// database and the renderer loads them at request time.
//
// This function's only job is to put them there once. It is safe to re-run
// (upsert on `asset_key`) and safe to delete afterwards.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { NPC_HOUSE_COVER_ART, NPC_HOUSE_MARK } from "./assets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const rows = [
    {
      asset_key: "npc_house_cover_art",
      mime_type: "image/jpeg",
      data_uri: NPC_HOUSE_COVER_ART,
      byte_length: NPC_HOUSE_COVER_ART.length,
    },
    {
      asset_key: "npc_house_mark",
      mime_type: "image/png",
      data_uri: NPC_HOUSE_MARK,
      byte_length: NPC_HOUSE_MARK.length,
    },
  ];

  const { error } = await supabase
    .from("report_default_assets")
    .upsert(rows, { onConflict: "asset_key" });

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      seeded: rows.map((r) => ({ key: r.asset_key, bytes: r.byte_length })),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
