/*
  Career figures: every season the club has played, added up per player.

  Two sources, both committed, neither fetched here:

    data/playhq/stats/history/<season>.json   past seasons, written by
                                              npm run playhq:history
    data/playhq/stats/season.json             this season, written by
                                              npm run playhq:stats

  They are the same shape because they are produced by the same arithmetic
  (scripts/playhq/figures.ts), which is the only reason adding one to the other
  is safe.

  Every derived number — average, strike rate, economy, overs — is recomputed
  from the career totals. Averaging two seasons' averages is not a career
  average, and overs are base six and cannot be added as decimals.
*/
import type { SeasonAggregate, SeasonStats } from './playhq-types';
import { seasonStats } from './playhq';
import { season as currentSeason } from './site';

interface HistoryFile {
  season: string;
  label: string;
  grade: string | null;
  matches: number;
  players: SeasonAggregate[];
}

const historyFiles = Object.values(
  import.meta.glob<{ default: HistoryFile }>('../../data/playhq/stats/history/*.json', {
    eager: true,
  }),
).map((m) => m.default);

/** One player's line in one season, as the career table shows it. */
export interface CareerSeason {
  season: string;
  label: string;
  grade: string | null;
  matches: number;
  runs: number;
  wickets: number;
}

export interface CareerPlayer {
  playerId: string | null;
  name: string;
  seasons: CareerSeason[];
  matches: number;
  /*
    No balls faced and no strike rate, on purpose.

    Early scorecards recorded them only sometimes — Amila Jayanuwan's 154 in
    2025/26 and his 213* in 2024/25 both carry a ball count of nought — so the
    career totals are runs over a fraction of the deliveries that produced
    them. That gave him a career strike rate of 175.97, which is not a number
    anyone should publish. The fields are left out rather than left wrong, so
    nothing downstream can render one by accident. Per-season strike rates on
    /stats/ are fine: 2026/27 scorecards record every ball.
  */
  batting: {
    innings: number;
    notOuts: number;
    runs: number;
    highScore: string;
    average: number | null;
    fifties: number;
    hundreds: number;
  };
  bowling: {
    innings: number;
    balls: number;
    overs: string;
    maidens: number;
    runs: number;
    wickets: number;
    average: number | null;
    economy: number | null;
    best: string;
    fiveWicketHauls: number;
  };
  fielding: { catches: number; stumpings: number; runOuts: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const ballsToOvers = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

/** "150*" -> 150 not out. "—" when a player has never been in. */
const parseHighScore = (s: string) => ({
  runs: Number.parseInt(s, 10) || 0,
  notOut: s.endsWith('*'),
  known: /\d/.test(s),
});

/** "5/48" -> five for forty-eight. */
const parseBest = (s: string) => {
  const [w, r] = s.split('/').map((n) => Number.parseInt(n, 10));
  return Number.isFinite(w) && Number.isFinite(r) ? { w, r } : null;
};

/*
  Seasons oldest first. The history files are named for the season they cover
  and the current one comes off the live aggregate, so sorting on that key puts
  them in the order the club played them without anything having to list them.
*/
const seasonsInOrder = [
  ...historyFiles.map((f) => ({
    key: f.season,
    label: f.label,
    grade: f.grade,
    players: f.players ?? [],
  })),
  {
    key: (seasonStats as SeasonStats).season ?? currentSeason.season,
    // config/season-2026-27.json labels it "2026/27 Season"; beside "2025/26"
    // in a list of seasons the word is noise.
    label: currentSeason.label.replace(/\s*season$/i, ''),
    grade: null,
    players: (seasonStats as SeasonStats).players ?? [],
  },
].sort((a, b) => a.key.localeCompare(b.key));

/** Seasons that actually have figures, for the page to say what it covers. */
export const careerSeasons = seasonsInOrder
  .filter((s) => s.players.length > 0)
  .map((s) => ({ key: s.key, label: s.label, grade: s.grade }));

/*
  Identity. Roster id where the sync could place the name, and the name itself
  otherwise — the same key the aggregator uses, so a player who has a roster
  entry now carries their 2025/26 record forward even though that season's
  scorecards only ever said "A Perera".
*/
const keyOf = (p: SeasonAggregate) => p.playerId ?? `name:${p.displayName}`;

function build(): CareerPlayer[] {
  const byPlayer = new Map<string, CareerPlayer>();
  const bestBowling = new Map<string, { w: number; r: number }>();
  const highScore = new Map<string, { runs: number; notOut: boolean }>();

  for (const s of seasonsInOrder) {
    for (const row of s.players) {
      const key = keyOf(row);

      if (!byPlayer.has(key)) {
        byPlayer.set(key, {
          playerId: row.playerId ?? null,
          name: row.displayName,
          seasons: [],
          matches: 0,
          batting: {
            innings: 0, notOuts: 0, runs: 0, highScore: '—',
            average: null, fifties: 0, hundreds: 0,
          },
          bowling: {
            innings: 0, balls: 0, overs: '0.0', maidens: 0, runs: 0, wickets: 0,
            average: null, economy: null, best: '—', fiveWicketHauls: 0,
          },
          fielding: { catches: 0, stumpings: 0, runOuts: 0 },
        });
      }

      const player = byPlayer.get(key)!;
      player.seasons.push({
        season: s.key,
        label: s.label,
        grade: s.grade ?? row.teams.join(' · '),
        matches: row.matches,
        runs: row.batting.runs,
        wickets: row.bowling.wickets,
      });

      player.matches += row.matches;

      player.batting.innings += row.batting.innings;
      player.batting.notOuts += row.batting.notOuts;
      player.batting.runs += row.batting.runs;
      player.batting.fifties += row.batting.fifties;
      player.batting.hundreds += row.batting.hundreds;

      const hs = parseHighScore(row.batting.highScore);
      const standing = highScore.get(key);
      if (
        hs.known &&
        (!standing || hs.runs > standing.runs || (hs.runs === standing.runs && hs.notOut))
      ) {
        highScore.set(key, { runs: hs.runs, notOut: hs.notOut });
      }

      player.bowling.innings += row.bowling.innings;
      player.bowling.balls += row.bowling.balls;
      player.bowling.maidens += row.bowling.maidens;
      player.bowling.runs += row.bowling.runs;
      player.bowling.wickets += row.bowling.wickets;
      player.bowling.fiveWicketHauls += row.bowling.fiveWicketHauls ?? 0;

      const best = parseBest(row.bowling.best);
      const held = bestBowling.get(key);
      if (best && (!held || best.w > held.w || (best.w === held.w && best.r < held.r))) {
        bestBowling.set(key, best);
      }

      player.fielding.catches += row.fielding?.catches ?? 0;
      player.fielding.stumpings += row.fielding?.stumpings ?? 0;
      player.fielding.runOuts += row.fielding?.runOuts ?? 0;
    }
  }

  for (const [key, player] of byPlayer) {
    const dismissals = player.batting.innings - player.batting.notOuts;
    player.batting.average = dismissals > 0 ? round2(player.batting.runs / dismissals) : null;

    const hs = highScore.get(key);
    player.batting.highScore = hs ? `${hs.runs}${hs.notOut ? '*' : ''}` : '—';

    player.bowling.overs = ballsToOvers(player.bowling.balls);
    player.bowling.average =
      player.bowling.wickets > 0 ? round2(player.bowling.runs / player.bowling.wickets) : null;
    player.bowling.economy =
      player.bowling.balls > 0 ? round2((player.bowling.runs / player.bowling.balls) * 6) : null;

    const bb = bestBowling.get(key);
    player.bowling.best = bb ? `${bb.w}/${bb.r}` : '—';
  }

  return [...byPlayer.values()];
}

export const career: CareerPlayer[] = build();

export const hasCareer = career.length > 0;

/** Same tie-breaks as the season boards: the headline number, then the rate. */
export const byCareerRuns = (a: CareerPlayer, b: CareerPlayer) =>
  b.batting.runs - a.batting.runs ||
  (b.batting.average ?? Infinity) - (a.batting.average ?? Infinity) ||
  b.matches - a.matches;

export const byCareerWickets = (a: CareerPlayer, b: CareerPlayer) =>
  b.bowling.wickets - a.bowling.wickets ||
  (a.bowling.average ?? Infinity) - (b.bowling.average ?? Infinity) ||
  a.matches - b.matches;

/** Club totals, for the summary strip. */
export const careerTotals = {
  players: career.length,
  runs: career.reduce((n, p) => n + p.batting.runs, 0),
  wickets: career.reduce((n, p) => n + p.bowling.wickets, 0),
  hundreds: career.reduce((n, p) => n + p.batting.hundreds, 0),
  fifties: career.reduce((n, p) => n + p.batting.fifties, 0),
  seasons: careerSeasons.length,
};
