// Returns the public VAPID key so the browser can subscribe to push notifications.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  const key = Deno.env.get('VAPID_PUBLIC_KEY') || '';
  return new Response(JSON.stringify({ publicKey: key }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
