import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Flag, HardHat, Layers, Loader2, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  CONSTRUCTION_DATE_KIND_LABELS, CONSTRUCTION_STAGE_KEY_LABELS,
  CONSTRUCTION_STATUS_LABELS, MILESTONE_STATUS_LABELS,
  allowedConstructionTransitions, allowedMilestoneTransitions, formatConstructionDate,
  formatPercentComplete,
  type BuilderConstructionDateKind, type BuilderConstructionStageKey,
  type BuilderConstructionStatus, type BuilderMilestoneStatus,
} from '@/lib/builderConstruction';

/**
 * Internal Builder construction administration.
 *
 * Mirrors `AdminBuilderTransactionsPanel`. Every call goes through
 * `invokeSecureFunction`, which carries the staff session and the CSRF token;
 * `builder-construction-admin` re-checks the `builder_portal_admin` module
 * permission server-side, so nothing here is the authorization control.
 *
 * This is the INTERNAL surface. It never links to the external /builder/* portal.
 *
 * DATA BOUNDARY: a milestone shows no amount and no payment flag. Finance owns
 * `build_progress_payments` and every commission trigger on it.
 */

interface AdminProject { id: string; name: string }

interface AdminCase {
  id: string;
  transaction_id: string;
  project_id: string;
  case_reference: string | null;
  status: BuilderConstructionStatus;
  site_supervisor_name: string | null;
  estimated_completion_date: string | null;
  percent_complete: number;
  row_version: number;
}

interface AdminStage {
  id: string;
  name: string;
  stage_key: BuilderConstructionStageKey;
  sequence_number: number;
  status: string;
  row_version: number;
}

interface AdminMilestone {
  id: string;
  name: string;
  status: BuilderMilestoneStatus;
  planned_date: string | null;
  row_version: number;
}

