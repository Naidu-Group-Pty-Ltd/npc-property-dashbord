import { useNotificationsOptional } from '@/contexts/NotificationsContext';
import type { NavItemDef } from '@/lib/navigation/registry';

/** Which notification types each badge counts. */
const BADGE_TYPES: Record<NonNullable<NavItemDef['badge']>, readonly string[]> = {
  // A builder acknowledged the reader's activation (docs/builder-portal/52).
  builder_activations: ['builder_activation_acknowledged'],
};

/**
 * The unread count beside a navigation entry. It reads the bell's own feed,
 * which is the reader's notifications only, so it can never count somebody
 * else's.
 */
export function NavItemBadge({ kind }: { kind: NonNullable<NavItemDef['badge']> }) {
  const context = useNotificationsOptional();
  const types = BADGE_TYPES[kind];
  const count = (context?.notifications ?? []).filter((n) => !n.read && types.includes(String(n.type))).length;
  if (!count) return null;
  return (
    <span
      className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground"
      aria-label={`${count} new`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
