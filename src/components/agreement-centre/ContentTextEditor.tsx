/**
 * Amend a clause where it is printed — verbatim, and never by accident.
 *
 * `InlineFieldEditor` edits the *bracketed inserts* — the values the template
 * invites. This edits the **wording itself**: a clause body, a heading, a
 * schedule cell's sentence, a bullet in a responsibilities panel. It is the
 * negotiated-amendment surface, and it is deliberately a different control from
 * the value editor, because the two are different acts:
 *
 *  - a value edit fills a blank the template left;
 *  - a wording edit departs from the supplied wording, and must therefore be
 *    visible, reversible, verbatim and recorded.
 *
 * ## Why this is now explicit-commit
 *
 * It used to commit its draft when the popover closed — clicking away, pressing
 * Escape, or a re-render that dismissed it all wrote an amendment. That is the
 * wrong default for a legal instrument: an interaction that was never a decision
 * could store a partial clause (a half-finished sentence looks exactly like a
 * negotiated one once it is saved), and the user has no way to tell them apart.
 * So now:
 *
 *  - closing the editor NEVER writes. Only "Save amendment" writes.
 *  - Escape discards; Ctrl/Cmd+Enter saves.
 *  - the exact text that will be stored is shown character-for-character, with a
 *    word-level diff against the supplied wording, so what is saved is what was
 *    read. Nothing is trimmed except whitespace at the very ends, nothing is
 *    re-cased, nothing is appended.
 *  - an amendment that merely truncates the supplied clause — the signature of
 *    an accidental edit — is called out before it can be saved.
 *
 * Semantic tokens only — this renders in the Command Centre and in the Finance
 * Portal palettes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Check, PenLine, RotateCcw, X } from 'lucide-react';
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

/**
 * Word-level diff, longest-common-subsequence over whitespace-delimited words.
 * Small enough for a clause and exact enough to prove nothing was invented: a
 * word is either kept, removed from the supplied wording, or added by the
 * amendment.
 */
type DiffPart = { kind: 'same' | 'add' | 'remove'; text: string };

function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/).filter((w) => w !== '');
  const b = after.split(/(\s+)/).filter((w) => w !== '');
  const n = a.length;
  const m = b.length;
  // LCS table — clauses are short; this is cheap and exact.
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('same', a[i]); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { push('remove', a[i]); i += 1; }
    else { push('add', b[j]); j += 1; }
  }
  while (i < n) { push('remove', a[i]); i += 1; }
  while (j < m) { push('add', b[j]); j += 1; }
  return parts.filter((part) => part.text.trim() !== '' || part.kind === 'same');
}

/** Only the outer whitespace is ever touched. */
function tidy(value: string): string {
  return value.replace(/^\s+|\s+$/g, '');
}

export default function ContentTextEditor({
  path, text, original, label, multiline, onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(text);
  const amended = text !== original;
  const tokens = tokensIn(original);
  const candidate = tidy(draft);
  const dropped = tokens.filter((token) => !candidate.includes(token));
  const diff = useMemo(
    () => (open ? wordDiff(original, candidate) : []),
    [open, original, candidate],
  );
  const changed = candidate !== tidy(text);
  const removesTail = candidate !== '' && candidate !== original
    && original.startsWith(candidate) && original.length - candidate.length > 3;
  const blank = candidate === '';

  // The draft always re-seeds from what is printed; it is never carried between
  // openings, so a stale keystroke cannot resurface on another clause.
  useEffect(() => { setDraft(text); }, [text, open]);

  const save = () => {
    if (blank) return;
    onChange(path, candidate === original ? null : candidate);
    setOpen(false);
  };

  const discard = () => { setDraft(text); setOpen(false); };

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : discard())}>
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
        className="w-[30rem] space-y-3"
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
            {changed ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Unsaved — closing discards
              </span>
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
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
              if (event.key === 'Escape') { event.preventDefault(); discard(); }
            }}
            className="text-sm leading-relaxed"
          />
        ) : (
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); save(); }
              if (event.key === 'Escape') { event.preventDefault(); discard(); }
            }}
          />
        )}

        {/* What will actually be stored, and exactly how it differs. */}
        {changed && !blank ? (
          <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Change against the supplied wording
            </div>
            <p className="text-[12px] leading-relaxed">
              {diff.map((part, index) => (
                <span
                  key={index}
                  className={cn(
                    part.kind === 'add' && 'rounded bg-success/15 font-medium text-success',
                    part.kind === 'remove' && 'rounded bg-destructive/15 text-destructive line-through',
                    part.kind === 'same' && 'text-muted-foreground',
                  )}
                >
                  {part.text}
                </span>
              ))}
            </p>
          </div>
        ) : null}

        {removesTail ? (
          <p className="flex items-start gap-1.5 text-[11px] font-medium leading-relaxed text-warning">
            <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
            This shortens the supplied clause and drops its ending. If that was not
            intended, discard or restore the supplied wording.
          </p>
        ) : null}

        {blank ? (
          <p className="flex items-start gap-1.5 text-[11px] font-medium leading-relaxed text-destructive">
            <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
            A clause cannot be left empty. Restore the supplied wording to remove
            your amendment, or add a special condition instead.
          </p>
        ) : null}

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
          Saved verbatim, to <span className="font-medium text-foreground">this agreement only</span>.
          The supplied template is unchanged, the amendment is recorded on the audit trail, and it is
          frozen into the version you issue. Have legal review any departure from the supplied wording.
        </p>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!amended}
            className="h-7 px-2 text-xs"
            onClick={() => { onChange(path, null); setDraft(original); setOpen(false); }}
          >
            <RotateCcw className="mr-1 h-3 w-3" /> Restore supplied wording
          </Button>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={discard}>
              <X className="mr-1 h-3 w-3" /> Discard
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!changed || blank}
              className="h-7 px-2 text-xs"
              onClick={save}
            >
              <Check className="mr-1 h-3 w-3" /> Save amendment
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
