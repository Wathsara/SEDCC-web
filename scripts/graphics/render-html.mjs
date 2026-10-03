/**
 * Render an HTML match-summary design to PNG.
 *
 *   node scripts/graphics/render-html.mjs graphics/match-summary/LOC1.html out.png
 *   node scripts/graphics/render-html.mjs graphics/match-summary/LOC1.html out.png 1080 1350
 *
 * The designs use the Tailwind CDN and Google Fonts, so the page needs a real
 * browser and a network connection. We wait for fonts to settle before
 * capturing — screenshotting too early gives you fallback typography, which is
 * the usual reason these come out looking wrong.
 *
 * Chromium: puppeteer's bundled build is x86-64 only, so on ARM (and in this
 * devcontainer) point CHROME_PATH at a system install. On macOS the bundled
 * one works and CHROME_PATH can be left unset.
 */
import puppeteer from 'puppeteer';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const [, , input, output, dataArg, sizeArg, scaleArg] = process.argv;
if (!input || !output) {
  console.error(
    'usage: node scripts/graphics/render-html.mjs <design.html> <out.png> [data.json] [WxH] [scale]\n' +
      '  size  default 1080x1080 — these designs are square; see the note below\n' +
      '        1080x1350 is the 4:5 Facebook/Instagram feed size, 1080x1920 stories\n' +
      '  scale default 2 — renders at twice the size so it survives their recompression',
  );
  process.exit(1);
}

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const [W, H] = (sizeArg ?? '1080x1080').split('x').map(Number);
const SCALE = Number(scaleArg) || 2;

/**
 * The designs were laid out at 1200x1200. Two things follow from that:
 *
 *  - Rendering narrower than 1200 makes the flex rows distribute space
 *    differently, which is why a 1080-wide render looked loose around the
 *    score. So always lay out at 1200 and scale the result down.
 *
 *  - The canvas is `justify-content: space-between`, so giving it more height
 *    than the content needs opens gaps in the middle rather than filling. A
 *    4:5 canvas therefore looks emptier than the square one it was drawn for.
 *    Ask for a taller ratio and you get a warning, not a surprise.
 */
const DESIGN_W = 1200;
const DESIGN_H = 1200;
const layoutW = DESIGN_W;
const layoutH = Math.round((H / W) * layoutW);
const outScale = (W / layoutW) * SCALE;

if (Math.abs(layoutH - DESIGN_H) > 40) {
  console.warn(
    `  note: these designs are square (${DESIGN_W}x${DESIGN_H}). Laying them out at ` +
      `${layoutW}x${layoutH} for a ${W}x${H} output spreads the rows apart. ` +
      `Use 1080x1080 to match the design, or adjust the design for 4:5.`,
  );
}

/**
 * Values are injected into elements carrying data-field, so the design and the
 * data stay separate — nothing is string-replaced in the markup, and a field
 * the design does not have is reported rather than silently dropped.
 */
let fields = null;
if (dataArg) {
  const { readFile } = await import('node:fs/promises');
  fields = JSON.parse(await readFile(resolve(dataArg), 'utf8'));
}

const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));

const browser = await puppeteer.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});

