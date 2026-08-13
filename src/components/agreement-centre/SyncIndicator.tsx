/**
 * "This page is live." One line, both portals.
 *
 * The cursor in `useAgreementSync` is invisible by design — it refetches and
 * the page changes under you. That is right until something is wrong with it,
 * at which point a page that silently stopped updating is worse than one that
 * never claimed to. So the state is stated: live and when it last checked,
 * checking, or reconnecting.
 *
 * The manual Refresh button stays and routes through the same cursor. Nobody
 * should have to trust an indicator, and a person who has just been told
 * something happened on the other side will press it regardless.
 */
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgreementSyncState } from '@/hooks/useAgreementSync';

/** "just now" for the first minute, then minutes. Seconds would be noise. */
function agoLabel(at: Date | null): string {
  if (!at) return '';
  const seconds = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function SyncIndicator({
  sync,
  className,
  label = 'Live',
}: {
  sync: AgreementSyncState;
  className?: string;
  label?: string;
}) {
  // The timestamp is static between polls, so the label has to re-render on its
  // own or "just now" survives for twenty minutes. Thirty seconds is finer than
  // anything this displays.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!sync.syncedAt && !sync.isStalled) return null;

  const stalled = sync.isStalled;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-muted-foreground',
        className,
      )}
      // Polite, not assertive: this changes on a timer and must never interrupt
      // somebody reading the agreement it sits above.
      aria-live="polite"
    >
      {sync.isSyncing ? (
        <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
      ) : (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            stalled ? 'bg-warning' : 'bg-success',
          )}
          aria-hidden
        />
      )}
      <span>
        {stalled
          ? 'Reconnecting…'
          : sync.isSyncing
            ? 'Checking…'
            : `${label} · checked ${agoLabel(sync.syncedAt)}`}
      </span>
    </span>
  );
}
