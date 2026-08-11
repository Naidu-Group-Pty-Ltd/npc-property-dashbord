/**
 * The exact typeset document, in-app.
 *
 * The digital view is the working representation; this shows the white-labelled
 * PDF exactly as WeasyPrint produces it. Two things this had wrong and which the
 * fix is deliberate about:
 *
 * 1. The dialog was `max-w-5xl` inside a 90vh box, so a portrait A4 page — the
 *    cover, which is the one page that is all layout — was scaled to the frame's
 *    WIDTH and then clipped by its height. Chrome's viewer defaults to
 *    fit-width, so the bottom of every cover was cut off. The frame is now as
 *    tall and wide as the viewport allows and the viewer is asked for
 *    `view=Fit`, which fits the whole page, cover included.
 * 2. There was no way out of the iframe. A native viewer that fails to
 *    initialise (some managed Chrome builds, in-app webviews) left a blank
 *    panel, so the document is also reachable in a new tab and as a download.
 *
 * The blob URL is revoked when the dialog closes.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { fetchAgreementPreviewUrl } from '@/hooks/useAgreementCentre';
import { toast } from 'sonner';

interface Props {
  agreementId: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Fit the WHOLE page, not the width — the cover has no reflowable content, so
 * fit-width guarantees a clipped page in a landscape frame.
 */
const VIEWER_HINTS = '#view=Fit&pagemode=none&toolbar=1&navpanes=0&scrollbar=1';

export default function PdfPreviewDialog({ agreementId, onOpenChange }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

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
  }, [agreementId, nonce]);

  const download = () => {
    if (!url) return;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'agreement-preview.pdf';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <Dialog open={!!agreementId} onOpenChange={onOpenChange}>
      {/*
        `bareLayout` is essential here: the shared dialog treatment applies
        `sm:w-full sm:max-w-lg` in a media query, which outranks any unprefixed
        width class a caller passes — that is what squeezed this dialog to
        ~512px and stacked the title one letter per line. Owning the layout
        outright keeps the A4 page fitted.
      */}
      <DialogContent
        bareLayout
        className="fixed left-1/2 top-1/2 z-50 flex h-[96dvh] w-[96vw] max-w-[1400px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-hidden rounded-xl p-4 sm:p-5"
      >
        <DialogHeader className="shrink-0 flex-row flex-wrap items-center justify-between gap-3 space-y-0 pr-10 text-left">
          <div className="min-w-[16rem] flex-1">
            <DialogTitle>Document preview</DialogTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The exact printed form, fitted to the page. Every edit on the preview step re-renders here.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={loading} onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-render
            </Button>
            <Button variant="outline" size="sm" disabled={!url}
              onClick={() => url && window.open(`${url}${VIEWER_HINTS}`, '_blank', 'noopener,noreferrer')}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in new tab
            </Button>
            <Button variant="outline" size="sm" disabled={!url} onClick={download}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Download
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-muted/30">
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Typesetting the agreement…</p>
            </div>
          ) : url ? (
            <object title="Agreement preview" data={`${url}${VIEWER_HINTS}`} type="application/pdf" className="h-full w-full">
              {/* No native viewer: say so and offer the two paths that always work. */}
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  This browser cannot display PDFs inline.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline"
                    onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in new tab
                  </Button>
                  <Button size="sm" onClick={download}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Download PDF
                  </Button>
                </div>
              </div>
            </object>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
