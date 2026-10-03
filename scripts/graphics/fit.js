/**
 * Type fitting for the match-summary designs. Runs inside the page.
 *
 * These graphics are generated unattended, so the sizing has to be predictable
 * rather than "whatever happened to fit". A value is measured in place first:
 * if it already fits its row with room to spare, it is LEFT ALONE at the size
 * the design gave it. Only when it genuinely collides is it stepped down, and
 * then by a fixed table keyed on character count, so the same name always
 * lands on the same size. A shrunk name next to a full-size one, with empty
 * space around both, is the bug this ordering exists to prevent.
 *
 * Tune SCALE below. Each entry is [max characters, multiplier of the design's
 * own font size].
 */
window.__fitMatchSummary = function fit() {
  const SCALE = [
    [12, 1.0],
    [16, 0.92],
    [20, 0.84],
    [24, 0.76],
    [30, 0.68],
    [Infinity, 0.6],
  ];

  /** Minimum breathing space between items sharing a row, in px. */
  const GAP = 14;

  /** Never go below this, whatever the length. */
  const MIN_PX = 13;

  /**
   * Values that read as one phrase rather than as two items sharing a row.
   * A first and last name want a single space between them; the GAP rule that
   * keeps a team name off its score would drive them apart, and since no font
   * size can satisfy it the name shrinks to the minimum instead.
   */
  const PHRASES = [['player.first', 'player.last']];
  const samePhrase = (a, b) => {
    const ka = a.getAttribute('data-field');
    const kb = b.getAttribute('data-field');
    if (!ka || !kb) return false;
    return PHRASES.some((g) => g.includes(ka) && g.includes(kb));
  };

  /**
   * Clear space to leave between a value and the edge of the card, in px.
   * "Inside the card" is not the same as "looks inside the card": a name
   * ending 2px from the boundary reads as clipped even though it is not.
   */
  const EDGE = 18;

  const scaleFor = (len) => SCALE.find(([max]) => len <= max)[1];
  const q = (k) => document.querySelector(`[data-field="${k}"]`);

  // Long fields paired with the value they share a row with.
  const pairs = [
    ['header.away', 'header.home'],
    // MVP posters: the player's name is the one value that can outgrow the card.
    // Deliberately unpaired. First and last name are two words of one heading
    // separated by a space, not two items sharing a row — demanding GAP px
    // between them is a condition no font size can satisfy, and it drove the
    // name to the minimum every time.
    ['player.last', null],
    ['player.first', null],
    ['player.watermark', null],
    ['meta.opponent', null],
  ];
  for (const i of ['i1', 'i2']) {
    pairs.push([`${i}.team`, `${i}.score`]);
    for (let n = 0; n < 3; n++) {
      pairs.push([`${i}.bat.${n}.name`, `${i}.bat.${n}.runs`]);
      pairs.push([`${i}.bowl.${n}.name`, `${i}.bowl.${n}.figures`]);
    }
  }

  // Nothing breaks mid-value.
  for (const el of document.querySelectorAll('[data-field]')) {
    el.style.whiteSpace = 'nowrap';
  }

  const commonAncestor = (a, b) => {
    for (let n = a; n; n = n.parentElement) if (n.contains(b)) return n;
    return null;
  };

  /**
   * Does this value sit inside its row without touching anything beside it?
   *
   * Geometry, not scrollWidth alone: a flex row whose child overflows with
   * overflow:visible does not always report a larger scrollWidth, so the
   * element rectangles are checked directly.
   *
   * Crucially the clearance is measured against EVERY item on the row, not
   * just the value this field is paired with. A team name is paired with the
   * score, but what actually sits next to it is the overs — or the toss badge.
   * Guarding the wrong neighbour lets a long name run up against a near one.
   */
  const sideBySide = (a, b) =>
    Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) <
    Math.max(a.height, b.height) / 2;

  /**
   * The card's own content box. A row that sizes itself to its contents — the
   * teams headline does — can never report an overflow, so staying inside the
   * row is not proof of anything. Staying inside the card is.
   */
  const cardBox = (() => {
    // .match-canvas for the match summaries, [data-capture] for the posters —
    // whichever element is the card, its content box is the real boundary.
    const c = document.querySelector('.match-canvas') || document.querySelector('[data-capture]');
    if (!c) return null;
    const b = c.getBoundingClientRect();
    const cs = getComputedStyle(c);
    return {
      left: b.left + parseFloat(cs.paddingLeft || 0) + EDGE,
      right: b.right - parseFloat(cs.paddingRight || 0) - EDGE,
    };
  })();

  const insideCard = (b) =>
    !cardBox || (b.left >= cardBox.left - 1 && b.right <= cardBox.right + 1);

  const fits = (el, other, row) => {
    if (!row) return true;
    const rb = row.getBoundingClientRect();
    const eb = el.getBoundingClientRect();
    if (eb.right > rb.right + 1 || eb.left < rb.left - 1) return false;
    if (!insideCard(eb)) return false;

    // A nowrap value gives its container a hard minimum width, and the damage
    // can land somewhere else entirely — the headline pushing the sponsor logo
    // off the card. So walk up looking for an ancestor left overflowing.
    //
    // But an overflow further up is not automatically this field's fault: the
    // batting and bowling columns share ancestors, and a long bowler's name
    // would otherwise convict the batter's. So test causality directly — hide
    // this value, and see whether the overflow goes with it.
    for (let n = el.parentElement; n && !n.classList.contains('match-canvas'); n = n.parentElement) {
      if (n.scrollWidth <= n.clientWidth + 1) continue;
      const was = el.style.display;
      el.style.display = 'none';
      const persists = n.scrollWidth > n.clientWidth + 1;
      el.style.display = was;
      if (!persists) return false;
    }

    // Everything sharing this line, left to right. Shrinking the one long
    // value is what buys space for the whole row, so the whole row is what
    // gets judged — a cramped overs/score pair is this field's problem too.
    const candidates = [...row.querySelectorAll('[data-field], [data-toss]')].filter(
      (n) => n === el || (!n.contains(el) && !el.contains(n)),
    );
    const line = candidates
      // Keep the outermost of any nested pair. The toss badge wraps its own
      // [data-field]; counting both makes them each other's neighbour with a
      // negative gap, which no amount of shrinking can ever satisfy.
      .filter((n) => n === el || !candidates.some((m) => m !== n && m.contains(n)))
      .map((n) => ({ n, b: n.getBoundingClientRect() }))
      .filter((x) => x.b.width && (x.n === el || sideBySide(eb, x.b)))
      .sort((a, z) => a.b.left - z.b.left);
    if (other && !line.some((x) => x.n === other)) {
      const ob = other.getBoundingClientRect();
      if (ob.width && sideBySide(eb, ob)) line.push({ n: other, b: ob });
    }

    for (const { b } of line) {
      if (b.right > rb.right + 1 || b.left < rb.left - 1) return false;
      if (!insideCard(b)) return false;
    }
    for (let i = 1; i < line.length; i++) {
      if (samePhrase(line[i - 1].n, line[i].n)) continue;
      if (line[i].b.left - line[i - 1].b.right < GAP) return false;
    }
    return row.scrollWidth <= row.clientWidth + 1;
  };

  const applied = [];

  /**
   * A phrase is sized as one unit: every part gets the SAME size, stepped down
   * together until the whole thing fits.
   *
   * Fitting the parts independently produced two different sizes for one name
   * — whichever half was measured first absorbed the entire shrink, and the
   * second then found the row already fitting and barely moved. Stepping in
   * lockstep finds the largest size the whole name can share.
   */
  const phraseFitted = new Set();
  for (const group of PHRASES) {
    const els = group
      .map((k) => q(k))
      .filter((el) => el && el.getClientRects().length);
    if (els.length < 2) continue;

    for (const el of els) phraseFitted.add(el.getAttribute('data-field'));

    const bases = els.map((el) => parseFloat(getComputedStyle(el).fontSize));
    const row = els[0].closest('h1, h2, p, div');
    let size = Math.round(Math.max(...bases));

    const ok = () => els.every((el) => fits(el, null, row));

    // Already right at the design's own size.
    for (const el of els) el.style.fontSize = `${size}px`;
    let guard = 60;
    while (!ok() && size > MIN_PX && guard-- > 0) {
      size -= 1;
      for (const el of els) el.style.fontSize = `${size}px`;
    }

    const changed = els.some((el, i) => Math.round(bases[i]) !== size);
    if (changed) {
      applied.push({
        field: group.join('+'),
        len: els.map((el) => (el.textContent || '').trim().length).reduce((a, b) => a + b, 0),
        base: Math.round(Math.max(...bases)),
        size,
        scaled: true,
        forced: false,
      });
    }
  }

  for (const [longKey, valueKey] of pairs) {
    if (phraseFitted.has(longKey)) continue;
    const el = q(longKey);
    const other = valueKey ? q(valueKey) : null;
    if (!el) continue;
    // A slot removed for want of data has no box to fit; measuring it only
    // produces nonsense sizes and noise in the log.
    if (!el.getClientRects().length) continue;

    const len = (el.textContent || '').trim().length;
    const base = parseFloat(getComputedStyle(el).fontSize);

    // 1. Reserve the row's breathing space first, so the fit test below is
    //    asked the real question: does it fit *and still look composed*.
    el.style.marginInlineEnd = `${GAP}px`;
    // With no partner, the element's own block is the row to stay inside.
    const row = other ? commonAncestor(el, other) : el.closest('h1, h2, p, div');
    if (row) {
      const cs = getComputedStyle(row);
      if (cs.display.includes('flex') && parseFloat(cs.columnGap || 0) < GAP) {
        row.style.columnGap = `${GAP}px`;
      }
    }

    // 2. If the design's own size already works, that is the answer. Shrinking
    //    a name that fits is what made one team read smaller than the other.
    if (fits(el, other, row)) {
      applied.push({ field: longKey, len, base: Math.round(base), size: Math.round(base), scaled: false, forced: false });
      continue;
    }

    // 3. It collides. Step down by character count — predictable, and the same
    //    name gets the same size on every card it appears on.
    let size = Math.max(MIN_PX, Math.round(base * scaleFor(len)));
    el.style.fontSize = `${size}px`;

    // 4. Safety net for the rare value the table does not cover.
    let guard = 24;
    while (!fits(el, other, row) && size > MIN_PX && guard-- > 0) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }

    // 5. Give back what the table over-charged. The table steps in coarse
    //    jumps, so a name that lands on 0.6x often has room to sit larger.
    //    Grow a pixel at a time while it still fits, never past the design's
    //    own size — so a long name is set as large as the row honestly allows.
    let grow = 24;
    while (size < base && grow-- > 0) {
      el.style.fontSize = `${size + 1}px`;
      if (!fits(el, other, row)) {
        el.style.fontSize = `${size}px`;
        break;
      }
      size += 1;
    }

    applied.push({ field: longKey, len, base: Math.round(base), size, scaled: true, forced: guard < 24 });
  }

  return applied;
};
