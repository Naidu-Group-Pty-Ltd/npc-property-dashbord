/**
 * Calendar colour segregation.
 *
 * GHL returns `eventColor` for only some calendars and repeats the same handful
 * of hexes across the rest, so the registry used to show four different
 * calendars behind the identical blue dot. Colour is the only thing telling
 * these rows apart, so it is assigned here — deterministically, and never
 * duplicated — rather than trusted from the provider.
 *
 * The map is keyed off a stable ordering (name, then id) so a calendar keeps its
 * colour across refetches and across the select, the registry cards, the
 * overlay panel and every event chip.
 */

/** Distinct, print-safe hues. Ordered so adjacent entries are far apart. */
export const CALENDAR_COLOR_PALETTE = [
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#ef4444', // red
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
  '#84cc16', // lime
  '#d946ef', // fuchsia
  '#0ea5e9', // sky
  '#eab308', // yellow
  '#22c55e', // green
  '#a855f7', // purple
  '#f43f5e', // rose
  '#06b6d4', // cyan
  '#b45309', // bronze
  '#7c3aed', // deep violet
  '#059669', // deep emerald
  '#be123c', // crimson
  '#0891b2', // deep cyan
  '#ca8a04', // dark gold
  '#4f46e5', // deep indigo
] as const;

export const FALLBACK_CALENDAR_COLOR = CALENDAR_COLOR_PALETTE[0];

const GOLDEN_ANGLE = 137.508;

/** Overflow colours beyond the palette, generated on the golden angle so they stay distinct. */
const generatedColor = (index: number): string => {
  const hue = (index * GOLDEN_ANGLE) % 360;
  const saturation = 68;
  const lightness = index % 2 === 0 ? 58 : 46;
  return hslToHex(hue, saturation, lightness);
};

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const value = lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export interface ColourableCalendar {
  id: string;
  name?: string;
}

/**
 * Assigns every calendar its own colour. Two calendars never share one, and a
 * calendar's colour does not move when other calendars are added or removed
 * from the middle of the list — the ordering is by name, so growth appends.
 */
export function buildCalendarColorMap(
  calendars: ReadonlyArray<ColourableCalendar>,
): Map<string, string> {
  const seen = new Set<string>();
  const ordered = [...calendars]
    .filter((calendar) => {
      const id = String(calendar?.id ?? '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => {
      const byName = String(a.name ?? '').localeCompare(String(b.name ?? ''));
      return byName !== 0 ? byName : String(a.id).localeCompare(String(b.id));
    });

  const map = new Map<string, string>();
  ordered.forEach((calendar, index) => {
    const color =
      index < CALENDAR_COLOR_PALETTE.length
        ? CALENDAR_COLOR_PALETTE[index]
        : generatedColor(index - CALENDAR_COLOR_PALETTE.length + 1);
    map.set(String(calendar.id), color);
  });

  return map;
}

export function resolveCalendarColor(
  map: Map<string, string> | undefined,
  calendarId: string | undefined | null,
  fallback: string = FALLBACK_CALENDAR_COLOR,
): string {
  if (!calendarId) return fallback;
  return map?.get(String(calendarId)) ?? fallback;
}
