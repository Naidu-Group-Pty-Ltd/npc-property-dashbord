import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown, ChevronRight, Copy, Loader2, MailWarning, MoreHorizontal,
  Send, ShieldOff, UserPlus, Users,
} from "lucide-react";

import {
  passportRecipients, type RecipientFacts, type RecipientRow, type RecipientState,
} from "@/lib/aml/passport/passportRecipients.pure";

/**
 * Who holds this Passport — one line each, one act each.
 *
 * ── The two things this had to fix ────────────────────────────────────
 * **It was unreadable.** Every partner drew a three-line block inside a
 * bordered box inside a bordered card, and the same grants were then listed
 * a second time further down the page as "Link history". A compliance
 * operator scanning for "who has this, and what do I owe them" had to read
 * nine lines to learn three facts.
 *
 * **There was no way to stop.** `revoke_grant` has existed since the first
 * version of this feature and no surface ever called it, so a Passport could
 * be given and never taken back — on the one screen whose entire subject is
 * who may read a client's completed due diligence.
 *
 * ── How it reads now ──────────────────────────────────────────────────
 * One row per partner: name, standing, and the single act on offer. What
 * that act will do sits under it in one line and only when it is not
 * obvious. Everything else — withdrawing access, copying the last address —
 * is in the row's own menu, because a destructive act should be deliberate
 * and a rarely-used one should not compete with the common one.
 *
 * Lapsed and withdrawn access collapses into "Ended access". It is kept, not
 * hidden: "did we ever share this, and did we stop?" is an audit question
 * and the answer has to be one click away.
 *
 * ── Withdrawal is not deletion ────────────────────────────────────────
 * A grant records that a disclosure was authorised. Deleting it would
 * destroy that record; revoking it stops the access and keeps the history,
 * which is the only version of "remove this partner" a compliance register
 * may offer. The panel says so once, where the act is.
 */

const STATE_STYLE: Record<RecipientState, { label: string; className: string }> = {
  holds: { label: "live", className: "border-success/40 text-success" },
  expiring: { label: "expiring", className: "border-warning/40 text-warning" },
  undelivered: { label: "never emailed", className: "border-destructive/40 text-destructive" },
  lapsed: { label: "expired", className: "border-border text-muted-foreground" },
  revoked: { label: "withdrawn", className: "border-border text-muted-foreground" },
  never: { label: "not sent", className: "border-border text-muted-foreground" },
};

