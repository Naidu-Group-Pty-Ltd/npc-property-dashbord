/**
 * The worked example, readable inside the app.
 *
 * The pack has ~90 questions across nine sheets. A blank template tells you
 * what is being asked; it does not tell you how much detail an answer needs,
 * or that the entity named against a portfolio property has to match the
 * Ownership sheet character for character. Those are the things people get
 * wrong, in a meeting, with no time to check.
 *
 * So this is a filled pack you can read — without downloading anything, and
 * without Excel. Three things make it worth opening rather than being a second
 * copy of the form:
 *
 *  - the answers come from the same encoder the workbook uses, so what is on
 *    screen is character-for-character what the file contains;
 *  - the notes say *why* an answer is written that way, only where the format
 *    is genuinely non-obvious; and
 *  - the outcome panel runs the real engine over the example, so a reader sees
 *    what this data produces, not just what it looks like.
 *
 * The filled files are downloadable too, for anyone who would rather have them
 * open beside the blank ones.
 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  BookOpen, Download, FileSpreadsheet, FileText, Info, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import {
  SAMPLE_SUMMARY, buildWorkedExampleDocument, buildWorkedExampleWorkbook,
  sampleAssessment, workedExampleFileName, workedExampleSections,
  type ExampleSection, type PackBranding,
} from '@/lib/ciAssessment/intakePack';
import { runAssessment } from '@/lib/ciAssessment/engine';
import { formatMoney, formatMultiple, formatRatioPercent, toCents } from '@/lib/ciAssessment/money';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolved lazily by the caller so the example is branded like everything else. */
  resolveBranding: () => Promise<PackBranding>;
  onDownload: (blob: Blob, filename: string) => void;
}

/** A fixed date so the example's lease-expiry maths does not drift with the clock. */
const AS_AT = new Date('2026-08-01T00:00:00.000Z');

function SectionNav({
  sections, active, onSelect,
}: {
  sections: ExampleSection[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Example sections" className="ci-example-nav">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => onSelect(section.id)}
          aria-current={section.id === active ? 'true' : undefined}
          className={cn('ci-example-nav-item', section.id === active && 'ci-example-nav-item-active')}
        >
          <span className="truncate">{section.sheetName}</span>
          <span className="ci-example-nav-count">{section.answered}</span>
        </button>
      ))}
    </nav>
  );
}

function AnswerList({ section }: { section: ExampleSection }) {
  return (
    <div className="space-y-4">
      {section.entries.map((entry, index) => (
        <div key={entry.label ?? `entry-${index}`}>
          {entry.label ? (
            <h4 className="ci-example-entry-label">{entry.label}</h4>
          ) : null}
          <dl className="ci-example-answers">
            {entry.answers.map((answer) => (
              <div key={answer.key} className="ci-example-answer">
                <dt className="ci-example-question">
                  {answer.label}
                  {answer.required ? (
                    <span className="ci-example-required" aria-label="required"> ✱</span>
                  ) : null}
                </dt>
                <dd>
                  {answer.value ? (
                    <p className="ci-example-value">{answer.value}</p>
                  ) : (
                    <p className="ci-example-blank">Left blank — not known, and a blank is safer than a guess.</p>
                  )}
                  {answer.note ? (
                    <p className="ci-example-note">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{answer.note}</span>
                    </p>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/**
 * What the example produces.
 *
 * Run through the real engine rather than written down, so it cannot describe
 * an outcome the product would not actually reach.
 */
function OutcomePanel() {
  const result = useMemo(() => runAssessment(sampleAssessment(), { asAt: AS_AT }), []);
  const { summary } = result;

  const figures: Array<[string, string]> = [
    ['Maximum indicative capacity', formatMoney(toCents(summary.maximumIndicativeLoan))],
    ['Requested', formatMoney(toCents(summary.requestedLoan))],
    ['LVR', formatRatioPercent(summary.proposedLvr)],
    ['DSCR', formatMultiple(summary.proposedDscr)],
    ['ICR', formatMultiple(summary.proposedIcr)],
    ['Debt yield', formatRatioPercent(summary.debtYield)],
  ];

  return (
    <section className="ci-example-outcome" aria-label="What this example produces">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">What these answers produce</h4>
        <Badge variant="outline" className="ci-status-badge">{result.outcomeLabel}</Badge>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Calculated by the same engine the assessment uses, so this is the result the example
        actually reaches — bound by {summary.bindingConstraint.toLowerCase()}.
      </p>
      <dl className="ci-example-figures">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function WorkedExampleDialog({ open, onOpenChange, resolveBranding, onDownload }: Props) {
  const sections = useMemo(() => workedExampleSections(), []);
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const [building, setBuilding] = useState<'xlsx' | 'docx' | null>(null);

  const current = sections.find((section) => section.id === active) ?? sections[0];

  const download = async (kind: 'xlsx' | 'docx') => {
    setBuilding(kind);
    try {
      const branding = await resolveBranding();
      const blob = kind === 'xlsx'
        ? await buildWorkedExampleWorkbook(branding)
        : await buildWorkedExampleDocument(branding);
      onDownload(blob, workedExampleFileName(branding, kind));
    } catch (error) {
      toast({
        title: 'Could not build the example',
        description: error instanceof Error ? error.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setBuilding(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ci-example-dialog">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            Worked example
            <Badge variant="outline" className="ci-example-fiction">Fictional data</Badge>
          </DialogTitle>
          <DialogDescription>
            {SAMPLE_SUMMARY.headline}. {SAMPLE_SUMMARY.detail} Every name, address and identifier is
            invented — this is a reference, not a client record.
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap gap-2 border-b border-border pb-3">
          <Button size="sm" variant="outline" onClick={() => download('xlsx')} disabled={building !== null}>
            {building === 'xlsx'
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            Download filled workbook
          </Button>
          <Button size="sm" variant="outline" onClick={() => download('docx')} disabled={building !== null}>
            {building === 'docx'
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            Download filled guide
          </Button>
        </div>

        <div className="ci-example-body">
          <SectionNav sections={sections} active={active} onSelect={setActive} />

          <ScrollArea className="ci-example-scroll">
            <div className="ci-example-content">
              {current ? (
                <>
                  <header>
                    <h3 className="text-base font-semibold tracking-tight text-foreground">
                      {current.title}
                    </h3>
                    <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{current.intro}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sheet &quot;{current.sheetName}&quot; · {current.answered} of {current.total} answered
                    </p>
                  </header>

                  <AnswerList section={current} />

                  {current.id === sections[sections.length - 1]?.id ? <OutcomePanel /> : null}
                </>
              ) : null}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
