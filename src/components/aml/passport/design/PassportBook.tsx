/**
 * The passport as a bound document — the shared viewer.
 *
 * ONE implementation, used by the Command Centre dialog and by the Client
 * Portal page. That is deliberate: the client and the officer must be looking
 * at the same artefact, and two renderers of "the passport" would eventually
 * disagree about what it looks like. Audience differences are already handled
 * upstream by the projection, so nothing here needs to know who is reading.
 *
 * ## Why the leaf is scaled rather than laid out fluidly
 *
 * Every type size, rule, seal and grid inside a leaf is authored against a
 * 470×648 box. Letting flexbox squeeze that box — which is what the previous
 * version did — keeps 11px body copy and 30px seals inside a 200px-wide page,
 * so text reflows, wraps one character per line and overflows. Rendering the
 * leaf at its design size and applying a uniform `transform: scale()` keeps
 * every internal proportion exactly as designed, at any viewport. The
 * arithmetic lives in `bookletGeometry` so it is testable without a DOM.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LEAF_H,
  LEAF_W,
  bookletGeometry,
  bookletLabel,
  bookletSpreads,
  type BookletGeometry,
  type BookletPage,
} from "@/lib/aml/passport";
import { BookletBlockView } from "./BookletBlocks";

/* ── cover ────────────────────────────────────────────────────────────── */

/**
 * The navy leather front board.
 *
 * A passport opens on its cover. A booklet whose first page is a data table
 * reads as a report, which is the opposite of what this artefact is for.
 */
export function BookletCover({ page }: { page: BookletPage }) {
  return (
    <section
      className="passport-cover passport-board__leaf relative flex flex-col items-center justify-center rounded-[11px] text-center"
      style={{ width: LEAF_W, height: LEAF_H }}
      aria-label="Passport cover"
    >
      <span aria-hidden="true" className="passport-cover__frame" />
      <span aria-hidden="true" className="passport-cover__frame-inner" />
      <span aria-hidden="true" className="passport-cover__halo" />

      <img
        src="/brand/aurixa-mark.svg"
        alt=""
        aria-hidden="true"
        className="passport-cover__emblem relative"
        width={104}
        height={104}
      />

      <h2 className="passport-cover__wordmark relative mt-7">Aurixa</h2>
      <div className="passport-cover__systems relative mt-1.5">Systems</div>

      <div className="passport-cover__rule relative mx-auto my-6 w-40" />

      <div className="passport-cover__title relative">
        AML/CTF
        <br />
        Compliance Passport
      </div>

      {page.sub && <div className="passport-cover__holder relative mt-7">{page.sub}</div>}
      {page.foot && <div className="passport-cover__credential relative mt-2">{page.foot}</div>}
      {page.fingerprint && (
        <div className="passport-cover__fingerprint relative mt-4">
          <div className="passport-cover__fingerprint-k">SHA-256 EVIDENCE FINGERPRINT</div>
          <div className="passport-mono mt-1">{page.fingerprint}</div>
        </div>
      )}

      <span aria-hidden="true" className="passport-cover__clasp" />
    </section>
  );
}

/* ── leaf ─────────────────────────────────────────────────────────────── */

export function BookletLeaf({ page }: { page: BookletPage }) {
  return (
    <article
      className="passport-leaf passport-board__leaf flex flex-col p-6"
      style={{ width: LEAF_W, height: LEAF_H }}
      aria-label={page.title}
    >
      <span aria-hidden="true" className="passport-leaf__guilloche" />
      <span aria-hidden="true" className="passport-leaf__frame-outer" />
      <span aria-hidden="true" className="passport-leaf__frame-inner" />

      <header className="relative flex-none text-center">
        <div className="passport-leaf__kicker">{page.kicker}</div>
        <h3 className="passport-leaf__title">{page.title}</h3>
        <div className="passport-leaf__divider mx-auto my-2 w-1/2" />
        {page.sub && <p className="passport-leaf__sub m-0 text-[9.5px] leading-relaxed">{page.sub}</p>}
      </header>

      <div className="passport-leaf__body relative mt-3 flex min-h-0 flex-1 flex-col gap-3">
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

/* ── the book ─────────────────────────────────────────────────────────── */

/** Measures the board and returns the geometry that fits it. */
function useBookGeometry(singleOnly: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [geometry, setGeometry] = useState<BookletGeometry>(() =>
    bookletGeometry({ availableWidth: LEAF_W, availableHeight: LEAF_H, singleOnly }),
  );

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setGeometry(
      bookletGeometry({
        availableWidth: rect.width,
        // Leave room for the chrome above and below the board rather than
        // letting a tall leaf push the controls off a short laptop screen.
        availableHeight: Math.max(320, window.innerHeight - 260),
        singleOnly,
      }),
    );
  }, [singleOnly]);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return { ref, geometry };
}

