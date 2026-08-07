import { useCallback, useEffect, useState } from 'react';
import { Download, FileSignature, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { invokeSecureFunction } from '@/lib/secureInvoke';

/**
 * Executed Partner Portal Agreements, in the Command Centre.
 *
 * The same panel serves the Solicitor, Builder/Developer and Finance tabs —
 * one agreement, one record of it, one place it is read. Three copies of this
 * table would be three definitions of "who has signed".
 *
 * The audit detail lives here and only here. A partner sees the agreement they
 * accepted; the Command Centre additionally sees who accepted it, when, against
 * which version and hash, and which acknowledgments were asserted — and can
 * supply the executed copy to the partner on request.
 *
 * The copy itself is produced on first download and then kept, so a record that
 * predates this panel still has one, and a partner and the operator hold the
 * same bytes.
 */

/**
 * Whether this acceptance has a copy, and whether it is the current one.
 *
 * Computed by the function, never here: which stored copies are current is a
 * property of the document template, and the template lives on that side. A
 * second copy of the rule in this file would be a second thing to remember.
 */
type CopyState = 'missing' | 'superseded' | 'current';

interface AgreementRecord {
  acceptance_id: string;
  portal: string;
  accepted_at: string;
  acknowledgements: string[] | null;
  agreement_storage_path: string | null;
  agreement_generated_at: string | null;
  copy_state?: CopyState;
  version: string;
  title: string;
  document_hash: string | null;
  accepted_by_name: string | null;
  accepted_by_email: string | null;
  organisation_name: string | null;
  organisation_trading_name: string | null;
}

const formatAccepted = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

export function PartnerAgreementsPanel({
  portal,
  partnerNoun,
}: {
  portal: 'solicitor' | 'builder' | 'finance';
  /** What this portal calls its partner organisations, for the empty state. */
  partnerNoun: string;
}) {
  const [records, setRecords] = useState<AgreementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await invokeSecureFunction('partner-agreement-records', {
      operation: 'list_records',
      portal,
    });
    if (error || !data?.success) {
      toast.error((data as any)?.error || error?.message || 'Could not load the executed agreements');
      setRecords([]);
    } else {
      setRecords((data.records ?? []) as AgreementRecord[]);
    }
    setLoading(false);
  }, [portal]);

  useEffect(() => { void load(); }, [load]);

  // A copy produced by an earlier revision of the document counts as pending:
  // two partners asking on the same day should receive the same document. The
  // fallback covers a browser talking to a function deployed before
  // `copy_state` existed.
  const copyState = (record: AgreementRecord): CopyState =>
    record.copy_state ?? (record.agreement_storage_path ? 'current' : 'missing');
  const missingCopies = records.filter((record) => copyState(record) !== 'current').length;

  const saveMissing = async () => {
    setSaving(true);
    try {
      const { data, error } = await invokeSecureFunction('partner-agreement-records', {
        operation: 'save_missing_copies',
        portal,
      });
      if (error || !data?.success) {
        throw new Error((data as any)?.error || error?.message || 'The copies could not be saved');
      }
      const failed = (data.failed ?? []) as { acceptance_id: string; error: string }[];
      if (failed.length) {
        // Named, not counted: an operator needs to know which record and why.
        toast.warning(`Saved ${data.saved}. ${failed.length} could not be produced: ${failed[0].error}`);
      } else {
        toast.success(`Saved ${data.saved} executed ${data.saved === 1 ? 'agreement' : 'agreements'}.`);
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'The copies could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const download = async (record: AgreementRecord) => {
    setDownloading(record.acceptance_id);
    try {
      const { data, error } = await invokeSecureFunction('partner-agreement-records', {
        operation: 'download_record',
        acceptance_id: record.acceptance_id,
      });
      if (error || !data?.success || !data?.url) {
        throw new Error((data as any)?.error || error?.message || 'The copy could not be produced');
      }
      // A signed URL with a short life; opened rather than fetched so the
      // browser handles the download and nothing is held in memory here.
      window.open(data.url as string, '_blank', 'noopener,noreferrer');
      // A download that had to produce or re-issue the copy changed the row.
      if (copyState(record) !== 'current') void load();
    } catch (e: any) {
      toast.error(e?.message || 'The copy could not be produced');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="h-4 w-4 text-primary" aria-hidden />
            Executed agreements
          </CardTitle>
          <CardDescription>
            The Terms &amp; Privileged Data Consent each partner organisation has accepted, with the
            acceptance detail held for audit. Download the executed copy to supply it on request.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* "Saved" should not depend on somebody having clicked Download.
              This produces and stores the copy for every executed agreement
              that has not got a current one — no copy at all, or one produced
              before the document was last revised. */}
          {missingCopies > 0 ? (
            <Button variant="default" size="sm" onClick={() => void saveMissing()} disabled={saving} className="gap-2">
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…</>
                : <><FileSignature className="h-4 w-4" aria-hidden /> Save {missingCopies} {missingCopies === 1 ? 'copy' : 'copies'}</>}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            <span className="sr-only">Loading executed agreements…</span>
            <Skeleton className="h-10 w-full" aria-hidden />
            <Skeleton className="h-10 w-full" aria-hidden />
            <Skeleton className="h-10 w-2/3" aria-hidden />
          </div>
        ) : records.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No {partnerNoun} has executed the agreement yet. A record appears here the moment one is
            accepted in the portal.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner organisation</TableHead>
                  <TableHead>Accepted by</TableHead>
                  <TableHead>Accepted</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Copy</TableHead>
                  <TableHead>Acknowledgments</TableHead>
                  <TableHead className="text-right">Executed copy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.acceptance_id}>
                    <TableCell className="font-medium">
                      {record.organisation_name || 'Not recorded'}
                      {record.organisation_trading_name
                        && record.organisation_trading_name !== record.organisation_name ? (
                        <div className="text-xs text-muted-foreground">
                          Trading as {record.organisation_trading_name}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {record.accepted_by_name || 'Not recorded'}
                      {record.accepted_by_email ? (
                        <div className="text-xs text-muted-foreground">{record.accepted_by_email}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatAccepted(record.accepted_at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {record.version}
                      {record.document_hash ? (
                        <div className="font-mono text-xs text-muted-foreground">
                          {record.document_hash.slice(0, 12)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {copyState(record) === 'current' ? (
                        <Badge variant="outline" className="gap-1 text-success">
                          <FileSignature className="h-3 w-3" aria-hidden /> Saved
                        </Badge>
                      ) : copyState(record) === 'superseded' ? (
                        // Not an error, and not "missing" either: there is a
                        // copy, it was produced by an earlier version of the
                        // document, and downloading re-issues it.
                        <span className="text-xs text-muted-foreground">Earlier format</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not saved yet</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {record.acknowledgements?.length ? (
                        <Badge variant="outline" className="gap-1">
                          <ShieldCheck className="h-3 w-3" aria-hidden />
                          {record.acknowledgements.length} asserted
                        </Badge>
                      ) : (
                        // Acceptances taken before acknowledgments were recorded
                        // say so, rather than implying none were required.
                        <span className="text-xs text-muted-foreground">Not recorded</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant={copyState(record) === 'current' ? 'outline' : 'default'}
                        size="sm"
                        className="gap-2"
                        disabled={downloading === record.acceptance_id}
                        onClick={() => void download(record)}
                      >
                        {downloading === record.acceptance_id ? (
                          <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Preparing…</>
                        ) : (
                          <><Download className="h-4 w-4" aria-hidden />
                            {copyState(record) === 'current' ? 'Download' : 'Generate & download'}</>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
