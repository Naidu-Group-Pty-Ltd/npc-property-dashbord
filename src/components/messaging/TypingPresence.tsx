/**
 * TypingPresence — shared "someone is typing" surface for every chat surface.
 *
 * Design: the person's NAME is the hero. Each typist is assigned one of three
 * highlight colours — blue, yellow, purple — and the colour is applied ONLY to
 * that person's name chip (avatar + name), never to the surrounding row. A soft
 * animated sweep and three-dot cadence read as live presence rather than a
 * loading spinner. Respects reduced motion.
 */
import { cn } from '@/lib/utils';

export interface TypingPerson {
  name: string;
  /** Optional stable id — used to keep the assigned colour consistent. */
  id?: string | null;
}

/** Blue · Yellow · Purple — semantic tokens only. */
const TINTS = [
  {
    key: 'blue',
    name: 'bg-info/15 text-info',
    avatar: 'bg-info/20 text-info ring-info/40',
    sweep: 'via-info/30',
  },
  {
    key: 'yellow',
    name: 'bg-warning/15 text-warning',
    avatar: 'bg-warning/20 text-warning ring-warning/40',
    sweep: 'via-warning/30',
  },
  {
    key: 'purple',
    name: 'bg-chart-5/15 text-chart-5',
    avatar: 'bg-chart-5/20 text-chart-5 ring-chart-5/40',
    sweep: 'via-chart-5/30',
  },
] as const;

function tintFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 9973;
  return TINTS[hash % TINTS.length];
}

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

/** Three-dot cadence. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-[3px]', className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-current opacity-70 animate-bounce motion-reduce:animate-none"
          style={{ animationDelay: `${i * 140}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  );
}

export function TypingPresence({
  people,
  size = 'md',
  className,
}: {
  people: TypingPerson[];
  size?: 'sm' | 'md';
  className?: string;
}) {
  const unique: TypingPerson[] = [];
  const seen = new Set<string>();
  for (const p of people) {
    const key = (p.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  if (!unique.length) return null;

  const shown = unique.slice(0, 3);
  const extra = unique.length - shown.length;
  const verb = unique.length === 1 ? 'is typing' : 'are typing';
  const sm = size === 'sm';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2 py-1 backdrop-blur-sm',
        className,
      )}
      aria-live="polite"
      aria-label={`${shown.map((p) => p.name).join(', ')} ${verb}`}
    >
      {shown.map((p) => {
        const tint = tintFor(p.id || p.name);
        return (
          <span
            key={p.id ?? p.name}
            className={cn(
              'relative flex min-w-0 items-center gap-1 overflow-hidden rounded-full pr-1.5 font-semibold',
              tint.name,
              sm ? 'text-[10px]' : 'text-[11px]',
            )}
          >
            <span
              className={cn(
                'z-10 flex shrink-0 items-center justify-center rounded-full ring-1 font-bold uppercase',
                tint.avatar,
                sm ? 'h-4 w-4 text-[8px]' : 'h-5 w-5 text-[9px]',
              )}
            >
              {initial(p.name)}
            </span>
            <span className="z-10 min-w-0 truncate">{p.name}</span>
            {/* Highlight sweep — scoped to this person's chip only. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-full motion-reduce:hidden"
            >
              <span
                className={cn(
                  'absolute inset-y-0 -left-1/2 w-1/2 animate-[typing-sweep_1.8s_ease-in-out_infinite] bg-gradient-to-r from-transparent to-transparent',
                  tint.sweep,
                )}
              />
            </span>
          </span>
        );
      })}

      {extra > 0 && (
        <span className={cn('text-muted-foreground', sm ? 'text-[10px]' : 'text-[11px]')}>
          +{extra}
        </span>
      )}

      <span
        className={cn(
          'flex shrink-0 items-center gap-1.5 text-muted-foreground',
          sm ? 'text-[10px]' : 'text-[11px]',
        )}
      >
        {verb}
        <TypingDots className="shrink-0 text-muted-foreground" />
      </span>
    </div>
  );
}

export default TypingPresence;
