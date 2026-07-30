import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { Loader2, Plus, Search, Settings2, Trash2, Users } from 'lucide-react';
import {
  SolicitorPermissionMatrixEditor,
  EMPTY_SOLICITOR_MATRIX,
  normalizeSolicitorMatrix,
  type SolicitorPermissionMatrix,
} from './SolicitorPermissionMatrix';

interface AssignmentRow {
  id: string;
  client_id: string;
  client_name: string;
  client_email: string | null;
  deal_status: string | null;
  permissions: unknown;
  assigned_at: string;
}

interface ClientRow {
  id: string;
  primary_contact_name: string | null;
  secondary_contact_name: string | null;
  primary_email: string | null;
  deal_status: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; name: string } | null;
  onChanged?: () => void;
}

export function SolicitorAssignmentsDialog({ open, onOpenChange, user, onChanged }: Props) {
  const [loading, setLoading] = useState(false);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<AssignmentRow | null>(null);
  const [matrix, setMatrix] = useState<SolicitorPermissionMatrix>(EMPTY_SOLICITOR_MATRIX);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [aRes, cRes] = await Promise.all([
        invokeSecureFunction('solicitor-portal-admin', {
          operation: 'get_assignments', solicitor_user_id: user.id,
        }),
        invokeSecureFunction('solicitor-portal-admin', { operation: 'list_clients' }),
      ]);
      if (aRes.error) throw new Error(aRes.error.message);
      if (cRes.error) throw new Error(cRes.error.message);
      setAssignments(aRes.data?.records || []);
      setClients(cRes.data?.records || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !user) return;
    setEditing(null);
    setSearch('');
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  const assignedIds = useMemo(() => new Set(assignments.map(a => a.client_id)), [assignments]);

  const candidates = useMemo(() => {
    const s = search.trim().toLowerCase();
    return clients
      .filter(c => !assignedIds.has(c.id))
      .filter(c => {
        if (!s) return true;
        return (
          (c.primary_contact_name || '').toLowerCase().includes(s) ||
          (c.secondary_contact_name || '').toLowerCase().includes(s) ||
          (c.primary_email || '').toLowerCase().includes(s)
        );
      })
      .slice(0, 40);
  }, [clients, assignedIds, search]);

  const assign = async (clientId: string) => {
    if (!user) return;
    setBusy(clientId);
    try {
      const { data, error } = await invokeSecureFunction('solicitor-portal-admin', {
        operation: 'upsert_assignment',
        solicitor_user_id: user.id,
        client_id: clientId,
        permissions: null,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success('Client assigned');
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to assign client');
    } finally {
      setBusy(null);
    }
  };

  const unassign = async (clientId: string) => {
    if (!user) return;
    setBusy(clientId);
    try {
      const { data, error } = await invokeSecureFunction('solicitor-portal-admin', {
        operation: 'delete_assignment',
        solicitor_user_id: user.id,
        client_id: clientId,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success('Client unassigned');
      if (editing?.client_id === clientId) setEditing(null);
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to unassign client');
    } finally {
      setBusy(null);
    }
  };

  const openMatrix = (row: AssignmentRow) => {
    setEditing(row);
    setMatrix(normalizeSolicitorMatrix(row.permissions));
  };

  const saveMatrix = async () => {
    if (!user || !editing) return;
    setBusy(editing.client_id);
    try {
      const { data, error } = await invokeSecureFunction('solicitor-portal-admin', {
        operation: 'upsert_assignment',
        solicitor_user_id: user.id,
        client_id: editing.client_id,
        permissions: matrix,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success('Permissions updated');
      setEditing(null);
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save permissions');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Client Assignments
          </DialogTitle>
          <DialogDescription>
            {user ? <>Clients that <span className="font-medium text-foreground">{user.name}</span> can act for in the Solicitor Portal.</> : null}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : editing ? (
          <>
            <ScrollArea className="flex-1 pr-3">
              <div className="space-y-4 pb-2">
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                  <div className="text-sm font-medium">{editing.client_name}</div>
                  <p className="text-xs text-muted-foreground">
                    Per-client overrides. These are merged with the solicitor&apos;s baseline permissions.
                  </p>
                </div>
                <SolicitorPermissionMatrixEditor matrix={matrix} onChange={setMatrix} />
              </div>
            </ScrollArea>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button variant="outline" onClick={() => setEditing(null)}>Back</Button>
              <Button onClick={saveMatrix} disabled={!!busy}>Save permissions</Button>
            </div>
          </>
        ) : (
          <ScrollArea className="flex-1 pr-3">
            <div className="space-y-6 pb-2">
              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Assigned clients <Badge variant="secondary" className="ml-1">{assignments.length}</Badge>
                </div>
                {assignments.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    No clients assigned yet. Assign one below to give this solicitor a matter to work on.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Client</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Overrides</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assignments.map(a => (
                          <TableRow key={a.id}>
                            <TableCell>
                              <div className="font-medium">{a.client_name}</div>
                              <div className="text-xs text-muted-foreground">{a.client_email || '—'}</div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{a.deal_status || '—'}</TableCell>
                            <TableCell>
                              <Badge variant={a.permissions ? 'default' : 'outline'} className="text-xs">
                                {a.permissions ? 'Custom' : 'Baseline only'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => openMatrix(a)} className="gap-1">
                                  <Settings2 className="h-3 w-3" /> Permissions
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy === a.client_id}
                                  onClick={() => unassign(a.client_id)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Assign a client</div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search clients by name or email..."
                    className="pl-9"
                  />
                </div>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {candidates.length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">No matching unassigned clients.</div>
                  ) : candidates.map(c => (
                    <div key={c.id} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{c.primary_contact_name || c.primary_email || 'Unnamed client'}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.primary_email || '—'}</div>
                      </div>
                      <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => assign(c.id)} className="gap-1">
                        <Plus className="h-3 w-3" /> Assign
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
