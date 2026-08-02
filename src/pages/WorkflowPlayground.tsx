/**
 * Workflow Playground.
 *
 * Two views behind one route: a library of saved workflows, and the canvas for
 * whichever one is open. The canvas is deliberately full-bleed — it is the work
 * surface, and chrome around it costs the thing you are actually building.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  FlaskConical,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  Redo2,
  Save,
  Undo2,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { useToast } from '@/hooks/use-toast';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useIntegrationCredentials } from '@/hooks/useIntegrationCredentials';
import { useWorkflows } from '@/hooks/useWorkflows';
import { useWorkflowRuns, type RunMode } from '@/hooks/useWorkflowRuns';
import { useTriggerEvents } from '@/hooks/useTriggerEvents';
import { getCatalogNode } from '@/lib/workflow/catalog';
import { evaluateReadiness, isRunnable } from '@/lib/workflow/graph';
import { useWorkflowStore } from '@/lib/workflow/store';
import type { WorkflowRecord } from '@/lib/workflow/types';
import type { WorkflowTemplate } from '@/lib/workflow/templates';
import { NodePalette } from '@/components/workflow/NodePalette';
import { NodeInspector } from '@/components/workflow/NodeInspector';
import { ReadinessRail } from '@/components/workflow/ReadinessRail';
import { WorkflowCanvas } from '@/components/workflow/WorkflowCanvas';
import { WorkflowLibrary } from '@/components/workflow/WorkflowLibrary';
import { RunPanel } from '@/components/workflow/RunPanel';
import { WorkflowStatusControl } from '@/components/workflow/WorkflowStatusControl';
import { suggestedPosition } from '@/components/workflow/canvasGeometry';

export default function WorkflowPlayground() {
  const { canView, canEdit, loading: permissionsLoading } = useModulePermissions('integrations');
  const { toast } = useToast();

  const { workflows, loading: workflowsLoading, create, save, remove } = useWorkflows();
  const { configured, loaded: credentialsLoaded, loading: credentialsLoading } = useIntegrationCredentials();

  const [openWorkflow, setOpenWorkflow] = useState<WorkflowRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [renameTarget, setRenameTarget] = useState<WorkflowRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowRecord | null>(null);
  const [runPanelOpen, setRunPanelOpen] = useState(false);
  const [liveConfirmOpen, setLiveConfirmOpen] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  const runs = useWorkflowRuns(openWorkflow?.id ?? null);

  const graph = useWorkflowStore((s) => s.graph);
  const dirty = useWorkflowStore((s) => s.dirty);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const canUndo = useWorkflowStore((s) => s.past.length > 0);
  const canRedo = useWorkflowStore((s) => s.future.length > 0);

  const triggerEvents = useTriggerEvents(graph, openWorkflow?.status ?? 'draft');

  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId],
  );

  const issues = useMemo(
    () => evaluateReadiness({ graph, configuredIntegrations: configured, credentialsLoaded }),
    [graph, configured, credentialsLoaded],
  );

  const flaggedNodeIds = useMemo(
    () => new Set(issues.filter((i) => i.severity === 'blocking' && i.nodeId).map((i) => i.nodeId as string)),
    [issues],
  );

  const hasTrigger = useMemo(
    () => graph.nodes.some((n) => getCatalogNode(n.type)?.kind === 'trigger'),
    [graph.nodes],
  );

  // Warn before losing unsaved canvas work to a reload or tab close.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /** Last run's outcome per node, so the canvas can show it in place. */
  const runStepStatuses = useMemo(() => {
    const statuses = new Map<string, string>();
    for (const step of runs.result?.steps ?? []) statuses.set(step.nodeId, step.status);
    return statuses;
  }, [runs.result]);

  const openOnCanvas = useCallback(
    (workflow: WorkflowRecord) => {
      useWorkflowStore.getState().loadGraph(workflow.graph);
      setOpenWorkflow(workflow);
      // A previous workflow's results next to this one's canvas would be a lie.
      runs.clear();
      setRunPanelOpen(false);
    },
    [runs.clear],
  );

  const handleSave = useCallback(async () => {
    if (!openWorkflow) return;
    setSaving(true);
    const ok = await save(openWorkflow.id, { graph: useWorkflowStore.getState().graph });
    setSaving(false);
    if (ok) {
      useWorkflowStore.getState().markSaved();
      toast({ title: 'Workflow saved' });
    } else {
      toast({
        title: 'Could not save',
        description: 'The workflow is unchanged on the server. Check your connection and try again.',
        variant: 'destructive',
      });
    }
  }, [openWorkflow, save, toast]);

  // Cmd/Ctrl+S saves, Cmd/Ctrl+Z undoes — the shortcuts a canvas is expected to have.
  useEffect(() => {
    if (!openWorkflow) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void handleSave();
      } else if (key === 'z') {
        const target = event.target as HTMLElement | null;
        if (target?.closest('input, textarea, [contenteditable="true"]')) return;
        event.preventDefault();
        if (event.shiftKey) useWorkflowStore.getState().redo();
        else useWorkflowStore.getState().undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, openWorkflow]);

  const handleCreate = async () => {
    const name = draftName.trim();
    if (!name) return;
    const created = await create(name, draftDescription.trim() || undefined);
    setCreateOpen(false);
    setDraftName('');
    setDraftDescription('');
    if (created) {
      openOnCanvas(created);
      toast({ title: 'Workflow created', description: 'Add a trigger to decide when it runs.' });
    } else {
      toast({ title: 'Could not create the workflow', variant: 'destructive' });
    }
  };

  const handleUseTemplate = async (template: WorkflowTemplate) => {
    const created = await create(template.name, template.description);
    if (!created) {
      toast({ title: 'Could not create the workflow', variant: 'destructive' });
      return;
    }
    // Persist the template graph immediately so the copy survives a reload.
    await save(created.id, { graph: template.graph });
    const seeded = { ...created, graph: template.graph };
    openOnCanvas(seeded);
    useWorkflowStore.getState().markSaved();
    toast({ title: `Started from “${template.name}”` });
  };

  const handleRun = useCallback(
    async (mode: RunMode) => {
      setRunPanelOpen(true);
      const run = await runs.start(useWorkflowStore.getState().graph, mode);

      // The panel carries the detail; the toast only says whether to look.
      if (run.status === 'succeeded') {
        toast({
          title: mode === 'live' ? 'Live run finished' : 'Test run finished',
          description: `${run.steps.length} step${run.steps.length === 1 ? '' : 's'} completed.`,
        });
      } else {
        toast({
          title: run.status === 'failed' ? 'The run failed' : 'The run stopped early',
          description: run.haltReason ?? 'Open the run panel to see which step and why.',
          variant: run.status === 'failed' ? 'destructive' : 'default',
        });
      }
    },
    [runs.start, toast],
  );

  const handleStatusChange = useCallback(
    async (next: WorkflowRecord['status']) => {
      if (!openWorkflow || next === openWorkflow.status) return;
      setStatusSaving(true);
      const ok = await save(openWorkflow.id, { status: next });
      setStatusSaving(false);
      if (!ok) {
        toast({ title: 'Could not change the status', variant: 'destructive' });
        return;
      }
      // The header reads its status from the open record, so it has to move too.
      setOpenWorkflow((current) => (current ? { ...current, status: next } : current));
      toast({
        title:
          next === 'live'
            ? 'Workflow is live'
            : next === 'paused'
              ? 'Workflow paused'
              : 'Workflow set back to draft',
        description:
          next === 'live'
            ? 'Marked ready. Triggers are not dispatched automatically yet, so start it with Test run or Run live.'
            : undefined,
      });
    },
    [openWorkflow, save, toast],
  );

  const handleAddNode = useCallback((catalogId: string) => {
    useWorkflowStore.getState().addNode(catalogId, suggestedPosition(useWorkflowStore.getState().graph));
  }, []);

  const focusNode = useCallback((nodeId: string) => {
    useWorkflowStore.getState().selectNode(nodeId);
    setInspectorOpen(true);
  }, []);

  if (permissionsLoading) {
    return (
      <DashboardThemeFrame variant="page" className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Checking your access…
        </div>
      </DashboardThemeFrame>
    );
  }

  if (!canView) {
    return (
      <DashboardThemeFrame variant="page" className="p-4">
        <DashboardThemeFrame variant="section" className="text-center">
          <h1 className="text-base font-semibold text-foreground">Workflow Playground</h1>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            You do not have access to this module. An administrator can grant it from User Management.
          </p>
        </DashboardThemeFrame>
      </DashboardThemeFrame>
    );
  }

  // ── Canvas view ─────────────────────────────────────────────────────────
  if (openWorkflow) {
    const runnable = isRunnable(issues);

    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-card/60 px-3 py-2 backdrop-blur">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpenWorkflow(null);
              useWorkflowStore.getState().loadGraph({ nodes: [], edges: [] });
            }}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
            All workflows
          </Button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold text-foreground">{openWorkflow.name}</h1>
              {dirty && (
                <Badge variant="outline" className="border-warning/50 bg-warning/15 text-foreground">
                  Unsaved
                </Badge>
              )}
              <WorkflowStatusControl
                status={openWorkflow.status}
                disabled={!canEdit || statusSaving}
                saving={statusSaving}
                runnable={runnable}
                onChange={handleStatusChange}
              />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={!canUndo}
                  onClick={() => useWorkflowStore.getState().undo()}
                  aria-label="Undo"
                >
                  <Undo2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={!canRedo}
                  onClick={() => useWorkflowStore.getState().redo()}
                  aria-label="Redo"
                >
                  <Redo2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Redo</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setInspectorOpen((open) => !open)}
                  aria-label={inspectorOpen ? 'Hide the settings panel' : 'Show the settings panel'}
                  aria-expanded={inspectorOpen}
                >
                  {inspectorOpen ? (
                    <PanelRightClose className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{inspectorOpen ? 'Hide settings' : 'Show settings'}</TooltipContent>
            </Tooltip>

            <Button variant="outline" size="sm" onClick={handleSave} disabled={!canEdit || saving || !dirty}>
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              Save
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    className="rounded-r-none"
                    disabled={!runnable || !canEdit || runs.running}
                    onClick={() => void handleRun('test')}
                  >
                    {runs.running ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    )}
                    Test run
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[16rem]">
                {runnable
                  ? 'Runs the workflow once with sample data. Nothing is sent to clients.'
                  : 'Fix the blocking items in the checks panel first.'}
              </TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  className="h-8 w-7 rounded-l-none border-l border-primary-foreground/25"
                  disabled={!runnable || !canEdit || runs.running}
                  aria-label="More run options"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Run this workflow</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void handleRun('test')}>
                  <FlaskConical className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span className="flex-1">
                    Test run
                    <span className="block text-xs text-muted-foreground">
                      Sample data. Nothing leaves the dashboard.
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setLiveConfirmOpen(true)}>
                  <Zap className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span className="flex-1">
                    Run live
                    <span className="block text-xs text-muted-foreground">
                      Performs real calls. This cannot be undone.
                    </span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="hidden w-72 shrink-0 border-r border-border/60 bg-card/40 lg:block">
            <NodePalette
              configuredIntegrations={configured}
              credentialsLoaded={credentialsLoaded}
              onAddNode={handleAddNode}
              hasTrigger={hasTrigger}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <main className="relative min-h-0 flex-1">
              <WorkflowCanvas
                configuredIntegrations={configured}
                credentialsLoaded={credentialsLoaded}
                flaggedNodeIds={flaggedNodeIds}
                runStepStatuses={runStepStatuses}
                onDropCatalogNode={(catalogId, position) =>
                  useWorkflowStore.getState().addNode(catalogId, position)
                }
              />
            </main>

            {runPanelOpen && (
              <div className="h-[19rem] shrink-0 border-t border-border/60">
                <RunPanel
                  result={runs.result}
                  running={runs.running}
                  events={triggerEvents.events}
                  eventsLoading={triggerEvents.loading}
                  totalCaptured={triggerEvents.totalCaptured}
                  workflowIsLive={openWorkflow.status === 'live'}
                  history={runs.history}
                  historyLoading={runs.historyLoading}
                  persistenceWarning={runs.persistenceWarning}
                  onClose={() => setRunPanelOpen(false)}
                  onFocusNode={focusNode}
                />
              </div>
            )}
          </div>

          {inspectorOpen && (
            <div className="hidden w-80 shrink-0 flex-col border-l border-border/60 bg-card/40 xl:flex">
              <div className="min-h-0 flex-1">
                <NodeInspector
                  node={selectedNode}
                  graph={graph}
                  configured={
                    !selectedNode ||
                    !getCatalogNode(selectedNode.type)?.integrationId ||
                    configured.has(getCatalogNode(selectedNode.type)?.integrationId as string)
                  }
                  credentialsLoaded={credentialsLoaded}
                  onChange={(key, value) =>
                    selectedNode && useWorkflowStore.getState().updateConfig(selectedNode.id, key, value)
                  }
                  onRename={(label) =>
                    selectedNode && useWorkflowStore.getState().renameNode(selectedNode.id, label)
                  }
                  onClose={() => useWorkflowStore.getState().selectNode(null)}
                />
              </div>

              <div className="max-h-[45%] shrink-0 border-t border-border/60">
                <ReadinessRail
                  issues={issues}
                  credentialsLoading={credentialsLoading}
                  nodeCount={graph.nodes.length}
                  onFocusNode={focusNode}
                />
              </div>
            </div>
          )}
        </div>

        <AlertDialog open={liveConfirmOpen} onOpenChange={setLiveConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Run this workflow for real?</AlertDialogTitle>
              <AlertDialogDescription>
                A live run performs the calls its steps describe — messages are sent, records are
                written, and nothing here can take them back. A test run does the same walk without
                sending anything.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setLiveConfirmOpen(false);
                  void handleRun('live');
                }}
              >
                Run live
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ── Library view ────────────────────────────────────────────────────────
  return (
    <DashboardThemeFrame variant="page" className="space-y-4 p-4">
      <DashboardThemeFrame variant="hero">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Automation
            </p>
            <h1 className="mt-1 text-xl font-semibold text-foreground">Workflow Playground</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Wire your integrations together. Pick something that happens — a client is added, a report
              finishes, the RBA moves — and decide what should happen next.
            </p>
          </div>

          {canEdit && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              New workflow
            </Button>
          )}
        </div>
      </DashboardThemeFrame>

      <WorkflowLibrary
        workflows={workflows}
        loading={workflowsLoading}
        canEdit={canEdit}
        configuredIntegrations={configured}
        credentialsLoaded={credentialsLoaded}
        onCreate={() => setCreateOpen(true)}
        onOpen={openOnCanvas}
        onRename={setRenameTarget}
        onDelete={setDeleteTarget}
        onUseTemplate={handleUseTemplate}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>
              Give it a name you will recognise in a month. You can change it later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="workflow-name">Name</Label>
              <Input
                id="workflow-name"
                value={draftName}
                autoFocus
                placeholder="Screen every new client"
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void handleCreate()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workflow-description">What it does (optional)</Label>
              <Textarea
                id="workflow-description"
                value={draftDescription}
                rows={2}
                placeholder="Runs sanctions screening as soon as a client is added."
                onChange={(event) => setDraftDescription(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!draftName.trim()}>
              Create and open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RenameDialog
        workflow={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSave={async (name, description) => {
          if (!renameTarget) return;
          const ok = await save(renameTarget.id, { name, description });
          setRenameTarget(null);
          toast(ok ? { title: 'Workflow updated' } : { title: 'Could not save', variant: 'destructive' });
        }}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The workflow and its steps are removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteTarget) return;
                const ok = await remove(deleteTarget.id);
                setDeleteTarget(null);
                toast(
                  ok
                    ? { title: 'Workflow deleted' }
                    : { title: 'Could not delete', variant: 'destructive' },
                );
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardThemeFrame>
  );
}

function RenameDialog({
  workflow,
  onClose,
  onSave,
}: {
  workflow: WorkflowRecord | null;
  onClose: () => void;
  onSave: (name: string, description: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    setName(workflow?.name ?? '');
    setDescription(workflow?.description ?? '');
  }, [workflow]);

  return (
    <Dialog open={Boolean(workflow)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rename-name">Name</Label>
            <Input id="rename-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rename-description">What it does</Label>
            <Textarea
              id="rename-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(name.trim(), description.trim() || null)} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
