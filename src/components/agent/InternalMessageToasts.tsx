/**
 * InternalMessageToasts — bubbly, interactive conversation pop-ups for internal
 * messages so urgent items can be read AND replied to immediately, even when
 * the Aurixa widget is closed.
 *
 * Behaviour contract:
 *  • One pop-up per thread. New messages cascade inside that same bubble stack.
 *  • Only ONE pop-up is expanded at a time (the newest / highest ranked). Every
 *    other open conversation collapses to a small name-only chip above it — the
 *    older transcript disappears but the person (or "Announcement") stays
 *    visible and one click brings it back to the front.
 *  • Every new message pops: dismissal is recorded per-thread against the
 *    message timestamp, so a later message re-opens that conversation.
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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Megaphone, MessageSquare, Send, X, AlertTriangle, ArrowUpRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
/** Collapsed chips shown above the expanded card. */
const MAX_CHIPS = 4;
const OPEN_KEY = 'aurixa.internalMessages.openPopups';
const BASELINE_KEY = 'aurixa.internalMessages.threadBaselines';
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

/** Per-thread "already handled up to this message time" markers. */
function readBaselines(): Record<string, string> {
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeBaselines(map: Record<string, string>) {
  try {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(map));
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

/** Three-dot animated typing indicator, matching the messages panel. */
function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-1', className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-bounce motion-reduce:animate-none"
          style={{ animationDelay: `${i * 140}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  );
}


export function InternalMessageToasts() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<PopupThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [priorities, setPriorities] = useState<Record<string, Priority>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});

  const threadsRef = useRef<PopupThread[]>([]);
  threadsRef.current = threads;
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  /** Baselines: thread_id → ISO timestamp of the newest message already handled. */
  const baselinesRef = useRef<Record<string, string>>(readBaselines());
  /** Session start — messages older than this never pop on first load. */
  const bootAtRef = useRef<string>(new Date().toISOString());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const persist = useCallback((next: PopupThread[]) => {
    writeOpenIds(next.map((t) => t.thread_id));
  }, []);

  const setBaseline = useCallback((threadId: string, iso: string) => {
    baselinesRef.current = { ...baselinesRef.current, [threadId]: iso };
    writeBaselines(baselinesRef.current);
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    try {
      const { data } = await invokeSecureFunction('internal-messaging', {
        action: 'get_thread',
        thread_id: threadId,
      });
      const msgs: PopupMessage[] = (data?.messages ?? []).slice(-60);
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
        const lastAt: string | null = t.last_message_at ?? null;
        const senderName =
          t.last_message_sender_name && t.last_message_sender_name !== 'You'
            ? t.last_message_sender_name
            : t.kind === 'broadcast'
              ? t.display_title || 'Announcement'
              : t.display_title || 'Team member';

        if (openIds.has(t.id)) {
          const current = threadsRef.current.find((x) => x.thread_id === t.id);
          const changed = !!lastAt && current?.lastAt !== lastAt;
          if (current && (!current.messages.length || changed)) toRefresh.push(t.id);
          setThreads((prev) =>
            prev.map((x) =>
              x.thread_id === t.id
                ? {
                    ...x,
                    lastAt: lastAt ?? x.lastAt,
                    priority: (t.last_message_priority as Priority) ?? x.priority,
                    sender: senderName,
                  }
                : x,
            ),
          );
          // A brand-new inbound message brings this conversation to the front.
          if (changed && (t.unread ?? 0) > 0) setActiveId(t.id);
          continue;
        }

        // Re-open rule: any inbound message newer than the per-thread baseline
        // (or newer than this session's boot time for never-seen threads).
        const baseline = baselinesRef.current[t.id] ?? bootAtRef.current;
        const hasFreshInbound =
          (t.unread ?? 0) > 0 && !!lastAt && new Date(lastAt) > new Date(baseline);

        const shouldOpen = persistedIds.has(t.id) || (hasFreshInbound && !panelOpen);
        if (!shouldOpen) continue;

        additions.push({
          thread_id: t.id,
          kind: t.kind === 'broadcast' ? 'broadcast' : 'direct',
          title: t.display_title || 'Team message',
          sender: senderName,
          priority: (t.last_message_priority as Priority) ?? 'normal',
          lastAt: lastAt ?? new Date().toISOString(),
          unread: t.unread ?? 0,
          messages: [],
          loading: true,
        });
      }

      if (additions.length) {
        setThreads((prev) => {
          const next = [
            ...prev,
            ...additions.filter((a) => !prev.some((p) => p.thread_id === a.thread_id)),
          ];
          persist(next);
          return next;
        });
        // Newest inbound conversation becomes the expanded pop-up.
        const newest = [...additions].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))[0];
        setActiveId(newest.thread_id);
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

  // Keep an expanded card whenever pop-ups exist.
  useEffect(() => {
    if (!threads.length) {
      if (activeId) setActiveId(null);
      return;
    }
    if (!activeId || !threads.some((t) => t.thread_id === activeId)) {
      const next = [...threads].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))[0];
      setActiveId(next.thread_id);
    }
  }, [threads, activeId]);

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

  const active = useMemo(
    () => threads.find((t) => t.thread_id === activeId) ?? null,
    [threads, activeId],
  );

  // Pin the transcript to the newest message so nothing is cut off.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active?.thread_id, active?.messages.length, active?.loading]);

  const dismiss = useCallback(
    (threadId: string) => {
      const thread = threadsRef.current.find((t) => t.thread_id === threadId);
      setBaseline(threadId, thread?.lastAt ?? new Date().toISOString());
      setThreads((prev) => {
        const next = prev.filter((t) => t.thread_id !== threadId);
        persist(next);
        return next;
      });
      if (activeRef.current === threadId) setActiveId(null);
    },
    [persist, setBaseline],
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
        const createdAt = msg?.created_at ?? new Date().toISOString();
        setDrafts((p) => ({ ...p, [thread.thread_id]: '' }));
        setBaseline(thread.thread_id, createdAt);
        setThreads((prev) =>
          prev.map((t) =>
            t.thread_id === thread.thread_id
              ? {
                  ...t,
                  lastAt: createdAt,
                  messages: [
                    ...t.messages,
                    {
                      id: msg?.id ?? `local-${Date.now()}`,
                      body: text,
                      created_at: createdAt,
                      sender_name: 'You',
                      mine: true,
                      priority,
                    },
                  ].slice(-60),
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
    [drafts, priorities, sending, user, setBaseline],
  );

  const onDraftChange = useCallback(
    (thread: PopupThread, value: string) => {
      setDrafts((p) => ({ ...p, [thread.thread_id]: value }));
      if (!value.trim() || !user) return;
      // Throttle so a fast typist emits at most one hint every 1.2s.
      const now = Date.now();
      if (now - (lastTypingSentRef.current[thread.thread_id] ?? 0) < 1200) return;
      lastTypingSentRef.current[thread.thread_id] = now;
      publishInternalTyping({
        thread_id: thread.thread_id,
        user_id: user.id,
        user_name: (user as any).username ?? 'A team member',
      });
    },
    [user],
  );


  /** Collapsed chips: every open conversation except the expanded one. */
  const chips = useMemo(
    () =>
      threads
        .filter((t) => t.thread_id !== activeId)
        .sort((a, b) => {
          const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
          if (p !== 0) return p;
          return a.lastAt < b.lastAt ? 1 : -1;
        })
        .slice(0, MAX_CHIPS),
    [threads, activeId],
  );

  if (!user || !active) return null;

  const priority = priorities[active.thread_id] ?? 'normal';
  const typer = typing[active.thread_id];
  const headline = active.kind === 'broadcast' ? active.title : active.sender;

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[60] flex w-[min(26rem,calc(100vw-2rem))] flex-col items-end gap-2">
      {/* Collapsed conversations — name only, transcript hidden */}
      {chips.map((t) => (
        <div
          key={t.thread_id}
          className={cn(
            'pointer-events-auto flex max-w-full items-center gap-2 rounded-full border bg-card/95 px-3 py-1.5 backdrop-blur-xl',
            'shadow-[var(--elevation-2,0_10px_24px_-14px_rgba(0,0,0,0.5))]',
            t.priority === 'urgent'
              ? 'border-destructive/60'
              : t.priority === 'high'
                ? 'border-warning/50'
                : 'border-[color:var(--glass-hairline,hsl(var(--border)))]',
          )}
        >
          <button
            type="button"
            onClick={() => setActiveId(t.thread_id)}
            className="flex min-w-0 items-center gap-2 text-left"
            aria-label={`Expand conversation with ${t.kind === 'broadcast' ? t.title : t.sender}`}
          >
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase',
                t.kind === 'broadcast' ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary',
              )}
            >
              {t.kind === 'broadcast' ? (
                <Megaphone className="h-3 w-3" />
              ) : (
                t.sender?.trim()?.[0] ?? <MessageSquare className="h-3 w-3" />
              )}
            </span>
            <span className="truncate text-xs font-semibold text-foreground">
              {t.kind === 'broadcast' ? t.title : t.sender}
            </span>
            {t.unread > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {t.unread > 9 ? '9+' : t.unread}
              </span>
            )}
            {typing[t.thread_id] && (
              <TypingDots className="shrink-0" />
            )}

          </button>
          <button
            type="button"
            aria-label="Close conversation"
            onClick={() => dismiss(t.thread_id)}
            className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      {/* Expanded conversation */}
      <div
        role="dialog"
        aria-label={`Message from ${headline}`}
        className={cn(
          'pointer-events-auto flex w-full flex-col overflow-hidden rounded-3xl border bg-card/95 backdrop-blur-xl',
          'shadow-[var(--elevation-3,0_18px_40px_-18px_rgba(0,0,0,0.55))]',
          'animate-in slide-in-from-right-4 fade-in-0 motion-reduce:animate-none',
          active.priority === 'urgent'
            ? 'border-destructive/60 ring-1 ring-destructive/30'
            : active.priority === 'high'
              ? 'border-warning/50'
              : 'border-[color:var(--glass-hairline,hsl(var(--border)))]',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border/50 px-3.5 py-2.5">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold uppercase',
              active.kind === 'broadcast' ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary',
            )}
          >
            {active.kind === 'broadcast' ? (
              <Megaphone className="h-4 w-4" />
            ) : (
              active.sender?.trim()?.[0] ?? <MessageSquare className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{headline}</p>
            <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/80">
              {active.kind === 'broadcast' ? 'Announcement' : 'Direct message'}
              {active.priority !== 'normal' && ` · ${PRIORITY_LABEL[active.priority]}`}
            </p>
          </div>
          {active.priority === 'urgent' && (
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          )}
          <button
            type="button"
            aria-label="Open in team messages"
            onClick={() => requestOpenInternalMessages(active.thread_id)}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Close message"
            onClick={() => dismiss(active.thread_id)}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Conversation — native scroll so the newest bubble is never clipped */}
        <div
          ref={scrollRef}
          className="h-64 overflow-y-auto overscroll-contain px-3 py-2.5"
          aria-live="polite"
        >
          {active.loading ? (
            <div className="flex items-center gap-2 py-4 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading conversation…
            </div>
          ) : active.messages.length === 0 ? (
            <p className="py-4 text-[11px] text-muted-foreground">No messages yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {active.messages.map((m) => (
                <div key={m.id} className={cn('flex flex-col', m.mine ? 'items-end' : 'items-start')}>
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
            <div className="mt-1.5 flex flex-col items-start" aria-live="polite">
              <div className="flex max-w-[85%] items-center gap-1.5 rounded-2xl rounded-bl-md bg-muted px-3 py-2">
                <TypingDots />
              </div>
              <span className="mt-0.5 px-1 text-[9px] text-muted-foreground/70">
                {typer.name} is typing…
              </span>
            </div>
          )}

        </div>

        {/* Reply */}
        <div className="border-t border-border/50 px-3 py-2.5">
          <Textarea
            value={drafts[active.thread_id] ?? ''}
            onChange={(e) => onDraftChange(active, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(active);
              }
            }}
            placeholder="Reply…"
            rows={2}
            className="min-h-[46px] resize-none rounded-2xl border-border/60 bg-background/60 text-[12px]"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {(['normal', 'high', 'urgent'] as Priority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriorities((prev) => ({ ...prev, [active.thread_id]: p }))}
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
              disabled={!((drafts[active.thread_id] ?? '').trim()) || !!sending[active.thread_id]}
              onClick={() => send(active)}
            >
              {sending[active.thread_id] ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InternalMessageToasts;
