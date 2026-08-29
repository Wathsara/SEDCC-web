import { allTime } from './site';

/*
  Season photos are imported eagerly so Astro's asset pipeline optimises them at
  build time. The keys are the filenames recorded in config/all-time.json —
  a mismatch there shows up as a missing photo, not a broken build.
*/
const photos = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/*-team.jpg',
  { eager: true },
);

const byFile = new Map(
  Object.entries(photos).map(([path, mod]) => [path.split('/').pop()!, mod.default]),
);

export type SeasonEntry = (typeof allTime.seasons)[number] & {
  image?: ImageMetadata;
};

/** Club history, oldest first — the growth from one side to three. */
export const seasons: SeasonEntry[] = allTime.seasons.map((s) => ({
  ...s,
  image: byFile.get(s.photo),
}));

export const firstSeason = seasons.find((s) => s.first);
