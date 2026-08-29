/*
  Site-side mirrors of the generated shapes in scripts/playhq/types.ts. Kept
  narrow — only the fields pages actually read. If the sync's output changes,
  that file is the contract and this one follows it.
*/

export type Outcome =
  | 'WON' | 'LOST' | 'DRAWN' | 'TIED'
  | 'WON_BY_SUPER_OVER' | 'LOSS_BY_SUPER_OVER'
  | 'WASHOUT' | 'FORFEIT'
  | null;

export interface NormalisedGame {
  id: string;
  status: string;
  type: string;
  round: string;
  roundShort: string;
  isFinal: boolean;
  /** One date for a one-dayer, two for a game spanning a fortnight. */
  dates: string[];
  isHome: boolean;
  opponent: string;
  outcome: Outcome;
  venue: string | null;
  ground: string | null;
  suburb: string | null;
  mapQuery: string | null;
  ourScore: string | null;
  theirScore: string | null;
}

export interface TeamFixtures {
  slug: string;
  name: string;
  competition: string;
  gradeLabel: string;
  games: NormalisedGame[];
  /** A team with no game this round. Render these or a week disappears. */
  byes: Array<{ round: string; roundShort: string }>;
}

export interface LadderBlock {
  /** Column definitions come from the API. Never hardcode ladder columns. */
  headers: Array<{ key: string; name: string; shortName: string }>;
  pool: { id: string; name: string } | null;
  standings: Array<{
    team: { id: string; name: string } | null;
    /** Positionally aligned with headers[]. */
    values: Array<number | string>;
  }>;
}

export interface LadderGrade {
  slug: string;
  name: string;
  competition: string;
  gradeLabel: string;
  ourTeamId: string | null;
  ladders: LadderBlock[];
}

export interface BattingLine {
  runs: number; balls: number; fours: number; sixes: number;
  strikeRate: number; notOut: boolean; didNotBat: boolean;
}

export interface BowlingLine {
  overs: number; balls: number; maidens: number;
  runs: number; wickets: number; economy: number;
}

export interface Performance {
  displayName: string;
  identifiable: boolean;
  teamSlug: string;
  round: string;
  date: string;
  opponent: string;
  batting: BattingLine | null;
  bowling: BowlingLine | null;
}

export interface WeeklyStats {
  week: string | null;
  generatedAt: string | null;
  topBatter: Performance | null;
  topBowler: Performance | null;
  performances: Performance[];
}

export interface SeasonAggregate {
  displayName: string;
  teams: string[];
  matches: number;
  batting: {
    innings: number; notOuts: number; runs: number; balls: number;
    highScore: string; average: number | null; strikeRate: number | null;
    fifties: number; hundreds: number; fours: number; sixes: number;
  };
  bowling: {
    innings: number; balls: number; overs: string; maidens: number;
    runs: number; wickets: number; average: number | null;
    economy: number | null; best: string;
  };
}

export interface SeasonStats {
  generatedAt: string | null;
  season: string;
  players: SeasonAggregate[];
}
