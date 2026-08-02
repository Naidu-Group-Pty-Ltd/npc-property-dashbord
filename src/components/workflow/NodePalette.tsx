/**
 * The step library.
 *
 * Two things make this usable at 242 entries: search covers the integration id
 * and hand-written keywords as well as the name, and every row states whether
 * its credentials are in place — so you find out an integration is unconfigured
 * while choosing it, not after wiring it up.
 */

import { useMemo, useState } from 'react';
import { KeyRound, Search, Zap } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { CATALOG, searchCatalog } from '@/lib/workflow/catalog';
import type { CatalogNode, NodeCategoryId } from '@/lib/workflow/types';
import { CATEGORY_LABELS, accentClass } from './nodeAccents';
import { NodeGlyph } from './nodeVisuals';

interface NodePaletteProps {
  configuredIntegrations: Set<string>;
  credentialsLoaded: boolean;
  /** Adds the step at a sensible spot — used for click-to-add. */
  onAddNode: (catalogId: string) => void;
  /** True once the canvas has a trigger, which changes what we suggest first. */
  hasTrigger: boolean;
}

type KindFilter = 'all' | 'trigger' | 'action' | 'logic';

const KIND_TABS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'trigger', label: 'Triggers' },
  { value: 'action', label: 'Actions' },
  { value: 'logic', label: 'Logic' },
];

/** Categories in the order they appear, with the platform's own events first. */
const CATEGORY_ORDER: NodeCategoryId[] = [
  'platform',
  'logic',
  'property_data',
  'ai',
  'crm_marketing',
  'communications',
  'documents',
  'compliance',
  'payments',
  'analytics',
  'productivity',
  'storage',
  'media',
  'automation',
  'infrastructure',
];

export function NodePalette({
  configuredIntegrations,
  credentialsLoaded,
  onAddNode,
  hasTrigger,
}: NodePaletteProps) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');

  // With no trigger yet, triggers are the only useful next step, so lead with them.
  const effectiveKind: KindFilter = kind === 'all' && !hasTrigger && !query ? 'trigger' : kind;

  const grouped = useMemo(() => {
    const matches = searchCatalog({
      query,
      kind: effectiveKind === 'all' ? undefined : effectiveKind,
    });

    const byCategory = new Map<NodeCategoryId, CatalogNode[]>();
    for (const node of matches) {
      const list = byCategory.get(node.category as NodeCategoryId) ?? [];
      list.push(node);
      byCategory.set(node.category as NodeCategoryId, list);
    }

    return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
      category,
      nodes: (byCategory.get(category) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [effectiveKind, query]);

  const total = grouped.reduce((sum, g) => sum + g.nodes.length, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border/60 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Step library</h2>
          <span className="text-xs tabular-nums text-muted-foreground">{CATALOG.length} steps</span>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search steps, apps or keywords"
            aria-label="Search the step library"
            className="pl-8"
          />
        </div>

        <Tabs value={effectiveKind} onValueChange={(value) => setKind(value as KindFilter)}>
          <TabsList className="grid w-full grid-cols-4">
            {KIND_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {!hasTrigger && !query && (
          <p className="flex items-start gap-1.5 rounded-md border border-primary/25 bg-primary/5 p-2 text-xs text-muted-foreground">
            <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            Start with a trigger — it decides when the workflow runs.
          </p>
        )}
      </div>

      <ScrollArea className="wf-scroll flex-1">
        <div className="space-y-4 p-3">
          {total === 0 && (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-foreground">No steps match “{query}”.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try an app name such as Stripe, or a task such as “send email”.
              </p>
            </div>
          )}

          {grouped.map(({ category, nodes }) => (
            <section key={category} aria-labelledby={`palette-${category}`}>
              <h3
                id={`palette-${category}`}
                className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {CATEGORY_LABELS[category]}
              </h3>
              <ul className="space-y-0.5">
                {nodes.map((node) => (
                  <PaletteRow
                    key={node.id}
                    node={node}
                    needsCredential={
                      credentialsLoaded &&
                      Boolean(node.integrationId) &&
                      !configuredIntegrations.has(node.integrationId as string)
                    }
                    onAdd={() => onAddNode(node.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

interface PaletteRowProps {
  node: CatalogNode;
  needsCredential: boolean;
  onAdd: () => void;
}

function PaletteRow({ node, needsCredential, onAdd }: PaletteRowProps) {
  const [dragging, setDragging] = useState(false);

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        draggable
        data-dragging={dragging}
        aria-label={`Add ${node.name}. ${node.summary}`}
        className={cn(
          'wf-palette-item flex w-full cursor-grab items-start gap-2.5 p-2 text-left active:cursor-grabbing',
          accentClass(node.category),
        )}
        onClick={onAdd}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onAdd();
          }
        }}
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-workflow-node', node.id);
          event.dataTransfer.effectAllowed = 'copy';
          setDragging(true);
        }}
        onDragEnd={() => setDragging(false)}
      >
        <span className="wf-node-icon !h-7 !w-7 shrink-0">
          <NodeGlyph node={node} size={15} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[13px] font-medium leading-tight text-foreground">{node.name}</span>
            {node.kind === 'trigger' && (
              <span className="wf-chip shrink-0 rounded px-1 text-[9px] font-semibold uppercase tracking-wide">
                Trigger
              </span>
            )}
            {needsCredential && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 text-warning" aria-label="Needs credentials">
                    <KeyRound className="h-3 w-3" aria-hidden="true" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[14rem]">
                  You can add this step, but it needs credentials on the Integrations page before the workflow
                  can run.
                </TooltipContent>
              </Tooltip>
            )}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
            {node.summary}
          </span>
        </span>
      </div>
    </li>
  );
}
