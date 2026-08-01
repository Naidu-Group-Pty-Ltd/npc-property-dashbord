/**
 * InternalMessageToasts — right-hand-side pop-up cards for new internal
 * messages so urgent items are actioned immediately, even when the Aurixa
 * widget is closed.
 *
 * Trust model: broadcasts only act as a "go and check" hint. The unread state
 * shown here always comes from the `internal-messaging` edge function, which
 * re-verifies thread participation server-side.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Megaphone, MessageSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  isInternalMessagesPanelOpen,
  onInternalMessage,
  requestOpenInternalMessages,
} from '@/lib/internalMessagingBus';
import { useAuth } from '@/hooks/useAuth';

interface ToastItem {
  /** Unique per message (thread + message timestamp) so every message pops. */
  key: string;
  thread_id: string;
  kind: 'direct' | 'broadcast';
  title: string;
  sender: string;
  preview: string;
  at: string;
  unread: number;
}

const POLL_MS = 15_000;
const AUTO_DISMISS_MS = 25_000;
const MAX_VISIBLE = 4;
const SEEN_KEY = 'aurixa.internalMessages.lastSeenAt';

export function InternalMessageToasts() {
  const { user } = useAuth();
  const [items, setItems] = useState<ToastItem[]>([]);
  /** Per-message keys already surfaced (or dismissed) — never thread-level. */
  const handledRef = useRef<Set<string>>(new Set());
  const lastSeenRef = useRef<string>(
    (() => {
      try { return localStorage.getItem(SEEN_KEY) || new Date().toISOString(); }
      catch { return new Date().toISOString(); }
    })(),
  );

  const dismiss = useCallback((key: string) => {
    setItems(prev => prev.filter(i => i.key !== key));
  }, []);

  const check = useCallback(async () => {
    try {
      const { data } = await invokeSecureFunction('internal-messaging', { action: 'list_threads' });
      const threads: any[] = data?.threads ?? [];
      const panelOpen = isInternalMessagesPanelOpen();

      const fresh = threads.filter(t => {
        if ((t.unread ?? 0) <= 0 || !t.last_message_at) return false;
        if (new Date(t.last_message_at) <= new Date(lastSeenRef.current)) return false;
        const key = t.last_message_id || `${t.id}:${t.last_message_at}`;
        return !handledRef.current.has(key);
      });
      if (!fresh.length) return;

      // Reading in the panel already: swallow silently so nothing re-pops later.
      for (const t of fresh) {
        handledRef.current.add(t.last_message_id || `${t.id}:${t.last_message_at}`);
      }
      if (panelOpen) return;

      setItems(prev => {
        const next = [...prev];
        for (const t of fresh) {
          next.push({
            key: t.last_message_id || `${t.id}:${t.last_message_at}`,
            thread_id: t.id,
            kind: t.kind === 'broadcast' ? 'broadcast' : 'direct',
            title: t.display_title || 'Team message',
            sender: t.last_message_sender_name || 'Unknown',
            preview: t.last_message_preview || 'New message',
            at: t.last_message_at,
            unread: t.unread ?? 1,
          });
        }
        return next.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, MAX_VISIBLE);
      });
    } catch {
      /* silent — badge/panel remain the source of truth */
    }
  }, []);

  // Realtime hint + safety-net poll
  useEffect(() => {
    if (!user) return;
    const off = onInternalMessage(() => { check(); });
    check();
    const id = setInterval(check, POLL_MS);
    return () => { off(); clearInterval(id); };
  }, [user, check]);

  // Auto-dismiss each card after a while so the surface never stacks up.
  useEffect(() => {
    if (!items.length) return;
    const timers = items.map(i => setTimeout(() => dismiss(i.key), AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
  }, [items, dismiss]);

  const open = (item: ToastItem) => {
    try {
      lastSeenRef.current = new Date().toISOString();
      localStorage.setItem(SEEN_KEY, lastSeenRef.current);
    } catch { /* ignore */ }
    setItems(prev => prev.filter(i => i.thread_id !== item.thread_id));
    requestOpenInternalMessages(item.thread_id);
  };

  if (!user || items.length === 0) return null;


  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[60] flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2">
      {items.map(item => (
        <div
          key={item.thread_id}
          role="alert"
          className={cn(
            'pointer-events-auto overflow-hidden rounded-xl border border-[color:var(--glass-hairline,hsl(var(--border)))]',
            'bg-card/95 backdrop-blur-xl shadow-[var(--elevation-3,0_18px_40px_-18px_rgba(0,0,0,0.55))]',
            'animate-in slide-in-from-right-4 fade-in-0 motion-reduce:animate-none',
          )}
        >
          <div className="flex items-start gap-2.5 px-3 py-2.5">
            <span className={cn(
              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
              item.kind === 'broadcast' ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary',
            )}>
              {item.kind === 'broadcast'
                ? <Megaphone className="h-3.5 w-3.5" />
                : <MessageSquare className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">
                {item.title}
                {item.unread > 1 && (
                  <span className="ml-1.5 rounded-full bg-destructive px-1.5 py-px text-[9px] font-bold text-destructive-foreground">
                    {item.unread}
                  </span>
                )}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                {item.preview}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => open(item)}>
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] text-muted-foreground"
                  onClick={() => dismiss(item.thread_id)}
                >
                  Later
                </Button>
              </div>
            </div>
            <button
              type="button"
              aria-label="Dismiss message alert"
              onClick={() => dismiss(item.thread_id)}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default InternalMessageToasts;
