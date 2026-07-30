import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, FileSearch, Loader2, Sparkles, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { LegalMatterDocument } from '@/lib/legalDocuments';
import {
  ANALYSIS_STATUS_LABELS,
  analyseContract,
  deleteAnalysis,
  listContractAnalyses,
  riskFlagClasses,
  setAnalysisStatus,
  type ContractAnalysis,
} from '@/lib/solicitorIntelligence';

const NO_DOCUMENT = '__paste__';

/**
 * Contract intelligence for a single matter (Phase 7).
 *
 * Runs the AI contract analyser over pasted text or an uploaded matter document
 * and renders the structured result. Every analysis lands as a DRAFT — a
 * practitioner must explicitly confirm it before it counts as reviewed, and the
 * panel never writes extracted values back onto the matter automatically.
 */
export function ContractIntelligencePanel({
  matterId,
  documents,
  canEdit,
  canDelete,
}: {
  matterId: string;
  documents: LegalMatterDocument[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [analyses, setAnalyses] = useState<ContractAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [documentId, setDocumentId] = useState<string>(NO_DOCUMENT);
  const [contractText, setContractText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const analysableDocuments = useMemo(
    () => documents.filter((d) => d.storage_path),
    [documents],
  );

  const refresh = useCallback(async () => {
    const { data, error } = await listContractAnalyses(matterId);
    setLoading(false);
    if (error) return;
    setAnalyses((data?.records ?? []) as ContractAnalysis[]);
  }, [matterId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async () => {
    const useDoc = documentId !== NO_DOCUMENT;
    if (!useDoc && contractText.trim().length < 200) {
      toast.error('Paste at least a few paragraphs of the contract, or choose an uploaded document.');
      return;
    }
    setRunning(true);
    const { error } = await analyseContract({
      matterId,
      documentId: useDoc ? documentId : null,
      contractText: useDoc ? undefined : contractText.trim(),
      sourceLabel: useDoc ? null : 'Pasted contract text',
    });
    setRunning(false);
    if (error) { toast.error(error.message || 'The analyser could not process that contract'); return; }
    toast.success('Draft analysis ready for your review');
    setDialogOpen(false);
    setContractText('');
    setDocumentId(NO_DOCUMENT);
    await refresh();
  };

  const review = async (id: string, status: 'confirmed' | 'dismissed') => {
    setBusyId(id);
    const { error } = await setAnalysisStatus(id, status);
    setBusyId(null);
    if (error) { toast.error(error.message || 'Could not update that analysis'); return; }
    toast.success(status === 'confirmed' ? 'Analysis confirmed' : 'Analysis dismissed');
    await refresh();
  };

  const remove = async (id: string) => {
    setBusyId(id);
    const { error } = await deleteAnalysis(id);
    setBusyId(null);
    if (error) { toast.error(error.message || 'Could not delete that analysis'); return; }
    toast.success('Analysis deleted');
    await refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Contract intelligence
            </CardTitle>
            <CardDescription>
              A structured first-pass review of the contract of sale — summary, special conditions and
              risk flags. Always confirm against the executed document before you rely on it.
            </CardDescription>
          </div>
          {canEdit ? (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <FileSearch className="mr-2 h-4 w-4" aria-hidden /> Analyse contract
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : analyses.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center">
              <p className="text-sm font-medium text-foreground">No contract review yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload the contract to the Docs register or paste its text, then run an analysis to get a
                summary, special-conditions list and risk flags in seconds.
              </p>
              {canEdit ? (
                <Button size="sm" variant="outline" className="mt-4" onClick={() => setDialogOpen(true)}>
                  Analyse a contract
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              {analyses.map((a) => (
                <AnalysisCard
                  key={a.id}
                  analysis={a}
                  busy={busyId === a.id}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onReview={review}
                  onDelete={remove}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex h-[90vh] max-w-2xl flex-col">
          <DialogHeader>
            <DialogTitle>Analyse contract</DialogTitle>
            <DialogDescription>
              Choose an uploaded document or paste the contract text. The result is saved as a draft for
              your review — nothing is applied to the matter automatically.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="-mx-6 flex-1 px-6">
            <div className="space-y-4 py-1">
              <div className="space-y-2">
                <Label htmlFor="analysis-document">Matter document</Label>
                <Select value={documentId} onValueChange={setDocumentId}>
                  <SelectTrigger id="analysis-document">
                    <SelectValue placeholder="Paste text instead" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DOCUMENT}>Paste text instead</SelectItem>
                    {analysableDocuments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.label || d.file_name || 'Untitled document'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  PDF, image and plain-text uploads can be read directly. Scanned pages of poor quality may
                  need the text pasted instead.
                </p>
              </div>

              {documentId === NO_DOCUMENT ? (
                <div className="space-y-2">
                  <Label htmlFor="analysis-text">Contract text</Label>
                  <Textarea
                    id="analysis-text"
                    value={contractText}
                    onChange={(e) => setContractText(e.target.value)}
                    rows={16}
                    placeholder="Paste the contract of sale, including the schedule and any special conditions…"
                  />
                  <p className="text-xs text-muted-foreground">
                    {contractText.trim().length.toLocaleString()} characters
                  </p>
                </div>
              ) : null}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={running}>Cancel</Button>
            <Button onClick={() => void run()} disabled={running}>
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden />}
              Run analysis
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AnalysisCard({
  analysis, busy, canEdit, canDelete, onReview, onDelete,
}: {
  analysis: ContractAnalysis;
  busy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onReview: (id: string, status: 'confirmed' | 'dismissed') => void;
  onDelete: (id: string) => void;
}) {
  const confidence = analysis.confidence !== null && analysis.confidence !== undefined
    ? `${Math.round(analysis.confidence * 100)}% confidence`
    : null;

  return (
    <div className={cn(
      'rounded-lg border p-4',
      analysis.status === 'confirmed' ? 'border-success/40 bg-success/5'
        : analysis.status === 'dismissed' ? 'border-border/60 bg-muted/30 opacity-80'
          : 'border-border',
    )}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {analysis.source_label || 'Contract analysis'}
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(analysis.created_at).toLocaleString('en-AU')}
            {confidence ? ` · ${confidence}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{ANALYSIS_STATUS_LABELS[analysis.status]}</Badge>
          {canEdit && analysis.status !== 'confirmed' ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onReview(analysis.id, 'confirmed')}>
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Confirm
            </Button>
          ) : null}
          {canEdit && analysis.status === 'draft' ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReview(analysis.id, 'dismissed')}>
              <X className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Dismiss
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              disabled={busy}
              aria-label="Delete analysis"
              onClick={() => onDelete(analysis.id)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      {analysis.status === 'draft' ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Draft output. Verify every clause reference and date against the executed contract before acting.
        </p>
      ) : null}

      {analysis.summary ? (
        <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{analysis.summary}</p>
      ) : null}

      {analysis.risk_flags?.length ? (
        <>
          <Separator className="my-3" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Risk flags</p>
          <ul className="space-y-2">
            {analysis.risk_flags.map((r, i) => (
              <li key={i} className={cn('rounded-md border p-2.5', riskFlagClasses(r.severity))}>
                <p className="text-sm font-medium">{r.title}</p>
                <p className="mt-0.5 text-xs opacity-90">{r.detail}</p>
                {r.recommended_action ? (
                  <p className="mt-1 text-xs font-medium opacity-90">Next: {r.recommended_action}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {analysis.special_conditions?.length ? (
        <>
          <Separator className="my-3" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Special conditions ({analysis.special_conditions.length})
          </p>
          <ul className="space-y-2">
            {analysis.special_conditions.map((c, i) => (
              <li key={i} className="rounded-md border border-border/70 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {c.reference ? <Badge variant="outline" className="font-mono text-[11px]">{c.reference}</Badge> : null}
                  <p className="text-sm font-medium text-foreground">{c.title}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{c.summary}</p>
                {(c.obligation_on || c.deadline) ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.obligation_on ? `Obligation: ${c.obligation_on}` : ''}
                    {c.obligation_on && c.deadline ? ' · ' : ''}
                    {c.deadline ? `Deadline: ${c.deadline}` : ''}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {analysis.key_dates?.length ? (
        <>
          <Separator className="my-3" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key dates</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {analysis.key_dates.map((d, i) => (
              <li key={i} className="rounded-md border border-border/70 px-2.5 py-2 text-xs">
                <span className="font-medium text-foreground">{d.label}</span>
                <span className="text-muted-foreground">{d.date ? ` — ${d.date}` : d.basis ? ` — ${d.basis}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {analysis.parties?.length ? (
        <>
          <Separator className="my-3" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parties named</p>
          <div className="flex flex-wrap gap-1.5">
            {analysis.parties.map((p, i) => (
              <Badge key={i} variant="outline" className="font-normal">
                {p.role ? `${p.role}: ` : ''}{p.name}
              </Badge>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
