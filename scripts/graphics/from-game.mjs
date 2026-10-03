/**
 * Build the match-summary data structure from a cached PlayHQ game summary.
 *
 *   node scripts/graphics/from-game.mjs <gameId> out.png
 *
 * Reads <PLAYHQ_DATA_DIR or data/playhq>/games/<gameId>.json — written by
 * `npm run playhq:sync` —
 * so no scorecard is typed by hand. Statistic type names (TOTAL_RUNS,
 * BALLS_FACED, WICKETS, …) are the ones scripts/playhq/aggregate.ts already
 * uses; if PlayHQ renames one, both places change together.
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Honour the same override the sync uses, so a backfill against an old
// season reads that run's output rather than the committed current season.
const DATA_DIR = resolve(ROOT, process.env.PLAYHQ_DATA_DIR ?? 'data/playhq');

const stat = (stats, type, fallback = 0) => {
  const hit = (stats ?? []).find((s) => s.type === type);
  return hit && typeof hit.value === 'number' ? hit.value : fallback;
};

/**
 * Hidden profiles and unregistered fill-ins come back with null names.
 *
 * Names longer than two words are cut to the first two. PlayHQ splits on
 * first/last, but a first name is often several words — "Thisara Nilupul
 * Lankathilake" arrives as firstName "Thisara Nilupul" — and the full string
 * squeezes the scorecard type down to nothing.
 */
const displayName = (a) => {
  const full = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
  if (!full) return 'Fill-in player';
  const words = full.split(/\s+/);
  return words.length > 2 ? words.slice(0, 2).join(' ') : full;
};


const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

/**
 * Flatten a game summary into the data-field map the HTML designs expect.
 * Innings are emitted in the order they were played, so the side that batted
 * first is always the top block.
 */
export function toFields(match, summary) {
  const f = {};
  match.innings.slice(0, 2).forEach((inn, i) => {
    const k = `i${i + 1}`;
    f[`${k}.team`] = inn.name.toUpperCase();
    f[`${k}.score`] = inn.score;
    if (inn.overs) f[`${k}.overs`] = inn.overs;
    inn.batting.slice(0, 3).forEach((b, n) => {
      f[`${k}.bat.${n}.name`] = b.name;
      f[`${k}.bat.${n}.runs`] = b.runs;
    });
    inn.bowling.slice(0, 3).forEach((b, n) => {
      f[`${k}.bowl.${n}.name`] = b.name;
      f[`${k}.bowl.${n}.figures`] = b.figures;
    });
  });

  // The toss is in the API; the design shows it against whoever won it.
  const toss = summary?.coinToss;
  if (toss) {
    const name = summary.teams.find((t) => t.id === toss.winningTeamId)?.name ?? '';
    const first = match.innings[0]?.name;
    const key = name === first ? 'i1.toss' : 'i2.toss';
    f[key] = `WON TOSS${toss.preference ? ` · ${toss.preference}` : ''}`;
  }

  // Header, competition, venue and result. Read straight from the summary:
  // deriving these by splitting match.meta on ' · ' silently shifts the date
  // into the venue slot on any game where PlayHQ omits the playing surface.
  const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const when = summary?.schedule?.[0]?.dateTime;
  const surface = summary?.playingSurfaces?.[0];

  if (summary?.round?.name) f['meta.round'] = summary.round.name.toUpperCase();
  const place = surface?.venue?.name ?? surface?.name;
  f['meta.venue'] = place ? `VENUE: ${place}`.toUpperCase() : '';
  if (when) {
    const dt = new Date(when);
    f['meta.season'] = `${dt.getDate()} ${MON[dt.getMonth()]} ${dt.getFullYear()}`;
  }
  if (match.competition) f['meta.competition'] = match.competition.toUpperCase();

  // The h2 reads "AWAY vs HOME"; PlayHQ marks which side is home.
  const home = summary?.teams?.find((t) => t.isHomeTeam);
  const away = summary?.teams?.find((t) => !t.isHomeTeam);
  if (home) f['header.home'] = home.name.toUpperCase();
  if (away) f['header.away'] = away.name.toUpperCase();

  // "<TEAM> WON BY <margin>" is two fields so the design keeps its colouring.
  const m = /^(.*?) WIN BY (.*)$/.exec(match.result ?? '');
  if (m) {
    f['result.team'] = m[1];
    f['result.verb'] = 'WON BY';
    f['result.margin'] = m[2];
  } else if (match.result) {
    // "MATCH DRAWN", "WASHED OUT" — a whole-line statement with no margin. The
    // design's static "WON BY" sits between the two fields, so it has to be
    // emptied too or the banner reads "MATCH DRAWN WON BY".
    f['result.team'] = match.result;
    f['result.verb'] = '';
    f['result.margin'] = '';
  }
  return f;
}

