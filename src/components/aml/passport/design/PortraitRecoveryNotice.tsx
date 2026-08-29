/**
 * The holder's photograph is missing, and this says why — and offers the one
 * repair that exists.
 *
 * ## Why a surface at all
 *
 * The document portrait was extracted on every standalone verification and
 * deliberately discarded, so every Passport issued before that changed shows
 * no face — permanently, even though the document page it was cropped from is
 * still in NPC's own bucket. Nothing anywhere said so. The booklet drew an
 * empty frame, the operator read it as a rendering fault, and the one thing
 * that would fix it existed nowhere on the screen.
 *
 * ## Three rules
 *
 * **It is only shown when there is something to do.** The server decides:
 * `identity.portrait.recoverable` is set for the Command Centre alone, and
 * only where NPC still holds the document image. A Passport whose provider
 * keeps the media, or whose customer has not verified yet, gets the ordinary
 * absence note on the page and no button — a control that cannot work is
 * worse than none.
 *
 * **The cost is stated before the click.** It makes one billed provider call.
 * An operator is entitled to know that before they make it, not after.
 *
 * **It re-derives an image; it never re-decides an identity.** Said on the
 * card, because "run the ID check again" is what this looks like and is not
 * what it is. The verification, its verdict and every grant stand exactly as
 * they were.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { amlRelianceApi } from "@/lib/aml/amlRelianceApi";
import { portraitAbsenceNote, type PassportView } from "@/lib/aml/passport";

export function PortraitRecoveryNotice({
  view, caseId, canRecover, onRecovered,
}: {
  view: PassportView;
  caseId: string;
  /** MLRO — the Passport is the outward-facing document. */
  canRecover: boolean;
  onRecovered: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  const slot = view.identity?.portrait ?? null;
  if (!slot || slot.available || !slot.recoverable || !canRecover) return null;

  const run = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await amlRelianceApi.recoverDocumentPortrait(caseId);
      setOutcome({ ok: Boolean(res?.recovered), message: String(res?.message ?? "") });
      if (res?.recovered) onRecovered();
    } catch (e: unknown) {
      setOutcome({
        ok: false,
        message: "The photograph could not be recovered just now. Nothing has been changed — "
          + "the verification, the Passport and every grant stand exactly as they were.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-5 pt-4">
      <div className="passport-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-[68ch]">
            <div className="passport-kicker">Client Identity page</div>
            <p className="passport-dim mt-1 text-sm font-semibold">
              This Passport carries no photograph of the holder.
            </p>
            <p className="passport-faint mt-1.5 text-[11.5px] leading-relaxed">
              {portraitAbsenceNote("predates_portrait_capture")}. The identity document itself is
              still held against this case, so the portrait printed on it can be read from that
              image and placed on the Client Identity page — in the Command Centre, in the
              client's own copy and in every partner's.
            </p>
            <p className="passport-faint mt-1.5 text-[11.5px] leading-relaxed">
              This re-reads one image. It does not re-run the identity check: the verification,
              its outcome and every grant already issued stand exactly as they are. It makes one
              billed call to the verification provider.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void run(); }}
            disabled={busy}
            className="passport-action passport-action--primary w-auto"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            {busy ? "Reading the document…" : "Recover the holder's photograph"}
          </button>
        </div>
        {outcome && (
          <p
            role="status"
            className={`mt-3 text-[11.5px] leading-relaxed ${outcome.ok ? "passport-dim" : "passport-faint"}`}
          >
            {outcome.message}
          </p>
        )}
      </div>
    </div>
  );
}
