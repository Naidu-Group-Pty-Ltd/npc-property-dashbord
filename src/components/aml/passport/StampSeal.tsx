import type { PassportStamp } from "@/lib/aml/passport";
import { cn } from "@/lib/utils";
import { formatStampDate } from "./format";

/**
 * One earned Passport stamp, rendered as its registry face.
 *
 * Everything shown here came from a record (`stamp.source`); this component
 * adds no state and accepts no free text. Shape and ink come from the closed
 * vocabulary; the classes live in `src/styles/passport-tokens.css` so no
 * colour is hard-coded in component code.
 */

const SIZE_CLASSES = {
  sm: "h-24 w-24 p-2",
  md: "h-36 w-36 p-3",
} as const;

export function StampSeal({
  stamp, size = "md", className,
}: { stamp: PassportStamp; size?: keyof typeof SIZE_CLASSES; className?: string }) {
  return (
    <div
      className={cn(
        "passport-seal",
        `passport-seal--${stamp.tone}`,
        `passport-seal--${stamp.shape}`,
        SIZE_CLASSES[size],
        className,
      )}
    >
      <span aria-hidden="true" className="passport-seal__ring" />
      <div className="relative min-w-0 px-1">
        <div className="text-[8px] font-semibold uppercase tracking-[0.16em] opacity-80">
          {stamp.org}
        </div>
        <div className={cn(
          "mt-1 font-serif font-bold leading-tight",
          size === "sm" ? "text-[10px]" : "text-xs",
        )}>
          {stamp.title}
        </div>
        <div className="mt-1 font-mono text-[8px] tracking-wide opacity-80">
          {formatStampDate(stamp.at)}
          {stamp.version ? ` · v${stamp.version}` : ""}
        </div>
        {stamp.actor ? (
          <div className="truncate font-mono text-[8px] opacity-70">{stamp.actor}</div>
        ) : null}
      </div>
    </div>
  );
}
