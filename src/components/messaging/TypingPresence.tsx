/**
 * TypingPresence — shared "someone is typing" surface for every chat surface.
 *
 * Design: the person's NAME is the hero (initial avatar + highlighted name
 * chip), with a soft animated highlight sweep and three-dot cadence so it reads
 * as live presence rather than a loading spinner. Respects reduced motion.
 */
import { cn } from '@/lib/utils';

export interface TypingPerson {
  name: string;
  /** Optional stable id — used for the avatar tint only. */
  id?: string | null;
}

const TINTS = [
  'bg-primary/15 text-primary ring-primary/30',
  'bg-info/15 text-info ring-info/30',
  'bg-success/15 text-success ring-success/30',
  'bg-warning/15 text-warning ring-warning/30',
  'bg-accent/20 text-accent-foreground ring-accent/40',
];

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
        'flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-2 py-1 backdrop-blur-sm',
        className,
      )}
      aria-live="polite"
      aria-label={`${shown.map((p) => p.name).join(', ')} ${verb}`}
    >
      <span className="flex items-center -space-x-1.5">
        {shown.map((p) => (
          <span
            key={p.id ?? p.name}
            className={cn(
              'flex items-center justify-center rounded-full ring-1 font-bold uppercase',
              tintFor(p.id || p.name),
              sm ? 'h-4 w-4 text-[8px]' : 'h-5 w-5 text-[9px]',
            )}
          >
            {initial(p.name)}
          </span>
        ))}
      </span>

      <span className={cn('flex min-w-0 items-center gap-1.5', sm ? 'text-[10px]' : 'text-[11px]')}>
        <span className="relative min-w-0 truncate rounded-md bg-primary/10 px-1.5 py-[1px] font-semibold text-primary">
          <span className="relative z-10">
            {shown.map((p) => p.name).join(', ')}
            {extra > 0 ? ` +${extra}` : ''}
          </span>
          {/* Highlight sweep */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-md motion-reduce:hidden"
          >
            <span className="absolute inset-y-0 -left-1/2 w-1/2 animate-[typing-sweep_1.8s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-primary/25 to-transparent" />
          </span>
        </span>
        <span className="shrink-0 text-muted-foreground">{verb}</span>
        <TypingDots className="shrink-0 text-primary" />
      </span>
    </div>
  );
}

export default TypingPresence;
