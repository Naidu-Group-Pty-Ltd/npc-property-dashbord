/**
 * InternalMessageToasts — bubbly, interactive conversation pop-ups for internal
 * messages so urgent items can be read AND replied to immediately, even when
 * the Aurixa widget is closed.
 *
 * Behaviour contract:
 *  • One pop-up per thread. New messages cascade inside that same bubble stack.
 *  • No auto-dismiss — the user closes each pop-up manually.
 *  • Open pop-ups persist in localStorage, so they survive reloads, session
 *    timeouts and re-logins.
 *  • Replies can be flagged Normal / High / Urgent; pop-ups are ranked with
 *    urgent first, then high, then most recent.
 *
 * Trust model: broadcasts only act as a "go and check" hint. All content shown
 * here comes from the `internal-messaging` edge function, which re-verifies
 * thread participation server-side.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Megaphone, MessageSquare, Send, X, AlertTriangle, ArrowUpRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  isInternalMessagesPanelOpen,
  onInternalMessage,
  onInternalTyping,
  publishInternalMessage,
  publishInternalTyping,
  requestOpenInternalMessages,
} from '@/lib/internalMessagingBus';
import { useAuth } from '@/hooks/useAuth';

type Priority = 'normal' | 'high' | 'urgent';

interface PopupMessage {
  id: string;
  body: string;
  created_at: string;
  sender_name: string;
  mine: boolean;
  priority?: Priority;
}

interface PopupThread {
  thread_id: string;
  kind: 'direct' | 'broadcast';
  /** Counterparty / announcement title. */
  title: string;
  /** Name of the person who sent the latest inbound message. */
  sender: string;
  priority: Priority;
  lastAt: string;
  unread: number;
  messages: PopupMessage[];
  loading: boolean;
}

const POLL_MS = 15_000;
const MAX_VISIBLE = 3;
const SEEN_KEY = 'aurixa.internalMessages.lastSeenAt';
const OPEN_KEY = 'aurixa.internalMessages.openPopups';
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2 };

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
};

function readOpenIds(): string[] {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function writeOpenIds(ids: string[]) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(ids.slice(0, 8)));
  } catch {
    /* ignore */
  }
}

