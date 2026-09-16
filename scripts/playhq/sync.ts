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

import { syncLogos } from './logos.js';
import {
  gamesForGrade,
  gradesForSeason,
  ladderForGrade,
  seasonsForOrganisation,
  summaryForGame,
} from './client.js';

/** The team lookup and the sync both want the grade's games; fetch it once. */
const gradeGames = new Map<string, Promise<GradeGame[]>>();
const gamesFor = (gradeId: string) => {
  if (!gradeGames.has(gradeId)) gradeGames.set(gradeId, gamesForGrade(gradeId));
  return gradeGames.get(gradeId)!;
};
import type {
  GameSummary,
  Grade,
  GradeGame,
  Season,
  NormalisedGame,
  TeamConfig,
  TeamFixtures,
} from './types.js';
import {
  CONFIG_DIR, DATA_DIR, fileExists, loadSeasonConfig, log, readJson, stat, writeJson,
} from './utils.js';

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

/**
 * PlayHQ gives wall-clock time plus a zone name, not an instant. Resolve it to
 * a real offset for that date so a summer fixture is not stored an hour out.
 */
function toInstant(date: string, time: string, tz: string): string {
  const asIfUtc = new Date(`${date}T${time}Z`);
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(asIfUtc)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  const offsetMs = m
    ? (m[1] === '-' ? -1 : 1) * ((Number(m[2]) * 60 + Number(m[3])) * 60_000)
    : 0;
  return new Date(asIfUtc.getTime() - offsetMs).toISOString();
}

