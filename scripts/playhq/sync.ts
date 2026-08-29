/**
 * Weekly sync: fixtures, ladders and game summaries for every configured team.
 *
 *   npm run playhq:sync
 *
 * Writes data/playhq/{fixtures,ladders}.json and caches each finished game at
 * data/playhq/games/{gameId}.json. Runs in CI on Monday mornings.
 *
 * Teams with a null gradeId are skipped cleanly — that is the expected state
 * until the associations publish 2026/27 grades.
 */

import { resolve } from 'node:path';

import { fixtureForGrade, ladderForGrade, summaryForGame } from './client.js';
import type {
  FixtureRound,
  GameSummary,
  GradeFixture,
  NormalisedGame,
  PlayingSurface,
  TeamConfig,
  TeamFixtures,
} from './types.js';
import {
  DATA_DIR, fileExists, loadSeasonConfig, log, readJson, stat, writeJson,
} from './utils.js';

function surfaceFor(fixture: GradeFixture, id: string | null): PlayingSurface | undefined {
  if (!id) return undefined;
  return fixture.playingSurfaces?.find((s) => s.id === id);
}

/** Team innings totals live in the period, not on the competitor. */
function scoreLine(summary: GameSummary | null, teamId: string): string | null {
  if (!summary?.periods) return null;

  const innings: string[] = [];
  for (const period of summary.periods) {
    const batting = period.teams.find((t) => t.id === teamId && t.discipline === 'BATTING');
    if (!batting) continue;
    const runs = stat(batting.statistics, 'TOTAL_SCORE');
    const wickets = stat(batting.statistics, 'TOTAL_OUTS');
    const overs = stat(batting.statistics, 'TOTAL_OVERS');
    innings.push(wickets >= 10 ? `${runs} (${overs} ov)` : `${wickets}/${runs} (${overs} ov)`);
  }
  return innings.length ? innings.join(' & ') : null;
}

function normaliseGames(
  fixture: GradeFixture,
  teamId: string,
  summaries: Map<string, GameSummary>,
): { games: NormalisedGame[]; byes: TeamFixtures['byes'] } {
  const games: NormalisedGame[] = [];
  const byes: TeamFixtures['byes'] = [];
  const teamName = new Map(fixture.teams.map((t) => [t.id, t.name]));

  for (const round of fixture.rounds as FixtureRound[]) {
    // Byes have no game object at all. Record them or the week disappears.
    const hasBye = (round.byes ?? []).some((b) => (b.teamID ?? b.id) === teamId);
    if (hasBye) byes.push({ round: round.name, roundShort: round.abbreviatedName });

    for (const game of round.games ?? []) {
      // Finals fixtures are created before qualifiers are known: teams is [].
      const us = game.teams?.find((t) => t.id === teamId);
      if (!us) continue;

      const them = game.teams.find((t) => t.id !== teamId);
      const surface = surfaceFor(fixture, game.schedule?.[0]?.playingSurfaceId ?? null);
      const summary = summaries.get(game.id) ?? null;
      const suburb = surface?.venue?.address?.suburb ?? null;

      games.push({
        id: game.id,
        status: game.status,
        type: game.type,
        round: round.name,
        roundShort: round.abbreviatedName,
        isFinal: round.isFinalRound,
        // twoDay games carry two dates. Keep both.
        dates: (game.schedule ?? []).map((s) => s.dateTime).filter(Boolean),
        isHome: us.isHomeTeam,
        opponent: them ? teamName.get(them.id) ?? 'TBC' : 'TBC',
        outcome: us.outcome ?? null,
        venue: surface?.venue?.name ?? null,
        ground: surface?.name ?? null,
        suburb,
        mapQuery: surface?.venue?.name
          ? encodeURIComponent([surface.venue.name, suburb, 'VIC'].filter(Boolean).join(', '))
          : null,
        ourScore: scoreLine(summary, teamId),
        theirScore: them ? scoreLine(summary, them.id) : null,
      });
    }
  }

  games.sort((a, b) => (a.dates[0] ?? '').localeCompare(b.dates[0] ?? ''));
  return { games, byes };
}

