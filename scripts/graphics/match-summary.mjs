/**
 * Match summary graphic for social.
 *
 *   node scripts/graphics/match-summary.mjs sample.json out.png
 *
 * Reads the club name, colours and sponsors from config/club.json so the
 * graphic can never drift from the site. Everything else comes from the match
 * JSON you pass in — which is the same shape the PlayHQ sync already produces,
 * so this can be wired to run automatically after a game.
 *
 * Renders as SVG then composites the logos, because SVG gives precise type and
 * sharp gives clean image scaling.
 */
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const W = 1200;
const H = 1200;

// Fonts: the club faces if installed, otherwise whatever the machine has.
const DISPLAY = "'Oswald','Archivo Narrow','DejaVu Sans',sans-serif";
const BODY = "'Source Sans 3','DejaVu Sans',sans-serif";
const MONO = "'JetBrains Mono','DejaVu Sans Mono',monospace";

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Initials for a side with no crest, matching the site's match cards. */
const monogram = (name) =>
  String(name)
    .replace(/\s*-\s*\d+$/, '')
    .replace(/\bGrade\b.*$/i, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

function innings(side, y, c) {
  const rows = [];
  const bat = side.batting ?? [];
  const bowl = side.bowling ?? [];
  const lines = Math.max(bat.length, bowl.length);

  rows.push(`
    <rect x="60" y="${y}" width="${W - 120}" height="70" fill="${c.club}"/>
    <text x="146" y="${y + 46}" font-family=${JSON.stringify(DISPLAY)} font-size="38"
          font-weight="600" fill="${c.paper}" letter-spacing="1">${esc(side.name)}</text>
    <text x="${W - 260}" y="${y + 46}" font-family=${JSON.stringify(MONO)} font-size="24"
          fill="${c.chrome}" text-anchor="end">${esc(side.overs ?? '')}</text>
    <text x="${W - 90}" y="${y + 48}" font-family=${JSON.stringify(MONO)} font-size="40"
          font-weight="700" fill="${c.gold}" text-anchor="end">${esc(side.score)}</text>`);

  if (bat.length || bowl.length) {
    rows.push(`
      <text x="80" y="${y + 104}" font-family=${JSON.stringify(MONO)} font-size="16"
            fill="${c.faint}" letter-spacing="2">BATTING</text>
      <text x="${W / 2 + 20}" y="${y + 104}" font-family=${JSON.stringify(MONO)} font-size="16"
            fill="${c.faint}" letter-spacing="2">BOWLING</text>`);
  }

  for (let i = 0; i < lines; i++) {
    const ry = y + 142 + i * 40;
    const b = bat[i];
    const o = bowl[i];
    if (b) {
      rows.push(`
        <text x="80" y="${ry}" font-family=${JSON.stringify(BODY)} font-size="26"
              fill="${c.ink}">${esc(b.name)}</text>
        <text x="${W / 2 - 110}" y="${ry}" font-family=${JSON.stringify(MONO)} font-size="26"
              font-weight="700" fill="${c.ink}" text-anchor="end">${esc(b.runs)}</text>
        <text x="${W / 2 - 30}" y="${ry}" font-family=${JSON.stringify(MONO)} font-size="22"
              fill="${c.faint}" text-anchor="end">${esc(b.balls ?? '')}</text>`);
    }
    if (o) {
      rows.push(`
        <text x="${W / 2 + 20}" y="${ry}" font-family=${JSON.stringify(BODY)} font-size="26"
              fill="${c.ink}">${esc(o.name)}</text>
        <text x="${W - 90}" y="${ry}" font-family=${JSON.stringify(MONO)} font-size="26"
              font-weight="700" fill="${c.ink}" text-anchor="end">${esc(o.figures)}</text>`);
    }
  }
  return rows.join('');
}

export async function build(match, outPath) {
  const club = JSON.parse(await readFile(resolve(ROOT, 'config/club.json'), 'utf8'));

  const c = {
    club: club.brand.primary,
    chrome: club.brand.secondary,
    gold: '#dfb74c',
    paper: '#fbfbf9',
    ink: '#16181c',
    faint: '#8b9099',
    rule: '#d8d8d3',
  };

  const [first, second] = match.innings;

  // Blocks grow with their rows, so a card with one standout performance is not
  // mostly empty space.
  const TOP = 250;
  const rowsOf = (s) => Math.max((s.batting ?? []).length, (s.bowling ?? []).length);
  const blockH = (s) => 70 + (rowsOf(s) ? 74 + rowsOf(s) * 40 : 20) + 40;
  const STRIP_TOP = H - 130;                 // sponsor rule
  const resultY = STRIP_TOP - 130;           // banner sits just above it
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${c.paper}"/>

  <rect width="${W}" height="200" fill="${c.club}"/>
  <text x="${W / 2}" y="96" font-family=${JSON.stringify(DISPLAY)} font-size="62"
        font-weight="600" fill="${c.paper}" text-anchor="middle" letter-spacing="4">MATCH SUMMARY</text>
  <text x="${W / 2}" y="140" font-family=${JSON.stringify(BODY)} font-size="27"
        fill="${c.chrome}" text-anchor="middle">${esc(match.subtitle)}</text>
  <text x="${W / 2}" y="176" font-family=${JSON.stringify(MONO)} font-size="18"
        fill="${c.chrome}" text-anchor="middle" letter-spacing="2">${esc(match.meta)}</text>

  ${innings(first, TOP, c)}
  ${innings(second, TOP + blockH(first), c)}

  <rect x="60" y="${resultY}" width="${W - 120}" height="86" fill="${c.club}"/>
  <text x="${W / 2}" y="${resultY + 55}" font-family=${JSON.stringify(DISPLAY)} font-size="42"
        font-weight="600" fill="${c.gold}" text-anchor="middle"
        letter-spacing="2">${esc(match.result)}</text>

  <line x1="60" y1="${H - 130}" x2="${W - 60}" y2="${H - 130}" stroke="${c.rule}" stroke-width="1"/>
  <text x="${W / 2}" y="${H - 92}" font-family=${JSON.stringify(MONO)} font-size="16"
        fill="${c.faint}" text-anchor="middle" letter-spacing="3">PROUDLY SUPPORTED BY</text>
</svg>`;

  const base = sharp(Buffer.from(svg)).png();

  // ---- composite the club crest and the sponsor strip -----------------
  const layers = [];

  // Which side is us? Match on the club's own short name, not on position —
  // the club bats first in some games and second in others.
  const ours = (n) => n.toLowerCase().includes('dreamers');
  const crestBuf = await sharp(resolve(ROOT, 'src/assets/crest.jpg'))
    .resize(54, 54, { fit: 'cover' }).png().toBuffer();

  for (const [side, y] of [[first, TOP], [second, TOP + blockH(first)]]) {
    layers.push(
      ours(side.name)
        ? { input: crestBuf, left: 76, top: y + 8 }
        : {
            input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="54" height="54">
              <rect width="54" height="54" fill="${c.chrome}"/>
              <text x="27" y="36" font-family=${JSON.stringify(DISPLAY)} font-size="22"
                    fill="${c.club}" text-anchor="middle">${esc(monogram(side.name))}</text>
            </svg>`),
            left: 76,
            top: y + 8,
          },
    );
  }

  const sponsors = (club.sponsors?.list ?? []).filter((s) => s.logo);
  // Weight the slots: a featured sponsor gets 1.6x the width of the others,
  // which also stops a square badge reading smaller than a wordmark.
  const weights = sponsors.map((s) => (s.featured ? 1.6 : 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const usable = W - 160;
  let x = 80;
  for (let i = 0; i < sponsors.length; i++) {
    const slotW = Math.floor((usable * weights[i]) / total);
    const boxH = sponsors[i].featured ? 78 : 60;
    const logo = await sharp(resolve(ROOT, 'src/assets/sponsors', sponsors[i].logo))
      .resize(slotW - 20, boxH, { fit: 'inside', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer();
    const meta = await sharp(logo).metadata();
    layers.push({
      input: logo,
      left: x + Math.floor((slotW - meta.width) / 2),
      top: H - 88 + Math.floor((80 - meta.height) / 2),
    });
    x += slotW;
  }

  await base.composite(layers).toFile(outPath);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , dataPath, outPath] = process.argv;
  if (!dataPath || !outPath) {
    console.error('usage: node scripts/graphics/match-summary.mjs <match.json> <out.png>');
    process.exit(1);
  }
  console.log('wrote', await build(JSON.parse(await readFile(dataPath, 'utf8')), outPath));
}
