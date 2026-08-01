import { useCallback, useEffect, useState } from 'react';
import { History, Loader2, RefreshCw, Save, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  ACTOR_TYPE_LABELS, BUILDER_LANDING_PAGES, BUILDER_TIMEZONES, LANDING_PAGE_LABELS,
  activityActionLabel, formatWorkspaceTime,
  type BuilderLandingPage, type BuilderOrganisationSettings,
} from '@/lib/builderWorkspace';

/**
 * Internal Builder workspace administration — the organisation summary, the
 * FULL audit trail, and organisation settings.
 *
 * Mirrors `AdminBuilderCollaborationPanel`. Every call goes through
 * `invokeSecureFunction`, which carries the staff session and the CSRF token;
 * `builder-workspace-admin` re-checks the `builder_portal_admin` module
 * permission server-side, so nothing here is the authorization control.
 *
 * This is the INTERNAL surface. It never links to the external /builder/* portal.
 *
 * The activity view here is deliberately WIDER than the portal's: staff need the
 * membership, permission and session record, and the before/after states. That
 * is exactly what the portal feed refuses, which is why the two read through
 * different server paths rather than sharing one.
 */

interface AdminOrganisation { id: string; legal_name: string; trading_name: string | null }

interface AdminActivityRow {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_type: string;
  actor_user_id: string | null;
  builder_user_id: string | null;
  reason: string | null;
  created_at: string;
}

interface AdminSummary {
  projects: number; units: number; transactions: number; construction_cases: number;
  open_defects: number; documents: number; open_conversations: number;
  open_tasks: number; overdue_tasks: number;
}

