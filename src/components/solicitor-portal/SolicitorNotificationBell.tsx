import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { solicitorComms, type SolicitorNotification } from '@/lib/solicitorComms';

const POLL_MS = 60_000;

/**
 * Solicitor Portal notification inbox (Phase 6). Polls the portal-scoped
 * notification feed; never reads Command Centre or client notifications.
 */
export function SolicitorNotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SolicitorNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await solicitorComms.listNotifications();
    if (data) {
      setItems(((data as any).notifications || []) as SolicitorNotification[]);
      setUnread(Number((data as any).unread) || 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => { void load(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const openNotification = async (item: SolicitorNotification) => {
    if (!item.is_read) {
      await solicitorComms.markNotificationRead(item.id);
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)));
      setUnread((n) => Math.max(0, n - 1));
    }
    if (item.link_path) {
      setOpen(false);
      navigate(item.link_path);
    }
  };

  const markAll = async () => {
    await solicitorComms.markAllNotificationsRead();
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 ? (
            <Badge
              className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px]"
              variant="destructive"
            >
              {unread > 9 ? '9+' : unread}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 ? (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => void markAll()}>
              <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Mark all read
            </Button>
          ) : null}
        </div>
        <ScrollArea className="max-h-80">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              You're all caught up.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openNotification(item)}
                    className={cn(
                      'w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                      !item.is_read && 'bg-primary/5',
                    )}
                  >
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    {item.body ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.body}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(item.created_at).toLocaleString('en-AU', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export default SolicitorNotificationBell;