function timeLabel(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function InternalMessageToasts() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<PopupThread[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [priorities, setPriorities] = useState<Record<string, Priority>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});

  /** Threads the user explicitly dismissed this session — don't re-pop them. */
  const dismissedRef = useRef<Set<string>>(new Set());
  const threadsRef = useRef<PopupThread[]>([]);
  threadsRef.current = threads;

  const lastSeenRef = useRef<string>(
    (() => {
      try {
        return localStorage.getItem(SEEN_KEY) || new Date().toISOString();
      } catch {
        return new Date().toISOString();
      }
    })(),
  );

  const persist = useCallback((next: PopupThread[]) => {
    writeOpenIds(next.map((t) => t.thread_id));
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    try {
      const { data } = await invokeSecureFunction('internal-messaging', {
        action: 'get_thread',
        thread_id: threadId,
      });
      const msgs: PopupMessage[] = (data?.messages ?? []).slice(-40);
      setThreads((prev) =>
        prev.map((t) =>
          t.thread_id === threadId ? { ...t, messages: msgs, loading: false, unread: 0 } : t,
        ),
      );
    } catch {
      setThreads((prev) =>
        prev.map((t) => (t.thread_id === threadId ? { ...t, loading: false } : t)),
      );
    }
  }, []);

  /** Poll thread list: opens new pop-ups and refreshes already-open ones. */
  const check = useCallback(async () => {
    try {
      const { data } = await invokeSecureFunction('internal-messaging', { action: 'list_threads' });
      const list: any[] = data?.threads ?? [];
      const panelOpen = isInternalMessagesPanelOpen();
      const openIds = new Set(threadsRef.current.map((t) => t.thread_id));
      const persistedIds = new Set(readOpenIds());

      const toRefresh: string[] = [];
      const additions: PopupThread[] = [];

      for (const t of list) {
        const isOpen = openIds.has(t.id);
        const wasPersisted = persistedIds.has(t.id);
        const hasFreshInbound =
          (t.unread ?? 0) > 0 &&
          !!t.last_message_at &&
          new Date(t.last_message_at) > new Date(lastSeenRef.current);

        if (isOpen) {
          const current = threadsRef.current.find((x) => x.thread_id === t.id);
          if (current && (!current.messages.length || current.lastAt !== (t.last_message_at ?? ''))) {
            toRefresh.push(t.id);
          }
          setThreads((prev) =>
            prev.map((x) =>
              x.thread_id === t.id
                ? {
                    ...x,
                    lastAt: t.last_message_at ?? x.lastAt,
                    priority: (t.last_message_priority as Priority) ?? x.priority,
                    sender:
                      t.last_message_sender_name && t.last_message_sender_name !== 'You'
                        ? t.last_message_sender_name
                        : x.sender,
                  }
                : x,
            ),
          );
          continue;
        }

        const shouldOpen =
          wasPersisted || (hasFreshInbound && !panelOpen && !dismissedRef.current.has(t.id));
        if (!shouldOpen) continue;

        additions.push({
          thread_id: t.id,
          kind: t.kind === 'broadcast' ? 'broadcast' : 'direct',
          title: t.display_title || 'Team message',
          sender:
            t.last_message_sender_name && t.last_message_sender_name !== 'You'
              ? t.last_message_sender_name
              : t.display_title || 'Team member',
          priority: (t.last_message_priority as Priority) ?? 'normal',
          lastAt: t.last_message_at ?? new Date().toISOString(),
          unread: t.unread ?? 0,
          messages: [],
          loading: true,
        });
      }

      if (additions.length) {
        setThreads((prev) => {
          const next = [...prev, ...additions.filter((a) => !prev.some((p) => p.thread_id === a.thread_id))];
          persist(next);
          return next;
        });
        additions.forEach((a) => loadMessages(a.thread_id));
      }
      toRefresh.forEach((id) => loadMessages(id));
    } catch {
      /* silent — badge/panel remain the source of truth */
    }
  }, [loadMessages, persist]);

  // Realtime hint + safety-net poll
  useEffect(() => {
    if (!user) return;
    const off = onInternalMessage(() => {
      check();
    });
    check();
    const id = setInterval(check, POLL_MS);
    return () => {
      off();
      clearInterval(id);
    };
  }, [user, check]);

  // Typing hints for threads with an open pop-up.
  useEffect(() => {
    if (!user) return;
    const off = onInternalTyping((s) => {
      if (s.user_id === user.id) return;
      if (!threadsRef.current.some((t) => t.thread_id === s.thread_id)) return;
      setTyping((prev) => ({ ...prev, [s.thread_id]: { name: s.user_name, at: Date.now() } }));
    });
    const sweep = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next: typeof prev = {};
        for (const [k, v] of Object.entries(prev)) if (now - v.at < 4000) next[k] = v;
        return next;
      });
    }, 1500);
    return () => {
      off();
      clearInterval(sweep);
    };
  }, [user]);

  const dismiss = useCallback(
    (threadId: string) => {
      dismissedRef.current.add(threadId);
      try {
        lastSeenRef.current = new Date().toISOString();
        localStorage.setItem(SEEN_KEY, lastSeenRef.current);
      } catch {
        /* ignore */
      }
      setThreads((prev) => {
        const next = prev.filter((t) => t.thread_id !== threadId);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const send = useCallback(
    async (thread: PopupThread) => {
      const text = (drafts[thread.thread_id] ?? '').trim();
      if (!text || sending[thread.thread_id]) return;
      const priority = priorities[thread.thread_id] ?? 'normal';
      setSending((p) => ({ ...p, [thread.thread_id]: true }));
      try {
        const { data } = await invokeSecureFunction('internal-messaging', {
          action: 'send_message',
          thread_id: thread.thread_id,
          body: text,
          priority,
        });
        const msg = data?.message;
        setDrafts((p) => ({ ...p, [thread.thread_id]: '' }));
        setThreads((prev) =>
          prev.map((t) =>
            t.thread_id === thread.thread_id
              ? {
                  ...t,
                  lastAt: msg?.created_at ?? new Date().toISOString(),
                  messages: [
                    ...t.messages,
                    {
                      id: msg?.id ?? `local-${Date.now()}`,
                      body: text,
                      created_at: msg?.created_at ?? new Date().toISOString(),
                      sender_name: 'You',
                      mine: true,
                      priority,
                    },
                  ].slice(-40),
                }
              : t,
          ),
        );
        publishInternalMessage({
          thread_id: thread.thread_id,
          sender_id: user?.id ?? null,
          sender_name: 'You',
        });
      } catch {
        /* keep the draft so nothing is lost */
      } finally {
        setSending((p) => ({ ...p, [thread.thread_id]: false }));
      }
    },
    [drafts, priorities, sending, user],
  );

  const onDraftChange = useCallback(
    (thread: PopupThread, value: string) => {
      setDrafts((p) => ({ ...p, [thread.thread_id]: value }));
      if (value.trim() && user) {
        publishInternalTyping({
          thread_id: thread.thread_id,
          user_id: user.id,
          user_name: (user as any).username ?? 'A team member',
        });
      }
    },
    [user],
  );

  const ranked = useMemo(
    () =>
      [...threads]
        .sort((a, b) => {
          const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
          if (p !== 0) return p;
          return a.lastAt < b.lastAt ? 1 : -1;
        })
        .slice(0, MAX_VISIBLE),
    [threads],
  );

  if (!user || ranked.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3">
      {ranked.map((thread) => {
        const priority = priorities[thread.thread_id] ?? 'normal';
        const typer = typing[thread.thread_id];
        return (
          <div
            key={thread.thread_id}
            role="dialog"
            aria-label={`Message from ${thread.sender}`}
            className={cn(
              'pointer-events-auto overflow-hidden rounded-3xl border bg-card/95 backdrop-blur-xl',
              'shadow-[var(--elevation-3,0_18px_40px_-18px_rgba(0,0,0,0.55))]',
              'animate-in slide-in-from-right-4 fade-in-0 motion-reduce:animate-none',
              thread.priority === 'urgent'
                ? 'border-destructive/60 ring-1 ring-destructive/30'
                : thread.priority === 'high'
                  ? 'border-warning/50'
                  : 'border-[color:var(--glass-hairline,hsl(var(--border)))]',
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 border-b border-border/50 px-3.5 py-2.5">
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold uppercase',
                  thread.kind === 'broadcast' ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary',
                )}
              >
                {thread.kind === 'broadcast' ? (
                  <Megaphone className="h-4 w-4" />
                ) : (
                  thread.sender?.trim()?.[0] ?? <MessageSquare className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {thread.kind === 'broadcast' ? thread.title : thread.sender}
                </p>
                <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/80">
                  {thread.kind === 'broadcast' ? 'Announcement' : 'Direct message'}
                  {thread.priority !== 'normal' && ` · ${PRIORITY_LABEL[thread.priority]}`}
                </p>
              </div>
              {thread.priority === 'urgent' && (
                <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
              )}
              <button
                type="button"
                aria-label="Open in team messages"
                onClick={() => requestOpenInternalMessages(thread.thread_id)}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Close message"
                onClick={() => dismiss(thread.thread_id)}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Conversation */}
            <ScrollArea className="max-h-56 px-3 py-2.5">
              {thread.loading ? (
                <div className="flex items-center gap-2 py-4 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading conversation…
                </div>
              ) : thread.messages.length === 0 ? (
                <p className="py-4 text-[11px] text-muted-foreground">No messages yet.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {thread.messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn('flex flex-col', m.mine ? 'items-end' : 'items-start')}
                    >
                      <div
                        className={cn(
                          'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[12px] leading-snug',
                          m.mine
                            ? 'rounded-br-md bg-primary text-primary-foreground'
                            : 'rounded-bl-md bg-muted text-foreground',
                          m.priority === 'urgent' && !m.mine && 'ring-1 ring-destructive/50',
                        )}
                      >
                        {m.body}
                      </div>
                      <span className="mt-0.5 px-1 text-[9px] text-muted-foreground/70">
                        {m.mine ? 'You' : m.sender_name} · {timeLabel(m.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {typer && (
                <p className="mt-1.5 px-1 text-[10px] italic text-muted-foreground animate-pulse motion-reduce:animate-none">
                  {typer.name} is typing…
                </p>
              )}
            </ScrollArea>

            {/* Reply */}
            <div className="border-t border-border/50 px-3 py-2.5">
              <Textarea
                value={drafts[thread.thread_id] ?? ''}
                onChange={(e) => onDraftChange(thread, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(thread);
                  }
                }}
                placeholder="Reply…"
                rows={2}
                className="min-h-[42px] resize-none rounded-2xl border-border/60 bg-background/60 text-[12px]"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {(['normal', 'high', 'urgent'] as Priority[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriorities((prev) => ({ ...prev, [thread.thread_id]: p }))}
                      aria-pressed={priority === p}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                        priority === p
                          ? p === 'urgent'
                            ? 'border-destructive bg-destructive/15 text-destructive'
                            : p === 'high'
                              ? 'border-warning bg-warning/15 text-warning'
                              : 'border-primary bg-primary/15 text-primary'
                          : 'border-border/60 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {PRIORITY_LABEL[p]}
                    </button>
                  ))}
                </div>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 rounded-full px-3 text-[11px]"
                  disabled={!((drafts[thread.thread_id] ?? '').trim()) || !!sending[thread.thread_id]}
                  onClick={() => send(thread)}
                >
                  {sending[thread.thread_id] ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Send
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default InternalMessageToasts;
