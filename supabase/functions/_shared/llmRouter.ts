/**
 * Universal LLM router for all edge functions.
 *
 * Reads the model assignment for a given `agent_key` from `agent_model_assignments`
 * and dispatches the call to the correct route (gateway / native / openrouter)
 * with an automatic fallback chain on retryable errors (404 / 410 / 5xx / model-not-found).
 *
 * Edge function usage:
 *   import { callLLM } from "../_shared/llmRouter.ts";
 *   const { content, modelUsed, route } = await callLLM({
 *     agentKey: 'bc_scenario_agent',
 *     messages: [{ role: 'user', content: 'Hello' }],
 *   });
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { convertContent, anthropicRejectsSampling } from './claudeReconstruct.pure.ts';

export type LLMRoute = 'gateway' | 'native' | 'openrouter';
export type LLMMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: any; tool_call_id?: string; name?: string };

export interface CallLLMArgs {
  agentKey: string;
  messages: LLMMessage[];
  /** Override the assignment's temperature */
  temperature?: number;
  /** Override the assignment's max_tokens */
  maxTokens?: number;
  /** Optional tool definitions (OpenAI-compatible) */
  tools?: any[];
  toolChoice?: any;
  /** Treat a successful provider response without this tool call as a failed
   * attempt and continue through the configured fallback chain. */
  requiredToolName?: string;
  /** Continue to the next fallback when the required tool arguments are not
   * valid JSON. Schema-level validation remains the caller's responsibility. */
  requireValidToolArguments?: boolean;
  /** Optional reasoning effort hint (gateway / openrouter) */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  /** If true, returns the raw response body instead of parsed content (for streaming). */
  raw?: boolean;
  /** Hard override: skip DB lookup and use this model+route directly */
  forceRoute?: LLMRoute;
  forceModelId?: string;
  /** Per-call response_format */
  responseFormat?: any;
  /** Abort a single provider attempt after this many ms (AbortController).
   *  Prevents a hung provider from blocking the edge function to a gateway 504. */
  timeoutMs?: number;
  /** Absolute wall-clock deadline (epoch ms) for the WHOLE fallback chain. Once
   *  passed, `callLLM` stops trying further fallbacks instead of compounding latency. */
  deadlineAt?: number;
}

export interface CallLLMResult {
  content: string;
  rawResponse: any;
  modelUsed: string;
  routeUsed: LLMRoute;
  toolCalls?: any[];
  attempts: Array<{ route: LLMRoute; model_id: string; ok: boolean; status?: number; error?: string }>;
}

interface AgentAssignment {
  agent_key: string;
  route: LLMRoute;
  model_id: string;
  fallback_chain: Array<{ route: LLMRoute; model_id: string }>;
  temperature: number | null;
  max_tokens: number | null;
  reasoning_effort: string | null;
  is_active?: boolean;
}

