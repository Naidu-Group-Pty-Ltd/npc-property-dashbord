import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared AML metric tile.
 *
 * Replaces seven near-identical local implementations (MetricTile, Tile,
 * KpiCard ×3, SummaryTile, SummaryTiles — audit §2.30) with one card that
 * makes its data state explicit. The states matter operationally:
 *
 *  - `loading`      the request is still in flight (skeleton);
 *  - `ready`        a real value, including a real zero;
 *  - `unavailable`  the request finished without a value (API failure or
 *                   the environment has no data source) — never rendered
 *                   as "0" or an ambiguous dash.
 *
 * Permission-restricted metrics are handled by NOT rendering the card at
 * all (tipping-off protection, AGENTS.md) — there is deliberately no
 * "restricted" placeholder state.
 */
export interface AmlMetricCardProps {
  title: string;
  icon?: LucideIcon;
  state: "loading" | "ready" | "unavailable";
  value?: number | string | null;
  /** One-line qualifier under the value ("3 critical", "Rule engine backlog"). */
  hint?: string;
  /** Hint shown in the unavailable state instead of `hint`. */
  unavailableHint?: string;
  /** Deep link to the surface where this number is worked. */
  to?: string;
  className?: string;
}

export function AmlMetricCard({
  title,
  icon: Icon,
  state,
  value,
  hint,
  unavailableHint = "Not available right now. Refresh to try again.",
  to,
  className,
}: AmlMetricCardProps) {
  const body = (
    <Card
      className={cn(
        "h-full",
        to && "transition-colors hover:border-primary/40",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        {Icon && <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        {state === "loading" ? (
          <>
            <Skeleton className="h-8 w-16" aria-hidden="true" />
            <span className="sr-only">Loading {title}</span>
          </>
        ) : state === "unavailable" ? (
          <div className="text-sm font-medium text-muted-foreground">Not available</div>
        ) : (
          <div className="text-3xl font-semibold tabular-nums">{value ?? 0}</div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {state === "unavailable" ? unavailableHint : hint}
        </p>
      </CardContent>
    </Card>
  );

  if (!to) return body;
  return (
    <Link
      to={to}
      className="block h-full rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      aria-label={
        state === "ready"
          ? `${title}: ${value ?? 0}. Open the matching queue.`
          : `${title}. Open the matching queue.`
      }
    >
      {body}
    </Link>
  );
}
