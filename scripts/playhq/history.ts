/**
 * Past-season player figures, from the public match centre.
 *
 *   npm run playhq:history
 *
 * The club's career totals start in 2024/25, but the PlayHQ public API only
 * reaches the seasons our key is entitled to, and the two seasons before this
 * one were played under the Victorian Sunday Cricket Club's registration
 * rather than our own — the owning organisation on those scorecards is VSCC,
 * not South Eastern Dreamers. So a normal sync cannot see them.
 *
 * What can: grassrootsapiproxy.cricket.com.au, the API the play.cricket.com.au
 * match centre itself calls. It needs no key, and
 *
 *   /scores/teams/{id}/matches                               a side's season
 *   /scores/matches/{id}?responseModifier=includeScorecard   the scorecard
 *
 * are both open. Only those two routes — /scorecard, /statistics, /players and
 * the organisation and search endpoints are all 403 for this key, so the team
 * id is the one thing that has to be supplied by hand, the way
 * playhq:links --seed supplies the current season's.
 *
 * Writes data/playhq/stats/history/<season>.json, one file per past season, in
 * the same shape as stats/season.json. Current-season files are never touched.
 */

import { resolve } from 'node:path';

import type {
  BattingLine, BowlingLine, FieldingLine, Performance, RosterPlayer, SeasonAggregate,
} from './types.js';
import {
  CONFIG_DIR, DATA_DIR, loadRoster, log, oversToBalls, readJson, round2, writeJson,
} from './utils.js';
import { aggregateRows } from './figures.js';

const PROXY = 'https://grassrootsapiproxy.cricket.com.au';

/** ~4 req/sec, same courtesy the keyed client shows. We are guests here too. */
const MIN_REQUEST_INTERVAL_MS = 250;
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/*
  This API answers in PascalCase or camelCase depending on the jsconfig=eccn
  parameter the match centre sends — and, measured against the same URL minutes
  apart, not always the same way twice. Reading one casing silently produced an
  empty season that still reported success, so every response is folded to
  camelCase before anything looks at it.
*/
function camel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camel);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k.charAt(0).toLowerCase() + k.slice(1),
        camel(v),
      ]),
    );
  }
  return value;
}

