import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RosterPlayer, SeasonConfig, Statistic } from './types.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = resolve(ROOT, 'data/playhq');
export const CONFIG_DIR = resolve(ROOT, 'config');

// --- stats lookup ---------------------------------------------------------

/**
 * Statistics are arrays of {type, value} in unstable order, and a zero value is
 * often simply absent. Always look up by type; never index positionally.
 */
export function stat(stats: Statistic[] | undefined, type: string, fallback = 0): number {
  if (!stats) return fallback;
  const hit = stats.find((s) => s.type === type);
  return hit && typeof hit.value === 'number' ? hit.value : fallback;
}

// --- overs arithmetic -----------------------------------------------------
// PlayHQ reports overs as O.B — "3.5" is 3 overs and 5 balls, not 3.83.
// Adding those with + is wrong. Convert to balls, add, convert back.

export function oversToBalls(overs: number): number {
  const whole = Math.floor(overs);
  const balls = Math.round((overs - whole) * 10);
  return whole * 6 + Math.min(balls, 5);
}

export function ballsToOvers(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

export function economyFromBalls(runs: number, balls: number): number | null {
  if (balls === 0) return null;
  return round2((runs / balls) * 6);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// --- names ----------------------------------------------------------------

/** Fold to a comparable key: lowercase, no punctuation, single spaces. */
export function normaliseName(first?: string | null, last?: string | null): string {
  return `${first ?? ''} ${last ?? ''}`
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function displayName(first?: string | null, last?: string | null): string {
  const name = `${first ?? ''} ${last ?? ''}`.trim();
  // Hidden profiles and unregistered fill-ins come back with null names.
  return name || 'Fill-in player';
}

/**
 * The public cricket API exposes no stable player ID — appearance IDs are
 * regenerated per game. Matching is by name, via the alias table in
 * config/players.json. Unmatched names are reported, never guessed at.
 */
export function buildNameIndex(roster: RosterPlayer[]): Map<string, RosterPlayer> {
  const index = new Map<string, RosterPlayer>();
  for (const player of roster) {
    for (const variant of [player.name, ...(player.aliases ?? [])]) {
      const parts = variant.trim().split(/\s+/);
      const key = normaliseName(parts[0], parts.slice(1).join(' '));
      if (key) index.set(key, player);
    }
  }
  return index;
}

// --- dates ----------------------------------------------------------------

/** ISO week key, e.g. 2026-W46. Weekly stat files are named with this. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function melbourneDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// --- file io --------------------------------------------------------------

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Trailing newline and stable key order keep git diffs small and reviewable.
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export const fileExists = (path: string) => existsSync(path);

export const loadSeasonConfig = (season = '2026-27') =>
  readJson<SeasonConfig>(resolve(CONFIG_DIR, `season-${season}.json`));

export const loadRoster = () =>
  readJson<{ players: RosterPlayer[] }>(resolve(CONFIG_DIR, 'players.json'));

// --- logging --------------------------------------------------------------

export const log = {
  step: (msg: string) => console.log(`\n▸ ${msg}`),
  info: (msg: string) => console.log(`  ${msg}`),
  ok: (msg: string) => console.log(`  ✓ ${msg}`),
  warn: (msg: string) => console.warn(`  ! ${msg}`),
};
