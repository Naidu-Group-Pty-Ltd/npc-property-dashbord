/**
 * The Finance Portal half of the cross-portal cursor.
 *
 * Same mechanism as `useAgreementCentreSync`, different transport: the partner
 * has no Supabase session, so every call goes through `invokeFinanceFunction`
 * and the portal's own session token. See `useAgreementSync` for why this is a
 * poll rather than a subscription, and `syncStamp.pure.ts` for what a stamp is.
 *
 * The stamp the server computes here is scoped to the partner's own
 * organisation, so an agreement issued to somebody else moves nothing on this
 * page — the cursor is as narrow as the list it guards.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { useAgreementSync, type AgreementSyncState } from '@/hooks/useAgreementSync';
import type { AgreementSyncStamp } from '@/lib/agreements';

export function useFinanceAgreementSync(agreementId?: string | null): AgreementSyncState {
  const queryClient = useQueryClient();
  const { user, invokeFinanceFunction } = useFinancePortalAuth();
  const [supported, setSupported] = useState(true);

  const fetchStamp = useCallback(async (): Promise<AgreementSyncStamp | null> => {
    const { data, error } = await invokeFinanceFunction('finance-portal-agreements', {
      operation: 'sync',
    });
    const message = String(error?.message ?? (data as { error?: string } | null)?.error ?? '');
    if (message) {
      // A portal running against a function deployed before this operation
      // existed gets "Unknown operation" every twenty seconds for ever. Notice
      // once, stop asking, and leave the page with the manual Refresh it had.
      if (/unknown operation/i.test(message)) {
        setSupported(false);
        return null;
      }
      // Everything else is a real failure and is thrown, so the indicator says
      // "Reconnecting…" instead of a page claiming to be live with a dead
      // cursor behind it.
      throw new Error(message);
    }
    return ((data as { stamp?: AgreementSyncStamp } | null)?.stamp) ?? null;
  }, [invokeFinanceFunction]);

  const onChange = useCallback(() => {
    // The inbox, the dashboard card that reads the same endpoint, and the open
    // agreement room. Invalidating the list key covers the first two because
    // they share it.
    queryClient.invalidateQueries({ queryKey: ['finance-portal-agreements'] });
    queryClient.invalidateQueries({ queryKey: ['finance-portal-notifications'] });
    if (agreementId) {
      queryClient.invalidateQueries({ queryKey: ['finance-portal-agreement', agreementId] });
    }
  }, [queryClient, agreementId]);

  // Deliberately NOT keyed on `agreementId`. The stamp this endpoint computes
  // is the partner's whole organisation either way, so keying per agreement
  // would run a second identical poll on every detail page. One key means the
  // layout's cursor and the page's cursor are the same query — React Query
  // shares the fetch and the interval, and each instance still runs its own
  // `onChange`, which is where the per-page invalidation lives.
  return useAgreementSync({
    scope: ['finance-portal', user?.id ?? 'anonymous'],
    enabled: supported && !!user,
    fetchStamp,
    onChange,
  });
}
