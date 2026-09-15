/**
 * What a render-service failure IS, said the same way at both ends.
 *
 * On 15 Sep 2026 the render container answered every request with Cloud
 * Run's front-end 503 — "The service you requested is not available yet.
 * Please try again in 30 seconds." — and the two surfaces that met it told
 * the operator opposite things. The Investment page swallowed the status and
 * body at one line of the template route and showed "The renderer could not
 * produce the document", so the chosen template was silently replaced by the
 * standard layout with nothing naming the engine; the cash-flow page showed
 * the raw HTML of the 503 page, cut at 400 characters. Neither said what had
 * happened or what to do.
 *
 * This module classifies the service's answer once — a status band into a
 * kind, an HTML error page into one sentence — and composes the operator's
 * sentence from the classification. The edge functions answer with the kind
 * (`code`) and the upstream status; the browser reads them back. No raw
 * service body reaches a person.
 *
 * Deno-compatible: no imports.
 */

/**
 * `engine_unavailable`: the service host did not serve the request — a
 * scale-to-zero cold start still warming, a revision that is not serving
 * traffic, an outage. Retrying is reasonable; nothing about the document is.
 * `engine_refused`: the service answered and said no — credentials, a
 * document it will not draw. Retrying changes nothing.
 * `engine_failed`: the service tried and failed. The document may be at fault.
 */
export type RenderFailureKind = 'engine_unavailable' | 'engine_refused' | 'engine_failed';

export function classifyServiceStatus(status: number): RenderFailureKind {
  if (status === 502 || status === 503 || status === 504) return 'engine_unavailable';
  if (status >= 400 && status < 500) return 'engine_refused';
  return 'engine_failed';
}

/** Whether one more attempt, after a pause, is worth making. */
export function renderFailureIsRetriable(kind: RenderFailureKind): boolean {
  return kind === 'engine_unavailable';
}

/**
 * One plain sentence out of whatever the service sent. An HTML error page is
 * reduced to its title and its first headings; JSON to its `error` or
 * `message`; anything else is trimmed. Never longer than `max`.
 */
export function summariseServiceBody(body: string, max = 200): string {
  const raw = String(body ?? '').trim();
  if (!raw) return '';
  let text = raw;
  if (/^\s*[{[]/.test(raw)) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const candidate = parsed?.error ?? parsed?.message ?? parsed?.detail;
      if (typeof candidate === 'string') text = candidate;
      else if (candidate && typeof candidate === 'object' && typeof (candidate as Record<string, unknown>).message === 'string') {
        text = String((candidate as Record<string, unknown>).message);
      }
    } catch {
      // not JSON after all; fall through to the text rules
    }
  }
  if (/<\s*(html|head|body|title|h[1-6])\b/i.test(text)) {
    const parts: string[] = [];
    for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i, /<h2[^>]*>([\s\S]*?)<\/h2>/i]) {
      const m = re.exec(text);
      const inner = m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
      if (inner && !parts.includes(inner)) parts.push(inner);
    }
    text = parts.length ? parts.join(' — ') : text.replace(/<[^>]+>/g, ' ');
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export interface RenderFailureDescription {
  kind: RenderFailureKind;
  /** The HTTP status the render service answered, when it answered. */
  upstreamStatus?: number | null;
  /** `summariseServiceBody`'s sentence, or the transport's message. */
  summary?: string | null;
  /** Which document was being drawn, for the operator's sentence. */
  document?: string | null;
}

/**
 * The sentence an operator reads. It names the engine, the status, what the
 * status usually means, and what to do — because the toast is the only place
 * most operators will ever see this.
 */
export function describeRenderFailure(f: RenderFailureDescription): string {
  const status = f.upstreamStatus ? ` (HTTP ${f.upstreamStatus} from the render service)` : '';
  const said = f.summary ? ` It said: "${f.summary}".` : '';
  switch (f.kind) {
    case 'engine_unavailable':
      return `The print engine did not answer${status}.${said} This is usually the render service starting up or not serving traffic; try again in a minute, and if it persists check the Cloud Run service.`;
    case 'engine_refused':
      return `The print engine refused the request${status}.${said} Retrying will not change this; the credentials or the document need attention.`;
    default:
      return `The print engine failed to draw the document${status}.${said}`;
  }
}

/** The wire shape the edge functions answer a render failure with. */
export interface RenderFailureWire {
  error: string;
  code: RenderFailureKind;
  upstreamStatus: number | null;
  retriable: boolean;
}

/** The function's own status for a failure of this kind: the class of the upstream answer, never a bare 500. */
export function functionStatusFor(kind: RenderFailureKind): number {
  return kind === 'engine_unavailable' ? 503 : 502;
}

/** Read a failure back off a function's answer, or null when it is not one. */
export function readRenderFailure(body: unknown): RenderFailureWire | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const code = b.code;
  if (code !== 'engine_unavailable' && code !== 'engine_refused' && code !== 'engine_failed') return null;
  return {
    error: typeof b.error === 'string' ? b.error : '',
    code,
    upstreamStatus: typeof b.upstreamStatus === 'number' ? b.upstreamStatus : null,
    retriable: b.retriable === true,
  };
}
