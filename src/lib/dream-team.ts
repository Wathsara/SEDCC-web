/**
 * The Dream Team — a season XI picked from the numbers, not by opinion.
 *
 * Three ideas hold it together.
 *
 * **Weighted points, not averages.** A raw average flatters a small sample:
 * one dismissal for 45 reads as 45.00 and beats a player with 350 runs at
 * 35.00. Every department therefore scores on volume plus rate plus landmark
 * innings, so weight of runs and wickets counts for something on its own.
 *
 * **Every side counts the same.** A hundred in VSCA Grade 4 scores exactly
 * what a hundred in ECA LOC 1 scores. The club fields three sides and this XI
 * is the club's, so nothing here weights a grade, and the selection pool is
 * every player in the season aggregate regardless of which team they played
 * for.
 *
 * **It has to work in October.** The thresholds below are full-season
 * qualifications; applied in round 3 they would disqualify the entire club and
 * the page would show nothing all spring. They scale with how much of the
 * season has actually been played, and the XI reports which bar it used, so an
 * early side can be shown as the provisional thing it is.
 *
 * The formulas are the club's, set out in full here rather than buried in the
 * component that renders them.
 */

import type { SeasonAggregate } from './playhq-types';
import type { RosterPlayer } from './site';

/* -------------------------------------------------------------- scoring -- */

/** Runs, with rate and landmarks on top. */
export function battingPoints(p: SeasonAggregate): number {
  const b = p.batting;
  return (
    b.runs +
    0.5 * (b.strikeRate ?? 0) +
    0.5 * (b.average ?? 0) +
    10 * b.fifties +
    25 * b.hundreds
  );
}

/**
 * Wickets, with credit for a low average and a tight economy.
 *
 * Both rate terms are floored at zero so an expensive spell subtracts nothing
 * — a bowler is not punished below the wickets they actually took. A bowler
 * with no wickets has a null average, which scores nothing rather than the
 * full 30 an average of 0 would earn.
 */
export function bowlingPoints(p: SeasonAggregate): number {
  const w = p.bowling;
  const avgTerm = w.wickets > 0 && w.average !== null ? Math.max(0, 30 - w.average) : 0;
  const ecoTerm = w.economy !== null ? Math.max(0, 12 - w.economy) * 5 : 0;
  const hauls = (w.fourWicketHauls ?? 0) + (w.fiveWicketHauls ?? 0);
  return 20 * w.wickets + avgTerm + ecoTerm + 25 * hauls;
}

/**
 * A keeper is picked on runs as well as dismissals, which is what the job has
 * become.
 *
 * PlayHQ reports a single catch total and does not say which were taken behind
 * the stumps, so every catch a keeper took counts here. For a player who kept
 * all season that is the right number; for one who kept in some games and
 * fielded in others it is slightly generous, and there is no field in the API
 * to do better with.
 */
export function keeperPoints(p: SeasonAggregate): number {
  const f = p.fielding ?? { catches: 0, stumpings: 0, runOuts: 0 };
  return battingPoints(p) + 15 * f.catches + 20 * f.stumpings;
}

export function allRounderPoints(p: SeasonAggregate): number {
  return battingPoints(p) + bowlingPoints(p);
}

/* --------------------------------------------------------- the pool bar -- */

/** A full season's qualification, before any scaling for the season so far. */
export const FULL_SEASON = {
  battingInnings: 4,
  bowlingOvers: 15,
  allRounderRuns: 100,
  allRounderWickets: 6,
} as const;

/**
 * The floor a scaled threshold will not go below. Without these, one innings
 * and one over would qualify in round 1 and the XI would be noise.
 */
const FLOOR = {
  battingInnings: 1,
  bowlingOvers: 3,
  allRounderRuns: 25,
  allRounderWickets: 2,
} as const;

export interface Thresholds {
  battingInnings: number;
  bowlingOvers: number;
  allRounderRuns: number;
  allRounderWickets: number;
  /** 0 to 1: how much of the season's cricket has been played. */
  progress: number;
}

/**
 * Scale the full-season bar by how far into the season the club is, never
 * below the floor and never above the full-season figure.
 */
export function thresholdsFor(progress: number): Thresholds {
  const p = Math.min(1, Math.max(0, progress));
  const scale = (full: number, floor: number) =>
    Math.min(full, Math.max(floor, Math.round(full * p)));
  return {
    battingInnings: scale(FULL_SEASON.battingInnings, FLOOR.battingInnings),
    bowlingOvers: scale(FULL_SEASON.bowlingOvers, FLOOR.bowlingOvers),
    allRounderRuns: scale(FULL_SEASON.allRounderRuns, FLOOR.allRounderRuns),
    allRounderWickets: scale(FULL_SEASON.allRounderWickets, FLOOR.allRounderWickets),
    progress: p,
  };
}

