/**
 * Edit a bound value where it is printed.
 *
 * The wizard's step forms remain the complete surface, but a person reading the
 * draft should be able to correct the figure they are looking at rather than
 * hunting for the step that owns it. Every editable value in the digital
 * document renders through this control: it edits the RAW field value (the same
 * value the step form writes), so the projection, the validation and the PDF all
 * see one edit — there is no second store and nothing to reconcile.
 *
 * Presentation is deliberately quiet: an underline you only notice on hover, so
 * the document still reads as a document. Semantic tokens only.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Check, Eraser, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgreementFieldDef } from '@/lib/agreements';

interface Props {
  def: AgreementFieldDef;
  /** Raw stored value — what the editor writes back. */
  rawValue: unknown;
  /** What the document prints for this token (projected/formatted). */
  children: ReactNode;
  /** Whether the printed value is a real value or the template's bracket text. */
  filled: boolean;
  onChange: (key: string, value: unknown) => void;
}

/** `Clause 11.2` / `days`, mined from the template's own label. */
function labelParts(def: AgreementFieldDef) {
  const clause = /clause\s+([0-9]+(?:\.[0-9]+)*)/i.exec(def.label)?.[0] ?? null;
  const unit = /\bdays?\b/i.test(def.label)
    ? 'days'
    : def.type === 'percent'
      ? '%'
      : null;
  const clean = def.label
    .replace(/\s*[—–-]?\s*\(?clause\s+[0-9.]+\)?\s*/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { clause, unit, clean: clean || def.label };
}

export default function InlineFieldEditor({ def, rawValue, children, filled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>(rawValue === null || rawValue === undefined ? '' : String(rawValue));
  const { clause, unit, clean } = labelParts(def);

  useEffect(() => {
    if (!open) setDraft(rawValue === null || rawValue === undefined ? '' : String(rawValue));
  }, [rawValue, open]);

  const commit = (next: string) => {
    const trimmed = next.trim();
    if (trimmed === '') { onChange(def.key, null); return; }
    if (def.type === 'number' || def.type === 'percent') {
      const n = Number(trimmed);
      onChange(def.key, Number.isFinite(n) ? n : trimmed);
      return;
    }
    onChange(def.key, trimmed);
  };

  const commitAndClose = () => { commit(draft); setOpen(false); };

  const editor = () => {
    if (def.type === 'choice' && def.options?.length) {
      return (
        <Select
          value={draft || undefined}
          onValueChange={(next) => { setDraft(next); onChange(def.key, next); }}
        >
          <SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger>
          <SelectContent>
            {def.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (def.type === 'boolean') {
      return (
        <Select
          value={draft === '' ? undefined : String(draft) === 'true' ? 'true' : 'false'}
          onValueChange={(next) => { setDraft(next); onChange(def.key, next === 'true'); }}
        >
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    if (def.type === 'longtext') {
      return (
        <Textarea
          autoFocus
          rows={5}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft)}
        />
      );
    }
    return (
      <div className="relative">
        <Input
          autoFocus
          type={def.type === 'date' ? 'date' : def.type === 'number' || def.type === 'percent' ? 'number' : 'text'}
          inputMode={def.type === 'number' || def.type === 'percent' ? 'decimal' : undefined}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); commitAndClose(); }
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
          }}
          className={unit ? 'pr-14' : undefined}
        />
        {unit ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <Popover open={open} onOpenChange={(next) => { if (!next) commit(draft); setOpen(next); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Edit — ${clean}`}
          className={cn(
            'group/inline inline-flex max-w-full items-baseline gap-1 rounded px-0.5 text-left align-baseline',
            'decoration-dotted underline-offset-4 transition-colors hover:bg-primary/10 hover:underline',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            open && 'bg-primary/10 underline',
            filled ? 'font-medium text-foreground' : 'text-muted-foreground/70',
          )}
        >
          <span className="min-w-0">{children}</span>
          <Pencil
            aria-hidden
            className={cn(
              'h-3 w-3 shrink-0 self-center text-primary opacity-0 transition-opacity',
              'group-hover/inline:opacity-100',
              open && 'opacity-100',
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3" onOpenAutoFocus={(event) => event.preventDefault()}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {clause ? (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                {clause}
              </span>
            ) : null}
            {def.requiredForIssue ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">Required</span>
            ) : null}
          </div>
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {clean}{unit ? ` (in ${unit === '%' ? 'percent' : unit})` : ''}
          </Label>
        </div>
        {editor()}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Edits apply to the whole document and to the final PDF. Save the draft to keep them.
        </p>
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => { setDraft(''); onChange(def.key, null); }}
          >
            <Eraser className="mr-1 h-3 w-3" /> Clear
          </Button>
          <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={commitAndClose}>
            <Check className="mr-1 h-3 w-3" /> Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
