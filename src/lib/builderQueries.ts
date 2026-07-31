import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeBuilderFunction } from '@/lib/builderPortal';
import type {
  BuilderProject, BuilderProjectParty, BuilderProjectStatusHistoryEntry,
} from '@/lib/builderProjects';
import type {
  BuilderAllocation, BuilderBuilding, BuilderLot, BuilderReservation, BuilderStage,
  BuilderUnit, BuilderUnitHistoryEntry, BuilderUnitHold, BuilderUnitPrice,
} from '@/lib/builderInventory';

/**
 * Builder Portal query layer. Mirrors `src/lib/solicitorQueries.ts`: query keys,
 * the single `invoke` wrapper that raises a typed error, and one hook per
 * surface. Every call goes through `invokeBuilderFunction`, which carries the
 * HttpOnly session cookie — the browser never reaches the database directly.
 */
export const builderKeys = {
  session: () => ['builder', 'session'] as const,
  projectsRoot: () => ['builder', 'projects'] as const,
  projects: (filters: ProjectFilters) => [...builderKeys.projectsRoot(), filters] as const,
  project: (projectId: string) => ['builder', 'project', projectId] as const,
  projectStats: () => ['builder', 'project-stats'] as const,
  unitsRoot: () => ['builder', 'units'] as const,
  units: (filters: UnitFilters) => [...builderKeys.unitsRoot(), filters] as const,
  unit: (unitId: string) => ['builder', 'unit', unitId] as const,
  inventoryStats: (projectId: string) => ['builder', 'inventory-stats', projectId] as const,
  stages: (projectId: string) => ['builder', 'stages', projectId] as const,
  buildings: (projectId: string) => ['builder', 'buildings', projectId] as const,
  lots: (projectId: string) => ['builder', 'lots', projectId] as const,
};

export interface ProjectFilters { search: string; status: string; page: number; pageSize: number }

export interface ProjectsPage {
  records: BuilderProject[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
}

export interface ProjectDetail {
  project: BuilderProject;
  developer_organisation: { id: string; legal_name: string; trading_name: string | null; org_type: string } | null;
  builder_organisation: { id: string; legal_name: string; trading_name: string | null; org_type: string } | null;
  development: { id: string; name: string; development_reference: string | null; status: string } | null;
  parties: BuilderProjectParty[];
  status_history: BuilderProjectStatusHistoryEntry[];
  permissions: Record<string, { view: boolean; edit: boolean; delete: boolean }>;
  access_role: string;
}

export class BuilderPortalRequestError extends Error {
  constructor(message: string, public code: string, public status?: number) { super(message); }
}

export function mapBuilderError(value: any) {
  const code = value?.data?.code || value?.code || 'PORTAL_REQUEST_FAILED';
  return new BuilderPortalRequestError(
    value?.data?.error || value?.message || 'The request could not be completed',
    code, value?.status);
}

/**
 * Retry policy for Builder queries.
 *
 * A 4xx is the server's answer, not a transient failure: retrying a withheld
 * project three times with backoff leaves the user watching a spinner for
 * several seconds before the "not available" state finally renders. Only
 * network and server-side failures are worth retrying.
 */
function retryBuilderQuery(failureCount: number, error: unknown): boolean {
  const status = (error as BuilderPortalRequestError)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) return false;
  return failureCount < 2;
}

async function invoke(
  functionName: string, payload: Record<string, unknown> = {}, signal?: AbortSignal,
) {
  const result = await invokeBuilderFunction(functionName, payload, { signal });
  if (result.error || (result.data as any)?.error) {
    throw mapBuilderError(result.error || { data: result.data });
  }
  return result.data;
}

export function useBuilderProjects(filters: ProjectFilters) {
  return useQuery({
    queryKey: builderKeys.projects(filters),
    queryFn: async ({ signal }) => await invoke('builder-portal-projects', {
      operation: 'list_projects',
      search: filters.search,
      status: filters.status,
      page: filters.page,
      page_size: filters.pageSize,
    }, signal) as ProjectsPage,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    retry: retryBuilderQuery,
  });
}

export function useBuilderProject(projectId: string) {
  return useQuery({
    queryKey: builderKeys.project(projectId),
    queryFn: ({ signal }) => invoke('builder-portal-projects', {
      operation: 'get_project', project_id: projectId,
    }, signal) as Promise<ProjectDetail>,
    enabled: Boolean(projectId),
    retry: retryBuilderQuery,
  });
}