try {
  const page = await browser.newPage();
  // 2x for a crisp result on retina and on social, which re-compresses hard.
  await page.setViewport({ width: layoutW, height: layoutH, deviceScaleFactor: outScale });

  await page.goto(`file://${resolve(input)}`, { waitUntil: 'networkidle0', timeout: 60_000 });

  if (fields) {
    // The toss badge is authored on innings 1, but the toss is won by whoever
    // won it — often the side batting second. Move it rather than leave the
    // designs claiming the wrong team called correctly.
    await page.evaluate((data) => {
      const badge = document.querySelector('[data-toss="i1"]');
      if (!badge) return;
      const value = (key) => {
        const v = data[`${key}.toss`];
        return typeof v === 'string' ? v.trim() : '';
      };

      if (value('i2') && !value('i1')) {
        // Re-key the badge and move it alongside the innings-2 team name, in
        // the same slot its innings-1 twin occupies.
        const field = badge.querySelector('[data-field="i1.toss"]');
        if (field) {
          field.setAttribute('data-field', 'i2.toss');
          field.textContent = value('i2');
        }
        badge.setAttribute('data-toss', 'i2');
        // Find the pill structurally, not by class name: the designs do not
        // agree on one (LOC2 has no .white-pill-card). The innings-2 team and
        // score always share it, so their common ancestor is the pill.
        const team = document.querySelector('[data-field="i2.team"]');
        const score = document.querySelector('[data-field="i2.score"]');
        let pill = team;
        while (pill && !(score && pill.contains(score))) pill = pill.parentElement;
        if (pill && team) {
          // Sit directly after whichever direct child of the pill holds the name.
          let anchor = team;
          while (anchor.parentElement && anchor.parentElement !== pill) {
            anchor = anchor.parentElement;
          }
          anchor.after(badge);
        }
      } else if (!value('i1')) {
        badge.style.display = 'none';
      }
    }, fields);

    const missing = await page.evaluate((f) => {
      const gone = [];
      for (const [k, v] of Object.entries(f)) {
        if (k.startsWith('_')) continue;
        // Directives, not text: they steer the render rather than name a slot
        // in the design, so their absence from the markup is not a mistake.
        if (k === 'player.photo') continue;
        const el = document.querySelector(`[data-field="${k}"]`);
        // An empty value is a deliberate "we do not know this" — an unrecorded
        // over count, the losing side's toss badge. Remove the slot rather
        // than leave the design's own placeholder standing in for real data.
        if (typeof v === 'string' && v.trim() === '') {
          if (el) {
            el.textContent = '';
            // A scorecard row takes its whole line with it, bullet and all,
            // but keeps its space so the panels stay the same height. Fields
            // inside the score pill only remove themselves — their nearest
            // div is the pill, and hiding that would take the innings with it.
            const row = /\.(bat|bowl)\.\d+\./.test(k) ? el.closest('div') : null;
            if (row) row.style.visibility = 'hidden';
            else el.style.display = 'none';
          }
          continue;
        }
        if (!el) { gone.push(k); continue; }
        el.textContent = String(v);
      }
      // Rows the match did not fill (a side bowled out for 40 with two bowlers)
      // are hidden rather than left showing the design's placeholder text.
      //
      // Only a scorecard row may take its whole line with it. Everything else
      // hides just itself: the round, date and venue share one line, so hiding
      // the closest div for a missing date used to erase all three.
      for (const el of document.querySelectorAll('[data-field]')) {
        const k = el.getAttribute('data-field');
        if (k in f) continue;
        const row = /\.(bat|bowl)\.\d+\./.test(k) ? el.closest('div') : null;
        (row ?? el).style.setProperty('visibility', 'hidden');
      }
      return gone;
    }, fields);
    if (missing.length) {
      console.warn('  fields not found in this design:', missing.join(', '));
    }
  }

  // Crests. PlayHQ returns no team logos, so the club's own crest goes to
  // whichever innings is ours and the opponent gets a monogram built from
  // their name — the same fallback the site's match cards use.
  if (fields) {
    const { readFile: rf } = await import('node:fs/promises');
    let clubCrest = null;
    try {
      const buf = await rf(resolve('src/assets/crest.jpg'));
      clubCrest = `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch {
      console.warn('  src/assets/crest.jpg not found — club crest slot left as a monogram');
    }

    // Opponent crests, cached from PlayHQ by the sync. A real crest beats a
    // monogram tile, so the tile becomes the fallback rather than the default.
    const crests = {};
    try {
      const { readFile: rf } = await import('node:fs/promises');
      const dataDir = resolve(ROOT_DIR, process.env.PLAYHQ_DATA_DIR ?? 'data/playhq');
      const index = JSON.parse(await rf(resolve(dataDir, 'logos.json'), 'utf8'));
      for (const entry of Object.values(index.logos ?? {})) {
        const path = resolve(ROOT_DIR, entry.file);
        if (!existsSync(path)) continue;
        const buf = await rf(path);
        const ext = entry.file.split('.').pop().toLowerCase();
        const mime = ext === 'svg' ? 'svg+xml' : ext === 'jpg' ? 'jpeg' : ext;
        crests[entry.matchKey] = `data:image/${mime};base64,${buf.toString('base64')}`;
      }
    } catch {
      // No logos.json yet — every opponent falls back to a monogram.
    }

    await page.evaluate(
      ({ clubCrest, clubMatch, crests }) => {
        const monogram = (name) =>
          String(name || '')
            .replace(/\s*-\s*\d+$/, '')
            .replace(/\b(CC|SC|CRICKET|CLUB|GRADE.*)\b/gi, '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0].toUpperCase())
            .join('');

        for (const slot of document.querySelectorAll('[data-crest]')) {
          const key = slot.getAttribute('data-crest');
          const teamEl = document.querySelector(`[data-field="${key}.team"]`);
          const name = teamEl ? teamEl.textContent.trim() : '';
          const ours = new RegExp(clubMatch, 'i').test(name);

          // The slot is a bare flex box; the child div carries the size. Fill
          // that, not the slot, or the crest has no dimensions to fit into.
          const wrap = slot.querySelector(':scope > div') || slot;

          // Same reduction the sync writes, so "Melbourne Crickeroos CC - 4"
          // finds the crest filed under "Melbourne Crickeroos CC".
          const crestKey = String(name || '')
            .toLowerCase()
            .replace(/\s*-\s*\d+\s*$/, ' ')
            .replace(/\b\d+\s*(st|nd|rd|th)\s*xi\b/g, ' ')
            .replace(/\bxi\b/g, ' ')
            .replace(/\b(cc|sc|cricket|club|senior|seniors|men|women|grade\s*\d*\w*)\b/g, ' ')
            .replace(/[^a-z0-9]/g, '');
          const theirs = crests[crestKey];

          if (ours && clubCrest) {
            wrap.innerHTML =
              `<img src="${clubCrest}" alt="${name}" ` +
              `style="max-width:100%;max-height:100%;width:100%;height:100%;` +
              `object-fit:contain;border-radius:8px;display:block">`;
          } else if (theirs) {
            wrap.innerHTML =
              `<img src="${theirs}" alt="${name}" ` +
              `style="max-width:100%;max-height:100%;width:100%;height:100%;` +
              `object-fit:contain;border-radius:8px;display:block">`;
          } else {
            // Initials on a plain tile: legible, and honest about the fact we
            // do not hold that club's artwork.
            wrap.innerHTML =
              `<div style="width:100%;height:100%;display:flex;flex-direction:column;` +
              `align-items:center;justify-content:center;border:1px solid currentColor;` +
              `border-radius:8px;opacity:.85;line-height:1">` +
              `<span style="font-weight:900;font-size:1.5em;letter-spacing:.02em">` +
              `${monogram(name)}</span></div>`;
          }
        }
      },
      { clubCrest, clubMatch: 'dreamers', crests },
    );

  }

  // Numeric columns: line the digits up.
  //
  // The runs column is right-aligned, so a not-out asterisk takes the rightmost
  // slot and shoves its digits left — "61*" and "12*" sit a character left of
  // "46" and the column stops reading as a column. Give every other value in
  // the same column an invisible asterisk so they all end the same width, and
  // ask for tabular figures so a 1 occupies the same space as a 4.
  if (fields) {
    await page.evaluate(() => {
      // Both innings blocks sit in the same column, one above the other, so the
      // decision has to be made across the whole card. Deciding per innings is
      // what left the first innings' runs out of line with the second's the
      // moment only one of them contained a not-out batter.
      const groups = [
        ['i1', 'i2'].flatMap((inn) => [0, 1, 2].map((n) => `${inn}.bat.${n}.runs`)),
        ['i1', 'i2'].flatMap((inn) => [0, 1, 2].map((n) => `${inn}.bowl.${n}.figures`)),
      ];

      for (const keys of groups) {
        const els = keys
          .map((k) => document.querySelector(`[data-field="${k}"]`))
          .filter((el) => el && el.getClientRects().length);
        if (!els.length) continue;

        for (const el of els) el.style.fontVariantNumeric = 'tabular-nums';

        const marked = els.filter((el) => el.textContent.trim().endsWith('*'));
        if (!marked.length || marked.length === els.length) continue;

        for (const el of els) {
          if (el.textContent.trim().endsWith('*')) continue;
          const pad = document.createElement('span');
          pad.style.visibility = 'hidden';
          pad.setAttribute('aria-hidden', 'true');
          pad.textContent = '*';
          el.appendChild(pad);
        }
      }
    });
  }

  // A panel with nothing to show is removed outright. The MVP posters pair a
  // batting half with a bowling half, and a batter who did not bowl would
  // otherwise leave a "BOWLING" heading standing over an empty box — which
  // reads as figures of 0/0 rather than as "did not bowl".
  if (fields) {
    await page.evaluate((data) => {
      const empty = (k) => {
        const v = data[k];
        return v === undefined || (typeof v === 'string' && v.trim() === '');
      };
      for (const panel of document.querySelectorAll('[data-panel]')) {
        const key = panel.getAttribute('data-panel');
        const owned = [...panel.querySelectorAll('[data-field]')].map((el) =>
          el.getAttribute('data-field'),
        );
        if (!owned.length || !owned.every(empty)) continue;

        panel.remove();

        // Take the rule that divided it with it. A hairline beside nothing is
        // more conspicuous than the panel it used to separate.
        for (const rule of document.querySelectorAll(`[data-divider-for="${key}"]`)) {
          rule.remove();
        }
      }

      // A rule only earns its place between two panels. Removing the first
      // panel leaves its successor's divider leading the row.
      for (const row of document.querySelectorAll('[data-stat-row], [data-stat-grid]')) {
        const kids = [...row.children];
        while (kids.length && kids[0].hasAttribute('data-divider-for')) {
          kids.shift().remove();
        }
      }
      for (const rule of document.querySelectorAll('[data-divider-for]')) {
        const prev = rule.previousElementSibling;
        if (!prev || prev.hasAttribute('data-divider-for')) rule.remove();
      }

      // Tailwind's divide-* draws its rule with a border on every child after
      // the first, so a two-column grid left with one child keeps no rule —
      // but the grid still reserves two columns. Collapse it to what is left.
      for (const el of document.querySelectorAll('[data-stat-grid], [class*="grid-cols-"]')) {
        const n = el.children.length;
        if (!n || n > 3) continue;
        for (const c of ['grid-cols-1', 'grid-cols-2', 'grid-cols-3']) el.classList.remove(c);
        el.classList.add(`grid-cols-${n}`);
      }
    }, fields);
  }

  // Player photo. Kept out of the templates deliberately: the club maintains a
  // folder of cut-out player images, and the card picks the one matching the
  // player named on it. A missing photo leaves the design's own placeholder
  // rather than a broken image — better a stand-in than a hole in the poster.
  if (fields && (fields['player.first'] || fields['player.last'] || fields['player.photo'])) {
    const slug = [fields['player.first'], fields['player.last']]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const dir = process.env.PLAYER_PHOTO_DIR ?? 'graphics/mvp/players';

    // An explicit path wins. It is how the caller says "use this image" without
    // the file having to be named after the player — the club keeps one photo
    // per squad position today, not one per person.
    const candidates = fields['player.photo']
      ? [resolve(ROOT_DIR, fields['player.photo'])]
      : ['png', 'webp', 'jpg', 'jpeg'].map((ext) => resolve(dir, `${slug}.${ext}`));

    let photo = null;
    for (const candidate of candidates) {
      const ext = candidate.split('.').pop().toLowerCase();
      if (existsSync(candidate)) {
        const { readFile: rf } = await import('node:fs/promises');
        const buf = await rf(candidate);
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        photo = `data:image/${mime};base64,${buf.toString('base64')}`;
        console.log(`  player photo: ${candidate}`);
        break;
      }
    }
    if (!photo) {
      console.warn(
        fields['player.photo']
          ? `  player photo not found: ${fields['player.photo']} — design placeholder kept`
          : `  no player photo for "${slug}" in ${dir}/ — design placeholder kept`,
      );
    }

    if (photo) {
      await page.evaluate((src) => {
        for (const el of document.querySelectorAll('[data-photo="player"]')) {
          el.setAttribute('src', src);
          el.removeAttribute('srcset');
        }
      }, photo);
    }
  }

  // Drop the player clear of the stat block.
  //
  // The photo is bottom-anchored in a fixed frame, so how far up the player
  // reaches depends on the cut-out's own proportions — a taller crop puts the
  // head behind the stats. Rather than guess an offset per template, measure
  // where the stat block actually ends and lower the frame's top edge until the
  // head clears it.
  //
  // Only the top moves. Shifting the whole frame down keeps the player's size
  // but drags their torso into the footer, where the scrim is nearly
  // transparent — gold type over a white sleeve. Raising the floor instead
  // costs a little height and leaves everything below exactly as designed.
  await page.evaluate(async (clearance) => {
    const layer = document.querySelector('.player-image-layer');
    const stats = document.querySelector('[data-statblock]');
    const img = layer && layer.querySelector('[data-photo="player"]');
    if (!layer || !stats || !img) return;
    if (img.naturalWidth === 0) await img.decode().catch(() => {});
    if (img.naturalWidth === 0) return;

    // Where the player actually begins, not where their file does. A cut-out
    // usually carries transparent space above the head, and how much varies
    // per photo — measuring the element's box would move a well-cropped image
    // too far and a padded one not far enough.
    const headRow = (() => {
      const c = document.createElement('canvas');
      const w = Math.min(img.naturalWidth, 200);
      const h = Math.round((img.naturalHeight / img.naturalWidth) * w);
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      let px;
      try {
        px = ctx.getImageData(0, 0, w, h).data;
      } catch {
        return 0; // tainted canvas; fall back to the element's own top edge
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (px[(y * w + x) * 4 + 3] > 24) return y / h;
        }
      }
      return 0;
    })();

    // Frame height and image height are not in step — the image is capped by
    // its natural size until the frame is smaller than that — so converge
    // rather than assuming one pass lands it.
    for (let pass = 0; pass < 12; pass++) {
      const box = img.getBoundingClientRect();
      const visibleTop = box.top + headRow * box.height;
      const need = stats.getBoundingClientRect().bottom + clearance - visibleTop;
      if (need <= 0.5) break;
      layer.style.top = `${parseFloat(getComputedStyle(layer).top || 0) + need}px`;
    }
  }, 10);

  // Type fitting lives in scripts/graphics/fit.js so the sizing rules can be
  // tuned without touching the renderer.
  if (fields) {
    const { readFile } = await import('node:fs/promises');
    const fitSrc = await readFile(
      new URL('./fit.js', import.meta.url),
      'utf8',
    );
    await page.addScriptTag({ content: fitSrc });
    const applied = await page.evaluate(() => window.__fitMatchSummary());
    const scaled = applied.filter((a) => a.scaled);
    console.log(
      scaled.length
        ? '  type fitted: ' +
            scaled.map((f) => `${f.field} ${f.len}ch ${f.base}->${f.size}px`).join(', ')
        : '  type fitted: nothing needed shrinking',
    );
    const forced = applied.filter((a) => a.forced);
    if (forced.length) {
      console.warn(
        '  measured shrink needed (SCALE table may want tuning): ' +
          forced.map((f) => `${f.field} ${f.len}ch ${f.base}->${f.size}px`).join(', '),
      );
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  // Tailwind's CDN build and the webfonts both land after load.
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 600));

  // Capture the design itself rather than the viewport, so the black page
  // background and any centring wrapper are not baked into the image.
  // Capture the viewport by default: the match-summary designs fill 100vw/100vh,
  // so this guarantees the exact aspect ratio asked for rather than whatever the
  // content happens to measure. A design that is a fixed-width card centred on
  // the page — the MVP posters — marks itself [data-capture] and is cropped to
  // its own box instead, so the page background is not baked in around it.
  const opted = await page.$('[data-capture]');
  if (opted) {
    // A fixed-width card does not grow with the viewport, so capturing it at
    // the viewport's scale would return the card's own pixel size and quietly
    // ignore the size asked for. Rescale to the requested width instead.
    const cssWidth = await opted.evaluate((el) => el.getBoundingClientRect().width);
    const factor = (W * SCALE) / cssWidth;
    await page.setViewport({
      width: layoutW,
      height: layoutH,
      deviceScaleFactor: Math.min(Math.max(factor, 0.1), 8),
    });
    await new Promise((r) => setTimeout(r, 200));
    const el = await page.$('[data-capture]');

    // Clip to a box derived from the requested aspect rather than from the
    // element's measured height. Screenshotting the element directly rounds
    // its height independently of its width, which lands a pixel out — 2701
    // instead of 2700 — and a poster meant for a platform with a fixed aspect
    // should arrive at exactly the size asked for.
    const rect = await el.evaluate((n) => {
      const b = n.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width };
    });
    // Work back from the exact device-pixel target. Chromium sizes the capture
    // surface with ceil(cssLength * deviceScaleFactor), so a clip that should
    // multiply out to 2700 lands on 2700.0000000000005 in floating point and
    // ceils to 2701. The epsilon keeps the product just under the integer.
    // Snap the origin to the device-pixel grid before sizing the box.
    //
    // The card is centred in the viewport and lands on fractional CSS offsets
    // (y = 328 at a scale of 3.2 is device row 1049.6). Chromium expands the
    // capture to whole device pixels at both edges, so a box of exactly the
    // right size straddles one extra row and the PNG comes out 2701 tall
    // instead of 2700 — a hair off the aspect a platform expects. Aligning the
    // origin first makes the requested size come out exact.
    const snap = (v) => Math.round(v * factor) / factor;
    const clip = {
      x: snap(rect.x),
      y: snap(rect.y),
      width: (W * SCALE) / factor,
      height: (H * SCALE) / factor,
    };
    const shot = await page.screenshot({ type: 'png', clip });

    // Guarantee the exact pixel size. Chromium expands a capture to whole
    // device pixels at both edges, so a correctly-sized clip on a fractional
    // offset still comes back a row taller. These posters are made for a
    // platform with a fixed aspect, so the last word belongs to a resize that
    // cannot be off by one — at most a sub-pixel rescale, never a crop.
    const { default: sharp } = await import('sharp');
    const target = { width: W * SCALE, height: H * SCALE };
    const meta = await sharp(shot).metadata();
    if (meta.width === target.width && meta.height === target.height) {
      await writeFile(resolve(output), shot);
    } else {
      await sharp(shot).resize(target.width, target.height, { fit: 'fill' }).png().toFile(resolve(output));
    }
    console.log(
      `wrote ${output} — captured the [data-capture] element, ` +
        `${target.width}x${target.height}` +
        (meta.width === target.width && meta.height === target.height
          ? ''
          : ` (normalised from ${meta.width}x${meta.height})`),
    );
  } else {
    await page.screenshot({ path: resolve(output), type: 'png' });
    console.log(
      `wrote ${output} — laid out at ${layoutW}x${layoutH}, output ${W * SCALE}x${H * SCALE}`,
    );
  }

} finally {
  await browser.close();
}
