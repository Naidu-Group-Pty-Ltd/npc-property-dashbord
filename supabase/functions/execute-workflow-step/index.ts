/**
 * Performs one workflow step that needs credentials or network the browser
 * should not have.
 *
 * Deliberately one *step*, not a whole workflow. The engine that decides what a
 * workflow means lives in src/lib/workflow/runtime/engine.ts and is covered by
 * tests; duplicating it here in Deno would create a second implementation that
 * could disagree with the first about branches, ordering or stopping. So the
 * engine keeps deciding, and this endpoint only does the part it cannot: hold a
 * secret and make the call.
 *
 * The allowlist is the safety boundary. A step type that is not on it is
 * refused, so this cannot be turned into a general-purpose proxy.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";

/** Step types this endpoint will perform. Mirrors LIVE_CAPABLE in performers.ts. */
const ALLOWED_STEP_TYPES = new Set([
  'core.http',
  'core.graphql',
  'core.notify_team',
  'mcp.list_tools',
  'mcp.call_tool',
  'mcp.read_resource',
  'mcp.get_prompt',
]);

/** Hosts that are never callable, whatever the workflow says. */
const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  '169.254.169.254', // cloud instance metadata
];

const MAX_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

interface StepRequest {
  nodeType?: string;
  /** Config with every {{…}} already resolved by the engine. */
  config?: Record<string, unknown>;
}

/**
 * Only the client surface this file uses.
 *
 * `ReturnType<typeof createClient>` collapses the untyped generic defaults to
 * `never`, which makes any insert unwritable; naming the shape we actually use
 * keeps the call typed without pulling the generated database types into Deno.
 */