/** Overs are written "12.3" — twelve overs and three balls, not 12.3 overs. */
export function oversAsBalls(overs: string | number | null | undefined): number {
  const [o, b] = String(overs ?? '0').split('.');
  return Number(o || 0) * 6 + Number(b || 0);
}

/* ------------------------------------------------------------- the team -- */

export type Role = 'batter' | 'keeper' | 'all-rounder' | 'bowler';

export interface Pick {
  player: SeasonAggregate;
  role: Role;
  /** 1 to 11. */
  position: number;
  captain: boolean;
  /** The score that won this player their place. */
  score: number;
  points: { batting: number; bowling: number; keeping: number; allRounder: number };
  /** The club's roster entry, when the name matched one. */
  roster: RosterPlayer | null;
}

export interface DreamTeam {
  picks: Pick[];
  thresholds: Thresholds;
  /** How the keeper's place was decided, for the note under the XI. */
  keeperBasis: 'roster' | 'stumpings' | 'unfilled';
  /** True when the all-rounder bar had to be relaxed to fill both places. */
  allRoundersRelaxed: boolean;
  captainBasis: 'club-captain' | 'top-scorer' | null;
  /** Players who met no qualification at all, so the XI is short. */
  short: number;
}

const KEEPER_WORDS = /\b(wicket-?keeper|keeper|wk)\b/i;

/*
  Whether the player captains any of the club's sides. captaincy is a bare
  string when it applies to every side they turn out for, and an object keyed by
  team slug when it differs between them — LOC 2's vice-captain also plays Grade
  4, which has a captain of its own. Read here rather than imported from site.ts
  so this module stays what its header says it is: the formulas, with no pull on
  the rest of the site.
*/
function isClubCaptain(r: RosterPlayer | null | undefined): boolean {
  const c = r?.captaincy;
  if (!c) return false;
  return typeof c === 'string' ? c === 'captain' : Object.values(c).includes('captain');
}

/** Whether the club has marked this player as a keeper in config/players.json. */
function rosteredKeeper(r: RosterPlayer | null | undefined): boolean {
  if (!r) return false;
  return r.keeper === true || KEEPER_WORDS.test(r.role ?? '');
}

/**
 * Pick the XI.
 *
 * The order of selection is what guarantees the shape — 1 keeper, 2
 * all-rounders, 4 batters, 4 bowlers — because each step picks from what the
 * step before it left behind. Picking the batters first would take the
 * all-rounders with them and leave the bowling to whoever was left.
 *
 * @param players  the season aggregate, every side together
 * @param roster   config/players.json, for captaincy and keeper marks
 * @param progress 0 to 1, how much of the season has been played
 */
