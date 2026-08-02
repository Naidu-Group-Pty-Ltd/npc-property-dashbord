/**
 * One step on the canvas.
 *
 * Inline styles here are geometry only (`transform`) — every colour comes from
 * the accent custom property set by the category class, so the node re-themes
 * with the dashboard and the style ratchet stays clean.
 */

import { memo, useCallback, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { KeyRound, MoreVertical, PowerOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getCatalogNode } from '@/lib/workflow/catalog';
import type { WorkflowNode } from '@/lib/workflow/types';
import { NODE_HEIGHT, NODE_WIDTH } from './canvasGeometry';
import { accentClass } from './nodeAccents';
import { NodeGlyph } from './nodeVisuals';

export interface WorkflowNodeCardProps {
  node: WorkflowNode;
  selected: boolean;
  dragging: boolean;
  flagged: boolean;
  /** False when the node's integration has no saved credential. */
  configured: boolean;
  onPointerDownCard: (event: PointerEvent<HTMLDivElement>, nodeId: string) => void;
  onStartConnection: (event: PointerEvent<HTMLElement>, nodeId: string, branch?: string) => void;
  onFinishConnection: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onToggleDisabled: (nodeId: string) => void;
}

function WorkflowNodeCardImpl({
  node,
  selected,
  dragging,
  flagged,
  configured,
  onPointerDownCard,
  onStartConnection,
  onFinishConnection,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleDisabled,
}: WorkflowNodeCardProps) {
  const definition = getCatalogNode(node.type);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(node.id);
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        onDelete(node.id);
      }
    },
    [node.id, onDelete, onSelect],
  );

  // Geometry only — no colour, so this does not trip the inline-style rule.
  const position: CSSProperties = {
    transform: `translate3d(${node.position.x}px, ${node.position.y}px, 0)`,
    width: NODE_WIDTH,
    minHeight: NODE_HEIGHT,
  };

  if (!definition) {
    return (
      <div className="wf-node wf-accent-logic" style={position} data-unknown="true">
        <div className="p-3">
          <p className="text-sm font-medium text-destructive">Unknown step</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This workflow references <span className="wf-token">{node.type}</span>, which is no longer in the
            library. Delete the step or restore the integration.
          </p>
          <button
            type="button"
            onClick={() => onDelete(node.id)}
            className="mt-2 text-xs font-medium text-destructive underline underline-offset-2"
          >
            Delete step
          </button>
        </div>
      </div>
    );
  }

  const title = node.label?.trim() || definition.name;
  const isTrigger = definition.kind === 'trigger';
  const needsCredential = Boolean(definition.integrationId) && !configured;

  return (
    <div
      className={cn('wf-node group', accentClass(definition.category))}
      style={position}
      data-selected={selected}
      data-dragging={dragging}
      data-flagged={flagged}
      data-disabled={node.disabled ?? false}
      data-unconfigured={needsCredential}
      data-kind={definition.kind}
      data-node-id={node.id}
      role="button"
      tabIndex={0}
      aria-label={`${title}. ${definition.summary}`}
      aria-pressed={selected}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => onPointerDownCard(event, node.id)}
      onPointerUp={() => onFinishConnection(node.id)}
    >
      <div className="wf-node-body wf-node-enter flex items-start gap-3 p-3">
        <span className="wf-node-icon shrink-0">
          <NodeGlyph node={definition} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-semibold leading-tight text-foreground">{title}</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Actions for ${title}`}
                  className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => onDuplicate(node.id)}>Duplicate</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onToggleDisabled(node.id)}>
                  {node.disabled ? 'Enable step' : 'Skip this step'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onDelete(node.id)} className="text-destructive">
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{definition.summary}</p>

          {(needsCredential || node.disabled) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {needsCredential && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                      <KeyRound className="h-3 w-3 text-warning" aria-hidden="true" />
                      No credentials
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[15rem]">
                    Add this integration’s key on the Integrations page before the workflow can run.
                  </TooltipContent>
                </Tooltip>
              )}
              {node.disabled && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <PowerOff className="h-3 w-3" aria-hidden="true" />
                  Skipped
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Incoming port — triggers start a run, so they accept nothing. */}
      {!isTrigger && (
        <span
          className="wf-port wf-port-target absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"
          aria-hidden="true"
          data-port="target"
        />
      )}

      {/* Outgoing ports. Branch nodes expose one per path, labelled. */}
      {definition.branches?.length ? (
        <div className="absolute right-0 top-0 flex h-full translate-x-1/2 flex-col justify-center gap-3 pr-0">
          {definition.branches.map((branch) => (
            <span key={branch.id} className="flex items-center gap-1.5">
              <span className="whitespace-nowrap rounded bg-card/90 px-1 text-[10px] font-medium text-muted-foreground">
                {branch.label}
              </span>
              <button
                type="button"
                aria-label={`Connect the ${branch.label.toLowerCase()} path of ${title}`}
                className="wf-port"
                data-port="source"
                data-branch={branch.id}
                onPointerDown={(event) => onStartConnection(event, node.id, branch.id)}
              />
            </span>
          ))}
        </div>
      ) : (
        <button
          type="button"
          aria-label={`Connect ${title} to another step`}
          className="wf-port absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2"
          data-port="source"
          onPointerDown={(event) => onStartConnection(event, node.id)}
        />
      )}
    </div>
  );
}

export const WorkflowNodeCard = memo(WorkflowNodeCardImpl);
