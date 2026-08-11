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
    // `enforceJsonBodyLimit` has already built the 400/413 with an opaque code.
    return { ok: false, response: limited.error };
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
