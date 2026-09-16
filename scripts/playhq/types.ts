/**
 * PlayHQ response types (cricket) + the shapes we write into data/playhq/.
 *
 * Fields are optional/nullable far more often than the docs suggest. Hidden
 * profiles, unplayed finals and byes all produce partial objects.
 */

export interface PagedResponse<T> {
  data: T[];
  metadata?: { hasMore: boolean; nextCursor?: string };
}

// --- v1 -------------------------------------------------------------------

export interface Season {
  id: string;
  name: string;
  status: 'ACTIVE' | 'UPCOMING' | 'COMPLETED' | string;
  /** `logo` here is the association's badge — ECA's, VSCA's. */
  association?: { id: string; name: string; logo?: PlayHQImage | null };
  competition?: { id: string; name: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface Grade {
  id: string;
  name: string;
  url?: string;
}

/**
 * PlayHQ serves uploaded artwork from Cloudinary in a fixed set of square
 * sizes — 32, 48, 64, 96, 128 and 256 — each with its own URL. Measured from
 * a live response; there is no "original".
 */
export interface PlayHQImage {
  sizes: Array<{
    url: string;
    dimensions?: { width: number; height: number };
  }>;
}

export interface SeasonTeam {
  id: string;
  name?: string;
  /** The club behind the team. `logo` is the club crest, and it is often set. */
  club?: { id: string; name: string; logo?: PlayHQImage | null };
  grade?: { id: string; name: string };
  createdAt?: string;
  updatedAt?: string;
}

// --- v2 fixture -----------------------------------------------------------

export type GameStatus = 'PENDING' | 'UPCOMING' | 'FINAL' | string;
export type GameType = 't20' | 'oneDay' | 'twoDay' | 'T20' | string;

/**
 * Far more values than WON/LOST, and the suffixed ones are not rare: a single
 * 16-game season produced WON_BY_FORFEIT and WON_BY_CUSTOM_TARGET.
 *
 * The first four and the _BY_ pairs below are measured from live data. The
 * rest are plausible and unconfirmed, which is why nothing should switch on an
 * exact value — test the WON_/LOST_ prefix instead.
 */
export type Outcome =
  | 'WON' | 'LOST' | 'DRAWN' | 'TIED'
  | 'WON_BY_FORFEIT' | 'LOST_BY_FORFEIT'
  | 'WON_BY_CUSTOM_TARGET' | 'LOST_BY_CUSTOM_TARGET'
  | 'WON_BY_SUPER_OVER' | 'LOST_BY_SUPER_OVER'
  | 'WASHOUT' | 'ABANDONED' | 'FORFEIT'
  | string
  | null;

export interface ScheduleEntry {
  /** null for single-day games; 1 or 2 for twoDay. */
  day: number | null;
  dateTime: string;
  playingSurfaceId: string | null;
}

export interface FixtureGame {
  id: string;
  status: GameStatus;
  type: GameType;
  createdAt?: string;
  updatedAt?: string;
  pool?: { id: string; name: string } | null;
  schedule: ScheduleEntry[];
  teams: Array<{ id: string; isHomeTeam: boolean; outcome?: Outcome }>;
  periods?: unknown[] | null;
}

export interface FixtureRound {
  id: string;
  name: string;
  abbreviatedName: string;
  isFinalRound: boolean;
  /** Teams with no game this round. Render these or a week disappears. */
  byes?: Array<{ teamID?: string; id?: string }> | null;
  games: FixtureGame[];
}

export interface PlayingSurface {
  id: string;
  name: string;
  abbreviatedName?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  venue?: {
    id: string;
    name: string;
    timezone?: string;
    address?: {
      line1?: string | null;
      suburb?: string;
      postcode?: string | number;
      state?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
    };
  };
}

export interface GradeFixture {
  rounds: FixtureRound[];
  teams: Array<{ id: string; name: string }>;
  playingSurfaces: PlayingSurface[];
}

/**
 * One game from GET /v1/grades/{gradeId}/games — the real fixture endpoint.
 *
 * Measured against the live API, not the docs. Note how little it resembles
 * GradeFixture above: the list is flat (no rounds wrapper, and therefore no
 * byes), the sides are `competitors` rather than `teams`, `schedule` is a
 * single {date,time,timezone} rather than an array of dateTimes, and the venue
 * is embedded rather than referenced by id into a playingSurfaces table.
 *
 * `scoreTotal` is runs only — no wickets — so it is a fallback for the score
 * line, not a replacement for the game summary.
 */
export interface GradeGame {
  id: string;
  status: GameStatus;
  /** Absent on this endpoint for cricket; kept optional rather than assumed. */
  type?: GameType;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  round: { id: string; name: string; abbreviatedName: string; isFinalRound: boolean };
  pool?: unknown | null;
  schedule: { date: string; time: string; timezone: string };
  competitors: Array<{
    id: string;
    name: string;
    isHomeTeam: boolean;
    outcome?: Outcome;
    scoreTotal?: number;
    scoreSubTotal?: Array<{ type: string; value: number }>;
  }>;
  venue?: {
    id: string;
    name: string;
    surfaceName?: string;
    surfaceAbbreviation?: string;
    surfaceId?: string;
    address?: {
      line1?: string; postcode?: string; suburb?: string;
      state?: string; country?: string; latitude?: number; longitude?: number;
    };
  } | null;
}

// --- v2 ladder ------------------------------------------------------------

export interface LadderBlock {
  /** Column definitions come from the API. Do not hardcode ladder columns. */
  headers: Array<{ key: string; name: string; shortName: string }>;
  pool: { id: string; name: string } | null;
  standings: Array<{
    team: { id: string; name: string } | null;
    /** Positionally aligned with headers[]. */
    values: Array<number | string>;
  }>;
  type?: string;
}

export interface Ladder {
  gradeId: string;
  ladders: LadderBlock[];
}

// --- v2 game summary ------------------------------------------------------

/** Stats are arrays, order is not stable, zeros may be absent. Look up by type. */
export interface Statistic {
  type: string;
  value: number;
}

export interface Appearance {
  id: string;
  /** null when the profile is hidden or the player is an unregistered fill-in. */
  firstName: string | null;
  lastName: string | null;
  captainRole?: string | null;
  playerNumber?: string | number | null;
  isFillIn?: boolean;
  isRegisteredPlayer?: boolean;
  visible?: boolean;
  roleType?: string;
  teamId: string;
  playerPosition?: string | null;
}

export interface PeriodAppearance {
  id: string;
  displayOrder: number | null;
  status: 'OUT' | 'NOT_OUT' | 'DID_NOT_BAT' | null;
  statistics: Statistic[];
}

export interface PeriodTeam {
  id: string;
  discipline: 'BATTING' | 'BOWLING';
  status?: string | null;
  statistics: Statistic[];
  appearances: PeriodAppearance[];
  fallOfWickets?: Array<{ sequenceNo: number; appearanceId: string; runs: number }> | null;
}

export interface Period {
  id?: string;
  name: string;
  sequenceNo: number;
  teams: PeriodTeam[];
  sharedStatistics?: Array<{
    type: string;
    appearances: Array<{ id: string; role: string; position?: string | null }>;
  }>;
}

export interface GameSummary {
  id: string;
  gradeId: string;
  round?: { id: string; name: string; abbreviatedName: string; isFinalRound: boolean };
  status: GameStatus;
  type: GameType;
  schedule: ScheduleEntry[];
  /** Names live here; numbers live in periods. Join on appearance id. */
  appearances: Appearance[];
  teams: Array<{ id: string; name: string; isHomeTeam: boolean; outcome?: Outcome }>;
  coinToss?: { winningTeamId: string; preference: string } | null;
  periods: Period[] | null;
  playingSurfaces?: PlayingSurface[];
}

// --- our config -----------------------------------------------------------

export interface TeamConfig {
  slug: string;
  name: string;
  shortName: string;
  competition: string;
  competitionShort: string;
  day: string;
  gradeLabel: string;
  /**
   * ECA names its divisions after shields and publishes the grade as
   * "13. LOC 1 McCarthy Shield". The shield is unique within a competition,
   * which makes it the most reliable way to find the grade. null where the
   * competition does not use one (VSCA).
   */
  shield?: string | null;
  /** null until the association publishes grades. Sync skips nulls cleanly. */
  playhqSeasonId: string | null;
  playhqGradeId: string | null;
  playhqTeamId: string | null;
  active: boolean;
}

export interface SeasonConfig {
  season: string;
  label: string;
  startsAround: string;
  teams: TeamConfig[];
}

export interface RosterPlayer {
  id: string;
  name: string;
  /** Name variants seen in PlayHQ. Matching is by name — there is no public player ID. */
  aliases: string[];
  teams: string[];
  role?: string;
  battingStyle?: string;
  bowlingStyle?: string;
  joined?: string | number;
  active: boolean;
}

// --- generated ------------------------------------------------------------

export interface NormalisedGame {
  id: string;
  status: GameStatus;
  /** Absent from the games endpoint for cricket; null when PlayHQ omits it. */
  type: GameType | null;
  round: string;
  roundShort: string;
  isFinal: boolean;
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
  gradeId: string | null;
  teamId: string | null;
  games: NormalisedGame[];
  byes: Array<{ round: string; roundShort: string }>;
}

export interface BattingLine {
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strikeRate: number;
  notOut: boolean;
  didNotBat: boolean;
}

export interface BowlingLine {
  overs: number;
  balls: number;
  maidens: number;
  runs: number;
  wickets: number;
  economy: number;
}

export interface FieldingLine {
  catches: number;
  stumpings: number;
  runOuts: number;
}

export interface Performance {
  playerId: string | null;
  displayName: string;
  /** False for hidden profiles and unregistered fill-ins — no name to attribute. */
  identifiable: boolean;
  teamSlug: string;
  gameId: string;
  round: string;
  date: string;
  opponent: string;
  batting: BattingLine | null;
  bowling: BowlingLine | null;
  fielding: FieldingLine | null;
}

export interface SeasonAggregate {
  playerId: string | null;
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
  fielding: { catches: number; stumpings: number; runOuts: number };
}
