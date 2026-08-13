import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const AML_ROLES = new Set(["analyst", "reviewer", "mlro", "auditor"]);

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration missing" }, 500);

    const body = await req.json().catch(() => ({}));
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const auth = await verifyAuth(admin, req.headers, body);

    if (auth.error || !auth.userId || auth.userId === "service_role") {
      return json({ error: auth.error || "Authentication required" }, 401);
    }

    const [{ data: flag, error: flagError }, { data: roleRows, error: roleError }] = await Promise.all([
      admin.from("feature_flags").select("value").eq("key", "aml_ctf").maybeSingle(),
      admin.rpc("get_aml_roles_for_user", { _user_id: auth.userId }),
    ]);

    if (flagError) throw flagError;
    if (roleError) throw roleError;

    const roles: string[] = (roleRows ?? [])
      .map((row: any) => String(row.role ?? ""))
      .filter((role: string) => AML_ROLES.has(role));
    const uniqueRoles: string[] = Array.from(new Set(roles));
    const flagEnabled = Boolean((flag?.value as { enabled?: boolean } | null | undefined)?.enabled);

    return json({
      flagEnabled,
      roles: uniqueRoles,
      hasAnyRole: uniqueRoles.length > 0,
      canWrite: uniqueRoles.some((role: string) => ["analyst", "reviewer", "mlro"].includes(role)),
      isMlro: uniqueRoles.includes("mlro"),
      userId: auth.userId,
    });
  } catch (error) {
    console.error("[aml-access] failed", error);
    return json({ ...internalError(error, 'aml-access') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
