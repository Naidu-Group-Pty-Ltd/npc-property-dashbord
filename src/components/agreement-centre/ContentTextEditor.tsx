/**
 * Amend a clause where it is printed.
 *
 * `InlineFieldEditor` edits the *bracketed inserts* — the values the template
 * invites. This edits the **wording itself**: a clause body, a heading, a
 * schedule cell's sentence, a bullet in a responsibilities panel. It is the
 * negotiated-amendment surface, and it is deliberately a different control from
 * the value editor, because the two are different acts:
 *
 *  - a value edit fills a blank the template left;
 *  - a wording edit departs from the supplied wording, and must therefore be
 *    visible, reversible and recorded.
 *
 * So: the affordance is a small pencil at the END of the text rather than the
 * text becoming a button — that keeps the token editors inside the same
 * sentence clickable (no nested interactive elements), and it keeps the
 * document reading as a document. An amended node carries a quiet marker and a
 * one-click "Restore the supplied wording". The template itself is never
 * touched: the edit is stored as an override keyed to this node, applied at
 * render time, and frozen onto the version row when the agreement is issued.
 *
 * Semantic tokens only — this renders in the Command Centre and in the Finance
 * Portal palettes.
 */
import { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Check, PenLine, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  /** Stable content path — the override key. */
  path: string;
  /** The wording currently printed (override applied). */
  text: string;
  /** The supplied template's wording at this path. */
  original: string;
  /** Human label — "Clause 11.2", "Cover title line 1". */
  label: string;
  multiline: boolean;
  /** `null` restores the supplied wording. */
  onChange: (path: string, text: string | null) => void;
}

/** The `{{token}}` names inside a text, so an editor cannot lose a binding. */
function tokensIn(text: string): string[] {
  return Array.from(new Set(text.match(/\{\{[a-z0-9_]+\}\}/g) ?? []));
}

export default function ContentTextEditor({
  path, text, original, label, multiline, onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(text);
  const amended = text !== original;
  const tokens = tokensIn(original);
  const dropped = tokens.filter((token) => !draft.includes(token));

  useEffect(() => { if (!open) setDraft(text); }, [text, open]);

  const commit = (next: string) => {
    const trimmed = next.replace(/\s+$/g, '');
    if (trimmed.trim() === '' || trimmed === original) { onChange(path, null); return; }
    onChange(path, trimmed);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => { if (!next) commit(draft); setOpen(next); }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Amend wording — ${label}`}
          aria-label={`Amend wording — ${label}`}
          className={cn(
            'ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded align-baseline',
            'text-primary/60 opacity-0 transition-opacity hover:bg-primary/10 hover:text-primary',
            'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'group-hover/doctext:opacity-100',
            (open || amended) && 'opacity-100',
          )}
        >
          <PenLine aria-hidden className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[26rem] space-y-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              Wording
            </span>
            {amended ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">Amended</span>
            ) : null}
          </div>
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </Label>
        </div>

        {multiline ? (
          <Textarea
            autoFocus
            rows={7}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="text-sm leading-relaxed"
          />
        ) : (
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commit(draft); setOpen(false); }
              if (event.key === 'Escape') { event.preventDefault(); setDraft(text); setOpen(false); }
            }}
          />
        )}

        {tokens.length ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Bound values in this text: {tokens.map((token) => (
              <code key={token} className="mx-0.5 rounded bg-muted px-1 py-0.5 text-[10px]">{token}</code>
            ))}
            {dropped.length ? (
              <span className="mt-1 block font-medium text-warning">
                Removing {dropped.join(', ')} means that value will no longer print here.
              </span>
            ) : null}
          </p>
        ) : null}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          This changes the wording of <span className="font-medium text-foreground">this agreement only</span>.
          The supplied template is unchanged, the amendment is recorded on the audit trail, and it is
          frozen into the version you issue. Have legal review any departure from the supplied wording.
        </p>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!amended && draft === original}
            className="h-7 px-2 text-xs"
            onClick={() => { setDraft(original); onChange(path, null); }}
          >
            <RotateCcw className="mr-1 h-3 w-3" /> Restore supplied wording
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => { commit(draft); setOpen(false); }}
          >
            <Check className="mr-1 h-3 w-3" /> Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
