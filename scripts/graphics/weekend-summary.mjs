/**
 * Turn this weekend's finished match into a shareable PNG.
 *
 *   node scripts/graphics/weekend-summary.mjs <team-slug> [--date YYYY-MM-DD] [--out file.png]
 *
 * Run after `npm run playhq:sync`, which is what writes data/playhq/fixtures.json
 * and the game summaries this reads.
 *
 * Exit codes matter — the GitHub Action branches on them:
 *   0  a card was written (path printed on the last line)
 *   3  nothing to publish: no game that day, a bye, a washout, or a scorecard
 *      PlayHQ has not finished processing. Not a failure; the Action skips
 *      sending and says why.
 *   1  something is actually wrong.
 *
 * Reason for 3 rather than "send it anyway": a half-entered scorecard makes a
 * card that says 0-0 in the club's name. Silence is the better failure.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const NOTHING_TO_PUBLISH = 3;

/** Which design belongs to which side. The badge in each is that body's. */
const TEMPLATES = {
  'loc-1': 'graphics/match-summary/LOC1.html',
  'loc-2': 'graphics/match-summary/LOC2.html',
  'grade-4': 'graphics/match-summary/grade4.html',
};

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

if (!slug || !TEMPLATES[slug]) {
  console.error(`usage: weekend-summary.mjs <${Object.keys(TEMPLATES).join('|')}> [--date YYYY-MM-DD] [--out file.png]`);
  process.exit(1);
}

/** Today in Melbourne, not in UTC — the runner is on UTC and 7pm AEDT is next-day-adjacent. */
const melbourneToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const targetDate = flag('date') ?? melbourneToday();
const out = flag('out') ?? `match-summary-${slug}.png`;

// Same override the sync honours, so a test run reads the test sync's output.
const DATA_DIR = resolve(ROOT, process.env.PLAYHQ_DATA_DIR ?? 'data/playhq');
const fixturesPath = resolve(DATA_DIR, 'fixtures.json');
if (!existsSync(fixturesPath)) {
  console.error(`${fixturesPath} is missing — run npm run playhq:sync first.`);
  process.exit(1);
}

const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'));
const team = fixtures.teams?.find((t) => t.slug === slug);

if (!team) {
  console.error(`${slug} is not in data/playhq/fixtures.json.`);
  process.exit(1);
}

if (!team.teamId || !team.gradeId) {
  console.log(`${slug}: no PlayHQ grade/team ID yet — nothing to publish.`);
  process.exit(NOTHING_TO_PUBLISH);
}

/** A game counts as "this weekend's" if any of its dates falls on the target day. */
const onTargetDay = (game) =>
  (game.dates ?? []).some(
    (d) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Melbourne',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(d)) === targetDate,
  );

const played = (team.games ?? []).filter(onTargetDay);

if (!played.length) {
  const bye = (team.byes ?? []).length ? ' (the team may have had a bye)' : '';
  console.log(`${slug}: no game on ${targetDate}${bye} — nothing to publish.`);
  process.exit(NOTHING_TO_PUBLISH);
}

// A two-day game appears on both its dates. Take the last one listed for the
// day, which is the innings the weekend actually ended on.
const game = played[played.length - 1];

if (game.status && game.status !== 'FINAL') {
  console.log(`${slug}: ${game.round} is ${game.status}, not FINAL — nothing to publish.`);
  process.exit(NOTHING_TO_PUBLISH);
}

if (!game.ourScore || !game.theirScore) {
  console.log(
    `${slug}: ${game.round} v ${game.opponent} has no scoreline yet ` +
      `(ours=${game.ourScore ?? 'none'}, theirs=${game.theirScore ?? 'none'}) — nothing to publish.`,
  );
  process.exit(NOTHING_TO_PUBLISH);
}

const summaryPath = resolve(DATA_DIR, 'games', `${game.id}.json`);
if (!existsSync(summaryPath)) {
  console.log(`${slug}: ${game.round} has no scorecard in ${DATA_DIR}/games — nothing to publish.`);
  process.exit(NOTHING_TO_PUBLISH);
}

// Build the fields from the real scorecard, then hand them to the renderer as
// a temporary file — render-html.mjs takes a path, and this keeps the exact
// input that produced the card available for inspection when one looks wrong.
const { fromGame, toFields } = await import('./from-game.mjs');
// fromGame() returns the nested match object the older canvas renderer wants;
// toFields() is what flattens it into the data-field map the HTML designs read.
const match = await fromGame(game.id);
const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
const fields = toFields(match, summary);

// PlayHQ's game summary does not name the competition, so it comes from the
// season config — the same place the site gets it.
const season = JSON.parse(
  await readFile(resolve(ROOT, 'config/season-2026-27.json'), 'utf8'),
);
const cfg = season.teams?.find((t) => t.slug === slug);
if (cfg) {
  fields['meta.competition'] = `${cfg.competitionShort} ${cfg.gradeLabel}`.toUpperCase();
}

const fieldsPath = resolve(ROOT, `.summary-${slug}.json`);
const { writeFile } = await import('node:fs/promises');
await writeFile(fieldsPath, JSON.stringify(fields, null, 2));

const run = (cmd, cmdArgs) =>
  new Promise((ok, fail) => {
    const child = spawn(cmd, cmdArgs, { stdio: 'inherit', cwd: ROOT });
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}`))));
  });

console.log(`${slug}: ${game.round} v ${game.opponent} — ${game.ourScore} v ${game.theirScore}`);
await run('node', [
  'scripts/graphics/render-html.mjs',
  TEMPLATES[slug],
  out,
  fieldsPath,
  '1080x1080',
]);

console.log(out);
