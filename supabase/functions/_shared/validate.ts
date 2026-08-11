/**
 * One call for "read the body, bound it, and check its shape".
 *
 * ## Why this exists
 *
 * Body handling in this repo was half-done, consistently. `requestSecurity.ts`
 * gives every function `enforceJsonBodyLimit`, so payload *size* is bounded
 * almost everywhere, and `scan-auth-patterns.mjs` rule R4 stops a trust decision
 * being derived from a body field. Both are real protections and both are about
 * the envelope.
 *
 * What was missing is the contents. `zod` has been a production dependency for a
 * long time and appeared in **2 of 419** edge functions, so field types were
 * checked by hand where they were checked at all — which is how
 * `update-stamp-duty-rates` ended up calling `.toUpperCase()` on whatever
 * `body.states[0]` happened to be and 500-ing the sweep on `{"states":[1]}`.
 *
 * Two calls is one too many: a function that reaches for `enforceJsonBodyLimit`
 * and then forgets the schema is exactly the state this is trying to leave, so
 * the size bound and the shape check are the same call.
 *
 * ## Use
 *
 * ```ts
 * import { z } from 'https://esm.sh/zod@3.25.76';
 * import { parseJsonBody } from '../_shared/validate.ts';
 *
 * const Body = z.object({
 *   operation: z.enum(['list', 'create']),
 *   states: z.array(z.string()).optional(),
 * });
 *
 * const parsed = await parseJsonBody(req, Body, corsHeaders);
 * if (!parsed.ok) return parsed.response;      // 400 or 413, already built
 * const body = parsed.data;                    // fully typed
 * ```
 *
 * ## What it does NOT do
 *
 * It does not decide what a caller may *write*. A body that is the right shape
 * can still name a column no request should set — that is mass assignment, and
 * the answer is a field allowlist (`pickAllowed` in `_shared/wp09Guards.ts`),
 * applied at the write. Shape and authority are different questions and
 * conflating them is how a schema ends up doubling as an access-control list.
 */
import { enforceJsonBodyLimit, securityJsonError } from './requestSecurity.ts';

/**
 * Default body ceiling when a call site does not name one. 256 KiB is well
 * above every JSON operation in this repo and well below anything that would
 * cost real memory in an isolate; a function with a genuinely larger payload
 * (a base64 upload, say) should pass its own and use `enforceBase64Limit`.
 */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

/**
 * The ceiling for a body that carries a handful of short strings — a session
 * token, an action name, a set of credentials. 16 KiB is three orders of
 * magnitude more than any real one.
 *
 * Kept here rather than imported from `authBodySchemas.ts` so this module has
 * no dependency on any particular domain; that file re-exports its own
 * `AUTH_MAX_BODY_BYTES` at the same value for call sites that read better
 * naming the class of endpoint they are on.
 */
export const SMALL_BODY_BYTES = 16 * 1024;

/** Minimal structural type so this module does not import zod itself. */
export interface SchemaLike<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
}

export type ParsedBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

/** Field paths that failed, without echoing the values the caller sent. */
function issuePaths(error: unknown): string[] {
  const issues = (error as { issues?: Array<{ path?: unknown[] }> })?.issues;
  if (!Array.isArray(issues)) return [];
  return issues
    .map((i) => (Array.isArray(i.path) ? i.path.join('.') : ''))
    .filter((p) => p.length > 0)
    .slice(0, 12);
}

/**
 * Read, size-bound and shape-check a JSON body.
 *
 * On failure the caller gets which FIELDS were wrong and nothing else. Naming
 * the field is what makes the error actionable; echoing the value back is how a
 * validation message turns into a reflection gadget, and quoting the expected
 * type of an internal field describes the schema to someone probing it.
 */
export async function parseJsonBody<T>(
  req: Request,
  schema: SchemaLike<T>,
  headers: Record<string, string> = {},
  maxBytes?: number,
): Promise<ParsedBody<T>> {
  const limited = await enforceJsonBodyLimit<unknown>(req, maxBytes ?? DEFAULT_MAX_BODY_BYTES);
  if (!limited.ok) {
    // `enforceJsonBodyLimit` has already built the 400/413 with an opaque code
    // — but through `securityJsonError`, which emits no CORS headers. On the
    // data services that was invisible. On a login form it is not: a browser
    // shown a 413 it may not read reports "Failed to fetch", and the user is
    // told nothing at all rather than that their request was too large.
    //
    // Re-clothed rather than fixed in `securityJsonError`, which is shared with
    // callers that deliberately answer without CORS headers.
    const original = limited.error;
    const text = await original.clone().text()
      .catch(() => JSON.stringify({ error: 'Invalid request', code: 'invalid_request' }));
    return {
      ok: false,
      response: new Response(text, {
        status: original.status,
        headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    };
  }

  const result = schema.safeParse(limited.value ?? {});
  if (!result.success) {
    const fields = issuePaths(result.error);
    const body = {
      error: 'Invalid request',
      code: 'invalid_body',
      ...(fields.length ? { fields } : {}),
    };
    return {
      ok: false,
      response: new Response(JSON.stringify(body), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    };
  }
  return { ok: true, data: result.data };
}

/**
 * The same check without a Request — for a sub-object that has already been
 * read, e.g. `body.alert` on a function that multiplexes operations over one
 * endpoint, which is the dominant shape here.
 */
export function parseValue<T>(
  value: unknown,
  schema: SchemaLike<T>,
  headers: Record<string, string> = {},
): ParsedBody<T> {
  const result = schema.safeParse(value ?? {});
  if (result.success) return { ok: true, data: result.data };
  const fields = issuePaths(result.error);
  return {
    ok: false,
    response: new Response(
      JSON.stringify({ error: 'Invalid request', code: 'invalid_body', ...(fields.length ? { fields } : {}) }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    ),
  };
}

/** Re-exported so a call site needs one import for the deliberate-denial path. */
export { securityJsonError };

/**
 * `req.json()` with a size ceiling, and the same failure shape.
 *
 * For handlers that already coerce every field they read (`String(body?.op)`,
 * `typeof body?.action === 'string'`) and wrap the read in their own
 * `try/catch` or `.catch(() => ({}))`. Those do not need a schema — they need
 * the size bound, which is the half no amount of downstream `String()` can
 * supply.
 *
 * **Throws** rather than returning a result object, deliberately. Every call
 * site this replaces is inside a `try` that treats a parse failure as "no
 * body", and several then fall back to reading the session token from a header
 * or cookie. Returning `{ok:false}` would have made all of them fall through to
 * the success path with an empty body, quietly turning a rejected oversized
 * request into an accepted empty one — which is worse than what it replaced.
 *
 * An over-limit body throws too, so it lands in the same handler as malformed
 * JSON: request refused, nothing read.
 *
 * The generic defaults to `any` to match `req.json()` exactly, which is the one
 * place in this module that is the right call. `Record<string, unknown>` is the
 * better type and it is the wrong one here: it made the substitution a *typing*
 * change as well as a safety one, and produced 168 errors across five handlers
 * that had been reading `body.op` and `body.portal_type` off an `any` for
 * years. Tightening those is worth doing; bundling it into a change about size
 * limits would mean neither could be reviewed on its own. Pass an explicit
 * parameter to get a real type.
 */
export async function readBoundedJson<T = any>(
  req: Request,
  maxBytes: number = SMALL_BODY_BYTES,
): Promise<T> {
  const limited = await enforceJsonBodyLimit<T>(req, maxBytes);
  if (!limited.ok) throw new Error('request body rejected: too large or not JSON');
  return limited.value;
}
