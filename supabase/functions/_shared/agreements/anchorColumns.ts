/**
 * Whether this database can store a change request's anchor.
 *
 * The three `anchor_*` columns are additive and nullable, and the migration
 * that adds them is safe. It is also applied out of band, and this repo has
 * already lost three weeks to a merged-but-unapplied migration
 * (`docs/agreements/SENDING.md`). An insert naming a column PostgREST does not
 * know about fails with `PGRST204` and takes the whole request with it — so
 * without this probe, turning pins on would mean a partner clicking a clause,
 * typing a request, and losing it.
 *
 * Probed once per isolate, exactly like `financeNotificationRouting.pure.ts`,
 * and for the same reason: the feature must not depend on a deploy the repo
 * cannot guarantee. When the columns are absent the request is still saved,
 * with its location folded into the first line of the comment. The pin is lost;
 * the request never is.
 */

let probe: Promise<boolean> | null = null;

/** PostgREST's "column not in the schema cache", and Postgres' own. */
function readsAsMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  return /anchor_path/i.test(String(error.message ?? ''))
    && /(does not exist|schema cache|could not find)/i.test(String(error.message ?? ''));
}

export function agreementAnchorsSupported(supabase: any): Promise<boolean> {
  if (!probe) {
    probe = supabase
      .from('partner_agreement_change_requests')
      .select('anchor_path')
      .limit(0)
      .then((result: { error?: { code?: string; message?: string } | null }) => {
        if (readsAsMissingColumn(result?.error ?? null)) {
          console.warn(
            '[agreements] change-request anchor columns absent — migration '
            + '20260913000000 has not been applied. Pinned requests will save with their '
            + 'location in the comment instead.',
          );
          return false;
        }
        return true;
      })
      // An inconclusive probe assumes support: the columns are far more likely
      // to be there than not, and a false negative permanently degrades a
      // feature that works, whereas a false positive fails one insert loudly.
      .catch(() => true);
  }
  return probe;
}

/** Test seam — the probe is module state and would leak between cases. */
export function resetAgreementAnchorProbe(): void {
  probe = null;
}
