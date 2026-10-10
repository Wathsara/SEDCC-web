/**
 * Player portraits, resolved at build time.
 *
 * Photos live in src/assets/players/portraits/ named after the player's roster
 * id. Both the card and the portrait need to know whether a real photo exists —
 * the card drops its legibility scrim when it is showing a drawn silhouette
 * instead — so the lookup lives here rather than being done twice.
 */
import type { ImageMetadata } from 'astro';

const files = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/players/portraits/*.{jpg,jpeg,png,webp,avif}',
  { eager: true },
);

const byId = new Map<string, ImageMetadata>();
for (const [path, mod] of Object.entries(files)) {
  const id = path.split('/').pop()?.replace(/\.[^.]+$/, '');
  if (id) byId.set(id, mod.default);
}

/** The player's photo, or undefined if the club has not supplied one yet. */
export function portraitFor(id: string): ImageMetadata | undefined {
  return byId.get(id);
}

export const portraitCount = byId.size;

/**
 * Squad order: captain, vice-captain, then players with a photograph, then the
 * rest — alphabetically within each group.
 *
 * The two leaders head the list because that is how a team sheet is read, and
 * in that order. Photographs come next because a grid alternating portraits and
 * silhouettes looks broken rather than like a squad part-way through a photo
 * shoot; grouped, the silhouettes become an obvious tail instead of gaps
 * scattered through it.
 */
export function squadOrder<
  T extends { id: string; name: string; captaincy?: 'captain' | 'vice-captain' },
>(players: T[]): T[] {
  const rank = (p: T) =>
    p.captaincy === 'captain' ? 0 : p.captaincy === 'vice-captain' ? 1 : byId.has(p.id) ? 2 : 3;

  /*
    Captains keep the order config/players.json lists them in; everyone else is
    alphabetical. A side can have more than one captain, and which of them leads
    the card is the club's call, not the alphabet's — sorting them by name put
    Malith Kanahara ahead of Yasuntha Gamalath, which is not the order the club
    wanted. Move the entries in players.json to change it.
  */
  const listed = new Map(players.map((p, i) => [p.id, i]));
  return [...players].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (rank(a) === 0) return listed.get(a.id)! - listed.get(b.id)!;
    return a.name.localeCompare(b.name, 'en-AU');
  });
}