export function useBuilderProjectStats() {
  return useQuery({
    queryKey: builderKeys.projectStats(),
    queryFn: ({ signal }) => invoke('builder-portal-projects', { operation: 'project_stats' }, signal),
    staleTime: 60_000,
    retry: retryBuilderQuery,
  });
}

/**
 * One mutation hook per project, mirroring `useMatterMutation`. The project id
 * is bound here rather than passed per call so a caller cannot accidentally
 * mutate a different project than the one on screen.
 */
export function useBuilderProjectMutation(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      invoke('builder-portal-projects', { ...payload, project_id: projectId }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: builderKeys.project(projectId) }),
        client.invalidateQueries({ queryKey: builderKeys.projectsRoot() }),
        client.invalidateQueries({ queryKey: builderKeys.projectStats() }),
      ]);
    },
  });
}

/* ────────────────────────────── INVENTORY ────────────────────────────── */

export interface UnitFilters {
  projectId: string;
  search: string;
  availabilityStatus: string;
  releaseStatus: string;
  page: number;
  pageSize: number;
}

export interface UnitsPage {
  records: BuilderUnit[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
}

export interface UnitDetail {
  unit: BuilderUnit;
  project: { id: string; name: string; project_reference: string | null };
  current_price: BuilderUnitPrice | null;
  status_history: BuilderUnitHistoryEntry[];
  holds: BuilderUnitHold[];
  reservations: BuilderReservation[];
  allocations: BuilderAllocation[];
  stage: BuilderStage | null;
  building: BuilderBuilding | null;
  lot: BuilderLot | null;
  permissions: Record<string, { view: boolean; edit: boolean; delete: boolean }>;
}

export interface InventoryStats {
  total: number;
  by_availability: Record<string, number>;
  by_release: Record<string, number>;
  released: number;
}

export function useBuilderUnits(filters: UnitFilters) {
  return useQuery({
    queryKey: builderKeys.units(filters),
    queryFn: async ({ signal }) => await invoke('builder-portal-inventory', {
      operation: 'list_units',
      project_id: filters.projectId || undefined,
      search: filters.search,
      availability_status: filters.availabilityStatus,
      release_status: filters.releaseStatus,
      page: filters.page,
      page_size: filters.pageSize,
    }, signal) as UnitsPage,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    retry: retryBuilderQuery,
  });
}

export function useBuilderUnit(unitId: string) {
  return useQuery({
    queryKey: builderKeys.unit(unitId),
    queryFn: ({ signal }) => invoke('builder-portal-inventory', {
      operation: 'get_unit', unit_id: unitId,
    }, signal) as Promise<UnitDetail>,
    enabled: Boolean(unitId),
    retry: retryBuilderQuery,
  });
}

export function useBuilderInventoryStats(projectId = '') {
  return useQuery({
    queryKey: builderKeys.inventoryStats(projectId),
    queryFn: ({ signal }) => invoke('builder-portal-inventory', {
      operation: 'inventory_stats', project_id: projectId || undefined,
    }, signal) as Promise<InventoryStats>,
    staleTime: 60_000,
    retry: retryBuilderQuery,
  });
}

export function useBuilderStages(projectId: string) {
  return useQuery({
    queryKey: builderKeys.stages(projectId),
    queryFn: async ({ signal }) => ((await invoke('builder-portal-inventory', {
      operation: 'list_stages', project_id: projectId,
    }, signal)) as { records: BuilderStage[] }).records,
    enabled: Boolean(projectId),
    retry: retryBuilderQuery,
  });
}

/**
 * One mutation hook per unit, mirroring `useBuilderProjectMutation`. The unit id
 * is bound here rather than passed per call so a caller cannot accidentally
 * mutate a different unit than the one on screen.
 */
export function useBuilderUnitMutation(unitId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      invoke('builder-portal-inventory', { ...payload, unit_id: unitId }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: builderKeys.unit(unitId) }),
        client.invalidateQueries({ queryKey: builderKeys.unitsRoot() }),
        client.invalidateQueries({ queryKey: ['builder', 'inventory-stats'] }),
      ]);
    },
  });
}