const RETRYABLE_STATUSES = new Set([404, 410, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUSES = new Set([401, 402, 403, 429]);

/** fetch with an optional AbortController timeout. When `timeoutMs` is falsy
 *  this is a plain fetch (no behaviour change for callers that don't opt in).
 *  On timeout the fetch rejects with an AbortError, which provider callers
 *  translate into a retryable 504 so the router can fall back / the caller can
 *  surface a clean error instead of hanging to a gateway timeout. */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0) return fetch(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Wrap a provider call so an AbortError (timeout) becomes a retryable 504. */
function asTimeoutResult(e: unknown): { ok: false; status: number; error: string } | null {
  const name = (e as { name?: string })?.name;
  if (name === 'AbortError' || name === 'TimeoutError') {
    return { ok: false, status: 504, error: 'LLM provider call timed out' };
  }
  return null;
}

function safeAttemptError(status?: number, error?: string): string | undefined {
  if (!error) return undefined;
  if (status === 504 || /timed out|deadline/i.test(error)) return 'provider_timeout';
  if (/not configured/i.test(error)) return 'provider_not_configured';
  if (status) return `provider_http_${status}`;
  return 'provider_error';
}

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Fetch the assignment for an agent_key, falling back only when it is missing. */
async function loadAssignment(agentKey: string): Promise<AgentAssignment> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('agent_model_assignments')
    .select('agent_key, route, model_id, fallback_chain, temperature, max_tokens, reasoning_effort, is_active')
    .in('agent_key', [agentKey, 'default'])
    .order('agent_key', { ascending: agentKey === 'default' });

  if (error) throw new Error(`[llmRouter] Failed to load assignment: ${error.message}`);

  const requested = data?.find((r) => r.agent_key === agentKey);
  if (requested?.is_active === false) {
    throw new Error(`[llmRouter] Assignment '${agentKey}' is disabled`);
  }
  if (requested) return requested as AgentAssignment;

  const fallback = data?.find((r) => r.agent_key === 'default');
  if (fallback?.is_active === false) {
    throw new Error("[llmRouter] Default assignment is disabled");
  }
  if (!fallback) {
    // Preserve the legacy hardcoded fallback only when no assignment exists.
    return {
      agent_key: agentKey,
      route: 'gateway',
      model_id: 'google/gemini-3-flash-preview',
      fallback_chain: [{ route: 'gateway', model_id: 'google/gemini-2.5-flash' }],
      temperature: null,
      max_tokens: null,
      reasoning_effort: null,
      is_active: true,
    };
  }
  return fallback as AgentAssignment;
}

/** Build the call chain: primary → fallbacks. */
function buildChain(a: AgentAssignment): Array<{ route: LLMRoute; model_id: string }> {
  const chain = [{ route: a.route, model_id: a.model_id }, ...(a.fallback_chain ?? [])];
  // de-dupe
  const seen = new Set<string>();
  return chain.filter((c) => {
    const k = `${c.route}::${c.model_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Dispatcher per route. */
async function callRoute(
  route: LLMRoute,
  modelId: string,
  args: CallLLMArgs,
  assignment: AgentAssignment
): Promise<{ ok: boolean; status?: number; data?: any; error?: string }> {
  const temperature = args.temperature ?? assignment.temperature ?? undefined;
  const max_tokens = args.maxTokens ?? assignment.max_tokens ?? undefined;
  const reasoning_effort = args.reasoningEffort ?? assignment.reasoning_effort ?? undefined;
  const timeoutMs = args.timeoutMs;

  try {
    if (route === 'gateway') {
      return await callGateway(modelId, args.messages, { temperature, max_tokens, reasoning_effort, tools: args.tools, tool_choice: args.toolChoice, response_format: args.responseFormat, timeoutMs });
    }
    if (route === 'openrouter') {
      return await callOpenRouter(modelId, args.messages, { temperature, max_tokens, tools: args.tools, tool_choice: args.toolChoice, response_format: args.responseFormat, timeoutMs });
    }
    // native
    if (modelId.startsWith('gpt-') || modelId.startsWith('o') || modelId.startsWith('chatgpt')) {
      return await callOpenAINative(modelId, args.messages, { temperature, max_tokens, tools: args.tools, tool_choice: args.toolChoice, response_format: args.responseFormat, timeoutMs });
    }
    if (modelId.startsWith('claude-')) {
      return await callAnthropicNative(modelId, args.messages, { temperature, max_tokens, timeoutMs });
    }
    if (modelId.startsWith('gemini-')) {
      return await callGeminiNative(modelId, args.messages, { temperature, max_tokens, timeoutMs });
    }
    if (modelId.startsWith('sonar')) {
      return await callPerplexityNative(modelId, args.messages, { temperature, max_tokens, timeoutMs });
    }
    return { ok: false, error: `[llmRouter] Unknown native model family: ${modelId}` };
  } catch (e: any) {
    return asTimeoutResult(e) ?? { ok: false, error: e?.message ?? String(e) };
  }
}

// ----- Provider callers (all OpenAI-compatible chat/completions where possible) -----

async function callGateway(model: string, messages: LLMMessage[], opts: any) {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) return { ok: false, error: 'LOVABLE_API_KEY not configured' };
  const body: any = { model, messages };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.max_tokens !== undefined) body.max_tokens = opts.max_tokens;
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;
  if (opts.response_format) body.response_format = opts.response_format;
  if (opts.reasoning_effort) body.reasoning = { effort: opts.reasoning_effort };

  const r = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, opts.timeoutMs);
  if (!r.ok) return { ok: false, status: r.status, error: await r.text() };
  return { ok: true, status: 200, data: await r.json() };
}

async function callOpenRouter(model: string, messages: LLMMessage[], opts: any) {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) return { ok: false, error: 'OPENROUTER_API_KEY not configured' };
  const body: any = { model, messages };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.max_tokens !== undefined) body.max_tokens = opts.max_tokens;
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;
  if (opts.response_format) body.response_format = opts.response_format;

  const r = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': Deno.env.get('APP_URL') ?? 'https://lovable.dev',
      'X-Title': 'NPC Property Dashboard',
    },
    body: JSON.stringify(body),
  }, opts.timeoutMs);
  if (!r.ok) return { ok: false, status: r.status, error: await r.text() };
  return { ok: true, status: 200, data: await r.json() };
}

async function callOpenAINative(model: string, messages: LLMMessage[], opts: any) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return { ok: false, error: 'OPENAI_API_KEY not configured' };
  const body: any = { model, messages };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.max_tokens !== undefined) body.max_tokens = opts.max_tokens;
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;
  if (opts.response_format) body.response_format = opts.response_format;

  const r = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, opts.timeoutMs);
  if (!r.ok) return { ok: false, status: r.status, error: await r.text() };
  return { ok: true, status: 200, data: await r.json() };
}

async function callPerplexityNative(model: string, messages: LLMMessage[], opts: any) {
  const apiKey = Deno.env.get('PERPLEXITY_API_KEY');
  if (!apiKey) return { ok: false, error: 'PERPLEXITY_API_KEY not configured' };
  const body: any = { model, messages };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.max_tokens !== undefined) body.max_tokens = opts.max_tokens;

  const r = await fetchWithTimeout('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, opts.timeoutMs);
  if (!r.ok) return { ok: false, status: r.status, error: await r.text() };
  return { ok: true, status: 200, data: await r.json() };
}

async function callAnthropicNative(model: string, messages: LLMMessage[], opts: any) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };
  // Anthropic API takes system separately
  const systemMsg = messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n\n');
  const userMsgs = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    // Preserve multimodal content (image_url → base64 image blocks) instead of
    // stringifying it — so the native Anthropic path actually supports vision.
    content: convertContent(m.content),
  }));

  const body: any = {
    model,
    max_tokens: opts.max_tokens ?? 4096,
    messages: userMsgs,
  };
  if (systemMsg) body.system = systemMsg;
  // Opus 4.7+/Fable reject `temperature` (400); older Claude models still accept it.
  if (opts.temperature !== undefined && !anthropicRejectsSampling(model)) body.temperature = opts.temperature;

  const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, opts.timeoutMs);
  if (!r.ok) return { ok: false, status: r.status, error: await r.text() };
  const data = await r.json();
  // Re-shape to OpenAI-compatible structure
  const content = data?.content?.map((c: any) => c.text).filter(Boolean).join('\n') ?? '';
  return {
    ok: true,
    status: 200,
    data: { choices: [{ message: { role: 'assistant', content } }], _native: data },
  };
}

async function callGeminiNative(model: string, messages: LLMMessage[], opts: any) {
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY');
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY not configured' };
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] }));
  const systemInstruction = messages.find((m) => m.role === 'system')?.content;
  const body: any = { contents };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: typeof systemInstruction === 'string' ? systemInstruction : JSON.stringify(systemInstruction) }] };
  if (opts.temperature !== undefined || opts.max_tokens !== undefined) {
    body.generationConfig = {};
    if (opts.temperature !== undefined) body.generationConfig.temperature = opts.temperature;
    if (opts.max_tokens !== undefined) body.generationConfig.maxOutputTokens = opts.max_tokens;
  }

  const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, opts.timeoutMs);
  if (!r.ok) return { ok: false, status: r.status, error: await r.text() };
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') ?? '';
  return { ok: true, status: 200, data: { choices: [{ message: { role: 'assistant', content: text } }], _native: data } };
}

// ----- Public entry point -----

export async function callLLM(args: CallLLMArgs): Promise<CallLLMResult> {
  const assignment = await loadAssignment(args.agentKey);
  const chain = args.forceRoute && args.forceModelId
    ? [{ route: args.forceRoute, model_id: args.forceModelId }]
    : buildChain(assignment);

  const attempts: CallLLMResult['attempts'] = [];

  for (const step of chain) {
    // Deadline guard: don't start another fallback attempt once the caller's
    // wall-clock budget is spent — compounding slow attempts is what produces
    // the 504. Derive a per-attempt timeout from whatever budget remains.
    let perAttemptArgs = args;
    if (typeof args.deadlineAt === 'number') {
      const remaining = args.deadlineAt - Date.now();
      if (remaining <= 1000) {
        attempts.push({ route: step.route, model_id: step.model_id, ok: false, status: 504, error: 'deadline exceeded before attempt' });
        break;
      }
      perAttemptArgs = { ...args, timeoutMs: Math.min(args.timeoutMs ?? remaining, remaining) };
    }
    const res = await callRoute(step.route, step.model_id, perAttemptArgs, assignment);
    attempts.push({ route: step.route, model_id: step.model_id, ok: res.ok, status: res.status, error: safeAttemptError(res.status, res.error) });

    if (res.ok && res.data) {
      const choice = res.data.choices?.[0];
      const content = choice?.message?.content ?? '';
      const toolCalls = choice?.message?.tool_calls;
      if (args.requiredToolName && !toolCalls?.some((call: any) => call?.function?.name === args.requiredToolName)) {
        attempts[attempts.length - 1] = {
          route: step.route, model_id: step.model_id, ok: false,
          status: 422, error: `required tool call missing: ${args.requiredToolName}`,
        };
        continue;
      }
      if (args.requiredToolName && args.requireValidToolArguments) {
        const requiredCall = toolCalls?.find((call: any) => call?.function?.name === args.requiredToolName);
        try {
          JSON.parse(requiredCall?.function?.arguments ?? '');
        } catch {
          attempts[attempts.length - 1] = {
            route: step.route, model_id: step.model_id, ok: false,
            status: 422, error: `required tool arguments invalid: ${args.requiredToolName}`,
          };
          continue;
        }
      }
      // Best-effort: log usage on success
      try {
        const admin = getAdminClient();
        await admin.from('agent_model_assignments').update({ last_used_at: new Date().toISOString(), last_error: null }).eq('agent_key', args.agentKey);
      } catch { /* swallow */ }

      return {
        content: typeof content === 'string' ? content : JSON.stringify(content),
        rawResponse: res.data,
        modelUsed: step.model_id,
        routeUsed: step.route,
        toolCalls,
        attempts,
      };
    }

    // If non-retryable, stop the chain
    if (res.status && NON_RETRYABLE_STATUSES.has(res.status)) {
      throw new LLMError(`[llmRouter] Non-retryable error from ${step.route}/${step.model_id}: ${res.status}`, res.status, attempts);
    }
    // Otherwise continue to next fallback (retryable or unknown error)
  }

  // All chain steps failed → record + throw
  try {
    const admin = getAdminClient();
    await admin.from('agent_model_assignments').update({ last_error: JSON.stringify(attempts).slice(0, 500) }).eq('agent_key', args.agentKey);
  } catch { /* swallow */ }
  throw new LLMError(`[llmRouter] All ${chain.length} models failed for agent_key=${args.agentKey}`, 503, attempts);
}

export class LLMError extends Error {
  status: number;
  attempts: CallLLMResult['attempts'];
  constructor(message: string, status: number, attempts: CallLLMResult['attempts']) {
    super(message);
    this.status = status;
    this.attempts = attempts;
  }
}

// =====================================================================
// Compatibility helpers — drop-in replacements for hardcoded fetch sites
// =====================================================================

/**
 * Drop-in replacement for direct fetch() calls to AI provider chat endpoints.
 * Returns a `Response`-like object whose `.json()` yields an OpenAI-shaped body
 * (`{ choices: [{ message: { content, tool_calls } }], usage }`), so existing
 * call sites that read `data.choices[0].message.content` continue to work.
 *
 * Use this when an edge function previously did:
 *   const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', { ... })
 *
 * and you want minimal code disruption while gaining centralised model
 * selection, fallback, and provider routing.
 */
export async function callLLMRaw(args: CallLLMArgs & {
  /** Pass-through body fields like response_format that aren't on CallLLMArgs */
  extraBody?: Record<string, any>;
}): Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
  modelUsed: string;
  routeUsed: LLMRoute;
  attempts: CallLLMResult['attempts'];
}> {
  try {
    const result = await callLLM(args);
    return {
      ok: true,
      status: 200,
      json: async () => result.rawResponse,
      text: async () => JSON.stringify(result.rawResponse),
      modelUsed: result.modelUsed,
      routeUsed: result.routeUsed,
      attempts: result.attempts,
    };
  } catch (e) {
    const err = e as LLMError;
    const status = err?.status ?? 500;
    const attempts = err?.attempts ?? [];
    const errBody = JSON.stringify({ error: err?.message ?? String(e), attempts });
    return {
      ok: false,
      status,
      json: async () => ({ error: err?.message ?? String(e), attempts }),
      text: async () => errBody,
      modelUsed: '',
      routeUsed: 'gateway',
      attempts,
    };
  }
}

/**
 * Streaming variant — returns the raw upstream `Response` so its body can be
 * piped directly to the client (SSE). On streaming requests we do NOT walk the
 * fallback chain (the connection is already open by the time we'd retry).
 *
 * If the primary model returns 404/410/5xx BEFORE streaming begins we DO retry
 * with the next fallback.
 */
export async function streamLLM(args: CallLLMArgs & {
  /** Pass-through body fields like response_format that aren't on CallLLMArgs */
  extraBody?: Record<string, any>;
}): Promise<Response> {
  const assignment = await loadAssignment(args.agentKey);
  const chain = args.forceRoute && args.forceModelId
    ? [{ route: args.forceRoute, model_id: args.forceModelId }]
    : buildChain(assignment);

  let lastErr: { status: number; body: string } | null = null;
  for (const step of chain) {
    if (step.route !== 'gateway' && step.route !== 'openrouter' && !step.model_id.startsWith('gpt-') && !step.model_id.startsWith('o') && !step.model_id.startsWith('chatgpt')) {
      // Native Anthropic/Gemini/Perplexity streaming uses different SSE shapes — only
      // honour OpenAI-compatible streaming endpoints to keep clients unchanged.
      continue;
    }

    let url = '';
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (step.route === 'gateway') {
      const apiKey = Deno.env.get('LOVABLE_API_KEY');
      if (!apiKey) { lastErr = { status: 500, body: 'LOVABLE_API_KEY not configured' }; continue; }
      url = 'https://ai.gateway.lovable.dev/v1/chat/completions';
      headers.Authorization = `Bearer ${apiKey}`;
    } else if (step.route === 'openrouter') {
      const apiKey = Deno.env.get('OPENROUTER_API_KEY');
      if (!apiKey) { lastErr = { status: 500, body: 'OPENROUTER_API_KEY not configured' }; continue; }
      url = 'https://openrouter.ai/api/v1/chat/completions';
      headers.Authorization = `Bearer ${apiKey}`;
      headers['HTTP-Referer'] = Deno.env.get('APP_URL') ?? 'https://lovable.dev';
      headers['X-Title'] = 'NPC Property Dashboard';
    } else {
      const apiKey = Deno.env.get('OPENAI_API_KEY');
      if (!apiKey) { lastErr = { status: 500, body: 'OPENAI_API_KEY not configured' }; continue; }
      url = 'https://api.openai.com/v1/chat/completions';
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const body: any = {
      model: step.model_id,
      messages: args.messages,
      stream: true,
      ...(args.extraBody ?? {}),
    };
    if (args.temperature ?? assignment.temperature !== null) body.temperature = args.temperature ?? assignment.temperature;
    if (args.maxTokens ?? assignment.max_tokens !== null) body.max_tokens = args.maxTokens ?? assignment.max_tokens;
    if (args.tools) body.tools = args.tools;
    if (args.toolChoice) body.tool_choice = args.toolChoice;
    if (args.responseFormat) body.response_format = args.responseFormat;
    if (args.reasoningEffort ?? assignment.reasoning_effort) body.reasoning = { effort: args.reasoningEffort ?? assignment.reasoning_effort };

    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (r.ok) {
      // Mark assignment used (best effort)
      try {
        const admin = getAdminClient();
        await admin.from('agent_model_assignments').update({ last_used_at: new Date().toISOString(), last_error: null }).eq('agent_key', args.agentKey);
      } catch { /* swallow */ }
      return r;
    }
    if (NON_RETRYABLE_STATUSES.has(r.status)) return r; // bubble 401/402/403/429
    lastErr = { status: r.status, body: await r.text().catch(() => '') };
    if (!RETRYABLE_STATUSES.has(r.status)) {
      // Other 4xx — don't retry
      return new Response(lastErr.body, { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }
  }
  return new Response(JSON.stringify({ error: lastErr?.body ?? 'All streaming fallbacks failed', attempts: chain }), {
    status: lastErr?.status ?? 502,
    headers: { 'Content-Type': 'application/json' },
  });
}