/**
 * Fetch a game summary, using the cached copy unless the fixture reports a newer
 * updatedAt. Finished games from earlier rounds are never re-requested.
 */
async function getSummary(gameId: string, updatedAt?: string): Promise<GameSummary | null> {
  const path = resolve(DATA_DIR, 'games', `${gameId}.json`);

  if (fileExists(path)) {
    const cached = await readJson<{ _syncedAt: string; _updatedAt?: string } & GameSummary>(path);
    if (!updatedAt || cached._updatedAt === updatedAt) return cached;
  }

  try {
    const summary = await summaryForGame(gameId);
    await writeJson(path, { ...summary, _syncedAt: new Date().toISOString(), _updatedAt: updatedAt });
    return summary;
  } catch (err) {
    // One unavailable scorecard shouldn't sink the whole sync.
    log.warn(`game ${gameId}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function main() {
  const season = await loadSeasonConfig(process.env.SEASON ?? '2026-27');
  const active = season.teams.filter((t) => t.active);

  log.step(`Syncing ${season.label}`);

  const fixturesOut: TeamFixtures[] = [];
  const laddersOut: unknown[] = [];
  let pending = 0;

  for (const team of active as TeamConfig[]) {
    if (!team.playhqGradeId || !team.playhqTeamId) {
      log.info(`${team.name}: no grade/team ID yet — skipping (expected pre-season)`);
      pending++;
      fixturesOut.push({
        slug: team.slug, name: team.name, competition: team.competition,
        gradeLabel: team.gradeLabel, gradeId: null, teamId: null, games: [], byes: [],
      });
      continue;
    }

    log.step(team.name);

    const fixture = await fixtureForGrade(team.playhqGradeId);
    const ourGames = (fixture.rounds ?? []).flatMap((r) =>
      (r.games ?? []).filter((g) => g.teams?.some((t) => t.id === team.playhqTeamId)),
    );
    log.ok(`${ourGames.length} game(s) in fixture`);

    // Only completed games have a scorecard worth caching.
    const summaries = new Map<string, GameSummary>();
    const finished = ourGames.filter((g) => g.status === 'FINAL');
    for (const game of finished) {
      const summary = await getSummary(game.id, game.updatedAt);
      if (summary) summaries.set(game.id, summary);
    }
    if (finished.length) log.ok(`${summaries.size}/${finished.length} scorecard(s)`);

    const { games, byes } = normaliseGames(fixture, team.playhqTeamId, summaries);
    fixturesOut.push({
      slug: team.slug, name: team.name, competition: team.competition,
      gradeLabel: team.gradeLabel, gradeId: team.playhqGradeId, teamId: team.playhqTeamId,
      games, byes,
    });

    try {
      const ladder = await ladderForGrade(team.playhqGradeId);
      laddersOut.push({
        slug: team.slug, name: team.name, competition: team.competition,
        gradeLabel: team.gradeLabel, ourTeamId: team.playhqTeamId, ...ladder,
      });
      log.ok('ladder');
    } catch (err) {
      // Ladders 404 before round 1. Not an error worth failing the run over.
      log.warn(`ladder unavailable: ${err instanceof Error ? err.message : err}`);
    }
  }

  const syncedAt = new Date().toISOString();
  await writeJson(resolve(DATA_DIR, 'fixtures.json'), { syncedAt, season: season.season, teams: fixturesOut });
  await writeJson(resolve(DATA_DIR, 'ladders.json'), { syncedAt, season: season.season, grades: laddersOut });

  log.step('Sync complete');
  if (pending) {
    log.info(`${pending} team(s) awaiting grade IDs — run playhq:discover once grades are published.`);
  }
}

main().catch((err) => {
  console.error(`\n✗ Sync failed: ${err instanceof Error ? err.message : err}\n`);
  // Non-zero exit matters: CI must not commit half-written data.
  process.exit(1);
});
