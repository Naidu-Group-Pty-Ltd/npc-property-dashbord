/**
 * Keep two portals looking at the same agreement.
 *
 * ## The bug this closes
 *
 * "Agreements are not reaching the Finance Portal." They are — measured end to
 * end against production, one was issued at 16:22:15 and opened by the partner
 * at 16:22:26. What was actually missing is that every agreement surface on
 * both sides fetched exactly once, on mount, and then never again: no interval,
 * no refetch on focus, no subscription. The only thing in either portal that
 * polled at all was the notification bell's unread COUNT, which moves a badge
 * and refreshes no agreement view.
 *
 * So the failure people saw is real and is not a delivery failure. Issue in the
 * Command Centre, switch to a Finance Portal tab that has been open since
 * breakfast, and the agreement is not there — because that tab last asked the
 * server hours ago. The same gap runs the other way: a partner accepts and the
 * register keeps saying "Awaiting partner review" until somebody reloads.
 *
 * ## Why polling and not Realtime
 *
 * See `syncStamp.pure.ts`. Short version: the Finance Portal authenticates with
 * a bespoke server-resolved session token, not a Supabase JWT, and the
 * agreement tables are service-role only — so the partner's browser has no
 * authenticated socket and no row-level read path. `postgres_changes` is not
 * available to it without handing the browser a Supabase credential and opening
 * RLS on the agreement register, which is a much larger change than the problem
 * warrants.
 *
 * ## How this stays cheap
 *
 * It polls a stamp — four scalars — and not a payload. The real queries are
 * re-run only when the stamp moves, so a portal left open all day costs three
 * indexed counts a minute and refetches nothing. Two properties matter:
 *
 *  - **Hidden tabs do not poll.** React Query pauses `refetchInterval` when the
 *    document is hidden, which is most tabs most of the time.
 *  - **A visible tab syncs the instant it is looked at.** `refetchOnWindowFocus`
 *    is turned on here specifically — the app's global default is `false` — and
 *    `staleTime: 0` is what makes that refetch actually happen. This is the half
 *    that fixes the reported scenario; the interval only covers somebody sitting
 *    on the page while the other side moves.
 *
 * The hook itself is transport-agnostic: the Command Centre reaches
 * `manage-partner-agreements` with a staff session, the Finance Portal reaches
 * `finance-portal-agreements` with its own, and both hand this a `fetchStamp`.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AGREEMENT_SYNC_INTERVAL_MS,
  stampsDiffer,
  type AgreementSyncStamp,
} from '@/lib/agreements';

export interface UseAgreementSyncOptions {
  /**
   * What this cursor is watching, as a cache key suffix — the register, one
   * agreement, one partner's inbox. Two surfaces watching the same thing share
   * one poll rather than doubling it.
   */
  scope: readonly unknown[];
  /** Ask the server. Returning null means "could not tell" and is not a change. */
  fetchStamp: () => Promise<AgreementSyncStamp | null>;
  /**
   * Fired once per genuine move. Invalidate the real queries here — this hook
   * deliberately owns no knowledge of what they are.
   */
  onChange: (next: AgreementSyncStamp, previous: AgreementSyncStamp) => void;
  enabled?: boolean;
  intervalMs?: number;
}

export interface AgreementSyncState {
  stamp: AgreementSyncStamp | null;
  /** When the server last answered. Null until the first successful poll. */
  syncedAt: Date | null;
  /** True while a poll is in flight — for a quiet indicator, never a spinner. */
  isSyncing: boolean;
  /** The last poll failed. The UI says "reconnecting", not "broken". */
  isStalled: boolean;
  /** Force a poll now — the manual Refresh button routes through here. */
  syncNow: () => void;
}

export function useAgreementSync(options: UseAgreementSyncOptions): AgreementSyncState {
  const { scope, fetchStamp, onChange, enabled = true } = options;
  const intervalMs = options.intervalMs ?? AGREEMENT_SYNC_INTERVAL_MS;

  // Both held in refs so a caller re-creating its closures every render — which
  // every caller does — cannot restart the poll or re-fire the comparison.
  const fetchRef = useRef(fetchStamp);
  fetchRef.current = fetchStamp;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const query = useQuery({
    queryKey: ['agreement-sync', ...scope],
    enabled,
    queryFn: () => fetchRef.current(),
    // Explicit, and both against the app's global defaults: without
    // `staleTime: 0` the focus refetch is served from cache and the tab-switch
    // case — the one actually reported — stays broken.
    staleTime: 0,
    gcTime: 60_000,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    // A cursor is worth one quick retry and no more. Failing fast leaves the
    // next tick to recover, and a backed-off retry storm behind a flaky network
    // would poll harder than the interval it is meant to respect.
    retry: 1,
    retryDelay: 2_000,
  });

  // The previous stamp is held WITH the scope it was taken under, in one ref.
  // Two effects — compare, then reset on scope change — would be a race in
  // declaration order: on the render where both change, the comparison runs
  // first and measures the new agreement's stamp against the old agreement's,
  // which refetches everything on every navigation between detail pages.
  const previousRef = useRef<{ scope: string; stamp: AgreementSyncStamp } | null>(null);
  const scopeKey = JSON.stringify(scope);
  const stamp = query.data ?? null;

  useEffect(() => {
    if (!stamp) return;
    const previous = previousRef.current;
    previousRef.current = { scope: scopeKey, stamp };
    // The first stamp for a scope is a baseline, never a change: treating it as
    // one would make every mount invalidate the queries it has only just
    // fetched.
    if (!previous || previous.scope !== scopeKey) return;
    if (stampsDiffer(previous.stamp, stamp)) onChangeRef.current(stamp, previous.stamp);
  }, [stamp, scopeKey]);

  const { refetch } = query;
  const syncNow = useCallback(() => { void refetch(); }, [refetch]);

  return {
    stamp,
    syncedAt: query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null,
    isSyncing: query.isFetching,
    isStalled: query.isError,
    syncNow,
  };
}
