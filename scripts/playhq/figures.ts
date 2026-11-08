/**
 * Season figures from a list of performances.
 *
 * Split out of aggregate.ts so the weekly sync and the historical backfill run
 * the same arithmetic. The career page adds one season's numbers to another's,
 * and two copies of this that drifted apart would produce a career total that
 * matched neither season it was made of.
 */

import type { Performance, SeasonAggregate } from './types.js';
import { ballsToOvers, economyFromBalls, round2 } from './utils.js';

/**
 * Season figures for one set of performances.
 *
 * Called once for the club as a whole and once per side, so a player who turns
 * out on Saturday and Sunday has both a combined record and a split of it, and
 * the two can never disagree — they are the same arithmetic over different
 * slices.
 */
export function aggregateRows(allPerformances: Performance[]): SeasonAggregate[] {
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
          fourWicketHauls: 0, fiveWicketHauls: 0,
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
      if (p.bowling.wickets >= 5) agg.bowling.fiveWicketHauls++;
      else if (p.bowling.wickets >= 4) agg.bowling.fourWicketHauls++;

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

export const keyOf = (p: { playerId?: string | null; displayName: string }) =>
  p.playerId ?? `name:${p.displayName}`;

/**
 * The club total for every player, each carrying a per-side split.
 *
 * The /stats/ page and the Dream Team read the total — one club, one XI, every
 * side counting the same. A team page reads byTeam[slug], because a squad card
 * on the LOC 2 page has no business showing runs scored on a Sunday.
 */
export function aggregate(allPerformances: Performance[]): SeasonAggregate[] {
  const total = aggregateRows(allPerformances);

  const slugs = [...new Set(allPerformances.filter((p) => p.identifiable).map((p) => p.teamSlug))];
  const perTeam = new Map<string, Map<string, SeasonAggregate>>();
  for (const slug of slugs) {
    const rows = aggregateRows(allPerformances.filter((p) => p.teamSlug === slug));
    perTeam.set(slug, new Map(rows.map((r) => [keyOf(r), r])));
  }

  for (const row of total) {
    const key = keyOf(row);
    const byTeam: NonNullable<SeasonAggregate['byTeam']> = {};
    for (const slug of row.teams) {
      const r = perTeam.get(slug)?.get(key);
      if (!r) continue;
      byTeam[slug] = {
        matches: r.matches,
        batting: r.batting,
        bowling: r.bowling,
        fielding: r.fielding,
      };
    }
    row.byTeam = byTeam;
  }

  return total;
}
