/**
 * The control that hands someone a typeset Client Details report.
 *
 * ## Three destinations, because a download is the least important one
 *
 * The document this replaces is read by a mortgage broker more often than by
 * anyone here. So this control offers the same three destinations the legacy
 * does — save it, attach it to an email, send it through the Finance Portal —
 * and the value of the migration lands on the last two: what arrives is real,
 * selectable, searchable text instead of a stack of page images.
 *
 * `deliverClientDetailsPdf` returns the `Blob` for exactly this reason.
 *
 * ## It sits beside the legacy, not in place of it
 *
 * `FormaraPDFGenerator` keeps both its buttons and both its paths. This is an
 * additional control, and where the route is not deployed yet it says so and
 * names the ones that work.
 */
import { useState } from 'react';
import { ChevronDown, Download, Loader2, Mail, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useReportTemplateMenu } from '@/components/reports/useReportTemplateMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useFinanceContacts } from '@/hooks/useFinanceContacts';
import { deliverClientDetailsPdf } from '@/lib/reports/clientDetails/deliverClientDetailsPdf';

export interface ClientDetailsDownloadButtonProps {
  /** The `clients` row to typeset. The only thing the server is told. */
  clientId: string;
  clientName: string;
  /** Hands the document to the email composer as an attachment. */
  onAttachToEmail?: (blob: Blob, fileName: string) => void;
  /** Called after a successful Finance Portal share, to refresh a list. */
  onShared?: () => void;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

/** Blob → base64, the encoding `share-report-with-finance` expects. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function ClientDetailsDownloadButton({
  clientId,
  clientName,
  onAttachToEmail,
  onShared,
  variant = 'outline',
  size = 'sm',
  className,
}: ClientDetailsDownloadButtonProps) {
  const [running, setRunning] = useState(false);
  const { contacts, defaultContact } = useFinanceContacts();
  // Which template this comes out in, answered here rather than on the
  // Template Library page a person would have to know to visit.
  const template = useReportTemplateMenu('client_details');

  /**
   * Produce the document once, then do whatever was asked with it.
   *
   * Errors surface as a toast with the renderer's own message — which for an
   * undeployed route names the buttons that still work.
   */
  const run = async (
    what: 'download' | 'email' | 'finance',
  ) => {
    if (running) return;
    setRunning(true);
    try {
      const result = await deliverClientDetailsPdf(clientId, { save: what === 'download' });

      if (result.brandGaps.length) {
        // Said at the moment someone is about to send it, not buried in a log.
        toast.warning(`Report ready, with gaps: ${result.brandGaps.join('; ')}`);
      }

      if (what === 'download') {
        if (!result.brandGaps.length) {
          toast.success(
            `Client Details ready${result.pageCount ? ` — ${result.pageCount} pages` : ''}`,
          );
        }
        return;
      }

      if (what === 'email') {
        onAttachToEmail?.(result.blob, result.fileName);
        toast.success('Typeset report attached to the email');
        return;
      }

      if (!defaultContact) {
        toast.error('No finance contacts configured. Add contacts in Settings → Finance Agent Contacts.');
        return;
      }

      const { data, error } = await invokeSecureFunction('share-report-with-finance', {
        client_id: clientId,
        finance_contact_id: defaultContact.id,
        filename: result.fileName,
        content_base64: await toBase64(result.blob),
        mime_type: 'application/pdf',
      });
      if (error || !data?.success) {
        throw new Error(error?.message || data?.error || 'Finance Portal share failed');
      }
      toast.success(`Shared with ${defaultContact.name} through the Finance Portal`);
      onShared?.();
    } catch (e) {
      console.error('[ClientDetailsDownloadButton]', e);
      toast.error(e instanceof Error ? e.message : 'Could not produce the report');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={cn('inline-flex items-stretch', className)}>
      <Button
        variant={variant}
        size={size}
        disabled={running}
        onClick={() => run('download')}
        className="gap-2 rounded-r-none"
        title={`Typeset client details for ${clientName}`}
      >
        {running
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <Sparkles className="h-4 w-4 text-primary" />}
        {running ? 'Rendering…' : 'Typeset details'}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={running}
            aria-label="Other destinations for the typeset report"
            className="rounded-l-none border-l-0 px-2"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Where the typeset report should go
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); run('download'); }}
            className="cursor-pointer"
          >
            <Download className="mr-2 h-4 w-4 text-muted-foreground" />
            <div className="flex flex-col">
              <span>Download</span>
              <span className="text-xs text-muted-foreground">Save it to this device.</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); run('email'); }}
            disabled={!onAttachToEmail}
            className="cursor-pointer"
          >
            <Mail className="mr-2 h-4 w-4 text-muted-foreground" />
            <div className="flex flex-col">
              <span>Attach to an email</span>
              <span className="text-xs text-muted-foreground">
                {onAttachToEmail
                  ? 'Opens the composer with the report attached.'
                  : 'Not available from this screen.'}
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); run('finance'); }}
            disabled={!contacts.length}
            className="cursor-pointer"
          >
            <Send className="mr-2 h-4 w-4 text-info" />
            <div className="flex flex-col">
              <span>Send to {defaultContact?.name ?? 'finance'}</span>
              {/* The sentence this migration exists for. */}
              <span className="text-xs text-muted-foreground">
                {contacts.length
                  ? 'Through the Finance Portal, as selectable text a broker can copy from.'
                  : 'Add a contact in Settings → Finance Agent Contacts first.'}
              </span>
            </div>
          </DropdownMenuItem>
          {template.section}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Outside the menu: Radix unmounts the menu's content when it closes,
          and a dialog rendered inside would go with it. */}
      {template.dialog}
    </div>
  );
}