interface StepClient {
  from(table: string): {
    insert(row: Record<string, unknown>): {
      select(columns: string): {
        single(): Promise<{ data: { id?: string } | null; error: { message: string } | null }>;
      };
    };
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Refuses anything that is not a public HTTP(S) endpoint. Without this, a
 * workflow could be pointed at cloud metadata or an internal service and used
 * to read things the browser could never reach itself.
 */
function assertCallableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`“${raw}” is not a valid URL.`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http and https endpoints can be called.');
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.includes(host)) {
    throw new Error('That host is not reachable from workflows.');
  }
  // Private ranges, in case a public name resolves inward.
  if (/^(10\.|192\.168\.|127\.|169\.254\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error('Private network addresses are not reachable from workflows.');
  }
  return url;
}

const keyValueHeaders = (value: unknown): Record<string, string> => {
  if (!Array.isArray(value)) return {};
  const headers: Record<string, string> = {};
  for (const pair of value as { key?: string; value?: string }[]) {
    if (pair?.key) headers[String(pair.key)] = String(pair.value ?? '');
  }
  return headers;
};

async function readBoundedBody(response: Response): Promise<unknown> {
  const text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(init: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}) {
  assertCallableUrl(init.url);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(init.timeoutMs ?? MAX_TIMEOUT_MS, MAX_TIMEOUT_MS),
  );
  try {
    const response = await fetch(init.url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
      redirect: 'follow',
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await readBoundedBody(response),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function performStep(
  nodeType: string,
  config: Record<string, unknown>,
  supabase: StepClient,
  userId: string,
): Promise<{ status: string; output?: unknown; error?: string }> {
  switch (nodeType) {
    case 'core.http': {
      const method = String(config.method ?? 'GET').toUpperCase();
      const response = await request({
        url: String(config.url ?? ''),
        method,
        headers: { 'Content-Type': 'application/json', ...keyValueHeaders(config.headers) },
        body: ['POST', 'PUT', 'PATCH'].includes(method) && config.body != null
          ? typeof config.body === 'string' ? config.body : JSON.stringify(config.body)
          : undefined,
        timeoutMs: Number(config.timeoutSeconds ?? 30) * 1000,
      });
      return {
        status: response.status >= 200 && response.status < 400 ? 'succeeded' : 'failed',
        output: response,
        error: response.status >= 400 ? `The endpoint answered ${response.status}.` : undefined,
      };
    }

    case 'core.graphql': {
      const response = await request({
        url: String(config.url ?? ''),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...keyValueHeaders(config.headers) },
        body: JSON.stringify({ query: config.query, variables: config.variables ?? {} }),
      });
      const body = (response.body ?? {}) as { data?: unknown; errors?: unknown[] };
      return {
        status: body.errors?.length ? 'failed' : 'succeeded',
        output: { data: body.data ?? null, errors: body.errors ?? [], status: response.status },
        error: body.errors?.length ? 'The endpoint returned GraphQL errors.' : undefined,
      };
    }

    case 'core.notify_team': {
      const title = String(config.title ?? 'Workflow notification');
      // The recipient field is free text ("Team or user"), so only a literal
      // user id can be addressed; anything else goes to whoever ran it rather
      // than to nobody.
      const recipient = String(config.recipient ?? '').trim();
      const { data, error } = await supabase
        .from('notifications')
        .insert({
          target_user_id: UUID.test(recipient) ? recipient : userId,
          created_by: userId,
          type: 'workflow',
          title,
          // NOT NULL in the schema — an empty body still needs something.
          message: config.body == null || config.body === '' ? title : String(config.body),
          metadata: { source: 'workflow', priority: String(config.priority ?? 'normal'), recipient },
          read: false,
        })
        .select('id')
        .single();
      if (error) return { status: 'failed', error: error.message };
      return { status: 'succeeded', output: { notificationId: data?.id } };
    }

    case 'mcp.list_tools':
    case 'mcp.call_tool':
    case 'mcp.read_resource':
    case 'mcp.get_prompt': {
      const serverUrl = String(config.serverUrl || Deno.env.get('MCP_SERVER_URL') || '');
      if (!serverUrl) {
        return { status: 'failed', error: 'No MCP server configured. Add one on the Integrations page.' };
      }

      const method = nodeType === 'mcp.list_tools'
        ? 'tools/list'
        : nodeType === 'mcp.call_tool'
          ? 'tools/call'
          : nodeType === 'mcp.read_resource'
            ? 'resources/read'
            : 'prompts/get';

      const params = nodeType === 'mcp.call_tool'
        ? { name: config.toolName, arguments: config.arguments ?? {} }
        : nodeType === 'mcp.read_resource'
          ? { uri: config.uri }
          : nodeType === 'mcp.get_prompt'
            ? { name: config.promptName, arguments: config.arguments ?? {} }
            : {};

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = Deno.env.get('MCP_ACCESS_TOKEN');
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await request({
        url: serverUrl,
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });

      const body = (response.body ?? {}) as { result?: Record<string, unknown>; error?: { message?: string } };
      if (body.error) return { status: 'failed', error: body.error.message ?? 'The MCP server returned an error.' };

      const result = body.result ?? {};
      const content = Array.isArray(result.content) ? result.content as { text?: string }[] : [];
      const text = content.map((part) => part?.text ?? '').filter(Boolean).join('\n');
      return {
        status: 'succeeded',
        output: { ...result, text: text || undefined, count: Array.isArray(result.tools) ? result.tools.length : undefined },
      };
    }

    default:
      return { status: 'failed', error: `${nodeType} cannot be performed here.` };
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body: StepRequest = await req.json().catch(() => ({}));

    const authResult = await verifyAuth(supabase, req.headers, body as Record<string, unknown>);
    if (authResult.error) return createUnauthorizedResponse(authResult.error, corsHeaders);

    // Running a live step can reach any endpoint the workflow names, which is
    // the same privilege as editing the integrations themselves.
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', authResult.userId)
      .in('role', ['superadmin', 'admin'])
      .maybeSingle();

    if (!roleData) {
      return createForbiddenResponse('Forbidden: admin access required', corsHeaders);
    }

    const nodeType = String(body.nodeType ?? '');
    if (!ALLOWED_STEP_TYPES.has(nodeType)) {
      return new Response(
        JSON.stringify({
          status: 'failed',
          error: `“${nodeType}” has no server-side executor. Use Test run, or an HTTP request step.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const outcome = await performStep(
      nodeType,
      (body.config ?? {}) as Record<string, unknown>,
      supabase as unknown as StepClient,
      authResult.userId as string,
    );

    return new Response(JSON.stringify(outcome), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The step could not be performed.';
    console.error('[execute-workflow-step]', message);
    return new Response(JSON.stringify({ status: 'failed', error: message }), {
      status: 200, // The engine records a failed step; the call itself succeeded.
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
