/**
 * The digital passport booklet.
 *
 * The Command pages are a *register* — dense, dark, operational. The booklet is
 * the same record presented as the document it stands for: cream paper, foil
 * rules, a guilloche rosette and one leaf at a time. Both read from the same
 * projection, so they cannot disagree; only the presentation differs.
 *
 * Leaves are built from the projection rather than declared, so a customer with
 * no partners simply has no partner leaf — the booklet never prints a page that
 * says nothing.
 */
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { PassportView } from "@/lib/aml/passport";
import { formatPassportDate } from "../format";
import { Wax } from "./primitives";

type Leaf = {
  key: string;
  kicker: string;
  title: string;
  sub?: string;
  body: JSX.Element;
};

function LeafField({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <div className="passport-leaf__k">{k}</div>
      <div className="mt-0.5 text-[11px] leading-snug">{v || "—"}</div>
    </div>
  );
}

function LeafRow({ k, v, note }: { k: string; v?: string; note?: string }) {
  return (
    <div className="passport-leaf__row flex items-baseline gap-3 py-1.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold">{k}</div>
        {note && <div className="passport-leaf__note mt-0.5 text-[10px] leading-snug">{note}</div>}
      </div>
      {v && <span className="passport-leaf__muted text-[10px]">{v}</span>}
    </div>
  );
}

