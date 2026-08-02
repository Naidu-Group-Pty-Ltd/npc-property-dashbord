/**
 * The connections between steps.
 *
 * Rendered as one SVG beneath the nodes. Each edge gets an invisible wide
 * "hit" stroke so it can be selected without demanding pixel accuracy, and the
 * visible stroke stays thin.
 */

import { memo } from 'react';
import type { Vec2, WorkflowGraph } from '@/lib/workflow/types';
import { edgeMidpoint, edgePath, resolveEdges, sourcePort } from './canvasGeometry';

interface WorkflowEdgeLayerProps {
  graph: WorkflowGraph;
  selectedEdgeId: string | null;
  /** In-flight connection being dragged out of a port. */
  pending: { source: string; sourceBranch?: string; cursor: Vec2 } | null;
  onSelectEdge: (edgeId: string | null) => void;
}

function WorkflowEdgeLayerImpl({ graph, selectedEdgeId, pending, onSelectEdge }: WorkflowEdgeLayerProps) {
  const edges = resolveEdges(graph);
  const pendingSource = pending ? graph.nodes.find((n) => n.id === pending.source) : undefined;

  return (
    <svg className="wf-edges" aria-hidden="true">
      {edges.map(({ edge, from, to, label }) => {
        const midpoint = edgeMidpoint(from, to);
        return (
          <g
            key={edge.id}
            className="wf-edge-group"
            data-selected={selectedEdgeId === edge.id}
            style={{ pointerEvents: 'auto' }}
          >
            <path
              className="wf-edge-hit"
              d={edgePath(from, to)}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectEdge(edge.id);
              }}
            />
            <path className="wf-edge-path" d={edgePath(from, to)} />
            {label && (
              <text className="wf-edge-label" x={midpoint.x} y={midpoint.y - 6}>
                {label}
              </text>
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
