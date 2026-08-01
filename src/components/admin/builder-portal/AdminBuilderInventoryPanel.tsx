import { useCallback, useEffect, useState } from 'react';
import { Boxes, Layers, Loader2, Plus, RefreshCw, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  AVAILABILITY_STATUS_LABELS, PRICE_BASIS_LABELS, RELEASE_STATUS_LABELS,
  STAGE_STATUS_LABELS, UNIT_TYPE_LABELS,
  allowedAvailabilityTransitions, allowedReleaseTransitions, formatListPrice,
  type BuilderAvailabilityStatus, type BuilderPriceBasis, type BuilderReleaseStatus,
  type BuilderStageStatus, type BuilderUnitType,
} from '@/lib/builderInventory';

/**
 * Internal Builder inventory administration.
 *
 * Mirrors `AdminBuilderProjectsPanel`. Every call goes through
 * `invokeSecureFunction`, which carries the staff session and the CSRF token;
 * `builder-inventory-admin` re-checks the `builder_portal_admin` module
 * permission server-side, so nothing here is the authorization control.
 *
 * This is the INTERNAL surface. It never links to the external /builder/* portal.
 *
 * DATA BOUNDARY: this panel shows the customer-facing list price only. No build
 * cost, margin, supplier price or contractor price is requested or displayed,
 * because no such column exists.
 */

interface AdminProject { id: string; name: string; project_reference: string | null }

interface AdminStage {
  id: string;
  project_id: string;
  name: string;
  stage_number: string | null;
  status: BuilderStageStatus;
  row_version: number;
}

interface AdminUnit {
  id: string;
  project_id: string;
  stage_id: string | null;
  unit_number: string;
  unit_type: BuilderUnitType;
  bedrooms: number | null;
  bathrooms: number | null;
  internal_area_sqm: number | null;
  availability_status: BuilderAvailabilityStatus;
  release_status: BuilderReleaseStatus;
  row_version: number;
}

interface AdminPrice {
  id: string;
  list_price: number;
  price_basis: BuilderPriceBasis;
  is_current: boolean;
  effective_from: string;
}

