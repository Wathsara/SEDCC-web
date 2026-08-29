/*
  Display helpers. The rules here come from what the PlayHQ data actually looks
  like, not from what would be convenient.
*/

/**
 * PlayHQ returns firstName/lastName as null when a participant has hidden their
 * profile, and fill-ins are common in suburban cricket. Never render
 * "null null" or "undefined".
 */
export function playerName(
  first?: string | null,
  last?: string | null,
): string {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || 'Fill-in player';
}

const MELBOURNE = 'Australia/Melbourne';

export function formatDate(
  value: string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' },
): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', { ...opts, timeZone: MELBOURNE }).format(d);
}

/** Machine-readable date for <time datetime="…">. */
export function isoDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export const CATEGORY_LABELS: Record<string, string> = {
  'match-report': 'Match report',
  'club-news': 'Club news',
  'player-profile': 'Player profile',
  announcement: 'Announcement',
  'season-review': 'Season review',
  social: 'Social',
};
