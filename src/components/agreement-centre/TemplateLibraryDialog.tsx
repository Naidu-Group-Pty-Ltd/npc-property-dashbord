/**
 * The template library — a download desk, not a second way to start an
 * agreement.
 *
 * Two jobs live behind the Agreement Centre's header and they are not the
 * same job: **Create Agreement** begins the guided, tracked, digitally
 * issuable lifecycle, and goes straight into the wizard. **Templates** is for
 * the business that runs signing somewhere else — DocuSign, PandaDoc, a
 * lawyer's inbox — and wants the white-labelled Word file to take with them.
 * Showing the same picker for both made the two indistinguishable, which is
 * what this component exists to fix: there is no "Configure" action here.
 *
 * Word is the format on purpose. It is the one an external platform can
 * ingest and a reviewer can mark up; a PDF of a blank template is a document
 * nobody can fill in.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ArrowRight, Download, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AGREEMENT_TEMPLATE_SUMMARIES, type AgreementTemplateKey } from '@/lib/agreements';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: (templateKey: AgreementTemplateKey) => Promise<void>;
}

export default function TemplateLibraryDialog({ open, onOpenChange, onDownload }: Props) {
  const [downloading, setDownloading] = useState<string | null>(null);

  const handle = async (templateKey: AgreementTemplateKey) => {
    try {
      setDownloading(templateKey);
      await onDownload(templateKey);
      toast.success('Template downloaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Template download failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agreement templates</DialogTitle>
          <DialogDescription>
            Download the white-labelled Word template to prepare or send through your own
            platform — DocuSign, PandaDoc, or your legal adviser. Your organisation&apos;s
            details are filled in; every negotiable field is left for you to complete.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {AGREEMENT_TEMPLATE_SUMMARIES.map((template) => (
            <div
              key={template.key}
              className="flex flex-col rounded-xl border border-border bg-card/50 p-4"
            >
              <div className="flex items-center justify-center gap-2 rounded-lg bg-muted/40 px-2 py-3 text-center">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {template.from}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {template.to}
                </span>
              </div>
              <h3 className="mt-3 font-serif text-base font-semibold leading-snug text-foreground">
                {template.title}
              </h3>
              <p className="mt-1.5 flex-1 text-xs leading-relaxed text-muted-foreground">
                {template.referralFlow}
              </p>
              <Button
                className="mt-3 w-full"
                disabled={downloading !== null}
                onClick={() => handle(template.key)}
              >
                {downloading === template.key
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Download className="mr-2 h-4 w-4" />}
                Download Word template
              </Button>
            </div>
          ))}
        </div>

        <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The wording is locked legal content and is identical to the agreements issued
            through the portal. To track review, issuance and signature inside the Command
            Centre instead, use <strong className="font-medium text-foreground">Create Agreement</strong>.
          </span>
        </p>
      </DialogContent>
    </Dialog>
  );
}
