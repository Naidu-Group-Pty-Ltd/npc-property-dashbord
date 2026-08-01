/**
 * Attachment chips for internal messages — used by both the Aurixa messages
 * panel and the pop-up conversation bubbles.
 */
import { useState } from 'react';
import { Download, FileText, Image as ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatAttachmentSize,
  isImageAttachment,
  openInternalAttachment,
  type InternalAttachment,
} from '@/lib/internalMessageAttachments';

/** Read-only list rendered inside a message bubble. */
export function InternalAttachmentList({
  threadId,
  attachments,
  mine,
  className,
}: {
  threadId: string;
  attachments: InternalAttachment[];
  mine?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!attachments?.length) return null;

  return (
    <div className={cn('mt-1 flex flex-col gap-1', className)}>
      {attachments.map((a) => {
        const Icon = isImageAttachment(a) ? ImageIcon : FileText;
        return (
          <button
            key={a.path}
            type="button"
            onClick={async () => {
              setBusy(a.path);
              try {
                await openInternalAttachment(threadId, a);
              } finally {
                setBusy(null);
              }
            }}
            className={cn(
              'flex max-w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-[11px] transition-colors',
              mine
                ? 'border-primary-foreground/25 bg-primary-foreground/10 hover:bg-primary-foreground/20'
                : 'border-border/60 bg-background/60 hover:bg-muted',
            )}
            title={`Open ${a.name}`}
          >
            {busy === a.path ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <Icon className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
            {a.size ? (
              <span className="shrink-0 opacity-70">{formatAttachmentSize(a.size)}</span>
            ) : null}
            <Download className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/** Staged (not yet sent) files shown above the composer. */
export function InternalAttachmentDrafts({
  files,
  onRemove,
  uploading,
  progressLabel,
}: {
  files: File[];
  onRemove: (index: number) => void;
  uploading?: boolean;
  progressLabel?: string | null;
}) {
  if (!files.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <span
          key={`${f.name}-${f.size}-${i}`}
          className="flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-muted/50 px-2 py-1 text-[10px]"
        >
          <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="max-w-[9rem] truncate font-medium">{f.name}</span>
          <span className="shrink-0 text-muted-foreground">{formatAttachmentSize(f.size)}</span>
          {!uploading && (
            <button
              type="button"
              aria-label={`Remove ${f.name}`}
              onClick={() => onRemove(i)}
              className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      ))}
      {uploading && (
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> {progressLabel ?? 'Uploading…'}
        </span>
      )}
    </div>
  );
}
