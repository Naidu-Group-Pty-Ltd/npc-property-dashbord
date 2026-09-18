/**
 * The condition-record submission surface — the `building` half of Property
 * Risk, inside the existing report workflow (S5/S6 Approval A).
 *
 * Three rules carry it:
 *
 *   * **One rule, rendered and enforced.** The form validates with
 *     `conditionRecordSubmission.pure.ts` — the same module the edge
 *     operation refuses with — and shows the validator's own reading of the
 *     draft before anything is submitted, so what an operator is asked for
 *     and what the server accepts cannot become two standards.
 *   * **Evidence, never a score.** `CONDITION_METHOD_ACTIVATION` is null and
 *     nothing here changes that: the panel says what a record establishes in
 *     the validator's words and never invents a number. Submitting a record
 *     changes no grade.
 *   * **An unapplied table is a named state.** On a deployment that has not
 *     applied the migration, the server answers `tableApplied: false` with
 *     the reason; the panel renders that sentence and offers no submit
 *     button, because a control that can only fail is worse than none.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, FileCheck2, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import {
  ADMISSIBLE_SOURCES,
  FINDING_SEVERITIES,
  type ConditionReading,
  type ConditionSourceKind,
  type FindingSeverity,
} from '@/lib/reports/conditionRecord.pure';
import {
  decideConditionSubmission,
  parseConditionSubmission,
  type ConditionSubmissionPayload,
} from '@/lib/reports/conditionRecordSubmission.pure';

const KIND_LABELS: Record<ConditionSourceKind, string> = {
  building_inspection: 'Building inspection report',
  strata_report: 'Strata report',
  building_certificate: 'Building certificate',
  vendor_statement: "Vendor's statement",
};

const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  safety_hazard: 'Safety hazard',
  major_defect: 'Major defect',
  minor_defect: 'Minor defect',
  unfunded_liability: 'Unfunded liability (strata)',
};

const COVERAGE_OPTIONS = [
  ['whole_dwelling', 'The whole dwelling (interior, exterior, roof space, subfloor)'],
  ['partial_dwelling', 'Part of the dwelling'],
  ['common_property', "The scheme's common property"],
  ['specified_works', 'The works certified, and nothing else'],
  ['disclosure_only', 'What the issuer chose to disclose'],
] as const;

const CONCLUSION_OPTIONS = [
  ['not_concluded', 'The document states no conclusion'],
  ['no_defects_identified', 'The document states no defects were identified'],
  ['defects_identified', 'The document states defects were identified'],
] as const;

interface StoredConditionRecord {
  row: Record<string, unknown>;
  reading: ConditionReading;
}

interface FindingDraft {
  element: string;
  severity: FindingSeverity | '';
  note: string;
}

const EMPTY_FINDING: FindingDraft = { element: '', severity: '', note: '' };

interface Props {
  reportId: string;
  propertyAddress: string;
}

export function ConditionEvidencePanel({ reportId, propertyAddress }: Props) {
  const [loading, setLoading] = useState(true);
  const [tableApplied, setTableApplied] = useState(true);
  const [tableReason, setTableReason] = useState<string | null>(null);
  const [records, setRecords] = useState<StoredConditionRecord[]>([]);
  const [bestReading, setBestReading] = useState<ConditionReading | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [documentKind, setDocumentKind] = useState<ConditionSourceKind>('building_inspection');
  const [issuer, setIssuer] = useState('');
  const [issuerLicence, setIssuerLicence] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [inspectedOn, setInspectedOn] = useState('');
  const [documentReference, setDocumentReference] = useState('');
  const [documentAddress, setDocumentAddress] = useState(propertyAddress);
  const [scope, setScope] = useState('');
  const [scopeCoverage, setScopeCoverage] = useState('');
  const [exclusionsText, setExclusionsText] = useState('');
  const [conclusion, setConclusion] = useState('not_concluded');
  const [verification, setVerification] = useState('transcribed_only');
  const [fileId, setFileId] = useState('');
  const [findings, setFindings] = useState<FindingDraft[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const { data, error } = await invokeSecureFunction('manage-investment-reports', {
      action: 'getConditionRecords',
      reportId,
    });
    setLoading(false);
    if (error || !data?.success) {
      // A failed read is not an empty register: say nothing false.
      setLoadFailed(true);
      return;
    }
    setTableApplied(data.tableApplied !== false);
    setTableReason(typeof data.reason === 'string' ? data.reason : null);
    setRecords(Array.isArray(data.records) ? data.records : []);
    setBestReading(data.bestReading ?? null);
  }, [reportId]);

  useEffect(() => { void load(); }, [load]);

  const payload: ConditionSubmissionPayload = useMemo(() => ({
    documentKind,
    issuer,
    issuerLicence,
    issuedOn,
    inspectedOn,
    documentReference,
    documentPropertyAddress: documentAddress,
    scope,
    scopeCoverage: scopeCoverage || undefined,
    exclusions: exclusionsText.split('\n').map((l) => l.trim()).filter(Boolean),
    conclusion,
    verification,
    fileId: fileId || undefined,
    findings: findings.map((f) => ({ element: f.element, severity: f.severity, note: f.note || undefined })),
  }), [conclusion, documentAddress, documentKind, documentReference, exclusionsText, fileId,
    findings, inspectedOn, issuedOn, issuer, issuerLicence, scope, scopeCoverage, verification]);

  // The validator's live reading of the draft — the same rule the server
  // enforces, shown before the click rather than after it.
  const draftDecision = useMemo(() => {
    const parsed = parseConditionSubmission(payload, { reportId });
    if (!parsed.ok) return { statement: parsed.refusal.statement, blocked: true };
    const decision = decideConditionSubmission(
      parsed.record,
      { propertyAddress, reportId },
      new Date().toISOString(),
    );
    return { statement: decision.reading.statement, blocked: !decision.storable };
  }, [payload, propertyAddress, reportId]);

  const handleSubmit = async () => {
    setSubmitting(true);
    const { data, error } = await invokeSecureFunction('manage-investment-reports', {
      action: 'submitConditionRecord',
      reportId,
      data: payload,
    });
    setSubmitting(false);
    if (error || !data?.success) {
      toast.error(data?.error || error?.message || 'The condition record was not stored.');
      return;
    }
    toast.success('Condition record stored.', { description: data.reading?.statement });
    setDialogOpen(false);
    setFindings([]);
    setIssuer(''); setIssuerLicence(''); setIssuedOn(''); setInspectedOn('');
    setDocumentReference(''); setScope(''); setScopeCoverage('');
    setExclusionsText(''); setConclusion('not_concluded'); setFileId('');
    await load();
  };

  const updateFinding = (i: number, patch: Partial<FindingDraft>) => {
    setFindings((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  };

  return (
    <Card className="overflow-hidden border-border/80 bg-card shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl border border-border bg-muted/40 p-2 text-muted-foreground shadow-sm">
            <ClipboardList className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base text-foreground">Condition Evidence</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              The building half of Property Risk: a condition document, recorded with its issuer,
              its dates and what it examined. Records are evidence — no condition scale is
              authorised, so nothing here changes a score.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 border-t bg-muted/10 p-4 sm:p-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Reading the register…</p>
        ) : loadFailed ? (
          <div className="space-y-2">
            <p className="text-sm text-foreground">
              The condition records could not be read just now. This says nothing about whether
              records exist.
            </p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </div>
        ) : !tableApplied ? (
          <p className="text-sm text-muted-foreground">{tableReason}</p>
        ) : (
          <>
            {bestReading && (
              <p className="text-sm text-foreground">{bestReading.statement}</p>
            )}
            {records.length > 0 && (
              <ul className="space-y-2">
                {records.map(({ row, reading }) => (
                  <li key={String(row.id)} className="rounded-lg border border-border bg-background p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileCheck2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        {KIND_LABELS[row.document_kind as ConditionSourceKind] ?? String(row.document_kind)}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {reading.admissible ? 'Admissible' : 'Evidence only'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {String(row.issuer)} · issued {String(row.issued_on)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{reading.statement}</p>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Record condition evidence
            </Button>
          </>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record condition evidence</DialogTitle>
            <DialogDescription>
              Record what the document itself says — its issuer, its dates, what it examined and
              what it found. The reading below is the same rule the server applies.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cr-kind">Document kind</Label>
              <Select value={documentKind} onValueChange={(v) => setDocumentKind(v as ConditionSourceKind)}>
                <SelectTrigger id="cr-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ADMISSIBLE_SOURCES.map((k) => (
                    <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cr-issuer">Issuer</Label>
              <Input id="cr-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)}
                placeholder="The firm or person who issued it" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-licence">Licence / registration (optional)</Label>
              <Input id="cr-licence" value={issuerLicence} onChange={(e) => setIssuerLicence(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cr-issued">Issued on</Label>
              <Input id="cr-issued" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-inspected">Inspected on (where it differs)</Label>
              <Input id="cr-inspected" type="date" value={inspectedOn} onChange={(e) => setInspectedOn(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cr-ref">Issuer's reference (optional)</Label>
              <Input id="cr-ref" value={documentReference} onChange={(e) => setDocumentReference(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-address">Property, as the document identifies it</Label>
              <Input id="cr-address" value={documentAddress} onChange={(e) => setDocumentAddress(e.target.value)} />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cr-scope">What was examined, in the issuer's own words</Label>
              <Textarea id="cr-scope" value={scope} onChange={(e) => setScope(e.target.value)} rows={2} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cr-coverage">How wide that scope was</Label>
              <Select value={scopeCoverage} onValueChange={setScopeCoverage}>
                <SelectTrigger id="cr-coverage"><SelectValue placeholder="Not recorded" /></SelectTrigger>
                <SelectContent>
                  {COVERAGE_OPTIONS.map(([v, label]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-conclusion">The document's own conclusion</Label>
              <Select value={conclusion} onValueChange={setConclusion}>
                <SelectTrigger id="cr-conclusion"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONCLUSION_OPTIONS.map(([v, label]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cr-exclusions">What it did not reach (one per line, optional)</Label>
              <Textarea id="cr-exclusions" value={exclusionsText}
                onChange={(e) => setExclusionsText(e.target.value)} rows={2} />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Findings, as the document records them</Label>
              {findings.map((f, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_auto_1fr_auto]">
                  <Input value={f.element} placeholder="Building element"
                    onChange={(e) => updateFinding(i, { element: e.target.value })} />
                  <Select value={f.severity} onValueChange={(v) => updateFinding(i, { severity: v as FindingSeverity })}>
                    <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="Severity" /></SelectTrigger>
                    <SelectContent>
                      {FINDING_SEVERITIES.map((s) => (
                        <SelectItem key={s} value={s}>{SEVERITY_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input value={f.note} placeholder="Issuer's words (optional)"
                    onChange={(e) => updateFinding(i, { note: e.target.value })} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove finding"
                    onClick={() => setFindings((prev) => prev.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm"
                onClick={() => setFindings((prev) => [...prev, { ...EMPTY_FINDING }])}>
                <Plus className="mr-1.5 h-4 w-4" /> Add a finding
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cr-verification">Verification</Label>
              <Select value={verification} onValueChange={setVerification}>
                <SelectTrigger id="cr-verification"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transcribed_only">Transcribed only — the document is not attached</SelectItem>
                  <SelectItem value="document_held">Document held — the file is uploaded</SelectItem>
                  <SelectItem value="issuer_verified">Issuer verified against a register</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {verification !== 'transcribed_only' && (
              <div className="space-y-1.5">
                <Label htmlFor="cr-file">Uploaded file id (client files)</Label>
                <Input id="cr-file" value={fileId} onChange={(e) => setFileId(e.target.value)}
                  placeholder="The client_files id of the uploaded document" />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              What this record establishes
            </p>
            <p className="mt-1 text-sm text-foreground">{draftDecision.statement}</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSubmit()} disabled={submitting || draftDecision.blocked}>
              {submitting ? 'Storing…' : 'Store the record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
