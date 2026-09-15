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
