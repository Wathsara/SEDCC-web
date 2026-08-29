/*
  Past-season results. Hand-entered into config/results-<season>.json from the
  club's PlayHQ grade pages — data/playhq/ is machine-written and the next sync
  would overwrite anything put there.

  Adding a season is dropping in another config/results-*.json; the glob picks
  it up and the route builds itself.
*/

export type Outcome = 'WON' | 'LOST' | 'DRAWN' | 'TIED' | 'ABANDONED' | 'FORFEIT' | 'BYE';

export interface PastGame {
  round: string;
  roundShort: string;
  isFinal: boolean;
  /** null on a bye — the source lists those without one. */
  date: string | null;
  opponent: string | null;
  ground: string | null;
  type: string;
  outcome: Outcome;
  margin: string | null;
  ourScore: string | null;
  theirScore: string | null;
  battedFirst: boolean | null;
}

export interface PastSeason {
  season: string;
  label: string;
  teamName: string;
  clubNameThen: string;
  competition: string;
  competitionShort: string;
  grade: string;
  result: string | null;
  games: PastGame[];
}

const files = import.meta.glob<PastSeason>('../../config/results-*.json', { eager: true });

/** Newest season first. */
export const pastSeasons: PastSeason[] = Object.values(files)
  .map((m) => (m as unknown as { default?: PastSeason }).default ?? (m as PastSeason))
  .sort((a, b) => b.season.localeCompare(a.season));

export function pastSeason(slug: string): PastSeason | undefined {
  return pastSeasons.find((s) => s.season === slug);
}

/** '7-250' and '250' both mean 250 runs. */
export function runsOf(score: string | null): number | null {
  if (!score) return null;
  const n = Number(score.split('-').pop());
  return Number.isFinite(n) ? n : null;
}

export interface SeasonSummary {
  /** Byes are rounds, not matches, so they are excluded from played. */
  played: number;
  byes: number;
  won: number;
  lost: number;
  noResult: number;
  winRate: number | null;
  highest: PastGame | null;
  biggestWin: PastGame | null;
  closestWin: PastGame | null;
  homeGround: string | null;
}

export function summarise(season: PastSeason): SeasonSummary {
  const g = season.games.filter((x) => x.outcome !== 'BYE');
  const decided = g.filter((x) => x.outcome === 'WON' || x.outcome === 'LOST');
  const won = g.filter((x) => x.outcome === 'WON');

  const byRuns = won.filter((x) => x.margin?.includes('run'));
  const byWickets = won.filter((x) => x.margin?.includes('wicket'));

  const highest = [...g]
    .filter((x) => runsOf(x.ourScore) !== null && x.outcome !== 'ABANDONED')
    .sort((a, b) => (runsOf(b.ourScore) ?? 0) - (runsOf(a.ourScore) ?? 0))[0] ?? null;

  const num = (m: string | null) => Number(m?.split(' ')[0] ?? NaN);

  return {
    played: g.length,
    byes: season.games.filter((x) => x.outcome === 'BYE').length,
    won: won.length,
    lost: g.filter((x) => x.outcome === 'LOST').length,
    noResult: g.filter((x) => x.outcome === 'ABANDONED').length,
    winRate: decided.length ? Math.round((won.length / decided.length) * 100) : null,
    highest,
    biggestWin: [...byRuns].sort((a, b) => num(b.margin) - num(a.margin))[0] ?? null,
    closestWin: [...byWickets].sort((a, b) => num(a.margin) - num(b.margin))[0] ?? null,
    // The ground the side played at most often is, in practice, home.
    homeGround:
      Object.entries(
        g.reduce<Record<string, number>>((acc, x) => {
          if (!x.ground) return acc;
          acc[x.ground] = (acc[x.ground] ?? 0) + 1;
          return acc;
        }, {}),
      ).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}