async function get<T>(path: string): Promise<T> {
  const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const res = await fetch(`${PROXY}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`public scores API ${res.status} on ${path}`);
  return camel(await res.json()) as T;
}

// --- what the match centre returns ----------------------------------------

interface TeamMatch {
  id: string;
  status: string;
  round?: { name?: string };
}

interface BatCard {
  participantId: string;
  playerShortName: string;
  ballsFaced: number;
  foursScored: number;
  sixesScored: number;
  runsScored: number;
  dismissalType?: string | null;
  dismissalText?: string | null;
}

interface BowlCard {
  participantId: string;
  playerShortName: string;
  oversBowled: number;
  maidensBowled: number;
  runsConceded: number;
  wicketsTaken: number;
}

interface FieldCard {
  participantId: string;
  playerShortName: string;
  totalCatches: number;
  runOuts: number;
  unassistedRunOuts: number;
  assistedRunOuts: number;
  stumpings: number;
}

interface Scorecard {
  id: string;
  status: string;
  round?: { name?: string };
  matchSchedule?: Array<{ startDateTime?: string }>;
  matchSummary?: { teams?: Array<{ id: string; displayName?: string }> };
  innings?: Array<{
    battingTeamId: string;
    batting?: BatCard[];
    bowling?: BowlCard[];
    fielding?: FieldCard[];
  }>;
}

interface PastSeason {
  season: string;
  label: string;
  grade?: string;
  competitionShort?: string;
  teamNameThen?: string;
  publicTeamId?: string | null;
}

// --- names ----------------------------------------------------------------

const fold = (s: string) =>
  s.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Scorecards here carry "A Jayanuwan", not "Amila Jayanuwan" — the initial and
 * the surname, which is all the match centre ever shows. So the roster has to
 * be indexed the same way to match it.
 *
 * Two variants per name, because a player with three names can be shortened at
 * either break: "Dilhan Rahubadde Kankanange" appears as both "D Kankanange"
 * and "D Rahubadde Kankanange" depending on who typed the team sheet.
 *
 * A key that two players share is deleted rather than given to the first of
 * them. There are no collisions in the roster today, but a future "S Perera"
 * joining the three Pereras already here must not silently inherit someone
 * else's career.
 */
function shortNameIndex(roster: RosterPlayer[]): Map<string, RosterPlayer> {
  const index = new Map<string, RosterPlayer>();
  const taken = new Set<string>();

  for (const player of roster) {
    for (const variant of [player.name, ...(player.aliases ?? [])]) {
      const parts = fold(variant).split(' ').filter(Boolean);
      if (parts.length < 2) continue;

      for (const key of [
        `${parts[0][0]} ${parts.at(-1)}`,
        `${parts[0][0]} ${parts.slice(1).join(' ')}`,
        parts.join(' '),
      ]) {
        const seated = index.get(key);
        if (seated && seated.id !== player.id) {
          index.delete(key);
          taken.add(key);
        } else if (!taken.has(key)) {
          index.set(key, player);
        }
      }
    }
  }
  return index;
}

// --- one season -----------------------------------------------------------

const battingFrom = (c: BatCard): BattingLine => ({
  runs: c.runsScored ?? 0,
  balls: c.ballsFaced ?? 0,
  fours: c.foursScored ?? 0,
  sixes: c.sixesScored ?? 0,
  strikeRate: c.ballsFaced > 0 ? round2((c.runsScored / c.ballsFaced) * 100) : 0,
  /*
    "Did not bat" is a card on the scorecard with no dismissal and no runs, and
    counting it as an innings would halve a season average. PlayHQ marks it in
    dismissalType; everything else, including a duck, is a real innings.
  */
  notOut: /not\s*out/i.test(c.dismissalType ?? ''),
  didNotBat: /did\s*not\s*bat/i.test(c.dismissalType ?? '') || !c.dismissalType,
});

const bowlingFrom = (c: BowlCard): BowlingLine => {
  const balls = oversToBalls(c.oversBowled ?? 0);
  return {
    overs: c.oversBowled ?? 0,
    balls,
    maidens: c.maidensBowled ?? 0,
    runs: c.runsConceded ?? 0,
    wickets: c.wicketsTaken ?? 0,
    economy: balls > 0 ? round2(((c.runsConceded ?? 0) / balls) * 6) : 0,
  };
};

const fieldingFrom = (c: FieldCard): FieldingLine => ({
  catches: c.totalCatches ?? 0,
  stumpings: c.stumpings ?? 0,
  // runOuts is sometimes 0 with the split fields carrying the count.
  runOuts: c.runOuts || (c.unassistedRunOuts ?? 0) + (c.assistedRunOuts ?? 0),
});

function performancesFrom(
  card: Scorecard,
  ourTeamId: string,
  teamLabel: string,
  index: Map<string, RosterPlayer>,
  unmatched: Map<string, number>,
): Performance[] {
  const byPerson = new Map<string, Performance>();

  const perf = (participantId: string, shortName: string): Performance => {
    const existing = byPerson.get(participantId);
    if (existing) return existing;

    const match = index.get(fold(shortName));
    if (!match && shortName) unmatched.set(shortName, (unmatched.get(shortName) ?? 0) + 1);

    const made: Performance = {
      playerId: match?.id ?? null,
      displayName: match?.name ?? shortName ?? 'Fill-in player',
      /*
        A name that is not on today's roster still belongs in the club's
        all-time record — players leave, and a season they played is a season
        they played. So the test is whether the scorecard gave us a name at
        all, not whether config/players.json knows it.

        That differs from the weekly aggregate, which drops unidentifiable
        performances. It is the same rule underneath: there, the name is null
        because the profile is hidden, and two anonymous fill-ins in one round
        would merge into one invented person. Here there is a real name to key
        on — "N Dharmasena" — and it carries across seasons. The name is still
        reported as unmatched so the club can add the full one to the roster.
      */
      identifiable: Boolean(match) || Boolean(shortName),
      teamSlug: teamLabel,
      gameId: card.id,
      round: card.round?.name ?? '',
      date: card.matchSchedule?.at(-1)?.startDateTime ?? '',
      opponent:
        card.matchSummary?.teams?.find((t) => t.id !== ourTeamId)?.displayName ?? 'Unknown',
      batting: null,
      bowling: null,
      fielding: null,
    };
    byPerson.set(participantId, made);
    return made;
  };

  for (const innings of card.innings ?? []) {
    if (innings.battingTeamId === ourTeamId) {
      for (const c of innings.batting ?? []) {
        const line = battingFrom(c);
        // A card for someone who never went in is not an innings.
        if (line.didNotBat && line.runs === 0 && line.balls === 0) continue;
        perf(c.participantId, c.playerShortName).batting = line;
      }
    } else {
      // The other side's innings is where our bowling and fielding happened.
      for (const c of innings.bowling ?? []) {
        const line = bowlingFrom(c);
        /*
          Cards with no ball bowled turn up for players who never came on —
          Amila Jayanuwan, who did not bowl all season, otherwise finished it
          with a bowling best of "0/0".
        */
        if (line.balls === 0 && line.runs === 0) continue;
        perf(c.participantId, c.playerShortName).bowling = line;
      }
      for (const c of innings.fielding ?? []) {
        perf(c.participantId, c.playerShortName).fielding = fieldingFrom(c);
      }
    }
  }

  return [...byPerson.values()];
}

async function collect(past: PastSeason, index: Map<string, RosterPlayer>) {
  const teamId = past.publicTeamId!;
  const teamLabel = [past.competitionShort, past.grade].filter(Boolean).join(' ') || past.label;

  const { matches = [] } = await get<{ matches: TeamMatch[] }>(
    `/scores/teams/${teamId}/matches`,
  );
  log.info(`${past.label}: ${matches.length} fixture(s) listed`);

  const unmatched = new Map<string, number>();
  const performances: Performance[] = [];
  let withCards = 0;

  for (const m of matches) {
    const card = await get<Scorecard>(
      `/scores/matches/${m.id}?responseModifier=includeScorecard`,
    );
    const rows = performancesFrom(card, teamId, teamLabel, index, unmatched);
    /*
      Status is not the test — the cards are. An ABANDONED game can carry a
      full innings bowled before the rain came, and skipping those cost Aruna
      Perera eleven runs off a season the club already has on record as 670.
      A forfeit, equally, is COMPLETED with nothing in it.
    */
    if (rows.length === 0) continue;
    withCards++;
    performances.push(...rows);
  }

  const players = aggregateRows(performances);
  log.ok(`${past.label}: ${withCards} scorecard(s), ${players.length} player(s)`);
  if (unmatched.size) {
    log.warn(
      `${past.label}: ${unmatched.size} name(s) not on the roster — ${[...unmatched.keys()].join(', ')}`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    season: past.season,
    label: past.label,
    team: past.teamNameThen ?? null,
    grade: teamLabel,
    matches: withCards,
    source: 'play.cricket.com.au match centre',
    players,
    unmatched: [...unmatched.entries()]
      .map(([name, appearances]) => ({ name, appearances }))
      .sort((a, b) => b.appearances - a.appearances),
  };
}

/**
 * The team id for a season we have no id for yet.
 *
 *   npm run playhq:history -- --seed https://play.cricket.com.au/match/<id>
 *
 * Nothing open on this API searches by club or by season, so the first id of a
 * season has to come off a match someone opened in a browser. Our side is the
 * one whose name the club recognises — in 2024/25 the club was registered as
 * "Dreamers", so the match tells us which of the two teams is ours by name
 * rather than by organisation, which belonged to the umbrella club.
 */
async function seed(matchUrl: string) {
  const id = matchUrl.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (!id) throw new Error(`no match id in ${matchUrl}`);

  const card = await get<Scorecard & { grade?: { name?: string } }>(`/scores/matches/${id}`);
  log.step(`Match ${id}${card.grade?.name ? ` — ${card.grade.name}` : ''}`);
  for (const team of card.matchSummary?.teams ?? []) {
    log.info(`${team.displayName ?? 'unnamed'}  ${team.id}`);
  }
  log.info('Copy ours into the season entry in config/all-time.json as "publicTeamId".');
}

async function main() {
  const seedAt = process.argv.indexOf('--seed');
  if (seedAt !== -1) {
    const url = process.argv[seedAt + 1];
    if (!url) throw new Error('--seed needs a play.cricket.com.au match URL');
    await seed(url);
    return;
  }

  const [{ seasons = [] }, roster] = await Promise.all([
    readJson<{ seasons: PastSeason[] }>(resolve(CONFIG_DIR, 'all-time.json')),
    loadRoster(),
  ]);

  const index = shortNameIndex(roster.players);
  const todo = seasons.filter((s) => s.publicTeamId);

  log.step(`Past seasons: ${todo.length} of ${seasons.length} have a public team id`);
  for (const s of seasons) {
    if (!s.publicTeamId) {
      log.warn(
        `${s.label}: no publicTeamId in config/all-time.json — open any ${s.label} match on ` +
          'play.cricket.com.au and run: npm run playhq:history -- --seed <that match URL>',
      );
    }
  }

  for (const past of todo) {
    const file = resolve(DATA_DIR, 'stats/history', `${past.season}.json`);
    await writeJson(file, await collect(past, index));
    log.info(`wrote data/playhq/stats/history/${past.season}.json`);
  }

  log.step('Past seasons written');
}

main().catch((err) => {
  console.error(`\n✗ History backfill failed: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});

// Keeps the type import honest for readers: this is what we produce per season.
export type HistorySeason = Awaited<ReturnType<typeof collect>>;
export type { SeasonAggregate };
