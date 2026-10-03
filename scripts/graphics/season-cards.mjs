/**
 * Render a card for every completed game of a synced season.
 *
 *   PLAYHQ_DATA_DIR=.playhq-test node scripts/graphics/season-cards.mjs grade-4 --out cards/
 *
 * A batch version of weekend-summary.mjs: same data, same templates, but it
 * walks the whole fixture instead of one date. Useful for backfilling a past
 * season and, more to the point, for seeing at a glance which real scorecards
 * the pipeline handles and which it does not.
 *
 * Games with no result — byes, washouts, abandoned matches, anything PlayHQ has
 * not finished processing — are listed and skipped rather than rendered, on the
 * same reasoning as the weekly job: a card is worse than no card when the
 * numbers behind it are incomplete.
 */

import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = resolve(ROOT, process.env.PLAYHQ_DATA_DIR ?? 'data/playhq');

const TEMPLATES = {
  'loc-1': 'graphics/match-summary/LOC1.html',
  'loc-2': 'graphics/match-summary/LOC2.html',
  'grade-4': 'graphics/match-summary/grade4.html',
};

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? null : args[i + 1];
};
const outDir = resolve(ROOT, flag('out') ?? 'season-cards');
const season = flag('season') ?? '2025-26';

if (!slug || !TEMPLATES[slug]) {
  console.error(`usage: season-cards.mjs <${Object.keys(TEMPLATES).join('|')}> [--out dir] [--season 2025-26]`);
  process.exit(1);
}

const fixtures = JSON.parse(await readFile(resolve(DATA_DIR, 'fixtures.json'), 'utf8'));
const team = fixtures.teams?.find((t) => t.slug === slug);
if (!team) {
  console.error(`${slug} is not in ${DATA_DIR}/fixtures.json`);
  process.exit(1);
}

const seasonCfg = JSON.parse(
  await readFile(resolve(ROOT, `config/season-${season}.json`), 'utf8'),
);
const cfg = seasonCfg.teams?.find((t) => t.slug === slug);

await mkdir(outDir, { recursive: true });

const { fromGame, toFields } = await import('./from-game.mjs');
const { writeFile } = await import('node:fs/promises');

const run = (cmd, a) =>
  new Promise((ok, fail) => {
    const c = spawn(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT });
    let err = '';
    c.stderr.on('data', (d) => (err += d));
    c.stdout.on('data', () => {});
    c.on('close', (code) => (code === 0 ? ok() : fail(new Error(err.trim() || `exit ${code}`))));
  });

const built = [];
const skipped = [];
const failed = [];

console.log(`\n${team.name} — ${team.games?.length ?? 0} games in the fixture\n`);

for (const game of team.games ?? []) {
  const label = `${game.roundShort ?? game.round} v ${game.opponent}`;
  const summaryPath = resolve(DATA_DIR, 'games', `${game.id}.json`);

  if (game.status !== 'FINAL') {
    skipped.push(`${label} — ${game.status}`);
    continue;
  }
  if (!existsSync(summaryPath)) {
    skipped.push(`${label} — no scorecard cached`);
    continue;
  }
  if (!game.ourScore || !game.theirScore) {
    skipped.push(`${label} — ${game.outcome ?? 'no result'} (${game.ourScore ?? '—'} v ${game.theirScore ?? '—'})`);
    continue;
  }

  const out = join(outDir, `${slug}-${String(game.roundShort ?? game.round).replace(/\W+/g, '-').toLowerCase()}.png`);
  const fieldsPath = resolve(ROOT, `.summary-${slug}-batch.json`);

  try {
    const match = await fromGame(game.id);
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    const fields = toFields(match, summary);
    if (cfg) fields['meta.competition'] = `${cfg.competitionShort} ${cfg.gradeLabel}`.toUpperCase();

    await writeFile(fieldsPath, JSON.stringify(fields, null, 2));
    await run('node', ['scripts/graphics/render-html.mjs', TEMPLATES[slug], out, fieldsPath, '1080x1080']);

    console.log(`  ✓ ${label.padEnd(42)} ${game.ourScore} v ${game.theirScore}`);
    built.push(out);
  } catch (e) {
    console.log(`  ✗ ${label.padEnd(42)} ${e.message.split('\n')[0]}`);
    failed.push(label);
  }
}

console.log(`\n  ${built.length} card(s) in ${outDir}`);
if (skipped.length) {
  console.log(`  ${skipped.length} skipped:`);
  for (const s of skipped) console.log(`    · ${s}`);
}
if (failed.length) {
  console.log(`  ${failed.length} FAILED — these are bugs, not missing data:`);
  for (const f of failed) console.log(`    · ${f}`);
  process.exit(1);
}
