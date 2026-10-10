/**
 * Prepare player portraits for the site.
 *
 *   npm run players:photos          # optimise everything new
 *   npm run players:photos -- --force   # redo them all
 *
 * Drop a photo into src/assets/players/<TEAM>/ named however is convenient —
 * "Janaka.png", "janaka-don.jpg", "Janaka Don.png" all work. This matches it to
 * a player in config/players.json and writes an optimised copy to
 * src/assets/players/portraits/<roster-id>.webp, which is the only folder the
 * site reads.
 *
 * Why a step at all, rather than pointing the site at the originals:
 *
 *   - The originals are 2.5MB PNG cut-outs. Astro resizes them for the browser,
 *     so visitors never download that — but every one of them is committed, and
 *     a repository that gains 2.5MB per player gets unpleasant quickly.
 *   - The site keys portraits on roster id. Matching on a filename would mean
 *     two players called Dinuth silently sharing a photo.
 *
 * Alpha is preserved: these are cut-outs, and the card draws them over the club
 * navy.
 */

import { readdir, mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = resolve(ROOT, 'src/assets/players');
const OUT = resolve(SOURCE, 'portraits');

/* The card is 4:5 and at most ~320 CSS px wide, so Astro's largest variant is
   640px. 800 leaves headroom for a bigger card later without carrying a file
   nothing can use. */
const WIDTH = 800;
const HEIGHT = 1200;
const QUALITY = 82;

const force = process.argv.includes('--force');

const roster = JSON.parse(await readFile(resolve(ROOT, 'config/players.json'), 'utf8')).players;

/**
 * Everything a photo for this player might plausibly be called.
 *
 * Surname is included because people name files both ways — "Demika.png" is as
 * likely as "Tharindu.png". Where a surname is shared (two Deerasooriyas, two
 * Dons) the match comes back ambiguous and the file is reported rather than
 * guessed at, which is the behaviour that matters.
 */
const keysFor = (p) => {
  const [first, ...rest] = p.name.split(/\s+/);
  const last = rest[rest.length - 1] ?? '';
  return new Set(
    [p.id, p.name, first, last, `${first} ${last}`, ...(p.aliases ?? [])]
      .filter(Boolean)
      .map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '')),
  );
};

const index = roster.filter((p) => p.active).map((p) => ({ player: p, keys: keysFor(p) }));

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function match(filename) {
  const key = norm(basename(filename, extname(filename)));
  const hits = index.filter((e) => e.keys.has(key));
  if (hits.length === 1) return { player: hits[0].player };
  if (hits.length > 1) return { ambiguous: hits.map((h) => h.player.name) };
  return {};
}

/**
 * A cut-out, framed to fill the card.
 *
 * Two things vary between the photos the club sends, and both used to show:
 *
 *   - How much empty space surrounds the subject. The LOC 1 cut-outs fill
 *     80-98% of their frame; the LOC 2 ones only 69-80%. Resizing the frame
 *     rather than the person meant the emptier photos rendered a smaller
 *     player, for no reason a reader could see.
 *   - The frame's shape. Six arrive 1024x1536, which is already 2:3, but
 *     Malith Kanahara's is 1166x1349. Fitted whole into 2:3 he was limited by
 *     his width and came out 275px short of the frame — visibly shorter than
 *     the team-mates beside him.
 *
 * So the subject is measured first and then sized to the card, rather than the
 * file being sized to the card. Height always fills: everyone stands the same
 * height on their card whatever the source. Width is centred, padded when the
 * subject is narrower than 2:3 — which is most people — and cropped when wider,
 * because a person cannot be made narrower and an arm's width costs less than
 * the height does.
 */
async function toPortrait(src) {
  const trimmed = await sharp(src).trim({ threshold: 1 }).toBuffer().catch(() => null);
  const base = sharp(trimmed ?? (await sharp(src).toBuffer()));

  const tall = await base.resize({ height: HEIGHT, fit: 'inside', withoutEnlargement: false }).toBuffer();
  const { width } = await sharp(tall).metadata();

  const framed =
    width > WIDTH
      ? sharp(tall).extract({ left: Math.round((width - WIDTH) / 2), top: 0, width: WIDTH, height: HEIGHT })
      : sharp(tall).extend({
          left: Math.floor((WIDTH - width) / 2),
          right: Math.ceil((WIDTH - width) / 2),
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        });

  return framed.webp({ quality: QUALITY, alphaQuality: 90 }).toBuffer();
}

const teams = (await readdir(SOURCE, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && d.name !== 'portraits')
  .map((d) => d.name);

await mkdir(OUT, { recursive: true });

const done = [];
const skipped = [];
const unmatched = [];
let savedBytes = 0;

for (const team of teams) {
  const dir = resolve(SOURCE, team);
  for (const file of (await readdir(dir)).sort()) {
    if (!/\.(png|jpe?g|webp|avif|tiff?)$/i.test(file)) continue;

    const { player, ambiguous } = match(file);

    if (ambiguous) {
      unmatched.push(`${team}/${file} — matches ${ambiguous.join(' and ')}; rename it to the roster id`);
      continue;
    }
    if (!player) {
      unmatched.push(`${team}/${file} — no player in config/players.json answers to this name`);
      continue;
    }

    const src = resolve(dir, file);
    const dest = resolve(OUT, `${player.id}.webp`);

    if (!force && existsSync(dest) && (await stat(dest)).mtimeMs >= (await stat(src)).mtimeMs) {
      skipped.push(player.name);
      continue;
    }

    const before = (await stat(src)).size;
    const buf = await toPortrait(src);
    await writeFile(dest, buf);

    savedBytes += before - buf.length;
    done.push({
      name: player.name,
      id: player.id,
      from: `${team}/${file}`,
      before,
      after: buf.length,
    });
  }
}

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

if (done.length) {
  console.log(`\n  optimised ${done.length} portrait(s):\n`);
  for (const d of done) {
    console.log(
      `    ${d.name.padEnd(24)} ${mb(d.before).padStart(8)} -> ${mb(d.after).padStart(8)}` +
        `   ${d.id}.webp`,
    );
  }
  console.log(`\n  saved ${mb(savedBytes)}`);
}
if (skipped.length) console.log(`\n  unchanged: ${skipped.join(', ')}`);
if (unmatched.length) {
  console.log(`\n  ${unmatched.length} file(s) not used:`);
  for (const u of unmatched) console.log(`    · ${u}`);
}

const withPhoto = new Set(done.map((d) => d.id));
const missing = index
  .filter((e) => !existsSync(resolve(OUT, `${e.player.id}.webp`)) && !withPhoto.has(e.player.id))
  .map((e) => e.player.name);
if (missing.length) {
  console.log(`\n  ${missing.length} player(s) still without a photo:`);
  console.log(`    ${missing.join(', ')}`);
}
console.log();
