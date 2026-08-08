/**
 * Turning an Agreement Centre API failure into a sentence someone can act on.
 *
 * ## Why this module exists
 *
 * The Agreement Centre ships as two halves that deploy separately. The browser
 * bundle goes out with the site build; the Edge Functions go out through
 * `.github/workflows/deploy-supabase-functions.yml`, which **stops and stays
 * green when no `SUPABASE_ACCESS_TOKEN` secret is configured**; and the
 * migrations go out on a third path again. Merging is not deploying, and the
 * repo has now been bitten by that twice.
 *
 * When the halves diverge, the app is a new interface over old server code,
 * and the server answers in its own vocabulary:
 *
 *   - a menu item the function has never heard of  → `unknown_action`
 *   - a column the migration never created         → PostgREST `42703`
 *
 * Both were surfaced verbatim in a toast. "unknown_action" tells a user
 * nothing, tells an operator nothing, and — worst of the three — reads like a
 * bug in the feature rather than the one thing it actually is: code that was
 * written, reviewed, merged and never shipped. Somebody then goes looking for
 * the fault in the feature, which is the one place it is not.
 *
 * So the translation below is not cosmetic. It is the difference between an
 * afternoon of debugging a working feature and reading the answer off the
 * screen.
 *
 * Everything here is pure and tested; `useAgreementCentre` is the only caller.
 */

/** The shape an Edge Function error arrives in, whoever produced it. */
export interface AgreementApiFailure {
  /** Our own `error` slug, or PostgREST's error code. */
  code?: string | null;
  /** Our `message`, or PostgREST's. */
  message?: string | null;
}

/**
 * Server-side deployment skew, in the two forms it reaches the browser.
 *
 * Kept separate from ordinary refusals because the remedy is completely
 * different: nothing about the agreement is wrong, and no amount of retrying,
 * re-reading or picking a different agreement will help.
 */
export type AgreementSkew = 'function_behind' | 'schema_behind' | null;

const UNDEFINED_COLUMN = '42703';
const UNDEFINED_TABLE = '42P01';

/** PostgREST reports a missing column by code, and sometimes only in prose. */
function looksLikeMissingColumn(failure: AgreementApiFailure): boolean {
  if (failure.code === UNDEFINED_COLUMN || failure.code === UNDEFINED_TABLE) return true;
  const message = String(failure.message ?? '');
  return /column .* does not exist|relation .* does not exist/i.test(message);
}

/** Which half of the deployment is behind, if either. */
export function detectSkew(failure: AgreementApiFailure): AgreementSkew {
  // The function fell through its whole action list — it does not have this
  // action compiled in, which only happens when it predates the app.
  if (failure.code === 'unknown_action' || failure.message === 'unknown_action') {
    return 'function_behind';
  }
  if (looksLikeMissingColumn(failure)) return 'schema_behind';
  return null;
}

const SKEW_MESSAGES: Record<Exclude<AgreementSkew, null>, string> = {
  function_behind:
    'This action is not available on the server yet. The Agreement Centre app is newer than '
    + 'the server code it is talking to — the change was merged but the Edge Functions have not '
    + 'been deployed. Nothing was changed; ask whoever manages deployments to ship '
    + 'manage-partner-agreements.',
  schema_behind:
    'The database is missing the columns this action needs. The Agreement Centre app is newer '
    + 'than the database — the migration was merged but has not been applied. Nothing was '
    + 'changed; ask whoever manages deployments to apply the pending migration.',
};

/**
 * The sentence to show a user for a failed Agreement Centre call.
 *
 * A server that gave us a real message keeps it — the disposition refusals are
 * written to be read ("Archive it instead", and why). Only the two skew
 * signatures and a bare slug are rewritten, because those are the cases where
 * the server's own words are no use to anybody.
 */
export function agreementErrorMessage(failure: AgreementApiFailure): string {
  const skew = detectSkew(failure);
  if (skew) return SKEW_MESSAGES[skew];

  const message = String(failure.message ?? '').trim();
  const code = String(failure.code ?? '').trim();

  // A real sentence from the server. Anything with a space and no underscore
  // spine was written for a person; pass it straight through.
  if (message && message !== code && /\s/.test(message) && !/^[a-z0-9_]+$/.test(message)) {
    return message;
  }

  // Otherwise all we have is a slug like `not_archivable`. Better than a raw
  // token, and it never pretends to know more than it does.
  const slug = (message || code).replace(/_/g, ' ').trim();
  return slug
    ? `The server rejected this action (${slug}). Nothing was changed.`
    : 'The server rejected this action. Nothing was changed.';
}
