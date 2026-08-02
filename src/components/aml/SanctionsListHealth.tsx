import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, RefreshCw, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { amlVerificationApi, type AmlSanctionsSync } from "@/lib/aml/amlVerificationApi";

/**
 * Sanctions list freshness.
 *
 * Screening against an empty or stale list returns "clear" for everybody, and
 * looks exactly like screening that worked. That failure is silent everywhere
 * else in the product, so it is surfaced here rather than left to a script an
 * operator has to remember to run.
 */

/** A list older than this is not a current list. Mirrors scripts/aml/kyc-preflight.mjs. */
const STALE_DAYS = 7;

const LISTS: Array<{ code: string; label: string; note: string }> = [
  { code: "dfat", label: "DFAT Consolidated List", note: "Australia — legally operative" },
  { code: "un", label: "UN Consolidated List", note: "United Nations Security Council" },
  { code: "ofac", label: "OFAC SDN", note: "United States Treasury" },
];

type Health = "current" | "stale" | "failed" | "never";

function healthOf(sync: AmlSanctionsSync | undefined): { state: Health; ageDays: number | null } {
  if (!sync) return { state: "never", ageDays: null };
  if (sync.status === "failed") return { state: "failed", ageDays: null };
  const stamp = sync.completed_at ?? sync.started_at;
  const ageDays = (Date.now() - new Date(stamp).getTime()) / 86_400_000;
  return { state: ageDays > STALE_DAYS ? "stale" : "current", ageDays };
}

const PRESENTATION: Record<Health, { tone: string; label: string; Icon: typeof CheckCircle2 }> = {
  current: { tone: "bg-success/15 text-success", label: "Current", Icon: CheckCircle2 },
  stale: { tone: "bg-warning/15 text-warning", label: "Stale", Icon: AlertTriangle },
  failed: { tone: "bg-destructive/15 text-destructive", label: "Last sync failed", Icon: XCircle },
  never: { tone: "bg-destructive/15 text-destructive", label: "Never loaded", Icon: XCircle },
};

export function SanctionsListHealth() {
  const [syncs, setSyncs] = useState<AmlSanctionsSync[] | null>(null);
  const [entryCount, setEntryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await amlVerificationApi.sanctionsListStatus();
      setSyncs(res.syncs);
      setEntryCount(res.entry_count);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unable to load sanctions list status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Most recent successful sync per list.
  const latestFor = (code: string) =>
    (syncs ?? [])
      .filter((s) => s.list_code === code && s.status === "succeeded")
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0]
    ?? (syncs ?? []).filter((s) => s.list_code === code)
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" aria-hidden="true" />
            Sanctions list health
          </CardTitle>
          <CardDescription>
            Screening runs against our own copy of the official lists. An empty or stale
            list returns &ldquo;clear&rdquo; for every party and looks identical to a
            screen that worked.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={load}
          disabled={loading}
          aria-label="Refresh sanctions list status"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && !syncs && <Skeleton className="h-32 w-full" />}

        {!loading && entryCount === 0 && !error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              No sanctions entries are loaded. Screening cannot match anyone until the lists
              are loaded — run <code className="font-mono text-xs">npm run aml:sanctions:load</code>.
            </AlertDescription>
          </Alert>
        )}

        {syncs && (
          <>
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{entryCount.toLocaleString()}</span> entries held across all lists
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>List</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Last loaded</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {LISTS.map(({ code, label, note }) => {
                  const sync = latestFor(code);
                  const { state, ageDays } = healthOf(sync);
                  const { tone, label: stateLabel, Icon } = PRESENTATION[state];
                  return (
                    <TableRow key={code}>
                      <TableCell>
                        <div className="font-medium">{label}</div>
                        <div className="text-xs text-muted-foreground">{note}</div>
                      </TableCell>
                      <TableCell>{sync?.status === "succeeded" ? sync.entry_count.toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {sync
                          ? `${new Date(sync.completed_at ?? sync.started_at).toLocaleDateString()}${
                              ageDays != null ? ` (${Math.floor(ageDays)}d ago)` : ""}`
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${tone}`}>
                          <Icon className="h-3 w-3" aria-hidden="true" /> {stateLabel}
                        </span>
                        {state === "failed" && sync?.error_detail && (
                          <div className="text-xs text-muted-foreground mt-1 max-w-xs truncate" title={sync.error_detail}>
                            {sync.error_detail}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <p className="text-xs text-muted-foreground">
              Lists refresh nightly via the <code className="font-mono">AML sanctions refresh</code> workflow.
              Anything older than {STALE_DAYS} days is flagged stale.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
