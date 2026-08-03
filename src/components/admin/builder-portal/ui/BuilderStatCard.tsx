import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * A single Builder Portal summary metric.
 *
 * Display-only: every value is computed by the caller from data it has already
 * loaded. This component performs no fetching and holds no state.
 */
export interface BuilderStatCardProps {
  label: string;
  value: string | number;
  hint: string;
  icon: LucideIcon;
}

export function BuilderStatCard({ label, value, hint, icon: Icon }: BuilderStatCardProps) {
  return (
    <Card className="h-full transition-colors hover:border-primary/40">
      <CardContent className="flex h-full items-start gap-3 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-2xl font-semibold leading-none tracking-tight tabular-nums">{value}</p>
          <p className="text-sm font-medium leading-tight">{label}</p>
          <p className="text-xs leading-tight text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}
