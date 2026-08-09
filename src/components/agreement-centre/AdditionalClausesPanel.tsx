/**
 * Special conditions — the terms the template has no slot for.
 *
 * Amending a clause changes wording the template supplied. This adds wording it
 * never carried: a retention arrangement, an exclusivity window, a carve-out a
 * counterparty asks for. They print as their own numbered section (`S1`, `S2`,
 * …) immediately before EXECUTION, in the digital view, the typeset PDF and the
 * Word pack alike, because all three read the same content transform.
 *
 * Text is stored VERBATIM — the only thing trimmed is whitespace at the ends of
 * the block, and blank lines split paragraphs so the numbering can be printed.
 * Nothing is reworded, completed or appended.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowDown, ArrowUp, FilePlus2, Trash2 } from 'lucide-react';
import type { AgreementAdditionalClause } from '@/lib/agreements';

interface Props {
  clauses: AgreementAdditionalClause[];
  onChange: (next: AgreementAdditionalClause[]) => void;
  /** Jump the reader to the printed section. */
  onJump?: () => void;
}

function newId(): string {
  return `ac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function AdditionalClausesPanel({ clauses, onChange, onJump }: Props) {
  const [openEditor, setOpenEditor] = useState(false);

  const update = (index: number, patch: Partial<AgreementAdditionalClause>) => {
    onChange(clauses.map((clause, i) => (i === index ? { ...clause, ...patch } : clause)));
  };

  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= clauses.length) return;
    const next = [...clauses];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const add = () => {
    onChange([...clauses, { id: newId(), heading: '', text: '' }]);
    setOpenEditor(true);
  };

  const show = openEditor || clauses.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FilePlus2 className="h-4 w-4 text-primary" />
          Additional terms
          {clauses.length ? (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              {clauses.length} special condition{clauses.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </h3>
        <div className="flex items-center gap-1.5">
          {clauses.length && onJump ? (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onJump}>
              View in document
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={add}>
            <FilePlus2 className="mr-1 h-3 w-3" /> Add a condition
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        For anything the supplied agreement does not cover. Each condition prints as its own numbered
        clause before EXECUTION, states that it prevails over any inconsistent clause above, and is
        frozen into the version you issue.
      </p>

      {show ? (
        <div className="mt-3 space-y-3">
          {clauses.map((clause, index) => (
            <div key={clause.id} className="rounded-lg border border-border/60 bg-background/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-primary">S{index + 1}</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Move up"
                    disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Move down"
                    disabled={index === clauses.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                    aria-label={`Remove condition S${index + 1}`}
                    onClick={() => onChange(clauses.filter((_, i) => i !== index))}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="mt-2 space-y-2">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Heading
                  </Label>
                  <Input
                    value={clause.heading}
                    placeholder="Special Condition"
                    onChange={(event) => update(index, { heading: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Wording
                  </Label>
                  <Textarea
                    rows={5}
                    value={clause.text}
                    placeholder="Type the condition exactly as it is to appear. Leave a blank line between paragraphs to number them S1.1, S1.2, …"
                    onChange={(event) => update(index, { text: event.target.value })}
                    className="text-sm leading-relaxed"
                  />
                  {clause.text.trim() === '' ? (
                    <p className="text-[11px] text-muted-foreground">
                      An empty condition is not printed and is not saved.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
