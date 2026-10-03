/**
 * Render the MVP poster for a team's most recent completed match.
 *
 *   node scripts/graphics/mvp-card.mjs <team-slug> [--date YYYY-MM-DD] [--out file.png]
 *
 * Companion to weekend-summary.mjs: same fixture lookup, same exit codes, but
 * it produces the player poster rather than the scorecard.
 *
 *   0  a card was written
 *   3  nothing to publish (no game, bye, washout, scorecard not processed, or
 *      no batter to name) — a skip, not a failure
 *   1  something is actually wrong
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = resolve(ROOT, process.env.PLAYHQ_DATA_DIR ?? 'data/playhq');
const NOTHING_TO_PUBLISH = 3;

/** One design per side. LOC 1 and Grade 4 play in coloured kit and share the
 *  dark treatment; LOC 2 is the white-kit edition. */
const TEMPLATES = {
  'loc-1': 'graphics/mvp/loc1-mvp.html',
  'loc-2': 'graphics/mvp/loc2-mvp.html',
  'grade-4': 'graphics/mvp/grade4-mvp.html',
};

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? null : args[i + 1];
};

if (!slug || !TEMPLATES[slug]) {
  console.error(`usage: mvp-card.mjs <${Object.keys(TEMPLATES).join('|')}> [--date YYYY-MM-DD] [--out file.png]`);
  process.exit(1);
}

const melbourneDay = (d) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

const targetDate = flag('date') ?? melbourneDay(new Date());
const out = flag('out') ?? `mvp-${slug}.png`;
const season = flag('season') ?? '2026-27';

const fixturesPath = resolve(DATA_DIR, 'fixtures.json');
if (!existsSync(fixturesPath)) {
  console.error(`${fixturesPath} is missing — run npm run playhq:sync first.`);
  process.exit(1);
}

const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'));
const team = fixtures.teams?.find((t) => t.slug === slug);
if (!team) {
  console.error(`${slug} is not in ${fixturesPath}`);
  process.exit(1);
}

const played = (team.games ?? []).filter((g) =>
  (g.dates ?? []).some((d) => melbourneDay(new Date(d)) === targetDate),
);

if (!played.length) {
  console.log(`${slug}: no game on ${targetDate} — nothing to publish.`);
  process.exit(NOTHING_TO_PUBLISH);
}

const game = played[played.length - 1];
if (game.status !== 'FINAL') {
  console.log(`${slug}: ${game.round} is ${game.status}, not FINAL — nothing to publish.`);
  process.exit(NOTHING_TO_PUBLISH);
}
if (!existsSync(resolve(DATA_DIR, 'games', `${game.id}.json`))) {
  console.log(`${slug}: ${game.round} has no scorecard yet — nothing to publish.`);
  process.exit(NOTHING_TO_PUBLISH);
}

const seasonCfg = JSON.parse(
  await readFile(resolve(ROOT, `config/season-${season}.json`), 'utf8'),
);
const cfg = seasonCfg.teams?.find((t) => t.slug === slug);
const label = cfg
  ? `${cfg.competitionShort} ${seasonCfg.label.replace(/\s*Season\s*$/i, '')} • ${cfg.gradeLabel}`
  : undefined;

/** One photo folder per side. Until the club supplies a photo per player, each
 *  team's card uses that squad's Player1.png. */
const PHOTO_DIR = { 'loc-1': 'LOC1', 'loc-2': 'LOC2', 'grade-4': 'Grade4' };

const { mvpFields } = await import('./mvp-fields.mjs');
const fields = await mvpFields(game.id, { competition: label });

if (fields) {
  const photo = `graphics/mvp/players/${PHOTO_DIR[slug]}/Player1.png`;
  if (existsSync(resolve(ROOT, photo))) fields['player.photo'] = photo;
}

if (!fields) {
  console.log(`${slug}: ${game.round} has no batter to name — nothing to publish.`);
  process.exit(NOTHING_TO_PUBLISH);
}

const fieldsPath = resolve(ROOT, `.mvp-${slug}.json`);
await writeFile(fieldsPath, JSON.stringify(fields, null, 2));

const run = (cmd, a) =>
  new Promise((ok, fail) => {
    const c = spawn(cmd, a, { stdio: 'inherit', cwd: ROOT });
    c.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}`))));
  });

console.log(
  `${slug}: ${game.round} — ${fields['player.first']} ${fields['player.last']} ` +
    `${fields['bat.runs']}${fields['bat.notout']} ${fields['bat.balls']}`,
);

await run('node', [
  'scripts/graphics/render-html.mjs',
  TEMPLATES[slug],
  out,
  fieldsPath,
  // Facebook portrait.
  '1080x1350',
]);

console.log(out);
