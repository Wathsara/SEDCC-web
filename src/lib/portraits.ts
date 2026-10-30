/**
 * Player portraits, resolved at build time.
 *
 * Photos live in src/assets/players/portraits/ named after the player's roster
 * id. Both the card and the portrait need to know whether a real photo exists —
 * the card drops its legibility scrim when it is showing a drawn silhouette
 * instead — so the lookup lives here rather than being done twice.
 *
 * ## Kit
 *
 * A side with its own kit gets its own folder:
 *
 *   portraits/<id>.webp              the club's default photo
 *   portraits/grade-4/<id>.webp      the same player in the Sunday kit
 *
 * A team folder always wins for that team. For a side marked `ownKit` in
 * config/season-2026-27.json there is no fall back to the default photo: a
 * player who turns out for both LOC 2 and Grade 4 would otherwise appear on the
 * Sunday squad page in the Saturday kit, which is worse than showing the
 * silhouette until the club has photographed them in the right one.
 */
import type { ImageMetadata } from 'astro';
import season from '@config/season-2026-27.json';
import { type Captaincy } from './site';

const files = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/players/portraits/**/*.{jpg,jpeg,png,webp,avif}',
  { eager: true },
);

/** Keyed by roster id, or "<team-slug>/<roster id>" for a kit-specific photo. */
const byId = new Map<string, ImageMetadata>();
for (const [path, mod] of Object.entries(files)) {
  const rest = path.split('/portraits/')[1];
  if (!rest) continue;
  byId.set(rest.replace(/\.[^.]+$/, ''), mod.default);
}

/** Sides that wear their own kit, so another side's photo will not do. */
const ownKit = new Set(
  (season.teams as Array<{ slug: string; ownKit?: boolean }>)
    .filter((t) => t.ownKit)
    .map((t) => t.slug),
);

/**
 * The player's photo in the right kit, or undefined if the club has not
 * supplied one yet.
 *
 * @param team the side the photo is being shown for. Omitted — on /stats/, the
 *             Dream XI, anywhere the player is the club's rather than a side's
 *             — the default photo is used.
 */
export function portraitFor(id: string, team?: string): ImageMetadata | undefined {
  if (team) {
    const kit = byId.get(`${team}/${id}`);
    if (kit) return kit;
    if (ownKit.has(team)) return undefined;
  }
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
 *
 * Both the armband and the photograph are read for the side being listed, so a
 * vice-captain elsewhere is not promoted here and a player with no photo in
 * this side's kit sorts with the silhouettes.
 */
export function squadOrder<
  T extends { id: string; name: string; captaincy?: Captaincy | Partial<Record<string, Captaincy>> },
>(players: T[], team?: string): T[] {
  const armband = (p: T) =>
    !p.captaincy ? undefined : typeof p.captaincy === 'string' ? p.captaincy : team ? p.captaincy[team] : undefined;

  const rank = (p: T) => {
    const c = armband(p);
    if (c === 'captain') return 0;
    if (c === 'vice-captain') return 1;
    return portraitFor(p.id, team) ? 2 : 3;
  };

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
