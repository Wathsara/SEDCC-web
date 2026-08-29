/**
 * Turn cached game summaries into player statistics.
 *
 *   npm run playhq:stats
 *
 * There is no player-statistics endpoint for cricket on the PlayHQ public API,
 * so every leaderboard on the site is computed here from individual scorecards.
 *
 * Player identity is by NAME — appearance IDs are regenerated per game and the
 * public cricket summary carries no profile ID. config/players.json holds the
 * alias table. Names with no roster match are written to stats/unmatched.json
 * rather than dropped or guessed at.
 */

import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  BattingLine, BowlingLine, FieldingLine, GameSummary,
  Performance, RosterPlayer, SeasonAggregate, TeamFixtures,
} from './types.js';
import {
  DATA_DIR, ballsToOvers, buildNameIndex, displayName, economyFromBalls,
  isoWeek, loadRoster, loadSeasonConfig, log, normaliseName, oversToBalls,
  readJson, round2, stat, writeJson,
} from './utils.js';

const teamSlugByPlayhqId = new Map<string, string>();

function battingFrom(stats: Parameters<typeof stat>[0], status: string | null): BattingLine {
  const runs = stat(stats, 'TOTAL_RUNS');
  const balls = stat(stats, 'BALLS_FACED');
  return {
    runs,
    balls,
    fours: stat(stats, 'FOURS'),
    sixes: stat(stats, 'SIXES'),
    strikeRate: balls > 0 ? round2((runs / balls) * 100) : 0,
    notOut: status === 'NOT_OUT',
    didNotBat: status === 'DID_NOT_BAT',
  };
}

function bowlingFrom(stats: Parameters<typeof stat>[0]): BowlingLine {
  const overs = stat(stats, 'OVERS');
  const balls = oversToBalls(overs);
  const runs = stat(stats, 'RUNS');
  return {
    overs,
    balls,
    maidens: stat(stats, 'MAIDENS'),
    runs,
    wickets: stat(stats, 'WICKETS'),
    economy: economyFromBalls(runs, balls) ?? 0,
  };
}

function fieldingFrom(stats: Parameters<typeof stat>[0]): FieldingLine {
  return {
    catches: stat(stats, 'TOTAL_CATCHES'),
    stumpings: stat(stats, 'STUMPINGS'),
    runOuts: stat(stats, 'TOTAL_RUN_OUTS'),
  };
}

/** Pull every Dreamers performance out of one scorecard. */
function extract(
  summary: GameSummary,
  ourTeamIds: Set<string>,
  index: Map<string, RosterPlayer>,
  unmatched: Map<string, number>,
): Performance[] {
  if (!summary.periods) return [];

  const teamName = new Map(summary.teams.map((t) => [t.id, t.name]));
  const ourTeamId = summary.teams.find((t) => ourTeamIds.has(t.id))?.id;
  if (!ourTeamId) return [];

  const opponent = summary.teams.find((t) => t.id !== ourTeamId)?.name ?? 'Unknown';
  const date = summary.schedule?.[summary.schedule.length - 1]?.dateTime
    ?? summary.schedule?.[0]?.dateTime
    ?? '';

  // Names live at the top level, numbers live in periods. Join on appearance id.
  const people = new Map(summary.appearances.map((a) => [a.id, a]));
  const byAppearance = new Map<string, Performance>();

  const perf = (appearanceId: string): Performance | null => {
    const person = people.get(appearanceId);
    if (!person || !ourTeamIds.has(person.teamId)) return null;

    if (!byAppearance.has(appearanceId)) {
      const name = displayName(person.firstName, person.lastName);
      const key = normaliseName(person.firstName, person.lastName);
      const match = key ? index.get(key) : undefined;

      // Hidden profiles come back with null names — not a roster gap, just private.
      if (key && !match) unmatched.set(name, (unmatched.get(name) ?? 0) + 1);

      byAppearance.set(appearanceId, {
        playerId: match?.id ?? null,
        displayName: match?.name ?? name,
        /**
         * False when PlayHQ gave us no name at all — a hidden profile or an
         * unregistered fill-in. These performances are real and belong on the
         * scorecard, but they cannot be attributed to a person: two different
         * fill-ins in the same round are indistinguishable. So they stay out of
         * season aggregates and out of the weekly award.
         */
        identifiable: Boolean(key),
        teamSlug: teamSlugByPlayhqId.get(person.teamId) ?? 'unknown',
        gameId: summary.id,
        round: summary.round?.name ?? '',
        date,
        opponent,
        batting: null,
        bowling: null,
        fielding: null,
      });
    }
    return byAppearance.get(appearanceId)!;
  };

  for (const period of summary.periods) {
    for (const team of period.teams) {
      if (!ourTeamIds.has(team.id)) continue;

      for (const appearance of team.appearances ?? []) {
        const p = perf(appearance.id);
        if (!p) continue;

        if (team.discipline === 'BATTING') {
          const line = battingFrom(appearance.statistics, appearance.status);
          if (!line.didNotBat) p.batting = line;
        } else {
          // Bowling appearances also carry the fielding stats for that innings.
          const bowl = bowlingFrom(appearance.statistics);
          if (bowl.balls > 0 || bowl.wickets > 0) p.bowling = bowl;
          const field = fieldingFrom(appearance.statistics);
          if (field.catches || field.stumpings || field.runOuts) {
            p.fielding = {
              catches: (p.fielding?.catches ?? 0) + field.catches,
              stumpings: (p.fielding?.stumpings ?? 0) + field.stumpings,
              runOuts: (p.fielding?.runOuts ?? 0) + field.runOuts,
            };
          }
        }
      }
    }
  }

  void teamName;
  return [...byAppearance.values()].filter((p) => p.batting || p.bowling || p.fielding);
}

