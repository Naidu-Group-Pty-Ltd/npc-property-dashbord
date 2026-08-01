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
import {
  Megaphone,
  MessageSquare,
  Minus,
  Paperclip,
  Send,
  X,
  AlertTriangle,
  Loader2,
  GripVertical,
  RotateCcw,
} from 'lucide-react';
import { useDraggablePosition } from '@/hooks/useDraggablePosition';

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
} from '@/lib/internalMessagingBus';
import {
  AttachmentDropOverlay,
  InternalAttachmentQueue,
  InternalAttachmentList,
} from '@/components/agent/InternalAttachmentChips';
import { useInternalAttachmentQueue } from '@/hooks/useInternalAttachmentQueue';
import { TypingDots, TypingPresence } from '@/components/messaging/TypingPresence';
import {
  INTERNAL_ATTACHMENT_ACCEPT,
  filesFromDataTransfer,
  type InternalAttachment,
} from '@/lib/internalMessageAttachments';
import { useAuth } from '@/hooks/useAuth';


type Priority = 'normal' | 'high' | 'urgent';

interface PopupMessage {
  id: string;
  body: string;
  created_at: string;
  sender_name: string;
  mine: boolean;
  priority?: Priority;
  attachments?: InternalAttachment[] | null;
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
const MAX_CHIPS = 6;
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

/**
 * A minimised conversation chip. Each chip can be dragged out of the dock to any
 * spot on the page (position persisted per thread); the grip resets it back to
 * the dock on double-click.
 */
function MinimisedChip({
  thread,
  typingNow,
  onExpand,
  onDismiss,
}: {
  thread: PopupThread;
  typingNow: boolean;
  onExpand: () => void;
  onDismiss: () => void;
}) {
  const drag = useDraggablePosition(`aurixa.internalMessages.chipPos.${thread.thread_id}`);
  const label = thread.kind === 'broadcast' ? thread.title : thread.sender;

  return (
    <div
      ref={drag.nodeRef}
      style={drag.positionStyle}
      className={cn(
        'pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full border bg-card/95 px-2 py-1.5 backdrop-blur-xl',
        'shadow-[var(--elevation-2,0_10px_24px_-14px_rgba(0,0,0,0.5))]',
        drag.dragging && 'z-[70] scale-[1.02] shadow-[var(--elevation-3,0_18px_40px_-18px_rgba(0,0,0,0.55))]',
        drag.position && 'z-[65]',
        thread.priority === 'urgent'
          ? 'border-destructive/60'
          : thread.priority === 'high'
            ? 'border-warning/50'
            : 'border-[color:var(--glass-hairline,hsl(var(--border)))]',
      )}
    >
      <span
        {...drag.handleProps}
        onDoubleClick={drag.reset}
        role="button"
        tabIndex={-1}
        aria-label={`Move ${label} chat — double-click to snap back`}
        title="Drag to move · double-click to snap back"
        className="shrink-0 cursor-grab text-muted-foreground/70 hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <button
        type="button"
        onClick={onExpand}
        className="flex min-w-0 items-center gap-2 text-left"
        aria-label={`Expand conversation with ${label}`}
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase',
            thread.kind === 'broadcast' ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary',
          )}
        >
          {thread.kind === 'broadcast' ? (
            <Megaphone className="h-3 w-3" />
          ) : (
            thread.sender?.trim()?.[0] ?? <MessageSquare className="h-3 w-3" />
          )}
        </span>
        <span className="truncate text-xs font-semibold text-foreground">{label}</span>
        {thread.unread > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
            {thread.unread > 9 ? '9+' : thread.unread}
          </span>
        )}
        {typingNow && <TypingDots className="shrink-0" />}
      </button>
      <button
        type="button"
        aria-label="Close conversation"
        onClick={onDismiss}
        className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
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
  /**
   * Threads the user explicitly minimised. They stay open as side chips (like
   * the Going Live dock) instead of jumping into the Aurixa agent.
   */
  const [minimised, setMinimised] = useState<Record<string, true>>({});
  /**
   * One upload queue serves the expanded card (only one card is expanded at a
   * time). It tracks per-file progress, retries and errors.
   */
  const attachmentQueue = useInternalAttachmentQueue();
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const queuedForRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);


  const threadsRef = useRef<PopupThread[]>([]);
  threadsRef.current = threads;
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  /** Baselines: thread_id → ISO timestamp of the newest message already handled. */
  const baselinesRef = useRef<Record<string, string>>(readBaselines());
  /** Session start — messages older than this never pop on first load. */
  const bootAtRef = useRef<string>(new Date().toISOString());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** thread_id → last time we broadcast a typing hint (throttling). */
  const lastTypingSentRef = useRef<Record<string, number>>({});


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
          if (changed && (t.unread ?? 0) > 0) {
            setMinimised((prev) => {
              if (!prev[t.id]) return prev;
              const next = { ...prev };
              delete next[t.id];
              return next;
            });
            setActiveId(t.id);
          }
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
      const candidates = threads.filter((t) => !minimised[t.thread_id]);
      if (!candidates.length) {
        if (activeId) setActiveId(null);
        return;
      }
      const next = [...candidates].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))[0];
      setActiveId(next.thread_id);
    }
  }, [threads, activeId, minimised]);

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
        for (const [k, v] of Object.entries(prev)) if (now - v.at < 5000) next[k] = v;
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

  // Pin the transcript to the newest message (or the typing bubble) so nothing
  // is cut off.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    active?.thread_id,
    active?.messages.length,
    active?.loading,
    activeId ? !!typing[activeId] : false,
  ]);


  const dismiss = useCallback(
    (threadId: string) => {
      const thread = threadsRef.current.find((t) => t.thread_id === threadId);
      setBaseline(threadId, thread?.lastAt ?? new Date().toISOString());
      setThreads((prev) => {
        const next = prev.filter((t) => t.thread_id !== threadId);
        persist(next);
        return next;
      });
      setMinimised((prev) => {
        if (!prev[threadId]) return prev;
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
      if (queuedForRef.current === threadId) {
        queuedForRef.current = null;
        attachmentQueue.clear();
      }

      if (activeRef.current === threadId) setActiveId(null);
    },
    [persist, setBaseline],
  );

  /** Collapse the expanded card into a side chip (never opens the agent). */
  const minimise = useCallback((threadId: string) => {
    setMinimised((prev) => ({ ...prev, [threadId]: true }));
    setActiveId((current) => (current === threadId ? null : current));
  }, []);

  /** Stage files against the expanded thread (drag, paste or picker). */
  const addFilesFor = useCallback(
    (threadId: string, files: File[]) => {
      if (!files.length) return;
      if (queuedForRef.current !== threadId) {
        attachmentQueue.clear();
        queuedForRef.current = threadId;
      }
      attachmentQueue.addFiles(files);
    },
    [attachmentQueue],
  );


  const send = useCallback(
    async (thread: PopupThread) => {
      const text = (drafts[thread.thread_id] ?? '').trim();
      const hasFiles =
        queuedForRef.current === thread.thread_id && attachmentQueue.items.length > 0;
      if ((!text && !hasFiles) || sending[thread.thread_id]) return;
      const priority = priorities[thread.thread_id] ?? 'normal';
      setSending((p) => ({ ...p, [thread.thread_id]: true }));
      try {
        let attachments: InternalAttachment[] = [];
        if (hasFiles) {
          const { uploaded, failed } = await attachmentQueue.uploadAll(thread.thread_id);
          if (failed.length) {
            setSending((p) => ({ ...p, [thread.thread_id]: false }));
            return;
          }
          attachments = uploaded;
          attachmentQueue.clear();
          queuedForRef.current = null;
        }

        const { data } = await invokeSecureFunction('internal-messaging', {
          action: 'send_message',
          thread_id: thread.thread_id,
          body: text,
          priority,
          attachments,
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
                      attachments,
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
    [drafts, attachmentQueue, priorities, sending, user, setBaseline],

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

  /** The whole minimised stack can be dragged anywhere on the page. */
  const dock = useDraggablePosition('aurixa.internalMessages.dockPos');

  const priority = active ? priorities[active.thread_id] ?? 'normal' : 'normal';

  const typer = active ? typing[active.thread_id] : undefined;
  const headline = active ? (active.kind === 'broadcast' ? active.title : active.sender) : '';

  if (!user || (!active && !chips.length)) return null;

  return (
    <div
      ref={dock.nodeRef}
      style={dock.positionStyle}
      className={cn(
        'pointer-events-none fixed right-4 top-20 z-[60] flex w-[min(26rem,calc(100vw-2rem))] flex-col items-end gap-2',
        dock.dragging && 'z-[70]',
      )}
    >
      {/* Dock handle — drag the whole stack anywhere on the page */}
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/50 bg-card/80 px-1.5 py-0.5 backdrop-blur-xl">
        <span
          {...dock.handleProps}
          role="button"
          tabIndex={-1}
          aria-label="Move messages dock"
          title="Drag to move all minimised chats"
          className="flex cursor-grab items-center text-muted-foreground/70 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        {dock.position && (
          <button
            type="button"
            onClick={dock.reset}
            aria-label="Snap dock back to the corner"
            title="Snap back to the corner"
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Collapsed conversations — name only, transcript hidden */}
      {chips.map((t) => (
        <MinimisedChip
          key={t.thread_id}
          thread={t}
          typingNow={!!typing[t.thread_id]}
          onExpand={() => setActiveId(t.thread_id)}
          onDismiss={() => dismiss(t.thread_id)}
        />
      ))}


      {/* Expanded conversation */}
      {active && (
      <div
        role="dialog"
        aria-label={`Message from ${headline}`}
        onDragEnter={(e) => {
          if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragActive(true);
        }}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragActive(false);
        }}
        onDrop={(e) => {
          const dropped = filesFromDataTransfer(e.dataTransfer);
          if (!dropped.length) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragActive(false);
          addFilesFor(active.thread_id, dropped);
        }}
        className={cn(
          'pointer-events-auto relative flex w-full flex-col overflow-hidden rounded-3xl border bg-card/95 backdrop-blur-xl',
          'shadow-[var(--elevation-3,0_18px_40px_-18px_rgba(0,0,0,0.55))]',
          'animate-in slide-in-from-right-4 fade-in-0 motion-reduce:animate-none',
          active.priority === 'urgent'
            ? 'border-destructive/60 ring-1 ring-destructive/30'
            : active.priority === 'high'
              ? 'border-warning/50'
              : 'border-[color:var(--glass-hairline,hsl(var(--border)))]',
        )}
      >
        {dragActive && <AttachmentDropOverlay />}

        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border/50 px-3.5 py-2.5">
          <span
            {...dock.handleProps}
            role="button"
            tabIndex={-1}
            aria-label="Move conversation"
            title="Drag to move"
            className="-ml-1 shrink-0 cursor-grab text-muted-foreground/70 hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </span>
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
            aria-label="Minimise conversation"
            title="Minimise"
            onClick={() => minimise(active.thread_id)}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Minus className="h-3.5 w-3.5" />
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
                    <InternalAttachmentList
                      threadId={active.thread_id}
                      attachments={m.attachments ?? []}
                      mine={m.mine}
                    />
                  </div>
                  <span className="mt-0.5 px-1 text-[9px] text-muted-foreground/70">
                    {m.mine ? 'You' : m.sender_name} · {timeLabel(m.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {typer && (
            <div className="mt-1.5" aria-live="polite">
              <TypingPresence people={[{ name: typer.name }]} />
            </div>
          )}


        </div>

        {/* Reply */}
        <div className="border-t border-border/50 px-3 py-2.5">
          <InternalAttachmentQueue
            items={attachmentQueue.items}
            onRemove={attachmentQueue.remove}
            onRetry={(id) => attachmentQueue.retry(active.thread_id, id)}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={INTERNAL_ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              addFilesFor(active.thread_id, Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />

          <Textarea
            value={drafts[active.thread_id] ?? ''}
            onChange={(e) => onDraftChange(active, e.target.value)}
            onPaste={(e) => {
              const pasted = filesFromDataTransfer(e.clipboardData);
              if (!pasted.length) return;
              e.preventDefault();
              addFilesFor(active.thread_id, pasted);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(active);
              }
            }}
            placeholder="Reply… (drag or paste files to attach)"
            rows={2}
            className="min-h-[46px] resize-none rounded-2xl border-border/60 bg-background/60 text-[12px]"
          />

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Attach files"
                title="Attach files — any format, any size"
                onClick={() => fileInputRef.current?.click()}
                className="mr-0.5 rounded-full border border-border/60 p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Paperclip className="h-3 w-3" />
              </button>
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
              disabled={
                (!((drafts[active.thread_id] ?? '').trim()) &&
                  attachmentQueue.items.length === 0) ||
                !!sending[active.thread_id]
              }

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
      )}
    </div>

  );
}

export default InternalMessageToasts;
