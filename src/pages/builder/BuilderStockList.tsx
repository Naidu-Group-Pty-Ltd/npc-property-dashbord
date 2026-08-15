import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Boxes, CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet,
  Image as ImageIcon, Link2, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2,
  Upload, UserCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { BuilderPortalShell } from '@/components/builder-portal/BuilderPortalShell';
import { BuilderPortalMetricCard } from '@/components/builder-portal/ui/BuilderPortalMetricCard';
import { useDebounce } from '@/hooks/useDebounce';
import {
  importBuilderStockUrl,
  useAcknowledgeStockSelection, useBuilderStockItems, useBuilderStockSelections,
  useBuilderStockUploads, useDeleteBuilderStockSource, useEnrichPendingStockImages,
  useSetBuilderStockAvailability, uploadBuilderStockFile,
  type StockImportSummary, type StockUploadProgress,
} from '@/lib/builderStockQueries';
import {
  formatFileSize, primaryStockImage, stockFileAcceptAttribute, stockImageStageSummary,
  stockItemConfiguration, stockItemLocality, stockItemPrice, stockItemTitle,
  MAX_STOCK_FILE_BYTES, STOCK_AVAILABILITY_CLASSES, STOCK_AVAILABILITY_LABELS,
  STOCK_IMAGE_STAGE_BADGES, STOCK_SELECTION_STATUS_LABELS, STOCK_UPLOAD_STATUS_CLASSES,
  STOCK_UPLOAD_STATUS_LABELS, STOCK_SOURCE_TYPE_LABELS, stockSourceLabel,
  type BuilderStockItem, type BuilderStockUpload, type StockAvailability,
  type StockUploadStatus,
} from '@/lib/builderStock';

/**
 * Builder Portal — Stock List.
 *
 * The builder's side of the Stock List → Property Marketplace feature: upload a
 * schedule in whatever format the sales team keeps it in, watch it import, and
 * see which of the resulting properties a Command Centre adviser has selected
 * for a buyer.
 *
 * Nothing here names an organisation. The server holds the active organisation
 * on the session and scopes every query to it, so this page cannot ask for
 * another builder's stock even if somebody edits its state.
 *
 * The upload control accepts every format the reader supports, not PDFs — the
 * `accept` attribute is derived from `STOCK_EXTENSIONS`, so the picker and the
 * server's classifier cannot drift apart.
 */

const AVAILABILITY_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All availability' },
  { value: 'available', label: 'Available' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'contracted', label: 'Under contract' },
  { value: 'sold', label: 'Sold' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'unknown', label: 'Not stated' },
];

const SETTABLE_AVAILABILITY: StockAvailability[] = [
  'available', 'on_hold', 'reserved', 'contracted', 'sold', 'settled', 'withdrawn',
];

const PHASE_LABEL: Record<StockUploadProgress['phase'], string> = {
  requesting: 'Preparing the upload',
  uploading: 'Uploading the file',
  processing: 'Reading the properties',
  enriching: 'Finding images',
  done: 'Finished',
};

const PHASE_PERCENT: Record<StockUploadProgress['phase'], number> = {
  requesting: 10, uploading: 30, processing: 60, enriching: 85, done: 100,
};

