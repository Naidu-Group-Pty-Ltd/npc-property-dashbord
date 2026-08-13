/**
 * The digital passport booklet — a bound document, not a modal with pages.
 *
 * The Command pages are a *register*: dense, dark, operational. This is the
 * same record presented as the artefact it stands for — cream paper on a navy
 * board, a spine between facing leaves, foil rules, a guilloche rosette and
 * wax seals.
 *
 * Three things the design treats as structural rather than decorative, and
 * which are therefore reproduced rather than approximated:
 *
 *  - **It is bound.** Wide viewports show two facing leaves with a spine
 *    between them; narrow ones show a single leaf. A booklet that always
 *    showed one page would read as a slideshow.
 *  - **The page count comes from the data.** The design's own screenshots show
 *    12, 14 and 16 pages of the same document, because a leaf whose records do
 *    not exist is not printed. An empty "Screening" leaf in a bound document
 *    reads as "screening found nothing", which is a different and much worse
 *    claim than "screening is not part of this record".
 *  - **Every leaf is reachable directly.** The numbered chips are how an
 *    operator gets to page XIII without turning twelve pages.
 *
 * Composition lives in `passportBooklet.pure.ts`; this file only draws.
 */
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  bookletLabel,
  bookletSpreads,
  buildBooklet,
  type BookletPage,
  type PassportView,
} from "@/lib/aml/passport";
import { BookletBlockView } from "./BookletBlocks";

/** Below this width the booklet shows one leaf; above it, a facing pair. */
const SPREAD_MIN_WIDTH = 900;

function useLeavesPerSpread(): 1 | 2 {
  const [wide, setWide] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(`(min-width: ${SPREAD_MIN_WIDTH}px)`).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(`(min-width: ${SPREAD_MIN_WIDTH}px)`);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide ? 2 : 1;
}

function Leaf({ page }: { page: BookletPage }) {
  return (
    <article className="passport-leaf flex aspect-[470/648] min-w-0 flex-1 flex-col p-6">
      <span aria-hidden="true" className="passport-leaf__guilloche" />
      <span aria-hidden="true" className="passport-leaf__frame-outer" />
      <span aria-hidden="true" className="passport-leaf__frame-inner" />

      <header className="relative flex-none text-center">
        <div className="passport-leaf__kicker">{page.kicker}</div>
        <h3 className="passport-leaf__title">{page.title}</h3>
        <div className="passport-leaf__divider mx-auto my-2 w-1/2" />
        {page.sub && <p className="passport-leaf__sub m-0 text-[9.5px] leading-relaxed">{page.sub}</p>}
      </header>

      <div className="relative mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {page.blocks.map((b, i) => (
          <BookletBlockView key={`${page.id}-${b.kind}-${i}`} block={b} />
        ))}
      </div>

      <footer className="passport-leaf__faint relative mt-2 flex-none text-center text-[8px] tracking-[0.2em]">
        {page.numeral ?? ""}
      </footer>
    </article>
  );
}

export function PassportBooklet({
  view,
  onClose,
}: {
  view: PassportView;
  onClose: () => void;
}) {
  const pages = useMemo(() => buildBooklet(view), [view]);
  const perSpread = useLeavesPerSpread();
  const spreads = useMemo(() => bookletSpreads(pages.length, perSpread), [pages.length, perSpread]);
  const [spreadIndex, setSpreadIndex] = useState(0);

  // Reflowing from one leaf to two must keep the reader on the page they were
  // reading, not reset them to the cover.
  useEffect(() => {
    setSpreadIndex((i) => Math.min(i, Math.max(0, spreads.length - 1)));
  }, [spreads.length]);

  const spread = spreads[spreadIndex] ?? [];
  const label = bookletLabel(spread, pages.length);
  const titles = spread.map((i) => pages[i]?.title).filter(Boolean).join(" · ");

  const goToPage = (pageIndex: number) => {
    const target = spreads.findIndex((s) => s.includes(pageIndex));
    if (target >= 0) setSpreadIndex(target);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="passport-scope max-w-[1120px] gap-0 overflow-hidden p-0"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setSpreadIndex((i) => Math.min(spreads.length - 1, i + 1));
          if (e.key === "ArrowLeft") setSpreadIndex((i) => Math.max(0, i - 1));
        }}
      >
        <DialogTitle className="sr-only">
          Digital Compliance Passport for {view.header.subject ?? "this customer"}
        </DialogTitle>

        {/* ── bar ── */}
        <div className="passport-bookbar flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="passport-display text-sm font-semibold uppercase tracking-[0.12em]">
              AML/CTF Compliance Passport
            </div>
            <div className="passport-mono passport-faint mt-0.5 truncate text-[10px]">
              {[
                view.header.credential,
                view.header.current_version_label,
                view.header.subject,
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </div>
          </div>
          <span className="passport-sync">
            <span aria-hidden="true">◈</span>
            Synchronised with journey
          </span>
        </div>

        {/* ── page chips ── */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[color:var(--passport-hairline)] px-4 py-2.5">
          {pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="passport-pagechip"
              aria-current={spread.includes(i)}
              aria-label={`Page ${i + 1}: ${p.title}`}
              onClick={() => goToPage(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>

        {/* ── board ── */}
        <div className="max-h-[70vh] overflow-y-auto p-4">
          <div className="passport-board mx-auto flex w-full max-w-[980px] items-stretch gap-0 p-4">
            {spread.map((pageIndex, n) => (
              <div key={pages[pageIndex].id} className="flex min-w-0 flex-1 items-stretch">
                {n > 0 && <span aria-hidden="true" className="passport-board__spine mx-3" />}
                <Leaf page={pages[pageIndex]} />
              </div>
            ))}
          </div>
        </div>

        {/* ── turn ── */}
        <div className="flex items-center justify-between gap-3 border-t border-[color:var(--passport-hairline)] px-4 py-3">
          <button
            type="button"
            className="passport-action w-auto"
            onClick={() => setSpreadIndex((i) => Math.max(0, i - 1))}
            disabled={spreadIndex === 0}
          >
            ← Previous
          </button>
          <div className="min-w-0 text-center">
            <div className="passport-display truncate text-[13px]">{titles}</div>
            <div className="passport-faint passport-mono text-[10px] tracking-[0.14em]">{label}</div>
          </div>
          <button
            type="button"
            className="passport-action passport-action--primary w-auto"
            onClick={() => setSpreadIndex((i) => Math.min(spreads.length - 1, i + 1))}
            disabled={spreadIndex >= spreads.length - 1}
          >
            Next →
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
