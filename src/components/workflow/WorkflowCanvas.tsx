/**
 * The plotting surface.
 *
 * Pointer handling is centralised here rather than spread across the node cards:
 * a drag that starts on a node, a port or the background all end up in the same
 * move/up handlers, which is what keeps "drag a node" and "drag a connection"
 * from fighting over the same gesture.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getCatalogNode } from '@/lib/workflow/catalog';
import { useWorkflowStore } from '@/lib/workflow/store';
import type { Vec2 } from '@/lib/workflow/types';
import {
  GRID_SIZE,
  clampZoom,
  graphBounds,
  snap,
  toCanvasSpace,
} from './canvasGeometry';
import { WorkflowEdgeLayer } from './WorkflowEdgeLayer';
import { WorkflowNodeCard } from './WorkflowNodeCard';

interface WorkflowCanvasProps {
  /** Integration ids with credentials saved; drives the unconfigured state. */
  configuredIntegrations: Set<string>;
  credentialsLoaded: boolean;
  /** Node ids a readiness issue points at. */
  flaggedNodeIds: Set<string>;
  /** Called when a palette item is dropped onto the canvas. */
  onDropCatalogNode: (catalogId: string, position: Vec2) => void;
}

/**
 * Whether a step's credentials are in place. Platform and logic steps have no
 * integration behind them, so they are always satisfied; while credentials are
 * still loading everything is treated as fine to avoid a flash of warnings.
 */
function isNodeConfigured(
  catalogId: string,
  configuredIntegrations: Set<string>,
  credentialsLoaded: boolean,
): boolean {
  if (!credentialsLoaded) return true;
  const integrationId = getCatalogNode(catalogId)?.integrationId;
  if (!integrationId) return true;
  return configuredIntegrations.has(integrationId);
}

type DragState =
  | { kind: 'none' }
  | { kind: 'node'; nodeId: string; offset: Vec2 }
  | { kind: 'pan'; origin: Vec2; start: Vec2 }
  | { kind: 'connect' };