export default function BuilderStockList() {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [availability, setAvailability] = useState('all');
  const [uploadFilter, setUploadFilter] = useState('all');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search, 300);

  const [progress, setProgress] = useState<StockUploadProgress | null>(null);
  const [lastSummary, setLastSummary] = useState<StockImportSummary | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [pendingDelete, setPendingDelete] = useState<BuilderStockUpload | null>(null);

  useEffect(() => { setPage(1); }, [debounced, availability, uploadFilter]);

  const uploadsQuery = useBuilderStockUploads(1);
  const selectionsQuery = useBuilderStockSelections(1);
  const itemsQuery = useBuilderStockItems({
    search: debounced.trim(),
    availability: availability === 'all' ? '' : availability,
    uploadId: uploadFilter === 'all' ? '' : uploadFilter,
    page,
    pageSize: 25,
  });

  const setAvailabilityMutation = useSetBuilderStockAvailability();
  const acknowledge = useAcknowledgeStockSelection();
  const enrichPending = useEnrichPendingStockImages();
  const deleteSource = useDeleteBuilderStockSource();

  const records = itemsQuery.data?.records ?? [];
  const pagination = itemsQuery.data?.pagination;
  const uploads = uploadsQuery.data?.records ?? [];
  const selections = selectionsQuery.data?.records ?? [];

  const pendingSelections = useMemo(
    () => selections.filter((selection) => selection.status === 'selected'),
    [selections],
  );

  const refreshAll = useCallback(() => {
    void itemsQuery.refetch();
    void uploadsQuery.refetch();
    void selectionsQuery.refetch();
  }, [itemsQuery, uploadsQuery, selectionsQuery]);

  const reportImport = useCallback((imported: StockImportSummary) => {
    setLastSummary(imported);
    toast({
      title: 'Stock list imported',
      description: `${imported.imported} new and ${imported.updated} updated from ${imported.detected} propert${imported.detected === 1 ? 'y' : 'ies'}.`,
    });
    refreshAll();
  }, [refreshAll, toast]);

  const reportImportFailure = useCallback((error: unknown) => {
    const failure = error as Error & { code?: string };
    const duplicate = failure.code === 'duplicate_file';
    toast({
      title: duplicate ? 'Already imported' : 'The stock list could not be imported',
      description: failure.message,
      variant: duplicate ? 'default' : 'destructive',
    });
    void uploadsQuery.refetch();
  }, [toast, uploadsQuery]);

  const handleFile = useCallback(async (file: File) => {
    if (file.size > MAX_STOCK_FILE_BYTES) {
      toast({
        title: 'That file is too large',
        description: `The limit is ${Math.round(MAX_STOCK_FILE_BYTES / (1024 * 1024))} MB.`,
        variant: 'destructive',
      });
      return;
    }

    setLastSummary(null);
    try {
      const result = await uploadBuilderStockFile(file, setProgress);
      reportImport(result.summary);
    } catch (error) {
      reportImportFailure(error);
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }, [reportImport, reportImportFailure]);

  /**
   * A linked source. The browser sends the address and nothing else — the
   * server fetches it, snapshots it and runs the same import a file gets.
   */
  const handleUrl = useCallback(async () => {
    const value = sourceUrl.trim();
    if (!value) return;
    setLastSummary(null);
    try {
      const result = await importBuilderStockUrl(value, setProgress);
      reportImport(result.summary);
      setSourceUrl('');
      setAddOpen(false);
    } catch (error) {
      reportImportFailure(error);
    } finally {
      setProgress(null);
    }
  }, [reportImport, reportImportFailure, sourceUrl]);

  const busy = progress !== null;

  const summary = [
    { label: 'Properties listed', value: pagination?.total ?? records.length, icon: Boxes },
    { label: 'Stock lists uploaded', value: uploadsQuery.data?.pagination.total ?? uploads.length, icon: FileSpreadsheet },
    { label: 'Awaiting your acknowledgement', value: pendingSelections.length, icon: UserCheck },
  ];

  return (
    <BuilderPortalShell
      title="Stock List"
      description="Upload your available stock in whatever format you keep it, and see which properties have been selected for a buyer."
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={itemsQuery.isFetching || busy}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', itemsQuery.isFetching && 'animate-spin')} aria-hidden />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)} disabled={busy}>
            {busy
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              : <Plus className="mr-2 h-4 w-4" aria-hidden />}
            Add stock list
          </Button>
        </>
      }
    >
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        accept={stockFileAcceptAttribute()}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) { setAddOpen(false); void handleFile(file); }
        }}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {summary.map(({ label, value, icon }) => (
          <BuilderPortalMetricCard key={label} icon={icon} label={label} value={value} />
        ))}
      </div>

      {progress ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>{PHASE_LABEL[progress.phase]}</span>
              {progress.phase === 'enriching' && progress.remaining ? (
                <span className="text-muted-foreground">{progress.remaining} propert{progress.remaining === 1 ? 'y' : 'ies'} left</span>
              ) : null}
            </div>
            <Progress value={PHASE_PERCENT[progress.phase]} />
            <p className="text-xs text-muted-foreground">
              Images are found after the properties are saved. If image lookup fails, your stock is still imported.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {lastSummary ? <ImportSummaryCard summary={lastSummary} /> : null}

      {pendingSelections.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Selected for a buyer</CardTitle>
            <CardDescription>
              A Command Centre adviser has selected these properties from your stock list.
              Acknowledge each one to confirm you have seen it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingSelections.map((selection) => (
              <div
                key={selection.id}
                className="flex flex-col gap-2 rounded-lg border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {selection.stock_item
                      ? stockItemTitle(selection.stock_item as never)
                      : 'A property from your stock'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Selected {new Date(selection.selected_at).toLocaleString('en-AU')}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={acknowledge.isPending}
                  onClick={() => {
                    acknowledge.mutate(selection.id, {
                      onSuccess: () => toast({ title: 'Acknowledged' }),
                      onError: (error) => toast({
                        title: 'Could not acknowledge',
                        description: (error as Error).message,
                        variant: 'destructive',
                      }),
                    });
                  }}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
                  Acknowledge
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="gap-3">
          <div>
            <CardTitle className="text-base">Your stock</CardTitle>
            <CardDescription>
              Properties imported from your stock lists. These are what the Command Centre sees.
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search address, suburb, development or reference"
                className="pl-9"
                aria-label="Search stock"
              />
            </div>
            <Select value={availability} onValueChange={setAvailability}>
              <SelectTrigger className="lg:w-52" aria-label="Filter by availability">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABILITY_FILTERS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={uploadFilter} onValueChange={setUploadFilter}>
              <SelectTrigger className="lg:w-64" aria-label="Filter by stock list">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stock lists</SelectItem>
                {uploads.map((upload) => (
                  <SelectItem key={upload.id} value={upload.id}>
                    {upload.original_filename}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {itemsQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading your stock…
            </div>
          ) : itemsQuery.isError ? (
            <div className="py-12 text-center text-sm text-destructive">
              {(itemsQuery.error as Error).message}
            </div>
          ) : !records.length ? (
            <div className="py-12 text-center">
              <Boxes className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden />
              <p className="mt-3 text-sm font-medium">
                {debounced || availability !== 'all' || uploadFilter !== 'all'
                  ? 'No stock matches those filters'
                  : 'No stock has been uploaded yet'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {debounced || availability !== 'all' || uploadFilter !== 'all'
                  ? 'Clear the filters to see everything you have uploaded.'
                  : 'Upload a spreadsheet, CSV, Word document, PDF or photograph of your schedule.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Property</TableHead>
                      <TableHead>Configuration</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Images</TableHead>
                      <TableHead>Availability</TableHead>
                      <TableHead>Selected</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((item) => (
                      <StockRow
                        key={item.id}
                        item={item}
                        saving={setAvailabilityMutation.isPending}
                        onAvailabilityChange={(next) => {
                          setAvailabilityMutation.mutate(
                            { stockItemId: item.id, availability: next },
                            {
                              onError: (error) => toast({
                                title: 'Could not update availability',
                                description: (error as Error).message,
                                variant: 'destructive',
                              }),
                            },
                          );
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>

              {pagination && pagination.total_pages > 1 ? (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Page {pagination.page} of {pagination.total_pages} · {pagination.total} properties
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline" size="sm" disabled={page <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden />
                      Previous
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      disabled={page >= pagination.total_pages}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Stock list sources</CardTitle>
            <CardDescription>
              Every stock list you have added — uploaded or linked — and what happened to it.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={enrichPending.isPending}
            onClick={() => {
              enrichPending.mutate(undefined, {
                onSuccess: (result) => toast({
                  title: result.processed
                    ? `Images found for ${result.processed} propert${result.processed === 1 ? 'y' : 'ies'}`
                    : 'Nothing was waiting for images',
                  description: result.remaining ? `${result.remaining} still to go.` : undefined,
                }),
                onError: (error) => toast({
                  title: 'Image lookup could not run',
                  description: (error as Error).message,
                  variant: 'destructive',
                }),
              });
            }}
          >
            {enrichPending.isPending
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              : <Sparkles className="mr-2 h-4 w-4" aria-hidden />}
            Retry image lookup
          </Button>
        </CardHeader>
        <CardContent>
          {!uploads.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No stock lists have been added yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead>Properties</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploads.map((upload) => (
                    <TableRow key={upload.id}>
                      <TableCell>
                        <p className="max-w-[18rem] truncate text-sm font-medium" title={stockSourceLabel(upload)}>
                          {stockSourceLabel(upload)}
                        </p>
                        <p className="max-w-[18rem] truncate text-xs text-muted-foreground">
                          {upload.source_type === 'url' && upload.source_url
                            ? upload.source_url
                            : formatFileSize(upload.byte_size)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-medium">
                          {upload.source_type === 'url'
                            ? <Link2 className="mr-1 h-3 w-3" aria-hidden />
                            : <Upload className="mr-1 h-3 w-3" aria-hidden />}
                          {STOCK_SOURCE_TYPE_LABELS[upload.source_type] ?? upload.source_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {new Date(upload.created_at).toLocaleString('en-AU')}
                      </TableCell>
                      <TableCell className="text-sm">
                        {upload.records_detected
                          ? `${upload.records_imported} new · ${upload.records_updated} updated`
                          : '—'}
                        {upload.records_failed ? (
                          <span className="block text-xs text-warning">
                            {upload.records_failed} could not be saved
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn('font-medium', STOCK_UPLOAD_STATUS_CLASSES[upload.status as StockUploadStatus])}
                        >
                          {STOCK_UPLOAD_STATUS_LABELS[upload.status as StockUploadStatus] ?? upload.status}
                        </Badge>
                        {upload.error_message ? (
                          <p className="mt-1 max-w-[22rem] text-xs text-muted-foreground">
                            {upload.error_message}
                          </p>
                        ) : null}
                        {upload.image_stage_summary
                          && Object.keys(upload.image_stage_summary).length ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Images: {Object.entries(upload.image_stage_summary)
                              .map(([stage, states]) =>
                                `${stage.replace(/_/g, ' ')} ${states.ready ?? 0}`)
                              .join(' · ')}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deleteSource.isPending || busy}
                          onClick={() => setPendingDelete(upload)}
                          aria-label={`Delete ${stockSourceLabel(upload)}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                          <span className="sr-only sm:not-sr-only sm:ml-2">Delete</span>
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

      {/* Add a source: a file from this computer, or an address to fetch. */}
      <Dialog open={addOpen} onOpenChange={(open) => { if (!busy) setAddOpen(open); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a stock list</DialogTitle>
            <DialogDescription>
              Upload a file, or paste a link and we will fetch it for you.
              Both are read the same way.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="file">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="file">
                <Upload className="mr-2 h-4 w-4" aria-hidden />
                Upload file
              </TabsTrigger>
              <TabsTrigger value="url">
                <Link2 className="mr-2 h-4 w-4" aria-hidden />
                Add from URL
              </TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="space-y-3 pt-4">
              <p className="text-sm text-muted-foreground">
                Spreadsheets (XLSX, XLS, ODS, CSV), documents (DOCX, ODT, RTF, PDF),
                web pages (HTML), data (JSON, XML), presentations (PPTX) and
                photographs of a printed schedule.
              </p>
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {busy
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  : <Upload className="mr-2 h-4 w-4" aria-hidden />}
                Choose a file
              </Button>
            </TabsContent>

            <TabsContent value="url" className="space-y-3 pt-4">
              <div className="space-y-2">
                <Label htmlFor="builder-stock-url">Stock list URL</Label>
                <Input
                  id="builder-stock-url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://example.com/stock-list"
                  disabled={busy}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !busy && sourceUrl.trim()) void handleUrl();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  A web page, a direct link to a spreadsheet or PDF, or a Notion page
                  you have shared publicly. The page is saved at the moment it is
                  imported, so later edits do not change what was brought in.
                </p>
              </div>
              <Button
                className="w-full"
                disabled={busy || !sourceUrl.trim()}
                onClick={() => void handleUrl()}
              >
                {busy
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  : <Link2 className="mr-2 h-4 w-4" aria-hidden />}
                Import stock list
              </Button>
            </TabsContent>
          </Tabs>

          {progress ? (
            <div className="space-y-2">
              <Progress value={PHASE_PERCENT[progress.phase]} />
              <p className="text-xs text-muted-foreground">{PHASE_LABEL[progress.phase]}</p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/*
        Deletion is explicit and says what it will do. A builder removing a
        source is saying "this should no longer supply stock", not "erase the
        record" — so the copy names the marketplace consequence and the fact
        that selections already made are kept.
      */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{pendingDelete ? stockSourceLabel(pendingDelete) : ''}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Properties this stock list is currently supplying will be removed from
              the Builder Stock marketplace straight away. Properties a newer stock
              list also supplies will stay. Any property already selected for a buyer
              keeps its record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSource.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteSource.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!pendingDelete) return;
                deleteSource.mutate(pendingDelete.id, {
                  onSuccess: (result) => {
                    const removed = result.removed;
                    toast({
                      title: 'Stock list deleted',
                      description: removed.archived === 1
                        ? '1 property was removed from the marketplace.'
                        : `${removed.archived} properties were removed from the marketplace.`,
                    });
                    setPendingDelete(null);
                    refreshAll();
                  },
                  // The source stays visible on failure — the UI never pretends
                  // a delete happened.
                  onError: (error) => toast({
                    title: 'The stock list could not be deleted',
                    description: (error as Error).message,
                    variant: 'destructive',
                  }),
                });
              }}
            >
              {deleteSource.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                : <Trash2 className="mr-2 h-4 w-4" aria-hidden />}
              Delete stock list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BuilderPortalShell>
  );
}

function ImportSummaryCard({ summary }: { summary: StockImportSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Last import</CardTitle>
        <CardDescription>
          {summary.detected} propert{summary.detected === 1 ? 'y was' : 'ies were'} read from the file.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-4">
          <span><strong className="tabular-nums">{summary.imported}</strong> new</span>
          <span><strong className="tabular-nums">{summary.updated}</strong> updated</span>
          {summary.failed ? (
            <span className="text-warning">
              <strong className="tabular-nums">{summary.failed}</strong> not saved
            </span>
          ) : null}
        </div>
        {summary.warnings.map((warning) => (
          <p key={warning} className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {warning}
          </p>
        ))}
        {summary.failures.length ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {summary.failures.map((failure, index) => (
              <li key={`${failure.label}-${index}`}>
                <span className="font-medium text-foreground">{failure.label}</span> — {failure.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StockRow({
  item, saving, onAvailabilityChange,
}: {
  item: BuilderStockItem;
  saving: boolean;
  onAvailabilityChange: (next: string) => void;
}) {
  const image = primaryStockImage(item);
  const stages = stockImageStageSummary(item);
  const configuration = stockItemConfiguration(item);
  const price = stockItemPrice(item);
  const locality = stockItemLocality(item);

  return (
    <TableRow>
      <TableCell>
        <p className="max-w-[20rem] truncate text-sm font-medium">{stockItemTitle(item)}</p>
        {locality ? <p className="text-xs text-muted-foreground">{locality}</p> : null}
        {item.external_reference ? (
          <p className="text-xs text-muted-foreground">Ref {item.external_reference}</p>
        ) : null}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{configuration ?? '—'}</TableCell>
      <TableCell className="whitespace-nowrap text-sm">{price ?? '—'}</TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs">
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            {image
              ? STOCK_IMAGE_STAGE_BADGES[image.source_stage]
              : <span className="text-muted-foreground">No image yet</span>}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {stages.map((stage) => `${stage.label}: ${stage.ready || '—'}`).join(' · ')}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <Select
          value={item.availability_status}
          onValueChange={onAvailabilityChange}
          disabled={saving}
        >
          <SelectTrigger className="w-40" aria-label={`Availability for ${stockItemTitle(item)}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {item.availability_status === 'unknown' ? (
              <SelectItem value="unknown">{STOCK_AVAILABILITY_LABELS.unknown}</SelectItem>
            ) : null}
            {SETTABLE_AVAILABILITY.map((status) => (
              <SelectItem key={status} value={status}>{STOCK_AVAILABILITY_LABELS[status]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {item.latest_selection ? (
          <Badge variant="outline" className={cn('font-medium', STOCK_AVAILABILITY_CLASSES.on_hold)}>
            {STOCK_SELECTION_STATUS_LABELS[item.latest_selection.status]}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}
