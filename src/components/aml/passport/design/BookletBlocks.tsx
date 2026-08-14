/**
 * The booklet's block renderers.
 *
 * One component per block kind in `passportBooklet.pure.ts`. The composer
 * decides WHAT is on a page; this file decides how it is drawn on paper — and
 * the two are separate so the page arithmetic stays testable without a DOM.
 *
 * Everything here draws in the cream-paper palette. Colour comes from
 * `passport-tokens.css`; nothing in this file names one.
 */
import type { BookletBlock, BookletTone, SealTone } from "@/lib/aml/passport";
import { cn } from "@/lib/utils";
import { Wax } from "./primitives";

const TONE_INK: Record<BookletTone, string> = {
  ok: "passport-leaf__tone--ok",
  info: "passport-leaf__tone--info",
  warn: "passport-leaf__tone--warn",
  bad: "passport-leaf__tone--bad",
  na: "passport-leaf__tone--na",
};

function LeafPill({ tone, children }: { tone: BookletTone; children: React.ReactNode }) {
  return <span className={cn("passport-leaf__pill", TONE_INK[tone])}>{children}</span>;
}

function BlockTitle({ children }: { children: React.ReactNode }) {
  return <div className="passport-leaf__k mb-1.5">{children}</div>;
}

export function BookletBlockView({ block }: { block: BookletBlock }) {
  switch (block.kind) {
    case "statement":
      return (
        <p className="passport-leaf__statement m-0 text-center text-[13px] leading-relaxed">
          {block.text}
        </p>
      );

    case "fields":
      return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {block.items.map((f) => (
            <div key={f.k} className="min-w-0">
              <div className="passport-leaf__k">{f.k}</div>
              <div
                className={cn(
                  "mt-0.5 text-[11px] leading-snug",
                  f.mono && "passport-mono passport-leaf__mono",
                )}
              >
                {f.v}
              </div>
            </div>
          ))}
        </div>
      );

    case "summary":
      return (
        <div>
          {block.items.map((r) => (
            <div key={r.k} className="passport-leaf__row flex items-center gap-2.5 py-2 last:border-b-0">
              <span aria-hidden="true" className="passport-leaf__icon" />
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.11em]">{r.k}</div>
                <div className="passport-leaf__muted mt-0.5 text-[9.5px] leading-snug">{r.sub}</div>
              </div>
              <LeafPill tone={r.tone}>{r.status}</LeafPill>
            </div>
          ))}
        </div>
      );

    case "chips":
      return (
        <div>
          <BlockTitle>{block.title}</BlockTitle>
          <div className="flex flex-wrap gap-1.5">
            {block.items.map((c) => (
              <LeafPill key={c.t} tone={c.tone}>
                {c.t}
              </LeafPill>
            ))}
          </div>
        </div>
      );

    case "matrix":
      return (
        <div>
          <BlockTitle>{block.title}</BlockTitle>
          {block.items.map((m) => (
            <div key={m.k} className="passport-leaf__row py-2 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-[10.5px] font-semibold">{m.k}</span>
                <LeafPill tone={m.tone}>{m.v}</LeafPill>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1 pl-1">
                {m.cells.map((c) => (
                  <LeafPill key={c.t} tone={c.tone}>
                    {c.t}
                  </LeafPill>
                ))}
              </div>
            </div>
          ))}
        </div>
      );

    case "rows":
      return (
        <div>
          <BlockTitle>{block.title}</BlockTitle>
          {block.items.map((r) => (
            <div key={r.k} className="passport-leaf__row flex items-baseline gap-3 py-1.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] font-semibold">{r.k}</div>
                {r.note && (
                  <div className="passport-leaf__note mt-0.5 text-[9px] leading-snug">{r.note}</div>
                )}
              </div>
              <span className="passport-leaf__muted text-[9px] font-semibold tracking-wider">
                {r.v}
              </span>
            </div>
          ))}
        </div>
      );

    case "partners":
      return (
        <div>
          <BlockTitle>{block.title}</BlockTitle>
          {block.items.map((p) => (
            <div key={p.k} className="passport-leaf__row flex items-center gap-2.5 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] font-semibold">{p.k}</div>
                <div className="passport-leaf__note mt-0.5 text-[9px]">{p.sub}</div>
              </div>
              <div className="flex-none text-right">
                <LeafPill tone={p.tone}>{p.v}</LeafPill>
                <div className="passport-leaf__faint mt-0.5 text-[8.5px]">{p.date}</div>
              </div>
            </div>
          ))}
        </div>
      );

    case "seals":
      return (
        <div className="flex flex-wrap justify-center gap-3.5 py-1">
          {block.items.map((s, i) => (
            <Wax
              key={`${s.t}-${i}`}
              tone={s.tone as SealTone}
              title={s.t}
              caption={s.cap}
              earned={s.earned}
              size={84}
            />
          ))}
        </div>
      );

    case "hero":
      return (
        <div className="flex flex-col items-center gap-3 py-1 text-center">
          <Wax tone={block.tone} title={block.title} earned={block.earned} size={112} />
          <p className="passport-leaf__muted m-0 max-w-[32ch] text-[10px] leading-relaxed">
            {block.text}
          </p>
        </div>
      );

    case "timeline":
      return (
        <div>
          <BlockTitle>{block.title}</BlockTitle>
          {block.items.map((e, i) => (
            <div
              key={`${e.t}-${i}`}
              className="passport-leaf__row flex items-baseline gap-2.5 py-1.5 last:border-b-0"
            >
              <span className="passport-mono passport-leaf__mono w-[64px] flex-none text-[8.5px]">
                {e.time}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px]">{e.t}</div>
                <div className="passport-leaf__note mt-0.5 text-[9px] leading-snug">{e.sub}</div>
              </div>
              <span className="passport-leaf__faint flex-none text-[8.5px]">{e.src}</span>
            </div>
          ))}
        </div>
      );

    case "verify":
      // The design mocks a scannable QR. It is NOT reproduced: a code that
      // looks scannable but resolves to nothing is worse than no code on a
      // document a partner may rely on. Public verification is a deferred
      // capability (see DEDICATED_PAGE_ARCHITECTURE.md); until it exists the
      // page carries what a verifier can actually check by hand.
      return (
        <div className="passport-leaf__verify flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[8.5px] font-bold uppercase tracking-[0.14em]">
              Verify credential
            </div>
            <p className="passport-leaf__muted m-0 mt-1 text-[9px] leading-relaxed">{block.text}</p>
            <div className="passport-mono passport-leaf__mono mt-1 text-[8.5px]">{block.code}</div>
            <div className="passport-mono passport-leaf__mono text-[8.5px]">{block.fingerprint}</div>
          </div>
          <Wax tone="gold" title="VERIFIED" caption="COMPLIANCE VERIFIER" size={72} />
        </div>
      );

    case "note":
      return (
        <div className="passport-leaf__aside">
          <div className="passport-leaf__k">{block.title}</div>
          <p className="passport-leaf__note m-0 mt-1 text-[9.5px] leading-relaxed">{block.text}</p>
        </div>
      );

    case "signature":
      return (
        <div className="flex flex-wrap items-end gap-3.5">
          <div className="min-w-0 flex-1">
            <div className="passport-leaf__k">Issued by</div>
            <div className="passport-leaf__signature mt-1">{block.name}</div>
            <div className="passport-leaf__sigrule mt-1" />
            <div className="passport-leaf__muted mt-1 text-[9px]">{block.role}</div>
            <div className="passport-leaf__muted text-[9px]">{block.org}</div>
          </div>
          <Wax tone="gold" title="OFFICIAL SEAL" caption="AURIXA SYSTEMS" size={76} />
        </div>
      );

    case "banner":
      return <div className="passport-leaf__banner">{block.text}</div>;

    default: {
      // Exhaustiveness: a new block kind must be drawn, not silently skipped.
      const _never: never = block;
      return _never;
    }
  }
}