export async function fromGame(gameId) {
  const summary = JSON.parse(
    await readFile(resolve(DATA_DIR, 'games', `${gameId}.json`), 'utf8'),
  );

  const nameById = new Map(summary.appearances.map((a) => [a.id, displayName(a)]));
  const teamName = new Map(summary.teams.map((t) => [t.id, t.name]));

  const innings = [];

  for (const period of summary.periods ?? []) {
    const batting = period.teams.find((t) => t.discipline === 'BATTING');
    const bowling = period.teams.find((t) => t.discipline === 'BOWLING');
    if (!batting) continue;

    // Team totals and player figures use DIFFERENT stat names. At team level
    // it is TOTAL_SCORE / TOTAL_OUTS / TOTAL_OVERS; TOTAL_RUNS and BALLS_FACED
    // exist only on an appearance. Reading the player names here returned 0
    // for every innings, which the design duly printed as "0-0".
    const runs = stat(batting.statistics, 'TOTAL_SCORE');
    const wkts = stat(batting.statistics, 'TOTAL_OUTS');
    // Already overs, not balls — no conversion.
    const overs = stat(batting.statistics, 'TOTAL_OVERS');

    const top = (arr, score, n = 3) =>
      [...arr].sort((a, b) => score(b) - score(a)).slice(0, n);

    innings.push({
      name: teamName.get(batting.id) ?? 'Unknown',
      // All out is written as the total alone; a side 10 down does not read
      // "10-88" on a scoreboard.
      score: wkts >= 10 ? `${runs}` : `${wkts}-${runs}`,
      overs: overs ? `${overs} OVERS` : '',
      batting: top(
        (batting.appearances ?? []).filter((a) => a.status !== 'DID_NOT_BAT'),
        (a) => stat(a.statistics, 'TOTAL_RUNS'),
      ).map((a) => ({
        name: nameById.get(a.id) ?? 'Fill-in player',
        runs: `${stat(a.statistics, 'TOTAL_RUNS')}${a.status === 'NOT_OUT' ? '*' : ''}`,
        balls: `(${stat(a.statistics, 'BALLS_FACED')})`,
      })),
      bowling: top(
        (bowling?.appearances ?? []).filter((a) => stat(a.statistics, 'OVERS') > 0),
        (a) => stat(a.statistics, 'WICKETS') * 1000 - stat(a.statistics, 'RUNS'),
      ).map((a) => ({
        name: nameById.get(a.id) ?? 'Fill-in player',
        figures: `${stat(a.statistics, 'WICKETS')}/${stat(a.statistics, 'RUNS')}`,
      })),
    });
  }

  const d = new Date(summary.schedule?.[0]?.dateTime ?? Date.now());
  const ground = summary.playingSurfaces?.[0]?.name ?? '';
  // Outcome is not a two-value field. Real values from one season include
  // WON_BY_FORFEIT and WON_BY_CUSTOM_TARGET, so match on the prefix rather
  // than on an exact string — an unlisted WON_BY_* still reads as a win.
  const isWin = (o) => typeof o === 'string' && /^WON(_|$)/.test(o);
  const isLoss = (o) => typeof o === 'string' && /^LOST(_|$)/.test(o);
  const won = summary.teams.find((t) => isWin(t.outcome));
  const lost = summary.teams.find((t) => isLoss(t.outcome));
  const outcomes = new Set(summary.teams.map((t) => t.outcome));

  let result = 'MATCH DRAWN';
  if (summary.status !== 'FINAL') result = 'MATCH IN PROGRESS';
  else if (outcomes.has('WASHOUT')) result = 'WASHED OUT';
  else if (outcomes.has('FORFEIT')) result = 'FORFEIT';
  else if (outcomes.has('TIED')) result = 'MATCH TIED';
  else if (won) result = `${(teamName.get(won.id) ?? '').toUpperCase()} WIN`;
  if (won && lost) {
    const w = innings.find((i) => i.name === teamName.get(won.id));
    const l = innings.find((i) => i.name === teamName.get(lost.id));
    if (w && l) {
      // score is "w-runs", or just "runs" when a side is all out.
      const parts = (s) => String(s.score).split('-');
      const r = (s) => Number(parts(s).length > 1 ? parts(s)[1] : parts(s)[0]);
      const k = (s) => (parts(s).length > 1 ? Number(parts(s)[0]) : 10);
      // A forfeit has no playing margin to quote, whatever the scorecard says.
      const margin = /FORFEIT/.test(won.outcome)
        ? 'FORFEIT'
        : /SUPER_OVER/.test(won.outcome)
          ? 'SUPER OVER'
          : innings.indexOf(w) === 0
            ? `${r(w) - r(l)} RUNS`
            : `${10 - k(w)} WICKETS`;
      result = `${teamName.get(won.id).toUpperCase()} WIN BY ${margin}`;
    }
  }

  return {
    subtitle: summary.teams.map((t) => t.name).join(' v '),
    meta: [
      summary.round?.name?.toUpperCase(),
      ground.toUpperCase(),
      `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    ]
      .filter(Boolean)
      .join(' · '),
    innings,
    result,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , gameId, outPath] = process.argv;
  if (!gameId || !outPath) {
    console.error('usage: node scripts/graphics/from-game.mjs <gameId> <out.png>');
    process.exit(1);
  }
  const { build } = await import('./match-summary.mjs');
  console.log('wrote', await build(await fromGame(gameId), outPath));
}