export function AdminBuilderConstructionPanel({ canEdit }: { canEdit: boolean }) {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [cases, setCases] = useState<AdminCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<AdminCase | null>(null);
  const [stages, setStages] = useState<AdminStage[]>([]);
  const [milestones, setMilestones] = useState<AdminMilestone[]>([]);
  const [dateTarget, setDateTarget] = useState<AdminCase | null>(null);

  const call = useCallback(async (operation: string, payload: Record<string, unknown> = {}) => {
    const { data, error: invokeError } = await invokeSecureFunction(
      'builder-construction-admin', { operation, ...payload });
    if (invokeError || (data as any)?.error) {
      throw new Error((data as any)?.error || invokeError?.message || 'The request failed');
    }
    return data as any;
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const { data } = await invokeSecureFunction(
        'builder-projects-admin', { operation: 'list_projects', page: 1, page_size: 100 });
      const records = ((data as any)?.records ?? []) as AdminProject[];
      setProjects(records);
      setProjectId((current) => current || records[0]?.id || '');
    } catch (loadError: any) {
      setError(loadError?.message || 'Projects could not be loaded');
    }
  }, []);

  const loadCases = useCallback(async () => {
    if (!projectId) { setCases([]); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await call('list_cases', { project_id: projectId, page: 1, page_size: 200 });
      setCases(data.records ?? []);
      setError(null);
    } catch (loadError: any) {
      setError(loadError?.message || 'Construction cases could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [call, projectId]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void loadCases(); }, [loadCases]);

  const run = async (label: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      toast.success(label);
      await loadCases();
      return true;
    } catch (actionError: any) {
      toast.error(actionError?.message || 'The request failed');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createCase = async (form: FormData) => {
    const ok = await run('Construction case created', () => call('create_case', {
      transaction_id: String(form.get('transaction_id') || ''),
      case_reference: String(form.get('case_reference') || ''),
      site_supervisor_name: String(form.get('site_supervisor_name') || ''),
      reason: 'Created from Command Centre',
    }));
    if (ok) setCreateOpen(false);
  };

  /**
   * Status changes always carry the row_version the panel loaded. A stale value
   * is rejected by the server with 409 rather than silently overwritten.
   */
  const changeStatus = (record: AdminCase, status: string) => {
    const reason = window.prompt('Give a reason for this change');
    if (!reason || !reason.trim()) return;
    void run('Construction status updated', () => call('set_status', {
      construction_case_id: record.id,
      expected_version: record.row_version,
      status,
      reason: reason.trim(),
    }));
  };

  const openDetail = async (record: AdminCase) => {
    setDetailTarget(record);
    setStages([]);
    setMilestones([]);
    try {
      const detail = await call('get_case', { construction_case_id: record.id });
      setStages(detail.stages ?? []);
      setMilestones(detail.milestones ?? []);
    } catch (detailError: any) {
      toast.error(detailError?.message || 'The construction case could not be loaded');
    }
  };

  const addStage = async (form: FormData) => {
    if (!detailTarget) return;
    const ok = await run('Stage added', () => call('upsert_stage', {
      construction_case_id: detailTarget.id,
      name: String(form.get('stage_name') || ''),
      stage_key: String(form.get('stage_key') || 'other'),
      sequence_number: String(form.get('sequence_number') || '1'),
      reason: 'Added from Command Centre',
    }));
    if (ok) void openDetail(detailTarget);
  };

  const addMilestone = async (form: FormData) => {
    if (!detailTarget) return;
    const ok = await run('Milestone added', () => call('upsert_milestone', {
      construction_case_id: detailTarget.id,
      name: String(form.get('milestone_name') || ''),
      planned_date: String(form.get('planned_date') || '') || null,
      reason: 'Added from Command Centre',
    }));
    if (ok) void openDetail(detailTarget);
  };

  const changeMilestoneStatus = (milestone: AdminMilestone, status: string) => {
    if (!detailTarget) return;
    const reason = window.prompt('Give a reason for this change');
    if (!reason || !reason.trim()) return;
    void run('Milestone updated', async () => {
      await call('set_milestone_status', {
        construction_case_id: detailTarget.id,
        milestone_id: milestone.id,
        expected_version: milestone.row_version,
        status,
        reason: reason.trim(),
      });
      await openDetail(detailTarget);
    });
  };

  const saveDate = async (form: FormData) => {
    if (!dateTarget) return;
    const reason = String(form.get('reason') || '');
    if (!reason.trim()) {
      toast.error('A reason is required for every date change');
      return;
    }
    const ok = await run('Date updated', () => call('set_date', {
      construction_case_id: dateTarget.id,
      expected_version: dateTarget.row_version,
      date_kind: String(form.get('date_kind') || 'estimated_completion'),
      new_date: String(form.get('new_date') || '') || null,
      reason: reason.trim(),
    }));
    if (ok) setDateTarget(null);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Construction</CardTitle>
            <CardDescription>
              Build programmes for one project: stages, milestones and dates.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-64" aria-label="Choose a project">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void loadCases()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />Refresh
            </Button>
            <Button size="sm" disabled={!canEdit || !projectId} onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />New build
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          ) : null}

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading construction" />
            </div>
          ) : !projectId ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Choose a project to manage its build programmes.
            </p>
          ) : !cases.length ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No build programmes recorded for this project.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Build</TableHead>
                    <TableHead className="hidden md:table-cell">Progress</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>
                        <span className="font-medium">{record.case_reference || 'No reference'}</span>
                        <span className="block text-xs text-muted-foreground">
                          {record.site_supervisor_name || 'No supervisor'} · v{record.row_version}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {formatPercentComplete(record.percent_complete)}
                        <span className="block text-xs text-muted-foreground">
                          {formatConstructionDate(record.estimated_completion_date)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Select
                          value=""
                          disabled={!canEdit || busy}
                          onValueChange={(value) => changeStatus(record, value)}
                        >
                          <SelectTrigger
                            className="w-48"
                            aria-label={`Change status for ${record.case_reference || 'build'}`}
                          >
                            <SelectValue placeholder={CONSTRUCTION_STATUS_LABELS[record.status]} />
                          </SelectTrigger>
                          <SelectContent>
                            {allowedConstructionTransitions(record.status).map((next) => (
                              <SelectItem key={next} value={next}>
                                {CONSTRUCTION_STATUS_LABELS[next]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="outline" disabled={!canEdit}
                            onClick={() => void openDetail(record)}>
                            <Layers className="mr-2 h-4 w-4" aria-hidden />Programme
                          </Button>
                          <Button size="sm" variant="outline" disabled={!canEdit}
                            onClick={() => setDateTarget(record)}>
                            <CalendarClock className="mr-2 h-4 w-4" aria-hidden />Dates
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New build programme</DialogTitle>
            <DialogDescription>
              A build belongs to one transaction. The database re-checks that the project and unit
              agree with it.
            </DialogDescription>
          </DialogHeader>
          <form
            id="builder-construction-form"
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void createCase(new FormData(event.currentTarget));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="con_transaction">Transaction ID</Label>
              <Input id="con_transaction" name="transaction_id" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="con_reference">Reference</Label>
              <Input id="con_reference" name="case_reference" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="con_supervisor">Site supervisor</Label>
              <Input id="con_supervisor" name="site_supervisor_name" />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" form="builder-construction-form" disabled={busy}>
              Create build
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detailTarget)} onOpenChange={(open) => { if (!open) setDetailTarget(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              <HardHat className="mr-2 inline h-4 w-4" aria-hidden />
              Programme · {detailTarget?.case_reference || 'build'}
            </DialogTitle>
            <DialogDescription>
              Stages and milestones. A milestone is a programme event, never a payment trigger.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <h4 className="mb-2 text-sm font-medium">Stages ({stages.length})</h4>
              {!stages.length ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  No stages recorded.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {stages.map((stage) => (
                    <Badge key={stage.id} variant="outline">
                      {stage.sequence_number}. {stage.name} · {stage.status}
                    </Badge>
                  ))}
                </div>
              )}
              <form
                className="mt-3 grid gap-2 sm:grid-cols-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addStage(new FormData(event.currentTarget));
                }}
              >
                <Input name="stage_name" placeholder="Stage name" required aria-label="Stage name" />
                <select
                  name="stage_key" defaultValue="other" aria-label="Stage key"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {(Object.keys(CONSTRUCTION_STAGE_KEY_LABELS) as BuilderConstructionStageKey[])
                    .map((value) => (
                      <option key={value} value={value}>
                        {CONSTRUCTION_STAGE_KEY_LABELS[value]}
                      </option>
                    ))}
                </select>
                <Input name="sequence_number" type="number" min={1} defaultValue={stages.length + 1}
                  aria-label="Sequence number" />
                <Button type="submit" size="sm" disabled={!canEdit || busy}>Add stage</Button>
              </form>
            </div>

            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Flag className="h-4 w-4 text-primary" aria-hidden />
                Milestones ({milestones.length})
              </h4>
              {!milestones.length ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  No milestones recorded.
                </p>
              ) : (
                <ul className="space-y-2">
                  {milestones.map((milestone) => (
                    <li key={milestone.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                      <div>
                        <span className="font-medium">{milestone.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {MILESTONE_STATUS_LABELS[milestone.status]}
                          {milestone.planned_date
                            ? ` · ${formatConstructionDate(milestone.planned_date)}`
                            : ''}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {allowedMilestoneTransitions(milestone.status).map((next) => (
                          <Button key={next} size="sm" variant="outline"
                            disabled={!canEdit || busy}
                            onClick={() => changeMilestoneStatus(milestone, next)}>
                            {MILESTONE_STATUS_LABELS[next]}
                          </Button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="mt-3 grid gap-2 sm:grid-cols-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addMilestone(new FormData(event.currentTarget));
                }}
              >
                <Input name="milestone_name" placeholder="Milestone name" required
                  aria-label="Milestone name" />
                <Input name="planned_date" type="date" aria-label="Planned date" />
                <Button type="submit" size="sm" disabled={!canEdit || busy}>Add milestone</Button>
              </form>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(dateTarget)} onOpenChange={(open) => { if (!open) setDateTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Programme dates</DialogTitle>
            <DialogDescription>
              Every change records its previous value and a reason, so slippage is auditable.
            </DialogDescription>
          </DialogHeader>
          <form
            id="builder-date-form"
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveDate(new FormData(event.currentTarget));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="admin_date_kind">Date</Label>
              <select
                id="admin_date_kind" name="date_kind" defaultValue="estimated_completion"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {(Object.keys(CONSTRUCTION_DATE_KIND_LABELS) as BuilderConstructionDateKind[])
                  .map((value) => (
                    <option key={value} value={value}>
                      {CONSTRUCTION_DATE_KIND_LABELS[value]}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin_new_date">New date</Label>
              <Input id="admin_new_date" name="new_date" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin_date_reason">Reason</Label>
              <Input id="admin_date_reason" name="reason" required />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDateTarget(null)}>Cancel</Button>
            <Button type="submit" form="builder-date-form" disabled={busy}>Save date</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