/**
 * Weekly winners.
 *
 * Top batter: most runs in an innings; ties to fewer balls, then to not out.
 * Top bowler: most wickets; ties to fewer runs conceded, then better economy.
 *
 * No minimum overs or balls qualification — in Sunday fourth grade a 3/12 off
 * four is a real performance and a threshold would wrongly exclude it.
 *
 * Unidentifiable players are excluded: "Fill-in player" as the club's top bowler
 * of the week helps nobody, and we cannot tell two fill-ins apart anyway.
 *
 * Change the rule here and nowhere else.
 */
function pickWeeklyBest(performances: Performance[]) {
  const named = performances.filter((p) => p.identifiable);

  const batters = named
    .filter((p) => p.batting && p.batting.runs > 0)
    .sort((a, b) =>
      b.batting!.runs - a.batting!.runs ||
      a.batting!.balls - b.batting!.balls ||
      Number(b.batting!.notOut) - Number(a.batting!.notOut));

  const bowlers = named
    .filter((p) => p.bowling && p.bowling.wickets > 0)
    .sort((a, b) =>
      b.bowling!.wickets - a.bowling!.wickets ||
      a.bowling!.runs - b.bowling!.runs ||
      a.bowling!.economy - b.bowling!.economy);

  return { topBatter: batters[0] ?? null, topBowler: bowlers[0] ?? null };
}

function aggregate(allPerformances: Performance[]): SeasonAggregate[] {
  // Unnamed fill-ins are dropped here, not merged: two different anonymous
  // players in the same round would otherwise become one person with combined
  // figures, which is worse than omitting them.
  const performances = allPerformances.filter((p) => p.identifiable);
  const byPlayer = new Map<string, SeasonAggregate>();
  const games = new Map<string, Set<string>>();
  const bestBowling = new Map<string, { w: number; r: number }>();
  const highScore = new Map<string, { runs: number; notOut: boolean }>();

  for (const p of performances) {
    const key = p.playerId ?? `name:${p.displayName}`;

    if (!byPlayer.has(key)) {
      byPlayer.set(key, {
        playerId: p.playerId,
        displayName: p.displayName,
        teams: [],
        matches: 0,
        batting: {
          innings: 0, notOuts: 0, runs: 0, balls: 0, highScore: '—',
          average: null, strikeRate: null, fifties: 0, hundreds: 0, fours: 0, sixes: 0,
        },
        bowling: {
          innings: 0, balls: 0, overs: '0.0', maidens: 0, runs: 0,
          wickets: 0, average: null, economy: null, best: '—',
        },
        fielding: { catches: 0, stumpings: 0, runOuts: 0 },
      });
      games.set(key, new Set());
    }

    const agg = byPlayer.get(key)!;
    games.get(key)!.add(p.gameId);
    if (!agg.teams.includes(p.teamSlug)) agg.teams.push(p.teamSlug);

    if (p.batting) {
      agg.batting.innings++;
      agg.batting.runs += p.batting.runs;
      agg.batting.balls += p.batting.balls;
      agg.batting.fours += p.batting.fours;
      agg.batting.sixes += p.batting.sixes;
      if (p.batting.notOut) agg.batting.notOuts++;
      if (p.batting.runs >= 100) agg.batting.hundreds++;
      else if (p.batting.runs >= 50) agg.batting.fifties++;

      const hs = highScore.get(key);
      if (!hs || p.batting.runs > hs.runs || (p.batting.runs === hs.runs && p.batting.notOut)) {
        highScore.set(key, { runs: p.batting.runs, notOut: p.batting.notOut });
      }
    }

    if (p.bowling) {
      agg.bowling.innings++;
      agg.bowling.balls += p.bowling.balls;
      agg.bowling.maidens += p.bowling.maidens;
      agg.bowling.runs += p.bowling.runs;
      agg.bowling.wickets += p.bowling.wickets;

      const bb = bestBowling.get(key);
      if (!bb || p.bowling.wickets > bb.w || (p.bowling.wickets === bb.w && p.bowling.runs < bb.r)) {
        bestBowling.set(key, { w: p.bowling.wickets, r: p.bowling.runs });
      }
    }

    if (p.fielding) {
      agg.fielding.catches += p.fielding.catches;
      agg.fielding.stumpings += p.fielding.stumpings;
      agg.fielding.runOuts += p.fielding.runOuts;
    }
  }

  for (const [key, agg] of byPlayer) {
    agg.matches = games.get(key)!.size;

    const dismissals = agg.batting.innings - agg.batting.notOuts;
    agg.batting.average = dismissals > 0 ? round2(agg.batting.runs / dismissals) : null;
    agg.batting.strikeRate = agg.batting.balls > 0
      ? round2((agg.batting.runs / agg.batting.balls) * 100)
      : null;

    const hs = highScore.get(key);
    agg.batting.highScore = hs ? `${hs.runs}${hs.notOut ? '*' : ''}` : '—';

    // Overs must be summed as balls, never as decimals.
    agg.bowling.overs = ballsToOvers(agg.bowling.balls);
    agg.bowling.average = agg.bowling.wickets > 0
      ? round2(agg.bowling.runs / agg.bowling.wickets)
      : null;
    agg.bowling.economy = economyFromBalls(agg.bowling.runs, agg.bowling.balls);

    const bb = bestBowling.get(key);
    agg.bowling.best = bb ? `${bb.w}/${bb.r}` : '—';
  }

  return [...byPlayer.values()].sort((a, b) => b.batting.runs - a.batting.runs);
}

