/**
 * The control that hands someone a typeset Report Q&A document.
 *
 * ## Three subjects, because the feature has three documents
 *
 * The Q&A export is four PDF implementations across three libraries, and they
 * do not produce the same thing: a structured write-up of the conversation, one
 * answer, and the transcript. This offers all three from one place and renders
 * all three with one renderer — which is the migration, since the reason the
 * same table-rendering bug got fixed in one jsPDF copy and not the other two is
 * that there were three of them.
 *
 * ## It sits beside the legacy, not in place of it
 *
 * `ConversationReportEditor`, `MessageReportEditor` and the `generate-qa-pdf`
 * action all keep working, as do the `.txt` / `.csv` / `.md` / `.json` exports —
 * the last of which is what this document's own truncation notice points at.
 * Where the route is not deployed yet this says so and names the ones that work.
 *
 * ## Two destinations
 *
 * Saved, and — for the whole-conversation subjects — posted into the
 * conversation as an attachment, which is what makes it reachable by the
 * in-place email composer. `deliverReportQaPdf` returns the `Blob` for the first
 * and the route writes the attachment row for the second.
 */
import { useState } from 'react';
import { ChevronDown, FileText, Loader2, MessageSquareText, Paperclip, Sparkles } from 'lucide-react';
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
import { deliverReportQaPdf } from '@/lib/reports/reportQa/deliverReportQaPdf';
import type { ReportQaSubjectName } from '@/lib/reports/reportQa/requestReportQaPdf';

export interface ReportQaDownloadButtonProps {
  /** The conversation to typeset. The only identifier the server is told. */
  conversationId: string | null;
  /**
   * Restrict the control to one subject.
   *
   * The message editor uses this: there is one answer on screen and offering to
   * typeset the whole conversation from it would be a different document from
   * the one the button is next to.
   */
  only?: ReportQaSubjectName;
  /** Required when `only` is `answer`. */
  messageId?: string | null;
  /** Hands the document to a composer as an attachment, where one exists. */
  onAttachToEmail?: (blob: Blob, fileName: string) => void;
  /** Called after the file was posted into the conversation, to refresh it. */
  onAttached?: () => void;
  label?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

const SUBJECT_TITLE: Record<ReportQaSubjectName, string> = {
  structured: 'Structured report',
  answer: 'This answer',
  transcript: 'Full transcript',
};

const SUBJECT_NOTE: Record<ReportQaSubjectName, string> = {
  structured: 'The conversation written up as a report. Uses AI.',
  answer: 'One answer, typeset on its own.',
  transcript: 'Every question and answer, as they happened.',
};

export function ReportQaDownloadButton({
  conversationId,
  only,
  messageId,
  onAttachToEmail,
  onAttached,
  label = 'Typeset PDF',
  variant = 'outline',
  size = 'sm',
  className,
}: ReportQaDownloadButtonProps) {
  const [running, setRunning] = useState<ReportQaSubjectName | null>(null);
  // Which template this comes out in, offered beside the button that uses it.
  const template = useReportTemplateMenu('qa');

  const run = async (
    subject: ReportQaSubjectName,
    options: { attach?: boolean; email?: boolean } = {},
  ) => {
    if (!conversationId) {
      toast.error('Start a conversation first');
      return;
    }
    setRunning(subject);
    try {
      const result = await deliverReportQaPdf(conversationId, subject, {
        messageId: messageId ?? null,
        // Only the structured subject can spend tokens, and only when the
        // conversation has no write-up stored. Asking for that subject is the
        // consent — the menu item says "Uses AI" beside it.
        generateIfMissing: subject === 'structured',
        attachToConversation: options.attach === true,
        save: !options.email && !options.attach,
      });

      if (options.email) onAttachToEmail?.(result.blob, result.fileName);
      if (options.attach) onAttached?.();

      const notes: string[] = [];
      if (result.pageCount) notes.push(`${result.pageCount} pages`);
      if (result.truncated) {
        notes.push(`${result.turnsShown} of ${result.turnCount} exchanges — the rest is in the .md export`);
      }
      if (result.generated) notes.push('written up by AI');
      if (result.brandGaps.length) notes.push(`brand incomplete: ${result.brandGaps.join(', ')}`);

      toast.success(result.fileName, { description: notes.join(' · ') || undefined });
    } catch (e) {
      // The renderer's own message, in front of the person who pressed the
      // button. It names what is missing — an undeployed route, a conversation
      // with no write-up stored — and what still works.
      toast.error(e instanceof Error ? e.message : 'Could not produce the document');
    } finally {
      setRunning(null);
    }
  };

  const busy = running !== null;

  // One subject, one button. Nothing to choose between, so nothing to open.
  if (only) {
    return (
      <Button
        variant={variant}
        size={size}
        className={cn('gap-1.5', className)}
        disabled={busy || !conversationId}
        onClick={() => run(only)}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        {label}
      </Button>
    );
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={cn('gap-1.5', className)}
          disabled={busy || !conversationId}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
          {label}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Typeset document</DropdownMenuLabel>
        {(['structured', 'transcript'] as const).map((subject) => (
          <DropdownMenuItem
            key={subject}
            disabled={busy}
            onClick={() => run(subject)}
            className="flex-col items-start gap-0.5"
          >
            <span className="flex items-center gap-2 font-medium">
              {subject === 'structured'
                ? <Sparkles className="h-3.5 w-3.5 text-primary" />
                : <MessageSquareText className="h-3.5 w-3.5" />}
              {SUBJECT_TITLE[subject]}
            </span>
            <span className="pl-5 text-xs text-muted-foreground">{SUBJECT_NOTE[subject]}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onClick={() => run('transcript', { attach: true })}>
          <Paperclip className="mr-2 h-3.5 w-3.5" />
          Add transcript to this chat
        </DropdownMenuItem>
        {template.section}
      </DropdownMenuContent>
    </DropdownMenu>
    {/* Outside the menu: its content unmounts on close and would take the
        dialog with it. */}
    {template.dialog}
    </>
  );
}