export function AdminBuilderWorkspacePanel({ canEdit }: { canEdit: boolean }) {
  const [organisations, setOrganisations] = useState<AdminOrganisation[]>([]);
  const [organisationId, setOrganisationId] = useState('');
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [activity, setActivity] = useState<AdminActivityRow[]>([]);
  const [settings, setSettings] = useState<BuilderOrganisationSettings | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [timezone, setTimezone] = useState('Australia/Sydney');
  const [landingPage, setLandingPage] = useState<BuilderLandingPage>('dashboard');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (operation: string, payload: Record<string, unknown> = {}) => {
    const { data, error: invokeError } = await invokeSecureFunction(
      'builder-workspace-admin', { operation, ...payload });
    if (invokeError || (data as any)?.error) {
      throw new Error((data as any)?.error || invokeError?.message || 'The request failed');
    }
    return data as any;
  }, []);

  const loadOrganisations = useCallback(async () => {
    try {
      const { data } = await invokeSecureFunction(
        'builder-portal-admin', { operation: 'list_organisations' });
      const records = ((data as any)?.organisations ?? (data as any)?.records ?? []) as AdminOrganisation[];
      setOrganisations(records);
      setOrganisationId((current) => current || records[0]?.id || '');
    } catch (loadError: any) {
      setError(loadError?.message || 'Organisations could not be loaded');
    }
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!organisationId) {
      setSummary(null); setActivity([]); setSettings(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [s, a, g] = await Promise.all([
        call('workspace_summary', { organisation_id: organisationId }),
        call('activity_history', { organisation_id: organisationId, limit: 100 }),
        call('get_organisation_settings', { organisation_id: organisationId }),
      ]);
      setSummary(s);
      setActivity(a.records ?? []);
      setSettings(g.settings ?? null);
      setError(null);
    } catch (loadError: any) {
      setError(loadError?.message || 'The workspace could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [call, organisationId]);

  useEffect(() => { void loadOrganisations(); }, [loadOrganisations]);
  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    setDisplayName(settings?.display_name ?? '');
    setContactName(settings?.primary_contact_name ?? '');
    setContactEmail(settings?.primary_contact_email ?? '');
    setTimezone(settings?.timezone ?? 'Australia/Sydney');
    setLandingPage(settings?.default_landing_page ?? 'dashboard');
  }, [settings]);

  /**
   * The save always carries the row_version the panel loaded. A stale value is
   * rejected by the server with 409 rather than silently overwritten.
   */
  const saveSettings = () => {
    const reason = window.prompt('Give a reason for this change');
    if (!reason || !reason.trim()) return;
    setBusy(true);
    void (async () => {
      try {
        await call('save_organisation_settings', {
          organisation_id: organisationId,
          expected_version: settings?.row_version,
          display_name: displayName.trim() || null,
          primary_contact_name: contactName.trim() || null,
          primary_contact_email: contactEmail.trim() || null,
          timezone,
          default_landing_page: landingPage,
          reason: reason.trim(),
        });
        toast.success('Organisation settings saved');
        await loadWorkspace();
      } catch (actionError: any) {
        toast.error(actionError?.message || 'The settings could not be saved');
      } finally {
        setBusy(false);
      }
    })();
  };

  const tiles: Array<[string, number]> = summary ? [
    ['Projects', summary.projects], ['Units', summary.units],
    ['Transactions', summary.transactions], ['Builds', summary.construction_cases],
    ['Open defects', summary.open_defects], ['Documents', summary.documents],
    ['Open conversations', summary.open_conversations], ['Open tasks', summary.open_tasks],
    ['Overdue tasks', summary.overdue_tasks],
  ] : [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Workspace</CardTitle>
          <CardDescription>
            The organisation summary, the full audit trail and organisation settings.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={organisationId} onValueChange={setOrganisationId}>
            <SelectTrigger className="w-64" aria-label="Choose an organisation">
              <SelectValue placeholder="Choose an organisation" />
            </SelectTrigger>
            <SelectContent>
              {organisations.map((organisation) => (
                <SelectItem key={organisation.id} value={organisation.id}>
                  {organisation.trading_name || organisation.legal_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void loadWorkspace()} disabled={loading}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!organisationId ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <p className="font-medium">Choose an organisation</p>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading workspace" />
          </div>
        ) : (
          <Tabs defaultValue="summary">
            <TabsList>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="activity">Activity ({activity.length})</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="mt-4">
              {!tiles.length ? (
                <div className="rounded-lg border border-dashed p-10 text-center">
                  <p className="font-medium">No records for this organisation yet</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  {tiles.map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-border p-4">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-2xl font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              {!activity.length ? (
                <div className="rounded-lg border border-dashed p-10 text-center">
                  <History className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
                  <p className="mt-2 font-medium">No audit records for this organisation</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Action</TableHead>
                        <TableHead>Record</TableHead>
                        <TableHead>Actor</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>When</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activity.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            {activityActionLabel(row.action)}
                          </TableCell>
                          <TableCell>
                            {row.entity_type ? (
                              <Badge variant="outline">{row.entity_type}</Badge>
                            ) : '—'}
                          </TableCell>
                          <TableCell>
                            {ACTOR_TYPE_LABELS[row.actor_type] ?? row.actor_type}
                          </TableCell>
                          <TableCell className="max-w-64 truncate">{row.reason || '—'}</TableCell>
                          <TableCell>{formatWorkspaceTime(row.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="settings" className="mt-4 space-y-4">
              {!settings ? (
                <p className="flex items-center gap-2 rounded-md border border-border p-3 text-sm text-muted-foreground">
                  <Settings2 className="h-4 w-4" aria-hidden />
                  This organisation has no settings row yet. Saving creates one.
                </p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="admin-org-display-name">Display name</Label>
                  <Input
                    id="admin-org-display-name" value={displayName} disabled={!canEdit}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-org-contact-name">Primary contact</Label>
                  <Input
                    id="admin-org-contact-name" value={contactName} disabled={!canEdit}
                    onChange={(event) => setContactName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-org-contact-email">Contact email</Label>
                  <Input
                    id="admin-org-contact-email" type="email" value={contactEmail} disabled={!canEdit}
                    onChange={(event) => setContactEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-org-timezone">Time zone</Label>
                  <Select value={timezone} onValueChange={setTimezone} disabled={!canEdit}>
                    <SelectTrigger id="admin-org-timezone"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BUILDER_TIMEZONES.map((value) => (
                        <SelectItem key={value} value={value}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-org-landing">Default landing page</Label>
                  <Select
                    value={landingPage} disabled={!canEdit}
                    onValueChange={(value) => setLandingPage(value as BuilderLandingPage)}
                  >
                    <SelectTrigger id="admin-org-landing"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BUILDER_LANDING_PAGES.map((value) => (
                        <SelectItem key={value} value={value}>{LANDING_PAGE_LABELS[value]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" disabled={!canEdit || busy} onClick={saveSettings}>
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Save className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  Save settings
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
