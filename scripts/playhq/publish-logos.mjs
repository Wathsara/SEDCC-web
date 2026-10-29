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
 */

import { readdir, mkdir, copyFile, stat, unlink, readFile } from 'node:fs/promises';
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

/** Same bytes? Cheap check first, so a rebuild copies nothing. */
const same = async (a, b) => {
  try {
    const [sa, sb] = await Promise.all([stat(a), stat(b)]);
    if (sa.size !== sb.size) return false;
    const [ba, bb] = await Promise.all([readFile(a), readFile(b)]);
    return ba.equals(bb);
  } catch {
    return false;
  }
};

let copied = 0;
for (const name of source) {
  const from = join(FROM, name);
  const to = join(TO, name);
  if (await same(from, to)) continue;
  await copyFile(from, to);
  copied++;
}

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
