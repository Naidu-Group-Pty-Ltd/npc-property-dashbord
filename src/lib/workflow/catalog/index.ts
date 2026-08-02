/**
 * The assembled node catalog.
 *
 * Every entry is either platform-native (triggers on this dashboard's own data,
 * plus control flow) or backed by an integration in `INTEGRATIONS`. The link is
 * what makes the canvas credential-aware: a node whose integration has no saved
 * key renders as unconfigured and blocks activation.
 */

import { INTEGRATIONS } from '@/lib/integrations/registry';
import type { CatalogNode } from '../types';
import { CORE_NODES } from './core';
import { INTELLIGENCE_NODES } from './intelligence';
import { PROPERTY_NODES } from './property';
import { ENGAGEMENT_NODES } from './engagement';
import { OPERATIONS_NODES } from './operations';

export const CATALOG: CatalogNode[] = [
  ...CORE_NODES,
  ...PROPERTY_NODES,
  ...INTELLIGENCE_NODES,
  ...ENGAGEMENT_NODES,
  ...OPERATIONS_NODES,
];

const BY_ID = new Map(CATALOG.map((node) => [node.id, node]));

/** Own-property lookup — ids reach this from saved graphs and user input. */
export function getCatalogNode(id: string): CatalogNode | undefined {
  return BY_ID.get(id);
}

export const TRIGGERS = CATALOG.filter((n) => n.kind === 'trigger');
export const ACTIONS = CATALOG.filter((n) => n.kind === 'action');
export const LOGIC = CATALOG.filter((n) => n.kind === 'logic');

/** Integration ids that have at least one operation in the catalog. */
export const COVERED_INTEGRATIONS = new Set(
  CATALOG.map((n) => n.integrationId).filter((id): id is string => Boolean(id)),
);

/**
 * Integrations with no node yet. Surfaced in the palette as a short "not wired
 * up yet" list rather than hidden, so the gap is visible instead of silently
 * looking like the integration does not exist.
 */
export function uncoveredIntegrations() {
  return INTEGRATIONS.filter((i) => !COVERED_INTEGRATIONS.has(i.id));
}

/** Lowercased haystack for the palette's search box. */
export function nodeSearchIndex(node: CatalogNode): string {
  return [node.name, node.summary, node.category, node.integrationId ?? '', ...(node.keywords ?? [])]
    .join(' ')
    .toLowerCase();
}

export interface CatalogSearchOptions {
  query?: string;
  kind?: CatalogNode['kind'];
  category?: string;
}

export function searchCatalog({ query, kind, category }: CatalogSearchOptions): CatalogNode[] {
  const tokens = (query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return CATALOG.filter((node) => {
    if (kind && node.kind !== kind) return false;
    if (category && category !== 'all' && node.category !== category) return false;
    if (!tokens.length) return true;
    const haystack = nodeSearchIndex(node);
    return tokens.every((t) => haystack.includes(t));
  });
}

export { CORE_NODES, INTELLIGENCE_NODES, PROPERTY_NODES, ENGAGEMENT_NODES, OPERATIONS_NODES };
