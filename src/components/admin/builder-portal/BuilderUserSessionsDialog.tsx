import { useCallback, useEffect, useState } from 'react';
import { Loader2, Monitor } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { BuilderUser, BuilderUserSession } from './accessTypes';

/**
 * A user's Builder sessions, so revocation is an informed decision rather than
 * a blind one.
 *
 * `list_user_sessions` deliberately excludes the token hash — an administrator
 * has no reason to see it and a leaked hash is a replayable credential. What is
 * shown is enough to recognise a session: when it started, when it was last
 * used, when it expires and what device label it carried.
 */

const formatWhen = (value: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-AU');
};

/** A session is live only if it is unrevoked and neither clock has run out. */
function isLive(session: BuilderUserSession): boolean {
  if (session.revoked_at) return false;
  const now = Date.now();
  return new Date(session.absolute_expires_at).getTime() > now
    && new Date(session.idle_expires_at).getTime() > now;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: BuilderUser | null;
  busy: boolean;
  loadSessions: (userId: string) => Promise<BuilderUserSession[]>;
  onRevokeAll: (user: BuilderUser) => Promise<boolean>;
}

export function BuilderUserSessionsDialog({
  open, onOpenChange, user, busy, loadSessions, onRevokeAll,
}: Props) {
  const [sessions, setSessions] = useState<BuilderUserSession[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setSessions(await loadSessions(user.id));
    } finally {
      setLoading(false);
    }
  }, [user, loadSessions]);

  useEffect(() => {
    if (open && user) void refresh();
    if (!open) setSessions([]);
  }, [open, user, refresh]);

  if (!user) return null;

  const live = sessions.filter(isLive);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sessions — {user.name}</DialogTitle>
          <DialogDescription>
            {live.length === 0
              ? 'No live sessions. The 50 most recent are listed for reference.'
              : `${live.length} live session${live.length === 1 ? '' : 's'}. Revoking ends all of them immediately.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
            <span className="sr-only">Loading sessions…</span>
          </div>
        ) : sessions.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            This user has never signed in.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="max-w-[16rem]">
                      <span className="flex items-start gap-2">
                        <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate text-sm" title={session.device_label ?? undefined}>
                          {session.device_label || 'Unknown device'}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatWhen(session.created_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatWhen(session.last_used_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatWhen(session.absolute_expires_at)}
                    </TableCell>
                    <TableCell>
                      {isLive(session)
                        ? <Badge variant="default">Live</Badge>
                        : session.revoked_at
                          ? <Badge variant="destructive" title={session.revoked_reason ?? undefined}>Revoked</Badge>
                          : <Badge variant="outline">Expired</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button
            variant="destructive"
            disabled={busy || loading || live.length === 0}
            onClick={async () => { if (await onRevokeAll(user)) await refresh(); }}
          >
            Revoke all sessions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
