/**
 * The Command Centre's view of the booklet: the shared `PassportBook` in a
 * dialog, with the document's identifying bar above it.
 *
 * The viewer itself is deliberately NOT implemented here — it is shared with
 * the Client Portal so the officer and the client are looking at the same
 * artefact. See `PassportBook.tsx`.
 */
import { useMemo } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { buildBooklet, type PassportView } from "@/lib/aml/passport";
import { PassportBook } from "./PassportBook";

export function PassportBooklet({
  view,
  onClose,
}: {
  view: PassportView;
  onClose: () => void;
}) {
  const pages = useMemo(() => buildBooklet(view), [view]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="passport-scope max-w-[1180px] gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">
          Digital Compliance Passport for {view.header.subject ?? "this customer"}
        </DialogTitle>

        <div className="passport-bookbar flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="passport-display text-sm font-semibold uppercase tracking-[0.12em]">
              AML/CTF Compliance Passport
            </div>
            <div className="passport-mono passport-faint mt-0.5 truncate text-[10px]">
              {[view.header.credential, view.header.current_version_label, view.header.subject]
                .filter(Boolean)
                .join("  ·  ")}
            </div>
          </div>
          <span className="passport-sync">
            <span aria-hidden="true">◈</span>
            Synchronised with journey
          </span>
        </div>

        <PassportBook pages={pages} onClose={onClose} className="max-h-[78vh]" />
      </DialogContent>
    </Dialog>
  );
}
