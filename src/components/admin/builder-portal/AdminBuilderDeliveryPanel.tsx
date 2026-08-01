import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, FileWarning, Loader2, RefreshCw, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  CLAIM_STATUS_LABELS, DEFECT_SEVERITY_LABELS, DEFECT_STATUS_LABELS,
  INSPECTION_STATUS_LABELS, VARIATION_STATUS_LABELS,
  allowedDeliveryTransitions, formatDeliveryDate, formatDeliveryMoney, statusLabel,
  type BuilderDefect, type BuilderDeliveryKind, type BuilderInspection,
  type BuilderProgressClaim, type BuilderVariation,
} from '@/lib/builderDelivery';

/**
 * Internal Builder delivery administration — variations, progress claims,
 * inspections and defects for one construction case.
 *
 * Mirrors `AdminBuilderConstructionPanel`. Every call goes through
 * `invokeSecureFunction`, which carries the staff session and the CSRF token;
 * `builder-delivery-admin` re-checks the `builder_portal_admin` module
 * permission server-side, so nothing here is the authorization control.
 *
 * This is the INTERNAL surface. It never links to the external /builder/* portal.
 *
 * DATA BOUNDARY: a progress claim shows what was claimed and certified. No
 * payment, receipt or commission is requested or displayed — Finance owns those.
 */

interface AdminProject { id: string; name: string }
interface AdminCase { id: string; case_reference: string | null }