export function PassportBook({
  pages,
  singleOnly = false,
  className,
  onClose,
}: {
  pages: BookletPage[];
  /** Force one leaf at a time — the client booklet reads better this way. */
  singleOnly?: boolean;
  className?: string;
  onClose?: () => void;
}) {
  const { ref, geometry } = useBookGeometry(singleOnly);
  const [index, setIndex] = useState(0);
  const [turn, setTurn] = useState<"fwd" | "back" | null>(null);

  const spreads = bookletSpreads(pages.length, geometry.perSpread);
  const clamped = Math.min(index, Math.max(0, spreads.length - 1));
  const spread = spreads[clamped] ?? [];

  // Reflowing from one leaf to two must keep the reader on the page they were
  // reading rather than resetting them to the cover.
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, spreads.length - 1)));
  }, [spreads.length]);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const next = Math.min(spreads.length - 1, Math.max(0, i + delta));
        if (next !== i) setTurn(delta > 0 ? "fwd" : "back");
        return next;
      });
    },
    [spreads.length],
  );

  useEffect(() => {
    if (!turn) return;
    const t = window.setTimeout(() => setTurn(null), 420);
    return () => window.clearTimeout(t);
  }, [turn]);

  const goToPage = (pageIndex: number) => {
    const target = spreads.findIndex((s) => s.includes(pageIndex));
    if (target >= 0) {
      setTurn(target > clamped ? "fwd" : target < clamped ? "back" : null);
      setIndex(target);
    }
  };

  const titles = spread.map((i) => pages[i]?.title).filter(Boolean).join(" · ");

  return (
    <div
      className={cn("flex flex-col", className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "Escape" && onClose) onClose();
      }}
      tabIndex={-1}
      role="group"
      aria-label="Digital passport"
    >
      {/* page chips */}
      <div className="flex flex-wrap items-center justify-center gap-1.5 px-4 py-2.5">
        {pages.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className={cn("passport-pagechip", p.variant === "cover" && "passport-pagechip--cover")}
            aria-current={spread.includes(i)}
            aria-label={p.variant === "cover" ? "Cover" : `Page ${i}: ${p.title}`}
            onClick={() => goToPage(i)}
          >
            {p.variant === "cover" ? "◈" : i}
          </button>
        ))}
      </div>

      {/* board */}
      <div ref={ref} className="min-h-0 flex-1 px-4 py-3">
        <div
          className="passport-board mx-auto flex items-center justify-center overflow-hidden"
          style={{
            width: Math.round(geometry.width + 48),
            height: Math.round(geometry.height + 48),
            maxWidth: "100%",
          }}
        >
          <div
            className={cn(
              "flex items-start justify-center",
              turn === "fwd" && "passport-turn-fwd",
              turn === "back" && "passport-turn-back",
            )}
            style={{
              width: geometry.width,
              height: geometry.height,
            }}
          >
            <div
              className="flex origin-top-left items-start"
              style={{
                width: geometry.width / geometry.scale,
                height: LEAF_H,
                transform: `scale(${geometry.scale})`,
                gap: spread.length > 1 ? 26 : 0,
              }}
            >
              {spread.map((pageIndex, n) => {
                const page = pages[pageIndex];
                if (!page) return null;
                return (
                  <div key={page.id} className="relative flex items-start">
                    {n > 0 && <span aria-hidden="true" className="passport-board__spine" />}
                    {page.variant === "cover" ? (
                      <BookletCover page={page} />
                    ) : (
                      <BookletLeaf page={page} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* turn */}
      <div className="flex items-center justify-between gap-3 border-t border-[color:var(--passport-hairline)] px-4 py-3">
        <button
          type="button"
          className="passport-action w-auto"
          onClick={() => go(-1)}
          disabled={clamped === 0}
        >
          ← Previous
        </button>
        <div className="min-w-0 text-center">
          <div className="passport-display truncate text-[13px]">{titles}</div>
          <div className="passport-faint passport-mono text-[10px] tracking-[0.14em]">
            {spread.includes(0) && pages[0]?.variant === "cover" && spread.length === 1
              ? "COVER"
              : bookletLabel(spread, pages.length)}
          </div>
        </div>
        <button
          type="button"
          className="passport-action passport-action--primary w-auto"
          onClick={() => go(1)}
          disabled={clamped >= spreads.length - 1}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
