import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';

interface PortalSession { id: string; device_label: string | null; last_used_at: string; revoked_at: string | null }
interface SessionsResponse { sessions?: PortalSession[]; current_session_id?: string | null }

export default function SolicitorSecurity() {
  const [rows, setRows] = useState<PortalSession[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const { toast } = useToast();
  const load = useCallback(async () => {
    const { data, error } = await invokeSolicitorFunction<SessionsResponse>('solicitor-portal-verify', { action: 'list_sessions' });
    if (error) toast({ title: 'Unable to load sessions', description: error.message, variant: 'destructive' });
    setRows(data?.sessions ?? []);
    setCurrent(data?.current_session_id ?? null);
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const mutate = async (action: 'revoke_session' | 'revoke_other_sessions', sessionId?: string) => {
    const { error } = await invokeSolicitorFunction('solicitor-portal-verify', { action, ...(sessionId ? { session_id: sessionId } : {}) });
    if (error) toast({ title: 'Session could not be revoked', description: error.message, variant: 'destructive' });
    await load();
  };

  return <main className="min-h-screen bg-background p-6">
    <Card className="mx-auto max-w-3xl">
      <CardHeader><CardTitle>Session security</CardTitle><p className="text-sm text-muted-foreground">Review and revoke devices signed into your Solicitor Portal account.</p></CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">No session history is available. Sign in again or contact support if this is unexpected.</p>}
        {rows.map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <div><p className="font-medium">{session.device_label || 'Unknown device'} {session.id === current ? '(current)' : ''}</p><p className="text-xs text-muted-foreground">Last used {new Date(session.last_used_at).toLocaleString()} · {session.revoked_at ? 'Revoked' : 'Active'}</p></div>
          {!session.revoked_at && <Button variant="outline" onClick={() => void mutate('revoke_session', session.id)}>Revoke</Button>}
        </div>)}
        <Button variant="outline" onClick={() => void mutate('revoke_other_sessions')}>Revoke all other devices</Button>
      </CardContent>
    </Card>
  </main>;
}
