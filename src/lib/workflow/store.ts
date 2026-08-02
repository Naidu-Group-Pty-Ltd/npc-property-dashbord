/**
 * Canvas state.
 *
 * History is snapshot-based rather than a command log: graphs are small (tens of
 * nodes) and snapshots make undo correct by construction, which matters more
 * here than the memory a command log would save. Drags coalesce into a single
 * history entry so undo steps back one gesture, not one mouse-move.
 */

import { create } from 'zustand';
import { EMPTY_GRAPH, type Vec2, type WorkflowGraph, type WorkflowNode } from './types';
import { defaultConfigFor, makeId, wouldCreateCycle } from './graph';

const HISTORY_LIMIT = 50;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** A connection being dragged out of a port, before it lands. */
export interface PendingConnection {
  source: string;
  sourceBranch?: string;
  /** Canvas-space cursor position. */
  cursor: Vec2;
}

interface WorkflowState {
  graph: WorkflowGraph;
  selectedNodeId: string | null;
  viewport: Viewport;
  pending: PendingConnection | null;
  dirty: boolean;
  past: WorkflowGraph[];
  future: WorkflowGraph[];

  loadGraph: (graph: WorkflowGraph) => void;
  markSaved: () => void;

  addNode: (catalogId: string, position: Vec2) => string;
  moveNode: (id: string, position: Vec2, options?: { commit?: boolean }) => void;
  removeNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  toggleDisabled: (id: string) => void;
  renameNode: (id: string, label: string) => void;
  updateConfig: (id: string, key: string, value: unknown) => void;

  beginConnection: (source: string, cursor: Vec2, sourceBranch?: string) => void;
  moveConnection: (cursor: Vec2) => void;
  completeConnection: (target: string) => void;
  cancelConnection: () => void;
  removeEdge: (id: string) => void;

  selectNode: (id: string | null) => void;
  setViewport: (viewport: Viewport) => void;

  undo: () => void;
  redo: () => void;
}

const clone = (graph: WorkflowGraph): WorkflowGraph => ({
  nodes: graph.nodes.map((n) => ({ ...n, position: { ...n.position }, config: { ...n.config } })),
  edges: graph.edges.map((e) => ({ ...e })),
});

export const useWorkflowStore = create<WorkflowState>((set, get) => {
  /** Applies a change and records the pre-change graph for undo. */
  const commit = (mutate: (graph: WorkflowGraph) => WorkflowGraph) =>
    set((state) => {
      const next = mutate(clone(state.graph));
      return {
        graph: next,
        past: [...state.past, state.graph].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true,
      };
    });

  return {
    graph: EMPTY_GRAPH,
    selectedNodeId: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    pending: null,
    dirty: false,
    past: [],
    future: [],

    loadGraph: (graph) =>
      set({ graph: clone(graph), past: [], future: [], dirty: false, selectedNodeId: null, pending: null }),

    markSaved: () => set({ dirty: false }),

    addNode: (catalogId, position) => {
      const taken = new Set(get().graph.nodes.map((n) => n.id));
      const id = makeId('step', taken);
      commit((graph) => {
        graph.nodes.push({ id, type: catalogId, position, config: defaultConfigFor(catalogId) });
        return graph;
      });
      set({ selectedNodeId: id });
      return id;
    },

    /**
     * Dragging calls this on every pointer move with `commit: false`, so the
     * graph updates live but only the drag's end lands in history.
     */
    moveNode: (id, position, options) => {
      const apply = (graph: WorkflowGraph) => {
        const node = graph.nodes.find((n) => n.id === id);
        if (node) node.position = position;
        return graph;
      };
      if (options?.commit) {
        commit(apply);
      } else {
        set((state) => ({ graph: apply(clone(state.graph)), dirty: true }));
      }
    },

    removeNode: (id) => {
      commit((graph) => ({
        nodes: graph.nodes.filter((n) => n.id !== id),
        edges: graph.edges.filter((e) => e.source !== id && e.target !== id),
      }));
      if (get().selectedNodeId === id) set({ selectedNodeId: null });
    },

    duplicateNode: (id) => {
      const source = get().graph.nodes.find((n) => n.id === id);
      if (!source) return;
      const taken = new Set(get().graph.nodes.map((n) => n.id));
      const newId = makeId('step', taken);
      commit((graph) => {
        graph.nodes.push({
          ...source,
          id: newId,
          position: { x: source.position.x + 40, y: source.position.y + 40 },
          config: { ...source.config },
        });
        return graph;
      });
      set({ selectedNodeId: newId });
    },

    toggleDisabled: (id) =>
      commit((graph) => {
        const node = graph.nodes.find((n) => n.id === id);
        if (node) node.disabled = !node.disabled;
        return graph;
      }),

    renameNode: (id, label) =>
      commit((graph) => {
        const node = graph.nodes.find((n) => n.id === id);
        if (node) node.label = label;
        return graph;
      }),

    updateConfig: (id, key, value) =>
      commit((graph) => {
        const node = graph.nodes.find((n) => n.id === id);
        if (node) node.config = { ...node.config, [key]: value };
        return graph;
      }),

    beginConnection: (source, cursor, sourceBranch) => set({ pending: { source, cursor, sourceBranch } }),

    moveConnection: (cursor) =>
      set((state) => (state.pending ? { pending: { ...state.pending, cursor } } : {})),

    completeConnection: (target) => {
      const { pending, graph } = get();
      if (!pending || pending.source === target) return set({ pending: null });

      const duplicate = graph.edges.some(
        (e) => e.source === pending.source && e.target === target && e.sourceBranch === pending.sourceBranch,
      );
      if (duplicate || wouldCreateCycle(graph, pending.source, target)) return set({ pending: null });

      const taken = new Set(graph.edges.map((e) => e.id));
      const id = makeId('link', taken);
      commit((next) => {
        next.edges.push({ id, source: pending.source, target, sourceBranch: pending.sourceBranch });
        return next;
      });
      set({ pending: null });
    },

    cancelConnection: () => set({ pending: null }),

    removeEdge: (id) =>
      commit((graph) => ({ nodes: graph.nodes, edges: graph.edges.filter((e) => e.id !== id) })),

    selectNode: (id) => set({ selectedNodeId: id }),
    setViewport: (viewport) => set({ viewport }),

    undo: () =>
      set((state) => {
        const previous = state.past.at(-1);
        if (!previous) return {};
        return {
          graph: previous,
          past: state.past.slice(0, -1),
          future: [state.graph, ...state.future].slice(0, HISTORY_LIMIT),
          dirty: true,
        };
      }),

    redo: () =>
      set((state) => {
        const [next, ...rest] = state.future;
        if (!next) return {};
        return {
          graph: next,
          past: [...state.past, state.graph].slice(-HISTORY_LIMIT),
          future: rest,
          dirty: true,
        };
      }),
  };
});