function RecipientLine({
  row, busy, spinning, onSend, onRevoke, onCopyEmail,
}: {
  row: RecipientRow;
  busy: boolean;
  spinning: boolean;
  onSend: (row: RecipientRow) => void;
  onRevoke: (row: RecipientRow) => void;
  onCopyEmail: (email: string) => void;
}) {
  const style = STATE_STYLE[row.state];
  const hasMenu = row.canRevoke || Boolean(row.lastDeliveredTo);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium">{row.partnerName}</span>
          <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${style.className}`}>
            {style.label}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            {row.partnerType.replace(/_/g, " ")}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground" title={row.detail}>
          {row.detail}
        </p>
        {/* The warning earns a line; the ordinary explanation does not. */}
        {row.blockedBy && (
          <p className="text-[11px] text-warning">{row.blockedBy}.</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant={row.state === "undelivered" || row.state === "never" ? "default" : "outline"}
          className="h-7 px-2.5 text-xs"
          onClick={() => onSend(row)}
          disabled={busy || row.blockedBy !== null}
          title={row.actionMeaning}
        >
          {spinning
            ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />
            : <Send className="mr-1.5 h-3 w-3" aria-hidden />}
          {row.actionLabel}
        </Button>

        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm" variant="ghost" className="h-7 w-7 p-0"
                disabled={busy}
                aria-label={`More actions for ${row.partnerName}`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {row.lastDeliveredTo && (
                <DropdownMenuItem onSelect={() => onCopyEmail(row.lastDeliveredTo!)}>
                  <Copy className="mr-2 h-3.5 w-3.5" aria-hidden />
                  <span className="truncate">Copy {row.lastDeliveredTo}</span>
                </DropdownMenuItem>
              )}
              {row.canRevoke && (
                <>
                  {row.lastDeliveredTo && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => onRevoke(row)}
                  >
                    <ShieldOff className="mr-2 h-3.5 w-3.5" aria-hidden />
                    Withdraw access
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

export function PassportRecipientsPanel({
  facts, busyAgreementId, onSend, onRevoke, onCopyEmail, onOnboard, workspaceEnabled,
}: {
  facts: RecipientFacts;
  /** The row currently mid-act, so only its own button spins. */
  busyAgreementId: string | null;
  onSend: (row: RecipientRow) => void;
  onRevoke: (row: RecipientRow) => void;
  onCopyEmail: (email: string) => void;
  onOnboard: () => void;
  /** null while unread — never rendered as "off" on a failed read. */
  workspaceEnabled: boolean | null;
}) {
  const reading = passportRecipients(facts);
  const busy = busyAgreementId !== null;
  const [showEnded, setShowEnded] = useState(false);

  const line = (row: RecipientRow) => (
    <RecipientLine
      key={row.agreementId}
      row={row}
      busy={busy}
      spinning={busyAgreementId === row.agreementId}
      onSend={onSend}
      onRevoke={onRevoke}
      onCopyEmail={onCopyEmail}
    />
  );

  return (
    <section className="rounded-lg border border-border/60" aria-label="Passport recipients">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="text-sm font-medium">Who holds this Passport</span>
          <span className="truncate text-xs text-muted-foreground">{reading.headline}</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs"
          onClick={onOnboard} disabled={busy}>
          <UserPlus className="mr-1.5 h-3 w-3" aria-hidden />
          Send to another partner
        </Button>
      </header>

      {/* The symptom, named once. A grant with no delivery reads as healthy in
          every register and is invisible to the partner. */}
      {reading.undelivered > 0 && (
        <p className="flex items-start gap-2 border-b border-border/60 bg-destructive/5 px-3 py-2 text-xs">
          <MailWarning className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          <span>
            {reading.undelivered === 1 ? "One partner has" : `${reading.undelivered} partners have`}{" "}
            access that was never emailed to anyone. The link is shown once and cannot be
            recovered — sending replaces the grant with one that is actually delivered.
          </span>
        </p>
      )}

      {reading.rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          A Passport goes to an organisation with a written CDD arrangement (AML/CTF Act Pt 2
          Div 7). Onboard the partner and the arrangement is recorded on the way through.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {reading.active.map(line)}
        </ul>
      )}

      {/* Ended access — kept, collapsed. "Did we share this, and did we
          stop?" is an audit question, so the answer stays one click away. */}
      {reading.ended.length > 0 && (
        <div className="border-t border-border/60">
          <button
            type="button"
            onClick={() => setShowEnded((open) => !open)}
            aria-expanded={showEnded}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showEnded
              ? <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
            Ended access ({reading.ended.length})
          </button>
          {showEnded && <ul className="divide-y divide-border/50">{reading.ended.map(line)}</ul>}
        </div>
      )}

      <footer className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
        {workspaceEnabled === true ? (
          <>
            Partners enrolled for their portal can also open this Passport signed in, from their
            own <span className="text-foreground">AML/CTF Compliance</span> page.
          </>
        ) : workspaceEnabled === false ? (
          <>
            The in-portal Compliance Passport is switched off on this deployment, so the emailed
            link is the only way a partner reaches this record.
          </>
        ) : null}
        {/* Said where the act is, once: a register records what happened, so
            the only "remove" it can offer is to stop the access. */}
        {reading.rows.some((r) => r.canRevoke) && (
          <>
            {workspaceEnabled !== null ? " " : ""}
            Withdrawing access stops a partner&apos;s link immediately; the grant is kept as the
            record that it was issued.
          </>
        )}
      </footer>
    </section>
  );
}
