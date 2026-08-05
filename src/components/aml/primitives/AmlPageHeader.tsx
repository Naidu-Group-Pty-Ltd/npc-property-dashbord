import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared AML page header.
 *
 * Before this existed the module carried four competing header shapes
 * (h1+icon, icon-chip+h2, title-inside-a-Card, and no header at all — see
 * docs/aml/ui-ux-audit.md §2.29). Every Command Center AML page now renders
 * this one shape so the title tier, description tone and action placement
 * read identically across the module.
 *
 * The AML shell (`AmlLayout`) owns the page's single `h1`, so pages default
 * to `h2`. The two admin surfaces that render outside the shell
 * (Integration Health) pass `headingLevel="h1"` to keep the document
 * outline correct.
 */
export interface AmlPageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Right-aligned action cluster — refresh, primary CTAs. */
  actions?: ReactNode;
  /** Optional context row under the title: badges, filters summary, stats. */
  children?: ReactNode;
  headingLevel?: "h1" | "h2";
  className?: string;
}

export function AmlPageHeader({
  title,
  description,
  icon: Icon,
  actions,
  children,
  headingLevel = "h2",
  className,
}: AmlPageHeaderProps) {
  const Heading = headingLevel;
  return (
    <header className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {Icon && (
            <div
              aria-hidden="true"
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <Heading className="text-xl font-semibold tracking-tight sm:text-2xl">
              {title}
            </Heading>
            {description && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </header>
  );
}
