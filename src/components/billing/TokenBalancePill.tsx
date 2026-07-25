import { useNavigate } from "react-router-dom";
import { Coins, ExternalLink, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import {
  AURIXA_PRICING_URL,
  openMissionControlWithAttribution,
} from "@/lib/missionControl";

interface TokenBalancePillProps {
  /** Compact icon-only trigger for mobile/narrow headers. */
  compact?: boolean;
}

function formatCompact(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function TokenBalancePill({ compact = false }: TokenBalancePillProps) {
  const navigate = useNavigate();
  const { balance, loading, error, refresh, lowBalance, criticalBalance } = useTokenBalance();

  const available = balance?.available ?? 0;
  const allowance = balance?.allowance ?? 0;
  const used = balance?.used ?? 0;
  const reserved = balance?.reserved ?? 0;

  const pct = allowance > 0 ? Math.max(0, Math.min(100, (available / allowance) * 100)) : 0;
  const critical = criticalBalance;

  const stateClass = critical
    ? "text-destructive border-destructive/40 bg-destructive/10"
    : lowBalance
    ? "text-warning border-warning/40 bg-warning/10"
    : "text-foreground border-border bg-muted/40 hover:bg-muted";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "dashboard-input-control h-10 gap-2 rounded-xl border px-3 font-medium transition-colors",
            stateClass,
            compact && "h-11 w-11 px-0",
          )}
          aria-label={
            balance ? `Tokens remaining: ${available.toLocaleString()}` : "Token balance unavailable"
          }
          title={
            balance ? `Tokens remaining: ${available.toLocaleString()}` : "Token balance unavailable"
          }
        >
          <Coins className="h-4 w-4 shrink-0" />
          {!compact && (
            <span className="text-sm tabular-nums">
              {loading && !balance ? (
                <Skeleton className="inline-block h-4 w-12 align-middle" />
              ) : error || !balance ? (
                // No data ≠ zero balance: a failed/blocked fetch must never
                // render as "0", which reads as an empty account.
                "—"
              ) : (
                formatCompact(available)
              )}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Report tokens
              </p>
              <p className="text-2xl font-semibold tabular-nums">
                {loading && !balance ? (
                  <Skeleton className="h-7 w-24" />
                ) : !balance ? (
                  "—"
                ) : (
                  available.toLocaleString()
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {!balance
                  ? "Balance unavailable"
                  : balance.exempt
                  ? "Unmetered · billing exempt"
                  : allowance > 0
                  ? `of ${allowance.toLocaleString()} allowance${balance.planName ? ` · ${balance.planName}` : ""}`
                  : "Top-up credits · no plan allowance"}
              </p>
            </div>
            <Coins
              className={cn(
                "h-8 w-8",
                critical ? "text-destructive" : lowBalance ? "text-warning" : "text-primary",
              )}
            />
          </div>

          {allowance > 0 && (
            <div className="mt-3">
              <Progress
                value={pct}
                className={cn(
                  "h-2",
                  critical && "[&>div]:bg-destructive",
                  !critical && lowBalance && "[&>div]:bg-warning",
                )}
              />
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{pct.toFixed(0)}% remaining</span>
                {balance?.currentPeriodEnd && (
                  <span>
                    Resets {new Date(balance.currentPeriodEnd).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-px bg-border text-center text-xs">
          <div className="bg-popover px-3 py-2">
            <p className="text-muted-foreground">Used</p>
            <p className="font-semibold tabular-nums">{used.toLocaleString()}</p>
          </div>
          <div className="bg-popover px-3 py-2">
            <p className="text-muted-foreground">Reserved</p>
            <p className="font-semibold tabular-nums">{reserved.toLocaleString()}</p>
          </div>
        </div>

        {error && (
          <div className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
            Failed to load balance.{" "}
            <button onClick={refresh} className="underline">
              Retry
            </button>
          </div>
        )}

        {(critical || lowBalance) && (
          <div
            className={cn(
              "border-t border-border px-4 py-2 text-xs",
              critical ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning",
            )}
          >
            {critical
              ? "Critical: top up now to avoid blocked report generation."
              : "Low balance — consider topping up soon."}
          </div>
        )}

        <div className="flex flex-col gap-1 border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => navigate("/billing/usage")}
          >
            <TrendingUp className="mr-2 h-4 w-4" />
            View usage history
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() =>
              void openMissionControlWithAttribution("topup", AURIXA_PRICING_URL)
            }
          >
            <Coins className="mr-2 h-4 w-4" />
            Top up credits
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() =>
              void openMissionControlWithAttribution("seat_plan", AURIXA_PRICING_URL)
            }
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Manage billing plan
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
