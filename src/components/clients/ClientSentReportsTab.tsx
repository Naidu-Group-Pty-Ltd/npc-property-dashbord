import { useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import {
  FileText, Loader2, EyeOff, Clock, Send, Plus, Trash2, Download,
  BarChart3, PiggyBank, TrendingUp, FileBarChart, Upload, X, File, CheckCircle2
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { secureStorageUpload, secureStorageDownload } from '@/hooks/useSecureStorage';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';

interface ClientSentReportsTabProps {
  clientId: string;
  clientName: string;
}

const reportTypeConfig: Record<string, { label: string; icon: typeof FileText; color: string }> = {
  investment: { label: 'Investment Report', icon: FileBarChart, color: 'bg-info/10 text-info' },
  portfolio: { label: PORTFOLIO_REPORT_LABEL, icon: BarChart3, color: 'bg-success/10 text-success' },
  borrowing_capacity: { label: 'Borrowing Capacity', icon: PiggyBank, color: 'bg-brand-500/10 text-brand-600' },
  cash_flow: { label: 'Cash Flow Analysis', icon: TrendingUp, color: 'bg-accent/10 text-accent' },
  general: { label: 'General', icon: FileText, color: 'bg-muted text-muted-foreground' },
};

function getReportConfig(type: string) {
  return reportTypeConfig[type] || reportTypeConfig.general;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ClientSentReportsTab({ clientId, clientName }: ClientSentReportsTabProps) {
  const queryClient = useQueryClient();
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = async (report: any) => {
    if (!report.storage_path) {
      toast.error('No file available for this report');
      return;
    }
    setDownloadingId(report.id);
    try {
      const result = await secureStorageDownload('client-files', report.storage_path);
      if (!result.success || !result.blob) {
        throw new Error(result.error || 'Download failed');
      }
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = report.storage_path.split('.').pop() || 'pdf';
      a.download = `${(report.report_title || 'Report').replace(/\s+/g, '_')}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch (err: any) {
      toast.error('Failed to download: ' + (err.message || 'Unknown error'));
    } finally {
      setDownloadingId(null);
    }
  };
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newReport, setNewReport] = useState({
    report_title: '',
    report_type: '',
    report_tier: '',
    notes: '',
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['client-portal-reports', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'client_portal_reports',
          select: '*',
          filters: { client_id: clientId },
          orderBy: 'published_at',
          orderAsc: false,
        },
      });
      if (error) throw error;
      return data?.records || [];
    },
  });

  const reports = data || [];

  const handleFileSelect = (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      toast.error('File too large (max 25MB)');
      return;
    }
    setUploadedFile(file);
    // Auto-fill title from filename if empty
    if (!newReport.report_title) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
      setNewReport(p => ({ ...p, report_title: nameWithoutExt }));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handlePublish = async () => {
    if (!newReport.report_title.trim()) {
      toast.error('Report title is required');
      return;
    }
    if (!uploadedFile) {
      toast.error('Please upload a file');
      return;
    }

    setPublishing(true);
    try {
      // Upload file to storage
      const safeName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
      const dateStr = format(new Date(), 'yyyy-MM-dd_HHmmss');
      const ext = uploadedFile.name.split('.').pop() || 'pdf';
      const storagePath = `portal-reports/${clientId}/${safeName}_${dateStr}.${ext}`;

      const uploadResult = await secureStorageUpload('client-files', storagePath, uploadedFile, {
        contentType: uploadedFile.type || 'application/octet-stream',
        upsert: true,
        // The client this file belongs to. `secure-storage` derives the
        // destination and the owner from it and refuses the upload without it.
        resourceId: clientId,
      });

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || 'File upload failed');
      }

      // Create portal report record
      const { error } = await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'client_portal_reports',
        clientId,
        data: {
          report_title: newReport.report_title,
          report_type: newReport.report_type || 'general',
          report_tier: newReport.report_tier || null,
          storage_path: storagePath,
          notes: newReport.notes || null,
          published_at: new Date().toISOString(),
        },
      });
      if (error) throw error;

      toast.success('Report published to portal');
      setShowPublishDialog(false);
      setNewReport({ report_title: '', report_type: '', report_tier: '', notes: '' });
      setUploadedFile(null);
      queryClient.invalidateQueries({ queryKey: ['client-portal-reports', clientId] });
    } catch (err: any) {
      toast.error('Failed to publish: ' + (err.message || 'Unknown error'));
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    if (!reportToDelete) return;
    setDeleting(true);
    try {
      const { error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_portal_reports',
        clientId,
        recordId: reportToDelete.id,
      });
      if (error) throw error;
      toast.success('Report removed from client portal');
      setReportToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['client-portal-reports', clientId] });
    } catch (err: any) {
      toast.error('Failed to delete: ' + (err.message || 'Unknown error'));
    } finally {
      setDeleting(false);
    }
  };

  const handleClosePublish = (open: boolean) => {
    if (!open) {
      setShowPublishDialog(false);
      setUploadedFile(null);
      setNewReport({ report_title: '', report_type: '', report_tier: '', notes: '' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Sent Reports</h3>
          <p className="text-xs text-muted-foreground">Reports published to {clientName}'s portal</p>
        </div>
        <Button size="sm" onClick={() => setShowPublishDialog(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Publish Report
        </Button>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Send className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No reports have been sent to this client's portal yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {reports.map((report: any) => {
            const config = getReportConfig(report.report_type);
            const Icon = config.icon;
            return (
              <Card key={report.id}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${config.color} shrink-0`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="text-sm font-medium text-foreground truncate">{report.report_title}</p>
                        {report.is_read ? (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <CheckCircle2 className="h-2.5 w-2.5 text-success-foreground0" />
                            Read
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] gap-1">
                            <EyeOff className="h-2.5 w-2.5" />
                            Unread
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">{config.label}</Badge>
                        <span>•</span>
                        <Clock className="h-3 w-3" />
                        <span>{report.published_at ? formatDistanceToNow(new Date(report.published_at), { addSuffix: true }) : '—'}</span>
                      </div>
                      {report.notes && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{report.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        {report.published_at && format(new Date(report.published_at), 'dd MMM yyyy')}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleDownload(report)}
                        disabled={downloadingId === report.id || !report.storage_path}
                        title="Download report"
                      >
                        {downloadingId === report.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {report.storage_path && /\.pdf$/i.test(report.storage_path) && (
                        <FlattenPdfIconButton
                          getPdfBlob={async () => {
                            const r = await secureStorageDownload('client-files', report.storage_path);
                            if (!r.success || !r.blob) throw new Error(r.error || 'Download failed');
                            return r.blob;
                          }}
                          filename={`${(report.report_title || 'Report').replace(/\s+/g, '_')}.pdf`}
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={downloadingId === report.id}
                        />
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setReportToDelete(report)}
                        title="Remove from portal"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!reportToDelete} onOpenChange={() => !deleting && setReportToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Report from Portal</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove "<strong>{reportToDelete?.report_title}</strong>" from {clientName}'s portal. They will no longer be able to view or download it. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish Dialog */}
      <Dialog open={showPublishDialog} onOpenChange={handleClosePublish}>
        <DialogContent className="w-[92vw] max-w-[680px] max-h-[90vh] overflow-x-hidden overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Publish Report to Portal
            </DialogTitle>
            <DialogDescription>Upload a file and publish it to {clientName}'s client portal.</DialogDescription>
          </DialogHeader>
          <div className="w-full max-w-full min-w-0 space-y-4 mt-2">
            {/* Drag & Drop Upload Zone */}
            <div className="w-full max-w-full min-w-0">
              <Label>Upload File *</Label>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileInputChange}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg"
              />
              {uploadedFile ? (
                <div className="mt-1.5 w-full flex items-center gap-3 rounded-lg border bg-muted/50 p-3 min-w-0">
                  <File className="h-8 w-8 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{uploadedFile.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(uploadedFile.size)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setUploadedFile(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'mt-1.5 w-full flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors',
                    isDragging
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30'
                  )}
                >
                  <Upload className={cn('h-8 w-8', isDragging ? 'text-primary' : 'text-muted-foreground/50')} />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">
                      {isDragging ? 'Drop file here' : 'Drag & drop or click to upload'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">PDF, Word, Excel, images – max 25MB</p>
                  </div>
                </div>
              )}
            </div>

            {/* Report Title */}
            <div className="w-full max-w-full min-w-0">
              <Label>Report Title *</Label>
              <Input
                className="w-full max-w-full box-border"
                value={newReport.report_title}
                onChange={(e) => setNewReport(p => ({ ...p, report_title: e.target.value }))}
                placeholder="e.g., Investment Analysis - 123 Main St"
              />
            </div>

            {/* Report Type - Optional */}
            <div className="w-full max-w-full min-w-0">
              <Label>Report Category <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Select value={newReport.report_type} onValueChange={(v) => setNewReport(p => ({ ...p, report_type: v }))}>
              <SelectTrigger className="w-full max-w-full box-border">
                  <SelectValue placeholder="Select a category..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="investment">Investment Report</SelectItem>
                  <SelectItem value="portfolio">{PORTFOLIO_REPORT_LABEL}</SelectItem>
                  <SelectItem value="borrowing_capacity">Borrowing Capacity</SelectItem>
                  <SelectItem value="cash_flow">Cash Flow Analysis</SelectItem>
                  <SelectItem value="general">General Document</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="w-full max-w-full min-w-0">
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                className="w-full max-w-full box-border resize-y"
                value={newReport.notes}
                onChange={(e) => setNewReport(p => ({ ...p, notes: e.target.value }))}
                placeholder="Brief note for internal tracking..."
                rows={2}
              />
            </div>

            <Button onClick={handlePublish} disabled={publishing || !uploadedFile || !newReport.report_title.trim()} className="w-full">
              {publishing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading & Publishing...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Publish to Portal
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
