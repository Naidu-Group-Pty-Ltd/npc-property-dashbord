import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A primary KPI tile, in the `builder-portal-stat-card` treatment — the Builder
 * copy of the formula the other partner portals share.
 *
 * Display only. It renders the number it is handed and nothing else: it does
 * not fetch, count, derive or interpret. What a zero means is the caller's copy
 * to write.
 */
export interface BuilderPortalStatCardProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  /** An existing route. Omit for a non-navigating tile. */
  to?: string;
  className?: string;
}

export function BuilderPortalStatCard({
  icon: Icon, label, value, to, className,
}: BuilderPortalStatCardProps) {
  const body = (
    <CardContent className="flex items-center gap-3 pt-6">
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10"
        aria-hidden
      >
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </CardContent>
  );

  const rail = (
    <div
      className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/30 to-transparent"
      aria-hidden
    />
  );

  if (!to) {
    return (
      <Card className={cn('builder-portal-stat-card', className)}>
        {rail}
        {body}
      </Card>
    );
  }

  return (
    <Card className={cn('builder-portal-stat-card focus-within:ring-2 focus-within:ring-ring', className)}>
      {rail}
      <Link to={to} className="block rounded-2xl focus:outline-none">{body}</Link>
    </Card>
  );
}
