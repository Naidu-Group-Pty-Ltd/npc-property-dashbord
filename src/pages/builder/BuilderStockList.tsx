import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Boxes, CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet,
  Image as ImageIcon, Loader2, RefreshCw, Search, Sparkles, Upload, UserCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
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
  useAcknowledgeStockSelection, useBuilderStockItems, useBuilderStockSelections,
  useBuilderStockUploads, useEnrichPendingStockImages, useSetBuilderStockAvailability,
  uploadBuilderStockFile, type StockImportSummary, type StockUploadProgress,
} from '@/lib/builderStockQueries';
import {
  formatFileSize, primaryStockImage, stockFileAcceptAttribute, stockImageStageSummary,
  stockItemConfiguration, stockItemLocality, stockItemPrice, stockItemTitle,
  MAX_STOCK_FILE_BYTES, STOCK_AVAILABILITY_CLASSES, STOCK_AVAILABILITY_LABELS,
  STOCK_IMAGE_STAGE_BADGES, STOCK_SELECTION_STATUS_LABELS, STOCK_UPLOAD_STATUS_CLASSES,
  STOCK_UPLOAD_STATUS_LABELS, type BuilderStockItem, type StockAvailability,
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
      setLastSummary(result.summary);
      toast({
        title: 'Stock list imported',
        description: `${result.summary.imported} new and ${result.summary.updated} updated from ${result.summary.detected} propert${result.summary.detected === 1 ? 'y' : 'ies'}.`,
      });
      refreshAll();
    } catch (error) {
      const failure = error as Error & { code?: string };
      toast({
        title: failure.code === 'duplicate_file' ? 'Already imported' : 'The stock list could not be imported',
        description: failure.message,
        variant: failure.code === 'duplicate_file' ? 'default' : 'destructive',
      });
      void uploadsQuery.refetch();
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }, [refreshAll, toast, uploadsQuery]);

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
          <Button size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
            {busy
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              : <Upload className="mr-2 h-4 w-4" aria-hidden />}
            Upload stock list
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
          if (file) void handleFile(file);
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
            <CardTitle className="text-base">Upload history</CardTitle>
            <CardDescription>
              Every stock list you have sent, and what happened to it.
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
              No stock lists have been uploaded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead>Properties</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploads.map((upload) => (
                    <TableRow key={upload.id}>
                      <TableCell>
                        <p className="max-w-[18rem] truncate text-sm font-medium">{upload.original_filename}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(upload.byte_size)}</p>
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
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
