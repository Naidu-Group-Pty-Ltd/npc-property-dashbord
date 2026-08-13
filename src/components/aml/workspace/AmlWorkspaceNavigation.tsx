/**
 * Two-level navigation: five operator areas, each holding the sections that
 * already existed.
 *
 * Before this the rail listed eleven sections under three headings, all at
 * the same weight, so choosing where to go meant reading eleven labels. Now
 * the first decision is one of five, and the sections inside an area appear
 * only once that area is open — progressive disclosure, not removal. Every
 * section is still reachable, still at the same `?section=` key, and still
 * mounts the same component.
 *
 * Attention marks are advisory: a dot next to an area means the ranked
 * reading found outstanding work there. It grants nothing and hides nothing.
 */
import type { LucideIcon } from "lucide-react";
import {
  ClipboardCheck, ClipboardList, FileText, Handshake, History, MailQuestion,
  Network, Radar, ScanSearch, Scale, Share2, User, Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AREA_LABELS,
  AREA_SECTIONS,
  WORKSPACE_AREAS,
  areaForSection,
  type AmlAttentionLevel,
  type AmlWorkspaceArea,
  type AmlWorkspaceSection,
} from "@/lib/aml/workspaceViewModel";

import { ATTENTION_TEXT } from "./attentionTone";
import { SECTION_LABELS } from "./workspaceLabels";

const AREA_ICONS: Record<AmlWorkspaceArea, LucideIcon> = {
  overview: ClipboardList,
  customer: User,
  transaction: Handshake,
  decision: Scale,
  records: History,
};

const SECTION_ICONS: Record<AmlWorkspaceSection, LucideIcon> = {
  overview: ClipboardList,
  identity: ScanSearch,
  ownership: Network,
  counterparty: Handshake,
  finance: Wallet,
  documents: FileText,
  "submission-review": ClipboardCheck,
  risk: Scale,
  requests: MailQuestion,
  passport: Share2,
  monitoring: Radar,
  timeline: History,
};

export interface AmlWorkspaceNavigationProps {
  section: AmlWorkspaceSection;
  onSelectSection: (section: AmlWorkspaceSection) => void;
  /** Sections the current role may not open are omitted entirely. */
  visibleSections: ReadonlySet<AmlWorkspaceSection>;
  /** Small counts, e.g. open client requests on Requests. */
  sectionBadges?: Partial<Record<AmlWorkspaceSection, number>>;
  /** Advisory attention marker per area. */
  areaAttention?: Partial<Record<AmlWorkspaceArea, AmlAttentionLevel>>;
  className?: string;
}

function AttentionDot({ level }: { level: AmlAttentionLevel }) {
  if (level !== "critical" && level !== "attention") return null;
  return (
    <span
      className={cn("ml-auto text-base leading-none", ATTENTION_TEXT[level])}
      aria-label={level === "critical" ? "needs urgent attention" : "needs attention"}
    >
      •
    </span>
  );
}

export function AmlWorkspaceNavigation({
  section,
  onSelectSection,
  visibleSections,
  sectionBadges = {},
  areaAttention = {},
  className,
}: AmlWorkspaceNavigationProps) {
  const activeArea = areaForSection(section);

  const areas = WORKSPACE_AREAS.map((area) => ({
    area,
    sections: AREA_SECTIONS[area].filter((s) => visibleSections.has(s)),
  })).filter((a) => a.sections.length > 0);

  const activeSections = areas.find((a) => a.area === activeArea)?.sections ?? [];

  return (
    <nav aria-label="Case areas" className={className}>
      {/* ── Small screens: a scrolling area rail, then a section rail. ── */}
      <div className="lg:hidden">
        <div
          role="tablist"
          aria-label="Case areas"
          aria-orientation="horizontal"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        >
          {areas.map(({ area, sections }) => {
            const Icon = AREA_ICONS[area];
            const active = area === activeArea;
            return (
              <button
                key={area}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectSection(sections[0])}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/70 text-muted-foreground hover:bg-accent",
                )}
              >
                <Icon aria-hidden className="h-3.5 w-3.5" />
                {AREA_LABELS[area]}
                {(areaAttention[area] === "critical" || areaAttention[area] === "attention") && (
                  <span
                    aria-hidden
                    className={cn("text-base leading-none", ATTENTION_TEXT[areaAttention[area]!])}
                  >
                    •
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {activeSections.length > 1 && (
          <div
            className="-mx-1 mt-1.5 flex gap-1 overflow-x-auto px-1 pb-1"
            role="tablist"
            aria-label={`${AREA_LABELS[activeArea]} sections`}
          >
            {activeSections.map((key) => {
              const active = key === section;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectSection(key)}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    active
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60",
                  )}
                >
                  {SECTION_LABELS[key]}
                  {sectionBadges[key] ? ` (${sectionBadges[key]})` : ""}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Desktop: a vertical rail; the open area shows its sections. ── */}
      <div className="hidden lg:block lg:sticky lg:top-4">
        <ul className="space-y-0.5">
          {areas.map(({ area, sections }) => {
            const Icon = AREA_ICONS[area];
            const active = area === activeArea;
            return (
              <li key={area}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  aria-expanded={sections.length > 1 ? active : undefined}
                  onClick={() => onSelectSection(active ? section : sections[0])}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    active
                      ? "bg-accent font-semibold text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon aria-hidden className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{AREA_LABELS[area]}</span>
                  <AttentionDot level={areaAttention[area] ?? "none"} />
                </button>

                {active && sections.length > 1 && (
                  <ul className="mb-1 ml-[1.4rem] mt-0.5 space-y-0.5 border-l border-border/60 pl-2">
                    {sections.map((key) => {
                      const SectionIcon = SECTION_ICONS[key];
                      const current = key === section;
                      const badge = sectionBadges[key];
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            aria-current={current ? "page" : undefined}
                            onClick={() => onSelectSection(key)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                              current
                                ? "font-medium text-primary"
                                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                            )}
                          >
                            <SectionIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 truncate">{SECTION_LABELS[key]}</span>
                            {badge ? (
                              <Badge
                                variant="secondary"
                                className="ml-auto h-4 shrink-0 px-1.5 text-[10px]"
                              >
                                {badge}
                              </Badge>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