export function selectDreamTeam(
  players: SeasonAggregate[],
  roster: RosterPlayer[],
  progress: number,
): DreamTeam {
  const thresholds = thresholdsFor(progress);

  const byName = new Map<string, RosterPlayer>();
  for (const r of roster) {
    byName.set(r.name.toLowerCase(), r);
    for (const alias of r.aliases ?? []) byName.set(alias.toLowerCase(), r);
  }
  const rosterFor = (p: SeasonAggregate) => byName.get(p.displayName.toLowerCase()) ?? null;

  const scored = players.map((player) => ({
    player,
    roster: rosterFor(player),
    points: {
      batting: battingPoints(player),
      bowling: bowlingPoints(player),
      keeping: keeperPoints(player),
      allRounder: allRounderPoints(player),
    },
  }));

  type Candidate = (typeof scored)[number];
  const pool = new Set(scored);
  const take = (c: Candidate) => {
    pool.delete(c);
    return c;
  };
  const best = (from: Candidate[], by: (c: Candidate) => number) =>
    [...from].sort((a, b) => by(b) - by(a));

  const qualifiesBatting = (c: Candidate) =>
    c.player.batting.innings >= thresholds.battingInnings;
  const qualifiesBowling = (c: Candidate) =>
    oversAsBalls(c.player.bowling.overs) >= thresholds.bowlingOvers * 6;

  const chosen: Array<{ c: Candidate; role: Role; score: number }> = [];

  /* 1. The keeper. The club's own designation wins; failing that, a stumping
        is proof of keeping that no other statistic can give. */
  let keeperBasis: DreamTeam['keeperBasis'] = 'unfilled';
  let keepers = [...pool].filter((c) => rosteredKeeper(c.roster));
  if (keepers.length) keeperBasis = 'roster';
  else {
    keepers = [...pool].filter((c) => (c.player.fielding?.stumpings ?? 0) > 0);
    if (keepers.length) keeperBasis = 'stumpings';
  }
  const keeper = best(keepers, (c) => c.points.keeping)[0];
  if (keeper) chosen.push({ c: take(keeper), role: 'keeper', score: keeper.points.keeping });

  /*
     2. The all-rounders: two players who are genuinely both.

     The runs bar comes down a step at a time when the season is too young to
     fill both places, but the wickets bar does not move. Letting it fall to
     one wicket turned the club's leading run-scorer — 270 runs, two hundreds
     and a single wicket — into an "all-rounder", because the role is scored on
     batting plus bowling and his batting alone outscored everyone. An
     all-rounder who cannot be told from a batter is not a selection, it is an
     accident of arithmetic, and it costs the batting order its best player.
  */
  const arBars = [
    { runs: thresholds.allRounderRuns, wickets: thresholds.allRounderWickets },
    { runs: Math.round(thresholds.allRounderRuns / 2), wickets: thresholds.allRounderWickets },
    { runs: 10, wickets: thresholds.allRounderWickets },
  ];
  let allRounders: Candidate[] = [];
  let arBarIndex = 0;
  for (const [i, bar] of arBars.entries()) {
    allRounders = best(
      [...pool].filter(
        (c) => c.player.batting.runs >= bar.runs && c.player.bowling.wickets >= bar.wickets,
      ),
      (c) => c.points.allRounder,
    ).slice(0, 2);
    arBarIndex = i;
    if (allRounders.length === 2) break;
  }
  for (const c of allRounders) chosen.push({ c: take(c), role: 'all-rounder', score: c.points.allRounder });

  /* 3. The batters, from whoever the first two steps left. */
  const batters = best([...pool].filter(qualifiesBatting), (c) => c.points.batting).slice(0, 4);
  for (const c of batters) chosen.push({ c: take(c), role: 'batter', score: c.points.batting });

  /* 4. The bowlers. */
  const bowlers = best([...pool].filter(qualifiesBowling), (c) => c.points.bowling).slice(0, 4);
  for (const c of bowlers) chosen.push({ c: take(c), role: 'bowler', score: c.points.bowling });

  /* ------------------------------------------------------ batting order -- */

  const of = (role: Role) => chosen.filter((x) => x.role === role);
  const battersInOrder = best(of('batter').map((x) => x.c), (c) => c.points.batting);
  const arsInOrder = best(of('all-rounder').map((x) => x.c), (c) => c.points.allRounder);
  const bowlersInOrder = best(of('bowler').map((x) => x.c), (c) => c.points.bowling);
  const keeperPick = of('keeper')[0]?.c ?? null;

  /*
    1-3 the top order, the heaviest run-scorers; 4 the remaining specialist
    batter; 5 the keeper, who in this club bats rather than merely keeps; 6-7
    the all-rounders; 8-11 the specialists with the ball.
  */
  const order: Candidate[] = [
    ...battersInOrder.slice(0, 3),
    ...battersInOrder.slice(3, 4),
    ...(keeperPick ? [keeperPick] : []),
    ...arsInOrder,
    ...bowlersInOrder,
  ];

  /*
    Eleven different people. Each step above picks from what the step before it
    left, so a repeat should be impossible — this is the assertion that keeps it
    that way, because the one thing a team sheet may never do is name the same
    player twice.
  */
  if (new Set(order).size !== order.length) {
    throw new Error('Dream Team selected the same player twice');
  }

  const roleOf = new Map(chosen.map((x) => [x.c, x.role]));
  const scoreOf = new Map(chosen.map((x) => [x.c, x.score]));

  /*
    The captaincy goes to a player who already captains one of the club's
    sides. Where more than one is in the XI — the club runs three captains —
    the one with the better season takes it. Where none is, it goes to the best
    performer in the side.
  */
  const captains = order.filter((c) => isClubCaptain(c.roster));
  const captain =
    best(captains, (c) => c.points.allRounder)[0] ??
    best(order, (c) => scoreOf.get(c) ?? 0)[0] ??
    null;
  const captainBasis: DreamTeam['captainBasis'] = captain
    ? captains.length
      ? 'club-captain'
      : 'top-scorer'
    : null;

  return {
    picks: order.map((c, i) => ({
      player: c.player,
      role: roleOf.get(c)!,
      position: i + 1,
      captain: c === captain,
      score: scoreOf.get(c) ?? 0,
      points: c.points,
      roster: c.roster,
    })),
    thresholds,
    keeperBasis,
    allRoundersRelaxed: arBarIndex > 0,
    captainBasis,
    short: 11 - order.length,
  };
}
