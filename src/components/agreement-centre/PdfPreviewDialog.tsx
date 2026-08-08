/**
 * The exact typeset document, in-app. The digital view is the working
 * representation; this shows the white-labelled PDF exactly as WeasyPrint
 * produces it (page-by-page navigation, zoom and fit come from the browser's
 * native viewer). The blob URL is revoked when the dialog closes.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { fetchAgreementPreviewUrl } from '@/hooks/useAgreementCentre';
import { toast } from 'sonner';

interface Props {
  agreementId: string | null;
  onOpenChange: (open: boolean) => void;
}

export default function PdfPreviewDialog({ agreementId, onOpenChange }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (agreementId) {
      setLoading(true);
      setUrl(null);
      fetchAgreementPreviewUrl(agreementId)
        .then(({ url: nextUrl, gaps }) => {
          if (cancelled) { URL.revokeObjectURL(nextUrl); return; }
          objectUrl = nextUrl;
          setUrl(nextUrl);
          if (gaps.length) toast.info(`Brand gaps: ${gaps.join('; ')}`);
        })
        .catch((error: Error) => {
          if (!cancelled) {
            toast.error(error.message);
            onOpenChange(false);
          }
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [agreementId]);

  return (
    <Dialog open={!!agreementId} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-5xl flex-col p-4">
        <DialogHeader className="shrink-0">
          <DialogTitle>Document preview</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-muted/30">
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Typesetting the agreement…</p>
            </div>
          ) : url ? (
            <iframe title="Agreement preview" src={url} className="h-full w-full" />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
