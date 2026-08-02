/**
 * Saved workflows, read and written through the manage-templates broker so the
 * `integrations` module permission is enforced server-side on every call.
 */

import { useCallback, useEffect, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { EMPTY_GRAPH, type WorkflowGraph, type WorkflowRecord } from '@/lib/workflow/types';

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  graph: unknown;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Saved graphs come back as untyped JSON. Anything malformed degrades to an
 * empty graph so one bad row cannot stop the page rendering the rest.
 */
function toGraph(value: unknown): WorkflowGraph {
  if (!value || typeof value !== 'object') return EMPTY_GRAPH;
  const candidate = value as Partial<WorkflowGraph>;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return EMPTY_GRAPH;
  return { nodes: candidate.nodes, edges: candidate.edges };
}

const toRecord = (row: WorkflowRow): WorkflowRecord => ({
  id: row.id,
  name: row.name,
  description: row.description,
  graph: toGraph(row.graph),
  status: (['draft', 'live', 'paused'] as const).includes(row.status as never)
    ? (row.status as WorkflowRecord['status'])
    : 'draft',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function useWorkflows() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: invokeError } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'workflows',
        listOptions: { orderBy: 'updated_at', orderAsc: false },
      });
      if (invokeError) {
        setError(invokeError.message ?? 'Could not load workflows.');
        return;
      }
      setWorkflows(((data?.records ?? []) as WorkflowRow[]).map(toRecord));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load workflows.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (name: string, description?: string): Promise<WorkflowRecord | null> => {
      const { data, error: invokeError } = await invokeSecureFunction('manage-templates', {
        operation: 'insert',
        table: 'workflows',
        data: { name, description: description ?? null, graph: EMPTY_GRAPH, status: 'draft' },
      });
      if (invokeError || !data?.record) {
        setError(invokeError?.message ?? 'Could not create the workflow.');
        return null;
      }
      const record = toRecord(data.record as WorkflowRow);
      setWorkflows((current) => [record, ...current]);
      return record;
    },
    [],
  );

  const save = useCallback(
    async (id: string, changes: Partial<Pick<WorkflowRecord, 'name' | 'description' | 'graph' | 'status'>>) => {
      const { error: invokeError } = await invokeSecureFunction('manage-templates', {
        operation: 'update',
        table: 'workflows',
        recordId: id,
        data: changes,
      });
      if (invokeError) {
        setError(invokeError.message ?? 'Could not save the workflow.');
        return false;
      }
      setWorkflows((current) =>
        current.map((w) => (w.id === id ? { ...w, ...changes, updatedAt: new Date().toISOString() } : w)),
      );
      return true;
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    const { error: invokeError } = await invokeSecureFunction('manage-templates', {
      operation: 'delete',
      table: 'workflows',
      recordId: id,
    });
    if (invokeError) {
      setError(invokeError.message ?? 'Could not delete the workflow.');
      return false;
    }
    setWorkflows((current) => current.filter((w) => w.id !== id));
    return true;
  }, []);

  return { workflows, loading, error, refresh, create, save, remove };
}