function normaliseGames(
  allGames: GradeGame[],
  teamId: string,
  summaries: Map<string, GameSummary>,
): { games: NormalisedGame[]; byes: TeamFixtures['byes'] } {
  const games: NormalisedGame[] = [];

  for (const game of allGames) {
    const us = game.competitors?.find((c) => c.id === teamId);
    if (!us) continue;
    const them = game.competitors?.find((c) => c.id !== teamId);

    const summary = summaries.get(game.id) ?? null;
    const suburb = game.venue?.address?.suburb ?? null;
    const venueName = game.venue?.name ?? null;

    // Prefer the scorecard, which has wickets. competitors[].scoreTotal is runs
    // only, so it stands in when the summary has not been processed yet.
    const line = (who: { id: string; scoreTotal?: number } | undefined) => {
      if (!who) return null;
      const fromSummary = summary ? scoreLine(summary, who.id) : null;
      return fromSummary ?? (typeof who.scoreTotal === 'number' ? String(who.scoreTotal) : null);
    };

    games.push({
      id: game.id,
      status: game.status,
      type: game.type ?? null,
      round: game.round?.name ?? 'Round',
      roundShort: game.round?.abbreviatedName ?? '',
      isFinal: game.round?.isFinalRound ?? false,
      dates: game.schedule?.date
        ? [toInstant(game.schedule.date, game.schedule.time ?? '00:00:00', game.schedule.timezone ?? 'Australia/Melbourne')]
        : [],
      isHome: us.isHomeTeam,
      opponent: them?.name ?? 'TBC',
      outcome: us.outcome ?? null,
      venue: venueName,
      ground: game.venue?.surfaceName ?? venueName,
      suburb,
      mapQuery: venueName
        ? encodeURIComponent([venueName, suburb, 'VIC'].filter(Boolean).join(', '))
        : null,
      ourScore: line(us),
      theirScore: line(them),
    });
  }

  games.sort((a, b) => (a.dates[0] ?? '').localeCompare(b.dates[0] ?? ''));

  // This endpoint has no bye records — a bye is simply the absence of a game.
  // Infer it: any round the grade played in which we have no fixture. That also
  // catches a round we were left out of for other reasons, so it is a fair
  // description of the week rather than a claim about the draw.
  const ourRounds = new Set(
    allGames.filter((g) => g.competitors?.some((c) => c.id === teamId)).map((g) => g.round?.id),
  );
  const seen = new Map<string, { round: string; roundShort: string }>();
  for (const g of allGames) {
    if (!g.round?.id || ourRounds.has(g.round.id) || seen.has(g.round.id)) continue;
    // Finals we were not in are not byes. Last season this labelled the
    // Preliminary Final a bye for a side that went from the first final
    // straight to the Grand Final.
    if (g.round.isFinalRound) continue;
    seen.set(g.round.id, { round: g.round.name, roundShort: g.round.abbreviatedName });
  }
  const byes = [...seen.values()];

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
  const discovered: Array<{ slug: string; seasonId: string; gradeId: string }> = [];
  let pending = 0;

  // A grade fixture names every team in it, so a missing team ID can be
  // resolved from the grade rather than hunted for by hand. Discovery's team
  // lookup comes back empty for a club-level organisation, which is why this
  // exists at all.
  const club = await readJson<{
    playhq: { clubNameMatch: string; organisationIds: Array<{ label: string; id: string | null }> };
  }>(resolve(CONFIG_DIR, 'club.json'));
  const nameMatch = new RegExp(club.playhq.clubNameMatch, 'i');

  /**
   * Find a team's season and grade IDs from the API instead of having them
   * pasted in by hand.
   *
   * Everything needed is already public: the organisation lists its seasons,
   * and a season lists its grades. Asking a human to run discovery, read a
   * UUID off the screen and retype it into a config file is a step that can
   * only introduce errors — and did: the grade ID recorded for last season was
   * wrong and 404'd for weeks.
   *
   * Seasons are fetched once and shared, since all three sides look at the
   * same organisation.
   */
  const seasonCache = new Map<string, Promise<Season[]>>();
  const seasonsFor = (orgId: string) => {
    if (!seasonCache.has(orgId)) seasonCache.set(orgId, seasonsForOrganisation(orgId));
    return seasonCache.get(orgId)!;
  };
  const gradeCache = new Map<string, Promise<Grade[]>>();
  const gradesFor = (seasonId: string) => {
    if (!gradeCache.has(seasonId)) gradeCache.set(seasonId, gradesForSeason(seasonId));
    return gradeCache.get(seasonId)!;
  };

  /**
   * Grade names are not the labels a club uses.
   *
   * ECA publishes "13. LOC 1 McCarthy Shield" where the club says "LOC 1":
   * an ordinal prefix, the division, and the shield it is played for, all in
   * one string. VSCA publishes a bare "Grade 4". So compare on tokens, and try
   * the specific tests before the loose ones.
   */
  const toks = (v: string) =>
    v
      .replace(/^\s*\d+\s*[.)-]\s*/, '') // "13. " is a sort key, not a name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

  const norm = (v: string) => toks(v).join('');

  /** Returns the single grade this team plays in, or null with a reason. */
  function matchGrade(grades: Grade[], team: TeamConfig): { grade: Grade; how: string } | null {
    const label = toks(team.gradeLabel);
    const shield = team.shield ? toks(team.shield) : null;

    // 1. The name is exactly the label. VSCA's "Grade 4".
    let hits = grades.filter((g) => toks(g.name).join(' ') === label.join(' '));
    if (hits.length === 1) return { grade: hits[0], how: 'exact name' };

    // 2. The shield. Unique within a competition, and the club already records
    //    it — it is what makes "LOC 1" findable inside a longer ECA name.
    if (shield) {
      hits = grades.filter((g) => {
        const t = toks(g.name);
        return shield.every((word) => t.includes(word));
      });
      if (hits.length === 1) return { grade: hits[0], how: 'shield name' };
    }

    // 3. The label as a leading run of tokens, so "LOC 1" matches
    //    "LOC 1 McCarthy Shield" but never "LOC 8 Carr Shield".
    hits = grades.filter((g) => {
      const t = toks(g.name);
      return label.every((word, i) => t[i] === word);
    });
    if (hits.length === 1) return { grade: hits[0], how: 'grade label' };

    if (hits.length > 1) {
      log.warn(`${team.name}: "${team.gradeLabel}" matches more than one grade:`);
      for (const g of hits) log.info(`    ${g.name}  ${g.id}`);
      log.info('    Set playhqGradeId in the season config to choose one.');
    }
    return null;
  }

  async function resolveGrade(
    team: TeamConfig,
  ): Promise<{ seasonId: string; gradeId: string } | null> {
    if (team.playhqGradeId) {
      return { seasonId: team.playhqSeasonId ?? '', gradeId: team.playhqGradeId };
    }

    const orgs = club.playhq.organisationIds.filter((o): o is { label: string; id: string } =>
      Boolean(o.id),
    );

    for (const org of orgs) {
      const seasons = await seasonsFor(org.id);

      // A finished season's grades are not this season's. Rank the live ones
      // first and never fall back to a COMPLETED season: pulling last year's
      // fixtures and presenting them as this year's is the one failure here
      // that would look like success.
      const live = seasons.filter((x) => x.status === 'ACTIVE' || x.status === 'UPCOMING');

      // Prefer a season whose competition names this team's association: the
      // club plays ECA on Saturdays and VSCA on Sundays, and both appear.
      const assoc = [team.competition, team.competitionShort].filter(Boolean).map(norm);
      const ranked = [...live].sort((a, b) => {
        const score = (x: Season) => {
          const hay = norm(`${x.competition?.name ?? ''} ${x.association?.name ?? ''} ${x.name}`);
          return assoc.some((needle) => hay.includes(needle)) ? 0 : 1;
        };
        return score(a) - score(b);
      });

      for (const candidate of ranked) {
        const grades = await gradesFor(candidate.id);
        const found = matchGrade(grades, team);
        if (found) {
          log.ok(
            `${team.name}: matched "${found.grade.name}" by ${found.how} ` +
              `in ${candidate.name}`,
          );
          return { seasonId: candidate.id, gradeId: found.grade.id };
        }
      }
    }

    // Say what was actually on offer, so the next step is obvious.
    const seen: string[] = [];
    for (const org of orgs) {
      for (const x of await seasonsFor(org.id)) {
        if (x.status === 'COMPLETED') continue;
        const grades = await gradesFor(x.id);
        seen.push(`${x.name} [${x.status}]: ${grades.map((g) => g.name).join(', ') || '(no grades yet)'}`);
      }
    }
    log.warn(`${team.name}: no grade called "${team.gradeLabel}" in any current season.`);
    for (const line of seen) log.info(`    ${line}`);
    return null;
  }

  async function resolveTeamId(team: TeamConfig): Promise<string | null> {
    if (team.playhqTeamId) return team.playhqTeamId;
    if (!team.playhqGradeId) return null;

    // The fixture lists every team in the grade up front — including one that
    // has not played yet — so match on that rather than on who appears in a
    // game. Last season the side was registered as "Dreamers SC - 4"; this
    // season it is "Dreamers 1st XI". Both contain the club name, which is why
    // the match is a loose one.
    const all = await gamesFor(team.playhqGradeId);
    const named = new Map<string, string>();
    for (const g of all) for (const c of g.competitors ?? []) named.set(c.id, c.name);
    const hits = [...named].map(([id, name]) => ({ id, name })).filter((t) => nameMatch.test(t.name));

    if (hits.length === 1) {
      log.ok(`resolved team ID from the fixture: ${hits[0].name} → ${hits[0].id}`);
      return hits[0].id;
    }
    if (hits.length > 1) {
      log.warn(`${hits.length} teams match "${club.playhq.clubNameMatch}" in this grade:`);
      for (const t of hits) log.info(`    ${t.name}  ${t.id}`);
      log.info('    Set playhqTeamId in the season config to choose one.');
    } else {
      log.warn(`no team matching "${club.playhq.clubNameMatch}" in this grade's fixture`);
      log.info(`    the grade contains: ${[...named.values()].join(', ')}`);
    }
    return null;
  }

  for (const team of active as TeamConfig[]) {
    if (!team.playhqGradeId) {
      const found = await resolveGrade(team);
      if (found) {
        team.playhqGradeId = found.gradeId;
        if (!team.playhqSeasonId && found.seasonId) team.playhqSeasonId = found.seasonId;
        discovered.push({ slug: team.slug, ...found });
      }
    }
    if (team.playhqGradeId && !team.playhqTeamId) {
      team.playhqTeamId = await resolveTeamId(team);
    }
    if (!team.playhqGradeId || !team.playhqTeamId) {
      log.info(`${team.name}: no grade/team ID yet — skipping (grades may not be published)`);
      pending++;
      fixturesOut.push({
        slug: team.slug, name: team.name, competition: team.competition,
        gradeLabel: team.gradeLabel, gradeId: null, teamId: null, games: [], byes: [],
      });
      continue;
    }

    log.step(team.name);

    const allGames = await gamesFor(team.playhqGradeId);
    const ourGames = allGames.filter((g) =>
      g.competitors?.some((c) => c.id === team.playhqTeamId),
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

    const { games, byes } = normaliseGames(allGames, team.playhqTeamId, summaries);
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

  // Club crests. Available from /v1/seasons/{id}/teams — measured, not assumed —
  // and cached locally so the graphics never depend on a Cloudinary URL that
  // carries a version stamp and a signed-looking parameter.
  const seasonIds = (active as TeamConfig[])
    .map((t) => t.playhqSeasonId)
    .filter((x): x is string => Boolean(x));
  if (seasonIds.length) {
    const allSeasons: Season[] = [];
    for (const org of club.playhq.organisationIds) {
      if (!org.id) continue;
      for (const x of await seasonsFor(org.id)) {
        if (seasonIds.includes(x.id)) allSeasons.push(x);
      }
    }
    try {
      await syncLogos(seasonIds, allSeasons);
    } catch (err) {
      // A missing crest is a cosmetic loss; it must not fail the sync.
      log.warn(`crests: ${err instanceof Error ? err.message : err}`);
    }
  }

  const syncedAt = new Date().toISOString();
  await writeJson(resolve(DATA_DIR, 'fixtures.json'), { syncedAt, season: season.season, teams: fixturesOut });
  await writeJson(resolve(DATA_DIR, 'ladders.json'), { syncedAt, season: season.season, grades: laddersOut });

  log.step('Sync complete');
  if (pending) {
    log.info(`${pending} team(s) have no grade yet — the association has not published theirs.`);
  }
  if (discovered.length) {
    // Resolved live, so the sync works without them. Recording them in the
    // config makes each later run one round-trip shorter and pins the choice
    // if an association ever publishes two grades with the same label.
    log.info('Grade IDs resolved from the API. To pin them, add to config/season-2026-27.json:');
    for (const d of discovered) {
      log.info(`    ${d.slug}: "playhqSeasonId": "${d.seasonId}", "playhqGradeId": "${d.gradeId}"`);
    }
  }
}

main().catch((err) => {
  console.error(`\n✗ Sync failed: ${err instanceof Error ? err.message : err}\n`);
  // Non-zero exit matters: CI must not commit half-written data.
  process.exit(1);
});
