/**
 * Mirror the cached crests into public/ so the built site can serve them.
 *
 *   npm run build   # runs automatically, via prebuild
 *   npm run dev     # likewise, via predev
 *
 * The sync writes crests to data/playhq/logos/. Astro only serves what is in
 * public/, so the two had to be kept in step by hand — and were not: the VSCA
 * clubs that arrived with the Grade 4 fixtures were written to data/ and never
 * copied, so every Grade 4 opponent rendered an empty circle. The crest tag
 * carries onerror="this.style.display='none'", which hides a 404 rather than
 * showing a broken image, so nothing about the page said it was missing.
 *
 * public/playhq/logos/ is therefore generated and not committed: data/ is the
 * one copy under version control, and this runs before every build.
 *
 * ## Why these are resized on the way across
 *
 * The sync fetches crests at 1024 square, because an association badge set
 * large on a 2160px poster came out soft at the 256 PlayHQ lists. The site has
 * the opposite need: the ladder draws a crest at 28px, and public/ is served
 * verbatim — Astro does not optimise what it finds there. Copying the
 * originals straight across put 17MB of artwork into dist/ to render icons,
 * the largest a 1.1MB PNG for a 28px circle. So data/ keeps the big ones for
 * the graphics scripts and the web gets a 128px copy, which still has room for
 * a 3x display.
 */

import { readdir, mkdir, copyFile, stat, unlink, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FROM = resolve(ROOT, process.env.PLAYHQ_DATA_DIR ?? 'data/playhq', 'logos');
const TO = resolve(ROOT, 'public/playhq/logos');

if (!existsSync(FROM)) {
  // A clone that has never synced still builds; the crest slots fall back to
  // the monogram tile the components already draw.
  console.log('playhq: no cached crests to publish');
  process.exit(0);
}

await mkdir(TO, { recursive: true });

const source = (await readdir(FROM)).filter((f) => !f.startsWith('.'));
const published = existsSync(TO) ? (await readdir(TO)).filter((f) => !f.startsWith('.')) : [];

/** The widest a crest is ever drawn on the site, times three for the display. */
const WEB_SIZE = 128;

/*
  The published file is no longer a copy of the source, so "are the bytes the
  same" cannot answer whether it is current. The source's size and mtime are
  recorded instead, and a crest is re-rendered only when one of them moves.
  The name starts with a dot, so it is skipped by both readdir filters and
  never published or swept.
*/
const STAMP = join(TO, '.sources.json');
let stamps = {};
try {
  stamps = JSON.parse(await readFile(STAMP, 'utf8'));
} catch {
  // No stamp file, or an unreadable one: everything is rendered again.
}

const next = {};
let copied = 0;
for (const name of source) {
  const from = join(FROM, name);
  const to = join(TO, name);
  const { size, mtimeMs } = await stat(from);
  next[name] = `${size}:${mtimeMs}`;

  if (stamps[name] === next[name] && existsSync(to)) continue;

  // An SVG is already resolution-free, and rasterising one would lose that.
  if (name.toLowerCase().endsWith('.svg')) {
    await copyFile(from, to);
  } else {
    /*
      `fit: 'inside'` with `withoutEnlargement` keeps the aspect ratio and
      never scales a small crest up — a club that only ever had a 96px logo
      stays at 96px rather than being blown up and re-compressed.
    */
    await sharp(from)
      .resize({ width: WEB_SIZE, height: WEB_SIZE, fit: 'inside', withoutEnlargement: true })
      .toFile(to);
  }
  copied++;
}

await writeFile(STAMP, `${JSON.stringify(next, null, 2)}\n`);

// A club that leaves the data — renamed, or dropped when a season rolls over —
// should not leave its crest behind to be served for ever.
let removed = 0;
for (const name of published) {
  if (source.includes(name)) continue;
  await unlink(join(TO, name));
  removed++;
}

console.log(
  `playhq: ${source.length} crest(s) published` +
    (copied ? `, ${copied} updated` : '') +
    (removed ? `, ${removed} removed` : ''),
);
