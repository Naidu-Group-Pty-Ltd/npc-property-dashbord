/**
 * Canvas geometry.
 *
 * Node size lives here rather than in CSS because the edge layer has to compute
 * port positions in the same coordinate space the nodes are laid out in. One
 * source for both keeps edges attached to ports when the node size changes.
 */

import { getCatalogNode } from '@/lib/workflow/catalog';
import type { Vec2, WorkflowEdge, WorkflowGraph, WorkflowNode } from '@/lib/workflow/types';

/** Matches `.wf-node { width }` in src/styles/workflow.css. */
export const NODE_WIDTH = 272;
export const NODE_HEIGHT = 76;

export const GRID_SIZE = 16;
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 1.8;

export const snap = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** Where a node's incoming port sits, in canvas space. */
export const targetPort = (node: WorkflowNode): Vec2 => ({
  x: node.position.x,
  y: node.position.y + NODE_HEIGHT / 2,
});

/**
 * Where an outgoing port sits. Branch nodes stack their ports vertically, so the
 * branch index shifts the anchor to match the rendered layout.
 */
export function sourcePort(node: WorkflowNode, branchId?: string): Vec2 {
  const definition = getCatalogNode(node.type);
  const branches = definition?.branches ?? [];
  const x = node.position.x + NODE_WIDTH;
  const centreY = node.position.y + NODE_HEIGHT / 2;

  if (!branches.length || !branchId) return { x, y: centreY };

  const index = branches.findIndex((b) => b.id === branchId);
  if (index < 0) return { x, y: centreY };

  // Mirrors the `gap-3` column in WorkflowNodeCard: 14px port + 12px gap.
  const spacing = 26;
  const offset = (index - (branches.length - 1) / 2) * spacing;
  return { x, y: centreY + offset };
}

/**
 * A horizontal cubic bezier between two ports. The control points lean out
 * proportionally to the horizontal gap so short links stay tight and long ones
 * bow gently rather than looping.
 */
export function edgePath(from: Vec2, to: Vec2): string {
  const dx = Math.abs(to.x - from.x);
  const curve = Math.max(32, Math.min(dx * 0.55, 160));
  return `M ${from.x},${from.y} C ${from.x + curve},${from.y} ${to.x - curve},${to.y} ${to.x},${to.y}`;
}

export const edgeMidpoint = (from: Vec2, to: Vec2): Vec2 => ({
  x: (from.x + to.x) / 2,
  y: (from.y + to.y) / 2,
});

export interface ResolvedEdge {
  edge: WorkflowEdge;
  from: Vec2;
  to: Vec2;
  label?: string;
}

/** Edges paired with their endpoint coordinates, dropping any that dangle. */
export function resolveEdges(graph: WorkflowGraph): ResolvedEdge[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const resolved: ResolvedEdge[] = [];

  for (const edge of graph.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;

    const branch = edge.sourceBranch
      ? getCatalogNode(source.type)?.branches?.find((b) => b.id === edge.sourceBranch)
      : undefined;

    resolved.push({
      edge,
      from: sourcePort(source, edge.sourceBranch),
      to: targetPort(target),
      label: branch?.label,
    });
  }

  return resolved;
}

/** Bounding box of every node, used to fit the view. */
export function graphBounds(graph: WorkflowGraph) {
  if (!graph.nodes.length) return null;
  const xs = graph.nodes.map((n) => n.position.x);
  const ys = graph.nodes.map((n) => n.position.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs) + NODE_WIDTH,
    maxY: Math.max(...ys) + NODE_HEIGHT,
  };
}

/** Screen point → canvas point, given the current pan and zoom. */
export const toCanvasSpace = (
  point: Vec2,
  rect: { left: number; top: number },
  viewport: { x: number; y: number; zoom: number },
): Vec2 => ({
  x: (point.x - rect.left - viewport.x) / viewport.zoom,
  y: (point.y - rect.top - viewport.y) / viewport.zoom,
});

/**
 * Places a new node to the right of the last one so building a linear flow by
 * clicking through the palette produces a readable chain instead of a stack.
 */
export function suggestedPosition(graph: WorkflowGraph): Vec2 {
  if (!graph.nodes.length) return { x: 80, y: 120 };
  const rightmost = graph.nodes.reduce((a, b) => (b.position.x > a.position.x ? b : a));
  return { x: rightmost.position.x + NODE_WIDTH + 96, y: rightmost.position.y };
}
