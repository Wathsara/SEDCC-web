/**
 * Build the MVP poster's fields from a PlayHQ game summary.
 *
 * Which player? For now, **player 1 of our innings** — the top run-scorer of
 * the side this card is for. That is a deliberate placeholder, not a judgement:
 * picking a genuine player of the match needs batting and bowling weighed
 * against the match situation, and getting that wrong in the club's name is
 * worse than a rule anyone can predict. The rule is stated on the card's own
 * terms and is easy to replace here when the club decides how it wants MVP
 * chosen.
 *
 * Their bowling figures are shown alongside if they bowled, so an all-round
 * performance still reads as one.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayName, nameParts } from './names.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = resolve(ROOT, process.env.PLAYHQ_DATA_DIR ?? 'data/playhq');

const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

/** Stats are {type,value} in unstable order, and a zero is often simply absent. */
const stat = (list, type) => list?.find((s) => s.type === type)?.value ?? 0;


/**
 * @param {string} gameId
 * @param {object} opts
 * @param {RegExp|string} opts.clubMatch  which side is ours
 * @param {string} [opts.competition]     e.g. "ECA 2026/27 • LOC 1"
 */
export async function mvpFields(gameId, { clubMatch = 'dreamers', competition } = {}) {
  const summary = JSON.parse(
    await readFile(resolve(DATA_DIR, 'games', `${gameId}.json`), 'utf8'),
  );

  const ours = summary.teams?.find((t) => new RegExp(clubMatch, 'i').test(t.name));
  if (!ours) return null;
  const them = summary.teams?.find((t) => t.id !== ours.id);

  const nameById = new Map((summary.appearances ?? []).map((a) => [a.id, displayName(a)]));

  // Our batting innings, and the innings in which we bowled.
  let ourBatting = null;
  let ourBowling = null;
  for (const period of summary.periods ?? []) {
    for (const side of period.teams ?? []) {
      if (side.id !== ours.id) continue;
      if (side.discipline === 'BATTING') ourBatting = side;
      if (side.discipline === 'BOWLING') ourBowling = side;
    }
  }
  if (!ourBatting) return null;

  const eligible = (ourBatting.appearances ?? []).filter((a) => a.status !== 'DID_NOT_BAT');
  if (!eligible.length) return null;

  const player = [...eligible].sort(
    (a, b) => stat(b.statistics, 'TOTAL_RUNS') - stat(a.statistics, 'TOTAL_RUNS'),
  )[0];

  const runs = stat(player.statistics, 'TOTAL_RUNS');
  const balls = stat(player.statistics, 'BALLS_FACED');
  const fours = stat(player.statistics, 'FOURS');
  const sixes = stat(player.statistics, 'SIXES');

  const name = nameById.get(player.id) ?? 'Fill-in player';
  const { first, last } = nameParts(name);

  const f = {
    'player.first': first.toUpperCase(),
    'player.last': last.toUpperCase(),
    'player.watermark': (last || first).toUpperCase(),
    'bat.runs': String(runs),
    'bat.notout': player.status === 'NOT_OUT' ? '*' : '',
    'bat.balls': balls ? `(${balls})` : '',
    'bat.boundaries': [fours && `${fours}x4`, sixes && `${sixes}x6`].filter(Boolean).join(' • '),
    'award': 'MVP OF THE MATCH',
    'meta.opponent': them ? `VS ${them.name}`.toUpperCase() : '',
  };

  // Bowling, only if this player actually bowled. An empty pair of figures
  // beside a batting performance reads as 0/0, which is not what happened.
  const spell = (ourBowling?.appearances ?? []).find((a) => a.id === player.id);
  const oversBowled = spell ? stat(spell.statistics, 'OVERS') : 0;
  if (spell && oversBowled) {
    const conceded = stat(spell.statistics, 'RUNS');
    const wickets = stat(spell.statistics, 'WICKETS');
    const econ = oversBowled ? (conceded / oversBowled).toFixed(2) : null;
    f['bowl.figures'] = `${wickets}/${conceded}`;
    f['bowl.detail'] = [`${oversBowled} OVS`, econ && `ECON ${econ}`].filter(Boolean).join(' • ');
  } else {
    f['bowl.figures'] = '';
    f['bowl.detail'] = '';
  }

  // Fielding. PlayHQ files these under the BOWLING discipline, because that is
  // when fielding happens — a player who never bowled still has an entry there
  // if they took a catch.
  const field = (ourBowling?.appearances ?? []).find((a) => a.id === player.id);
  const catches = field ? stat(field.statistics, 'TOTAL_CATCHES') : 0;
  const runOuts = field ? stat(field.statistics, 'TOTAL_RUN_OUTS') : 0;
  const stumpings = field ? stat(field.statistics, 'STUMPINGS') : 0;
  const dismissals = catches + runOuts + stumpings;

  if (dismissals) {
    f['field.figures'] = String(dismissals);
    f['field.detail'] = [
      catches && `${catches} CT`,
      runOuts && `${runOuts} RO`,
      stumpings && `${stumpings} ST`,
    ]
      .filter(Boolean)
      .join(' • ');
  } else {
    f['field.figures'] = '';
    f['field.detail'] = '';
  }

  if (summary.round?.name) f['meta.round'] = summary.round.name.toUpperCase();
  const when = summary.schedule?.[0]?.dateTime ?? summary.schedule?.dateTime;
  if (when) {
    const d = new Date(when);
    f['meta.date'] = `${String(d.getDate()).padStart(2, '0')} ${MON[d.getMonth()]} ${d.getFullYear()}`;
  }
  if (competition) f['meta.competition'] = competition.toUpperCase();

  return f;
}