export function AdminBuilderInventoryPanel({ canEdit }: { canEdit: boolean }) {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [stages, setStages] = useState<AdminStage[]>([]);
  const [units, setUnits] = useState<AdminUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [stageOpen, setStageOpen] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const [priceUnit, setPriceUnit] = useState<AdminUnit | null>(null);
  const [priceHistory, setPriceHistory] = useState<AdminPrice[]>([]);

  const call = useCallback(async (operation: string, payload: Record<string, unknown> = {}) => {
    const { data, error: invokeError } = await invokeSecureFunction(
      'builder-inventory-admin', { operation, ...payload });
    if (invokeError || (data as any)?.error) {
      throw new Error((data as any)?.error || invokeError?.message || 'The request failed');
    }
    return data as any;
  }, []);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await invokeSecureFunction(
        'builder-projects-admin', { operation: 'list_projects', page: 1, page_size: 100 });
      const records = ((data as any)?.records ?? []) as AdminProject[];
      setProjects(records);
      setProjectId((current) => current || records[0]?.id || '');
      setError(null);
    } catch (loadError: any) {
      setError(loadError?.message || 'Projects could not be loaded');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInventory = useCallback(async () => {
    if (!projectId) { setStages([]); setUnits([]); return; }
    setLoading(true);
    try {
      const [stageData, unitData] = await Promise.all([
        call('list_stages', { project_id: projectId }),
        call('list_units', { project_id: projectId, page: 1, page_size: 200 }),
      ]);
      setStages(stageData.records ?? []);
      setUnits(unitData.records ?? []);
      setError(null);
    } catch (loadError: any) {
      setError(loadError?.message || 'Inventory could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [call, projectId]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void loadInventory(); }, [loadInventory]);

  const run = async (label: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      toast.success(label);
      await loadInventory();
      return true;
    } catch (actionError: any) {
      toast.error(actionError?.message || 'The request failed');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createStage = async (form: FormData) => {
    const ok = await run('Stage created', () => call('upsert_stage', {
      project_id: projectId,
      name: String(form.get('name') || ''),
      stage_number: String(form.get('stage_number') || ''),
      status: String(form.get('status') || 'planned'),
      reason: 'Created from Command Centre',
    }));
    if (ok) setStageOpen(false);
  };

  const createUnit = async (form: FormData) => {
    const ok = await run('Unit created', () => call('create_unit', {
      project_id: projectId,
      stage_id: String(form.get('stage_id') || '') || null,
      unit_number: String(form.get('unit_number') || ''),
      unit_type: String(form.get('unit_type') || 'house'),
      bedrooms: String(form.get('bedrooms') || '') || null,
      bathrooms: String(form.get('bathrooms') || '') || null,
      internal_area_sqm: String(form.get('internal_area_sqm') || '') || null,
      reason: 'Created from Command Centre',
    }));
    if (ok) setUnitOpen(false);
  };

  const openPrice = async (unit: AdminUnit) => {
    setPriceUnit(unit);
    setPriceHistory([]);
    try {
      const detail = await call('get_unit', { unit_id: unit.id });
      setPriceHistory(detail.pricing ?? []);
    } catch (priceError: any) {
      toast.error(priceError?.message || 'The unit could not be loaded');
    }
  };

  const savePrice = async (form: FormData) => {
    if (!priceUnit) return;
    const ok = await run('Price updated', () => call('set_price', {
      unit_id: priceUnit.id,
      list_price: String(form.get('list_price') || ''),
      price_basis: String(form.get('price_basis') || 'fixed'),
      reason: String(form.get('reason') || 'Updated from Command Centre'),
    }));
    if (ok) setPriceUnit(null);
  };

  /**
   * Status changes always carry the row_version the panel loaded. A stale value
   * is rejected by the server with 409 rather than silently overwritten.
   */
  const changeStatus = (
    unit: AdminUnit, operation: 'set_availability' | 'set_release', status: string,
  ) => {
    const reason = window.prompt('Give a reason for this change');
    if (!reason || !reason.trim()) return;
    void run('Unit status updated', () => call(operation, {
      unit_id: unit.id,
      expected_version: unit.row_version,
      status,
      reason: reason.trim(),
    }));
  };

  const currentPrice = priceHistory.find((entry) => entry.is_current) ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Inventory</CardTitle>
            <CardDescription>
              Stages and units for one project. Prices shown are customer-facing list prices.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-64" aria-label="Choose a project">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void loadInventory()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />Refresh
            </Button>
            <Button size="sm" disabled={!canEdit || !projectId} onClick={() => setStageOpen(true)}>
              <Layers className="mr-2 h-4 w-4" aria-hidden />New stage
            </Button>
            <Button size="sm" disabled={!canEdit || !projectId} onClick={() => setUnitOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />New unit
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          ) : null}

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading inventory" />
            </div>
          ) : !projectId ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Choose a project to manage its inventory.
            </p>
          ) : (
            <>
              <div>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Layers className="h-4 w-4 text-primary" aria-hidden />
                  Stages ({stages.length})
                </h3>
                {!stages.length ? (
                  <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No stages recorded for this project.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {stages.map((stage) => (
                      <Badge key={stage.id} variant="outline">
                        {stage.stage_number ? `${stage.stage_number} · ` : ''}{stage.name}
                        {' · '}{STAGE_STATUS_LABELS[stage.status]}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Boxes className="h-4 w-4 text-primary" aria-hidden />
                  Units ({units.length})
                </h3>
                {!units.length ? (
                  <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No units recorded for this project.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Unit</TableHead>
                          <TableHead className="hidden md:table-cell">Type</TableHead>
                          <TableHead>Availability</TableHead>
                          <TableHead>Release</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {units.map((unit) => (
                          <TableRow key={unit.id}>
                            <TableCell>
                              <span className="font-medium">{unit.unit_number}</span>
                              <span className="block text-xs text-muted-foreground">
                                v{unit.row_version}
                              </span>
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              {UNIT_TYPE_LABELS[unit.unit_type]}
                            </TableCell>
                            <TableCell>
                              <Select
                                value=""
                                disabled={!canEdit || busy}
                                onValueChange={(value) => changeStatus(unit, 'set_availability', value)}
                              >
                                <SelectTrigger
                                  className="w-40"
                                  aria-label={`Change availability for unit ${unit.unit_number}`}
                                >
                                  <SelectValue
                                    placeholder={AVAILABILITY_STATUS_LABELS[unit.availability_status]}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {allowedAvailabilityTransitions(unit.availability_status).map((next) => (
                                    <SelectItem key={next} value={next}>
                                      {AVAILABILITY_STATUS_LABELS[next]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select
                                value=""
                                disabled={!canEdit || busy}
                                onValueChange={(value) => changeStatus(unit, 'set_release', value)}
                              >
                                <SelectTrigger
                                  className="w-36"
                                  aria-label={`Change release state for unit ${unit.unit_number}`}
                                >
                                  <SelectValue
                                    placeholder={RELEASE_STATUS_LABELS[unit.release_status]}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {allowedReleaseTransitions(unit.release_status).map((next) => (
                                    <SelectItem key={next} value={next}>
                                      {RELEASE_STATUS_LABELS[next]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm" variant="outline"
                                disabled={!canEdit}
                                onClick={() => void openPrice(unit)}
                              >
                                <Tag className="mr-2 h-4 w-4" aria-hidden />Price
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={stageOpen} onOpenChange={setStageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New stage</DialogTitle>
            <DialogDescription>Stages belong to the selected project.</DialogDescription>
          </DialogHeader>
          <form
            id="builder-stage-form"
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void createStage(new FormData(event.currentTarget));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="stage_name">Name</Label>
              <Input id="stage_name" name="name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stage_number">Stage number</Label>
              <Input id="stage_number" name="stage_number" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stage_status">Status</Label>
              <select
                id="stage_status" name="status" defaultValue="planned"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {(Object.keys(STAGE_STATUS_LABELS) as BuilderStageStatus[]).map((value) => (
                  <option key={value} value={value}>{STAGE_STATUS_LABELS[value]}</option>
                ))}
              </select>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStageOpen(false)}>Cancel</Button>
            <Button type="submit" form="builder-stage-form" disabled={busy}>Create stage</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unitOpen} onOpenChange={setUnitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New unit</DialogTitle>
            <DialogDescription>
              A new unit starts unreleased and available. Set a price before releasing it.
            </DialogDescription>
          </DialogHeader>
          <form
            id="builder-unit-form"
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void createUnit(new FormData(event.currentTarget));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="unit_number_new">Unit number</Label>
              <Input id="unit_number_new" name="unit_number" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit_type_new">Type</Label>
              <select
                id="unit_type_new" name="unit_type" defaultValue="house"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {(Object.keys(UNIT_TYPE_LABELS) as BuilderUnitType[]).map((value) => (
                  <option key={value} value={value}>{UNIT_TYPE_LABELS[value]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit_stage_new">Stage</Label>
              <select
                id="unit_stage_new" name="stage_id" defaultValue=""
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">No stage</option>
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>{stage.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="unit_bedrooms">Bedrooms</Label>
                <Input id="unit_bedrooms" name="bedrooms" type="number" min={0} max={20} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit_bathrooms">Bathrooms</Label>
                <Input id="unit_bathrooms" name="bathrooms" type="number" min={0} max={20} step="0.5" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit_internal_area">Internal m²</Label>
                <Input id="unit_internal_area" name="internal_area_sqm" type="number" step="0.01" />
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnitOpen(false)}>Cancel</Button>
            <Button type="submit" form="builder-unit-form" disabled={busy}>Create unit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(priceUnit)} onOpenChange={(open) => { if (!open) setPriceUnit(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Price · unit {priceUnit?.unit_number}</DialogTitle>
            <DialogDescription>
              Customer-facing list price. Build costs and margins are not held here.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Current:{' '}
            <span className="font-medium">
              {formatListPrice(currentPrice?.list_price ?? null, currentPrice?.price_basis ?? null)}
            </span>
          </p>
          <form
            id="builder-price-form"
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void savePrice(new FormData(event.currentTarget));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="admin_list_price">List price</Label>
              <Input
                id="admin_list_price" name="list_price" type="number" min={0} step="1" required
                defaultValue={currentPrice?.list_price ?? ''}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin_price_basis">Basis</Label>
              <select
                id="admin_price_basis" name="price_basis"
                defaultValue={currentPrice?.price_basis ?? 'fixed'}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {(Object.keys(PRICE_BASIS_LABELS) as BuilderPriceBasis[]).map((value) => (
                  <option key={value} value={value}>{PRICE_BASIS_LABELS[value]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin_price_reason">Reason</Label>
              <Input id="admin_price_reason" name="reason" />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceUnit(null)}>Cancel</Button>
            <Button type="submit" form="builder-price-form" disabled={busy}>Save price</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
