/**
 * Club crests and association badges, cached locally.
 *
 * PlayHQ serves uploaded artwork from Cloudinary in six square sizes. The URLs
 * carry a version stamp and a signed-looking `_a=` parameter, so they are not
 * something to hardcode into a template and forget — the match graphics already
 * carry expiring links and that is a bug waiting to happen. The files are
 * downloaded once and committed alongside the fixtures, which also keeps the
 * render working offline, the way every other piece of PlayHQ data here does.
 *
 * Written by scripts/playhq/sync.ts. Read by scripts/graphics/.
 */

import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { teamsForSeason } from './client.js';
import type { PlayHQImage, Season, SeasonTeam } from './types.js';
import { DATA_DIR, log, writeJson } from './utils.js';

export const LOGO_DIR = resolve(DATA_DIR, 'logos');

/** A stable filename from a club or association name. */
export const logoSlug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Names as PlayHQ writes them vary between a club and its teams — "Dreamers SC"
 * against "Dreamers SC - 4". Matching happens on this reduced form so a card
 * showing a team name can still find its club's crest.
 */
export const matchKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s*-\s*\d+\s*$/, ' ') // VSCA: "Dreamers SC - 4"
    .replace(/\b\d+\s*(st|nd|rd|th)\s*xi\b/g, ' ') // ECA: "AYC Harlequins 1st XI"
    .replace(/\bxi\b/g, ' ')
    .replace(/\b(cc|sc|cricket|club|senior|seniors|men|women|grade\s*\d*\w*)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');

/** The largest size on offer; these top out at 256 square. */
function largest(image: PlayHQImage | null | undefined): string | null {
  const sizes = image?.sizes ?? [];
  if (!sizes.length) return null;
  const best = [...sizes].sort(
    (a, b) => (b.dimensions?.width ?? 0) - (a.dimensions?.width ?? 0),
  )[0];
  return best?.url ?? null;
}

async function download(url: string, into: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn(`logo ${res.status}: ${url.slice(0, 80)}`);
      return false;
    }
    await writeFile(into, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch (err) {
    log.warn(`logo failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

export interface LogoEntry {
  name: string;
  /** Repo-relative, so the graphics scripts can resolve it without guessing. */
  file: string;
  teamIds: string[];
  matchKey: string;
  source: string;
}

/**
 * Fetch every club crest in the given seasons, plus each association badge, and
 * cache them under data/playhq/logos/. Re-running skips files already present:
 * a club changes its crest about once a decade, and the sync runs weekly.
 */
export async function syncLogos(
  seasonIds: string[],
  seasons: Season[],
): Promise<Record<string, LogoEntry>> {
  const entries: Record<string, LogoEntry> = {};
  if (!seasonIds.length) return entries;

  await mkdir(LOGO_DIR, { recursive: true });

  // What we fetched last time, so a re-uploaded crest is actually picked up.
  // The URL carries the upload timestamp, so a changed URL means changed art.
  let previous: Record<string, LogoEntry> = {};
  try {
    const old = await readFile(resolve(DATA_DIR, 'logos.json'), 'utf8');
    previous = JSON.parse(old).logos ?? {};
  } catch {
    // First run.
  }

  const add = async (name: string, image: PlayHQImage | null | undefined, teamId?: string) => {
    const url = largest(image);
    if (!name || !url) return;

    const slug = logoSlug(name);
    const ext = (url.split('?')[0].match(/\.(png|jpg|jpeg|webp|svg)$/i)?.[1] ?? 'png').toLowerCase();
    const file = `data/playhq/logos/${slug}.${ext}`;
    const path = resolve(LOGO_DIR, `${slug}.${ext}`);

    // Skip the download only when the file is there AND came from this exact
    // URL. Checking existence alone means a club can change its crest and the
    // site shows the old one forever — which is the failure a cache is
    // supposed to avoid, not cause.
    const stale = previous[slug]?.source !== url;
    if (!existsSync(path) || stale) {
      if (!(await download(url, path))) return;
      log.ok(`crest: ${name}${existsSync(path) && stale ? ' (updated)' : ''}`);
    }

    const existing = entries[slug];
    entries[slug] = {
      name,
      file,
      teamIds: [...new Set([...(existing?.teamIds ?? []), ...(teamId ? [teamId] : [])])],
      matchKey: matchKey(name),
      source: url,
    };
  };

  for (const seasonId of [...new Set(seasonIds)].filter(Boolean)) {
    let teams: SeasonTeam[] = [];
    try {
      teams = await teamsForSeason(seasonId);
    } catch (err) {
      log.warn(`season ${seasonId} teams: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    for (const team of teams) {
      if (team.club?.name) await add(team.club.name, team.club.logo, team.id);
    }
  }

  // Association badges, so the graphics stop carrying a hardcoded ECA/VSCA image.
  for (const season of seasons) {
    if (season.association?.name) await add(season.association.name, season.association.logo);
  }

  await writeJson(resolve(DATA_DIR, 'logos.json'), {
    syncedAt: new Date().toISOString(),
    _comment:
      'Club crests and association badges from PlayHQ, cached locally. Machine-written by scripts/playhq/sync.ts — do not hand-edit. Match a team name to a crest with matchKey, which strips the grade suffix and words like CC/SC so "Dreamers SC - 4" finds "Dreamers SC".',
    logos: entries,
  });

  const n = Object.keys(entries).length;
  if (n) log.ok(`${n} crest(s) cached in data/playhq/logos/`);
  return entries;
}
