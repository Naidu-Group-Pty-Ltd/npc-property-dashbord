/**
 * The connections between steps.
 *
 * Rendered as one SVG beneath the nodes. Each edge gets an invisible wide
 * "hit" stroke so it can be selected without demanding pixel accuracy, and the
 * visible stroke stays thin.
 *
 * Two affordances live here. Hovering an edge reveals a button at its midpoint
 * that deletes it, and dragging a step over an edge marks it as a splice target
 * so dropping inserts the step into that connection rather than beside it.
 */

import { memo, useState } from 'react';
import type { Vec2, WorkflowGraph } from '@/lib/workflow/types';
import { edgeMidpoint, edgePath, resolveEdges, sourcePort } from './canvasGeometry';

interface WorkflowEdgeLayerProps {
  graph: WorkflowGraph;
  selectedEdgeId: string | null;
  /** In-flight connection being dragged out of a port. */
  pending: { source: string; sourceBranch?: string; cursor: Vec2 } | null;
  /** Edge a dragged step is hovering over; dropping splices into it. */
  spliceTargetEdgeId: string | null;
  /** Steps on the highlighted path — their edges are emphasised. */
  tracedNodeIds: Set<string>;
  onSelectEdge: (edgeId: string | null) => void;
  onRemoveEdge: (edgeId: string) => void;
  /** True while a step is being dragged, which suppresses hover affordances. */
  dragging: boolean;
}

function WorkflowEdgeLayerImpl({
  graph,
  selectedEdgeId,
  pending,
  spliceTargetEdgeId,
  tracedNodeIds,
  onSelectEdge,
  onRemoveEdge,
  dragging,
}: WorkflowEdgeLayerProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const edges = resolveEdges(graph);
  const pendingSource = pending ? graph.nodes.find((n) => n.id === pending.source) : undefined;

  return (
    <svg className="wf-edges" aria-hidden="true">
      {edges.map(({ edge, from, to, label }) => {
        const midpoint = edgeMidpoint(from, to);
        const path = edgePath(from, to);
        const traced = tracedNodeIds.has(edge.source) && tracedNodeIds.has(edge.target);
        const showActions = !dragging && hovered === edge.id;

        return (
          <g
            key={edge.id}
            className="wf-edge-group"
            data-selected={selectedEdgeId === edge.id}
            data-splice={spliceTargetEdgeId === edge.id}
            data-traced={traced}
            onPointerEnter={() => setHovered(edge.id)}
            onPointerLeave={() => setHovered((current) => (current === edge.id ? null : current))}
          >
            <path
              className="wf-edge-hit"
              d={path}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectEdge(edge.id);
              }}
            />
            <path className="wf-edge-path" d={path} />

            {label && !showActions && (
              <text className="wf-edge-label" x={midpoint.x} y={midpoint.y - 6}>
                {label}
              </text>
            )}

            {/* Delete affordance, revealed on hover at the midpoint. */}
            {showActions && (
              <g
                className="wf-edge-action"
                transform={`translate(${midpoint.x}, ${midpoint.y})`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onRemoveEdge(edge.id);
                }}
              >
                <circle r="9" />
                <path d="M -3.2 -3.2 L 3.2 3.2 M 3.2 -3.2 L -3.2 3.2" />
              </g>
            )}
          </g>
        );
      })}

      {pending && pendingSource && (
        <path
          className="wf-edge-pending"
          d={edgePath(sourcePort(pendingSource, pending.sourceBranch), pending.cursor)}
        />
      )}
    </svg>
  );
}

export const WorkflowEdgeLayer = memo(WorkflowEdgeLayerImpl);