export function WorkflowCanvas({
  configuredIntegrations,
  credentialsLoaded,
  flaggedNodeIds,
  onDropCatalogNode,
}: WorkflowCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>({ kind: 'none' });
  const [dragKind, setDragKind] = useState<DragState['kind']>('none');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const graph = useWorkflowStore((s) => s.graph);
  const viewport = useWorkflowStore((s) => s.viewport);
  const pending = useWorkflowStore((s) => s.pending);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const {
    moveNode,
    selectNode,
    setViewport,
    beginConnection,
    moveConnection,
    completeConnection,
    cancelConnection,
    removeNode,
    removeEdge,
    duplicateNode,
    toggleDisabled,
  } = useWorkflowStore.getState();

  const pointToCanvas = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return toCanvasSpace({ x: clientX, y: clientY }, rect, viewport);
    },
    [viewport],
  );

  const setDrag = (state: DragState) => {
    dragRef.current = state;
    setDragKind(state.kind);
  };

  // --- Node drag ----------------------------------------------------------
  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, nodeId: string) => {
      // Let ports and menu buttons handle their own gestures.
      if ((event.target as HTMLElement).closest('[data-port], [role="menuitem"], button')) return;
      event.stopPropagation();
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (!node) return;

      const point = pointToCanvas(event.clientX, event.clientY);
      setDrag({ kind: 'node', nodeId, offset: { x: point.x - node.position.x, y: point.y - node.position.y } });
      selectNode(nodeId);
      setSelectedEdgeId(null);
      surfaceRef.current?.setPointerCapture(event.pointerId);
    },
    [graph.nodes, pointToCanvas, selectNode],
  );

  // --- Connection drag ----------------------------------------------------
  const handleStartConnection = useCallback(
    (event: ReactPointerEvent<HTMLElement>, nodeId: string, branch?: string) => {
      event.stopPropagation();
      event.preventDefault();
      setDrag({ kind: 'connect' });
      beginConnection(nodeId, pointToCanvas(event.clientX, event.clientY), branch);
      surfaceRef.current?.setPointerCapture(event.pointerId);
    },
    [beginConnection, pointToCanvas],
  );

  const handleFinishConnection = useCallback(
    (nodeId: string) => {
      if (dragRef.current.kind === 'connect') completeConnection(nodeId);
    },
    [completeConnection],
  );

  // --- Background pan -----------------------------------------------------
  const handleSurfacePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.button !== 1) return;
      setDrag({ kind: 'pan', origin: { x: event.clientX, y: event.clientY }, start: { x: viewport.x, y: viewport.y } });
      selectNode(null);
      setSelectedEdgeId(null);
      surfaceRef.current?.setPointerCapture(event.pointerId);
    },
    [selectNode, viewport.x, viewport.y],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag.kind === 'node') {
        const point = pointToCanvas(event.clientX, event.clientY);
        moveNode(drag.nodeId, {
          x: snap(point.x - drag.offset.x),
          y: snap(point.y - drag.offset.y),
        });
      } else if (drag.kind === 'pan') {
        setViewport({
          ...viewport,
          x: drag.start.x + (event.clientX - drag.origin.x),
          y: drag.start.y + (event.clientY - drag.origin.y),
        });
      } else if (drag.kind === 'connect') {
        moveConnection(pointToCanvas(event.clientX, event.clientY));
      }
    },
    [moveConnection, moveNode, pointToCanvas, setViewport, viewport],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;

      if (drag.kind === 'node') {
        // Commit the finished gesture so undo steps back the whole drag.
        const node = graph.nodes.find((n) => n.id === drag.nodeId);
        if (node) moveNode(drag.nodeId, node.position, { commit: true });
      }

      if (drag.kind === 'connect') {
        const landed = (event.target as HTMLElement)?.closest?.('[data-node-id]');
        const nodeId = landed?.getAttribute('data-node-id');
        if (nodeId) completeConnection(nodeId);
        else cancelConnection();
      }

      setDrag({ kind: 'none' });
      if (surfaceRef.current?.hasPointerCapture(event.pointerId)) {
        surfaceRef.current.releasePointerCapture(event.pointerId);
      }
    },
    [cancelConnection, completeConnection, graph.nodes, moveNode],
  );

  // --- Zoom ---------------------------------------------------------------
  const zoomAt = useCallback(
    (factor: number, anchor?: Vec2) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      const nextZoom = clampZoom(viewport.zoom * factor);
      if (nextZoom === viewport.zoom) return;

      // Keep the anchor point stationary while the scale changes.
      const focus = anchor ?? {
        x: (rect?.width ?? 0) / 2,
        y: (rect?.height ?? 0) / 2,
      };
      const ratio = nextZoom / viewport.zoom;
      setViewport({
        zoom: nextZoom,
        x: focus.x - (focus.x - viewport.x) * ratio,
        y: focus.y - (focus.y - viewport.y) * ratio,
      });
    },
    [setViewport, viewport],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    // Non-passive so pinch-zoom and ctrl+wheel do not scroll the page instead.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };

    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const fitToView = useCallback(() => {
    const bounds = graphBounds(graph);
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!bounds || !rect) return;

    const padding = 64;
    const zoom = clampZoom(
      Math.min(
        (rect.width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX),
        (rect.height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY),
        1,
      ),
    );
    setViewport({
      zoom,
      x: rect.width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
      y: rect.height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
    });
  }, [graph, setViewport]);

  // --- Keyboard -----------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never steal keys from a field the user is typing in.
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      if (event.key === 'Escape') {
        cancelConnection();
        setDrag({ kind: 'none' });
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedEdgeId) {
          event.preventDefault();
          removeEdge(selectedEdgeId);
          setSelectedEdgeId(null);
        } else if (selectedNodeId) {
          event.preventDefault();
          removeNode(selectedNodeId);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelConnection, removeEdge, removeNode, selectedEdgeId, selectedNodeId]);

  return (
    <div
      ref={surfaceRef}
      className="wf-canvas h-full w-full"
      data-panning={dragKind === 'pan'}
      data-connecting={dragKind === 'connect'}
      style={{
        backgroundSize: `${GRID_SIZE * viewport.zoom}px ${GRID_SIZE * viewport.zoom}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerDown={handleSurfacePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        event.preventDefault();
        const catalogId = event.dataTransfer.getData('application/x-workflow-node');
        if (!catalogId) return;
        const point = pointToCanvas(event.clientX, event.clientY);
        onDropCatalogNode(catalogId, { x: snap(point.x - 136), y: snap(point.y - 38) });
      }}
    >
      <div
        className="wf-viewport"
        style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})` }}
      >
        <WorkflowEdgeLayer
          graph={graph}
          selectedEdgeId={selectedEdgeId}
          pending={pending}
          onSelectEdge={setSelectedEdgeId}
        />

        {graph.nodes.map((node) => (
          <WorkflowNodeCard
            key={node.id}
            node={node}
            selected={selectedNodeId === node.id}
            dragging={dragKind === 'node' && dragRef.current.kind === 'node' && dragRef.current.nodeId === node.id}
            flagged={flaggedNodeIds.has(node.id)}
            configured={isNodeConfigured(node.type, configuredIntegrations, credentialsLoaded)}
            onPointerDownCard={handleNodePointerDown}
            onStartConnection={handleStartConnection}
            onFinishConnection={handleFinishConnection}
            onSelect={selectNode}
            onDelete={removeNode}
            onDuplicate={duplicateNode}
            onToggleDisabled={toggleDisabled}
          />
        ))}
      </div>

      <div className="pointer-events-auto absolute bottom-4 right-4 flex items-center gap-1 rounded-xl border border-border/70 bg-card/90 p-1 shadow-sm backdrop-blur">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomAt(1 / 1.2)} aria-label="Zoom out">
              <Minus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom out</TooltipContent>
        </Tooltip>

        <span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(viewport.zoom * 100)}%
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomAt(1.2)} aria-label="Zoom in">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom in</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fitToView} aria-label="Fit to view">
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Fit to view</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
