/**
 * Aurixa primitives — shared design-system barrel.
 *
 * Phase 1 introduces GlassCard, SectionEmptyState, BreadcrumbRail, and
 * re-exports the existing Aurixa primitives from the agent surface. Phases
 * 2–7 will register MetricTile, KpiRow, AuroraHero, TimelineRail,
 * KanbanColumn, GlassModal, Stepper, DetailDrawer, and ToolCallCard here.
 *
 * Consumers should always import from `@/components/aurixa` so we can
 * refactor internals without touching call sites.
 */
export { GlassCard } from './GlassCard';
export type { GlassCardProps, GlassCardElevation } from './GlassCard';

export { SectionEmptyState } from './SectionEmptyState';
export type { SectionEmptyStateProps, SectionEmptyStateAction } from './SectionEmptyState';

export { BreadcrumbRail } from './BreadcrumbRail';
export type { BreadcrumbRailProps } from './BreadcrumbRail';

export { AuroraHero } from './AuroraHero';
export type { AuroraHeroProps } from './AuroraHero';

export { MetricTile } from './MetricTile';
export type { MetricTileProps, MetricTileTone, MetricTileDelta } from './MetricTile';

export { KpiRow } from './KpiRow';
export type { KpiRowProps } from './KpiRow';

export { DataTableToolbar } from './DataTableToolbar';
export type { DataTableToolbarProps, TableDensity } from './DataTableToolbar';

export { BulkActionBar } from './BulkActionBar';
export type { BulkActionBarProps } from './BulkActionBar';


// Re-export existing Aurixa primitives so consumers have one import path.
export { AurixaMark } from '@/components/agent/AurixaMark';
export { AurixaSectionHeader } from '@/components/agent/AurixaSectionHeader';
export { StatusPill } from '@/components/agent/StatusPill';