export function AdminBuilderDeliveryPanel({ canEdit }: { canEdit: boolean }) {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [cases, setCases] = useState<AdminCase[]>([]);
  const [caseId, setCaseId] = useState('');
  const [variations, setVariations] = useState<BuilderVariation[]>([]);
  const [claims, setClaims] = useState<BuilderProgressClaim[]>([]);
  const [inspections, setInspections] = useState<BuilderInspection[]>([]);
  const [defects, setDefects] = useState<BuilderDefect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (operation: string, payload: Record<string, unknown> = {}) => {
    const { data, error: invokeError } = await invokeSecureFunction(
      'builder-delivery-admin', { operation, ...payload });
    if (invokeError || (data as any)?.error) {
      throw new Error((data as any)?.error || invokeError?.message || 'The request failed');
    }
    return data as any;
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const { data } = await invokeSecureFunction(
        'builder-projects-admin', { operation: 'list_projects', page: 1, page_size: 100 });
      const records = ((data as any)?.records ?? []) as AdminProject[];
      setProjects(records);
      setProjectId((current) => current || records[0]?.id || '');
    } catch (loadError: any) {
      setError(loadError?.message || 'Projects could not be loaded');
    }
  }, []);

  const loadCases = useCallback(async () => {
    if (!projectId) { setCases([]); setCaseId(''); return; }
    try {
      const { data } = await invokeSecureFunction('builder-construction-admin', {
        operation: 'list_cases', project_id: projectId, page: 1, page_size: 200,
      });
      const records = ((data as any)?.records ?? []) as AdminCase[];
      setCases(records);
      setCaseId((current) => (records.some((c) => c.id === current) ? current : records[0]?.id || ''));
    } catch (loadError: any) {
      setError(loadError?.message || 'Construction cases could not be loaded');
    }
  }, [projectId]);

  const loadDelivery = useCallback(async () => {
    if (!caseId) {
      setVariations([]); setClaims([]); setInspections([]); setDefects([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [v, c, i, d] = await Promise.all([
        call('list_variations', { construction_case_id: caseId }),
        call('list_claims', { construction_case_id: caseId }),
        call('list_inspections', { construction_case_id: caseId }),
        call('list_defects', { construction_case_id: caseId }),
      ]);
      setVariations(v.records ?? []);
      setClaims(c.records ?? []);
      setInspections(i.records ?? []);
      setDefects(d.records ?? []);
      setError(null);
    } catch (loadError: any) {
      setError(loadError?.message || 'Delivery records could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [call, caseId]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void loadCases(); }, [loadCases]);
  useEffect(() => { void loadDelivery(); }, [loadDelivery]);

  /**
   * Status changes always carry the row_version the panel loaded. A stale value
   * is rejected by the server with 409 rather than silently overwritten.
   */
  const changeStatus = (
    kind: BuilderDeliveryKind, id: string, rowVersion: number, from: string, to: string,
  ) => {
    const reason = window.prompt('Give a reason for this change');
    if (!reason || !reason.trim()) return;
    setBusy(true);
    void (async () => {
      try {
        await call('set_status', {
          construction_case_id: caseId,
          kind,
          entity_id: id,
          expected_version: rowVersion,
          from_status: from,
          status: to,
          reason: reason.trim(),
        });
        toast.success('Status updated');
        await loadDelivery();
      } catch (actionError: any) {
        toast.error(actionError?.message || 'The status could not be changed');
      } finally {
        setBusy(false);
      }
    })();
  };

  const actions = (kind: BuilderDeliveryKind, id: string, rowVersion: number, status: string) => (
    <div className="flex flex-wrap justify-end gap-1">
      {allowedDeliveryTransitions(kind, status).map((next) => (
        <Button key={next} size="sm" variant="outline" disabled={!canEdit || busy}
          onClick={() => changeStatus(kind, id, rowVersion, status, next)}>
          {statusLabel(kind, next)}
        </Button>
      ))}
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Delivery</CardTitle>
          <CardDescription>
            Variations, progress claims, inspections and defects for one build.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-56" aria-label="Choose a project">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={caseId} onValueChange={setCaseId}>
            <SelectTrigger className="w-56" aria-label="Choose a build">
              <SelectValue placeholder="Choose a build" />
            </SelectTrigger>
            <SelectContent>
              {cases.map((record) => (
                <SelectItem key={record.id} value={record.id}>
                  {record.case_reference || record.id.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void loadDelivery()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden />Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading delivery" />
          </div>
        ) : !caseId ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Choose a project and a build to manage its delivery records.
          </p>
        ) : (
          <Tabs defaultValue="defects">
            <TabsList>
              <TabsTrigger value="defects">Defects ({defects.length})</TabsTrigger>
              <TabsTrigger value="variations">Variations ({variations.length})</TabsTrigger>
              <TabsTrigger value="claims">Claims ({claims.length})</TabsTrigger>
              <TabsTrigger value="inspections">Inspections ({inspections.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="defects" className="mt-4">
              {!defects.length ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  <FileWarning className="mx-auto mb-2 h-5 w-5" aria-hidden />
                  No defects recorded for this build.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Defect</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {defects.map((defect) => (
                      <TableRow key={defect.id}>
                        <TableCell>
                          <span className="font-medium">{defect.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            v{defect.row_version} · due {formatDeliveryDate(defect.due_date)}
                          </span>
                        </TableCell>
                        <TableCell>{DEFECT_SEVERITY_LABELS[defect.severity]}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{DEFECT_STATUS_LABELS[defect.status]}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {actions('defect', defect.id, defect.row_version, defect.status)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="variations" className="mt-4">
              {!variations.length ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No variations recorded for this build.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variation</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variations.map((variation) => (
                      <TableRow key={variation.id}>
                        <TableCell>
                          <span className="font-medium">{variation.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            v{variation.row_version}
                          </span>
                        </TableCell>
                        <TableCell>{formatDeliveryMoney(variation.variation_price)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{VARIATION_STATUS_LABELS[variation.status]}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {actions('variation', variation.id, variation.row_version, variation.status)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="claims" className="mt-4">
              {!claims.length ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  <Receipt className="mx-auto mb-2 h-5 w-5" aria-hidden />
                  No progress claims recorded for this build.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Claim</TableHead>
                      <TableHead>Claimed</TableHead>
                      <TableHead>Certified</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.map((claim) => (
                      <TableRow key={claim.id}>
                        <TableCell>
                          <span className="font-medium">{claim.claim_number || 'No number'}</span>
                          <span className="block text-xs text-muted-foreground">
                            v{claim.row_version}
                          </span>
                        </TableCell>
                        <TableCell>{formatDeliveryMoney(claim.claimed_amount)}</TableCell>
                        <TableCell>{formatDeliveryMoney(claim.certified_amount)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{CLAIM_STATUS_LABELS[claim.status]}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {actions('progress_claim', claim.id, claim.row_version, claim.status)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="inspections" className="mt-4">
              {!inspections.length ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  <ClipboardCheck className="mx-auto mb-2 h-5 w-5" aria-hidden />
                  No inspections recorded for this build.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Inspection</TableHead>
                      <TableHead>Scheduled</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inspections.map((inspection) => (
                      <TableRow key={inspection.id}>
                        <TableCell>
                          <span className="font-medium">{inspection.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {inspection.defect_count} defect(s) · v{inspection.row_version}
                          </span>
                        </TableCell>
                        <TableCell>{formatDeliveryDate(inspection.scheduled_for)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {INSPECTION_STATUS_LABELS[inspection.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {actions('inspection', inspection.id, inspection.row_version,
                            inspection.status)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
