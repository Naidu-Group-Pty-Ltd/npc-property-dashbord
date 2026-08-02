/**
 * The landing view: what you have already built, and what you could build.
 *
 * Templates sit alongside saved workflows rather than behind a separate button —
 * on an empty account the library would otherwise be a blank page with a single
 * call to action, which teaches nobody what the tool is for.
 */

import { KeyRound, MoreVertical, Pencil, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getIntegrationName } from '@/lib/workflow/integrationNames';
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '@/lib/workflow/templates';
import type { WorkflowRecord } from '@/lib/workflow/types';

interface WorkflowLibraryProps {
  workflows: WorkflowRecord[];
  loading: boolean;
  canEdit: boolean;
  configuredIntegrations: Set<string>;
  credentialsLoaded: boolean;
  onCreate: () => void;
  onOpen: (workflow: WorkflowRecord) => void;
  onRename: (workflow: WorkflowRecord) => void;
  onDelete: (workflow: WorkflowRecord) => void;
  onUseTemplate: (template: WorkflowTemplate) => void;
}

const STATUS_STYLES: Record<WorkflowRecord['status'], string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  live: 'border-success/30 bg-success/10 text-success',
  paused: 'border-warning/50 bg-warning/15 text-foreground',
};

const STATUS_LABELS: Record<WorkflowRecord['status'], string> = {
  draft: 'Draft',
  live: 'Live',
  paused: 'Paused',
};

export function WorkflowLibrary({
  workflows,
  loading,
  canEdit,
  configuredIntegrations,
  credentialsLoaded,
  onCreate,
  onOpen,
  onRename,
  onDelete,
  onUseTemplate,
}: WorkflowLibraryProps) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="saved-workflows">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="saved-workflows" className="text-sm font-semibold text-foreground">
            Your workflows
          </h2>
          {workflows.length > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {workflows.length} saved
            </span>
          )}
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <DashboardThemeFrame variant="section" className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full border border-border bg-muted/60">
              <WorkflowIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">No workflows yet</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                A workflow watches for something happening, then does the follow-up for you. Start from a
                template below, or build one from scratch.
              </p>
            </div>
            {canEdit && (
              <Button onClick={onCreate} size="sm">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                New workflow
              </Button>
            )}
          </DashboardThemeFrame>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {workflows.map((workflow) => (
              <li key={workflow.id}>
                <DashboardThemeFrame variant="premiumCard" className="h-full">
                  <div className="flex h-full flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onOpen(workflow)}
                        className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <p className="truncate text-sm font-semibold text-foreground">{workflow.name}</p>
                      </button>
                      <Badge variant="outline" className={STATUS_STYLES[workflow.status]}>
                        {STATUS_LABELS[workflow.status]}
                      </Badge>
                      {canEdit && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              aria-label={`Actions for ${workflow.name}`}
                            >
                              <MoreVertical className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => onRename(workflow)}>
                              <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => onDelete(workflow)}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    <p className="mt-1 line-clamp-2 flex-1 text-xs text-muted-foreground">
                      {workflow.description || 'No description yet.'}
                    </p>

                    <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">
                        {workflow.graph.nodes.length} {workflow.graph.nodes.length === 1 ? 'step' : 'steps'}
                      </span>
                      <span>Edited {new Date(workflow.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </DashboardThemeFrame>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="workflow-templates">
        <div className="mb-3">
          <h2 id="workflow-templates" className="text-sm font-semibold text-foreground">
            Start from a template
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Complete workflows you can open and adapt. Each one uses integrations already in your library.
          </p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {WORKFLOW_TEMPLATES.map((template) => {
            const missing = credentialsLoaded
              ? template.requires.filter((id) => !configuredIntegrations.has(id))
              : [];

            return (
              <li key={template.id}>
                <DashboardThemeFrame variant="card" className="h-full">
                  <div className="flex h-full flex-col p-4">
                    <p className="text-sm font-semibold text-foreground">{template.name}</p>
                    <p className="mt-1 flex-1 text-xs leading-snug text-muted-foreground">
                      {template.description}
                    </p>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {template.graph.nodes.length} steps
                      </span>

                      <div className="flex items-center gap-1.5">
                        {missing.length > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="inline-flex items-center gap-1 text-warning"
                                aria-label={`${missing.length} integrations need credentials`}
                              >
                                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                                <span className="text-[11px] tabular-nums">{missing.length}</span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[16rem]">
                              Needs credentials for {missing.map(getIntegrationName).join(', ')}. You can still
                              open it and fill them in later.
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {canEdit && (
                          <Button variant="outline" size="sm" onClick={() => onUseTemplate(template)}>
                            Use template
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </DashboardThemeFrame>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
