import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Loader2 } from "lucide-react";
import { amlFinanceApi, type AmlLimitedStatus } from "@/lib/aml/amlFinanceApi";

const STATUS_TONE: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  draft: "bg-muted text-muted-foreground",
  kyc_in_progress: "bg-primary/15 text-primary",
  kyc_complete: "bg-primary/15 text-primary",
  edd_required: "bg-warning/15 text-warning",
  under_review: "bg-warning/15 text-warning",
  escalated_mlro: "bg-destructive/15 text-destructive",
  cleared: "bg-success/15 text-success",
  blocked: "bg-destructive text-destructive-foreground",
  closed: "bg-muted text-muted-foreground",
};
const RATING_TONE: Record<string, string> = {
  low: "bg-success/15 text-success",
  medium: "bg-warning/15 text-warning",
  high: "bg-destructive/15 text-destructive",
  prohibited: "bg-destructive text-destructive-foreground",
};

/**
 * Phase 7 — Finance-portal-side AML status pill.
 * Purposefully limited: no case detail, no PII, no discrepancy text.
 * Only shows overall status + risk rating + open-count so brokers know when
 * to nudge compliance without gaining visibility into restricted material.
 */
interface Props {
  purchaseFileId?: string;
  clientId?: string;
}

export function LimitedAmlStatusCard({ purchaseFileId, clientId }: Props) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AmlLimitedStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!purchaseFileId && !clientId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const s = await amlFinanceApi.limitedStatus({ purchase_file_id: purchaseFileId, client_id: clientId });
        if (!cancelled) setStatus(s);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unable to load AML status");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [purchaseFileId, clientId]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm">AML/CTF Status</CardTitle>
              <CardDescription className="text-xs">Limited view — compliance team owns the case</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="text-xs text-muted-foreground">Status unavailable</div>
        ) : status ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={STATUS_TONE[status.status] ?? "bg-muted text-muted-foreground"}>
              {status.status.replace(/_/g, " ")}
            </Badge>
            {status.risk_rating && (
              <Badge className={RATING_TONE[status.risk_rating] ?? "bg-muted text-muted-foreground"}>
                Risk: {status.risk_rating}
              </Badge>
            )}
            {typeof status.open_finance_discrepancies === "number" && status.open_finance_discrepancies > 0 && (
              <Badge variant="outline" className="border-warning/40 text-warning">
                {status.open_finance_discrepancies} open discrepancies
              </Badge>
            )}
            {status.updated_at && (
              <span className="text-[11px] text-muted-foreground">
                Updated {new Date(status.updated_at).toLocaleDateString()}
              </span>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No AML case on file</div>
        )}
      </CardContent>
    </Card>
  );
}
