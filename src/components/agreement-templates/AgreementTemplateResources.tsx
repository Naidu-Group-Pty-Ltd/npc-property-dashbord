/**
 * The template desk — the whole of the platform's involvement in partner
 * agreements.
 *
 * ONE component, rendered by both the Command Centre and the Finance Portal.
 * That is deliberate and is the point: both parties are looking at the same
 * neutral resource on the same terms. Two implementations would drift, and the
 * first thing to drift would be how strongly each side is told the platform is
 * not involved.
 *
 * There is no "configure", no "issue", no "send to partner" and no status.
 * Downloading is the end of it — see `templateResource.pure.ts`.
 */
import { useState } from 'react';
import { Download, FileText, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AGREEMENT_TEMPLATE_SUMMARIES,
  TEMPLATE_NEUTRALITY_NOTICE,
  TEMPLATE_RESOURCE_INTRO,
  type AgreementTemplateKey,
} from '@/lib/agreements';

export interface AgreementTemplateResourcesProps {
  /**
   * Word is the primary format: an external platform can ingest it and a
   * reviewer can mark it up. A PDF of a blank template is a document nobody
   * can fill in — which is why the PDF is optional and secondary.
   */
  onDownloadDocx: (key: AgreementTemplateKey) => Promise<void>;
  onDownloadPdf?: (key: AgreementTemplateKey) => Promise<void>;
}

export function AgreementTemplateResources({
  onDownloadDocx,
  onDownloadPdf,
}: AgreementTemplateResourcesProps) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (id: string, action: () => Promise<void>) => {
    try {
      setBusy(id);
      await action();
      toast.success('Template downloaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The template could not be downloaded.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{TEMPLATE_RESOURCE_INTRO}</p>

      {/* Stated before the downloads, not after them. A notice underneath the
          thing it qualifies is a notice most people never reach. */}
      <div className="flex gap-3 rounded-xl border border-border bg-muted/30 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1.5">
          {TEMPLATE_NEUTRALITY_NOTICE.map((line) => (
            <p key={line} className="text-xs leading-relaxed text-muted-foreground">{line}</p>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {AGREEMENT_TEMPLATE_SUMMARIES.map((template) => (
          <Card key={template.key}>
            <CardContent className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-4 w-4 text-primary" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="font-serif text-base font-semibold leading-snug text-foreground">
                    {template.title}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {template.referralFlow}
                  </p>
                </div>
              </div>

              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => run(`${template.key}:docx`, () => onDownloadDocx(template.key))}
                >
                  {busy === `${template.key}:docx`
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    : <Download className="mr-1.5 h-3.5 w-3.5" />}
                  Word (.docx)
                </Button>
                {onDownloadPdf ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => run(`${template.key}:pdf`, () => onDownloadPdf(template.key))}
                  >
                    {busy === `${template.key}:pdf`
                      ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    PDF
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default AgreementTemplateResources;
