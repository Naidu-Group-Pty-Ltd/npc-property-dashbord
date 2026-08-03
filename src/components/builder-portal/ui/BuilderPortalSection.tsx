import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A titled block of a Builder page: an icon-led heading, an optional
 * explanation, an optional action, and the content.
 *
 * Display only, and deliberately one card deep — the pattern it replaces was a
 * card wrapping a card, which doubled every border and padding.
 */
export interface BuilderPortalSectionProps {
  title: string;
  icon?: LucideIcon;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function BuilderPortalSection({
  title, icon: Icon, description, action, children, className, contentClassName,
}: BuilderPortalSectionProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-col items-start justify-between gap-3 space-y-0 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            {Icon ? <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
            <span className="truncate">{title}</span>
          </CardTitle>
          {description ? (
            <CardDescription className="mt-1 leading-relaxed">{description}</CardDescription>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className={cn(contentClassName)}>{children}</CardContent>
    </Card>
  );
}