async function main() {
  const [season, roster, fixtures] = await Promise.all([
    loadSeasonConfig(process.env.SEASON ?? '2026-27'),
    loadRoster(),
    readJson<{ teams: TeamFixtures[] }>(resolve(DATA_DIR, 'fixtures.json')).catch(() => ({ teams: [] })),
  ]);

  const ourTeamIds = new Set<string>();
  for (const team of season.teams) {
    if (team.playhqTeamId) {
      ourTeamIds.add(team.playhqTeamId);
      teamSlugByPlayhqId.set(team.playhqTeamId, team.slug);
    }
  }

  if (ourTeamIds.size === 0) {
    log.warn('No PlayHQ team IDs configured yet — writing empty stat files.');
  }

  const index = buildNameIndex(roster.players);
  const unmatched = new Map<string, number>();

  let files: string[] = [];
  try {
    files = (await readdir(resolve(DATA_DIR, 'games'))).filter((f) => f.endsWith('.json'));
  } catch {
    log.info('No cached games yet — run npm run playhq:sync first.');
  }

  log.step(`Aggregating ${files.length} scorecard(s)`);

  const performances: Performance[] = [];
  for (const file of files) {
    const summary = await readJson<GameSummary>(resolve(DATA_DIR, 'games', file));
    performances.push(...extract(summary, ourTeamIds, index, unmatched));
  }
  const anonymous = performances.filter((p) => !p.identifiable).length;
  log.ok(`${performances.length} Dreamers performance(s)`);
  if (anonymous) {
    log.info(`${anonymous} from hidden or unregistered players — kept on scorecards, excluded from aggregates`);
  }

  // Season aggregates
  await writeJson(resolve(DATA_DIR, 'stats/season.json'), {
    generatedAt: new Date().toISOString(),
    season: season.season,
    players: aggregate(performances),
  });

  // Weekly, grouped by the LAST scheduled day so two-day games land in one week.
  const weeks = new Map<string, Performance[]>();
  for (const p of performances) {
    if (!p.date) continue;
    const week = isoWeek(new Date(p.date));
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week)!.push(p);
  }

  const weekKeys = [...weeks.keys()].sort();
  for (const week of weekKeys) {
    const perfs = weeks.get(week)!;
    await writeJson(resolve(DATA_DIR, 'stats/weekly', `${week}.json`), {
      week,
      generatedAt: new Date().toISOString(),
      ...pickWeeklyBest(perfs),
      performances: perfs,
    });
  }

  const latest = weekKeys.at(-1);
  await writeJson(resolve(DATA_DIR, 'stats/latest-weekly.json'),
    latest
      ? await readJson(resolve(DATA_DIR, 'stats/weekly', `${latest}.json`))
      : { week: null, topBatter: null, topBowler: null, performances: [], generatedAt: new Date().toISOString() });

  // Names seen in scorecards with no roster entry. Review this after every sync.
  await writeJson(resolve(DATA_DIR, 'stats/unmatched.json'), {
    generatedAt: new Date().toISOString(),
    note: 'Names in PlayHQ scorecards with no match in config/players.json. Add each as a new player or as an alias of an existing one.',
    names: [...unmatched.entries()]
      .map(([name, appearances]) => ({ name, appearances }))
      .sort((a, b) => b.appearances - a.appearances),
  });

  log.step('Stats written');
  log.info(`${weekKeys.length} week(s), latest: ${latest ?? 'none'}`);
  if (unmatched.size) {
    log.warn(`${unmatched.size} unmatched name(s) — see data/playhq/stats/unmatched.json`);
  }
  void fixtures;
}

main().catch((err) => {
  console.error(`\n✗ Aggregation failed: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
