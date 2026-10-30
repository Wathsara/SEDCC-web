/*
  The sync output is committed, but the site must still build without it: a
  fresh clone, or a season whose data has been cleared, would otherwise fail
  the build outright rather than falling back to the empty states these pages
  already have. Glob imports yield nothing when the file is absent, where a
  direct import throws at build time.
*/
const dataFile = <T,>(
  modules: Record<string, { default: unknown }>,
  fallback: T,
): T => (Object.values(modules)[0]?.default as T) ?? fallback;

const fixturesRaw = dataFile(
  import.meta.glob<{ default: unknown }>('../../data/playhq/fixtures.json', { eager: true }),
  { teams: [] },
);
const laddersRaw = dataFile(
  import.meta.glob<{ default: unknown }>('../../data/playhq/ladders.json', { eager: true }),
  { grades: [] },
);
const weeklyRaw = dataFile(
  import.meta.glob<{ default: unknown }>('../../data/playhq/stats/latest-weekly.json', {
    eager: true,
  }),
  {},
);
const seasonStatsRaw = dataFile(
  import.meta.glob<{ default: unknown }>('../../data/playhq/stats/season.json', { eager: true }),
  { players: [] },
);
import type { LadderGrade, TeamFixtures, WeeklyStats, SeasonStats } from './playhq-types';

/*
  Read-only view over the committed sync output. Nothing here talks to PlayHQ —
  the API is only ever called by scripts/playhq/ at sync time.

  Shapes mirror what scripts/playhq/sync.ts and aggregate.ts actually write:
    fixtures.json  { syncedAt, season, teams: TeamFixtures[] }
    ladders.json   { syncedAt, season, grades: LadderGrade[] }
  See scripts/playhq/types.ts — that file is the contract, not this one.

  Every file starts as a placeholder with null timestamps and empty arrays and
  stays that way until the first Monday sync, so the honest default is "empty"
  and callers branch on hasX() rather than rendering a zero.
*/

export const fixtures = fixturesRaw as unknown as { syncedAt: string | null; teams: TeamFixtures[] };
export const ladders = laddersRaw as unknown as { syncedAt: string | null; grades: LadderGrade[] };
export const weekly = weeklyRaw as unknown as WeeklyStats;
export const seasonStats = seasonStatsRaw as unknown as SeasonStats;

/** True once a sync has written real results rather than placeholders. */
export const hasSynced = fixtures.syncedAt !== null;

export function teamFixtures(slug: string): TeamFixtures | undefined {
  return fixtures.teams.find((t) => t.slug === slug);
}

/** Ladder entries key off `slug`, and the standings nest under `ladders[]`. */
export function teamLadder(slug: string): LadderGrade | undefined {
  return ladders.grades.find((g) => g.slug === slug);
}

export const hasWeeklyStats = weekly.topBatter !== null || weekly.topBowler !== null;
export const hasSeasonStats = (seasonStats.players?.length ?? 0) > 0;
export const hasFixtures = fixtures.teams.length > 0;
export const hasLadders = ladders.grades.length > 0;

/* ---------------------------------------------------------------------------
   Cross-team views for the landing page.
   ------------------------------------------------------------------------ */

import type { NormalisedGame } from './playhq-types';

export interface GameWithTeam extends NormalisedGame {
  teamSlug: string;
  teamName: string;
}

const allGames: GameWithTeam[] = fixtures.teams.flatMap((t) =>
  t.games.map((g) => ({ ...g, teamSlug: t.slug, teamName: t.name })),
);

const time = (g: NormalisedGame) => new Date(g.dates[0] ?? 0).getTime();

/** Games not yet played, soonest first. */
export const upcoming: GameWithTeam[] = allGames
  .filter((g) => g.status !== 'FINAL' && g.outcome === null)
  .sort((a, b) => time(a) - time(b));

/** Completed games, most recent first. */
export const results: GameWithTeam[] = allGames
  .filter((g) => g.status === 'FINAL' || g.outcome !== null)
  .sort((a, b) => time(b) - time(a));

/**
 * How much of the season has been played, 0 to 1.
 *
 * Counted across the club rather than per side, because the Dream Team is one
 * XI drawn from all three. A side whose association has only published part of
 * its draw — the VSCA releases Grade 4 in stages — would otherwise read as
 * nearly finished after two rounds, and drag the club's progress up with it.
 * The longest published draw is the best estimate of a full season there is.
 */
export const seasonProgress: number = (() => {
  // A bye is not a game here — it sits in its own array on the team — so
  // games[] needs no filtering before it is counted.
  const seasons = fixtures.teams.map((t) => {
    const games = t.games ?? [];
    return {
      played: games.filter((g) => g.status === 'FINAL' || g.outcome !== null).length,
      scheduled: games.length,
    };
  });
  const scheduled = Math.max(0, ...seasons.map((s) => s.scheduled));
  if (!scheduled) return 0;
  const played = Math.max(0, ...seasons.map((s) => s.played));
  return Math.min(1, played / scheduled);
})();

/** Last few outcomes for a side, most recent first — the form guide. */
export function form(slug: string, count = 5): NormalisedGame['outcome'][] {
  return results
    .filter((g) => g.teamSlug === slug)
    .slice(0, count)
    .map((g) => g.outcome);
}
