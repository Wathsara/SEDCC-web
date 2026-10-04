/**
 * Player names, as they go onto a card.
 *
 * PlayHQ's firstName/lastName split is not a given-name/surname split: a first
 * name is often several words — "Thisara Nilupul Lankathilake" arrives as
 * firstName "Thisara Nilupul" — and the whole string squeezes the scorecard
 * type down to nothing. So a long name is cut to a given name and a surname.
 *
 * Cutting to the *first* two words was wrong in both directions:
 *
 *   Dilhan Rahubadde Kankanange  ->  Dilhan Rahubadde   (kept a middle name,
 *                                                        dropped the surname)
 *   Santhuka De Silva            ->  Santhuka De        (cut the surname in half)
 *
 * The rule is first word + surname, where the surname is the last word plus any
 * particles leading into it. "De Silva", "van der Berg" and "bin Rashid" are one
 * surname each, not a surname with spare words in front of it.
 */

/**
 * Words that belong to the surname that follows them. Lower-cased on lookup,
 * so "De Silva" and "de Silva" behave the same.
 */
const PARTICLES = new Set([
  'de', 'del', 'della', 'der', 'den', 'da', 'das', 'dos', 'di', 'do', 'du',
  'van', 'von', 'ten', 'ter', 'la', 'le', 'el', 'al', 'bin', 'binti', 'ibn',
  'st', 'mac', 'mc',
]);

/**
 * Where the surname starts in `words`. Never index 0 — a one-word surname with
 * nothing before it is a first name, not a surname.
 */
const surnameStart = (words) => {
  let i = words.length - 1;
  while (i > 1 && PARTICLES.has(words[i - 1].toLowerCase())) i--;
  return i;
};

/** "Dilhan Rahubadde Kankanange" -> "Dilhan Kankanange". Two words pass through. */
export function shortName(full) {
  const words = String(full ?? '').split(/\s+/).filter(Boolean);
  if (words.length <= 2) return words.join(' ');
  return [words[0], ...words.slice(surnameStart(words))].join(' ');
}

/**
 * The shortened name split for a design that sets the given name and the
 * surname in separate slots. The surname keeps its particles, so the MVP
 * poster's watermark reads "DE SILVA" rather than "SILVA".
 */
export function nameParts(full) {
  const words = shortName(full).split(/\s+/).filter(Boolean);
  if (words.length < 2) return { first: words[0] ?? '', last: '' };
  return { first: words[0], last: words.slice(1).join(' ') };
}

/** Hidden profiles and unregistered fill-ins come back with null names. */
export function displayName(appearance) {
  const full = `${appearance.firstName ?? ''} ${appearance.lastName ?? ''}`.trim();
  return full ? shortName(full) : 'Fill-in player';
}