export function PassportBooklet({
  view,
  onClose,
}: {
  view: PassportView;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [turning, setTurning] = useState<"fwd" | "back" | null>(null);

  const leaves = useMemo<Leaf[]>(() => {
    const h = view.header;
    const out: Leaf[] = [];

    out.push({
      key: "identity",
      kicker: "Bearer",
      title: "Identity",
      sub: "The customer this Passport was issued for.",
      body: (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {view.identity.fields.slice(0, 8).map((f) => (
            <LeafField key={f.key} k={f.label} v={f.value} />
          ))}
        </div>
      ),
    });

    out.push({
      key: "journey",
      kicker: "How it was built",
      title: "Compliance Journey",
      sub: `${view.journey.recorded} of ${view.journey.total} milestones recorded.`,
      body: (
        <div>
          <div className="passport-progress mb-3 h-1.5 overflow-hidden rounded-full">
            <div
              className="passport-progress__bar h-full rounded-full"
              style={{ width: `${view.journey.percent}%` }}
            />
          </div>
          {view.journey.phases.map((p) => (
            <LeafRow
              key={p.phase}
              k={p.label}
              v={`${p.recorded}/${p.total}`}
              note={p.milestones.filter((m) => m.recorded).map((m) => m.title).join(" · ") || undefined}
            />
          ))}
        </div>
      ),
    });

    if (view.verification.parties.length > 0) {
      out.push({
        key: "verification",
        kicker: "How it was proven",
        title: "Verification",
        body: (
          <div>
            {view.verification.parties.map((p) => (
              <LeafRow
                key={p.party}
                k={p.party}
                v={p.verified ? "VERIFIED" : "INCOMPLETE"}
                note={p.method ?? undefined}
              />
            ))}
          </div>
        ),
      });
    }

    if (view.stamps.length > 0) {
      out.push({
        key: "stamps",
        kicker: "What it certifies",
        title: "Seals",
        body: (
          <div className="flex flex-wrap justify-center gap-4 pt-2">
            {view.stamps.slice(0, 6).map((s) => (
              <Wax
                key={`${s.code}-${s.at}`}
                tone={s.tone as "gold" | "green" | "navy" | "blue" | "red"}
                title={s.title}
                caption={s.portal}
                size={84}
              />
            ))}
          </div>
        ),
      });
    }

    out.push({
      key: "authority",
      kicker: "Issued under",
      title: "Authority",
      body: (
        <div className="space-y-3">
          <p className="passport-leaf__statement text-center text-[13px] leading-relaxed">
            The issuer certifies that the customer due diligence recorded in this Passport was
            carried out under its AML/CTF programme.
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <LeafField k="Credential" v={h.credential ?? "—"} />
            <LeafField k="Version" v={h.current_version_label ?? "—"} />
            <LeafField k="Fingerprint" v={h.evidence_fingerprint_short ?? "—"} />
            <LeafField
              k="Issued"
              v={h.last_issued_at ? formatPassportDate(h.last_issued_at) : "—"}
            />
            <LeafField k="Issuer" v={h.issuer_org} />
            <LeafField k="Officer" v={h.officer_label ?? "—"} />
          </div>
          <div className="passport-leaf__aside">
            <div className="passport-leaf__k">Reliance</div>
            <p className="mt-1 text-[10px] leading-relaxed">
              A partner relying on this Passport remains responsible for its own obligations. An
              issued version is immutable; material change supersedes it.
            </p>
          </div>
        </div>
      ),
    });

    return out;
  }, [view]);

  const total = leaves.length + 1; // cover + leaves
  const go = (delta: number) => {
    const next = Math.min(total - 1, Math.max(0, index + delta));
    if (next === index) return;
    setTurning(delta > 0 ? "fwd" : "back");
    setIndex(next);
    window.setTimeout(() => setTurning(null), 420);
  };

  const leaf = index === 0 ? null : leaves[index - 1];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="passport-scope max-w-[560px] border-none bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">
          Digital Compliance Passport for {view.header.subject ?? "this customer"}
        </DialogTitle>

        <div
          className={cn(
            "relative mx-auto w-full",
            turning === "fwd" && "passport-turn-fwd",
            turning === "back" && "passport-turn-back",
          )}
          style={{ perspective: 1400 }}
        >
          {index === 0 ? (
            <div className="passport-cover relative flex aspect-[470/648] flex-col items-center justify-center rounded-xl p-8 text-center">
              <span aria-hidden="true" className="passport-cover__frame" />
              <div className="passport-kicker">Aurixa Systems</div>
              <h2 className="passport-display mt-3 text-2xl font-semibold uppercase tracking-[0.14em] text-[color:var(--passport-gold-soft)]">
                Compliance
                <br />
                Passport
              </h2>
              <div className="passport-cover__rule my-5 w-2/3" />
              <div className="passport-mono text-xs text-[color:var(--passport-gold-faint)]">
                {view.header.credential ?? "NOT ISSUED"}
              </div>
              <p className="passport-mono mt-2 text-[10px] text-[color:var(--passport-gold-faint)]">
                AML/CTF · {view.header.issuer_org}
              </p>
            </div>
          ) : (
            <div className="passport-leaf relative flex aspect-[470/648] flex-col p-6">
              <span aria-hidden="true" className="passport-leaf__guilloche" />
              <span aria-hidden="true" className="passport-leaf__frame-outer" />
              <span aria-hidden="true" className="passport-leaf__frame-inner" />

              <div className="relative flex-none text-center">
                <div className="passport-leaf__kicker">{leaf!.kicker}</div>
                <h3 className="passport-leaf__title">{leaf!.title}</h3>
                <div className="passport-leaf__divider mx-auto my-2 w-1/2" />
                {leaf!.sub && (
                  <p className="passport-leaf__sub text-[10px] leading-relaxed">{leaf!.sub}</p>
                )}
              </div>

              <div className="relative mt-3 min-h-0 flex-1 overflow-y-auto pr-1">{leaf!.body}</div>

              <div className="passport-leaf__faint relative mt-2 flex-none text-center text-[8px] tracking-[0.2em]">
                AURIXA SYSTEMS · {view.header.credential ?? "—"}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            className="passport-action w-auto"
            onClick={() => go(-1)}
            disabled={index === 0}
          >
            ← Previous
          </button>
          <span className="passport-faint passport-mono text-xs">
            {index + 1} / {total}
          </span>
          <button
            type="button"
            className="passport-action w-auto"
            onClick={() => go(1)}
            disabled={index === total - 1}
          >
            Next →
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
