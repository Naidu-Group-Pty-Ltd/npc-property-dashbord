/**
 * Internal staff messaging panel — rendered inside the Aurixa agent widget.
 *
 * Two modes:
 *   • Direct message  — pick one active staff member
 *   • Broadcast       — one announcement to every active staff member
 *
 * All transport goes through the `internal-messaging` edge function, which is the
 * sole mediator for the service_role-only messaging tables.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Megaphone, MessageSquare, Paperclip, Plus, Search, Send, Users, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { ShimmerText } from '@/components/aurixa/ShimmerText';
import { useAuth } from '@/hooks/useAuth';
import {
  InternalAttachmentDrafts,
  InternalAttachmentList,
} from '@/components/agent/InternalAttachmentChips';
import {
  INTERNAL_ATTACHMENT_ACCEPT,
  MAX_INTERNAL_ATTACHMENTS,
  uploadInternalAttachments,
  type InternalAttachment,
} from '@/lib/internalMessageAttachments';
import {
  onInternalMessage,
  onInternalTyping,
  publishInternalMessage,
  publishInternalTyping,
} from '@/lib/internalMessagingBus';

export interface InternalStaffMember {
  id: string;
  username: string;
  email: string | null;
  role?: string | null;
}

export interface InternalThread {
  id: string;
  kind: 'direct' | 'broadcast';
  title: string | null;
  display_title: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread: number;
  participant_count: number;
}

export interface InternalMessage {
  id: string;
  thread_id: string;
  body: string;
  sender_name: string;
  mine: boolean;
  is_system: boolean;
  created_at: string;
  attachments?: InternalAttachment[] | null;
}

const call = async (payload: Record<string, unknown>) => {
  const { data, error } = await invokeSecureFunction('internal-messaging', payload);
  if (error) throw new Error(error.message || 'Request failed');
  if (data && (data as any).success === false) throw new Error((data as any).error || 'Request failed');
  return data as any;
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';
}

function timeLabel(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

type View = 'threads' | 'compose' | 'thread';

export function InternalMessagesPanel({
  onUnreadChange,
  initialThreadId,
}: {
  onUnreadChange?: (n: number) => void;
  initialThreadId?: string | null;
}) {
  const { user } = useAuth();
  const myName = (user as any)?.username || (user as any)?.email || 'Someone';

  const [view, setView] = useState<View>('threads');
  const [threads, setThreads] = useState<InternalThread[] | null>(null);
  const [staff, setStaff] = useState<InternalStaffMember[]>([]);
  const [activeThread, setActiveThread] = useState<InternalThread | null>(null);
  const [messages, setMessages] = useState<InternalMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [typingBy, setTypingBy] = useState<Record<string, number>>({});

  // compose state
  const [composeMode, setComposeMode] = useState<'direct' | 'broadcast'>('direct');
  const [staffSearch, setStaffSearch] = useState('');
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [broadcastTitle, setBroadcastTitle] = useState('');

  // Attachments (all MIME types, no client-side size cap).
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const lastTypingSentRef = useRef<number>(0);
  const openedInitialRef = useRef<string | null>(null);


  const loadThreads = useCallback(async () => {
    try {
      const data = await call({ action: 'list_threads' });
      const list: InternalThread[] = data?.threads ?? [];
      setThreads(list);
      onUnreadChange?.(list.reduce((sum, t) => sum + (t.unread || 0), 0));
    } catch (err) {
      setThreads([]);
      console.error('[InternalMessages] list_threads', err);
    }
  }, [onUnreadChange]);

  const loadStaff = useCallback(async () => {
    if (staff.length) return;
    try {
      const data = await call({ action: 'list_staff' });
      setStaff(data?.staff ?? []);
    } catch (err) {
      console.error('[InternalMessages] list_staff', err);
    }
  }, [staff.length]);

  const openThread = useCallback(async (thread: InternalThread) => {
    setActiveThread(thread);
    setView('thread');
    setMessages(null);
    try {
      const data = await call({ action: 'get_thread', thread_id: thread.id });
      setMessages(data?.messages ?? []);
      setThreads(prev => prev?.map(t => (t.id === thread.id ? { ...t, unread: 0 } : t)) ?? prev);
      onUnreadChange?.(
        (threads ?? []).reduce((sum, t) => sum + (t.id === thread.id ? 0 : t.unread || 0), 0),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open conversation');
      setMessages([]);
    }
  }, [threads, onUnreadChange]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // Deep-link: open a specific thread (e.g. from a pop-up message alert).
  useEffect(() => {
    if (!initialThreadId || !threads || openedInitialRef.current === initialThreadId) return;
    const target = threads.find(t => t.id === initialThreadId);
    if (!target) return;
    openedInitialRef.current = initialThreadId;
    openThread(target);
  }, [initialThreadId, threads, openThread]);

  // Refresh the moment anyone posts (realtime broadcast hint), then re-verify
  // through the edge function. Falls back to a short poll if realtime drops.
  const refreshActive = useCallback(() => {
    loadThreads();
    if (activeThread) {
      call({ action: 'get_thread', thread_id: activeThread.id })
        .then(d => setMessages(d?.messages ?? []))
        .catch(() => {});
    }
  }, [loadThreads, activeThread]);

  useEffect(() => {
    const off = onInternalMessage(() => refreshActive());
    const id = setInterval(refreshActive, 6_000);
    return () => { off(); clearInterval(id); };
  }, [refreshActive]);

  // ── Typing indicators ──────────────────────────────────────────────
  const signalTyping = useCallback(() => {
    if (!activeThread) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1_800) return;
    lastTypingSentRef.current = now;
    publishInternalTyping({
      thread_id: activeThread.id,
      user_id: user?.id ?? 'unknown',
      user_name: myName,
    });
  }, [activeThread, user?.id, myName]);

  useEffect(() => {
    const off = onInternalTyping(signal => {
      if (!signal?.thread_id || signal.user_id === user?.id) return;
      setTypingBy(prev => ({ ...prev, [`${signal.thread_id}|${signal.user_name}`]: Date.now() }));
    });
    const id = setInterval(() => {
      setTypingBy(prev => {
        const now = Date.now();
        const next: Record<string, number> = {};
        let changed = false;
        for (const [k, v] of Object.entries(prev)) {
          if (now - v < 4_000) next[k] = v; else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1_000);
    return () => { off(); clearInterval(id); };
  }, [user?.id]);

  const typingLabel = useMemo(() => {
    if (!activeThread) return null;
    const names = Object.keys(typingBy)
      .filter(k => k.startsWith(`${activeThread.id}|`))
      .map(k => k.split('|')[1])
      .filter(Boolean);
    if (!names.length) return null;
    const unique = [...new Set(names)];
    return unique.length === 1
      ? `${unique[0]} is typing…`
      : `${unique.slice(0, 2).join(' and ')} are typing…`;
  }, [typingBy, activeThread]);


  useEffect(() => {
    if (view === 'compose') loadStaff();
  }, [view, loadStaff]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);

  const filteredStaff = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(s =>
      s.username.toLowerCase().includes(q) || (s.email ?? '').toLowerCase().includes(q));
  }, [staff, staffSearch]);

  const sendInThread = async () => {
    const text = draft.trim();
    if ((!text && pendingFiles.length === 0) || !activeThread || sending) return;
    setSending(true);
    try {
      let attachments: InternalAttachment[] = [];
      if (pendingFiles.length) {
        setUploading(true);
        attachments = await uploadInternalAttachments(
          activeThread.id,
          pendingFiles,
          (done, total, name) => setUploadLabel(`Uploading ${done}/${total} · ${name}`),
        );
        setUploading(false);
        setUploadLabel(null);
      }
      await call({
        action: 'send_message',
        thread_id: activeThread.id,
        body: text,
        attachments,
      });
      setDraft('');
      setPendingFiles([]);
      publishInternalMessage({
        thread_id: activeThread.id,
        sender_id: user?.id ?? null,
        sender_name: myName,
      });
      const data = await call({ action: 'get_thread', thread_id: activeThread.id });
      setMessages(data?.messages ?? []);
      loadThreads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Message failed to send');
    } finally {
      setUploading(false);
      setUploadLabel(null);
      setSending(false);
    }
  };


  const sendNew = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    if (composeMode === 'direct' && !recipientId) {
      toast.error('Pick a team member first');
      return;
    }
    setSending(true);
    try {
      const payload = composeMode === 'broadcast'
        ? { action: 'send_message', broadcast: true, title: broadcastTitle.trim() || undefined, body: text }
        : { action: 'send_message', recipient_user_id: recipientId, body: text };
      const data = await call(payload);
      publishInternalMessage({ thread_id: data?.thread_id, sender_id: user?.id ?? null, sender_name: myName });

      setDraft('');
      setBroadcastTitle('');
      setRecipientId(null);
      toast.success(composeMode === 'broadcast' ? 'Announcement sent to all staff' : 'Message sent');
      const refreshed = await call({ action: 'list_threads' });
      const list: InternalThread[] = refreshed?.threads ?? [];
      setThreads(list);
      const created = list.find(t => t.id === data?.thread_id);
      if (created) await openThread(created);
      else setView('threads');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Message failed to send');
    } finally {
      setSending(false);
    }
  };

  // ── Thread view ────────────────────────────────────────────────────
  if (view === 'thread' && activeThread) {
    return (
      <div className="w-full flex flex-col min-h-0">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setView('threads'); setActiveThread(null); }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {activeThread.kind === 'broadcast'
            ? <Megaphone className="h-4 w-4 text-warning shrink-0" />
            : <MessageSquare className="h-4 w-4 text-primary shrink-0" />}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{activeThread.display_title}</h3>
            {activeThread.kind === 'broadcast' && (
              <p className="text-[10px] text-muted-foreground">Announcement · {activeThread.participant_count} recipients</p>
            )}
          </div>
        </div>
        <ScrollArea className="flex-1 px-4 py-3">
          {!messages ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : messages.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No messages yet — say hello.</p>
          ) : (
            <div className="space-y-3">
              {messages.map(m => (
                <div key={m.id} className={cn('flex flex-col gap-1', m.mine ? 'items-end' : 'items-start')}>
                  <span className="text-[10px] text-muted-foreground px-1">
                    {m.sender_name} · {timeLabel(m.created_at)}
                  </span>
                  <div className={cn(
                    'max-w-[85%] rounded-2xl px-3 py-2 text-xs whitespace-pre-wrap break-words',
                    m.mine ? 'bg-primary/15 text-foreground' : 'bg-muted/60 text-foreground',
                  )}>
                    {m.body}
                    <InternalAttachmentList
                      threadId={activeThread.id}
                      attachments={m.attachments ?? []}
                      mine={m.mine}
                    />
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>
        {typingLabel && (
          <div className="px-4 pb-1 shrink-0">
            <ShimmerText className="text-[11px]">{typingLabel}</ShimmerText>
          </div>
        )}
        <div className="border-t p-3 shrink-0">
          <InternalAttachmentDrafts
            files={pendingFiles}
            uploading={uploading}
            progressLabel={uploadLabel}
            onRemove={(i) => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
          />
          <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={INTERNAL_ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={e => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) {
                setPendingFiles(prev => [...prev, ...picked].slice(0, MAX_INTERNAL_ATTACHMENTS));
              }
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label="Attach files"
            title="Attach files — any format, any size"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={draft}
            onChange={e => { setDraft(e.target.value); signalTyping(); }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInThread(); } }}
            placeholder="Write a message…"
            rows={1}
            className="min-h-[36px] max-h-28 resize-none text-xs"
          />

          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={sendInThread}
            disabled={sending || (!draft.trim() && pendingFiles.length === 0)}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Compose view ───────────────────────────────────────────────────
  if (view === 'compose') {
    return (
      <div className="w-full flex flex-col min-h-0">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setView('threads')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-sm font-semibold">New internal message</h3>
        </div>

        <div className="px-4 pt-3 flex gap-1.5">
          {(['direct', 'broadcast'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setComposeMode(mode)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
                composeMode === mode
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/70',
              )}
            >
              {mode === 'direct' ? <MessageSquare className="h-3 w-3" /> : <Megaphone className="h-3 w-3" />}
              {mode === 'direct' ? 'Direct message' : 'Everyone'}
            </button>
          ))}
        </div>

        {composeMode === 'direct' ? (
          <>
            <div className="px-4 pt-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={staffSearch}
                  onChange={e => setStaffSearch(e.target.value)}
                  placeholder="Search staff…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
            <ScrollArea className="flex-1 px-4 py-2 min-h-0">
              {staff.length === 0 ? (
                <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-1">
                  {filteredStaff.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setRecipientId(s.id)}
                      className={cn(
                        'w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                        recipientId === s.id ? 'bg-primary/15 text-primary' : 'hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                        {initials(s.username)}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-medium truncate">{s.username}</span>
                        {s.email && <span className="block text-[10px] text-muted-foreground truncate">{s.email}</span>}
                      </span>
                    </button>
                  ))}
                  {filteredStaff.length === 0 && (
                    <p className="text-[11px] text-muted-foreground px-2 py-3">No staff match that search.</p>
                  )}
                </div>
              )}
            </ScrollArea>
          </>
        ) : (
          <div className="px-4 pt-3 space-y-2 flex-1 min-h-0">
            <Input
              value={broadcastTitle}
              onChange={e => setBroadcastTitle(e.target.value)}
              placeholder="Announcement title (optional)"
              className="h-8 text-xs"
            />
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Users className="h-3.5 w-3.5 mt-px shrink-0" />
              This goes to every active staff member and raises an in-app notification for each of them.
            </p>
          </div>
        )}

        <div className="border-t p-3 shrink-0">
          <InternalAttachmentDrafts
            files={pendingFiles}
            uploading={uploading}
            progressLabel={uploadLabel}
            onRemove={(i) => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
          />
          <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={INTERNAL_ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={e => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) {
                setPendingFiles(prev => [...prev, ...picked].slice(0, MAX_INTERNAL_ATTACHMENTS));
              }
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label="Attach files"
            title="Attach files — any format, any size"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={composeMode === 'broadcast' ? 'Announcement to all staff…' : 'Write a message…'}
            rows={2}
            className="min-h-[44px] max-h-28 resize-none text-xs"
          />
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={sendNew} disabled={sending || !draft.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    );
  }

  // ── Thread list ────────────────────────────────────────────────────
  return (
    <div className="w-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" /> Team messages
        </h3>
        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setView('compose')}>
          <Plus className="h-3 w-3 mr-1" /> New
        </Button>
      </div>
      <ScrollArea className="flex-1 p-3 min-h-0">
        {!threads ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : threads.length === 0 ? (
          <div className="text-center py-8 px-4 space-y-2">
            <p className="text-xs text-muted-foreground">No internal conversations yet.</p>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setView('compose')}>
              Message a colleague
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {threads.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => openThread(t)}
                className="w-full flex items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <span className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                  t.kind === 'broadcast' ? 'bg-warning/15 text-warning' : 'bg-muted',
                )}>
                  {t.kind === 'broadcast' ? <Megaphone className="h-3.5 w-3.5" /> : initials(t.display_title)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate">{t.display_title}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeLabel(t.last_message_at)}</span>
                  </span>
                  {t.last_message_preview && (
                    <span className="block text-[11px] text-muted-foreground truncate">{t.last_message_preview}</span>
                  )}
                </span>
                {t.unread > 0 && (
                  <span className="mt-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                    {t.unread > 9 ? '9+' : t.unread}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
