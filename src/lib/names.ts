/**
 * How a player's name is set on a squad card.
 *
 * The card gives the name two lines — given name above, surname below — so that
 * every card in a two-column phone grid finishes at the same height. That only
 * works if the surname fits its line. Measured at 360px, the narrowest common
 * phone, a surname line is 126px wide, and "Rahubadde Kankanange" wants 180px.
 *
 * So a name of more than two words is cut to a given name and a surname, where
 * the surname is the last word plus any particles leading into it:
 *
 *   Dilhan Rahubadde Kankanange  ->  Dilhan / Kankanange
 *   Santhuka De Silva            ->  Santhuka / De Silva
 *
 * "De Silva" is one surname, not a surname with a spare word in front of it, so
 * it stays whole. The full name is kept in config/players.json and goes on the
 * card's title attribute; this only governs what is set in type.
 *
 * This is the same rule scripts/graphics/names.mjs applies to the match-summary
 * and MVP cards, so the site and the posters write a name the same way. The two
 * are separate files because one is bundled by Vite and the other is run by
 * plain node — if you change the particle list, change it in both.
 */

/** Words that belong to the surname that follows them. Lower-cased on lookup. */
const PARTICLES = new Set([
  'de', 'del', 'della', 'der', 'den', 'da', 'das', 'dos', 'di', 'do', 'du',
  'van', 'von', 'ten', 'ter', 'la', 'le', 'el', 'al', 'bin', 'binti', 'ibn',
  'st', 'mac', 'mc',
]);

/**
 * Where the surname starts in `words`. Never index 0 — a lone surname with
 * nothing before it is a given name, not a surname.
 */
function surnameStart(words: string[]): number {
  let i = words.length - 1;
  while (i > 1 && PARTICLES.has(words[i - 1].toLowerCase())) i--;
  return i;
}

/** The two lines a squad card sets, in order. */
export function nameLines(full: string): { given: string; surname: string } {
  const words = String(full ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return { given: '', surname: '' };
  if (words.length === 1) return { given: words[0], surname: '' };
  const i = words.length === 2 ? 1 : surnameStart(words);
  return { given: words[0], surname: words.slice(i).join(' ') };
}
