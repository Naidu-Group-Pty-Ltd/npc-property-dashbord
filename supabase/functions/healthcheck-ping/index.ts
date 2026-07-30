import { createCorsHeaders } from "../_shared/auth.ts";
Deno.serve((req) => new Response(JSON.stringify({ ok: true, cors: !!createCorsHeaders(req.headers.get('origin')) }), {
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
}));
