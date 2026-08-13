import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * A status pill for the Builder Portal tables.
 *
 * Two shapes, both display-only:
 *
 *  - `tone: 'destructive'` renders the solid destructive badge, reserved for
 *    the states that mean no portal access at all.
 *  - every other state renders an outline pill carrying a solid token-coloured
 *    dot. The label is always spelled out, so the dot is a second signal rather
 *    than the only one, and the text keeps full foreground contrast in both the
 *    light and the dark theme.
 */
export interface BuilderStatusBadgeProps {
  label: string;
  /** Tailwind background utility for the dot, e.g. `bg-success`. */
  dot?: string;
  tone?: 'destructive';
  className?: string;
}

export function BuilderStatusBadge({ label, dot, tone, className }: BuilderStatusBadgeProps) {
  if (tone === 'destructive') {
    return <Badge variant="destructive" className={cn('whitespace-nowrap', className)}>{label}</Badge>;
  }

  return (
    <Badge variant="outline" className={cn('gap-1.5 whitespace-nowrap font-medium', className)}>
      {dot ? <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} aria-hidden /> : null}
      {label}
    </Badge>
  );
}
